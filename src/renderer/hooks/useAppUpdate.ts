/**
 * App update state for the sidebar button and the settings panel.
 *
 * Status is owned by the main process and pushed over `update:status`; this
 * hook only mirrors it and forwards the three user actions. The initial
 * `getUpdateStatus()` matters because the startup check can land before the
 * renderer subscribes.
 */
import { useCallback, useEffect, useState } from "react";
import type { UpdateStatus } from "../../electron/preload";

export type AppUpdate = {
  status: UpdateStatus | null;
  /** An update the user could act on right now. */
  actionable: boolean;
  /** 0–100 while downloading, else null. */
  percent: number | null;
  checking: boolean;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
};

export function useAppUpdate(): AppUpdate {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!window.grok?.onUpdateStatus) return;
    void window.grok.getUpdateStatus?.().then((initial) => {
      // A push that arrived first is fresher than this reply — do not clobber.
      setStatus((prev) => prev ?? initial);
    });
    return window.grok.onUpdateStatus(setStatus);
  }, []);

  const check = useCallback(async () => {
    await window.grok?.checkForUpdates?.();
  }, []);

  const download = useCallback(async () => {
    await window.grok?.downloadUpdate?.();
  }, []);

  const install = useCallback(async () => {
    await window.grok?.installUpdate?.();
  }, []);

  return {
    status,
    actionable:
      status?.state === "available" ||
      status?.state === "downloading" ||
      status?.state === "downloaded",
    percent: status?.state === "downloading" ? status.percent : null,
    checking: status?.state === "checking",
    check,
    download,
    install,
  };
}
