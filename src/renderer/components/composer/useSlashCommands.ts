import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { BROWSER_SLASH_COMMAND } from "../../lib/browserSlash";
import { COMPUTER_SLASH_COMMAND } from "../../lib/computerSlash";
import { useTranslation } from "react-i18next";
import { localizeUiError } from "../../lib/uiError";
import {
  applySlashCommand,
  filterSlashCommands,
  parseSlashQuery,
  type SlashCommand,
} from "./slashCommands";

/** Always merge GUI builtins so `/browser` appears even before inspect returns. */
function withBuiltins(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set(commands.map((c) => c.name.toLowerCase()));
  const extras = [BROWSER_SLASH_COMMAND, COMPUTER_SLASH_COMMAND].filter(
    (c) => !seen.has(c.name.toLowerCase()),
  );
  if (extras.length === 0) return commands;
  return [...extras, ...commands].sort((a, b) => a.name.localeCompare(b.name));
}

type Options = {
  value: string;
  onChange: (v: string) => void;
  /** Workspace cwd for `grok inspect` discovery. */
  cwd?: string;
  disabled?: boolean;
  /** Bump to drop cache and re-fetch (plugin install/enable). */
  refreshKey?: number;
  /** Focus textarea after applying a command (selection at end). */
  focusInput?: () => void;
};

/**
 * Codex-style `/` autocomplete for user-invocable skills.
 * Data comes from main via `grok inspect --json` (agent truth).
 */
export function useSlashCommands({
  value,
  onChange,
  cwd,
  disabled,
  refreshKey = 0,
  focusInput,
}: Options) {
  const { t } = useTranslation();
  const [all, setAll] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [agentCommandRevision, setAgentCommandRevision] = useState(0);
  /** Hide for this exact query token after Escape; further typing reopens. */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const cacheRef = useRef<{ cwd: string; commands: SlashCommand[] } | null>(
    null,
  );
  const fetchGen = useRef(0);

  // Drop skill cache when plugins change.
  useEffect(() => {
    cacheRef.current = null;
  }, [refreshKey, agentCommandRevision]);

  // ACP publishes core commands (including /goal) per real session. Invalidate
  // a cwd-only inspect cache as soon as that authoritative list arrives.
  useEffect(() => {
    if (!window.grok) return;
    const offSessionUpdate = window.grok.onSessionUpdate((notification) => {
      const update = (
        notification as {
          update?: { sessionUpdate?: string };
        }
      )?.update;
      if (update?.sessionUpdate === "available_commands_update") {
        setAgentCommandRevision((revision) => revision + 1);
      }
    });
    const offSessionLoaded = window.grok.onSessionLoaded(() => {
      setAgentCommandRevision((revision) => revision + 1);
    });
    return () => {
      offSessionUpdate();
      offSessionLoaded();
    };
  }, []);

  const query = useMemo(() => parseSlashQuery(value), [value]);
  const open = !!query && !disabled && dismissedFor !== query.query;
  const filtered = useMemo(
    () => (query ? filterSlashCommands(all, query.query) : []),
    [all, query],
  );

  useEffect(() => {
    if (!query) setDismissedFor(null);
  }, [query]);

  const load = useCallback(async () => {
    if (!window.grok?.listSlashCommands) {
      // Preload missing (rare) — still offer builtins.
      setAll(withBuiltins([]));
      setError(null);
      return;
    }
    const cwdKey = cwd?.trim() || "";
    const cached = cacheRef.current;
    if (cached && cached.cwd === cwdKey) {
      setAll(withBuiltins(cached.commands));
      setError(null);
      return;
    }
    const gen = ++fetchGen.current;
    setLoading(true);
    setError(null);
    try {
      const result = await window.grok.listSlashCommands(cwdKey || null);
      if (gen !== fetchGen.current) return;
      if (!result.ok) {
        setError(localizeUiError(result.error, t, "composer.failedLoadSkills"));
        setAll(withBuiltins([]));
        return;
      }
      cacheRef.current = { cwd: cwdKey, commands: result.commands };
      setAll(withBuiltins(result.commands));
    } catch (e) {
      if (gen !== fetchGen.current) return;
      setError(
        localizeUiError(
          e instanceof Error ? e.message : String(e),
          t,
          "composer.failedLoadSkills",
        ),
      );
      setAll(withBuiltins([]));
    } finally {
      if (gen === fetchGen.current) setLoading(false);
    }
  }, [agentCommandRevision, cwd, t]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query?.query, all]);

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex]);

  const select = useCallback(
    (cmd: SlashCommand) => {
      const next = applySlashCommand(value, cmd.name);
      onChange(next);
      // Wait for controlled value to commit before focusing / moving caret.
      window.setTimeout(() => focusInput?.(), 0);
    },
    [focusInput, onChange, value],
  );

  /**
   * Handle slash-menu keys. Returns true when the event was consumed
   * (caller should not treat Enter as send, etc.).
   * Caller must already skip IME composition; we double-check Enter.
   */
  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open) return false;
    // IME candidate confirm — never treat as slash select / send.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
      return false;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) setDismissedFor(query.query);
      return true;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) return true;
      setActiveIndex((i) => (i + 1) % filtered.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return true;
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (e.key === "Tab") {
      const cmd = filtered[activeIndex];
      if (cmd) {
        e.preventDefault();
        select(cmd);
        return true;
      }
      return false;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const cmd = filtered[activeIndex];
      if (cmd) {
        e.preventDefault();
        select(cmd);
        return true;
      }
    }
    return false;
  }

  return {
    open,
    filtered,
    activeIndex,
    setActiveIndex,
    loading,
    error,
    select,
    onKeyDown,
  };
}
