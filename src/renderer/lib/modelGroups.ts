/**
 * Groups the model picker by where a model comes from.
 *
 * The agent reports one flat catalog: models it ships with, plus every
 * `[model.<key>]` section in `config.toml`. The key prefix is what tells them
 * apart, so the picker can show subscription-backed and user-added models under
 * their own headings instead of one undifferentiated list.
 */

import type { ModelInfo } from "../../electron/preload";
import type { TranslationKey } from "../locales/en";

/**
 * Config section prefixes written by the main process. These must match the
 * keys generated in `electron/providers/chatgptModels.ts` (`modelConfigKey`);
 * `modelGroups.test.ts` asserts they still agree.
 */
export const OAUTH_MODEL_PREFIX = "chatgpt-";
export const CUSTOM_MODEL_PREFIX = "custom-";

export type ModelGroupId = "builtin" | "oauth" | "custom";

export type ModelGroup = {
  id: ModelGroupId;
  labelKey: TranslationKey;
  models: ModelInfo[];
};

const GROUP_LABELS: Record<ModelGroupId, TranslationKey> = {
  builtin: "models.groupBuiltin",
  oauth: "models.groupOAuth",
  custom: "models.groupCustom",
};

/** Built-ins first: they are the default and the most-used. */
const GROUP_ORDER: ModelGroupId[] = ["builtin", "oauth", "custom"];

export function modelGroupId(modelId: string): ModelGroupId {
  if (modelId.startsWith(OAUTH_MODEL_PREFIX)) return "oauth";
  if (modelId.startsWith(CUSTOM_MODEL_PREFIX)) return "custom";
  return "builtin";
}

/**
 * Split the catalog into ordered, non-empty groups. Order inside a group is the
 * agent's own, which is significant — it lists its preferred model first.
 */
export function groupModels(models: ModelInfo[]): ModelGroup[] {
  const buckets = new Map<ModelGroupId, ModelInfo[]>();
  for (const model of models) {
    const id = modelGroupId(model.modelId);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(model);
    else buckets.set(id, [model]);
  }

  return GROUP_ORDER.flatMap((id) => {
    const grouped = buckets.get(id);
    if (!grouped || grouped.length === 0) return [];
    return [{ id, labelKey: GROUP_LABELS[id], models: grouped }];
  });
}
