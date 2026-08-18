import type {
  AssistantBlock,
  ChatImage,
  ChatMessage,
  ToolCallItem,
  ToolContent,
  ToolImageContent,
  ToolVideoContent,
} from "../types/chat";
import {
  isImagePath,
  isVideoPath,
  mimeFromPath,
} from "./toolImages";

type SessionUpdate = {
  sessionUpdate?: string;
  /**
   * Dual-use:
   * - message chunks: single { type, text }
   * - tool_call / tool_call_update: ToolCallContent[] (content | diff)
   */
  content?:
    | {
        type?: string;
        text?: string;
        data?: string;
        mimeType?: string;
        uri?: string;
      }
    | Array<Record<string, unknown>>
    | null;
  title?: string;
  status?: string;
  kind?: string;
  toolCallId?: string;
  locations?: Array<{ path?: string; line?: number | null }>;
  rawInput?: unknown;
  rawOutput?: unknown;
};

type MessageContent = Exclude<
  SessionUpdate["content"],
  Array<Record<string, unknown>> | null | undefined
>;

/** Message-chunk content is a single text block, not a tool content array. */
function textChunk(
  content: SessionUpdate["content"],
): string | null {
  if (!content || Array.isArray(content)) return null;
  if (content.type !== "text" || typeof content.text !== "string") return null;
  return content.text;
}

/** Restore a user image emitted during `session/load` replay. */
function userImageChunk(content: SessionUpdate["content"]): ChatImage | null {
  if (!content || Array.isArray(content) || content.type !== "image") {
    return null;
  }
  const image = content as MessageContent;
  const mimeType =
    typeof image.mimeType === "string" && image.mimeType.startsWith("image/")
      ? image.mimeType
      : "image/png";
  const data = typeof image.data === "string" ? image.data.trim() : "";
  const uri = typeof image.uri === "string" ? image.uri.trim() : "";
  const dataUrl = data
    ? data.startsWith("data:")
      ? data
      : `data:${mimeType};base64,${data}`
    : uri.startsWith("data:")
      ? uri
      : "";
  if (!dataUrl) return null;
  return {
    id: uid("img"),
    mimeType,
    dataUrl,
  };
}

