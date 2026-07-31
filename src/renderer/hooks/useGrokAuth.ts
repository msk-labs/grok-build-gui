import { useEffect, useState } from "react";
import type {
  GrokAccount,
  GrokAuthActionResult,
} from "../../electron/preload";
import { useTranslation } from "react-i18next";
import { localizeUiError } from "../lib/uiError";

function unavailableResult(
  error: string,
  notSignedInLabel: string,
): GrokAuthActionResult {
  return {
    ok: false,
    account: {
      loggedIn: false,
      email: null,
      name: null,
      firstName: null,
      lastName: null,
      userId: null,
      teamId: null,
      tier: null,
      planLabel: notSignedInLabel,
      profileImageUrl: null,
      authMode: null,
      expiresAt: null,
    },
    error,
  };
}

export function useGrokAuth() {
  const { t } = useTranslation();
  const [account, setAccount] = useState<GrokAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAccount() {
      try {
        if (!window.grok?.getGrokAccount) {
          throw new Error(t("auth.bridgeUnavailable"));
        }
        const next = await window.grok.getGrokAccount();
        if (!cancelled) setAccount(next);
      } catch (cause) {
        if (!cancelled) {
          setError(
            localizeUiError(
              cause instanceof Error ? cause.message : String(cause),
              t,
            ),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function login(): Promise<GrokAuthActionResult> {
    if (!window.grok?.loginGrok) {
      return unavailableResult(
        t("auth.bridgeUnavailable"),
        t("account.notSignedIn"),
      );
    }
    setSigningIn(true);
    setError(null);
    try {
      const result = await window.grok.loginGrok();
      setAccount(result.account);
      if (!result.ok) {
        setError(localizeUiError(result.error, t, "auth.signInFailed"));
      }
      return result;
    } catch (cause) {
      const message = localizeUiError(
        cause instanceof Error ? cause.message : String(cause),
        t,
      );
      setError(message);
      return {
        ...unavailableResult(
          t("auth.bridgeUnavailable"),
          t("account.notSignedIn"),
        ),
        error: message,
      };
    } finally {
      setSigningIn(false);
    }
  }

  async function cancelLogin(): Promise<void> {
    await window.grok?.cancelGrokLogin?.();
  }

  async function logout(): Promise<GrokAuthActionResult> {
    if (!window.grok?.logoutGrok) {
      return unavailableResult(
        t("auth.bridgeUnavailable"),
        t("account.notSignedIn"),
      );
    }
    const result = await window.grok.logoutGrok();
    setAccount(result.account);
    return result;
  }

  return {
    account,
    loading,
    signingIn,
    error,
    login,
    cancelLogin,
    logout,
  };
}
