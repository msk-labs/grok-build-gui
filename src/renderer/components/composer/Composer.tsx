import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  ContextUsage,
  ModelState,
  PermissionMode,
} from "../../../electron/preload";
import type { ChatFile, ChatImage } from "../../types/chat";
import type { QueuedPrompt } from "../../types/promptQueue";
import {
  AttachMenu,
  ModelMenu,
  PermissionMenu,
  type ComposerMenu,
} from "./ComposerMenus";
import { ContextMeter } from "./ContextMeter";
import { createImeCompositionLatch, isImeKeyEvent } from "../../lib/imeKeys";
import { extractTransferFiles } from "../../lib/transferFiles";
import { ArrowUpIcon, MicIcon, StopSquareIcon } from "./icons";
import { PromptQueue } from "./PromptQueue";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { useSlashCommands } from "./useSlashCommands";
import { useVoiceInput } from "./useVoiceInput";
import { VoiceWaveInline } from "./VoiceBar";
import { WorkspacePicker, type WorkspaceProps } from "./WorkspacePicker";
import { WorktreeBar, type WorktreeBarProps } from "./WorktreeBar";
import { useTranslation } from "react-i18next";
import { ComposerImageAttachment } from "./ComposerImageAttachment";

export type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  /** Optional text override (voice STT) to avoid setState race before send. */
  onSubmit: (text?: string) => void;
  onCancel: () => void;
  disabled: boolean;
  busy: boolean;
  /** Follow-ups queued while a turn runs (TUI queue). */
  promptQueue?: QueuedPrompt[];
  onSendNowQueued?: (id: string) => void;
  onRemoveQueued?: (id: string) => void;
  placeholder?: string;
  /** Draft screenshots / image attachments shown above the textarea. */
  pendingImages?: ChatImage[];
  /** Draft non-image file attachments. */
  pendingFiles?: ChatFile[];
  onRemoveImage?: (id: string) => void;
  onRemoveFile?: (id: string) => void;
  /** Dropped or picked files/images → draft attachments. */
  onAddFiles?: (files: File[]) => void;
  /** Capture a region, display, or window, edit it, then attach. */
  onCaptureScreenshot?: (
    mode: "region" | "screen" | "window",
    options?: { keepParentVisible?: boolean },
  ) => void;
  screenshotError?: string | null;
  /** Workspace control shown above the input (new chat: editable; session: locked). */
  workspace?: WorkspaceProps;
  /** Branch chip + isolated-worktree opt-in, shown above the input. */
  worktree?: WorktreeBarProps;
  /** Agent progress line while the worktree is being created. */
  worktreeProgress?: string;
  /**
   * Cwd used to discover slash skills (`grok inspect --json`).
   * Prefer the active workspace so project skills resolve correctly.
   */
  slashCwd?: string;
  /** Increment to force-reload slash skill cache (e.g. after plugin changes). */
  slashRefreshKey?: number;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  models: ModelState;
  onModelChange: (modelId: string, reasoningEffort?: string | null) => void;
  /**
   * Context-window gauge next to the model chip. Omit the prop entirely to hide
   * it (panes that do not track usage); null means "no usage reported yet".
   */
  contextUsage?: ContextUsage | null;
  /**
   * STT language preference from Settings (`auto` or catalog code).
   * Resolved CLI-style in the main process before the API call.
   */
  voiceSttLanguage?: string;
};

