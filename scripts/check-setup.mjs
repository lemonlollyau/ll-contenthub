// Checks every external connection using .env.local. Prints pass/fail only, never secrets.
// Usage: node --env-file=.env.local scripts/check-setup.mjs
import { createSign } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const results = [];
const check = async (name, fn) => {
  try {
    results.push([name, true, await fn()]);
  } catch (e) {
    results.push([name, false, e.message]);
  }
};

const env = (k) => {
  if (!process.env[k]) throw new Error(`${k} is empty`);
  return process.env[k];
};

await check("Supabase database", async () => {
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  for (const t of ["clients", "content_items", "assets", "asset_matches", "rendered_assets", "jobs", "api_calls", "assets_needing_analysis"]) {
    const { error } = await db.from(t).select("*", { head: true, count: "exact" });
    if (error) throw new Error(`${t}: ${error.message}`);
  }
  const { data, error } = await db.storage.listBuckets();
  if (error) throw new Error(`storage: ${error.message}`);
  const b = Object.fromEntries(data.map((x) => [x.id, x.public]));
  if (b.rendered !== true || b.thumbs !== false || b.imports !== false) throw new Error(`buckets wrong: ${JSON.stringify(b)}`);
  return "tables and storage buckets present";
});

await check("Supabase public key is locked out of data", async () => {
  const anon = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const { data, error } = await anon.from("clients").select("id").limit(1);
  if (error && /Invalid API key/i.test(error.message)) throw new Error("publishable key rejected");
  if (data && data.length) throw new Error("public key can read clients: RLS is not on!");
  return "RLS is blocking it, as intended";
});

await check("Supabase Google sign-in", async () => {
  const res = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/settings`, { headers: { apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY") } });
  const s = await res.json();
  if (!s.external?.google) throw new Error("Google provider is not enabled in Supabase");
  return "Google provider enabled";
});

await check("Encryption key", async () => {
  if (Buffer.from(env("ENCRYPTION_KEY"), "base64").length !== 32) throw new Error("not 32 bytes");
  return "ok";
});

await check("Google Drive service account", async () => {
  const sa = JSON.parse(Buffer.from(env("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"), "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: sa.token_uri, iat: now, exp: now + 600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const tok = await fetch(sa.token_uri, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  if (!tok.ok) throw new Error(`token refused (${tok.status})`);
  const { access_token } = await tok.json();
  const res = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { authorization: `Bearer ${access_token}` } });
  if (res.status === 403) throw new Error("Drive API is not enabled in the Google Cloud project");
  if (!res.ok) throw new Error(`Drive error ${res.status}`);
  const { files } = await res.json();
  return `${sa.client_email}, ${files.length ? "can see shared files" : "no folders shared with it yet"}`;
});

await check("Anthropic API key", async () => {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" } });
  if (res.status === 401) throw new Error("key rejected");
  if (!res.ok) throw new Error(`error ${res.status}`);
  return "key accepted";
});

for (const [name, ok, msg] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${msg}`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
