/**
 * Context-window gauge math.
 *
 * `used` comes from the agent (`_meta.totalTokens` on session updates = tokens
 * in the model's context after the latest model call); the window size comes
 * from the model's `totalContextTokens`, falling back when it reports none.
 */

import type { ContextUsage, ModelState } from "../../electron/preload";

/** Grok's own default for a model whose catalog entry has no context_window. */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 200_000;

/** Ring/bar color bands, in percent of the window. */
export const CONTEXT_WARN_PERCENT = 60;
export const CONTEXT_DANGER_PERCENT = 85;

export type ContextLevel = "normal" | "warn" | "danger";

export type ContextMeter = {
  usedTokens: number;
  sizeTokens: number;
  /** 0–100, clamped. Not rounded — callers decide the display precision. */
  percent: number;
  freeTokens: number;
  level: ContextLevel;
  modelId: string | null;
};

function positiveInt(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

/** Window the agent reports for `modelId`, or the fallback. */
export function resolveContextWindowTokens(
  modelId: string | null | undefined,
  models: ModelState,
): number {
  const id = modelId?.trim() || models.currentModelId || "";
  const model = models.availableModels.find((m) => m.modelId === id);
  return positiveInt(model?.contextWindowTokens) ?? FALLBACK_CONTEXT_WINDOW_TOKENS;
}

export function contextLevel(percent: number): ContextLevel {
  if (percent >= CONTEXT_DANGER_PERCENT) return "danger";
  if (percent >= CONTEXT_WARN_PERCENT) return "warn";
  return "normal";
}

/**
 * Build the gauge, or null when there is nothing to show yet (no session, or a
 * session that has not run a turn — 0% would read as a real measurement).
 */
export function contextMeter(
  usage: ContextUsage | null | undefined,
  models: ModelState,
): ContextMeter | null {
  const used = positiveInt(usage?.usedTokens);
  if (used == null) return null;
  const sizeTokens = resolveContextWindowTokens(usage?.modelId, models);
  // A stale/fallback window smaller than what is already in context would
  // otherwise render a >100% ring; clamp it and let the number tell the story.
  const percent = Math.min(100, (used / sizeTokens) * 100);
  return {
    usedTokens: used,
    sizeTokens,
    percent,
    freeTokens: Math.max(0, sizeTokens - used),
    level: contextLevel(percent),
    modelId: usage?.modelId ?? models.currentModelId ?? null,
  };
}

/**
 * Panel breakdown of what the last turn put in context. `cachedReadTokens` is
 * the cached slice of `inputTokens` and `reasoningTokens` the thinking slice of
 * `outputTokens`, so they are split out rather than added.
 */
export type ContextBreakdown = {
  cachedTokens: number;
  freshInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export function contextBreakdown(
  usage: ContextUsage | null | undefined,
): ContextBreakdown | null {
  const turn = usage?.lastTurn;
  if (!turn) return null;
  const input = Math.max(0, turn.inputTokens);
  const cached = Math.min(Math.max(0, turn.cachedReadTokens), input);
  return {
    cachedTokens: cached,
    freshInputTokens: Math.max(0, input - cached),
    outputTokens: Math.max(0, turn.outputTokens),
    reasoningTokens: Math.max(0, turn.reasoningTokens),
  };
}

/** 950 → "950", 13_647 → "13.6k", 500_000 → "500k", 1_200_000 → "1.2M". */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  const n = Math.floor(tokens);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${trimZero(n / 1_000)}k`;
  return `${trimZero(n / 1_000_000)}M`;
}

function trimZero(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}
