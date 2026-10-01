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

export async function saveBufferKey(clientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const key = text(formData, "buffer_api_key");
  if (!key) return { ok: false, message: "Paste the Buffer API key first." };
  const { error } = await db().from("clients").update({ buffer_api_key_enc: encryptSecret(key) }).eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}/settings`);
  return { ok: true, message: "Buffer key saved (encrypted)." };
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

export type BufferChannelsResult =
  | { ok: true; orgs: { id: string; name: string; channels: import("@/lib/buffer").BufferApiChannel[] }[] }
  | { ok: false; message: string };

/** Test the Buffer key and list every channel it can reach. */
export async function fetchBufferChannels(clientId: string): Promise<BufferChannelsResult> {
  await requireUser();
  const { data } = await db().from("clients").select("buffer_api_key_enc").eq("id", clientId).single();
  if (!data?.buffer_api_key_enc) return { ok: false, message: "Save a Buffer API key first." };
  try {
    const { decryptSecret } = await import("@/lib/crypto");
    const { listChannels, listOrganizations } = await import("@/lib/buffer");
    const key = decryptSecret(data.buffer_api_key_enc);
    const orgs = await listOrganizations(key, clientId);
    const withChannels = await Promise.all(orgs.map(async (o) => ({ ...o, channels: await listChannels(key, o.id, clientId) })));
    return { ok: true, orgs: withChannels };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export async function saveBufferChannels(clientId: string, channels: import("@/lib/types").BufferChannel[]): Promise<ActionResult> {
  await requireUser();
  const clean = channels.filter((c) => c.platform && c.channelId);
  const platforms = clean.map((c) => c.platform);
  if (new Set(platforms).size !== platforms.length) return { ok: false, message: "Each platform can only map to one channel." };
  const { error } = await db().from("clients").update({ buffer_channels: clean }).eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: `Saved ${clean.length} channel mapping(s).` };
}

export async function savePushProvider(clientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const provider = text(formData, "push_provider");
  if (provider !== "buffer" && provider !== "contentstudio") return { ok: false, message: "Pick Buffer or ContentStudio." };
  const { error } = await db().from("clients").update({ push_provider: provider }).eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: `Posts for this client now go to ${provider === "buffer" ? "Buffer" : "ContentStudio"}.` };
}

export async function saveContentStudioKey(clientId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const key = text(formData, "contentstudio_api_key");
  if (!key) return { ok: false, message: "Paste the ContentStudio API key first." };
  const { error } = await db().from("clients").update({ contentstudio_api_key_enc: encryptSecret(key) }).eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}/settings`);
  return { ok: true, message: "ContentStudio key saved (encrypted)." };
}

export type CsWorkspacesResult =
  | { ok: true; workspaces: { id: string; name: string; timezone?: string; channels: import("@/lib/types").ChannelMapping[] }[] }
  | { ok: false; message: string };

/** Test the ContentStudio key and list its workspaces with their connected accounts. */
export async function fetchContentStudio(clientId: string): Promise<CsWorkspacesResult> {
  await requireUser();
  const { data } = await db().from("clients").select("contentstudio_api_key_enc").eq("id", clientId).single();
  if (!data?.contentstudio_api_key_enc) return { ok: false, message: "Save a ContentStudio API key first." };
  try {
    const { decryptSecret } = await import("@/lib/crypto");
    const { fromCsPlatform, listAccounts, listWorkspaces } = await import("@/lib/contentstudio");
    const key = decryptSecret(data.contentstudio_api_key_enc);
    const workspaces = await listWorkspaces(key, clientId);
    const withAccounts = await Promise.all(
      workspaces.map(async (w) => ({
        id: w.id,
        name: w.name,
        timezone: w.timezone,
        channels: (await listAccounts(key, w.id, clientId)).map((a) => ({
          platform: fromCsPlatform(a.platform),
          channelId: a.id,
          channelName: `${a.account_name}${a.status && a.status !== "active" ? ` (${a.status})` : ""}`,
        })),
      })),
    );
    return { ok: true, workspaces: withAccounts };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export async function saveContentStudioChannels(
  clientId: string,
  workspaceId: string,
  workspaceTz: string | null,
  channels: import("@/lib/types").ChannelMapping[],
): Promise<ActionResult> {
  await requireUser();
  const clean = channels.filter((c) => c.platform && c.channelId);
  const platforms = clean.map((c) => c.platform);
  if (new Set(platforms).size !== platforms.length) return { ok: false, message: "Each platform can only map to one channel." };
  if (!workspaceId) return { ok: false, message: "Choose a workspace first." };
  const { error } = await db()
    .from("clients")
    .update({ contentstudio_workspace_id: workspaceId, contentstudio_workspace_tz: workspaceTz, contentstudio_channels: clean })
    .eq("id", clientId);
  if (error) return { ok: false, message: `Couldn't save: ${error.message}` };
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: `Saved ${clean.length} channel mapping(s).` };
}
