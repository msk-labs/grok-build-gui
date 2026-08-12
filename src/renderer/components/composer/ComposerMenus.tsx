import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { ModelState, PermissionMode } from "../../../electron/preload";
import { groupModels } from "../../lib/modelGroups";
import { ModelIcon } from "../ModelIcon";
import { modelPickerMeta, type ModelPickerTag } from "./modelPickerMeta";
import {
  CaptureIcon,
  CheckIcon,
  ChevronDownIcon,
  EditModelIcon,
  PaperclipIcon,
  PlusIcon,
  ShieldIcon,
} from "./icons";
import {
  PERMISSION_OPTIONS,
  effortOptionsForModel,
  modelChipLabel,
} from "./permissionOptions";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

export type ComposerMenu = "permission" | "model" | "attach" | "context" | null;

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
              <span className="composer-menu-item-desc">{opt.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type HoveredModel = {
  modelId: string;
  top: number;
};

function modelTagLabel(tag: ModelPickerTag, t: TFunction) {
  return tag === "accelerated"
    ? t("composer.modelAccelerated")
    : t("composer.modelFree");
}

export function ModelMenu({
  menu,
  toggleMenu,
  closeMenu,
  disabled,
  models,
  onModelChange,
  onConfigureModels,
}: Common & {
  models: ModelState;
  /** modelId + optional reasoning effort (high | medium | low | …). */
  onModelChange: (modelId: string, reasoningEffort?: string | null) => void;
  onConfigureModels?: () => void;
}) {
  const { t } = useTranslation();
  const [hoveredModel, setHoveredModel] = useState<HoveredModel | null>(null);
  const [detailTop, setDetailTop] = useState(4);
  const menuRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu !== "model") {
      setHoveredModel(null);
      setDetailTop(4);
    }
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
    if (normalized === "none") return t("composer.effortNone");
    if (normalized === "minimal") return t("composer.effortMinimal");
    if (normalized === "low") return t("composer.effortLow");
    if (normalized === "medium") return t("composer.effortMedium");
    if (normalized === "high") return t("composer.effortHigh");
    if (normalized === "xhigh") return t("composer.effortXHigh");
    if (normalized === "max") return t("composer.effortMax");
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
  const autoModel = modelOptions.find((m) => {
    const key = `${m.modelId} ${m.name}`.toLowerCase();
    return key === "auto" || key.startsWith("auto ") || m.modelId === "auto";
  });
  const selectableModels = autoModel
    ? modelOptions.filter((m) => m.modelId !== autoModel.modelId)
    : modelOptions;
  const modelGroups = useMemo(
    () => groupModels(selectableModels),
    [selectableModels],
  );
  const detailModel = hoveredModel
    ? modelOptions.find((m) => m.modelId === hoveredModel.modelId)
    : null;
  const detailMeta = detailModel ? modelPickerMeta(detailModel) : null;

  useLayoutEffect(() => {
    const root = menuRef.current;
    const detail = detailRef.current;
    if (!root || !detail || !hoveredModel || !detailModel) return;

    const rootRect = root.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    const viewportPadding = 8;
    const desiredTop = rootRect.top + hoveredModel.top;
    const minTop = viewportPadding;
    const maxTop = Math.max(
      minTop,
      window.innerHeight - viewportPadding - detailRect.height,
    );
    const clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
    // The flyout may need to rise above the root menu when the composer is
    // close to the bottom edge. The root panel allows visible overflow.
    const nextTop = clampedTop - rootRect.top;

    if (Math.abs(nextTop - detailTop) > 0.5) {
      setDetailTop(nextTop);
    }
  }, [detailModel, detailTop, hoveredModel]);

  function selectModel(modelId: string) {
    const m = modelOptions.find((x) => x.modelId === modelId);
    if (!m) return;
    if (m.supportsReasoningEffort) {
      const opts = effortOptionsForModel(m);
      const nextEffort =
        (currentEffort &&
        opts.some((o) => o.value === currentEffort || o.id === currentEffort)
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

  function selectModelIntensity(modelId: string, value: string) {
    onModelChange(modelId, value);
    closeMenu();
  }

  function hoverModel(
    event: ReactMouseEvent<HTMLButtonElement>,
    modelId: string,
  ) {
    const root = menuRef.current;
    if (!root) return;
    const row = event.currentTarget.getBoundingClientRect();
    const panel = root.getBoundingClientRect();
    const top = row.top - panel.top;
    setDetailTop(Math.max(4, top));
    setHoveredModel({ modelId, top });
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
        <div
          ref={menuRef}
          className="composer-menu composer-menu-model"
          role="menu"
          onMouseLeave={() => setHoveredModel(null)}
        >
          <div className="composer-menu-model-list">
            {autoModel ? (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={autoModel.modelId === models.currentModelId}
                className={`composer-menu-item composer-model-row${
                  autoModel.modelId === models.currentModelId ? " active" : ""
                }`}
                onClick={() => selectModel(autoModel.modelId)}
                onMouseEnter={(event) => hoverModel(event, autoModel.modelId)}
              >
                <span className="composer-menu-item-label model-option">
                  <ModelIcon
                    modelId={autoModel.modelId}
                    name={autoModel.name}
                  />
                  {autoModel.name || t("composer.autoModel")}
                </span>
                {autoModel.modelId === models.currentModelId ? (
                  <CheckIcon />
                ) : null}
              </button>
            ) : null}
            {modelGroups.map((group, groupIndex) => (
              <div key={group.id} role="group" aria-label={t(group.labelKey)}>
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
                  const meta = modelPickerMeta(m);
                  return (
                    <button
                      key={m.modelId}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`composer-menu-item composer-model-row${
                        selected ? " active" : ""
                      }`}
                      onClick={() => selectModel(m.modelId)}
                      onMouseEnter={(event) => hoverModel(event, m.modelId)}
                    >
                      <span className="composer-menu-item-label model-option">
                        <ModelIcon modelId={m.modelId} name={m.name} />
                        <span className="composer-model-name">
                          {m.name || m.modelId}
                        </span>
                        {meta.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`composer-model-tag composer-model-tag-${tag}`}
                          >
                            {modelTagLabel(tag, t)}
                          </span>
                        ))}
                      </span>
                      {meta.rate ? (
                        <span className="composer-model-rate">{meta.rate}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="composer-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="composer-menu-item composer-model-configure"
            onClick={() => {
              closeMenu();
              onConfigureModels?.();
            }}
          >
            <EditModelIcon />
            <span>{t("composer.configureCustomModel")}</span>
          </button>

          {detailModel && detailMeta ? (
            <div
              ref={detailRef}
              className="composer-model-detail"
              style={{ top: detailTop }}
              role="menu"
              aria-label={`${detailModel.name || detailModel.modelId} ${t(
                "composer.reasoningIntensity",
              )}`}
            >
              <strong>{detailModel.name || detailModel.modelId}</strong>
              <p>
                {detailMeta.descriptionKey
                  ? t(detailMeta.descriptionKey)
                  : t("composer.modelDefaultDescription")}
              </p>
              {detailMeta.rate ? (
                <div className="composer-model-detail-rate">
                  <span>{t("composer.consumptionSpeed")}</span>
                  <span>
                    {detailMeta.rate} {t("composer.rateSuffix")}
                  </span>
                </div>
              ) : null}
              {effortOptionsForModel(detailModel).length > 0 ? (
                <div className="composer-model-detail-intensity">
                  <div className="composer-model-detail-title">
                    {t("composer.reasoningIntensity")}
                  </div>
                  {effortOptionsForModel(detailModel).map((option) => {
                    const selected =
                      detailModel.modelId === models.currentModelId &&
                      (option.value === currentEffort ||
                        option.id === currentEffort);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`composer-model-intensity-option${
                          selected ? " active" : ""
                        }`}
                        onClick={() =>
                          selectModelIntensity(
                            detailModel.modelId,
                            option.value,
                          )
                        }
                      >
                        <span>{localizeEffort(option.label)}</span>
                        {selected ? <CheckIcon /> : null}
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
