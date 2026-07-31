import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalId } from "../../../electron/preload";
import { useTranslation } from "react-i18next";
import {
  loadGuiSettings,
  subscribeGuiSettings,
  type TerminalThemePreference,
} from "../../lib/guiSettings";
import { localizeUiError } from "../../lib/uiError";
import { getTerminalTheme } from "./terminalTheme";

type Props = {
  /** PTY slot id (e.g. `right-1`, `bottom-2`). */
  terminalId: TerminalId;
};

/**
 * Real terminal: xterm.js in renderer, PTY in Electron main via window.grok.
 *
 * Lifecycle:
 * - Unmount while collapsing UI → PTY keeps running; next open re-attaches.
 * - Tab close → caller kills this terminalId; next open is a fresh shell.
 */
export function TerminalPane({ terminalId }: Props) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [themePref, setThemePref] = useState<TerminalThemePreference>(
    () => loadGuiSettings().terminalTheme,
  );
  const theme = getTerminalTheme(themePref);

  useEffect(() => {
    return subscribeGuiSettings((s) => {
      setThemePref(s.terminalTheme);
    });
  }, []);

  // Live-apply scheme when settings change (no PTY restart).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme.xterm;
    term.refresh(0, term.rows - 1);
  }, [theme]);

  const applyScrollback = useCallback((term: Terminal, scrollback: string) => {
    if (!scrollback) return;
    term.write(scrollback);
  }, []);

  const focusTerm = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          term.focus();
        } catch {
          /* disposed */
        }
      });
    });
  }, []);

  const fitAndResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      /* host may be hidden */
    }
    void window.grok?.terminalResize?.({
      id: terminalId,
      cols: term.cols,
      rows: term.rows,
    });
  }, [terminalId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.grok?.terminalCreate) {
      setBootError(
        window.grok?.terminalCreate
          ? t("tools.terminalHostMissing")
          : t("tools.terminalApiUnavailable"),
      );
      return;
    }

    const initialTheme = getTerminalTheme(loadGuiSettings().terminalTheme);
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: initialTheme.xterm,
      allowProposedApi: true,
      scrollback: 5000,
      disableStdin: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    try {
      fit.fit();
    } catch {
      /* ignore first fit */
    }

    const unsubData = window.grok.onTerminalData((ev) => {
      if (ev?.id !== terminalId) return;
      if (ev?.data) term.write(ev.data);
    });
    const unsubState = window.grok.onTerminalState((s) => {
      if (s?.id !== terminalId) return;
      if (s.error) setBootError(s.error);
    });

    let disposed = false;
    void (async () => {
      try {
        const result = await window.grok!.terminalCreate({
          id: terminalId,
          cols: term.cols,
          rows: term.rows,
          shellPreference: loadGuiSettings().terminalShell,
        });
        if (disposed) return;
        if (result.error) {
          setBootError(result.error);
          term.writeln(
            `\r\n${t("tools.terminalFailedStart", {
              error: localizeUiError(result.error, t),
            })}`,
          );
          return;
        }
        setBootError(null);
        applyScrollback(term, result.scrollback ?? "");
        fitAndResize();
        focusTerm();
      } catch (e) {
        if (disposed) return;
        const msg = e instanceof Error ? e.message : String(e);
        setBootError(msg);
        term.writeln(
          `\r\n${t("tools.terminalFailedStart", {
            error: localizeUiError(msg, t),
          })}`,
        );
      }
    })();

    const onDataDisp = term.onData((data) => {
      void window.grok?.terminalWrite?.({ id: terminalId, data });
    });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            fitAndResize();
          })
        : null;
    ro?.observe(host);

    const onWinResize = () => fitAndResize();
    window.addEventListener("resize", onWinResize);

    const onHostClick = () => term.focus();
    host.addEventListener("mousedown", onHostClick);

    return () => {
      disposed = true;
      unsubData();
      unsubState();
      onDataDisp.dispose();
      ro?.disconnect();
      window.removeEventListener("resize", onWinResize);
      host.removeEventListener("mousedown", onHostClick);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [applyScrollback, fitAndResize, focusTerm, terminalId, t]);

  return (
    <div
      className={`terminal-pane terminal-pane--${themePref}`}
      style={{ background: theme.paneBackground }}
      aria-label={`${t("tools.terminal")} (${terminalId})`}
    >
      {bootError ? (
        <div className="terminal-pane-error" role="alert">
          {t("tools.terminalFailedStart", {
            error: localizeUiError(bootError, t),
          })}
        </div>
      ) : null}
      <div className="terminal-pane-xterm" ref={hostRef} />
    </div>
  );
}
