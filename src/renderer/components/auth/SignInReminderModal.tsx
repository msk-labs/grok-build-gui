import React from "react";
import { useTranslation } from "react-i18next";

void React;

type Props = {
  open: boolean;
  signingIn: boolean;
  error: string | null;
  onCancel: () => void;
  onLogin: () => void;
};

export function SignInReminderModal({
  open,
  signingIn,
  error,
  onCancel,
  onLogin,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal auth-reminder-modal">
        <h2>{t("auth.sendReminderTitle")}</h2>
        <p className="modal-desc">{t("auth.sendReminderDescription")}</p>
        {error ? (
          <p className="auth-reminder-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={signingIn}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onLogin}
            disabled={signingIn}
          >
            {signingIn ? t("auth.waiting") : t("auth.signInWithGrok")}
          </button>
        </div>
      </div>
    </div>
  );
}
