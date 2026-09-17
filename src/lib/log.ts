import "server-only";
import { db } from "./db";

type CallInfo = { service: string; operation: string; clientId?: string | null; meta?: Record<string, unknown> };

/**
 * Wraps an external API call so every call is recorded in api_calls,
 * whether it succeeds or fails. Logging problems never break the call itself.
 */
export async function loggedCall<T>(info: CallInfo, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await record(info, true, Date.now() - started);
    return result;
  } catch (err) {
    const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
    await record(info, false, Date.now() - started, errorMessage(err), typeof status === "number" ? status : undefined);
    throw err;
  }
}

async function record(info: CallInfo, ok: boolean, durationMs: number, error?: string, statusCode?: number) {
  try {
    await db().from("api_calls").insert({
      client_id: info.clientId ?? null,
      service: info.service,
      operation: info.operation,
      ok,
      status_code: statusCode ?? null,
      duration_ms: durationMs,
      error: error ?? null,
      meta: info.meta ?? null,
    });
  } catch (e) {
    console.error("api_calls log failed", e);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
