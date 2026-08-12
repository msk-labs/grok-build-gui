/**
 * Pure adapters between the public OpenAI Responses shape the agent speaks and
 * the ChatGPT backend endpoint the subscription actually serves.
 *
 * Everything provider-specific and reverse-engineered lives here so a change on
 * OpenAI's side is a one-file fix with snapshot tests around it.
 */

import type { UsageWindow } from "./types.js";

/**
 * Fields the ChatGPT backend rejects or ignores. `previous_response_id` only
 * works with server-side storage, which is off for this endpoint.
 */
const STRIPPED_FIELDS = [
  "previous_response_id",
  "service_tier",
  "max_output_tokens",
] as const;

/** Sent when the caller supplies no system prompt; the backend requires one. */
export const DEFAULT_INSTRUCTIONS = "You are a helpful coding assistant.";

export type ResponsesRequest = Record<string, unknown>;

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return typeof item.text === "string" ? item.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractInstructions(input: unknown): {
  input: unknown;
  instructions: string[];
} {
  if (!Array.isArray(input)) return { input, instructions: [] };
  const kept: unknown[] = [];
  const instructions: string[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      kept.push(item);
      continue;
    }
    const message = item as Record<string, unknown>;
    const role = String(message.role ?? "").toLowerCase();
    if (role !== "system" && role !== "developer") {
      kept.push(item);
      continue;
    }
    const text = messageText(message.content);
    if (text) instructions.push(text);
  }
  return { input: kept, instructions };
}

/**
 * Adapt an outbound Responses request:
 * - `store: false` and `stream: true` are required by the backend,
 * - `instructions` must be present,
 * - encrypted reasoning must be requested explicitly since nothing is stored.
 */
export function translateResponsesRequest(
  body: ResponsesRequest,
): ResponsesRequest {
  const next: ResponsesRequest = { ...body };

  for (const field of STRIPPED_FIELDS) delete next[field];

  next.store = false;
  next.stream = true;

  // Grok's generic Responses client encodes its system prompt as input
  // messages. The ChatGPT Codex backend rejects those roles and accepts system
  // policy only through the top-level `instructions` field.
  const extracted = extractInstructions(next.input);
  if (Array.isArray(next.input)) next.input = extracted.input;
  const callerInstructions =
    typeof next.instructions === "string" ? next.instructions.trim() : "";
  next.instructions =
    [callerInstructions, ...extracted.instructions].filter(Boolean).join("\n\n") ||
    DEFAULT_INSTRUCTIONS;

  const include = new Set(
    Array.isArray(next.include)
      ? next.include.filter((v): v is string => typeof v === "string")
      : [],
  );
  if (next.reasoning && typeof next.reasoning === "object") {
    include.add("reasoning.encrypted_content");
  }
  if (include.size > 0) next.include = [...include];

  return next;
}

export type HeaderLookup = (name: string) => string | null;

function readNumber(headers: HeaderLookup, name: string): number | null {
  const raw = headers(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function formatWindowLabel(minutes: number | null): string | null {
  if (minutes === null || minutes <= 0) return null;
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "Daily" : `${days}d window`;
  }
  if (minutes % 60 === 0) return `${minutes / 60}h window`;
  return `${minutes}m window`;
}

/**
 * Read the plan-usage headers the Codex backend attaches to each response.
 * Header names are upstream-defined; anything missing is simply omitted.
 */
export function extractRateLimitWindows(
  headers: HeaderLookup,
  now: number = Date.now(),
): UsageWindow[] {
  const windows: UsageWindow[] = [];

  for (const [id, fallbackLabel] of [
    ["primary", "Current window"],
    ["secondary", "Extended window"],
  ] as const) {
    const usedPercent = readNumber(headers, `x-codex-${id}-used-percent`);
    const windowMinutes = readNumber(headers, `x-codex-${id}-window-minutes`);
    const resetSeconds = readNumber(
      headers,
      `x-codex-${id}-reset-after-seconds`,
    );
    if (usedPercent === null && windowMinutes === null) continue;

    windows.push({
      id,
      label: formatWindowLabel(windowMinutes) ?? fallbackLabel,
      usedPercent:
        usedPercent === null ? null : Math.max(0, Math.min(100, usedPercent)),
      resetsAt:
        resetSeconds === null
          ? null
          : new Date(now + resetSeconds * 1000).toISOString(),
    });
  }

  return windows;
}
