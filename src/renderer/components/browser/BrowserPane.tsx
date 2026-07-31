import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  BrowserId,
  BrowserState,
} from "../../../electron/preload";
import { createImeCompositionLatch } from "../../lib/imeKeys";
import { useTranslation } from "react-i18next";
import {
  BackIcon,
  ForwardIcon,
  ReloadIcon,
} from "./BrowserIcons";
import { getBrowserWebview } from "./browserWebview";

export type BrowserPaneProps = {
  /** Split-panel tab id — each id is its own embedded browser session. */
  browserId: BrowserId;
  open: boolean;
  /** Optional first URL when this slot is created. */
  startUrl?: string;
};

function isBlankUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return (
    u === "" ||
    u === "about:blank" ||
    u === "about:blank/" ||
    u === "chrome://newtab" ||
    u === "chrome://newtab/" ||
    u === "chrome://new-tab-page" ||
    u === "chrome://new-tab-page/"
  );
}

const emptyState = (id: BrowserId): BrowserState => ({
  id,
  open: false,
  url: "about:blank",
  title: "Browser",
  canGoBack: false,
  canGoForward: false,
  cdpEndpoint: null,
  error: null,
  viewport: { width: 1024, height: 768 },
  anyOpen: false,
});

/**
 * One browser pane bound to a single slot id.
 * Hosts a retained Electron <webview> inside the renderer layout. The guest
 * webContents stays isolated, while Chromium lays it out with the panel DOM.
 */
