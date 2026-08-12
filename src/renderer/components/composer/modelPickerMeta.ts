import type { ModelInfo } from "../../../electron/preload";

export type ModelPickerTag = "accelerated" | "free";

export type ModelPickerMeta = {
  rate?: string;
  tags: ModelPickerTag[];
  descriptionKey?: "composer.modelBalancedDescription";
};

/**
 * Presentation-only hints for model catalogs that do not expose billing or
 * marketing metadata. Unknown models intentionally stay unbadged.
 */
export function modelPickerMeta(model: ModelInfo): ModelPickerMeta {
  const key = `${model.modelId} ${model.name}`.toLowerCase();

  if (key.includes("glm-5.2")) {
    return { rate: "0.79x", tags: ["accelerated"] };
  }
  if (key.includes("glm-5.1")) {
    return {
      rate: "0.79x",
      tags: ["accelerated"],
      descriptionKey: "composer.modelBalancedDescription",
    };
  }
  if (key.includes("glm-5v-turbo")) {
    return { rate: "0.95x", tags: [] };
  }
  if (key.includes("minimax-m3")) {
    return { rate: "0.25x", tags: [] };
  }
  if (key.includes("kimi-k3")) {
    return { rate: "1.62x", tags: [] };
  }
  if (key.includes("kimi-k2.7-code")) {
    return { rate: "0.57x", tags: [] };
  }
  if (key.includes("hunyuan") || key.includes("h-")) {
    return { rate: "0.00x", tags: ["accelerated", "free"] };
  }

  return { tags: [] };
}
