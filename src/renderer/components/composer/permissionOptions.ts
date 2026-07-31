import type {
  ModelInfo,
  PermissionMode,
  ReasoningEffortOption,
} from "../../../electron/preload";

/** Fallback when a model supports effort but the agent sends no menu list. */
export const DEFAULT_REASONING_EFFORTS: ReasoningEffortOption[] = [
  { id: "high", value: "high", label: "high" },
  { id: "medium", value: "medium", label: "medium" },
  { id: "low", value: "low", label: "low" },
];

/** UI labels: high / medium / low only — strip agent "effort" wording. */
export function cleanEffortLabel(value: string, label?: string | null): string {
  const key = value
    .toLowerCase()
    .replace(/[\s_-]*effort$/i, "")
    .trim();
  if (key === "high" || key === "medium" || key === "low") return key;
  const raw = (label && label.trim()) || value;
  const stripped = raw
    .replace(/\beffort\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || key || value;
}

export function effortOptionsForModel(
  model: ModelInfo | undefined | null,
): ReasoningEffortOption[] {
  if (!model?.supportsReasoningEffort) return [];
  const list = model.reasoningEfforts;
  const source =
    list && list.length > 0 ? list : DEFAULT_REASONING_EFFORTS;
  return source.map((o) => ({
    ...o,
    label: cleanEffortLabel(o.value, o.label),
  }));
}

export const PERMISSION_OPTIONS: Array<{
  id: PermissionMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: "ask",
    label: "Ask for approval",
    shortLabel: "Ask for approval",
    description: "Always ask before editing outside the workspace or using the network.",
  },
  {
    id: "auto",
    label: "Auto",
    shortLabel: "Auto",
    description: "Approve routine actions automatically; ask when risk is higher.",
  },
  {
    id: "always-approve",
    label: "Full access",
    shortLabel: "Full access",
    description: "Run without permission prompts (YOLO).",
  },
];

export function shortModelLabel(id: string | null, name?: string): string {
  if (name && name.trim()) return name;
  if (!id) return "Model";
  // Prefer last path segment / drop long prefixes.
  const base = id.includes("/") ? id.split("/").pop()! : id;
  return base.length > 22 ? `${base.slice(0, 20)}…` : base;
}

/** Chip label: "Grok 4.5 · high" when reasoning intensity is active. */
export function modelChipLabel(
  id: string | null,
  name: string | undefined,
  effort: string | null | undefined,
  effortLabel?: string | null,
): string {
  const base = shortModelLabel(id, name);
  if (!effort) return base;
  const effortText = cleanEffortLabel(effort, effortLabel);
  const combined = `${base} · ${effortText}`;
  return combined.length > 24 ? `${combined.slice(0, 22)}…` : combined;
}

export function folderName(cwd: string): string {
  if (!cwd) return "Select workspace";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}