function imageFromInner(inner: Record<string, unknown>): ToolImageContent | null {
  if (inner.type !== "image") return null;
  const mimeType =
    typeof inner.mimeType === "string" && inner.mimeType
      ? inner.mimeType
      : "image/png";
  const data = typeof inner.data === "string" && inner.data ? inner.data : undefined;
  const uri = typeof inner.uri === "string" && inner.uri ? inner.uri : undefined;
  // Prefer embedded bytes; fall back to uri when it looks like a file path.
  if (data) {
    return { type: "image", mimeType, data, path: uri, filename: basename(uri) };
  }
  if (uri && (isImagePath(uri) || uri.startsWith("file:"))) {
    const filePath = uri.startsWith("file:") ? uri.replace(/^file:\/\//, "") : uri;
    return {
      type: "image",
      mimeType: mimeFromPath(filePath) || mimeType,
      path: filePath,
      filename: basename(filePath),
    };
  }
  return null;
}

function imageFromPathFields(
  pathVal: unknown,
  filename?: unknown,
  mimeHint?: unknown,
): ToolImageContent | null {
  if (typeof pathVal !== "string" || !pathVal.trim()) return null;
  const filePath = pathVal.trim();
  if (!isImagePath(filePath) && !(typeof mimeHint === "string" && mimeHint.startsWith("image/"))) {
    return null;
  }
  const mimeType =
    typeof mimeHint === "string" && mimeHint.startsWith("image/")
      ? mimeHint
      : mimeFromPath(filePath);
  const name =
    typeof filename === "string" && filename.trim()
      ? filename.trim()
      : basename(filePath);
  return { type: "image", mimeType, path: filePath, filename: name };
}

function videoFromPathFields(
  pathVal: unknown,
  filename?: unknown,
  mimeHint?: unknown,
  uploadedUrl?: unknown,
): ToolVideoContent | null {
  const url =
    typeof uploadedUrl === "string" && uploadedUrl.trim()
      ? uploadedUrl.trim()
      : undefined;
  const filePath =
    typeof pathVal === "string" && pathVal.trim() ? pathVal.trim() : "";

  if (filePath && (isVideoPath(filePath) || (typeof mimeHint === "string" && mimeHint.startsWith("video/")))) {
    const mimeType =
      typeof mimeHint === "string" && mimeHint.startsWith("video/")
        ? mimeHint
        : mimeFromPath(filePath);
    const name =
      typeof filename === "string" && filename.trim()
        ? filename.trim()
        : basename(filePath);
    return {
      type: "video",
      mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4",
      path: filePath,
      filename: name,
      uploadedUrl: url,
    };
  }

  // ZDR: remote-only video (no local path).
  if (url && /^https?:\/\//i.test(url)) {
    const name =
      typeof filename === "string" && filename.trim()
        ? filename.trim()
        : basename(url.split("?")[0]);
    return {
      type: "video",
      mimeType:
        typeof mimeHint === "string" && mimeHint.startsWith("video/")
          ? mimeHint
          : "video/mp4",
      filename: name,
      uploadedUrl: url,
    };
  }
  return null;
}

/** Imagine tools return JSON text + rawOutput { type: ImageEdit|ImageGen|…, path }. */
function mediaFromRawOutput(
  raw: unknown,
): { image?: ToolImageContent; video?: ToolVideoContent } {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === "string" ? o.type : "";
  if (type === "ImageToVideo" || type === "ReferenceToVideo") {
    return {
      video:
        videoFromPathFields(o.path, o.filename, o.mimeType, o.uploaded_url) ??
        undefined,
    };
  }
  if (type === "ImageEdit" || type === "ImageGen") {
    return {
      image: imageFromPathFields(o.path, o.filename, o.mimeType) ?? undefined,
    };
  }
  // Untyped path fallback.
  if (typeof o.path === "string") {
    if (isVideoPath(o.path)) {
      return {
        video:
          videoFromPathFields(o.path, o.filename, o.mimeType, o.uploaded_url) ??
          undefined,
      };
    }
    if (isImagePath(o.path)) {
      return {
        image: imageFromPathFields(o.path, o.filename, o.mimeType) ?? undefined,
      };
    }
  }
  if (typeof o.uploaded_url === "string") {
    return {
      video:
        videoFromPathFields(o.path, o.filename, o.mimeType, o.uploaded_url) ??
        undefined,
    };
  }
  return {};
}

function mediaFromResultText(
  text: string,
): { image?: ToolImageContent; video?: ToolVideoContent } {
  const t = text.trim();
  if (!t.startsWith("{") || (!t.includes("path") && !t.includes("uploaded_url"))) {
    return {};
  }
  try {
    return mediaFromRawOutput(JSON.parse(t) as Record<string, unknown>);
  } catch {
    return {};
  }
}

function basename(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || undefined;
}

function parseToolContent(
  raw: unknown,
  rawOutput?: unknown,
): ToolContent[] | undefined {
  const out: ToolContent[] = [];
  const seenKeys = new Set<string>();

  const pushImage = (img: ToolImageContent | null | undefined) => {
    if (!img) return;
    const key = img.path || (img.data ? `data:${img.data.slice(0, 32)}` : "");
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    out.push(img);
  };

  const pushVideo = (vid: ToolVideoContent | null | undefined) => {
    if (!vid) return;
    const key =
      vid.path ||
      vid.uploadedUrl ||
      (vid.filename ? `video:${vid.filename}` : "");
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    out.push(vid);
  };

  const pushMedia = (m: { image?: ToolImageContent; video?: ToolVideoContent }) => {
    pushImage(m.image);
    pushVideo(m.video);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (o.type === "diff" && typeof o.path === "string") {
        out.push({
          type: "diff",
          path: o.path,
          oldText:
            typeof o.oldText === "string"
              ? o.oldText
              : o.oldText == null
                ? null
                : String(o.oldText),
          newText: typeof o.newText === "string" ? o.newText : "",
        });
        continue;
      }
      // Content wrapper: { type: "content", content: { type: "text"|"image", ... } }
      if (o.type === "content" && o.content && typeof o.content === "object") {
        const inner = o.content as Record<string, unknown>;
        const asImage = imageFromInner(inner);
        if (asImage) {
          pushImage(asImage);
          continue;
        }
        if (typeof inner.text === "string" && inner.text.length > 0) {
          out.push({ type: "content", text: inner.text });
          pushMedia(mediaFromResultText(inner.text));
        }
        continue;
      }
      // Bare text / image blocks
      if (o.type === "text" && typeof o.text === "string" && o.text.length > 0) {
        out.push({ type: "content", text: o.text });
        pushMedia(mediaFromResultText(o.text));
        continue;
      }
      if (o.type === "image") {
        pushImage(imageFromInner(o));
      }
    }
  }

  pushMedia(mediaFromRawOutput(rawOutput));

  return out.length > 0 ? out : undefined;
}

