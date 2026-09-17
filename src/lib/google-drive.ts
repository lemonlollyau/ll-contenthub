import "server-only";
import { createSign } from "node:crypto";
import { requireEnv } from "./env";
import { loggedCall } from "./log";

// Read-only Google Drive access through a service account.
// The only scope ever requested is drive.readonly, so this app cannot
// modify or delete anything in Drive even by mistake.

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const API = "https://www.googleapis.com/drive/v3";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

let cachedToken: { token: string; expiresAt: number } | null = null;

export function serviceAccount(): ServiceAccount {
  const raw = Buffer.from(requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"), "base64").toString("utf8");
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 isn't valid. Re-encode the JSON key file and try again.");
  }
}

/** The email clients share their Drive folder with. */
export function serviceAccountEmail(): string | null {
  try {
    return serviceAccount().client_email;
  } catch {
    return null;
  }
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google refused the service account key (${res.status}). Check GOOGLE_SERVICE_ACCOUNT_JSON_BASE64.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

class DriveError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function friendlyDriveError(status: number, body: string): string {
  if (status === 404) {
    return `Drive can't find that folder or file. Make sure the client has shared the folder with ${serviceAccountEmail() ?? "the service account"} (Viewer is enough).`;
  }
  if (status === 403) {
    return `Drive said "no access". Ask the client to share the folder with ${serviceAccountEmail() ?? "the service account"}, or check the Drive API is enabled in Google Cloud.`;
  }
  if (status === 429) return "Google Drive is rate-limiting us. Wait a minute and resume.";
  return `Google Drive error ${status}: ${body.slice(0, 200)}`;
}

async function driveFetch(path: string, params: Record<string, string>): Promise<Response> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new DriveError(friendlyDriveError(res.status, await res.text()), res.status);
  return res;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
  modifiedTime?: string;
  size?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number };
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
  shortcutDetails?: { targetId: string; targetMimeType: string };
};

const FILE_FIELDS =
  "id,name,mimeType,md5Checksum,modifiedTime,size,thumbnailLink,imageMediaMetadata(width,height,rotation),videoMediaMetadata(width,height,durationMillis),shortcutDetails";

export const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function getFile(fileId: string, clientId?: string): Promise<DriveFile> {
  return loggedCall({ service: "drive", operation: "files.get", clientId, meta: { fileId } }, async () => {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, {
      fields: FILE_FIELDS,
      supportsAllDrives: "true",
    });
    return (await res.json()) as DriveFile;
  });
}

/** One page of a folder's direct children. */
export async function listFolderPage(
  folderId: string,
  pageToken: string | undefined,
  clientId?: string,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  return loggedCall({ service: "drive", operation: "files.list", clientId, meta: { folderId } }, async () => {
    const params: Record<string, string> = {
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    };
    if (pageToken) params.pageToken = pageToken;
    const res = await driveFetch("/files", params);
    return (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
  });
}

/** Download a file's bytes (read-only). */
export async function downloadFile(fileId: string, clientId?: string): Promise<Buffer> {
  return loggedCall({ service: "drive", operation: "files.download", clientId, meta: { fileId } }, async () => {
    const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, { alt: "media", supportsAllDrives: "true" });
    return Buffer.from(await res.arrayBuffer());
  });
}

/** Fetch Drive's own thumbnail (used for videos). */
export async function downloadThumbnail(link: string): Promise<Buffer | null> {
  const res = await fetch(link.replace(/=s\d+$/, "=s800"), {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

/** Accepts a folder id or any Drive folder URL and returns the id. */
export function parseDriveId(input: string): string {
  const s = input.trim();
  const m = s.match(/\/folders\/([\w-]+)/) ?? s.match(/\/d\/([\w-]+)/) ?? s.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : s;
}

export const SUPPORTED = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  video: ["video/mp4", "video/quicktime"],
};

export function assetKind(file: Pick<DriveFile, "mimeType" | "name">): "image" | "video" | null {
  const mime = file.mimeType.toLowerCase();
  if (SUPPORTED.image.includes(mime)) return "image";
  if (SUPPORTED.video.includes(mime)) return "video";
  // Drive sometimes reports HEIC as octet-stream.
  if (/\.(heic|heif)$/i.test(file.name)) return "image";
  return null;
}