function formatSize(bytes?: number): string {
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Voice (console-aligned):
 * - Mic click: toggle recording. Live text → input. Mic again = stop keep text.
 * - Enter while recording: stop + send.
 * - Hold Left ⌥: record while held; release = stop keep text.
 * Both stream partials into the composer while speaking.
 */
/** Wait before Option-hold starts dictation (avoids Option+letter diacritics). */
const OPTION_PTT_ARM_MS = 70;

function joinDraft(base: string, spoken: string): string {
  const t = spoken.trim();
  if (!t) return base;
  const cur = base.replace(/\s+$/, "");
  return cur ? `${cur} ${t}` : t;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled,
  busy,
  promptQueue = [],
  onSendNowQueued,
  onRemoveQueued,
  placeholder,
  pendingImages = [],
  pendingFiles = [],
  onRemoveImage,
  onRemoveFile,
  onAddFiles,
  onCaptureScreenshot,
  screenshotError,
  workspace,
  worktree,
  worktreeProgress,
  slashCwd,
  slashRefreshKey = 0,
  permissionMode,
  onPermissionModeChange,
  models,
  onModelChange,
  contextUsage,
  voiceSttLanguage = "auto",
}: ComposerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const voiceSttLanguageRef = useRef(voiceSttLanguage);
  voiceSttLanguageRef.current = voiceSttLanguage;
  /**
   * IME composition latch. After Space/digit confirm, Enter must still send.
   * Only the rare compositionend-before-Enter race swallows one Enter.
   */
  const imeLatch = useRef(createImeCompositionLatch());
  const [menu, setMenu] = useState<ComposerMenu>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const voice = useVoiceInput();
  const voiceActive = voice.phase !== "idle";
  /** Which gesture owns capture: mic toggle vs Option hold. */
  const [voiceMode, setVoiceMode] = useState<"ptt" | "toggle" | null>(null);
  const voiceModeRef = useRef<"ptt" | "toggle" | null>(null);
  voiceModeRef.current = voiceMode;
  const voicePhaseRef = useRef(voice.phase);
  voicePhaseRef.current = voice.phase;
  const voiceApiRef = useRef(voice);
  voiceApiRef.current = voice;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  /** Composer text when dictation started (partials replace after this base). */
  const voiceBaseRef = useRef("");
  /** PTT held: Left ⌥. */
  const pttHeldRef = useRef(false);
  const pttArmedRef = useRef(false);
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Prevent double finish on rapid PTT release / mic click. */
  const voiceClosingRef = useRef(false);

  const hasAttachments =
    pendingImages.length > 0 || pendingFiles.length > 0;
  // Allow attach while busy so follow-ups can carry files/screenshots.
  const canAcceptFiles = !!onAddFiles && !disabled && !voiceActive;

  const slash = useSlashCommands({
    value,
    onChange,
    cwd: slashCwd,
    disabled,
    refreshKey: slashRefreshKey,
    focusInput: () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    },
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    const latch = imeLatch.current;
    return () => latch.dispose();
  }, []);

  useEffect(() => {
    if (!menu && !slash.open) return;
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node;
      if (footerRef.current?.contains(t) || bodyRef.current?.contains(t)) return;
      setMenu(null);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      // Voice mode owns Escape (cancel recording).
      if (voicePhaseRef.current !== "idle") return;
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, slash.open]);

  // Prevent Electron/Chromium from navigating when a file is dropped
  // outside the composer (only the input card accepts attachments).
  useEffect(() => {
    function isFileDrag(e: globalThis.DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }
    function onWindowDragOver(e: globalThis.DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    }
    function onWindowDrop(e: globalThis.DragEvent) {
      if (!isFileDrag(e)) return;
      // Composer handles its own drop; swallow the rest.
      if (bodyRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
    }
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  const clearVoiceMode = useCallback(() => {
    voiceModeRef.current = null;
    setVoiceMode(null);
    voiceClosingRef.current = false;
    voiceBaseRef.current = "";
  }, []);

  const applyPartialToComposer = useCallback((spoken: string) => {
    const next = joinDraft(voiceBaseRef.current, spoken);
    onChangeRef.current(next);
    valueRef.current = next;
  }, []);

  const focusComposerEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    });
  }, []);

  /** Stop recording; keep whatever text is in the box (finalize partial). */
  const stopVoiceKeepText = useCallback(async () => {
    if (voiceClosingRef.current) return;
    if (voicePhaseRef.current === "idle") {
      clearVoiceMode();
      return;
    }
    voiceClosingRef.current = true;
    try {
      const finalText = await voiceApiRef.current.stop();
      if (finalText) applyPartialToComposer(finalText);
      focusComposerEnd();
    } finally {
      clearVoiceMode();
    }
  }, [applyPartialToComposer, clearVoiceMode, focusComposerEnd]);

  /** Stop recording and submit in one step (Enter / ↑ while dictating). */
  const stopVoiceAndSend = useCallback(async () => {
    if (voiceClosingRef.current) return;
    voiceClosingRef.current = true;
    const base = voiceBaseRef.current;
    // Snapshot draft before stop() clears live STT state.
    const draftBeforeStop = valueRef.current;
    try {
      const finalText = await voiceApiRef.current.stop();
      const toSend = finalText?.trim()
        ? joinDraft(base, finalText)
        : draftBeforeStop;
      onChangeRef.current(toSend);
      valueRef.current = toSend;
      clearVoiceMode();
      if (toSend.trim()) onSubmitRef.current(toSend);
      else focusComposerEnd();
    } catch {
      clearVoiceMode();
    }
  }, [clearVoiceMode, focusComposerEnd]);

  const beginVoice = useCallback(
    async (mode: "ptt" | "toggle") => {
      if (disabledRef.current) return false;
      if (voicePhaseRef.current !== "idle") return false;
      setMenu(null);
      // Mic click can interrupt IME; don't leave composing stuck (blocks Enter).
      imeLatch.current.reset();
      voiceBaseRef.current = valueRef.current;
      voiceModeRef.current = mode;
      setVoiceMode(mode);
      const ok = await voiceApiRef.current.start({
        onPartial: applyPartialToComposer,
        language: voiceSttLanguageRef.current,
      });
      if (!ok) {
        clearVoiceMode();
        return false;
      }
      focusComposerEnd();
      return true;
    },
    [applyPartialToComposer, clearVoiceMode, focusComposerEnd],
  );

  /** Mic click: only starts recording. Stop is via the stop button (toggle) or ⌥ release (PTT). */
  const handleMicClick = useCallback(() => {
    if (disabledRef.current) return;
    if (voicePhaseRef.current !== "idle") return;
    void beginVoice("toggle");
  }, [beginVoice]);

  const startPttVoice = useCallback(async () => {
    if (!pttHeldRef.current) return;
    const ok = await beginVoice("ptt");
    if (!ok) return;
    // Released while mic was opening → stop keep text.
    if (!pttHeldRef.current && voiceModeRef.current === "ptt") {
      void stopVoiceKeepText();
    }
  }, [beginVoice, stopVoiceKeepText]);

  /**
   * Global voice keys:
   * - Hold Left ⌥ → record; release → stop keep text
   * - Esc while recording → cancel (discard live partial, restore base)
   * - Enter while recording → stop + send (works even if focus left the textarea)
   */
  useEffect(() => {
    const clearPttTimer = () => {
      if (pttTimerRef.current != null) {
        clearTimeout(pttTimerRef.current);
        pttTimerRef.current = null;
      }
    };

    const armPtt = () => {
      if (disabledRef.current) return;
      // Mic-toggle owns the session — ignore PTT.
      if (voiceModeRef.current === "toggle") return;
      if (voiceModeRef.current === "ptt") return;
      if (voicePhaseRef.current !== "idle") return;
      pttHeldRef.current = true;
      pttArmedRef.current = true;
      clearPttTimer();
      pttTimerRef.current = setTimeout(() => {
        pttTimerRef.current = null;
        if (!pttHeldRef.current || !pttArmedRef.current) return;
        void startPttVoice();
      }, OPTION_PTT_ARM_MS);
    };

    const releasePtt = () => {
      const wasHeld = pttHeldRef.current;
      pttHeldRef.current = false;
      pttArmedRef.current = false;
      clearPttTimer();
      if (wasHeld && voiceModeRef.current === "ptt") {
        void stopVoiceKeepText();
      }
    };

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.code === "AltLeft") {
        if (e.repeat) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        const t = e.target as HTMLElement | null;
        if (
          t &&
          !bodyRef.current?.contains(t) &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable)
        ) {
          return;
        }
        armPtt();
        return;
      }

      // Option+key typing → abort PTT arm so we don't steal diacritic input.
      if (pttHeldRef.current && e.code !== "AltLeft") {
        pttArmedRef.current = false;
        clearPttTimer();
      }

      if (voicePhaseRef.current === "idle" && voiceModeRef.current == null) {
        return;
      }

      // Esc while recording: discard live partial, restore pre-voice base.
      if (e.key === "Escape" && voicePhaseRef.current !== "idle") {
        e.preventDefault();
        e.stopPropagation();
        voiceApiRef.current.cancel();
        onChangeRef.current(voiceBaseRef.current);
        valueRef.current = voiceBaseRef.current;
        clearVoiceMode();
        return;
      }

      // Enter while recording: stop + send. Capture-phase so it still works
      // when focus is on the mic/stop/send chrome (textarea never sees the key).
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.repeat &&
        (voicePhaseRef.current === "recording" ||
          voicePhaseRef.current === "stopping")
      ) {
        // Live IME only — post-end latch must not block stop+send on voice.
        if (isImeKeyEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        void stopVoiceAndSend();
      }
    };

    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.code !== "AltLeft") return;
      releasePtt();
    };

    const onBlur = () => {
      releasePtt();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      clearPttTimer();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [clearVoiceMode, startPttVoice, stopVoiceAndSend, stopVoiceKeepText]);

  function onCompositionStart() {
    imeLatch.current.onCompositionStart();
  }

  function onCompositionEnd() {
    imeLatch.current.onCompositionEnd();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    imeLatch.current.observeKey(e);

    // Enter: resolve IME first (send / stop+send / slash). Avoid accidental newline.
    if (e.key === "Enter" && !e.shiftKey) {
      const enter = imeLatch.current.decideEnter(e);
      // Live IME: let the engine confirm the candidate (no preventDefault).
      if (enter === "live-ime") return;
      // compositionend-before-Enter race: block newline + do not send.
      if (enter === "swallow") {
        e.preventDefault();
        return;
      }

      // Recording: Enter = stop + send (global capture also handles this).
      if (
        voicePhaseRef.current === "recording" ||
        voicePhaseRef.current === "stopping"
      ) {
        e.preventDefault();
        if (disabled) return;
        void stopVoiceAndSend();
        return;
      }

      // Normal Enter — slash may claim it, else send.
      if (slash.onKeyDown(e)) return;
      e.preventDefault();
      if (disabled) return;
      // Idle: send. Busy + text: enqueue. Busy + empty: Send now (top of queue).
      if (value.trim() || hasAttachments || busy) {
        onSubmit();
      }
      return;
    }

    // During live IME composition, do not hijack other keys (arrows, etc.).
    if (imeLatch.current.shouldIgnoreKey(e)) return;

    if (slash.onKeyDown(e)) return;
  }

  function toggleMenu(
    which: NonNullable<ComposerMenu>,
    e: ReactMouseEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setMenu((cur) => (cur === which ? null : which));
  }

  function hasFilePayload(e: DragEvent) {
    return Array.from(e.dataTransfer?.types ?? []).includes("Files");
  }

  function onDragEnter(e: DragEvent) {
    if (!canAcceptFiles || !hasFilePayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
  }

  function onDragOver(e: DragEvent) {
    if (!canAcceptFiles || !hasFilePayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent) {
    if (!canAcceptFiles) return;
    e.preventDefault();
    e.stopPropagation();
    // Ignore leave events that stay inside the composer card.
    const next = e.relatedTarget as Node | null;
    if (next && bodyRef.current?.contains(next)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    if (!canAcceptFiles || !onAddFiles) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    const files = extractTransferFiles(e.dataTransfer);
    if (files.length === 0) return;
    onAddFiles(files);
  }

  /** ⌘/Ctrl+V of a screenshot or copied file → draft attachment. */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!canAcceptFiles || !onAddFiles) return;
    const files = extractTransferFiles(e.clipboardData);
    if (files.length === 0) return;
    // Consume the paste so the image is not also inserted as markup/text.
    e.preventDefault();
    onAddFiles(files);
  }

  /** Open OS file dialog — only via the + menu, never a visible control. */
  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (list && list.length > 0 && onAddFiles) {
      onAddFiles(Array.from(list));
    }
    // Allow selecting the same file again later.
    e.target.value = "";
  }

  // Draft ready to send (or enqueue while busy).
  const hasDraft = !!value.trim() || hasAttachments;
  // While busy: empty Enter / send can promote top of queue (Send now).
  // While recording: Enter / send = stop+send.
  const canSend =
    !disabled &&
    (voiceActive ||
      hasDraft ||
      (busy && promptQueue.length > 0));
  /**
   * Busy UX: one primary action when not dictating.
   * - no draft → Stop (cancel running turn)
   * - has draft → Send (enqueue follow-up)
   */
  const showStop = busy && !hasDraft && !voiceActive;

  return (
    <div className="composer-wrap">
      {workspace || worktree ? (
        <div className="composer-context-row">
          {workspace ? (
            <WorkspacePicker workspace={workspace} disabled={disabled} />
          ) : null}
          {worktree ? <WorktreeBar {...worktree} disabled={disabled} /> : null}
        </div>
      ) : null}
      {worktreeProgress ? (
        <div className="worktree-progress" role="status">
          {worktreeProgress}
        </div>
      ) : null}
      {promptQueue.length > 0 && onSendNowQueued && onRemoveQueued ? (
        <PromptQueue
          items={promptQueue}
          onSendNow={onSendNowQueued}
          onRemove={onRemoveQueued}
          disabled={disabled}
        />
      ) : null}
      <div
        className={`composer${dragOver ? " drag-over" : ""}${voiceActive ? " composer-dictating" : ""}`}
        ref={bodyRef}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {hasAttachments ? (
          <div
            className="composer-attachments"
            aria-label={t("composer.attachments")}
          >
            {pendingImages.map((img) => (
              <ComposerImageAttachment
                key={img.id}
                image={img}
                onRemove={onRemoveImage}
              />
            ))}
            {pendingFiles.map((file) => (
              <div
                key={file.id}
                className="composer-attachment composer-attachment-file"
                title={file.path || file.name}
              >
                <div className="composer-file-chip">
                  <span className="composer-file-name">{file.name}</span>
                  {file.size != null ? (
                    <span className="composer-file-meta">
                      {formatSize(file.size)}
                    </span>
                  ) : null}
                </div>
                {onRemoveFile ? (
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    onClick={() => onRemoveFile(file.id)}
                    title={t("common.remove")}
                    aria-label={t("composer.removeNamed", { name: file.name })}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {slash.open ? (
          <SlashCommandMenu
            commands={slash.filtered}
            activeIndex={slash.activeIndex}
            loading={slash.loading}
            error={slash.error}
            onHover={slash.setActiveIndex}
            onSelect={slash.select}
          />
        ) : null}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            if (menu) setMenu(null);
            onChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onBlur={() => {
            // Blur can cancel IME without compositionend; clear stuck latch.
            imeLatch.current.reset();
          }}
          disabled={disabled}
          // Live partials own the "spoken" segment; keep base stable while recording.
          // Enter still works (readOnly blocks typing, not key handlers) → stop + send.
          readOnly={voice.phase === "recording" || voice.phase === "stopping"}
          placeholder={
            voiceActive
              ? t("composer.listening")
              : (placeholder ?? t("composer.messagePlaceholder"))
          }
          rows={2}
          aria-autocomplete={slash.open ? "list" : undefined}
          aria-expanded={slash.open ? true : undefined}
        />
        {canAcceptFiles ? (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="composer-file-input"
            onChange={onFileInputChange}
            tabIndex={-1}
            aria-hidden
          />
        ) : null}
        {/* Footer layout stays fixed — only a tiny wave appears by the mic. */}
        <div className="composer-footer" ref={footerRef}>
          <div className="composer-toolbar">
            {onCaptureScreenshot || onAddFiles ? (
              <AttachMenu
                menu={menu}
                toggleMenu={toggleMenu}
                closeMenu={() => setMenu(null)}
                disabled={disabled || voiceActive}
                onCaptureScreenshot={onCaptureScreenshot}
                onChooseFiles={onAddFiles ? openFilePicker : undefined}
              />
            ) : null}
            <PermissionMenu
              menu={menu}
              toggleMenu={toggleMenu}
              closeMenu={() => setMenu(null)}
              disabled={disabled || voiceActive}
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
            />
          </div>

          <div className="composer-actions">
            <ModelMenu
              menu={menu}
              toggleMenu={toggleMenu}
              closeMenu={() => setMenu(null)}
              disabled={disabled || voiceActive}
              models={models}
              onModelChange={onModelChange}
            />
            {/* Absent prop = this pane does not track usage; null = not yet reported. */}
            {contextUsage !== undefined ? (
              <ContextMeter
                menu={menu}
                toggleMenu={toggleMenu}
                disabled={disabled || voiceActive}
                usage={contextUsage}
                models={models}
              />
            ) : null}
            {voiceActive ? (
              /* Recording cluster: wave + stop (model stays left; same footer height). */
              <div
                className="composer-voice-cluster"
                role="group"
                aria-label={t("composer.recording")}
              >
                <VoiceWaveInline levels={voice.levels} active />
                <button
                  type="button"
                  className="composer-voice-stop"
                  disabled={voice.phase === "stopping"}
                  onClick={() => void stopVoiceKeepText()}
                  title={
                    voiceMode === "ptt"
                      ? t("composer.stopRelease")
                      : t("composer.stopKeepText")
                  }
                  aria-label={t("composer.stopRecording")}
                >
                  <StopSquareIcon />
                </button>
                <button
                  type="button"
                  className="composer-submit send"
                  disabled={voice.phase === "stopping"}
                  onClick={() => void stopVoiceAndSend()}
                  title={t("composer.stopAndSend")}
                  aria-label={t("composer.stopAndSend")}
                >
                  <ArrowUpIcon />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="composer-mic"
                  disabled={disabled}
                  onClick={handleMicClick}
                  title={t("composer.startVoice")}
                  aria-label={t("composer.startVoiceAria")}
                >
                  <MicIcon />
                </button>
                {showStop ? (
                  <button
                    type="button"
                    className="composer-submit stop"
                    onClick={onCancel}
                    title={t("composer.stop")}
                    aria-label={t("composer.stop")}
                  >
                    <StopSquareIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="composer-submit send"
                    disabled={!canSend}
                    onClick={() => onSubmit()}
                    title={
                      busy
                        ? hasDraft
                          ? t("composer.queueFollowUp")
                          : promptQueue.length > 0
                            ? t("composer.sendTopQueue")
                            : t("composer.send")
                        : t("composer.send")
                    }
                    aria-label={
                      busy && hasDraft
                        ? t("composer.queueFollowUp")
                        : t("composer.send")
                    }
                  >
                    <ArrowUpIcon />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {!voiceActive && voice.error ? (
          <div className="composer-voice-error" role="alert">
            {voice.error}
          </div>
        ) : null}
        {screenshotError ? (
          <div className="composer-voice-error" role="alert">
            {screenshotError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
