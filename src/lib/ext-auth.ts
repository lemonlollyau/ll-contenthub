import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// The Chrome extension can't use the Google sign-in cookie, so its routes
// (/api/ext/*) check one shared secret instead: EXTENSION_SECRET, sent in the
// x-studio-key header. The extension stores it locally; nothing else has it.

export const EXT_USER = "chrome-extension";

/** Returns a 401 response if the key is missing or wrong, otherwise null. */
export function checkExtensionKey(req: NextRequest): NextResponse | null {
  const expected = process.env.EXTENSION_SECRET ?? "";
  const given = req.headers.get("x-studio-key") ?? "";
  if (expected.length < 24) {
    return NextResponse.json(
      { error: "EXTENSION_SECRET isn't set in Content Hub (Vercel → Settings → Environment Variables). It must be at least 24 characters." },
      { status: 500 },
    );
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "The extension's key doesn't match Content Hub. Re-paste it in the extension's settings." }, { status: 401 });
  }
  return null;
}

/** Wraps a route so errors come back as { error } JSON the extension can show. */
export function extRoute<A extends unknown[]>(fn: (req: NextRequest, ...rest: A) => Promise<Response>) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    const denied = checkExtensionKey(req);
    if (denied) return denied;
    try {
      return await fn(req, ...rest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // notFound() from getClient throws a special error; report it plainly.
      if (/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test(message)) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}
