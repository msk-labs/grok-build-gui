/**
 * Grok Speech-to-Text language codes — aligned with CLI `xai-grok-voice`.
 *
 * Official catalog (25 languages):
 * https://docs.x.ai/developers/model-capabilities/audio/speech-to-text#supported-languages
 *
 * `language` on the wire enables Inverse Text Normalization for that language.
 * Chinese is **not** in the ITN catalog. Forcing `language=en` (the old client
 * fallback) biases streaming STT toward English output for Chinese speech —
 * especially with browser-captured audio. Prefer omitting `language` so the
 * model free-detects (mixed CN/EN still works).
 *
 * The STT API does not accept `auto`; resolve with {@link languageForApi} first.
 * A `null` return means: omit the `language` query/form field.
 */

export type SttLanguage = {
  /** ISO primary code sent as the `language` parameter. */
  code: string;
  /** English display name for UIs. */
  name: string;
};

/** Client-only sentinel — never send on the wire. */
export const STT_LANGUAGE_AUTO = "auto";

/**
 * Client-only Chinese preference. Not in the official ITN catalog — wire
 * omits `language` so the model free-detects Chinese (and mixed CN/EN).
 */
export const STT_LANGUAGE_CHINESE = "zh";

/** Default when unset or unrecognized (English ITN). */
export const STT_LANGUAGE_DEFAULT = "en";

/** Official Grok STT languages (docs.x.ai), sorted by English name. */
export const STT_LANGUAGES: readonly SttLanguage[] = [
  { code: "ar", name: "Arabic" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "fil", name: "Filipino" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "mk", name: "Macedonian" },
  { code: "ms", name: "Malay" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "sv", name: "Swedish" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "vi", name: "Vietnamese" },
] as const;

const CATALOG = new Set(STT_LANGUAGES.map((l) => l.code));

function primaryLanguageSubtag(raw: string): string {
  return (raw.split(/[_\-.]/)[0] ?? "").trim().toLowerCase();
}

function matchSupportedCode(raw: string): string | null {
  const lower = raw.trim().toLowerCase();
  if (CATALOG.has(lower)) return lower;
  return null;
}

/** Tagalog system locale → API Filipino. */
function aliasToSupported(primary: string): string | null {
  if (primary === "tl") return "fil";
  return null;
}

/** Chinese primary / BCP-47 (zh, zh-CN, zh-Hans, …). */
export function isChineseLanguageTag(value?: string | null): boolean {
  if (!value?.trim()) return false;
  return primaryLanguageSubtag(value) === "zh";
}

/**
 * Map a user/config string to a catalog code, {@link STT_LANGUAGE_AUTO},
 * or {@link STT_LANGUAGE_CHINESE}.
 *
 * - blank / unknown → `en`
 * - `auto` → client-only sentinel
 * - `zh` / `zh-CN` / … → `zh` (client-only; wire omits language)
 * - BCP-47 / POSIX → primary when supported
 */
export function canonicalizeSttLanguage(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return STT_LANGUAGE_DEFAULT;
  if (raw.toLowerCase() === STT_LANGUAGE_AUTO) return STT_LANGUAGE_AUTO;
  if (isChineseLanguageTag(raw)) return STT_LANGUAGE_CHINESE;

  const exact = matchSupportedCode(raw);
  if (exact) return exact;

  const primary = primaryLanguageSubtag(raw);
  const byPrimary = matchSupportedCode(primary);
  if (byPrimary) return byPrimary;

  const aliased = aliasToSupported(primary);
  if (aliased) return aliased;

  return STT_LANGUAGE_DEFAULT;
}

/**
 * Best-effort system locale → supported STT code (Node / Electron main).
 * POSIX precedence; empty vars treated as unset.
 * Returns {@link STT_LANGUAGE_CHINESE} for Chinese locales (not a wire code).
 */
