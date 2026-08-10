import "./ProviderSettings.css";
import { useTranslation } from "react-i18next";
import { formatNextReset } from "../sidebar/usageFormat";
import { ModelIcon } from "../ModelIcon";
import { useProviderSettings } from "./useProviderSettings";

/** Same thresholds as the sidebar account footer. */
function usageTone(usedPercent: number | null): string {
  if (usedPercent === null) return "";
  const remaining = 100 - usedPercent;
  return remaining <= 10 ? " low" : remaining <= 30 ? " mid" : "";
}

/**
 * ChatGPT subscription account: sign in, plan, and the quota windows the
 * upstream reports. Models from this account appear in the normal model picker
 * once the agent reconnects.
 */
export function ProviderSettings() {
  const { t, i18n } = useTranslation();
  const { status, usage, busy, error, login, cancelLogin, logout } =
    useProviderSettings();
  const account = status?.account ?? null;
  const locale = i18n.resolvedLanguage ?? i18n.language;

  return (
    <section className="settings-section" aria-labelledby="settings-providers">
      <h2 id="settings-providers" className="settings-section-title">
        {t("provider.title")}
      </h2>
      <p className="settings-section-desc">{t("provider.description")}</p>

      <div className="settings-card">
        <div className="settings-row">
          <ModelIcon modelId="chatgpt" name="ChatGPT" size={22} />
          <div className="settings-row-text">
            <div className="settings-row-label settings-status-label">
              ChatGPT
              <span
                className={
                  "settings-status" +
                  (account && !account.needsRelogin ? " ready" : "")
                }
              >
                {account
                  ? account.needsRelogin
                    ? t("provider.sessionExpired")
                    : status!.planLabel
                  : t("account.notSignedIn")}
              </span>
            </div>
            <div className="settings-row-hint">
              {account?.email ?? t("provider.signInHint")}
            </div>
          </div>
          {account ? (
            <button
              type="button"
              className="settings-permission-button"
              disabled={busy}
              onClick={() => void logout()}
            >
              {t("account.signOut")}
            </button>
          ) : busy ? (
            <button
              type="button"
              className="settings-permission-button"
              onClick={() => void cancelLogin()}
            >
              {t("common.cancel")}
            </button>
          ) : (
            <button
              type="button"
              className="settings-permission-button"
              onClick={() => void login()}
            >
              {t("provider.signIn")}
            </button>
          )}
        </div>

        {busy && !account ? (
          <div className="settings-inline-notice" role="status">
            {t("provider.waitingForBrowser")}
          </div>
        ) : null}

        {error ? (
          <div className="settings-inline-notice" role="status">
            {error}
          </div>
        ) : null}

        {status?.rejectedPlanLabel ? (
          <div className="settings-inline-notice" role="status">
            {t("provider.planWithoutCodex", {
              plan: status.rejectedPlanLabel,
            })}
          </div>
        ) : null}

        {account?.needsRelogin ? (
          <div className="settings-inline-notice" role="status">
            {t("provider.sessionExpiredHint")}
          </div>
        ) : null}

        {account && !status?.encryptedAtRest ? (
          <div className="settings-inline-notice" role="status">
            {t("provider.plaintextWarning")}
          </div>
        ) : null}

        {account && usage ? (
          usage.ok && usage.windows.length > 0 ? (
            <div className="settings-provider-usage">
              {usage.windows.map((window) => (
                <div key={window.id} className="codex-usage-row">
                  <div className="codex-usage-row-head">
                    <span>{window.label}</span>
                    <span className="codex-usage-pct">
                      {window.usedPercent === null
                        ? "—"
                        : t("account.remaining", {
                            value: Math.round(100 - window.usedPercent),
                          })}
                    </span>
                  </div>
                  <div className="codex-usage-track">
                    <div
                      className={
                        "codex-usage-fill" + usageTone(window.usedPercent)
                      }
                      style={{ width: `${window.usedPercent ?? 0}%` }}
                    />
                  </div>
                  {window.resetsAt ? (
                    <div className="codex-usage-reset">
                      {t("account.nextReset", {
                        value: formatNextReset(window.resetsAt, locale),
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="settings-inline-note">
              {usage.error ?? t("account.noUsage")}
            </div>
          )
        ) : null}

        <div className="settings-inline-note">{t("provider.tosNotice")}</div>
      </div>
    </section>
  );
}
