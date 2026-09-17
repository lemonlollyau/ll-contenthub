import "server-only";
import { db, must } from "./db";

// Long jobs run as a series of short "steps". The browser calls
// POST /api/jobs/:id/step repeatedly; each call does one small batch,
// saves progress in jobs.state and returns. Nothing gets near Vercel's
// function time limit, and a closed tab can simply resume later.

export type Job<S = Record<string, unknown>, P = Record<string, unknown>> = {
  id: string;
  client_id: string | null;
  kind: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  params: P;
  state: S;
  total: number;
  done: number;
  message: string | null;
  error: string | null;
};

export type StepResult<S> = {
  state: S;
  total?: number;
  done?: number;
  message?: string;
  finished: boolean;
};

export type StepHandler = (job: Job) => Promise<StepResult<Record<string, unknown>>>;

export async function createJob(kind: string, clientId: string, params: object = {}, state: object = {}) {
  // Only one active job of a kind per client.
  const existing = await db()
    .from("jobs")
    .select("*")
    .eq("client_id", clientId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .maybeSingle();
  if (existing.data) return existing.data as Job;
  return must(
    await db().from("jobs").insert({ kind, client_id: clientId, params, state }).select("*").single(),
    "start the job",
  ) as Job;
}

export async function getJob(id: string): Promise<Job> {
  return must(await db().from("jobs").select("*").eq("id", id).single(), "load the job") as Job;
}

export async function saveJob(id: string, patch: Partial<Job>) {
  must(await db().from("jobs").update(patch).eq("id", id).select("id").single(), "save job progress");
}
