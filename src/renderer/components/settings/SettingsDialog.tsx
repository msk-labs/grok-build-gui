import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TerminalShellOption } from "../../../electron/terminalShell";
import type { GuiSettings } from "../../lib/guiSettings";
import { sttLanguageSettingOptions } from "../../lib/sttLanguage";
import { ComputerUseSettings } from "./ComputerUseSettings";
import { ProviderSettings } from "./ProviderSettings";
import { ModelEndpointSettings } from "./ModelEndpointSettings";
import { UpdateSettings } from "./UpdateSettings";
import type { AppUpdate } from "../../hooks/useAppUpdate";
import {
  AppearanceIcon,
  CloseIcon,
  ComputerIcon,
  InterfaceIcon,
  ProviderIcon,
  UpdateIcon,
  VoiceIcon,
} from "./settingsIcons";

export type SettingsDialogProps = {
  open: boolean;
  settings: GuiSettings;
  onChange: (next: GuiSettings) => void;
  /** Dismiss (Escape / backdrop / close button). */
  onClose: () => void;
  update: AppUpdate;
};

/** `as const` keeps `labelKey` literal so the typed `t()` keys still check. */
const SECTIONS = [
  { id: "interface", labelKey: "settings.interface", Icon: InterfaceIcon },
  { id: "appearance", labelKey: "settings.appearance", Icon: AppearanceIcon },
  { id: "voice", labelKey: "settings.voice", Icon: VoiceIcon },
  { id: "providers", labelKey: "provider.title", Icon: ProviderIcon },
  { id: "computer", labelKey: "computer.title", Icon: ComputerIcon },
  { id: "update", labelKey: "update.title", Icon: UpdateIcon },
] as const satisfies readonly {
  id: string;
  labelKey: string;
  Icon: () => ReactElement;
}[];

type SectionId = (typeof SECTIONS)[number]["id"];

const STT_LANGUAGE_OPTIONS = sttLanguageSettingOptions();

/** Language names rendered in the reader's own locale. */
function localizedSttOptions(language: string, t: TFunction<"translation">) {
  const names = new Intl.DisplayNames([language], { type: "language" });
  return STT_LANGUAGE_OPTIONS.map((option) => ({
    ...option,
    label:
      option.value === "auto"
        ? t("language.system")
        : option.value === "zh"
          ? names.of("zh-CN") ?? option.label
          : names.of(option.value) ?? option.label,
  }));
}

/**
 * Settings as a modal child window: category rail on the left, the active
 * category's rows on the right. Replaces the former full-page view so opening
 * settings no longer tears down chat, terminals or the split panels.
 */
export function SettingsDialog({
  open,
  settings,
  onChange,
  onClose,
  update,
}: SettingsDialogProps) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<SectionId>("interface");
  const [terminalShells, setTerminalShells] = useState<TerminalShellOption[]>([
    { value: "system", label: t("settings.terminalShellSystem") },
  ]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const language = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Escape must work before the user clicks anything inside.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Probe the host's shells only once settings is actually opened.
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void window.grok
      ?.listTerminalShells?.()
      .then((options) => {
        if (!disposed && options.length > 0) setTerminalShells(options);
      })
      .catch(() => {
        // Keep the safe system-default option when host detection fails.
      });
    return () => {
      disposed = true;
    };
  }, [open]);

  if (!open) return null;

  function patch(partial: Partial<GuiSettings>) {
    onChange({ ...settings, ...partial });
  }

  const interfaceLanguageOptions = [
    { value: "system", label: t("language.system") },
    { value: "en", label: t("language.english") },
    { value: "zh-CN", label: t("language.chineseSimplified") },
  ] as const;

  return (
    <div
      className="modal-backdrop settings-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        ref={dialogRef}
        tabIndex={-1}
      >
        <nav className="settings-dialog-nav" aria-label={t("settings.title")}>
          {SECTIONS.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              type="button"
              className={
                "settings-dialog-nav-item" +
                (section === id ? " is-active" : "")
              }
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="settings-dialog-main">
          <header className="settings-dialog-header">
            <div>
              <h1 className="settings-dialog-title">{t("settings.title")}</h1>
              <p className="settings-dialog-subtitle">
                {t("settings.subtitle")}
              </p>
            </div>
            <button
              type="button"
              className="settings-dialog-close"
              onClick={onClose}
              title={t("settings.closeEsc")}
              aria-label={t("settings.close")}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="settings-dialog-body">
            {section === "interface" ? (
              <section className="settings-section">
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <div className="settings-row-label">
                        {t("settings.interfaceLanguage")}
                      </div>
                      <div className="settings-row-hint">
                        {t("settings.interfaceLanguageHint")}
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      aria-label={t("settings.interfaceLanguage")}
                      value={settings.uiLanguage}
                      onChange={(e) =>
                        patch({
                          uiLanguage: e.target
                            .value as GuiSettings["uiLanguage"],
                        })
                      }
                    >
                      {interfaceLanguageOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            ) : null}

            {section === "appearance" ? (
              <section className="settings-section">
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <div className="settings-row-label">
                        {t("settings.terminalTheme")}
                      </div>
                      <div className="settings-row-hint">
                        {t("settings.terminalThemeHint")}
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      aria-label={t("settings.terminalTheme")}
                      value={settings.terminalTheme}
                      onChange={(e) =>
                        patch({
                          terminalTheme: e.target
                            .value as GuiSettings["terminalTheme"],
                        })
                      }
                    >
                      <option value="light">
                        {t("settings.terminalThemeLight")}
                      </option>
                      <option value="dark">
                        {t("settings.terminalThemeDark")}
                      </option>
                    </select>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-text">
                      <div className="settings-row-label">
                        {t("settings.terminalShell")}
                      </div>
                      <div className="settings-row-hint">
                        {t("settings.terminalShellHint")}
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      aria-label={t("settings.terminalShell")}
                      /* A shell saved on another host may not exist here. */
                      value={
                        terminalShells.some(
                          (option) => option.value === settings.terminalShell,
                        )
                          ? settings.terminalShell
                          : "system"
                      }
                      onChange={(e) =>
                        patch({
                          terminalShell: e.target
                            .value as GuiSettings["terminalShell"],
                        })
                      }
                    >
                      {terminalShells.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.value === "system"
                            ? t("settings.terminalShellSystem")
                            : option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            ) : null}

            {section === "voice" ? (
              <section className="settings-section">
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-text">
                      <div className="settings-row-label">
                        {t("settings.speechLanguage")}
                      </div>
                      <div className="settings-row-hint">
                        {t("settings.speechLanguageHint")}
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      aria-label={t("settings.speechLanguage")}
                      value={settings.voiceSttLanguage}
                      onChange={(e) =>
                        patch({ voiceSttLanguage: e.target.value })
                      }
                    >
                      {localizedSttOptions(language, t).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            ) : null}

            {section === "providers" ? (
              <>
                <ProviderSettings />
                <ModelEndpointSettings />
              </>
            ) : null}

            {section === "computer" ? <ComputerUseSettings /> : null}

            {section === "update" ? (
              <UpdateSettings update={update} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
