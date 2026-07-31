import type { TFunction } from "i18next";
import type { TranslationKey } from "../locales/en";

const KNOWN_ERRORS: Readonly<Record<string, TranslationKey>> = {
  "The Grok authentication bridge is unavailable.": "auth.bridgeUnavailable",
  "Could not sign in to Grok.": "auth.signInFailed",
  "Grok is not signed in.": "auth.notSignedInDetail",
  "Not signed in": "auth.notSignedInDetail",
  "Not signed in — run `grok login` or set XAI_API_KEY.":
    "auth.notSignedInDetail",
  "Grok binary not found": "plugins.grokBinaryNotFound",
  "Source is required": "plugins.sourceRequired",
  "Plugin name is required": "plugins.nameRequired",
  "Terminal is not running": "tools.terminalNotRunning",
  "Permission check failed.": "computer.permissionCheckFailed",
  "The built-in Open Computer Use artifact is not prepared.":
    "computer.notPreparedDetail",
  "Could not read the Open Computer Use version.":
    "computer.versionReadFailed",
  "Open Computer Use is not available.": "computer.unavailable",
  "Could not read the Open Computer Use permission status.":
    "computer.permissionStatusFailed",
  "Live voice is unavailable — restart the app after update.":
    "composer.voiceUnavailable",
  "Microphone permission denied.": "composer.microphoneDenied",
  "Microphone permission denied — allow mic for this app.":
    "composer.microphoneAllow",
  "Speech recognition connect timed out.":
    "composer.voiceConnectTimeout",
  "Speech recognition failed.": "composer.voiceFailed",
  "Could not connect to speech recognition (check network / SuperGrok).":
    "composer.voiceConnectFailed",
  "Speech recognition connection error.":
    "composer.voiceConnectionError",
  "Speech recognition closed before ready.":
    "composer.voiceClosedBeforeReady",
  "Speech recognition unauthorized — run `grok login` or set XAI_API_KEY.":
    "composer.voiceUnauthorized",
  "No speech detected — try speaking closer to the mic.":
    "composer.voiceNoSpeech",
  "Recording too short — try again.": "composer.voiceTooShort",
  "Speech recognition timed out.": "composer.voiceTimedOut",
  "Speech recognition timed out waiting for transcript.":
    "composer.voiceTimedOut",
  "Speech recognition returned invalid JSON.":
    "composer.voiceInvalidResponse",
};

export function localizeUiError(
  error: string | null | undefined,
  t: TFunction<"translation">,
  fallbackKey?: TranslationKey,
): string {
  const raw = error?.trim();
  if (!raw) return fallbackKey ? t(fallbackKey) : "";

  const exact = KNOWN_ERRORS[raw];
  if (exact) return t(exact);

  if (
    raw ===
    "Grok session expired or rejected. Run `grok login` to re-authenticate."
  ) {
    return t("auth.sessionExpired");
  }

  return raw;
}