export function BrowserPane({
  browserId,
  open,
  startUrl,
}: BrowserPaneProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<BrowserState>(() =>
    emptyState(browserId),
  );
  const [urlDraft, setUrlDraft] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const appliedStartUrlRef = useRef<string | null>(null);
  /** While the address bar is focused, never clobber draft from page events. */
  const urlFocusedRef = useRef(false);
  /** IME latch: Enter confirming candidates must not navigate. */
  const urlImeLatch = useRef(createImeCompositionLatch(100));

  const syncUrlDraft = useCallback((url: string | undefined | null) => {
    if (urlFocusedRef.current) return;
    // New-tab / blank: keep the address bar empty (like a real browser).
    if (isBlankUrl(url)) {
      setUrlDraft((prev) => (prev === "" ? prev : ""));
      return;
    }
    if (!url) return;
    setUrlDraft((prev) => (url !== prev ? url : prev));
  }, []);

  // Move the retained webview into this pane. When another tool tab becomes
  // active, keep the guest alive in an off-screen renderer host (Codex-style).
  useEffect(() => {
    if (!open || !browserId || !viewportRef.current) return;
    const host = getBrowserWebview(browserId, startUrl);
    if (appliedStartUrlRef.current === null) {
      appliedStartUrlRef.current = startUrl ?? "";
    }
    host.mount(viewportRef.current);
    void window.grok?.getBrowserState?.(browserId).then((next) => {
      if (!next || next.id !== browserId) return;
      setState(next);
      syncUrlDraft(next.url);
    });
    return () => {
      host.retain();
    };
  }, [open, browserId, startUrl, syncUrlDraft]);

  // A slash/open request may focus an existing browser tab with a new URL.
  useEffect(() => {
    if (
      !open ||
      !startUrl ||
      isBlankUrl(startUrl) ||
      startUrl === appliedStartUrlRef.current
    ) {
      return;
    }
    appliedStartUrlRef.current = startUrl;
    void window.grok?.browserNavigate?.({ id: browserId, url: startUrl });
  }, [browserId, open, startUrl]);

  useEffect(() => {
    if (!window.grok?.onBrowserState) return;
    return window.grok.onBrowserState((s) => {
      // Strict id match — never apply another panel's session to this pane.
      if (!s || s.id !== browserId) return;
      setState(s);
      syncUrlDraft(s.url);
    });
  }, [browserId, syncUrlDraft]);

  const navigateTo = useCallback(
    async (raw: string) => {
      if (!window.grok?.browserNavigate) return;
      const next = raw.trim();
      if (!next) return;
      // Allow URL sync again after submit.
      urlFocusedRef.current = false;
      const s = await window.grok.browserNavigate({
        id: browserId,
        url: next,
      });
      if (!s || s.id !== browserId) return;
      setState(s);
      if (s.url) syncUrlDraft(s.url);
      void window.grok.browserFocus?.(browserId);
    },
    [browserId, syncUrlDraft],
  );

  const navigate = useCallback(async () => {
    await navigateTo(urlDraft);
  }, [navigateTo, urlDraft]);

  const retryOpen = useCallback(async () => {
    const target = !isBlankUrl(state.url)
      ? state.url
      : startUrl || "about:blank";
    if (isBlankUrl(target)) return;
    await navigateTo(target);
  }, [navigateTo, startUrl, state.url]);

  const focusBrowser = useCallback(() => {
    getBrowserWebview(browserId, startUrl).focus();
    void window.grok?.browserFocus?.(browserId);
  }, [browserId, startUrl]);

  const applyNavigationState = useCallback(
    (next: BrowserState | null | undefined) => {
      if (!next || next.id !== browserId) return;
      setState(next);
      syncUrlDraft(next.url);
    },
    [browserId, syncUrlDraft],
  );

  const goBack = useCallback(async () => {
    applyNavigationState(await window.grok?.browserGoBack?.(browserId));
  }, [applyNavigationState, browserId]);

  const goForward = useCallback(async () => {
    applyNavigationState(await window.grok?.browserGoForward?.(browserId));
  }, [applyNavigationState, browserId]);

  const reload = useCallback(async () => {
    applyNavigationState(await window.grok?.browserReload?.(browserId));
  }, [applyNavigationState, browserId]);

  if (!open) return null;

  const currentUrl = state.url || "";
  const isBlank = isBlankUrl(currentUrl);

  return (
    <div
      className="browser-pane"
      aria-label={`${t("tools.browser")} (${browserId})`}
    >
      <div className="browser-pane-toolbar">
        <button
          type="button"
          className="browser-pane-btn browser-pane-icon-btn"
          onClick={() => void goBack()}
          title={t("browser.back")}
          aria-label={t("browser.back")}
          disabled={!state.canGoBack}
        >
          <BackIcon />
        </button>
        {state.canGoForward ? (
          <button
            type="button"
            className="browser-pane-btn browser-pane-icon-btn"
            onClick={() => void goForward()}
            title={t("browser.forward")}
            aria-label={t("browser.forward")}
          >
            <ForwardIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="browser-pane-btn browser-pane-icon-btn"
          onClick={() => void reload()}
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
        >
          <ReloadIcon />
        </button>
        <form
          className="browser-pane-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            // Do not navigate on the same Enter that confirms an IME candidate.
            if (urlImeLatch.current.isComposing()) return;
            void navigate();
          }}
        >
          <input
            className="browser-pane-url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onFocus={() => {
              urlFocusedRef.current = true;
            }}
            onBlur={() => {
              // Delay so Go/Enter can read the draft before we release the lock.
              window.setTimeout(() => {
                urlFocusedRef.current = false;
              }, 0);
            }}
            onCompositionStart={() => urlImeLatch.current.onCompositionStart()}
            onCompositionEnd={() => urlImeLatch.current.onCompositionEnd()}
            placeholder={t("browser.searchUrl")}
            spellCheck={false}
            aria-label={t("browser.url")}
          />
        </form>
      </div>

      {state.error ? (
        <div className="browser-pane-error" role="alert">
          <span title={state.error}>{t("browser.failed")}</span>
          <button
            type="button"
            className="browser-pane-btn"
            onClick={() => void retryOpen()}
            title={t("browser.retry")}
          >
            {t("common.retry")}
          </button>
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className={`browser-pane-viewport${isBlank ? " browser-pane-viewport-blank" : ""}`}
        onMouseEnter={focusBrowser}
      >
        {state.open && isBlank ? (
          <div className="browser-pane-empty">
            <div className="browser-pane-empty-title">
              {t("browser.newTab")}
            </div>
            <div className="browser-pane-empty-hint">
              {t("browser.newTabHint")}
            </div>
          </div>
        ) : !state.open ? (
          <div className="browser-pane-empty">
            {state.error
              ? t("browser.failed")
              : t("browser.starting")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
