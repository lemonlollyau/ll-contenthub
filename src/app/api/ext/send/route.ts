import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClient } from "@/lib/clients";
import { decryptSecret } from "@/lib/crypto";
import { db, must } from "@/lib/db";
import { EXT_USER, extRoute } from "@/lib/ext-auth";
import { isCaptionLocked } from "@/lib/flags";
import { errorMessage } from "@/lib/log";
import { planPosts } from "@/lib/push/prepare";
import { sendPlan } from "@/lib/push/push-job";
import { publicUrl } from "@/lib/render";
import type { ContentItem, CustomMedia } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({
  clientId: z.string().uuid(),
  // Either an existing calendar post, or a new one that isn't in the calendar.
  itemId: z.string().uuid().optional(),
  newPost: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      channels: z.array(z.string().min(1)).min(1),
    })
    .optional(),
  format: z.enum(["feed", "carousel", "reel", "story", "text", "square"]),
  caption: z.string().max(5000).optional(),
  cta: z.string().max(500).optional(),
  hashtags: z.string().max(1000).optional(),
  firstComment: z.string().max(2200).optional(),
  media: z.array(z.object({ url: z.string().url(), altText: z.string().max(1000).optional() })).max(20),
  // Drafts only, unless the person typed SCHEDULE in the extension (same rule as the push page).
  schedule: z.literal("SCHEDULE").optional(),
  // Save without sending to Buffer.
  saveOnly: z.boolean().optional(),
});

/**
 * Saves what was designed in the extension onto a calendar post (or a new
 * post), then sends it to Buffer through the same checks and code as the
 * calendar push. If any check fails, the work is saved but nothing is sent.
 */
export const POST = extRoute(async (req: NextRequest) => {
  const body = Body.parse(await req.json());
  const client = await getClient(body.clientId);
  if (!body.itemId && !body.newPost) throw new Error("Pick a calendar post, or fill in the new post's date, time and channels.");

  // Only accept images Content Hub itself is hosting.
  const ourPrefix = publicUrl("");
  if (body.media.some((m) => !m.url.startsWith(ourPrefix))) throw new Error("Images must be uploaded through Content Hub first.");
  const customMedia: CustomMedia[] = body.media.map((m) => ({ url: m.url, kind: "image", altText: m.altText ?? "", source: "chrome-extension" }));

  const text = {
    ...(body.caption !== undefined && { caption: body.caption }),
    ...(body.cta !== undefined && { cta: body.cta }),
    ...(body.hashtags !== undefined && { hashtags: body.hashtags }),
    ...(body.firstComment !== undefined && { first_comment: body.firstComment }),
  };

  let itemId: string;
  if (body.itemId) {
    const item = must(
      await db().from("content_items").select("*").eq("id", body.itemId).eq("client_id", client.id).single(),
      "load the calendar post",
    ) as ContentItem;
    // Approved captions are used verbatim and never edited here.
    if (isCaptionLocked(item) && text.caption !== undefined && text.caption !== (item.caption ?? "")) {
      throw new Error("This caption is marked approved, so it can't be changed from the extension.");
    }
    if (isCaptionLocked(item)) delete text.caption;
    must(
      await db().from("content_items").update({ ...text, format: body.format, custom_media: customMedia }).eq("id", item.id).select("id"),
      "save the post",
    );
    itemId = item.id;
  } else {
    const np = body.newPost!;
    const created = must(
      await db()
        .from("content_items")
        .insert({
          client_id: client.id,
          type: "social",
          post_date: np.date,
          post_time: np.time,
          channels: np.channels,
          format: body.format,
          ...text,
          custom_media: customMedia,
          status: "ready",
          source_row: { source: "chrome-extension" },
        })
        .select("id")
        .single(),
      "create the post",
    ) as { id: string };
    itemId = created.id;
  }

  const plans = await planPosts(client, { itemIds: [itemId] });
  const blocked = plans.filter((p) => p.errors.length);
  const response = {
    itemId,
    checks: plans.map((p) => ({ platform: p.platform, errors: p.errors, warnings: p.warnings, text: p.text, dueAt: p.dueAt })),
    results: [] as { platform: string; ok: boolean; action?: string; error?: string }[],
    sent: false,
  };
  if (body.saveOnly || blocked.length || !plans.length) return NextResponse.json(response);

  if (!client.buffer_api_key_enc) throw new Error("This client has no Buffer API key. Add one in Content Hub → Settings.");
  const apiKey = decryptSecret(client.buffer_api_key_enc);
  for (const plan of plans) {
    try {
      const action = await sendPlan(client, apiKey, plan, body.schedule !== "SCHEDULE", EXT_USER);
      response.results.push({ platform: plan.platform, ok: true, action });
    } catch (err) {
      response.results.push({ platform: plan.platform, ok: false, error: errorMessage(err) });
    }
  }
  response.sent = response.results.some((r) => r.ok);
  return NextResponse.json(response);
});
