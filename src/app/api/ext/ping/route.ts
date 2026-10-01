import { NextResponse } from "next/server";
import { extRoute } from "@/lib/ext-auth";

/** "Test connection" in the extension's settings. */
export const GET = extRoute(async () => NextResponse.json({ ok: true, app: "lemonlolly Content Hub" }));
