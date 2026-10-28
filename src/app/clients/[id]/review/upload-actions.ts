"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { config } from "@/lib/config";
import { db, must } from "@/lib/db";
import { decodable } from "@/lib/images";
import { errorMessage } from "@/lib/log";
import { renderFormatFor, renderImage } from "@/lib/render";
import type { ContentItem, CustomMedia } from "@/lib/types";

// Uploading from the computer happens in two steps so big phone photos aren't
// squeezed through a server action: the browser puts the original straight
// into private storage with a one-off signed URL, then the server converts it
// (HEIC included), crops it to the post's format, strips metadata and moves it
// to the public bucket the schedulers read from.

const MAX_BYTES = 40 * 1024 * 1024;
const VIDEO = /\.(mp4|mov)$/i;

export type UploadTicket = { path: string; token: string; name: string };

export async function createUploadTickets(clientId: string, names: string[]): Promise<UploadTicket[]> {
  await requireUser();
  const client = await getClient(clientId);
  const tickets: UploadTicket[] = [];
  for (const name of names.slice(0, 20)) {
    const safe = name.replace(/[^\w.\- ]+/g, "_").slice(-80);
    const path = `${client.slug}/uploads/${randomUUID()}-${safe}`;
    const { data, error } = await db().storage.from(config.storage.importsBucket).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Couldn't start the upload: ${error?.message ?? "unknown error"}`);
    tickets.push({ path: data.path, token: data.token, name });
  }
  return tickets;
}

/**
 * Takes what the browser just uploaded, prepares it, and attaches it to the
 * post. Attached images replace any Drive match for that post, which is what
 * "I'll use my own picture for this one" means in practice.
 */
export async function attachUploads(
  clientId: string,
  itemId: string,
  uploads: { path: string; name: string }[],
  replace: boolean,
): Promise<{ ok: boolean; message: string; media?: CustomMedia[] }> {
  await requireUser();
  try {
    const client = await getClient(clientId);
    const item = must(
      await db().from("content_items").select("*").eq("id", itemId).eq("client_id", clientId).single(),
      "load the post",
    ) as ContentItem;

    const existing = replace ? [] : [...(item.custom_media ?? [])];
    const added: CustomMedia[] = [];

    for (const upload of uploads) {
      const file = await db().storage.from(config.storage.importsBucket).download(upload.path);
      if (file.error || !file.data) throw new Error(`Couldn't read ${upload.name}: ${file.error?.message ?? "missing"}`);
      const raw = Buffer.from(await file.data.arrayBuffer());
      if (raw.length > MAX_BYTES) throw new Error(`${upload.name} is over 40 MB.`);

      const month = (item.post_date ?? new Date().toISOString()).slice(0, 7);
      if (VIDEO.test(upload.name)) {
        const path = `${client.slug}/${month}/upload-${randomUUID()}${upload.name.toLowerCase().endsWith(".mov") ? ".mov" : ".mp4"}`;
        const up = await db().storage.from(config.storage.renderedBucket).upload(path, raw, {
          contentType: upload.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4",
          upsert: true,
        });
        if (up.error) throw new Error(`Couldn't store ${upload.name}: ${up.error.message}`);
        added.push({ url: db().storage.from(config.storage.renderedBucket).getPublicUrl(path).data.publicUrl, kind: "video", source: "upload" });
      } else {
        const source = await decodable(raw, undefined, upload.name);
        const { data } = await renderImage(source, renderFormatFor(item.format));
        const path = `${client.slug}/${month}/upload-${randomUUID()}.jpg`;
        const up = await db().storage.from(config.storage.renderedBucket).upload(path, data, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw new Error(`Couldn't store ${upload.name}: ${up.error.message}`);
        added.push({
          url: db().storage.from(config.storage.renderedBucket).getPublicUrl(path).data.publicUrl,
          kind: "image",
          altText: "",
          source: "upload",
        });
      }
      // The original was only a staging copy.
      await db().storage.from(config.storage.importsBucket).remove([upload.path]);
    }

    const media = [...existing, ...added];
    must(await db().from("content_items").update({ custom_media: media }).eq("id", itemId).select("id"), "attach the images");
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: `Added ${added.length} file${added.length === 1 ? "" : "s"}.`, media };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export async function removeUpload(clientId: string, itemId: string, url: string): Promise<{ ok: boolean; message: string; media?: CustomMedia[] }> {
  await requireUser();
  try {
    const item = must(
      await db().from("content_items").select("custom_media").eq("id", itemId).eq("client_id", clientId).single(),
      "load the post",
    ) as { custom_media: CustomMedia[] };
    const media = (item.custom_media ?? []).filter((m) => m.url !== url);
    must(await db().from("content_items").update({ custom_media: media }).eq("id", itemId).select("id"), "remove the image");
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: media.length ? "Removed." : "Back to the matched imagery.", media };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export async function reorderUploads(clientId: string, itemId: string, urls: string[]): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const item = must(
    await db().from("content_items").select("custom_media").eq("id", itemId).eq("client_id", clientId).single(),
    "load the post",
  ) as { custom_media: CustomMedia[] };
  const byUrl = new Map((item.custom_media ?? []).map((m) => [m.url, m]));
  const media = urls.map((u) => byUrl.get(u)).filter(Boolean) as CustomMedia[];
  must(await db().from("content_items").update({ custom_media: media }).eq("id", itemId).select("id"), "reorder the images");
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Order saved." };
}
