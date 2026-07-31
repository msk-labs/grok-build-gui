/**
 * Live dictation: mic → streaming STT (main process) → partials while speaking.
 * Matches Grok Build console: words appear as you talk; stop leaves text in place.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { localizeUiError } from "../../lib/uiError";

const TARGET_RATE = 16_000;
const BAR_COUNT = 48;
/** Cap preroll while STT WebSocket is connecting (~5s mono PCM16 @ 16 kHz). */
const MAX_PENDING_PCM_BYTES = TARGET_RATE * 2 * 5;
/**
 * Browser capture without AGC is often quiet (peaks ~0.05–0.2). Apply a modest
 * fixed gain so STT + the waveform see healthy levels; hard-clip at ±1.
 */
const CAPTURE_GAIN = 2.5;

export type VoicePhase = "idle" | "recording" | "stopping";

export type UseVoiceInputResult = {
  phase: VoicePhase;
  levels: number[];
  error: string | null;
  /** Latest partial/final transcript for this take (not including base draft). */
  liveText: string;
  /**
   * Begin capture + live STT. onPartial fires with running transcript.
   * `language` is the settings preference (`auto` / catalog code); main process
   * resolves it CLI-style before hitting the STT API.
   */
  start: (opts?: {
    onPartial?: (text: string) => void;
    language?: string;
  }) => Promise<boolean>;
  /** Stop capture; resolve with best final text (or null). */
  stop: () => Promise<string | null>;
  /** Abort without treating as a finished utterance. */
  cancel: () => void;
};

/**
 * Downsample to STT rate. Average-pool each source window (better than linear
 * interp for speech) so Chinese tones / consonants survive 48k→16k better.
 */
function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate) {
    // Upsample is unexpected for mic capture; fall back to linear.
    const ratio = fromRate / toRate;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const t = src - i0;
      out[i] = input[i0]! * (1 - t) + input[i1]! * t;
    }
    return out;
  }
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    const n = Math.max(1, end - start);
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = sum / n;
  }
  return out;
}

function floatToPcm16(samples: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const ch = buffer.numberOfChannels;
  if (ch <= 1) {
    const src = buffer.getChannelData(0);
    const out = new Float32Array(n);
    out.set(src);
    return out;
  }
  // Prefer the louder channel when stereo is effectively mono+silence
  // (common with channelCount:2 ScriptProcessor on a mono mic) — averaging
  // with silence would halve amplitude and hurt recognition.
  const c0 = buffer.getChannelData(0);
  const c1 = buffer.getChannelData(1);
  let p0 = 0;
  let p1 = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(c0[i]!);
    const b = Math.abs(c1[i]!);
    if (a > p0) p0 = a;
    if (b > p1) p1 = b;
  }
  if (p0 >= p1 * 4) {
    const out = new Float32Array(n);
    out.set(c0);
    return out;
  }
  if (p1 >= p0 * 4) {
    const out = new Float32Array(n);
    out.set(c1);
    return out;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (c0[i]! + c1[i]!) * 0.5;
  return out;
}

/** Fixed digital gain with clip (no per-chunk normalize → no pumping). */
function applyCaptureGain(input: Float32Array, gain: number): Float32Array {
  if (gain === 1) return input;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i]! * gain;
    out[i] = s < -1 ? -1 : s > 1 ? 1 : s;
  }
  return out;
}

/**
 * Map mono peaks → bar heights. Uses sqrt so quiet speech (post-gain peaks
 * ~0.1–0.3) still animates clearly; loud peaks still cap at 1.
 */
function levelsFromMono(samples: Float32Array): number[] {
  const next: number[] = [];
  const slice = Math.floor(samples.length / BAR_COUNT) || 1;
  for (let b = 0; b < BAR_COUNT; b++) {
    let peak = 0;
    let sumSq = 0;
    const start = b * slice;
    const end = Math.min(start + slice, samples.length);
    const n = Math.max(1, end - start);
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]!);
      if (v > peak) peak = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / n);
    // Blend peak + RMS; sqrt expands the quiet range for a lively meter.
    const energy = Math.max(peak, rms * 1.8);
    const h = Math.min(1, Math.sqrt(energy * 8));
    next.push(Math.max(0.1, h));
  }
  return next;
}

function quietLevels(): number[] {
  return Array.from({ length: BAR_COUNT }, () => 0.08);
}

function pushPendingPcm(
  pending: Uint8Array[],
  pendingBytes: { current: number },
  chunk: Uint8Array,
) {
  pending.push(chunk);
  pendingBytes.current += chunk.byteLength;
  while (
    pendingBytes.current > MAX_PENDING_PCM_BYTES &&
    pending.length > 1
  ) {
    const dropped = pending.shift()!;
    pendingBytes.current -= dropped.byteLength;
  }
}

