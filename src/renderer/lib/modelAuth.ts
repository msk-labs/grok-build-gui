import type { ModelState } from "../../electron/preload";
import { detectBrand } from "./modelBrand";
import { modelGroupId } from "./modelGroups";

/** Only Grok's built-in catalog needs the Grok account from the login screen. */
export function selectedModelNeedsGrokLogin(models: ModelState): boolean {
  const modelId = models.currentModelId;
  if (!modelId) return true;
  if (modelGroupId(modelId) !== "builtin") return false;
  const selected = models.availableModels.find(
    (model) => model.modelId === modelId,
  );
  return detectBrand(modelId, selected?.name).id === "grok";
}
