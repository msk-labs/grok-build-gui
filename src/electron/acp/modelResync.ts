/**
 * `session/new` and `session/load` always start on the agent's catalog default,
 * so a model the user picked earlier has to be re-applied afterwards.
 *
 * This lived inline as `if (modelId && reasoningEffort)`, which silently
 * skipped every model that has no reasoning effort — custom endpoint models
 * never advertise one. The picker then showed the chosen model while the
 * session kept running the default, and prompts went to the wrong provider.
 */
export type ModelResyncArgs = {
  modelId: string;
  /** null means "no effort", which `setModel` must not fill in from prefs. */
  reasoningEffort: string | null;
};

export function modelResyncArgs(
  modelId: string | undefined,
  reasoningEffort: string | undefined,
): ModelResyncArgs | null {
  if (!modelId) return null;
  return { modelId, reasoningEffort: reasoningEffort ?? null };
}
