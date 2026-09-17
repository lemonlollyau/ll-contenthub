import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { JOB_HANDLERS } from "@/lib/job-handlers";
import { getJob, saveJob } from "@/lib/jobs";
import { errorMessage } from "@/lib/log";

// Batches are sized to finish well inside this; it is headroom for slow API calls.
export const maxDuration = 300;

/** Runs one small batch of a job and reports progress. The browser keeps calling this until done. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/step">) {
  await requireUser();
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return NextResponse.json(job);
  }
  const handler = JOB_HANDLERS[job.kind];
  if (!handler) return NextResponse.json({ error: `Unknown job type ${job.kind}` }, { status: 400 });

  try {
    const result = await handler({ ...job, status: "running" });
    const patch = {
      status: result.finished ? ("done" as const) : ("running" as const),
      state: result.state,
      total: result.total ?? job.total,
      done: result.finished ? (result.total ?? job.total) : (result.done ?? job.done),
      message: result.message ?? job.message,
      error: null,
    };
    await saveJob(id, patch);
    return NextResponse.json({ ...job, ...patch });
  } catch (err) {
    // Leave the job resumable: a transient error shouldn't lose progress.
    const message = errorMessage(err);
    await saveJob(id, { status: "failed", error: message });
    return NextResponse.json({ ...job, status: "failed", error: message });
  }
}
