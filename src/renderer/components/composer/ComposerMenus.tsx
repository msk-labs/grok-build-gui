import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { ModelState, PermissionMode } from "../../../electron/preload";
import { groupModels } from "../../lib/modelGroups";
import { ModelIcon } from "../ModelIcon";
import {
  CaptureIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PaperclipIcon,
  PlusIcon,
  ShieldIcon,
} from "./icons";
import {
  PERMISSION_OPTIONS,
  cleanEffortLabel,
  effortOptionsForModel,
  modelChipLabel,
} from "./permissionOptions";
import { useTranslation } from "react-i18next";

export type ComposerMenu =
  | "permission"
  | "model"
  | "attach"
  | "context"
  | null;

type Common = {
  menu: ComposerMenu;
  toggleMenu: (which: NonNullable<ComposerMenu>, e: ReactMouseEvent) => void;
  closeMenu: () => void;
  disabled: boolean;
};

export function AttachMenu({
  menu,
  toggleMenu,
  closeMenu,
  disabled,
  onCaptureScreenshot,
  onChooseFiles,
}: Common & {
  onCaptureScreenshot?: (
    mode: "region" | "screen" | "window",
    options?: { keepParentVisible?: boolean },
  ) => void;
  onChooseFiles?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="composer-chip-wrap">
      <button
        type="button"
        className={`composer-icon-btn${menu === "attach" ? " open" : ""}`}
        onClick={(e) => toggleMenu("attach", e)}
        disabled={disabled}
        title={t("composer.addAttachment")}
        aria-label={t("composer.addAttachment")}
        aria-haspopup="menu"
        aria-expanded={menu === "attach"}
      >
        <PlusIcon />
      </button>
      {menu === "attach" ? (
        <div className="composer-menu composer-menu-attach" role="menu">
          {onChooseFiles ? (
            <button
              type="button"
              role="menuitem"
              className="composer-menu-item"
              onClick={() => {
                closeMenu();
                // Defer so the menu unmounts before the OS dialog steals focus.
                window.setTimeout(() => onChooseFiles(), 0);
              }}
            >
              <span className="composer-menu-item-row">
                <PaperclipIcon />
                <span className="composer-menu-item-label">
                  {t("composer.attachFiles")}
                </span>
              </span>
            </button>
          ) : null}
          {onCaptureScreenshot ? (
            <button
              type="button"
              role="menuitem"
              className="composer-menu-item"
              onClick={(e) => {
                closeMenu();
                // Hidden: Ctrl+click keeps this app window visible during capture.
                onCaptureScreenshot("region", {
                  keepParentVisible: e.ctrlKey,
                });
              }}
            >
              <span className="composer-menu-item-row">
                <CaptureIcon />
                <span className="composer-menu-item-label">
                  {t("composer.captureRegion")}
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PermissionMenu({
  menu,
  toggleMenu,
  closeMenu,
  disabled,
  permissionMode,
  onPermissionModeChange,
}: Common & {
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
}) {
  const { t } = useTranslation();
  const permissionOptions = PERMISSION_OPTIONS.map((opt) => {
    if (opt.id === "ask") {
      return {
        ...opt,
        label: t("composer.permissionAsk"),
        shortLabel: t("composer.permissionAsk"),
        description: t("composer.permissionAskDesc"),
      };
    }
    if (opt.id === "auto") {
      return {
        ...opt,
        label: t("composer.permissionAuto"),
        shortLabel: t("composer.permissionAuto"),
        description: t("composer.permissionAutoDesc"),
      };
    }
    return {
      ...opt,
      label: t("composer.permissionFull"),
      shortLabel: t("composer.permissionFull"),
      description: t("composer.permissionFullDesc"),
    };
  });
  const perm =
    permissionOptions.find((o) => o.id === permissionMode) ??
    permissionOptions[0]!;

  return (
    <div className="composer-chip-wrap">
      <button
        type="button"
        className={`composer-chip${menu === "permission" ? " open" : ""}`}
        onClick={(e) => toggleMenu("permission", e)}
        disabled={disabled}
        title={t("composer.permissionHelp")}
        aria-haspopup="menu"
        aria-expanded={menu === "permission"}
      >
        <ShieldIcon />
        <span className="composer-chip-label">{perm.shortLabel}</span>
        <ChevronDownIcon />
      </button>
      {menu === "permission" ? (
        <div className="composer-menu" role="menu">
          <div className="composer-menu-title">{t("composer.permissions")}</div>
          {permissionOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="menuitemradio"
              aria-checked={opt.id === permissionMode}
              className={`composer-menu-item${
                opt.id === permissionMode ? " active" : ""
              }`}
              onClick={() => {
                onPermissionModeChange(opt.id);
                closeMenu();
              }}
            >
              <span className="composer-menu-item-label">{opt.label}</span>
              <span className="composer-menu-item-desc">
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Which flyout is open beside a root menu row (click to expand). */
/** Models render inline; only reasoning effort still nests. */
type ModelSubmenu = "intensity" | null;

export function ModelMenu({
  menu,
  toggleMenu,
  closeMenu,
  disabled,
  models,
  onModelChange,
}: Common & {
  models: ModelState;
  /** modelId + optional reasoning effort (high | medium | low | …). */
  onModelChange: (modelId: string, reasoningEffort?: string | null) => void;
}) {
  const { t } = useTranslation();
  const [openSub, setOpenSub] = useState<ModelSubmenu>(null);

  useEffect(() => {
    if (menu !== "model") setOpenSub(null);
  }, [menu]);

  const currentModel = models.availableModels.find(
    (m) => m.modelId === models.currentModelId,
  );
  const currentEffort = models.currentReasoningEffort;
  const intensityOptions = effortOptionsForModel(currentModel);
  const showIntensity = intensityOptions.length > 0;
  const rawIntensityLabel = intensityOptions.find(
    (o) => o.value === currentEffort || o.id === currentEffort,
  )?.label;
  const localizeEffort = (value?: string | null) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized === "high") return t("composer.effortHigh");
    if (normalized === "medium") return t("composer.effortMedium");
    if (normalized === "low") return t("composer.effortLow");
    return value || "";
  };
  const intensityLabel = localizeEffort(rawIntensityLabel || currentEffort);
  const chipLabel = modelChipLabel(
    models.currentModelId,
    currentModel?.name,
    showIntensity ? currentEffort : null,
    intensityLabel,
  );
  const modelOptions = models.availableModels;
  const modelGroups = useMemo(() => groupModels(modelOptions), [modelOptions]);
  const intensityValue =
    intensityLabel ||
    (currentEffort ? cleanEffortLabel(currentEffort) : "—");

  function toggleSub(which: NonNullable<ModelSubmenu>) {
    setOpenSub((cur) => (cur === which ? null : which));
  }

  function selectModel(modelId: string) {
    const m = modelOptions.find((x) => x.modelId === modelId);
    if (!m) return;
    if (m.supportsReasoningEffort) {
      const opts = effortOptionsForModel(m);
      const nextEffort =
        (currentEffort &&
        opts.some(
          (o) => o.value === currentEffort || o.id === currentEffort,
        )
          ? currentEffort
          : null) ??
        m.defaultReasoningEffort ??
        opts.find((o) => o.default)?.value ??
        opts[0]?.value ??
        null;
      onModelChange(m.modelId, nextEffort);
    } else {
      onModelChange(m.modelId, null);
    }
    closeMenu();
  }

  function selectIntensity(value: string) {
    if (!models.currentModelId) return;
    onModelChange(models.currentModelId, value);
    closeMenu();
  }

  return (
    <div className="composer-chip-wrap composer-chip-wrap-end">
      <button
        type="button"
        className={`composer-chip${menu === "model" ? " open" : ""}`}
        onClick={(e) => toggleMenu("model", e)}
        disabled={disabled || modelOptions.length === 0}
        title={chipLabel}
        aria-haspopup="menu"
        aria-expanded={menu === "model"}
      >
        {models.currentModelId ? (
          <ModelIcon
            modelId={models.currentModelId}
            name={currentModel?.name}
            size={14}
          />
        ) : null}
        <span className="composer-chip-label">{chipLabel}</span>
        <ChevronDownIcon />
      </button>
      {menu === "model" && modelOptions.length > 0 ? (
        <div className="composer-menu composer-menu-model" role="menu">
          {/* Models sit at the top level: switching them is why this menu opens. */}
          <div className="composer-menu-model-list">
                {modelGroups.map((group, groupIndex) => (
                  <div key={group.id} role="group" aria-label={t(group.labelKey)}>
                    {/* A single group needs no heading — it is the whole list. */}
                    {modelGroups.length > 1 ? (
                      <>
                        {groupIndex > 0 ? (
                          <div className="composer-menu-divider" />
                        ) : null}
                        <div className="composer-menu-title">
                          {t(group.labelKey)}
                        </div>
                      </>
                    ) : null}
                    {group.models.map((m) => {
                      const selected = m.modelId === models.currentModelId;
                      return (
                        <button
                          key={m.modelId}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`composer-menu-item${
                            selected ? " active" : ""
                          }`}
                          onClick={() => selectModel(m.modelId)}
                        >
                          <span className="composer-menu-item-label model-option">
                            <ModelIcon modelId={m.modelId} name={m.name} />
                            {m.name || m.modelId}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
          </div>

          {showIntensity && models.currentModelId ? (
            <div
              className={`composer-menu-submenu-wrap${
                openSub === "intensity" ? " open" : ""
              }`}
            >
              <div className="composer-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className={`composer-menu-item${
                  openSub === "intensity" ? " open" : ""
                }`}
                aria-haspopup="menu"
                aria-expanded={openSub === "intensity"}
                onClick={() => toggleSub("intensity")}
              >
                <span className="composer-menu-item-row">
                  <span className="composer-menu-item-label">
                    {t("composer.reasoningIntensity")}
                  </span>
                  <span className="composer-menu-item-value">
                    {intensityValue}
                    <ChevronRightIcon />
                  </span>
                </span>
              </button>
              {openSub === "intensity" ? (
                <div
                  className="composer-menu composer-menu-submenu"
                  role="menu"
                >
                  {intensityOptions.map((opt) => {
                    const selected =
                      opt.value === currentEffort ||
                      opt.id === currentEffort;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`composer-menu-item${
                          selected ? " active" : ""
                        }`}
                        onClick={() => selectIntensity(opt.value)}
                      >
                        <span className="composer-menu-item-label">
                          {localizeEffort(opt.label)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
