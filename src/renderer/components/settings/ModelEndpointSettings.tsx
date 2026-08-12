import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CustomEndpoint } from "../../../electron/preload";
import { ModelIcon } from "../ModelIcon";
import { EndpointDialog } from "./EndpointDialog";
import { useModelEndpoints } from "./useModelEndpoints";

/**
 * Vendor APIs and relay gateways the user has added. Their models join the
 * agent's picker under "Custom models" once it reconnects.
 */
export function ModelEndpointSettings() {
  const { t } = useTranslation();
  const { endpoints, presets, busy, error, save, remove } = useModelEndpoints();
  const [editing, setEditing] = useState<CustomEndpoint | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <section className="settings-section" aria-labelledby="settings-endpoints">
      <h2 id="settings-endpoints" className="settings-section-title">
        {t("endpoints.title")}
      </h2>
      <p className="settings-section-desc">{t("endpoints.description")}</p>

      <div className="settings-card">
        {endpoints.length === 0 ? (
          <div className="settings-inline-note">{t("endpoints.empty")}</div>
        ) : (
          endpoints.map((endpoint) => (
            <div key={endpoint.id} className="settings-row">
              <ModelIcon
                // A relay serves many vendors, so fall back to its own name.
                modelId={endpoint.models[0]?.id ?? endpoint.presetId}
                name={endpoint.label}
                size={22}
              />
              <div className="settings-row-text">
                <div className="settings-row-label">{endpoint.label}</div>
                <div className="settings-row-hint">
                  {endpoint.baseUrl} ·{" "}
                  {t("endpoints.models", { count: endpoint.models.length })}
                  {endpoint.hasApiKey ? "" : ` · ${t("endpoints.noKey")}`}
                </div>
              </div>
              <span className="endpoint-row-actions">
                <button
                  type="button"
                  className="settings-permission-button"
                  onClick={() => setEditing(endpoint)}
                >
                  {t("common.change")}
                </button>
                <button
                  type="button"
                  className="settings-permission-button"
                  disabled={busy}
                  onClick={() => void remove(endpoint.id)}
                >
                  {t("common.remove")}
                </button>
              </span>
            </div>
          ))
        )}

        {error ? (
          <div className="settings-inline-notice" role="status">
            {error}
          </div>
        ) : null}

        <div className="settings-permission-check">
          <span>{t("endpoints.addHint")}</span>
          <button
            type="button"
            className="settings-permission-button"
            onClick={() => setAdding(true)}
          >
            {t("endpoints.add")}
          </button>
        </div>
      </div>

      {adding || editing ? (
        <EndpointDialog
          presets={presets}
          endpoint={editing}
          busy={busy}
          onSave={save}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}
