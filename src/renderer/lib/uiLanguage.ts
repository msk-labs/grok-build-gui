export type UiLanguagePreference = "system" | "en" | "zh-CN";
export type UiLanguage = Exclude<UiLanguagePreference, "system">;

function isSimplifiedChinese(tag: string): boolean {
  const normalized = tag.toLowerCase();
  if (!normalized.startsWith("zh")) return false;
  return !(
    normalized.includes("-hant") ||
    normalized.includes("-tw") ||
    normalized.includes("-hk") ||
    normalized.includes("-mo")
  );
}

export function resolveUiLanguage(
  preference: UiLanguagePreference,
  systemLanguages: readonly string[] =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language],
): UiLanguage {
  if (preference !== "system") return preference;
  return isSimplifiedChinese(systemLanguages[0] ?? "") ? "zh-CN" : "en";
}