export function systemSttLanguageFromEnv(
  env: Record<string, string | undefined> =
    typeof process !== "undefined" ? process.env : {},
): string | null {
  const loc = ["LC_ALL", "LC_MESSAGES", "LANG"]
    .map((k) => env[k])
    .find((v) => typeof v === "string" && v.trim().length > 0)
    ?.trim();
  if (!loc) return null;
  if (loc.toLowerCase() === "c" || loc.toLowerCase() === "posix") return null;
  if (isChineseLanguageTag(loc)) return STT_LANGUAGE_CHINESE;
  const primary = primaryLanguageSubtag(loc);
  return matchSupportedCode(primary) ?? aliasToSupported(primary);
}

/**
 * Concrete language code for the STT wire, or `null` to **omit** the field.
 *
 * Omitting avoids English ITN bias for Chinese speech (and mixed CN/EN).
 * Never returns `auto` or `zh`.
 *
 * @param stored - preference (`auto`, `zh`, catalog code, BCP-47, …)
 * @param localeHint - optional browser/OS locale when resolving `auto`
 *   (renderer should pass `navigator.language`)
 */
export function languageForApi(
  stored?: string | null,
  localeHint?: string | null,
): string | null {
  const canonical = canonicalizeSttLanguage(stored);

  if (canonical === STT_LANGUAGE_CHINESE) return null;

  if (canonical !== STT_LANGUAGE_AUTO) {
    // Explicit catalog code (including `en`). Still free-detect when the
    // environment is Chinese and the preference is the historical default
    // English — otherwise Chinese OS users with saved `en` keep the old bug.
    // Users who truly want English ITN on a Chinese OS can re-select English
    // after we only special-case auto/zh… Actually: for explicit `en` we send
    // `en`. Chinese free-detect is via auto / zh / Chinese system under auto.
    return canonical;
  }

  // auto → env, then browser hint, then en. Chinese → omit on wire.
  const fromEnv = systemSttLanguageFromEnv();
  if (fromEnv === STT_LANGUAGE_CHINESE) return null;
  if (fromEnv) return fromEnv;

  if (localeHint?.trim()) {
    if (isChineseLanguageTag(localeHint)) return null;
    const fromHint = canonicalizeSttLanguage(localeHint);
    if (fromHint === STT_LANGUAGE_CHINESE) return null;
    if (fromHint !== STT_LANGUAGE_AUTO) return fromHint;
  }

  return STT_LANGUAGE_DEFAULT;
}

/**
 * Whether this process / browser looks Chinese — used when preference is the
 * default English so we do not force `language=en` for Chinese dictation.
 */
export function prefersChineseFreeDetect(
  stored?: string | null,
  localeHint?: string | null,
): boolean {
  const canonical = canonicalizeSttLanguage(stored);
  if (canonical === STT_LANGUAGE_CHINESE) return true;
  if (canonical !== STT_LANGUAGE_AUTO && canonical !== STT_LANGUAGE_DEFAULT) {
    return false;
  }
  if (systemSttLanguageFromEnv() === STT_LANGUAGE_CHINESE) return true;
  if (isChineseLanguageTag(localeHint)) return true;
  return false;
}

/**
 * Resolve wire language with Chinese free-detect for default/auto prefs.
 * Prefer this over raw {@link languageForApi} at STT connect time.
 */
export function languageForSttWire(
  stored?: string | null,
  localeHint?: string | null,
): string | null {
  if (prefersChineseFreeDetect(stored, localeHint)) {
    const canonical = canonicalizeSttLanguage(stored);
    // Explicit non-en catalog (ja, ko, …) still wins.
    if (
      canonical !== STT_LANGUAGE_AUTO &&
      canonical !== STT_LANGUAGE_DEFAULT &&
      canonical !== STT_LANGUAGE_CHINESE
    ) {
      return canonical;
    }
    return null;
  }
  return languageForApi(stored, localeHint);
}

/** Settings choices: System (auto), Chinese, then catalog sorted by name. */
export function sttLanguageSettingOptions(): { value: string; label: string }[] {
  return [
    {
      value: STT_LANGUAGE_AUTO,
      label: "System (auto)",
    },
    {
      value: STT_LANGUAGE_CHINESE,
      label: "Chinese (auto-detect)",
    },
    ...STT_LANGUAGES.map((l) => ({
      value: l.code,
      label: l.name,
    })),
  ];
}
