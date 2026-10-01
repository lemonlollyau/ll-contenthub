"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { createJob } from "@/lib/jobs";
import { planPosts } from "@/lib/push/prepare";
import { providerInfo } from "@/lib/push/provider";

export type PushResult = { ok: boolean; message: string } | null;

export async function startPush(clientId: string, calendarId: string, _prev: PushResult, formData: FormData): Promise<PushResult> {
  const user = await requireUser();
  const schedule = formData.get("mode") === "schedule";
  if (schedule && String(formData.get("confirm") ?? "").trim() !== "SCHEDULE") {
    return { ok: false, message: 'To schedule posts that will publish automatically, type SCHEDULE in the box. Otherwise leave "Drafts" selected.' };
  }
  const client = await getClient(clientId);
  const provider = providerInfo(client);
  if (!provider.ready) return { ok: false, message: provider.missing! };
  const chosen = new Set(formData.getAll("key").map(String));
  const plans = (await planPosts(client, calendarId)).filter((p) => chosen.has(p.key));
  const blocked = plans.filter((p) => p.errors.length);
  if (blocked.length) {
    return { ok: false, message: `${blocked.length} selected post(s) still have problems (e.g. #${blocked[0].rowNumber}: ${blocked[0].errors[0]}). Fix or untick them.` };
  }
  if (!plans.length) return { ok: false, message: "Tick at least one post to send." };
  await createJob(
    "buffer_push",
    clientId,
    { calendarId, saveToDraft: !schedule, by: user.email },
    { queue: plans.map((p) => p.key), sent: 0, updated: 0, failed: 0, errors: [] },
  );
  revalidatePath(`/clients/${clientId}/push`);
  return { ok: true, message: `Sending ${plans.length} post(s) to ${provider.label} ${schedule ? "as SCHEDULED posts" : "as drafts"}…` };
}