type SessionNotification = {
  sessionId?: string;
  update?: SessionUpdate;
  _meta?: { isReplay?: boolean };
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function finishStreamingAssistant(messages: ChatMessage[]): ChatMessage[] {
  const next = [...messages];
  const now = Date.now();
  for (let i = next.length - 1; i >= 0; i--) {
    const m = next[i];
    if (m.role === "assistant" && m.streaming) {
      next[i] = { ...m, streaming: false, finishedAt: m.finishedAt ?? now };
      break;
    }
  }
  return next;
}

function ensureAssistant(messages: ChatMessage[]): {
  messages: ChatMessage[];
  index: number;
} {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last && last.role === "assistant" && last.streaming) {
    return { messages: next, index: next.length - 1 };
  }
  next.push({
    id: uid("a"),
    role: "assistant",
    blocks: [],
    streaming: true,
    createdAt: Date.now(),
  });
  return { messages: next, index: next.length - 1 };
}

function ensureUser(messages: ChatMessage[]): {
  messages: ChatMessage[];
  index: number;
} {
  let next = finishStreamingAssistant(messages);
  const last = next[next.length - 1];
  if (last && last.role === "user") {
    return { messages: next, index: next.length - 1 };
  }
  next = [...next];
  next.push({
    id: uid("u"),
    role: "user",
    text: "",
    createdAt: Date.now(),
  });
  return { messages: next, index: next.length - 1 };
}

function appendTextBlock(
  blocks: AssistantBlock[],
  text: string,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.type === "text") {
    const next = blocks.slice();
    next[next.length - 1] = { ...last, text: last.text + text };
    return next;
  }
  return [...blocks, { type: "text", id: uid("txt"), text }];
}

function appendThoughtBlock(
  blocks: AssistantBlock[],
  text: string,
): AssistantBlock[] {
  const last = blocks[blocks.length - 1];
  if (last?.type === "thought") {
    const next = blocks.slice();
    next[next.length - 1] = { ...last, text: last.text + text };
    return next;
  }
  return [...blocks, { type: "thought", id: uid("th"), text }];
}

function mergeTool(prev: ToolCallItem, item: ToolCallItem): ToolCallItem {
  return {
    ...prev,
    ...item,
    // Prefer newer non-empty fields from the update payload.
    title: item.title || prev.title,
    status: item.status || prev.status,
    kind: item.kind ?? prev.kind,
    locations: item.locations ?? prev.locations,
    // Content is replace-when-present (ACP sends full content on update).
    content: item.content ?? prev.content,
    contentPreview: item.contentPreview ?? prev.contentPreview,
  };
}

function upsertToolBlock(
  blocks: AssistantBlock[],
  item: ToolCallItem,
): AssistantBlock[] {
  const idx = blocks.findIndex(
    (b) => b.type === "tool" && b.tool.id === item.id,
  );
  if (idx >= 0) {
    const next = blocks.slice();
    const prev = next[idx];
    if (prev?.type !== "tool") return blocks;
    next[idx] = {
      type: "tool",
      tool: mergeTool(prev.tool, item),
    };
    return next;
  }
  return [...blocks, { type: "tool", tool: item }];
}

function toolFromUpdate(update: SessionUpdate, id: string): ToolCallItem {
  // Message chunks use a single content object; tools use an array.
  // rawOutput carries imagine path metadata when content is only JSON text.
  const content = parseToolContent(
    Array.isArray(update.content) ? update.content : undefined,
    update.rawOutput,
  );
  let contentPreview: string | undefined;
  if (content) {
    const texts = content
      .filter((c): c is { type: "content"; text: string } => c.type === "content")
      .map((c) => c.text)
      // Prefer not to preview imagine metadata JSON in the fold summary.
      .filter((t) => {
        const s = t.trim();
        if (!s.startsWith("{") || !s.includes("path")) return true;
        try {
          const o = JSON.parse(s) as { path?: unknown };
          return typeof o.path !== "string" || !isImagePath(o.path);
        } catch {
          return true;
        }
      });
    if (texts.length > 0) {
      const joined = texts.join("\n");
      contentPreview =
        joined.length > 800 ? `${joined.slice(0, 800)}…` : joined;
    }
  }
  return {
    id,
    title: update.title ?? "Tool call",
    status: update.status ?? "pending",
    kind: update.kind ?? undefined,
    locations: update.locations ?? undefined,
    content,
    contentPreview,
  };
}

