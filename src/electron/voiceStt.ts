/**
 * Speech-to-text via xAI STT — same backend as Grok Build (`xai-grok-voice`).
 *
 * GUI flow is record-then-transcribe (complete clip), so we prefer the REST
 * batch endpoint (`POST https://api.x.ai/v1/stt`). Streaming WebSocket
 * (`wss://api.x.ai/v1/stt`) is the fallback and matches the pager protocol:
 * wait for `transcript.created` → binary PCM frames → `audio.done`.
 *
 * Important: streaming `transcript.done` often arrives with an empty `text`
 * field; the committed utterance is in `transcript.partial` (especially
 * `speech_final`). Never treat empty string as "no partial".
 */

import { languageForSttWire } from "../renderer/lib/sttLanguage.js";
import { getGrokAccessToken } from "./grokAccount.js";

const STT_REST = "https://api.x.ai/v1/stt";
const STT_WS = "wss://api.x.ai/v1/stt";
const CONNECT_TIMEOUT_MS = 15_000;
const DONE_TIMEOUT_MS = 30_000;
const REST_TIMEOUT_MS = 45_000;

export type TranscribePcmOpts = {
  /** PCM16 LE mono bytes. */
  pcm: Buffer | Uint8Array;
  sampleRate?: number;
  /** Stored preference (`auto` / catalog code / BCP-47). */
  language?: string;
  /** Browser locale hint when `language` is `auto`. */
  localeHint?: string;
};

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

type SttServerEvent = {
  type?: string;
  text?: string;
  message?: string;
  is_final?: boolean;
  speech_final?: boolean;
};

function pcmPeakRatio(pcm: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.byteLength; i += 2) {
    const s = Math.abs(pcm.readInt16LE(i)) / 32768;
    if (s > peak) peak = s;
  }
  return peak;
}

/** Minimal WAV (PCM16 LE mono) wrapper for REST STT. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const dataSize = pcm.byteLength;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // audio format = PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

function emptyTranscriptError(peak: number): string {
  return peak >= 0.02
    ? "Model returned empty transcript (audio was captured). Try again or speak more clearly."
    : "No speech detected — try speaking closer to the mic.";
}

/**
 * One-shot STT for a complete PCM16 mono buffer.
 * Prefers REST batch; falls back to streaming WS (Grok Build protocol).
 */
export async function transcribePcm(
  opts: TranscribePcmOpts,
): Promise<TranscribeResult> {
  const bearer = getGrokAccessToken();
  if (!bearer) {
    return {
      ok: false,
      error: "Not signed in — run `grok login` or set XAI_API_KEY.",
    };
  }

  const pcm = Buffer.isBuffer(opts.pcm)
    ? opts.pcm
    : Buffer.from(opts.pcm.buffer, opts.pcm.byteOffset, opts.pcm.byteLength);

  if (pcm.byteLength < 3200) {
    // < ~100ms at 16 kHz mono 16-bit
    return { ok: false, error: "Recording too short — try again." };
  }

  const peak = pcmPeakRatio(pcm);
  if (peak < 0.008) {
    return {
      ok: false,
      error: `Audio is near-silent (peak ${(peak * 100).toFixed(1)}%) — mic capture failed.`,
    };
  }

  const sampleRate = opts.sampleRate ?? 16_000;
  // Catalog code, or omit (null) for Chinese free-detect — never "auto"/"zh".
  const language = languageForSttWire(opts.language, opts.localeHint);

  console.log(
    `[voice-stt] pcm=${pcm.byteLength}B peak=${(peak * 100).toFixed(1)}% lang=${language ?? "(omit/free-detect)"} stored=${opts.language ?? "(default)"} hint=${opts.localeHint ?? "(none)"} sr=${sampleRate}`,
  );

  const rest = await transcribeRest({ pcm, sampleRate, language, bearer, peak });
  if (rest.ok || !isRetriableRestFailure(rest.error)) {
    return rest;
  }

  console.warn(`[voice-stt] REST failed (${rest.error}); falling back to streaming WS`);
  return transcribeStreaming({ pcm, sampleRate, language, bearer, peak });
}

function isRetriableRestFailure(error: string): boolean {
  // Network / 5xx / timeout — try WS. Auth and client errors are final.
  const e = error.toLowerCase();
  if (e.includes("not signed") || e.includes("401") || e.includes("403")) {
    return false;
  }
  return true;
}

