import { useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type {
  ConnectionState,
  GrokAccount,
  GrokAuthActionResult,
  GrokUsage,
} from "../../../electron/preload";
import {
  accountInitials,
  avatarHue,
  formatLimitLabel,
  formatNextReset,
} from "./usageFormat";
import { useTranslation } from "react-i18next";
import { localizeUiError } from "../../lib/uiError";
import type { AppUpdate } from "../../hooks/useAppUpdate";
import { UpdateButton } from "./UpdateButton";

/**
 * Grok subscription usage row — mirrors console /usage:
 *   Weekly limit: 11%
 *   89% remaining
 *   Next reset: July 21, 18:03
 */
function SubscriptionUsageBar({
  usedPercent,
  periodType,
  periodEnd,
}: {
  usedPercent: number;
  periodType: string | null;
  periodEnd: string | null;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  // Floor to match backend SpendingLimiter truncation (99.994% → 99%).
  const used = Math.max(0, Math.min(100, Math.floor(usedPercent)));
  const remaining = Math.max(0, 100 - used);
  const reset = formatNextReset(periodEnd, language);
  return (
    <div className="codex-usage-row">
      <div className="codex-usage-row-head">
        <span>{formatLimitLabel(periodType, t)}</span>
        <span className="codex-usage-pct">{used}%</span>
      </div>
      <div className="codex-usage-track" aria-hidden>
        <div
          className={`codex-usage-fill${remaining <= 10 ? " low" : remaining <= 30 ? " mid" : ""}`}
          style={{ width: `${used}%` }}
        />
      </div>
      <div className="codex-usage-reset">
        {t("account.remaining", { value: remaining })}
      </div>
      {reset ? (
        <div className="codex-usage-reset">
          {t("account.nextReset", { value: reset })}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  state: ConnectionState;
  fault: string | null;
  onRetryConnect: () => void;
  /** Called when account menu opens so parent can close session menus. */
  onOpenChange?: (open: boolean) => void;
  menuOpen: boolean;
  accountMenuRef: RefObject<HTMLDivElement | null>;
  /** Open Settings main view (replaces chat, Codex-style). */
  onOpenSettings?: () => void;
  account: GrokAccount;
  onLogin: () => Promise<GrokAuthActionResult>;
  onLogout: () => Promise<GrokAuthActionResult>;
  /** Update control sits beside the account chip; renders only when actionable. */
  update: AppUpdate;
};

export function AccountFooter({
  state,
  fault,
  onRetryConnect,
  onOpenChange,
  menuOpen,
  accountMenuRef,
  onOpenSettings,
  account: grokAccount,
  onLogin,
  onLogout,
  update,
}: Props) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<GrokUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [openingConsole, setOpeningConsole] = useState(false);

  async function toggleAccountMenu(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !menuOpen;
    onOpenChange?.(next);
    if (!next || !grokAccount.loggedIn || !window.grok?.getGrokUsage) return;

    setUsageLoading(true);
    try {
      const result = await window.grok.getGrokUsage();
      setUsage(result);
    } catch (err) {
      setUsage({
        ok: false,
        email: grokAccount?.email ?? null,
        planLabel: grokAccount?.planLabel ?? t("account.unknownPlan"),
        tier: grokAccount?.tier ?? null,
        creditUsagePercent: null,
        periodType: null,
        periodStart: null,
        periodEnd: null,
        productUsage: [],
        prepaidBalance: null,
        onDemandCap: null,
        onDemandUsed: null,
        isUnifiedBillingUser: false,
        monthlyUsedCents: null,
        monthlyLimitCents: null,
        monthlyPeriodStart: null,
        monthlyPeriodEnd: null,
        fetchedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUsageLoading(false);
    }
  }

  async function handleLogin(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoginLoading(true);
    setLogoutError(null);
    try {
      const result = await onLogin();
      if (!result.ok) {
        setLogoutError(localizeUiError(result.error, t, "auth.signInFailed"));
      } else {
        onOpenChange?.(false);
      }
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        t("account.signOutConfirm"),
      )
    ) {
      return;
    }
    setLogoutLoading(true);
    setLogoutError(null);
    try {
      const result = await onLogout();
      if (!result.ok) {
        setLogoutError(
          localizeUiError(result.error, t, "account.signOutFailed"),
        );
      }
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLogoutLoading(false);
    }
  }

  async function handleOpenConsole(e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (openingConsole || !window.grok?.openGrokTui) return;
    setOpeningConsole(true);
    try {
      const result = await window.grok.openGrokTui();
      if (!result.ok) {
        window.alert(
          t("account.openConsoleFailed", {
            error: result.error || t("nav.connectionUnavailable"),
          }),
        );
        return;
      }
      onOpenChange?.(false);
    } catch (cause) {
      window.alert(
        t("account.openConsoleFailed", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setOpeningConsole(false);
    }
  }

  const displayName =
    grokAccount?.name?.trim() ||
    grokAccount?.email ||
    (grokAccount?.loggedIn === false
      ? t("account.notSignedIn")
      : t("account.account"));
  const planLabel =
    usage?.planLabel || grokAccount?.planLabel || t("account.unknownPlan");
  const initials = accountInitials(
    grokAccount?.name ?? null,
    grokAccount?.email ?? null,
  );
  const hueSeed = grokAccount?.email || grokAccount?.name || "grok";
  const hue = avatarHue(hueSeed);

  return (
    <div className="sidebar-footer">
      {fault || state.status === "connecting" ? (
        state.status === "connecting" ? (
          <div className="status-chip">
            <span className="status-dot connecting" />
            <span>{t("account.connecting")}</span>
          </div>
        ) : (
          <>
            <div className="status-chip fault">
              <span className="status-dot error" />
              <span className="status-fault-text" title={fault ?? undefined}>
                {fault}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={onRetryConnect}
            >
              {t("account.retryConnect")}
            </button>
          </>
        )
      ) : null}

      <div className="sidebar-footer-row">
      <div
        className={`codex-account${menuOpen ? " open" : ""}`}
        ref={accountMenuRef}
      >
        <button
          type="button"
          className="codex-account-btn"
          onClick={(e) => void toggleAccountMenu(e)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={grokAccount?.email || t("account.account")}
        >
          <span
            className="codex-account-avatar"
            style={{
              background: `linear-gradient(145deg, hsl(${hue} 48% 42%), hsl(${(hue + 28) % 360} 52% 32%))`,
            }}
            aria-hidden
          >
            {initials}
          </span>
          <span className="codex-account-meta">
            <span className="codex-account-name">{displayName}</span>
          </span>
        </button>

        {menuOpen ? (
          <div className="codex-account-menu" role="menu">
            <div className="codex-account-menu-header">
              <div className="codex-account-menu-email">
                {usage?.email || grokAccount?.email || "—"}
              </div>
              <div className="codex-account-menu-plan">{planLabel}</div>
            </div>

            {!grokAccount.loggedIn ? (
              <div className="codex-account-menu-status">
                {t("account.guestModelHint")}
              </div>
            ) : usageLoading ? (
              <div className="codex-account-menu-status">
                {t("account.loadingUsage")}
              </div>
            ) : usage && !usage.ok ? (
              <div className="codex-account-menu-status error">
                {localizeUiError(
                  usage.error,
                  t,
                  "account.couldNotLoadUsage",
                )}
              </div>
            ) : usage ? (
              <div className="codex-account-menu-body">
                {usage.creditUsagePercent != null ? (
                  <SubscriptionUsageBar
                    usedPercent={usage.creditUsagePercent}
                    periodType={usage.periodType}
                    periodEnd={usage.periodEnd}
                  />
                ) : (
                  <div className="codex-account-menu-status">
                    {t("account.noUsage")}
                  </div>
                )}

                {usage.error ? (
                  <div className="codex-account-menu-status">
                    {localizeUiError(usage.error, t)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="codex-account-menu-status">
                {t("account.clickLoadUsage")}
              </div>
            )}

            <div className="codex-account-menu-actions">
              {logoutError ? (
                <div className="codex-account-menu-status error">
                  {logoutError}
                </div>
              ) : null}
              {!grokAccount.loggedIn ? (
                <button
                  type="button"
                  role="menuitem"
                  className="codex-account-menu-item"
                  onClick={(e) => void handleLogin(e)}
                  disabled={loginLoading}
                >
                  {loginLoading ? t("auth.waiting") : t("auth.signInWithGrok")}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="codex-account-menu-item"
                onClick={(e) => void handleOpenConsole(e)}
                disabled={openingConsole || !window.grok?.openGrokTui}
                title={t("account.openConsoleHint")}
              >
                {openingConsole
                  ? t("account.openingConsole")
                  : t("account.console")}
              </button>
              {onOpenSettings ? (
                <button
                  type="button"
                  role="menuitem"
                  className="codex-account-menu-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenChange?.(false);
                    onOpenSettings();
                  }}
                >
                  {t("common.settings")}
                </button>
              ) : null}
              {grokAccount.loggedIn ? (
                <button
                  type="button"
                  role="menuitem"
                  className="codex-account-menu-item"
                  onClick={(e) => void handleLogout(e)}
                  disabled={logoutLoading}
                >
                  {logoutLoading
                    ? t("account.signingOut")
                    : t("account.signOut")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

        <UpdateButton update={update} />
      </div>
    </div>
  );
}
