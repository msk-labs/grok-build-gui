import { useTranslation } from "react-i18next";
import type { AppUpdate } from "../../hooks/useAppUpdate";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Settings → Updates. The sidebar button is the primary path; this panel is
 * for "is there anything?" on demand, and for saying plainly when updating
 * cannot work at all (dev run, or a build with no release feed).
 */
export function UpdateSettings({ update }: { update: AppUpdate }) {
  const { t } = useTranslation();
  const status = update.status;

  function detail(): string {
    if (!status) return t("update.stateIdle");
    switch (status.state) {
      case "unsupported":
        return status.reason === "dev"
          ? t("update.stateDev")
          : t("update.stateNoFeed");
      case "checking":
        return t("update.stateChecking");
      case "none":
        return t("update.stateLatest");
      case "available":
        return t("update.stateAvailable", { version: status.nextVersion });
      case "downloading":
        return t("update.stateDownloading", {
          percent: Math.round(status.percent),
          transferred: formatBytes(status.transferred),
          total: formatBytes(status.total),
        });
      case "downloaded":
        return t("update.stateDownloaded", { version: status.nextVersion });
      case "error":
        return status.message;
      default:
        return t("update.stateIdle");
    }
  }

  const unsupported = status?.state === "unsupported";
  const busy = status?.state === "checking" || status?.state === "downloading";

  return (
    <section className="settings-section">
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">{t("update.current")}</div>
            <div
              className={
                status?.state === "error"
                  ? "settings-row-hint settings-row-hint-error"
                  : "settings-row-hint"
              }
            >
              {status ? `v${status.version} · ${detail()}` : detail()}
            </div>
          </div>
          {status?.state === "available" ? (
            <button
              type="button"
              className="settings-permission-button"
              onClick={() => void update.download()}
            >
              {t("update.download")}
            </button>
          ) : status?.state === "downloaded" ? (
            <button
              type="button"
              className="settings-permission-button allowed"
              onClick={() => void update.install()}
            >
              {t("update.restart")}
            </button>
          ) : (
            <button
              type="button"
              className="settings-permission-button"
              disabled={busy || unsupported}
              onClick={() => void update.check()}
            >
              {status?.state === "checking"
                ? t("update.checking")
                : t("update.check")}
            </button>
          )}
        </div>

        <div className="settings-inline-note">{t("update.autoHint")}</div>
      </div>
    </section>
  );
}
