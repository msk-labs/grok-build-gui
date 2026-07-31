import { useCallback, useEffect, useState } from "react";
import type { ComputerUseStatus } from "../../../electron/preload";
import { useTranslation } from "react-i18next";
import { localizeUiError } from "../../lib/uiError";

export type ComputerUsePermissionCheckState =
  | "idle"
  | "checking"
  | "allowed";

export function useComputerUseSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [permissionCheckState, setPermissionCheckState] =
    useState<ComputerUsePermissionCheckState>("idle");
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<ComputerUseStatus>) => {
      setBusy(true);
      try {
        const next = await action();
        setStatus(next);
        return next;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!window.grok?.getComputerUseStatus) return;
    void run(() => window.grok!.getComputerUseStatus());
    return window.grok.onComputerUseStatus?.((next) => setStatus(next));
  }, [run]);

  const checkPermissions = useCallback(async () => {
    if (!window.grok?.checkComputerUsePermissions) return;
    setPermissionCheckState("checking");
    setPermissionError(null);
    try {
      const result = await window.grok.checkComputerUsePermissions();
      if (!result.ok) {
        setPermissionCheckState("idle");
        setPermissionError(
          localizeUiError(result.error, t, "computer.permissionCheckFailed"),
        );
        return;
      }
      setPermissionCheckState(result.allowed ? "allowed" : "idle");
    } catch (error) {
      setPermissionCheckState("idle");
      setPermissionError(
        localizeUiError(
          error instanceof Error ? error.message : null,
          t,
          "computer.permissionCheckFailed",
        ),
      );
    }
  }, [t]);

  return {
    status,
    busy,
    permissionCheckState,
    permissionError,
    checkPermissions,
    setEnabled: (enabled: boolean) =>
      window.grok?.setComputerUseEnabled
        ? run(() => window.grok!.setComputerUseEnabled(enabled))
        : Promise.resolve(null),
  };
}
