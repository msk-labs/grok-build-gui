/**
 * Live streaming STT session (same wire protocol as Grok Build pager).
 *
 * Transcript model (mirrors xai-grok-voice pipeline):
 * - non-final partial → live interim (replaced, not stacked)
 * - is_final && !speech_final → lock chunk delta into prefix (long utterance)
 * - speech_final → clean re-transcription of THIS utterance; APPEND to committed
 *   finals and clear interim/prefix (never re-append the half-finished interim)
 */
import { languageForSttWire } from "../renderer/lib/sttLanguage.js";
import { getGrokAccessToken } from "./grokAccount.js";

const STT_WS = "wss://api.x.ai/v1/stt";
const CONNECT_TIMEOUT_MS = 15_000;
const DONE_TIMEOUT_MS = 20_000;

type SttServerEvent = {
  type?: string;
  text?: string;
  message?: string;
  is_final?: boolean;
  speech_final?: boolean;
};

/** Streaming STT snapshot for console-style solid vs interim UI. */
export type LiveSttPartial = {
  /** speech_final utterances (stable, solid black in the prompt). */
  committed: string;
  /** In-progress open utterance (muted gray overlay). */
  interim: string;
  /** committed + interim joined (submit / stop convenience). */
  text: string;
};

export type LiveSttHandlers = {
  onPartial: (partial: LiveSttPartial) => void;
  onError: (message: string) => void;
};

export class LiveSttSession {
  private ws: WebSocket | null = null;
  private ready = false;
  private closed = false;
  /** Finalized utterances only (speech_final results appended). */
  private committed = "";
  /** is_final chunk deltas for the current utterance (stitched). */
  private lockedPrefix = "";
  /** Non-final running partial for the current chunk. */
  private liveInterim = "";
  private audioQueue: Buffer[] = [];
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private doneTimer: ReturnType<typeof setTimeout> | null = null;
  private settle: ((text: string | null) => void) | null = null;
  private settleDone = false;
  private readonly handlers: LiveSttHandlers;

  private constructor(handlers: LiveSttHandlers) {
    this.handlers = handlers;
  }

