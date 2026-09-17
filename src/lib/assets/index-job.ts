import "server-only";
import { db, must } from "../db";
import { assetKind, FOLDER_MIME, listFolderPage } from "../google-drive";
import { createJob, type Job, type StepResult } from "../jobs";

// Walks the client's Drive folder tree one page at a time and upserts every
// supported image/video into `assets`. Read-only: it never writes to Drive.

type IndexState = {
  queue: { id: string; path: string }[];
  visited: string[];
  pageToken?: string;
  startedAt: string;
  found: number;
  foldersDone: number;
};

export function initialIndexState(rootFolderId: string): IndexState {
  return { queue: [{ id: rootFolderId, path: "" }], visited: [rootFolderId], startedAt: new Date().toISOString(), found: 0, foldersDone: 0 };
}

export async function indexStep(job: Job): Promise<StepResult<IndexState>> {
  const state = job.state as unknown as IndexState;
  const clientId = job.client_id!;
  const current = state.queue[0];

  if (!current) {
    // Finished: anything we didn't see this run has gone from Drive.
    must(
      await db()
        .from("assets")
        .update({ removed_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .is("removed_at", null)
        .lt("last_synced_at", state.startedAt),
      "mark removed files",
    );
    // Tag anything new or changed straight away.
    await createJob("ai_analyse", clientId);
    return { state, finished: true, message: `Found ${state.found} images and videos in ${state.foldersDone} folders.` };
  }

  const page = await listFolderPage(current.id, state.pageToken, clientId);
  const now = new Date().toISOString();
  const rows = [];

  for (const f of page.files) {
    const isFolder = f.mimeType === FOLDER_MIME || f.shortcutDetails?.targetMimeType === FOLDER_MIME;
    if (isFolder) {
      const id = f.shortcutDetails?.targetId ?? f.id;
      if (!state.visited.includes(id)) {
        state.visited.push(id);
        state.queue.push({ id, path: current.path ? `${current.path}/${f.name}` : f.name });
      }
      continue;
    }
    const kind = assetKind(f);
    if (!kind || f.shortcutDetails) continue;
    const rotated = (f.imageMediaMetadata?.rotation ?? 0) % 2 === 1;
    const w = f.imageMediaMetadata?.width ?? f.videoMediaMetadata?.width ?? null;
    const h = f.imageMediaMetadata?.height ?? f.videoMediaMetadata?.height ?? null;
    rows.push({
      client_id: clientId,
      drive_file_id: f.id,
      folder_path: current.path,
      name: f.name,
      mime_type: f.mimeType,
      kind,
      width: rotated ? h : w,
      height: rotated ? w : h,
      duration_ms: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : null,
      size_bytes: f.size ? Number(f.size) : null,
      md5: f.md5Checksum ?? f.modifiedTime ?? null,
      drive_modified_at: f.modifiedTime ?? null,
      last_synced_at: now,
      removed_at: null,
    });
  }

  if (rows.length) {
    must(
      await db().from("assets").upsert(rows, { onConflict: "client_id,drive_file_id" }).select("id"),
      "save the file list",
    );
    state.found += rows.length;
  }

  if (page.nextPageToken) {
    state.pageToken = page.nextPageToken;
  } else {
    state.pageToken = undefined;
    state.queue.shift();
    state.foldersDone += 1;
  }

  const totalFolders = state.foldersDone + state.queue.length;
  return {
    state,
    total: totalFolders,
    done: state.foldersDone,
    message: `Scanning ${current.path || "top folder"}… ${state.found} files so far`,
    finished: false,
  };
}