export function useVoiceInput(): UseVoiceInputResult {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [levels, setLevels] = useState<number[]>(quietLevels);
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sinkRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  /** PCM captured before STT session id is assigned (WS handshake). */
  const pendingPcmRef = useRef<Uint8Array[]>([]);
  const pendingPcmBytesRef = useRef(0);
  const phaseRef = useRef<VoicePhase>("idle");
  phaseRef.current = phase;
  const onPartialRef = useRef<((text: string) => void) | null>(null);
  const liveTextRef = useRef("");
  liveTextRef.current = liveText;

  const stopCapture = useCallback(() => {
    try {
      processorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    processorRef.current = null;
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sourceRef.current = null;
    sinkRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
    pendingPcmRef.current = [];
    pendingPcmBytesRef.current = 0;
  }, []);

  const idleUi = useCallback(() => {
    phaseRef.current = "idle";
    setPhase("idle");
    setLevels(quietLevels());
    setLiveText("");
    liveTextRef.current = "";
    sessionIdRef.current = null;
    pendingPcmRef.current = [];
    pendingPcmBytesRef.current = 0;
    onPartialRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const id = sessionIdRef.current;
    stopCapture();
    if (id != null && window.grok?.voiceLiveCancel) {
      void window.grok.voiceLiveCancel(id);
    }
    setError(null);
    idleUi();
  }, [idleUi, stopCapture]);

  useEffect(() => () => {
    const id = sessionIdRef.current;
    stopCapture();
    if (id != null && window.grok?.voiceLiveCancel) {
      void window.grok.voiceLiveCancel(id);
    }
  }, [stopCapture]);

  useEffect(() => {
    if (!window.grok?.onVoicePartial) return;
    return window.grok.onVoicePartial((ev) => {
      if (sessionIdRef.current !== ev.id) return;
      const t = (ev.text ?? "").trim();
      if (!t) return;
      setLiveText(t);
      liveTextRef.current = t;
      onPartialRef.current?.(t);
    });
  }, []);

  useEffect(() => {
    if (!window.grok?.onVoiceError) return;
    return window.grok.onVoiceError((ev) => {
      if (sessionIdRef.current !== ev.id) return;
      setError(localizeUiError(ev.error, t));
    });
  }, [t]);

  const start = useCallback(
    async (opts?: {
      onPartial?: (text: string) => void;
      /** Settings preference: `auto` or a Grok STT catalog code. */
      language?: string;
    }): Promise<boolean> => {
      if (!window.grok?.voiceLiveStart || !window.grok?.voiceLiveAudio) {
        setError(t("composer.voiceUnavailable"));
        return false;
      }
      if (phaseRef.current !== "idle") return false;

      setError(null);
      setLiveText("");
      liveTextRef.current = "";
      onPartialRef.current = opts?.onPartial ?? null;
      stopCapture();

      // Show wave / stop immediately — don't wait for mic + WS.
      phaseRef.current = "recording";
      setPhase("recording");
      sessionIdRef.current = null;
      pendingPcmRef.current = [];
      pendingPcmBytesRef.current = 0;

      // Settings preference; browser locale for auto / Chinese free-detect.
      // Default "auto" (not "en") so Chinese OS does not force language=en.
      const language = opts?.language?.trim() || "auto";
      const localeHint =
        typeof navigator !== "undefined" ? navigator.language || undefined : undefined;

      // Mic + STT in parallel. Capture closer to CLI (raw-ish PCM): prefer 16 kHz
      // mono and disable browser AEC/NS/AGC — those distort speech and make the
      // model latch onto English under language bias / code-switching.
      const mediaPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          sampleRate: { ideal: TARGET_RATE },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      // STT connect often takes 0.5–2s; we must NOT wait for it before capturing.
      const sttPromise = window.grok.voiceLiveStart({
        sampleRate: TARGET_RATE,
        language,
        localeHint,
      });

      const cancelSttLater = (id: number | null) => {
        if (id != null && window.grok?.voiceLiveCancel) {
          void window.grok.voiceLiveCancel(id);
        }
      };

      // If STT finishes after we already failed/cancelled, drop the session.
      void sttPromise.then((result) => {
        if (result.ok && phaseRef.current !== "recording") {
          cancelSttLater(result.id);
        }
      });

      let stream: MediaStream;
      try {
        stream = await mediaPromise;
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : t("composer.microphoneDenied");
        // Best-effort cancel in-flight STT once it resolves.
        void sttPromise.then((r) => {
          if (r.ok) cancelSttLater(r.id);
        });
        setError(
          msg.includes("Permission") || msg.includes("NotAllowed")
            ? t("composer.microphoneAllow")
            : localizeUiError(msg, t),
        );
        idleUi();
        return false;
      }

      if (phaseRef.current !== "recording") {
        stream.getTracks().forEach((t) => t.stop());
        void sttPromise.then((r) => {
          if (r.ok) cancelSttLater(r.id);
        });
        return false;
      }

      // Wire the mic graph as soon as the stream is available so speech during
      // the STT WebSocket handshake is buffered (not dropped). Waveform tracks
      // real capture from this point.
      streamRef.current = stream;
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        ctx = new AudioContext();
      }
      ctxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      if (phaseRef.current !== "recording") {
        stopCapture();
        void sttPromise.then((r) => {
          if (r.ok) cancelSttLater(r.id);
        });
        return false;
      }

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      // Mono path when possible; 2048 ≈ 128ms @ 16 kHz / ~40ms @ 48 kHz.
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (phaseRef.current !== "recording") return;
        // Gain before meter + STT so levels reflect what we actually send.
        const mono = applyCaptureGain(mixToMono(ev.inputBuffer), CAPTURE_GAIN);
        setLevels(levelsFromMono(mono));
        const down = downsample(mono, ctx.sampleRate, TARGET_RATE);
        const pcm = floatToPcm16(down);
        // Fresh Uint8Array so IPC never shares a live buffer view.
        const copy = new Uint8Array(pcm);
        const id = sessionIdRef.current;
        if (id != null && window.grok?.voiceLiveAudio) {
          void window.grok.voiceLiveAudio({ id, pcm: copy });
          return;
        }
        // STT not ready yet — keep preroll so the first 1–2s are not lost.
        pushPendingPcm(
          pendingPcmRef.current,
          pendingPcmBytesRef,
          copy,
        );
      };

      const sink = ctx.createMediaStreamDestination();
      sinkRef.current = sink;
      source.connect(processor);
      processor.connect(sink);

      // Now wait for STT; capture already running + buffering.
      let stt: { ok: true; id: number } | { ok: false; error: string };
      try {
        stt = await sttPromise;
      } catch (e) {
        stopCapture();
        setError(
          localizeUiError(e instanceof Error ? e.message : String(e), t),
        );
        idleUi();
        return false;
      }

      if (phaseRef.current !== "recording") {
        if (stt.ok) cancelSttLater(stt.id);
        stopCapture();
        return false;
      }

      if (!stt.ok) {
        stopCapture();
        setError(localizeUiError(stt.error, t));
        idleUi();
        return false;
      }

      const sttId = stt.id;

      // Flush preroll before enabling live send so early speech is not
      // reordered after live chunks. Capture keeps appending to pending until
      // sessionId is set (sync, only when the queue is empty).
      const takePendingMerged = (): Uint8Array | null => {
        const chunks = pendingPcmRef.current;
        if (chunks.length === 0) return null;
        pendingPcmRef.current = [];
        pendingPcmBytesRef.current = 0;
        let total = 0;
        for (const c of chunks) total += c.byteLength;
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          merged.set(c, off);
          off += c.byteLength;
        }
        return merged;
      };

      for (let i = 0; i < 16; i++) {
        if (phaseRef.current !== "recording") {
          cancelSttLater(sttId);
          stopCapture();
          return false;
        }
        const batch = takePendingMerged();
        if (!batch) {
          // Queue empty: enable live send before any further await.
          sessionIdRef.current = sttId;
          break;
        }
        if (window.grok?.voiceLiveAudio) {
          await window.grok.voiceLiveAudio({ id: sttId, pcm: batch });
        }
        if (i === 15) {
          // Give up draining; enable live and drop any extreme backlog.
          sessionIdRef.current = sttId;
          pendingPcmRef.current = [];
          pendingPcmBytesRef.current = 0;
        }
      }

      return true;
    },
    [idleUi, stopCapture, t],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    if (phaseRef.current === "idle") {
      return liveTextRef.current.trim() || null;
    }
    if (phaseRef.current === "stopping") {
      // Already stopping — return last known text, don't double-stop IPC.
      return liveTextRef.current.trim() || null;
    }
    phaseRef.current = "stopping";
    setPhase("stopping");
    stopCapture();

    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (id == null || !window.grok?.voiceLiveStop) {
      const transcript = liveTextRef.current.trim() || null;
      idleUi();
      return transcript;
    }

    try {
      const result = await window.grok.voiceLiveStop(id);
      const text = result.ok
        ? result.text.trim() || liveTextRef.current.trim() || null
        : liveTextRef.current.trim() || null;
      if (!result.ok && result.error) {
        const soft =
          /empty|no speech|short|silent|timeout|no live/i.test(result.error);
        if (!soft && !text) setError(localizeUiError(result.error, t));
      }
      idleUi();
      return text;
    } catch (e) {
      const transcript = liveTextRef.current.trim() || null;
      // Don't surface abort/race errors when we already have text.
      if (!transcript) {
        setError(
          localizeUiError(e instanceof Error ? e.message : String(e), t),
        );
      }
      idleUi();
      return transcript;
    }
  }, [idleUi, stopCapture, t]);

  return { phase, levels, error, liveText, start, stop, cancel };
}
