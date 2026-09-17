import "server-only";
import { config } from "./config";
import { db } from "./db";

/** Short-lived signed URLs for private thumbnails, keyed by storage path. */
export async function signedThumbs(paths: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (!unique.length) return {};
  const { data, error } = await db().storage.from(config.storage.thumbsBucket).createSignedUrls(unique, 60 * 60);
  if (error) throw new Error(`Couldn't load thumbnails: ${error.message}`);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}
