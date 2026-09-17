"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client: only used to start Google sign-in. Data never goes through it. */
export function createBrowserAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