/** Apply one ACP `session/update` notification (live or session/load replay). */
export function applySessionUpdate(
  messages: ChatMessage[],
  notification: unknown,
): ChatMessage[] {
  const n = notification as SessionNotification;
  const update = n?.update;
  if (!update?.sessionUpdate) return messages;

  const isReplay = n._meta?.isReplay === true;

  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      // Live turns already insert the user bubble in the UI; only build
      // user messages from agent replay (`session/load`).
      if (!isReplay) return messages;
      const chunk = textChunk(update.content);
      const image = userImageChunk(update.content);
      if (!chunk && !image) return messages;
      const { messages: next, index } = ensureUser(messages);
      const msg = next[index];
      if (msg.role !== "user") return messages;
      next[index] = {
        ...msg,
        text: chunk ? msg.text + chunk : msg.text,
        images: image ? [...(msg.images ?? []), image] : msg.images,
      };
      return next;
    }
    case "agent_message_chunk": {
      const chunk = textChunk(update.content);
      if (!chunk) return messages;
      const { messages: next, index } = ensureAssistant(messages);
      const msg = next[index];
      if (msg.role !== "assistant") return messages;
      const blocks = msg.blocks ?? [];
      next[index] = {
        ...msg,
        blocks: appendTextBlock(blocks, chunk),
      };
      return next;
    }
    case "agent_thought_chunk": {
      const chunk = textChunk(update.content);
      if (!chunk) return messages;
      const { messages: next, index } = ensureAssistant(messages);
      const msg = next[index];
      if (msg.role !== "assistant") return messages;
      const blocks = msg.blocks ?? [];
      next[index] = {
        ...msg,
        blocks: appendThoughtBlock(blocks, chunk),
      };
      return next;
    }
    case "tool_call": {
      const { messages: next, index } = ensureAssistant(messages);
      const msg = next[index];
      if (msg.role !== "assistant") return messages;
      const id = update.toolCallId ?? uid("tool");
      const blocks = msg.blocks ?? [];
      next[index] = {
        ...msg,
        blocks: upsertToolBlock(blocks, toolFromUpdate(update, id)),
      };
      return next;
    }
    case "tool_call_update": {
      const { messages: next, index } = ensureAssistant(messages);
      const msg = next[index];
      if (msg.role !== "assistant") return messages;
      const id = update.toolCallId;
      if (!id) return messages;
      const blocks = msg.blocks ?? [];
      next[index] = {
        ...msg,
        blocks: upsertToolBlock(blocks, toolFromUpdate(update, id)),
      };
      return next;
    }
    default:
      return messages;
  }
}

export function markAssistantDone(messages: ChatMessage[]): ChatMessage[] {
  return finishStreamingAssistant(messages);
}

/**
 * Attach turn artifacts to the newest assistant message.
 *
 * The scan finishes after the turn does, so this runs as a second pass over an
 * already-completed message rather than as part of the update stream.
 */
export function attachTurnArtifacts(
  messages: ChatMessage[],
  paths: string[],
): ChatMessage[] {
  if (paths.length === 0) return messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const next = messages.slice();
    next[i] = { ...msg, artifacts: paths };
    return next;
  }
  return messages;
}

/** After history replay, mark all assistant messages complete. */
export function finalizeHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.role === "assistant" && m.streaming
      ? { ...m, streaming: false, finishedAt: m.finishedAt ?? m.createdAt }
      : m,
  );
}

// ── Fast history fold (session/load) ─────────────────────────────────
//
// Live `applySessionUpdate` copies arrays per chunk (fine for streaming).
// Replaying thousands of agent chunks that way is O(n²) and freezes the UI.
// This path mutates a draft list and joins text parts once per message.

type DraftUser = {
  id: string;
  role: "user";
  textParts: string[];
  images: ChatImage[];
  createdAt: number;
};

type DraftAssistant = {
  id: string;
  role: "assistant";
  blocks: AssistantBlock[];
  /** toolCallId → index in blocks */
  toolIndex: Map<string, number>;
  createdAt: number;
};

type DraftMessage = DraftUser | DraftAssistant;

function draftToMessage(d: DraftMessage): ChatMessage {
  if (d.role === "user") {
    return {
      id: d.id,
      role: "user",
      text: d.textParts.join(""),
      images: d.images.length > 0 ? d.images : undefined,
      createdAt: d.createdAt,
    };
  }
  return {
    id: d.id,
    role: "assistant",
    blocks: d.blocks,
    streaming: false,
    createdAt: d.createdAt,
  };
}

