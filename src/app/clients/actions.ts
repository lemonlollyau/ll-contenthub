"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { slugify } from "@/lib/clients";
import { encryptSecret } from "@/lib/crypto";
import { db, must } from "@/lib/db";
import { getFile, parseDriveId, FOLDER_MIME, serviceAccountEmail } from "@/lib/google-drive";
import { createJob } from "@/lib/jobs";
import { initialIndexState } from "@/lib/assets/index-job";
import { errorMessage } from "@/lib/log";
import type { PostingRules } from "@/lib/types";

export type ActionResult = { ok: boolean; message: string } | null;

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const lines = (f: FormData, k: string) =>
  text(f, k).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

export async function createClientAction(formData: FormData) {
  await requireUser();
  const name = text(formData, "name");
  if (!name) return;
  let slug = slugify(name);
  const taken = await db().from("clients").select("id").eq("slug", slug).maybeSingle();
  if (taken.data) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const client = must(
    await db().from("clients").insert({ name, slug }).select("id").single(),
    "create the client",
  ) as { id: string };
  must(await db().from("brand_profiles").insert({ client_id: client.id }).select("client_id").single(), "create the brand profile");
  redirect(`/clients/${client.id}/settings`);
}

export async function saveClientBasics(clientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const driveInput = text(formData, "drive_folder");
  const reuse = Number(text(formData, "reuse_window_days") || 14);
  const { error } = await db()
    .from("clients")
    .update({
      name: text(formData, "name"),
      timezone: text(formData, "timezone") || "Australia/Adelaide",
      drive_folder_id: driveInput ? parseDriveId(driveInput) : null,
      placeholder_image_url: text(formData, "placeholder_image_url") || null,
      reuse_window_days: Number.isFinite(reuse) && reuse >= 0 ? Math.round(reuse) : 14,
    })
    .eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Saved." };
}

export async function saveBrandProfile(clientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const { error } = await db()
    .from("brand_profiles")
    .upsert({
      client_id: clientId,
      voice_notes: text(formData, "voice_notes"),
      words_to_avoid: lines(formData, "words_to_avoid"),
      compliance_notes: text(formData, "compliance_notes"),
      colours: { primary: text(formData, "colour_primary"), secondary: text(formData, "colour_secondary"), accent: text(formData, "colour_accent") },
      fonts: { heading: text(formData, "font_heading"), body: text(formData, "font_body") },
      logo_url: text(formData, "logo_url") || null,
      email_footer: { address: text(formData, "footer_address"), note: text(formData, "footer_note") },
      standing_hashtags: lines(formData, "standing_hashtags"),
      standing_ctas: text(formData, "standing_ctas").split("\n").map((s) => s.trim()).filter(Boolean),
    });
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}/settings`);
  return { ok: true, message: "Brand profile saved." };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function savePostingRules(clientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const t = (k: string) => text(formData, k);
  const pillars = formData
    .getAll("pillar")
    .map((p, i) => ({
      pillar: String(p).trim(),
      weekday: String(formData.getAll("p_weekday")[i] ?? ""),
      weekend: String(formData.getAll("p_weekend")[i] ?? ""),
      evening: String(formData.getAll("p_evening")[i] ?? ""),
    }))
    .filter((p) => p.pillar);
  const rules: PostingRules = {
    amTime: t("amTime"),
    deadlineTime: t("deadlineTime"),
    defaults: { weekday: t("d_weekday"), weekend: t("d_weekend"), evening: t("d_evening") },
    pillars,
  };
  const all = [rules.amTime, rules.deadlineTime, ...Object.values(rules.defaults), ...pillars.flatMap((p) => [p.weekday, p.weekend, p.evening])];
  if (all.some((v) => !TIME.test(v))) {
    return { ok: false, message: "Every time needs to be in 24-hour HH:MM format, e.g. 08:00 or 19:30." };
  }
  const { error } = await db().from("clients").update({ posting_rules: rules }).eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}/settings`);
  return { ok: true, message: "Posting times saved." };
}


export async function testDrive(clientId: string): Promise<ActionResult> {
  await requireUser();
  const { data } = await db().from("clients").select("drive_folder_id").eq("id", clientId).single();
  if (!data?.drive_folder_id) return { ok: false, message: "Add the Drive folder link first, then save." };
  try {
    const f = await getFile(data.drive_folder_id, clientId);
    if (f.mimeType !== FOLDER_MIME) return { ok: false, message: `That link is a file ("${f.name}"), not a folder. Paste the folder link instead.` };
    return { ok: true, message: `Connected to "${f.name}".` };
  } catch (err) {
    const email = serviceAccountEmail();
    return { ok: false, message: `${errorMessage(err)}${email ? "" : " The Google service account isn't set up yet."}` };
  }
}

export async function startDriveIndex(clientId: string) {
  await requireUser();
  const { data } = await db().from("clients").select("drive_folder_id").eq("id", clientId).single();
  if (!data?.drive_folder_id) throw new Error("Add the Drive folder link in Settings first.");
  await createJob("drive_index", clientId, {}, initialIndexState(data.drive_folder_id));
  revalidatePath(`/clients/${clientId}/library`);
}

