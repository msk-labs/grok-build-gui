import "./LoginScreen.css";
import { useTranslation } from "react-i18next";
import appIcon from "../../../../resources/icon.png";

type Props = {
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  onLogin: () => void;
  onCancel: () => void;
};

export function LoginScreen({
  loading,
  signingIn,
  error,
  onLogin,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  return (
    <main className="auth-screen">
      <div className="auth-titlebar" aria-hidden />
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark" aria-hidden>
          <img src={appIcon} alt="" />
        </div>
        <div className="auth-copy">
          <p className="auth-eyebrow">Grok Build GUI</p>
          <h1 id="auth-title">{t("auth.signInTitle")}</h1>
          <p className="auth-description">
            {t("auth.description")}
          </p>
        </div>

        {signingIn ? (
          <div className="auth-progress" role="status" aria-live="polite">
            <span className="auth-spinner" aria-hidden />
            <span>
              {t("auth.completeInBrowser")}
            </span>
          </div>
        ) : null}

        {error && !loading ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="auth-actions">
          <button
            type="button"
            className="auth-primary"
            onClick={onLogin}
            disabled={loading || signingIn}
          >
            {loading
              ? t("auth.checking")
              : signingIn
                ? t("auth.waiting")
                : t("auth.signInWithGrok")}
          </button>
          {signingIn ? (
            <button type="button" className="auth-cancel" onClick={onCancel}>
              {t("common.cancel")}
            </button>
          ) : null}
        </div>

        <p className="auth-privacy">
          {t("auth.privacy")}
        </p>
      </section>
    </main>
  );
}
