import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type {
  AvailablePlugin,
  InstalledPlugin,
} from "../../../electron/preload";
import { createImeCompositionLatch } from "../../lib/imeKeys";
import { useTranslation } from "react-i18next";
import { localizeUiError } from "../../lib/uiError";

export type PluginsPanelProps = {
  /** Called after install / uninstall / enable / disable so slash menu can refresh. */
  onPluginsChanged?: () => void;
  /** Optional: return to chat view (Escape). */
  onBack?: () => void;
};

type Tab = "installed" | "marketplace";

function shortDesc(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function componentSummary(
  p: InstalledPlugin | AvailablePlugin,
  t: TFunction<"translation">,
): string {
  const parts: string[] = [];
  if (p.skillCount > 0) {
    parts.push(t("plugins.skillCount", { count: p.skillCount }));
  }
  if (p.status === "installed") {
    if (p.agentCount > 0) {
      parts.push(t("plugins.agentCount", { count: p.agentCount }));
    }
    if (p.mcpServerCount > 0) {
      parts.push(t("plugins.mcpCount", { count: p.mcpServerCount }));
    }
    if (p.hasHooks) parts.push(t("plugins.hooks"));
  } else {
    if (p.hasAgents) parts.push(t("plugins.agentsLabel"));
    if (p.hasMcp) parts.push(t("plugins.mcpLabel"));
    if (p.hasHooks) parts.push(t("plugins.hooks"));
  }
  return parts.join(" · ");
}

export function PluginsPanel({
  onPluginsChanged,
  onBack,
}: PluginsPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("installed");
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [available, setAvailable] = useState<AvailablePlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [installSource, setInstallSource] = useState("");
  const [installing, setInstalling] = useState(false);
  const installImeLatch = useRef(createImeCompositionLatch(100));

  const refresh = useCallback(async () => {
    if (!window.grok?.listPlugins) {
      setError(t("plugins.apiUnavailable"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.grok.listPlugins();
      if (!result.ok) {
        setError(localizeUiError(result.error, t));
        setInstalled([]);
        setAvailable([]);
        return;
      }
      setInstalled(result.installed);
      setAvailable(result.available);
    } catch (e) {
      setError(localizeUiError(e instanceof Error ? e.message : String(e), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!onBack) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onBack?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onBack]);

  const q = query.trim().toLowerCase();
  const filteredInstalled = useMemo(() => {
    if (!q) return installed;
    return installed.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        (p.source?.toLowerCase().includes(q) ?? false),
    );
  }, [installed, q]);

  const filteredAvailable = useMemo(() => {
    if (!q) return available;
    return available.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        (p.marketplace?.toLowerCase().includes(q) ?? false),
    );
  }, [available, q]);

  async function runAction(
    name: string,
    action: () => Promise<{ ok: boolean; error?: string; message?: string }>,
  ) {
    setBusyName(name);
    setStatus(null);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(
          localizeUiError(result.error, t, "plugins.actionFailed"),
        );
        return;
      }
      setStatus(result.message || t("plugins.done"));
      await refresh();
      onPluginsChanged?.();
    } catch (e) {
      setError(localizeUiError(e instanceof Error ? e.message : String(e), t));
    } finally {
      setBusyName(null);
    }
  }

  async function handleInstallSource(e: React.FormEvent) {
    e.preventDefault();
    // Enter confirming IME candidate must not install.
    if (installImeLatch.current.isComposing()) return;
    const source = installSource.trim();
    if (!source || !window.grok?.installPlugin) return;
    setInstalling(true);
    setError(null);
    setStatus(null);
    try {
      const result = await window.grok.installPlugin(source);
      if (!result.ok) {
        setError(localizeUiError(result.error, t));
        return;
      }
      setStatus(result.message || t("plugins.installedFrom", { source }));
      setInstallSource("");
      setTab("installed");
      await refresh();
      onPluginsChanged?.();
    } catch (err) {
      setError(
        localizeUiError(err instanceof Error ? err.message : String(err), t),
      );
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="plugins-view" aria-label={t("plugins.title")}>
      <p className="plugins-subtitle">
        {t("plugins.subtitle")}
      </p>

      <div className="plugins-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "installed"}
          className={`plugins-tab${tab === "installed" ? " active" : ""}`}
          onClick={() => setTab("installed")}
        >
          {t("plugins.installed")}
          <span className="plugins-tab-count">{installed.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "marketplace"}
          className={`plugins-tab${tab === "marketplace" ? " active" : ""}`}
          onClick={() => setTab("marketplace")}
        >
          {t("plugins.marketplace")}
          <span className="plugins-tab-count">{available.length}</span>
        </button>
        <button
          type="button"
          className="plugins-refresh"
          onClick={() => void refresh()}
          disabled={loading}
          title={t("common.refresh")}
        >
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      <form
        className="plugins-install"
        onSubmit={(e) => void handleInstallSource(e)}
      >
        <input
          type="text"
          className="plugins-install-input"
          value={installSource}
          onChange={(e) => setInstallSource(e.target.value)}
          onCompositionStart={() => installImeLatch.current.onCompositionStart()}
          onCompositionEnd={() => installImeLatch.current.onCompositionEnd()}
          placeholder={t("plugins.installSource")}
          disabled={installing}
          spellCheck={false}
        />
        <button
          type="submit"
          className="btn btn-primary plugins-install-btn"
          disabled={installing || !installSource.trim()}
        >
          {installing ? t("plugins.installing") : t("plugins.install")}
        </button>
      </form>
      <p className="plugins-install-hint">
        {t("plugins.installHint")}
      </p>

      <div className="plugins-search-wrap">
        <input
          type="search"
          className="plugins-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === "installed"
              ? t("plugins.searchInstalled")
              : t("plugins.searchMarketplace")
          }
          spellCheck={false}
        />
      </div>

      {error ? <div className="plugins-banner error">{error}</div> : null}
      {status ? <div className="plugins-banner ok">{status}</div> : null}

      <div className="plugins-list" role="list">
        {tab === "installed" ? (
          filteredInstalled.length === 0 ? (
            <div className="plugins-empty">
              {loading
                ? t("plugins.loading")
                : q
                  ? t("plugins.noInstalledMatch")
                  : t("plugins.noInstalled")}
            </div>
          ) : (
            filteredInstalled.map((p) => {
              const busy = busyName === p.name;
              return (
                <div key={p.name} className="plugin-row" role="listitem">
                  <div className="plugin-row-main">
                    <div className="plugin-row-title">
                      <span className="plugin-name">{p.name}</span>
                      {p.version ? (
                        <span className="plugin-meta">v{p.version}</span>
                      ) : null}
                      <span
                        className={`plugin-badge${p.enabled ? " on" : ""}`}
                      >
                        {p.enabled ? t("plugins.on") : t("plugins.off")}
                      </span>
                    </div>
                    {p.description ? (
                      <p className="plugin-desc">{shortDesc(p.description)}</p>
                    ) : null}
                    <p className="plugin-meta-line">
                      {[componentSummary(p, t), p.source || p.path]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="plugin-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost plugin-action"
                      disabled={busy}
                      onClick={() =>
                        void runAction(p.name, () =>
                          p.enabled
                            ? window.grok!.disablePlugin(p.name)
                            : window.grok!.enablePlugin(p.name),
                        )
                      }
                    >
                      {busy
                        ? "…"
                        : p.enabled
                          ? t("plugins.disable")
                          : t("plugins.enable")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost plugin-action danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            t("plugins.uninstallConfirm", { name: p.name }),
                          )
                        ) {
                          return;
                        }
                        void runAction(p.name, () =>
                          window.grok!.uninstallPlugin(p.name),
                        );
                      }}
                    >
                      {t("plugins.uninstall")}
                    </button>
                  </div>
                </div>
              );
            })
          )
        ) : filteredAvailable.length === 0 ? (
          <div className="plugins-empty">
            {loading
              ? t("plugins.loadingMarketplace")
              : q
                ? t("plugins.noMarketplaceMatch")
                : t("plugins.noMarketplace")}
          </div>
        ) : (
          filteredAvailable.map((p) => {
            const busy = busyName === p.name;
            return (
              <div key={p.name} className="plugin-row" role="listitem">
                <div className="plugin-row-main">
                  <div className="plugin-row-title">
                    <span className="plugin-name">{p.name}</span>
                    {p.marketplace ? (
                      <span className="plugin-meta">{p.marketplace}</span>
                    ) : null}
                  </div>
                  {p.description ? (
                    <p className="plugin-desc">{shortDesc(p.description)}</p>
                  ) : null}
                  <p className="plugin-meta-line">
                    {componentSummary(p, t)}
                  </p>
                </div>
                <div className="plugin-row-actions">
                  <button
                    type="button"
                    className="btn btn-primary plugin-action"
                    disabled={busy || installing}
                    onClick={() => {
                      if (
                        !window.confirm(
                          t("plugins.installConfirm", { name: p.name }),
                        )
                      ) {
                        return;
                      }
                      void runAction(p.name, () =>
                        window.grok!.installPlugin(p.name),
                      );
                    }}
                  >
                    {busy ? t("plugins.installing") : t("plugins.install")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