export async function startAnalysis(clientId: string) {
  await requireUser();
  await createJob("ai_analyse", clientId);
  revalidatePath(`/clients/${clientId}/library`);
}

export async function deleteClient(clientId: string, formData: FormData) {
  await requireUser();
  if (text(formData, "confirm") !== "DELETE") return;
  must(await db().from("clients").delete().eq("id", clientId).select("id"), "delete the client");
  redirect("/clients");
}


/** Test the Buffer key and list every channel it can reach. */





/** Test the ContentStudio key and list its workspaces with their connected accounts. */


// --- Connections: a named API key any client's channels can live in ---------

export async function saveConnection(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const provider = text(formData, "provider");
  const key = text(formData, "api_key");
  if (!name) return { ok: false, message: "Give the connection a name, e.g. \"lemonlolly Buffer\"." };
  if (provider !== "buffer" && provider !== "contentstudio") return { ok: false, message: "Choose Buffer or ContentStudio." };
  if (!id && !key) return { ok: false, message: "Paste the API key." };

  const row = { name, provider, ...(key && { api_key_enc: encryptSecret(key) }) };
  const { error } = id
    ? await db().from("push_connections").update(row).eq("id", id)
    : await db().from("push_connections").insert(row);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath("/connections");
  revalidatePath("/clients", "layout");
  return { ok: true, message: id ? "Connection updated." : `Added "${name}".` };
}

export async function deleteConnection(connectionId: string) {
  await requireUser();
  const clients = must(await db().from("clients").select("id, name, channels"), "load clients") as
    { id: string; name: string; channels: { connectionId: string }[] }[];
  const inUse = clients.filter((c) => (c.channels ?? []).some((ch) => ch.connectionId === connectionId));
  if (inUse.length) throw new Error(`Still used by ${inUse.map((c) => c.name).join(", ")}. Re-map those channels first.`);
  must(await db().from("push_connections").delete().eq("id", connectionId).select("id"), "delete the connection");
  revalidatePath("/connections");
}

export type ConnectionChannels = {
  connectionId: string;
  connectionName: string;
  provider: string;
  workspaces?: { id: string; name: string; timezone?: string }[];
  channels: { platform: string; channelId: string; channelName: string; note?: string }[];
  error?: string;
};

/** Reads every connection's channels, so a client can be mapped across them. */
export async function fetchAllChannels(): Promise<ConnectionChannels[]> {
  await requireUser();
  const { decryptSecret } = await import("@/lib/crypto");
  const connections = must(await db().from("push_connections").select("*").order("name"), "load connections") as
    import("@/lib/types").PushConnection[];

  return Promise.all(
    connections.map(async (conn) => {
      const base = { connectionId: conn.id, connectionName: conn.name, provider: conn.provider };
      try {
        const key = decryptSecret(conn.api_key_enc);
        if (conn.provider === "contentstudio") {
          const { fromCsPlatform, listAccounts, listWorkspaces } = await import("@/lib/contentstudio");
          const workspaces = await listWorkspaces(key);
          const chosen = workspaces.find((w) => w.id === conn.workspace_id) ?? workspaces[0];
          if (chosen && chosen.id !== conn.workspace_id) {
            await db().from("push_connections").update({ workspace_id: chosen.id, workspace_tz: chosen.timezone ?? null }).eq("id", conn.id);
          }
          const accounts = chosen ? await listAccounts(key, chosen.id) : [];
          return {
            ...base,
            workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, timezone: w.timezone })),
            channels: accounts.map((a) => ({
              platform: fromCsPlatform(a.platform),
              channelId: a.id,
              channelName: a.account_name,
              note: a.status && a.status !== "active" ? a.status : undefined,
            })),
          };
        }
        const { listChannels, listOrganizations } = await import("@/lib/buffer");
        const orgs = await listOrganizations(key);
        const channels = (
          await Promise.all(orgs.map(async (o) => (await listChannels(key, o.id)).map((c) => ({ ...c, orgName: o.name }))))
        ).flat();
        return {
          ...base,
          channels: channels.map((c) => ({
            platform: c.service,
            channelId: c.id,
            channelName: `${c.displayName ?? c.name} · ${c.orgName}`,
            note: c.isDisconnected ? "disconnected" : c.isLocked ? "locked" : c.isQueuePaused ? "queue paused" : undefined,
          })),
        };
      } catch (err) {
        return { ...base, channels: [], error: errorMessage(err) };
      }
    }),
  );
}

export async function saveChannels(clientId: string, channels: import("@/lib/types").ChannelMapping[]): Promise<ActionResult> {
  await requireUser();
  const clean = channels.filter((c) => c.platform && c.channelId && c.connectionId);
  const platforms = clean.map((c) => c.platform);
  if (new Set(platforms).size !== platforms.length) return { ok: false, message: "Each platform can only map to one channel." };
  const { error } = await db().from("clients").update({ channels: clean }).eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: `Saved ${clean.length} channel mapping(s).` };
}

export async function setConnectionWorkspace(connectionId: string, workspaceId: string, timezone: string | null): Promise<ActionResult> {
  await requireUser();
  const { error } = await db().from("push_connections").update({ workspace_id: workspaceId, workspace_tz: timezone }).eq("id", connectionId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath("/connections");
  return { ok: true, message: "Workspace saved." };
}
