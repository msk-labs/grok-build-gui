import { useEffect, useState } from "react";
import { ChatView } from "../chat";
import { Composer } from "../composer";
import type { OpenFileViewRequest } from "../chat/FileChangeBar";
import type {
  ModelState,
  PermissionMode,
} from "../../../electron/preload";
import { prepareFiles } from "../../lib/attachments";
import {
  loadGuiSettings,
  saveGuiSettings,
  subscribeGuiSettings,
  type MessageDisplayMode,
} from "../../lib/guiSettings";
import { uid } from "../../lib/sessionUpdate";
import type { ChatFile, ChatImage, LocalSession } from "../../types/chat";
import type { QueuedPrompt } from "../../types/promptQueue";
import { useTranslation } from "react-i18next";

export type SideTaskSubmit = (
  sessionId: string,
  text: string,
  images: ChatImage[],
  files: ChatFile[],
) => Promise<void> | void;

type Props = {
  session: LocalSession | null;
  workspaceRoot?: string;
  disabled?: boolean;
  promptQueue?: QueuedPrompt[];
  models: ModelState;
  permissionMode: PermissionMode;
  slashRefreshKey?: number;
  voiceSttLanguage?: string;
  onSubmit: SideTaskSubmit;
  onCancel: (sessionId: string) => void;
  onSendNowQueued?: (id: string) => void;
  onRemoveQueued?: (id: string) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onModelChange: (modelId: string, reasoningEffort?: string | null) => void;
  onOpenFile?: (req: OpenFileViewRequest) => void;
};

export function SideTaskPane({
  session,
  workspaceRoot,
  disabled,
  promptQueue = [],
  models,
  permissionMode,
  slashRefreshKey,
  voiceSttLanguage,
  onSubmit,
  onCancel,
  onSendNowQueued,
  onRemoveQueued,
  onPermissionModeChange,
  onModelChange,
  onOpenFile,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [messageDisplayMode, setMessageDisplayMode] =
    useState<MessageDisplayMode>(
      () => loadGuiSettings().messageDisplayMode,
    );
  const sessionId = session?.id ?? "";
  const busy = !!session?.running;
  const blocked = disabled || !sessionId;

  useEffect(() => {
    return subscribeGuiSettings((s) => {
      setMessageDisplayMode(s.messageDisplayMode);
    });
  }, []);

  async function submit(overrideText?: string) {
    const value = (overrideText ?? text).trim();
    if (blocked) return;
    if (!value && pendingImages.length === 0 && pendingFiles.length === 0) {
      if (busy && promptQueue[0] && onSendNowQueued) {
        onSendNowQueued(promptQueue[0].id);
      }
      return;
    }
    const images = pendingImages;
    const files = pendingFiles;
    setText("");
    setPendingImages([]);
    setPendingFiles([]);
    await onSubmit(sessionId, value, images, files);
  }

  async function addFiles(files: File[]) {
    const prepared = await prepareFiles(files);
    if (prepared.errors.length > 0) {
      console.warn("[grok-gui] side task attach:", prepared.errors.join("; "));
    }
    setPendingImages((prev) => [...prev, ...prepared.images]);
    setPendingFiles((prev) => [...prev, ...prepared.files]);
  }

  async function captureScreenshot(
    mode: "region" | "screen" | "window",
    options?: { keepParentVisible?: boolean },
  ) {
    if (!window.grok?.captureScreenshot || blocked) return;
    setScreenshotError(null);
    const result = await window.grok.captureScreenshot(mode, options);
    if (!result.ok) {
      console.warn("[grok-gui] side task captureScreenshot:", result.error);
      setScreenshotError(t("composer.captureFailed", { message: result.error }));
      return;
    }
    if (result.cancelled) return;
    setPendingImages((prev) => [
      ...prev,
      {
        id: uid("img"),
        mimeType: result.image.mimeType,
        dataUrl: result.image.dataUrl,
        width: result.image.width,
        height: result.image.height,
        data: result.image.data,
      },
    ]);
  }

  return (
    <div className="side-task-pane">
      <ChatView
        messages={session?.messages ?? []}
        workspaceRoot={workspaceRoot}
        onOpenFile={onOpenFile}
        messageDisplayMode={messageDisplayMode}
        onExitMarkdownView={() => {
          saveGuiSettings({
            ...loadGuiSettings(),
            messageDisplayMode: "rendered",
          });
        }}
        emptyHint={
          session
            ? t("tools.sideTaskHint")
            : t("tools.creatingSideTask")
        }
      />
      <Composer
        value={text}
        onChange={setText}
        onSubmit={(value) => void submit(value)}
        onCancel={() => onCancel(sessionId)}
        /* Keep the draft editable while session/new finishes. submit() retains
           the draft until a real session id is available. */
        disabled={!!disabled}
        busy={busy}
        promptQueue={promptQueue}
        onSendNowQueued={onSendNowQueued}
        onRemoveQueued={onRemoveQueued}
        pendingImages={pendingImages}
        pendingFiles={pendingFiles}
        onRemoveImage={(id) =>
          setPendingImages((prev) => prev.filter((image) => image.id !== id))
        }
        onRemoveFile={(id) =>
          setPendingFiles((prev) => prev.filter((file) => file.id !== id))
        }
        onAddFiles={(files) => void addFiles(files)}
        onCaptureScreenshot={(mode, options) =>
          void captureScreenshot(mode, options)
        }
        screenshotError={screenshotError}
        permissionMode={permissionMode}
        onPermissionModeChange={onPermissionModeChange}
        models={models}
        onModelChange={onModelChange}
        slashCwd={workspaceRoot}
        slashRefreshKey={slashRefreshKey}
        voiceSttLanguage={voiceSttLanguage}
        placeholder={t("tools.askSideTask")}
      />
    </div>
  );
}
