import { useTranslation } from "react-i18next";
import type { AppUpdate } from "../../hooks/useAppUpdate";

/** Circumference of the r=9 ring below; kept in sync by hand. */
const RING = 2 * Math.PI * 9;

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

/**
 * Determinate ring. `percent` null renders the full track only, which is what
 * the brief moment between "download clicked" and the first progress event
 * looks like.
 */
function ProgressRing({ percent }: { percent: number | null }) {
  const shown = percent ?? 0;
  return (
    <svg
      className="update-btn-ring"
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden
    >
      <circle className="update-btn-ring-track" cx="11" cy="11" r="9" />
      <circle
        className="update-btn-ring-fill"
        cx="11"
        cy="11"
        r="9"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - shown / 100)}
      />
    </svg>
  );
}

/**
 * Sidebar footer update control. Renders nothing until there is something to
 * act on — an idle or up-to-date app must not carry a permanent chip.
 *
 * One button, three jobs by state: download → watch → install now.
 */
export function UpdateButton({ update }: { update: AppUpdate }) {
  const { t } = useTranslation();
  const status = update.status;
  if (!status) return null;

  if (status.state === "available") {
    return (
      <button
        type="button"
        className="update-btn"
        onClick={() => void update.download()}
        title={t("update.availableHint", { version: status.nextVersion })}
      >
        <DownloadIcon />
        <span className="update-btn-label">{t("update.update")}</span>
      </button>
    );
  }

  if (status.state === "downloading") {
    const percent = Math.round(update.percent ?? 0);
    return (
      <button
        type="button"
        className="update-btn is-downloading"
        disabled
        title={t("update.downloadingHint", { percent })}
      >
        <ProgressRing percent={update.percent} />
        <span className="update-btn-label">{percent}%</span>
      </button>
    );
  }

  if (status.state === "downloaded") {
    // The install itself relaunches; this only exists if auto-install was
    // declined or the relaunch has not happened yet.
    return (
      <button
        type="button"
        className="update-btn is-ready"
        onClick={() => void update.install()}
        title={t("update.restartHint", { version: status.nextVersion })}
      >
        <DownloadIcon />
        <span className="update-btn-label">{t("update.restart")}</span>
      </button>
    );
  }

  return null;
}
