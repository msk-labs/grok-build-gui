import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FsEntry } from "./types";
import { useTranslation } from "react-i18next";

export type FileTreeCtxTarget = {
  entry: FsEntry;
  x: number;
  y: number;
};

type OpenWithApp = {
  name: string;
  path: string;
  isDefault?: boolean;
  iconDataUrl?: string;
};

/** Enable submenu scrolling only past this many rows (short lists stay scrollbar-free). */
const OPEN_WITH_SCROLL_AFTER = 12;

type Props = {
  target: FileTreeCtxTarget;
  workspaceRoot: string;
  onClose: () => void;
  onOpen: (entry: FsEntry) => void;
};

const MENU_W = 220;
const SUB_W = 220;
const MENU_H = 260;

function revealTarget(): "finder" | "explorer" | "folder" {
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  if (/Mac|iPhone|iPad/i.test(plat) || /Mac OS/i.test(ua)) {
    return "finder";
  }
  if (/Win/i.test(plat) || /Windows/i.test(ua)) {
    return "explorer";
  }
  return "folder";
}

function toRelative(root: string, full: string): string {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = full.replace(/\\/g, "/");
  if (p === r) return ".";
  if (p.startsWith(r + "/")) return p.slice(r.length + 1);
  return p;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/**
 * Codex-style right-click menu for the Files tree, including Open With ▸.
 */
export function FileTreeContextMenu({
  target,
  workspaceRoot,
  onClose,
  onOpen,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { entry, x, y } = target;
  const isFile = entry.kind === "file";

  const [apps, setApps] = useState<OpenWithApp[] | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [openWithOpen, setOpenWithOpen] = useState(false);
  const [subFlipLeft, setSubFlipLeft] = useState(false);

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8));

  // Load Open With apps for this path.
  useEffect(() => {
    let cancelled = false;
    setApps(null);
    setAppsError(null);
    setOpenWithOpen(false);
    if (!window.grok?.listOpenWith) {
      setApps([]);
      return;
    }
    void window.grok
      .listOpenWith({ root: workspaceRoot, path: entry.path })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setAppsError(res.error);
          setApps([]);
          return;
        }
        setApps(res.apps);
      })
      .catch((e) => {
        if (cancelled) return;
        setAppsError(e instanceof Error ? e.message : String(e));
        setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, entry.path]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDismiss = () => onClose();
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [onClose]);

  const run = (fn: () => void | Promise<void>) => {
    onClose();
    void fn();
  };

  const showOpenWith = () => {
    // Prefer opening to the right; flip left if near the edge.
    setSubFlipLeft(left + MENU_W + SUB_W + 12 > window.innerWidth);
    setOpenWithOpen(true);
  };

  return createPortal(
    <div
      ref={ref}
      className="files-tree-ctx-menu"
      role="menu"
      aria-label={t("files.options")}
      style={{ position: "fixed", top, left, zIndex: 10001 }}
    >
      <button
        type="button"
        role="menuitem"
        className="files-tree-ctx-item"
        onClick={() => run(() => onOpen(entry))}
      >
        {isFile ? t("common.open") : t("files.openFolder")}
      </button>

      <div
        className={
          openWithOpen
            ? "files-tree-ctx-submenu-wrap open"
            : "files-tree-ctx-submenu-wrap"
        }
        onMouseEnter={showOpenWith}
        onFocus={showOpenWith}
      >
        <button
          type="button"
          role="menuitem"
          className="files-tree-ctx-item files-tree-ctx-item-sub"
          aria-haspopup="menu"
          aria-expanded={openWithOpen}
          onClick={showOpenWith}
        >
          <span>{t("files.openWith")}</span>
          <span className="files-tree-ctx-chevron" aria-hidden>
            ›
          </span>
        </button>
        {openWithOpen ? (
          <div
            className={[
              "files-tree-ctx-submenu",
              subFlipLeft ? "files-tree-ctx-submenu-left" : "",
              apps && apps.length > OPEN_WITH_SCROLL_AFTER
                ? "files-tree-ctx-submenu-scroll"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="menu"
            aria-label={t("files.openWithApp")}
          >
            {apps == null ? (
              <div className="files-tree-ctx-status">
                {t("common.loading")}
              </div>
            ) : appsError ? (
              <div className="files-tree-ctx-status">{appsError}</div>
            ) : apps.length === 0 ? (
              <div className="files-tree-ctx-status">
                {t("files.noApps")}
              </div>
            ) : (
              apps.map((app) => (
                <button
                  key={`${app.path}::${app.name}`}
                  type="button"
                  role="menuitem"
                  className="files-tree-ctx-item files-tree-ctx-item-app"
                  title={app.path || t("files.systemDefault")}
                  onClick={() =>
                    run(async () => {
                      if (!window.grok?.openWith) return;
                      const res = await window.grok.openWith({
                        root: workspaceRoot,
                        path: entry.path,
                        appPath: app.path || undefined,
                      });
                      if (!res.ok) {
                        console.warn("[files] openWith:", res.error);
                      }
                    })
                  }
                >
                  <span className="files-tree-ctx-app-lead">
                    {app.iconDataUrl ? (
                      <img
                        className="files-tree-ctx-app-icon"
                        src={app.iconDataUrl}
                        alt=""
                        width={16}
                        height={16}
                        draggable={false}
                      />
                    ) : (
                      <span className="files-tree-ctx-app-icon-fallback" aria-hidden />
                    )}
                    <span className="files-tree-ctx-app-name">{app.name}</span>
                  </span>
                  {app.isDefault ? (
                    <span className="files-tree-ctx-default">
                      {t("common.default")}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div className="files-tree-ctx-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="files-tree-ctx-item"
        onClick={() => run(() => copyText(entry.path))}
      >
        {t("files.copyPath")}
      </button>
      <button
        type="button"
        role="menuitem"
        className="files-tree-ctx-item"
        onClick={() =>
          run(() => copyText(toRelative(workspaceRoot, entry.path)))
        }
      >
        {t("files.copyRelativePath")}
      </button>
      <div className="files-tree-ctx-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="files-tree-ctx-item"
        onClick={() =>
          run(async () => {
            if (!window.grok?.revealInFolder) return;
            await window.grok.revealInFolder({
              root: workspaceRoot,
              path: entry.path,
            });
          })
        }
      >
        {revealTarget() === "finder"
          ? t("files.revealFinder")
          : revealTarget() === "explorer"
            ? t("files.revealExplorer")
            : t("files.revealFolder")}
      </button>
    </div>,
    document.body,
  );
}
