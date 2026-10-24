import "server-only";
import { z } from "zod";
import { claudeJson } from "./claude";
import { getBrandProfile } from "./clients";
import { db, must } from "./db";
import type { Client, ContentItem, EngagementPlan } from "./types";

// A short plan for being present around a post after it goes live: where the
// relevant conversations are, and openers worth saying. This is a prompt for a
// person, not automation — the value is in replies a human actually means.

const PlanSchema = z.object({
  hashtags: z
    .array(z.string())
    .describe("5–8 hashtags or location tags worth browsing to find people already talking about this topic, '#' included."),
  accounts: z
    .array(z.string())
    .describe(
      "4–6 kinds of account worth seeking out and replying to, described so they can be found (e.g. 'Adelaide Hills wedding photographers', 'local day spa clients posting recovery routines'). Only name a specific handle if it is well known and certain.",
    ),
  openers: z
    .array(z.string())
    .describe(
      "3–5 short, specific things this brand could genuinely say in someone else's comments: useful, human, never generic praise, never a sales pitch.",
    ),
  note: z.string().describe("One line on what to avoid for this particular post, or empty."),
});

const SYSTEM = `You help a small Australian marketing agency spend 15 minutes a day engaging on a client's behalf, as the brand.

The point is real conversation: finding people already discussing the topic and saying something worth reading.
Openers must be specific to the post's subject, sound like a person, and never be flattery, emoji-only, or "Great post!".
Never suggest buying engagement, follow-for-follow, mass-liking, DM spam, or anything a platform would treat as inauthentic.
If the client's compliance notes restrict claims (for example therapeutic goods), the openers must respect them too.`;

export async function generateEngagementPlan(client: Client, item: ContentItem): Promise<EngagementPlan> {
  const brand = await getBrandProfile(client.id);
  const plan = await claudeJson({
    schema: PlanSchema,
    operation: "engagement.plan",
    clientId: client.id,
    effort: "low",
    maxTokens: 2000,
    system: SYSTEM,
    content: [
      {
        type: "text",
        text: [
          `Client: ${client.name} (${client.timezone})`,
          brand.voice_notes && `Voice: ${brand.voice_notes}`,
          brand.compliance_notes && `Compliance: ${brand.compliance_notes}`,
          `Platforms: ${item.channels.join(", ")} · Format: ${item.format ?? "feed"}`,
          item.pillar && `Pillar: ${item.pillar}`,
          item.moment_offer && `Moment/offer: ${item.moment_offer}`,
          item.hook && `Hook: ${item.hook}`,
          item.caption && `Caption:\n${item.caption.slice(0, 1500)}`,
          item.compliance_note && `Compliance note on this post: ${item.compliance_note}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const saved: EngagementPlan = { ...plan, generated_at: new Date().toISOString() };
  must(
    await db().from("content_items").update({ engagement_plan: saved }).eq("id", item.id).select("id"),
    "save the engagement plan",
  );
  return saved;
}
