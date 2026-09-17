import "server-only";
import { redirect } from "next/navigation";
import { createAuthClient } from "./supabase/server";
import { isAllowedEmail } from "./env";

export type AppUser = { id: string; email: string };

/** Returns the signed-in, allowlisted user or null. */
export async function getUser(): Promise<AppUser | null> {
  const supabase = await createAuthClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!data.user || !isAllowedEmail(email)) return null;
  return { id: data.user.id, email: email! };
}

/** Use at the top of every page, server action and route handler. */
export async function requireUser(): Promise<AppUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
