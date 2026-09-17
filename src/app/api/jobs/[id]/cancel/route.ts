import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { saveJob } from "@/lib/jobs";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/cancel">) {
  await requireUser();
  const { id } = await ctx.params;
  await saveJob(id, { status: "cancelled" });
  return NextResponse.json({ ok: true });
}
