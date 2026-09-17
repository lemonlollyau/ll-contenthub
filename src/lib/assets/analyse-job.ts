import "server-only";
import { z } from "zod";
import { config } from "../config";
import { claudeJson, friendlyClaudeError, imageBlock } from "../claude";
import { db, must } from "../db";
import { downloadFile, downloadThumbnail, getFile } from "../google-drive";
import { decodable, dimensions, orientationOf, thumbnail, visionCopy } from "../images";
import type { Job, StepResult } from "../jobs";
import { errorMessage } from "../log";

// For each new or changed file: make a thumbnail, then ask Claude once for a
// short description and tags. Unchanged files (same md5) are skipped.

export const AssetTagsSchema = z.object({
  description: z.string().describe("One or two plain sentences describing the image for a social media manager."),
  products: z.array(z.string()).describe("Products or packaging visible, using any readable product names."),
  people: z.enum(["none", "one", "several"]),
  people_notes: z.string().describe("Who is shown and what they are doing, or empty."),
  setting: z.string().describe("Where it was taken: studio, bathroom, clinic, outdoors, flat lay…"),
  shot_type: z.string().describe("e.g. product close-up, lifestyle, flat lay, portrait, before/after, graphic"),
  mood: z.array(z.string()),
  colours: z.array(z.string()).describe("Dominant colours in plain words."),
  has_text: z.boolean().describe("True if the image contains overlaid or printed text beyond product labels."),
  text_content: z.string().describe("The overlaid text if any, otherwise empty."),
  keywords: z.array(z.string()).describe("5–12 short search keywords."),
  quality_notes: z.string().describe("Anything that would stop this being used: blurry, cropped awkwardly, watermark… or empty."),
});
export type AssetTags = z.infer<typeof AssetTagsSchema> & { orientation: string };

const SYSTEM = `You catalogue a brand's image library so a social media manager can find the right image for each post.
Describe only what is visible. Be concise and concrete. Never guess product names that aren't readable or obvious.`;

type AnalyseState = { failed: string[]; analysed: number };

async function pending(clientId: string, failed: string[]) {
  let query = db()
    .from("assets_needing_analysis")
    .select("id, drive_file_id, name, mime_type, kind, md5, width, height")
    .eq("client_id", clientId)
    .order("created_at");
  if (failed.length) query = query.not("id", "in", `(${failed.join(",")})`);
  const { data, error } = await query.limit(500);
  if (error) throw new Error(`Couldn't load files to analyse: ${error.message}`);
  return data ?? [];
}

export async function countPendingAnalysis(clientId: string): Promise<number> {
  return (await pending(clientId, [])).length;
}

export async function analyseStep(job: Job): Promise<StepResult<AnalyseState>> {
  const state = { failed: [], analysed: 0, ...(job.state as Partial<AnalyseState>) } as AnalyseState;
  const clientId = job.client_id!;
  const todo = await pending(clientId, state.failed);
  if (todo.length === 0) {
    const msg = `Analysed ${state.analysed} files.` + (state.failed.length ? ` ${state.failed.length} couldn't be read (see Activity log).` : "");
    return { state, finished: true, message: msg };
  }

  const batch = todo.slice(0, config.batch.aiImagesPerCall);
  await Promise.all(
    batch.map(async (asset) => {
      try {
        let source: Buffer | null;
        if (asset.kind === "video") {
          const meta = await getFile(asset.drive_file_id, clientId);
          source = meta.thumbnailLink ? await downloadThumbnail(meta.thumbnailLink) : null;
          if (!source) throw new Error("Drive hasn't made a preview for this video yet.");
        } else {
          source = await decodable(await downloadFile(asset.drive_file_id, clientId), asset.mime_type, asset.name);
        }

        const thumb = await thumbnail(source);
        const thumbPath = `${clientId}/${asset.id}.webp`;
        const up = await db().storage.from(config.storage.thumbsBucket).upload(thumbPath, thumb, {
          contentType: "image/webp",
          upsert: true,
        });
        if (up.error) throw new Error(`Couldn't save thumbnail: ${up.error.message}`);

        const dims = asset.kind === "image" ? await dimensions(source) : { width: asset.width, height: asset.height };
        const tags = await claudeJson({
          schema: AssetTagsSchema,
          system: SYSTEM,
          operation: "asset.analyse",
          clientId,
          effort: "low",
          maxTokens: 4000,
          content: [
            imageBlock(await visionCopy(source)),
            { type: "text", text: `File: ${asset.name}${asset.kind === "video" ? " (this is a frame from a video)" : ""}. Catalogue it.` },
          ],
        });

        must(
          await db()
            .from("assets")
            .update({
              thumbnail_path: thumbPath,
              width: dims.width || asset.width,
              height: dims.height || asset.height,
              ai_description: tags.description,
              ai_tags: { ...tags, orientation: orientationOf(dims.width, dims.height) },
              ai_analysed_md5: asset.md5,
              ai_analysed_at: new Date().toISOString(),
            })
            .eq("id", asset.id)
            .select("id")
            .single(),
          "save the image tags",
        );
        state.analysed += 1;
      } catch (err) {
        state.failed.push(asset.id);
        console.error(`analyse ${asset.name}:`, errorMessage(err));
        await db().from("api_calls").insert({
          client_id: clientId,
          service: "app",
          operation: "asset.analyse",
          ok: false,
          error: `${asset.name}: ${friendlyClaudeError(err)}`,
        });
      }
    }),
  );

  const remaining = todo.length - batch.length;
  return {
    state,
    total: state.analysed + state.failed.length + remaining,
    done: state.analysed + state.failed.length,
    message: `Tagging images… ${state.analysed} done, ${remaining} to go`,
    finished: false,
  };
}
