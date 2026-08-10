import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ChatGptStatus,
  NormalizedUsage,
} from "../../../electron/preload";
import { localizeUiError } from "../../lib/uiError";

/**
 * ChatGPT subscription state for the settings pane. Sign-in runs in the
 * browser, so the whole call can stay pending for minutes — `busy` drives the
 * cancel affordance rather than a spinner alone.
 */
export function useProviderSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [usage, setUsage] = useState<NormalizedUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.grok?.getChatGptStatus) return;
    const [next, nextUsage] = await Promise.all([
      window.grok.getChatGptStatus(),
      window.grok.getChatGptUsage?.() ?? Promise.resolve(null),
    ]);
    setStatus(next);
    setUsage(nextUsage);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async () => {
    if (!window.grok?.loginChatGpt) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.grok.loginChatGpt();
      setStatus(result.status);
      if (result.ok) {
        await refresh();
      } else if (!result.status.rejectedPlanLabel) {
        // A rejected plan is explained by its own notice; don't double-report.
        setError(
          localizeUiError(result.error ?? null, t, "provider.signInFailed"),
        );
      }
    } catch (e) {
      setError(
        localizeUiError(
          e instanceof Error ? e.message : null,
          t,
          "provider.signInFailed",
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [refresh, t]);

  const cancelLogin = useCallback(async () => {
    await window.grok?.cancelChatGptLogin?.();
  }, []);

  const logout = useCallback(async () => {
    if (!window.grok?.logoutChatGpt) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.grok.logoutChatGpt();
      setStatus(result.status);
      setUsage(null);
      if (!result.ok) {
        setError(
          localizeUiError(result.error ?? null, t, "provider.signOutFailed"),
        );
      }
    } finally {
      setBusy(false);
    }
  }, [t]);

  return { status, usage, busy, error, login, cancelLogin, logout, refresh };
}
