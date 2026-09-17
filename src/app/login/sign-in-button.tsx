"use client";
import { useState } from "react";
import { createBrowserAuthClient } from "@/lib/supabase/browser";

export function SignInButton() {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    await createBrowserAuthClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <button
      onClick={signIn}
      disabled={busy}
      className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
    >
      {busy ? "Opening Google…" : "Sign in with Google"}
    </button>
  );
}
