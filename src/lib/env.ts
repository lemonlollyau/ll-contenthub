import "server-only";

/** Reads a required server-side environment variable, with a plain-English error. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing setting ${name}. Add it to .env.local (locally) or Vercel → Settings → Environment Variables, then restart.`,
    );
  }
  return value;
}

/** Emails allowed to sign in, from ALLOWED_EMAILS (comma-separated). */
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && allowedEmails().includes(email.toLowerCase());
}