  static async start(
    opts: {
      sampleRate?: number;
      /** Stored preference (`auto` / catalog code / BCP-47). */
      language?: string;
      /** Browser locale hint when `language` is `auto` (e.g. navigator.language). */
      localeHint?: string;
    },
    handlers: LiveSttHandlers,
  ): Promise<
    { ok: true; session: LiveSttSession } | { ok: false; error: string }
  > {
    const bearer = getGrokAccessToken();
    if (!bearer) {
      return {
        ok: false,
        error: "Not signed in — run `grok login` or set XAI_API_KEY.",
      };
    }

    const sampleRate = opts.sampleRate ?? 16_000;
    // Catalog code, or omit (null) for Chinese free-detect — never "auto"/"zh".
    const language = languageForSttWire(opts.language, opts.localeHint);
    console.log(
      `[voice-live-stt] connect lang=${language ?? "(omit/free-detect)"} stored=${opts.language ?? "(default)"} hint=${opts.localeHint ?? "(none)"} sr=${sampleRate}`,
    );
    const params = new URLSearchParams({
      sample_rate: String(sampleRate),
      encoding: "pcm",
      interim_results: "true",
      endpointing: "400",
    });
    // Omit language for Chinese free-detect; forcing en biases CN→EN output.
    if (language) params.set("language", language);
    const url = `${STT_WS}?${params.toString()}`;

    const session = new LiveSttSession(handlers);
    try {
      await session.connect(url, bearer);
      return { ok: true, session };
    } catch (e) {
      session.abort();
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private connect(url: string, bearer: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        reject(new Error(msg));
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        if (this.connectTimer) clearTimeout(this.connectTimer);
        resolve();
      };

      try {
        this.ws = new (WebSocket as unknown as {
          new (
            address: string,
            options?: { headers?: Record<string, string> },
          ): WebSocket;
        })(url, {
          headers: {
            Authorization: `Bearer ${bearer}`,
            "x-grok-client-identifier": "grok-gui",
            "User-Agent": "grok-gui/0.1",
          },
        });
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return;
      }

      this.ws.binaryType = "arraybuffer";
      this.connectTimer = setTimeout(() => {
        fail("Speech recognition connect timed out.");
      }, CONNECT_TIMEOUT_MS);

      this.ws.onmessage = (ev) => {
        if (this.closed) return;
        let data: SttServerEvent;
        try {
          const raw =
            typeof ev.data === "string"
              ? ev.data
              : Buffer.from(ev.data as ArrayBuffer).toString("utf8");
          data = JSON.parse(raw) as SttServerEvent;
        } catch {
          return;
        }

        if (data.type === "transcript.created") {
          this.ready = true;
          this.flushQueue();
          ok();
          return;
        }
        if (data.type === "transcript.partial") {
          this.handlePartial(data);
          return;
        }
        if (data.type === "transcript.done") {
          const tail = (data.text ?? "").trim();
          if (tail) {
            // Prefer server done text as a final utterance if we never got speech_final.
            this.lockedPrefix = "";
            this.liveInterim = "";
            this.committed = joinSpoken(this.committed, tail);
            this.emit();
          } else {
            // Flush any in-progress interim into committed.
            this.commitOpenUtterance();
          }
          this.finishSettle(this.displayText() || null);
          return;
        }
        if (data.type === "error") {
          const msg = data.message?.trim() || "Speech recognition failed.";
          this.handlers.onError(msg);
          this.finishSettle(this.displayText() || null);
        }
      };

      this.ws.onerror = () => {
        if (!this.ready) {
          fail(
            "Could not connect to speech recognition (check network / SuperGrok).",
          );
        } else if (!this.closed) {
          this.handlers.onError("Speech recognition connection error.");
        }
      };

      this.ws.onclose = () => {
        if (!this.ready && !settled) {
          fail("Speech recognition closed before ready.");
          return;
        }
        this.finishSettle(this.displayText() || null);
      };
    });
  }

  /**
   * Mirror xai-grok-voice pipeline partial handling.
   * speech_final → full re-transcribe of current utterance (append, clear interim).
   * is_final → lock chunk delta; non-final → live preview only.
   */
  private handlePartial(data: SttServerEvent) {
    const text = (data.text ?? "").trim();
    if (!text) return;

    if (data.speech_final) {
      // Clean one-pass re-transcription of this utterance — replaces interim,
      // then appends to committed. Do NOT also keep lockedPrefix/interim.
      this.lockedPrefix = "";
      this.liveInterim = "";
      this.committed = joinSpoken(this.committed, text);
      this.emit();
      return;
    }

    if (data.is_final) {
      // Chunk-final delta: stitch into running prefix for long pauseless speech.
      this.lockedPrefix = joinSpoken(this.lockedPrefix, text);
      this.liveInterim = "";
      this.emit();
      return;
    }

    // Non-final interim: replace liveInterim (never stack half-sentences).
    this.liveInterim = text;
    this.emit();
  }

  private commitOpenUtterance() {
    const open = this.currentOpenUtterance();
    if (!open) return;
    this.committed = joinSpoken(this.committed, open);
    this.lockedPrefix = "";
    this.liveInterim = "";
  }

  private currentOpenUtterance(): string {
    if (this.lockedPrefix && this.liveInterim) {
      return joinSpoken(this.lockedPrefix, this.liveInterim);
    }
    return this.lockedPrefix || this.liveInterim;
  }

  private displayText(): string {
    const open = this.currentOpenUtterance();
    return joinSpoken(this.committed, open).trim();
  }

  private emit() {
    const committed = this.committed.trim();
    const interim = this.currentOpenUtterance().trim();
    const text = joinSpoken(committed, interim).trim();
    // Always emit so the UI can clear interim after speech_final.
    this.handlers.onPartial({ committed, interim, text });
  }

  pushAudio(pcm: Buffer | Uint8Array) {
    if (this.closed) return;
    const buf = Buffer.isBuffer(pcm)
      ? pcm
      : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    if (buf.byteLength === 0) return;
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.audioQueue.push(Buffer.from(buf));
      return;
    }
    try {
      this.ws.send(buf);
    } catch {
      /* ignore */
    }
  }

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of this.audioQueue) {
      try {
        this.ws.send(chunk);
      } catch {
        break;
      }
    }
    this.audioQueue = [];
  }

  stop(): Promise<string | null> {
    if (this.closed) {
      return Promise.resolve(this.displayText() || null);
    }
    return new Promise((resolve) => {
      this.settle = resolve;
      this.flushQueue();
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "finalize" }));
          this.ws.send(JSON.stringify({ type: "audio.done" }));
        } else {
          this.finishSettle(this.displayText() || null);
          return;
        }
      } catch {
        this.finishSettle(this.displayText() || null);
        return;
      }
      this.doneTimer = setTimeout(() => {
        // Flush open interim if server never sent done/speech_final.
        this.commitOpenUtterance();
        this.finishSettle(this.displayText() || null);
      }, DONE_TIMEOUT_MS);
    });
  }

  abort() {
    if (this.settleDone) {
      this.closed = true;
      this.cleanupWs();
      return;
    }
    this.closed = true;
    this.cleanupWs();
    if (this.settle) {
      const s = this.settle;
      this.settle = null;
      this.settleDone = true;
      s(this.displayText() || null);
    }
  }

  private cleanupWs() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.doneTimer) {
      clearTimeout(this.doneTimer);
      this.doneTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        // Avoid onclose re-entrancy surprises.
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
    }
  }

  private finishSettle(text: string | null) {
    if (this.settleDone) return;
    this.settleDone = true;
    this.closed = true;
    this.cleanupWs();
    if (this.settle) {
      const s = this.settle;
      this.settle = null;
      s(text);
    }
  }
}

function joinSpoken(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  if (right.startsWith(left)) return right;
  if (left.endsWith(right)) return left;
  const cjk =
    /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(left) ||
    /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(right);
  if (cjk) return left + right;
  return `${left} ${right}`;
}
