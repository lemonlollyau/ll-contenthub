import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getUser, type AppUser } from "./auth";

/** Route wrapper for the phone Pick page: signed-in allowlisted user, errors as { error } JSON. */
export function pickRoute<A extends unknown[]>(fn: (req: NextRequest, user: AppUser, ...rest: A) => Promise<Response>) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    try {
      return await fn(req, user, ...rest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test(message)) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return NextResponse.json({ error: message }, { status: 400 });
    }
  };
}