async function transcribeRest(opts: {
  pcm: Buffer;
  sampleRate: number;
  /** Catalog code, or null to omit (Chinese free-detect). */
  language: string | null;
  bearer: string;
  peak: number;
}): Promise<TranscribeResult> {
  const { pcm, sampleRate, language, bearer, peak } = opts;
  const wav = pcmToWav(pcm, sampleRate);
  const form = new FormData();
  // file must be last field per xAI STT docs. format=true requires language.
  if (language) {
    form.append("language", language);
    form.append("format", "true");
  }
  form.append(
    "file",
    new Blob([Uint8Array.from(wav)], { type: "audio/wav" }),
    "recording.wav",
  );

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(STT_REST, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "x-grok-client-identifier": "grok-gui",
        "User-Agent": "grok-gui/0.1",
      },
      body: form,
      signal: ac.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      let msg = `Speech recognition failed (HTTP ${res.status}).`;
      try {
        const j = JSON.parse(raw) as { error?: string; message?: string };
        msg = j.error || j.message || msg;
      } catch {
        if (raw.trim()) msg = raw.trim().slice(0, 200);
      }
      if (res.status === 401 || res.status === 403) {
        msg = "Speech recognition unauthorized — run `grok login` or set XAI_API_KEY.";
      }
      return { ok: false, error: msg };
    }
    let data: { text?: string };
    try {
      data = JSON.parse(raw) as { text?: string };
    } catch {
      return { ok: false, error: "Speech recognition returned invalid JSON." };
    }
    const text = (data.text ?? "").trim();
    if (!text) {
      return { ok: false, error: emptyTranscriptError(peak) };
    }
    return { ok: true, text };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Speech recognition timed out." };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming STT — same wire protocol as `xai-grok-voice` StreamingSttSession.
 */
function transcribeStreaming(opts: {
  pcm: Buffer;
  sampleRate: number;
  /** Catalog code, or null to omit (Chinese free-detect). */
  language: string | null;
  bearer: string;
  peak: number;
}): Promise<TranscribeResult> {
  const { pcm, sampleRate, language, bearer, peak } = opts;
  const params = new URLSearchParams({
    sample_rate: String(sampleRate),
    encoding: "pcm",
    interim_results: "true",
    // Match Grok Build default endpointing (ms of silence).
    endpointing: "400",
  });
  if (language) params.set("language", language);
  const url = `${STT_WS}?${params.toString()}`;

  return new Promise<TranscribeResult>((resolve) => {
    let settled = false;
    let ready = false;
    /** Best non-empty partial / speech_final text seen so far. */
    let bestText = "";
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: TranscribeResult) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (doneTimer) clearTimeout(doneTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    // Node / Electron main: undici WebSocket accepts handshake headers.
    let ws: WebSocket;
    try {
      ws = new (WebSocket as unknown as {
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
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    ws.binaryType = "arraybuffer";

    connectTimer = setTimeout(() => {
      finish({ ok: false, error: "Speech recognition connect timed out." });
    }, CONNECT_TIMEOUT_MS);

    const flushAudio = () => {
      // ~100 ms frames at 16 kHz mono 16-bit (docs: real-time-paced chunks).
      const frameBytes = Math.max(640, Math.floor(sampleRate * 0.1) * 2);
      let offset = 0;

      const sendNext = () => {
        if (settled) return;
        if (offset >= pcm.byteLength) {
          try {
            // PTT finalize then end-of-audio (xAI streaming client messages).
            ws.send(JSON.stringify({ type: "finalize" }));
            ws.send(JSON.stringify({ type: "audio.done" }));
          } catch (e) {
            finish({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
            return;
          }
          doneTimer = setTimeout(() => {
            const text = bestText.trim();
            if (text) {
              finish({ ok: true, text });
            } else {
              finish({
                ok: false,
                error: "Speech recognition timed out waiting for transcript.",
              });
            }
          }, DONE_TIMEOUT_MS);
          return;
        }
        const end = Math.min(offset + frameBytes, pcm.byteLength);
        // Copy into a fresh Buffer so the WS layer always gets binary PCM.
        const slice = Buffer.from(pcm.subarray(offset, end));
        offset = end;
        try {
          ws.send(slice);
        } catch (e) {
          finish({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        // Yield so partials can arrive while we stream (not wall-clock paced —
        // clip is already complete; REST is preferred for that path).
        setImmediate(sendNext);
      };
      sendNext();
    };

    const pickText = (candidate?: string): void => {
      const t = (candidate ?? "").trim();
      if (t) bestText = t;
    };

    ws.onmessage = (ev) => {
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
        ready = true;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        flushAudio();
        return;
      }

      if (data.type === "transcript.partial") {
        // speech_final is the clean full-turn text (same as Grok Build pager).
        pickText(data.text);
        return;
      }

      if (data.type === "transcript.done") {
        // Server often sends done with text:"" — fall back to partials.
        const text = (data.text?.trim() || bestText).trim();
        if (!text) {
          finish({ ok: false, error: emptyTranscriptError(peak) });
          return;
        }
        finish({ ok: true, text });
        return;
      }

      if (data.type === "error") {
        finish({
          ok: false,
          error: data.message?.trim() || "Speech recognition failed.",
        });
      }
    };

    ws.onerror = () => {
      if (!settled) {
        finish({
          ok: false,
          error: ready
            ? "Speech recognition connection error."
            : "Could not connect to speech recognition (check network / SuperGrok).",
        });
      }
    };

    ws.onclose = () => {
      if (settled) return;
      if (bestText.trim()) {
        finish({ ok: true, text: bestText.trim() });
        return;
      }
      finish({
        ok: false,
        error: ready
          ? "Speech recognition closed before a transcript arrived."
          : "Speech recognition closed before ready.",
      });
    };
  });
}
