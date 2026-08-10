import "./EndpointDialog.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApiBackend,
  CustomEndpoint,
  CustomEndpointInput,
  DiscoveredModel,
  EndpointPreset,
} from "../../../electron/preload";
import { ModelIcon } from "../ModelIcon";

const DEFAULT_CONTEXT_WINDOW = 128_000;

export type EndpointDialogProps = {
  presets: EndpointPreset[];
  /** Existing endpoint when editing; null when adding. */
  endpoint: CustomEndpoint | null;
  busy: boolean;
  onSave: (input: CustomEndpointInput) => Promise<boolean>;
  onClose: () => void;
};

/**
 * Add or edit an endpoint. Model ids are fetched from the endpoint itself
 * rather than typed: a relay gateway's catalog is the only reliable source, and
 * a mistyped id only fails later, at request time.
 */
export function EndpointDialog({
  presets,
  endpoint,
  busy,
  onSave,
  onClose,
}: EndpointDialogProps) {
  const { t } = useTranslation();
  const [presetId, setPresetId] = useState(endpoint?.presetId ?? "custom");
  const [label, setLabel] = useState(endpoint?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? "");
  const [apiBackend, setApiBackend] = useState<ApiBackend>(
    endpoint?.apiBackend ?? "chat_completions",
  );
  const [apiKey, setApiKey] = useState("");
  const [supportsReasoningEffort, setSupportsReasoningEffort] = useState(
    endpoint?.supportsReasoningEffort ?? false,
  );
  const [showKey, setShowKey] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(endpoint?.models.map((m) => m.id) ?? []),
  );
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  function applyPreset(nextId: string) {
    setPresetId(nextId);
    const preset = presets.find((p) => p.id === nextId);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    setApiBackend(preset.apiBackend);
    if (!label.trim() && preset.id !== "custom") setLabel(preset.label);
    setDiscovered(null);
  }

  async function discover() {
    if (!window.grok?.discoverEndpointModels) return;
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const result = await window.grok.discoverEndpointModels({
        endpointId: endpoint?.id,
        baseUrl,
        apiKey: apiKey || undefined,
        apiBackend,
      });
      if (!result.ok) {
        setDiscoverError(result.error);
        setDiscovered(null);
        return;
      }
      setDiscovered(result.models);
    } finally {
      setDiscovering(false);
    }
  }

  function toggle(modelId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }

  async function save() {
    const known = new Map(
      (discovered ?? []).map((m) => [m.id, m.contextWindow]),
    );
    const models = [...selected].map((id) => {
      const existing = endpoint?.models.find((m) => m.id === id);
      return {
        id,
        label: existing?.label ?? id,
        contextWindow:
          known.get(id) ?? existing?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      };
    });
    const ok = await onSave({
      ...(endpoint ? { id: endpoint.id } : {}),
      label,
      baseUrl,
      apiBackend,
      presetId,
      models,
      supportsReasoningEffort,
      // Undefined keeps the stored key; the field starts blank when editing.
      ...(apiKey ? { apiKey } : {}),
    });
    if (ok) onClose();
  }

  const preset = presets.find((p) => p.id === presetId);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="endpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("endpoints.addTitle")}
      >
        <h2 className="endpoint-dialog-title">
          {endpoint ? t("endpoints.editTitle") : t("endpoints.addTitle")}
        </h2>

        <label className="endpoint-field">
          <span>{t("endpoints.provider")}</span>
          {/*
            Options carry their vendor logo. Engines with customizable select
            render it; older ones fall back to the native list, where an
            <option>'s markup is ignored and only its label text shows — hence
            the badge beside the control, which works either way.
          */}
          <span className="endpoint-provider-row">
            <ModelIcon modelId={presetId} name={preset?.label} size={22} />
            <select
              className="settings-select endpoint-provider-select"
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  <ModelIcon modelId={p.id} name={p.label} size={18} />
                  <span>{p.label}</span>
                </option>
              ))}
            </select>
          </span>
        </label>

        <label className="endpoint-field">
          <span>{t("endpoints.name")}</span>
          <input
            className="endpoint-input"
            value={label}
            placeholder={t("endpoints.namePlaceholder")}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <label className="endpoint-field">
          <span>{t("endpoints.baseUrl")}</span>
          <input
            className="endpoint-input"
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>

        <label className="endpoint-field">
          <span>
            {t("endpoints.apiKey")}
            {/* The main process opens web links externally (window-open handler). */}
            {preset?.docsUrl ? (
              <a
                className="endpoint-link"
                href={preset.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("endpoints.getKey")}
              </a>
            ) : null}
          </span>
          <span className="endpoint-key-row">
            <input
              className="endpoint-input"
              type={showKey ? "text" : "password"}
              value={apiKey}
              spellCheck={false}
              placeholder={
                endpoint?.hasApiKey
                  ? t("endpoints.keyStored")
                  : t("endpoints.keyPlaceholder")
              }
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              type="button"
              className="settings-permission-button"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? t("endpoints.hide") : t("endpoints.show")}
            </button>
          </span>
        </label>

        <label className="endpoint-field">
          <span>{t("endpoints.protocol")}</span>
          <select
            className="settings-select"
            value={apiBackend}
            onChange={(e) => setApiBackend(e.target.value as ApiBackend)}
          >
            <option value="chat_completions">OpenAI Chat Completions</option>
            <option value="responses">OpenAI Responses</option>
            <option value="messages">Anthropic Messages</option>
          </select>
        </label>

        <label className="endpoint-toggle">
          <input
            type="checkbox"
            checked={supportsReasoningEffort}
            onChange={(e) => setSupportsReasoningEffort(e.target.checked)}
          />
          <span>
            {t("endpoints.reasoningEffort")}
            <span className="endpoint-toggle-hint">
              {t("endpoints.reasoningEffortHint")}
            </span>
          </span>
        </label>

        <div className="endpoint-models">
          <div className="endpoint-models-head">
            <span>
              {t("endpoints.models", { count: selected.size })}
            </span>
            <button
              type="button"
              className="settings-permission-button"
              disabled={discovering || !baseUrl.trim()}
              onClick={() => void discover()}
            >
              {discovering ? t("endpoints.loading") : t("endpoints.fetchModels")}
            </button>
          </div>

          {discoverError ? (
            <div className="settings-inline-notice" role="status">
              {discoverError}
            </div>
          ) : null}

          {discovered ? (
            <div className="endpoint-model-list">
              {discovered.map((model) => (
                <label key={model.id} className="endpoint-model-row">
                  <input
                    type="checkbox"
                    checked={selected.has(model.id)}
                    onChange={() => toggle(model.id)}
                  />
                  <ModelIcon modelId={model.id} size={16} />
                  <span>{model.id}</span>
                </label>
              ))}
            </div>
          ) : selected.size > 0 ? (
            <div className="endpoint-model-list">
              {[...selected].map((id) => (
                <label key={id} className="endpoint-model-row">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggle(id)}
                  />
                  <ModelIcon modelId={id} size={16} />
                  <span>{id}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="settings-inline-note">
              {t("endpoints.fetchHint")}
            </div>
          )}
        </div>

        <div className="endpoint-dialog-actions">
          <button
            type="button"
            className="settings-permission-button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="endpoint-save"
            disabled={busy || !baseUrl.trim() || selected.size === 0}
            onClick={() => void save()}
          >
            {t("endpoints.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