function lastDraft(drafts: DraftMessage[]): DraftMessage | undefined {
  return drafts.length > 0 ? drafts[drafts.length - 1] : undefined;
}

function ensureDraftAssistant(drafts: DraftMessage[]): DraftAssistant {
  const last = lastDraft(drafts);
  if (last?.role === "assistant") return last;
  const a: DraftAssistant = {
    id: uid("a"),
    role: "assistant",
    blocks: [],
    toolIndex: new Map(),
    createdAt: Date.now(),
  };
  drafts.push(a);
  return a;
}

function ensureDraftUser(drafts: DraftMessage[]): DraftUser {
  const last = lastDraft(drafts);
  if (last?.role === "user") return last;
  const u: DraftUser = {
    id: uid("u"),
    role: "user",
    textParts: [],
    images: [],
    createdAt: Date.now(),
  };
  drafts.push(u);
  return u;
}

function draftAppendText(a: DraftAssistant, text: string) {
  const last = a.blocks[a.blocks.length - 1];
  if (last?.type === "text") {
    last.text += text;
  } else {
    a.blocks.push({ type: "text", id: uid("txt"), text });
  }
}

function draftAppendThought(a: DraftAssistant, text: string) {
  const last = a.blocks[a.blocks.length - 1];
  if (last?.type === "thought") {
    last.text += text;
  } else {
    a.blocks.push({ type: "thought", id: uid("th"), text });
  }
}

function draftUpsertTool(a: DraftAssistant, item: ToolCallItem) {
  const existing = a.toolIndex.get(item.id);
  if (existing !== undefined) {
    const prev = a.blocks[existing];
    if (prev?.type === "tool") {
      a.blocks[existing] = {
        type: "tool",
        tool: mergeTool(prev.tool, item),
      };
      return;
    }
  }
  a.toolIndex.set(item.id, a.blocks.length);
  a.blocks.push({ type: "tool", tool: item });
}

/**
 * Incrementally fold ordered `session/load` notifications.
 *
 * The main process feeds replay notifications here as they arrive, avoiding a
 * second raw-history buffer and the post-load burst that previously delayed
 * the first renderer paint.
 */
export class HistoryMessageAccumulator {
  private drafts: DraftMessage[] = [];
  private count = 0;

  push(notification: unknown): void {
    this.count += 1;
    const n = notification as SessionNotification;
    const update = n?.update;
    if (!update?.sessionUpdate) return;

    // History replay always includes isReplay; treat missing as replay when
    // folding a dedicated load stream.
    const isReplay = n._meta?.isReplay !== false;

    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        if (!isReplay) return;
        {
          const chunk = textChunk(update.content);
          if (chunk) ensureDraftUser(this.drafts).textParts.push(chunk);
          const image = userImageChunk(update.content);
          if (image) ensureDraftUser(this.drafts).images.push(image);
        }
        break;
      }
      case "agent_message_chunk": {
        {
          const chunk = textChunk(update.content);
          if (chunk) {
            draftAppendText(ensureDraftAssistant(this.drafts), chunk);
          }
        }
        break;
      }
      case "agent_thought_chunk": {
        {
          const chunk = textChunk(update.content);
          if (chunk) {
            draftAppendThought(ensureDraftAssistant(this.drafts), chunk);
          }
        }
        break;
      }
      case "tool_call": {
        const a = ensureDraftAssistant(this.drafts);
        const id = update.toolCallId ?? uid("tool");
        draftUpsertTool(a, toolFromUpdate(update, id));
        break;
      }
      case "tool_call_update": {
        const id = update.toolCallId;
        if (!id) break;
        draftUpsertTool(
          ensureDraftAssistant(this.drafts),
          toolFromUpdate(update, id),
        );
        break;
      }
      default:
        break;
    }
  }

  get updateCount(): number {
    return this.count;
  }

  finish(): ChatMessage[] {
    return this.drafts.map(draftToMessage);
  }
}

/**
 * Fold an ordered `session/load` notification buffer into chat messages.
 * Kept for compatibility with older history payloads and pure callers.
 */
export function buildMessagesFromNotifications(
  notifications: unknown[],
): ChatMessage[] {
  const accumulator = new HistoryMessageAccumulator();
  for (const notification of notifications) {
    accumulator.push(notification);
  }
  return accumulator.finish();
}

export { uid };
