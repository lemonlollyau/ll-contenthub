"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { applyImport, loadSheets, safeFileName } from "@/lib/calendar/import";
import { FIELD_KEYS } from "@/lib/calendar/columns";
import { getClient } from "@/lib/clients";
import { config } from "@/lib/config";
import { db, must } from "@/lib/db";
import { createJob } from "@/lib/jobs";
import { initialMatchState } from "@/lib/matching/match-job";
import { initialRenderState } from "@/lib/render-job";
import { errorMessage } from "@/lib/log";
import type { Calendar } from "@/lib/types";

export async function uploadCalendar(clientId: string, formData: FormData) {
  await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an .xlsx or .csv file first.");
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) throw new Error("That file type isn't supported. Use .xlsx or .csv.");
  const path = `${clientId}/${Date.now()}-${safeFileName(file.name)}`;
  const up = await db().storage.from(config.storage.importsBucket).upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type || "application/octet-stream",
  });
  if (up.error) throw new Error(`Couldn't upload: ${up.error.message}`);
  const now = new Date();
  const cal = must(
    await db().from("calendars").insert({
      client_id: clientId,
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
      source_filename: file.name,
      source_path: path,
    }).select("id").single(),
    "start the import",
  ) as { id: string };
  redirect(`/clients/${clientId}/import/${cal.id}`);
}

export type ImportResult = { ok: false; message: string } | null;

export async function confirmImport(clientId: string, calendarId: string, _prev: ImportResult, formData: FormData): Promise<ImportResult> {
  await requireUser();
  let target: string;
  try {
    const client = await getClient(clientId);
    const calendar = must(await db().from("calendars").select("*").eq("id", calendarId).single(), "load the import") as Calendar;
    const sheets = await loadSheets(calendar);
    const month = String(formData.get("month") ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Pick the month this calendar is for." };

    const mappings: Record<string, Record<string, string>> = {};
    const included: Record<string, boolean> = {};
    sheets.forEach((s, si) => {
      included[s.name] = formData.get(`include_${si}`) === "on";
      mappings[s.name] = {};
      s.headers.forEach((h, hi) => {
        const v = String(formData.get(`map_${si}_${hi}`) ?? "");
        mappings[s.name][h] = FIELD_KEYS.includes(v as never) ? v : "";
      });
      if (included[s.name] && !Object.values(mappings[s.name]).some((v) => v === "caption" || v === "hook" || v === "email_subject")) {
        throw new Error(`"${s.name}": map at least one of Caption, Hook or Email subject.`);
      }
    });
    const { calendarId: id, summary } = await applyImport(client, calendar, sheets, mappings, included, `${month}-01`);
    target = `/clients/${clientId}?calendar=${id}&imported=${summary.created + summary.updated}` +
      (summary.warnings.length ? `&warnings=${encodeURIComponent(summary.warnings.slice(0, 8).join("\n"))}` : "");
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  revalidatePath(`/clients/${clientId}`);
  redirect(target);
}

export async function cancelImport(clientId: string, calendarId: string) {
  await requireUser();
  const cal = await db().from("calendars").select("imported_at, source_path").eq("id", calendarId).single();
  if (cal.data && !cal.data.imported_at) {
    if (cal.data.source_path) await db().storage.from(config.storage.importsBucket).remove([cal.data.source_path]);
    await db().from("calendars").delete().eq("id", calendarId);
  }
  redirect(`/clients/${clientId}`);
}

const EDITABLE = new Set([
  "post_date", "post_time", "slot", "format", "pillar", "moment_offer", "hook", "caption", "cta", "hashtags",
  "asset_brief", "asset_group", "asset_ref", "compliance_note", "status", "channels", "caption_status",
]);

/** Inline edit from the table view. */
export async function updateItemField(clientId: string, itemId: string, field: string, value: string) {
  await requireUser();
  if (!EDITABLE.has(field)) throw new Error("That field can't be edited here.");
  let v: unknown = value.trim() === "" ? null : value;
  if (field === "channels") v = value.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (field === "post_time" && v && !/^\d{2}:\d{2}$/.test(String(v))) throw new Error("Use 24-hour HH:MM.");
  if (field === "post_date" && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error("Use YYYY-MM-DD.");
  if (field === "status" && v && !["draft", "ready", "approved", "pushed"].includes(String(v))) {
    throw new Error("Status must be draft, ready, approved or pushed.");
  }
  if (field === "format" && v && !["feed", "carousel", "reel", "story", "text", "square"].includes(String(v))) {
    throw new Error("Format must be feed, carousel, reel, story, square or text.");
  }
  if (field === "caption") {
    const item = await db().from("content_items").select("caption_status").eq("id", itemId).single();
    if (/approved|final|signed/i.test(item.data?.caption_status ?? "")) {
      throw new Error("This caption is marked approved. Change its caption status first if you really need to edit it.");
    }
  }
  must(await db().from("content_items").update({ [field]: v }).eq("id", itemId).eq("client_id", clientId).select("id"), "save the change");
  revalidatePath(`/clients/${clientId}`);
}

export async function startMatching(clientId: string, calendarId: string, formData: FormData) {
  await requireUser();
  // Matching against an empty library just marks everything "no suitable asset".
  const tagged = await db().from("assets").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).is("removed_at", null).not("ai_description", "is", null);
  if (!tagged.count) redirect(`/clients/${clientId}/library?notice=sync-first`);
  const all = formData.get("all") === "1";
  const state = await initialMatchState(clientId, calendarId, all);
  await createJob("match", clientId, { calendarId }, state);
  revalidatePath(`/clients/${clientId}/review`);
  redirect(`/clients/${clientId}/review?calendar=${calendarId}`);
}

export async function startRender(clientId: string, calendarId: string) {
  await requireUser();
  const state = await initialRenderState(calendarId);
  await createJob("render", clientId, { calendarId }, state);
  revalidatePath(`/clients/${clientId}/push`);
}
