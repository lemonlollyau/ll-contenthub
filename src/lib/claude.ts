import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "./config";
import { requireEnv } from "./env";
import { loggedCall } from "./log";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return client;
}

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/**
 * One Claude call that must return JSON matching `schema`.
 * Uses structured outputs, and server-side refusal fallbacks so a rare
 * safety-classifier decline is retried on Anthropic's recommended model.
 */
export async function claudeJson<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  content: ContentBlock[];
  operation: string;
  clientId?: string | null;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  return loggedCall(
    { service: "anthropic", operation: opts.operation, clientId: opts.clientId, meta: { model: config.claudeModel } },
    async () => {
      const response = await anthropic().beta.messages.create({
        model: config.claudeModel,
        max_tokens: opts.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        system: opts.system,
        output_config: { effort: opts.effort ?? "medium", format: zodOutputFormat(opts.schema) },
        messages: [{ role: "user", content: opts.content }],
      });
      if (response.stop_reason === "refusal") {
        throw new Error("Claude declined to process this item. Try again or handle it manually.");
      }
      if (response.stop_reason === "max_tokens") {
        throw new Error("Claude's answer was cut off. Try again with a smaller batch.");
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return opts.schema.parse(JSON.parse(text));
    },
  );
}

export function imageBlock(jpeg: Buffer): ContentBlock {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } };
}

export function friendlyClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate-limiting us. Wait a minute, then resume.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection and resume.";
  if (err instanceof Anthropic.APIError) return `Claude error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
