import "./ComputerUseSettings.css";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useComputerUseSettings } from "./useComputerUseSettings";
import { localizeUiError } from "../../lib/uiError";

function statusLabel(
  status: ReturnType<typeof useComputerUseSettings>["status"],
  t: TFunction<"translation">,
): string {
  if (!status) return t("computer.checking");
  if (status.ready) return t("computer.ready");
  if (!status.available) {
    return status.enabled ? t("computer.missing") : t("computer.notPrepared");
  }
  if (!status.compatible) return t("computer.incompatible");
  return t("computer.disabled");
}

function sourceLabel(source: NonNullable<
  ReturnType<typeof useComputerUseSettings>["status"]
>["source"], t: TFunction<"translation">): string {
  if (source === "bundled") return t("computer.bundled");
  if (source === "project") return t("computer.project");
  return t("computer.unknown");
}

export function ComputerUseSettings() {
  const { t } = useTranslation();
  const {
    status,
    busy,
    permissionCheckState,
    permissionError,
    checkPermissions,
    setEnabled,
  } = useComputerUseSettings();

  return (
    <section className="settings-section" aria-labelledby="settings-computer-use">
      <h2 id="settings-computer-use" className="settings-section-title">
        {t("computer.title")}
      </h2>
      <p className="settings-section-desc">
        {t("computer.description")}
      </p>

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label settings-status-label">
              Open Computer Use
              <span
                className={
                  "settings-status" + (status?.ready ? " ready" : "")
                }
              >
                {statusLabel(status, t)}
              </span>
            </div>
            <div className="settings-row-hint">
              {status?.version
                ? t("computer.versionDetail", {
                    version: status.version,
                    source: sourceLabel(status.source, t),
                    range: status.supportedRange,
                  })
                : t("computer.supportedVersions", {
                    range: status?.supportedRange ?? ">=0.2.1 <0.3.0",
                  })}
            </div>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={status?.enabled ?? false}
              disabled={busy || !status}
              onChange={(event) => void setEnabled(event.target.checked)}
            />
            <span aria-hidden="true" />
            <span className="sr-only">{t("computer.enable")}</span>
          </label>
        </div>

        {status?.error ? (
          <div className="settings-inline-notice" role="status">
            {localizeUiError(status.error, t)}
          </div>
        ) : null}

        {!status?.available ? (
          <div className="settings-inline-notice">
            {t("computer.prepareHint", {
              command: "npm run artifact:computer-use",
            })}
          </div>
        ) : null}

        {status?.available && status.permissionsRequired ? (
          <div className="settings-permission-check">
            <span>{t("computer.macPermissions")}</span>
            <button
              type="button"
              className={
                "settings-permission-button" +
                (permissionCheckState === "allowed" ? " allowed" : "")
              }
              disabled={permissionCheckState === "checking"}
              onClick={() => void checkPermissions()}
            >
              {permissionCheckState === "checking"
                ? t("computer.checkingPermissions")
                : permissionCheckState === "allowed"
                  ? t("computer.permissionsAllowed")
                  : t("computer.checkPermissions")}
            </button>
          </div>
        ) : null}

        {permissionError ? (
          <div className="settings-inline-notice" role="status">
            {permissionError}
          </div>
        ) : null}

        <div className="settings-inline-note">
          {t("computer.applyHint", { command: "/computer <task>" })}
        </div>
      </div>
    </section>
  );
}
