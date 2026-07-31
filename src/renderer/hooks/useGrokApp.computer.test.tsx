// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionState,
  GrokApi,
  ModelState,
  SessionLoadedEvent,
} from "../../electron/preload";
import { Composer } from "../components/composer";
import { useGrokApp } from "./useGrokApp";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const EMPTY_MODELS: ModelState = {
  currentModelId: null,
  currentReasoningEffort: null,
  availableModels: [],
};

const READY_STATE: ConnectionState = {
  status: "ready",
  grokPath: "C:\\fixture\\grok.exe",
  version: "grok 0.2.111",
  sessionId: null,
  cwd: "C:\\fixture",
  models: EMPTY_MODELS,
  permissionMode: "auto",
};

function noopSubscription() {
  return () => undefined;
}

function ComputerSubmitHarness() {
  const app = useGrokApp();
  return (
    <>
      <Composer
        value={app.input}
        onChange={app.setInput}
        onSubmit={(text) => void app.handleSubmit(text)}
        onCancel={app.handleCancel}
        disabled={
          app.state.status === "connecting" ||
          app.state.status === "disconnected" ||
          app.state.status === "error" ||
          app.loadingHistory
        }
        busy={app.busy}
        pendingImages={app.pendingImages}
        pendingFiles={app.pendingFiles}
        permissionMode={app.permissionMode}
        onPermissionModeChange={app.handlePermissionModeChange}
        models={app.models}
        onModelChange={app.handleModelChange}
      />
      <output data-testid="messages">
        {JSON.stringify(app.sessions.flatMap((session) => session.messages))}
      </output>
    </>
  );
}

describe("GUI /computer submission", () => {
  let sessionLoaded:
    | ((event: SessionLoadedEvent) => void)
    | null = null;
  const prompt = vi.fn<GrokApi["prompt"]>(async () => ({ ok: true }));
  const newSession = vi.fn(async () => {
    sessionLoaded?.({
      sessionId: "computer-session",
      cwd: "C:\\fixture",
      isNew: true,
    });
    return {
      ...READY_STATE,
      sessionId: "computer-session",
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionLoaded = null;
    const api: Partial<GrokApi> = {
      getDefaultCwd: vi.fn(async () => "C:\\fixture"),
      getTaskWorkspaceRoot: vi.fn(async () => "C:\\tasks"),
      getState: vi.fn(async () => READY_STATE),
      listSessions: vi.fn(async () => ({
        ok: true,
        sessions: [],
        runningSessionIds: [],
      })),
      newSession,
      prompt,
      onState: vi.fn(noopSubscription),
      onModels: vi.fn(noopSubscription),
      onContextUsage: vi.fn(noopSubscription),
      onSessions: vi.fn(noopSubscription),
      onHistoryStart: vi.fn(noopSubscription),
      onHistoryProgress: vi.fn(noopSubscription),
      onHistoryEnd: vi.fn(noopSubscription),
      onSessionLoaded: vi.fn((listener) => {
        sessionLoaded = listener;
        return () => {
          sessionLoaded = null;
        };
      }),
      onSessionUpdate: vi.fn(noopSubscription),
      onPermission: vi.fn(noopSubscription),
      onPermissionTimeout: vi.fn(noopSubscription),
      onTurn: vi.fn(noopSubscription),
    };
    Object.defineProperty(window, "grok", {
      configurable: true,
      value: api,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "grok");
  });

  it("activates Open Computer Use from the real composer submit path", async () => {
    render(<ComputerSubmitHarness />);
    await act(async () => undefined);

    const textarea = screen.getByRole("textbox");
    await waitFor(() => expect(textarea).not.toHaveProperty("disabled", true));

    fireEvent.change(textarea, {
      target: {
        value: "/computer inspect the screenshot and click the matching button",
      },
    });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    // Second arg is the worktree opt-in; a plain /computer chat opts out.
    expect(newSession).toHaveBeenCalledWith("C:\\fixture", null);

    const [agentText, images, sessionId, files] = prompt.mock.calls[0]!;
    expect(agentText).toContain("Use the Open Computer Use MCP tools");
    expect(agentText).toContain(
      "Do not claim completion from an action result alone",
    );
    expect(agentText.endsWith(
      "inspect the screenshot and click the matching button",
    )).toBe(true);
    expect(images).toBeUndefined();
    expect(sessionId).toBe("computer-session");
    expect(files).toBeUndefined();

    expect(screen.getByTestId("messages").textContent).toContain(
      "/computer inspect the screenshot and click the matching button",
    );
  });
});
