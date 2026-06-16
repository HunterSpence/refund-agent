"use client";

/**
 * VoiceButton.tsx — Phase 6: Keyless Web Speech voice I/O toggle
 *
 * DEFAULT PATH: Web Speech API (browser-native, zero config, no API key)
 * ────────────────────────────────────────────────────────────────────────
 * STT: SpeechRecognition / webkitSpeechRecognition — fires onTranscript(text)
 *      on a final result, which the parent wires to sendMessage({ text }).
 * TTS: Cartesia Sonic via the /api/speak server proxy when CARTESIA_API_KEY is
 *      configured (the key stays server-side; the browser only receives audio).
 *      Falls back to window.speechSynthesis.speak() when Cartesia is absent or
 *      errors. Fires when `speakKey` changes (one new decision = one spoken reply).
 *
 * PRODUCTION UPGRADE PATH (further, keys required)
 * ─────────────────────────────────────────────────
 * Swap STT to Deepgram Nova-2 via /api/deepgram-token → WebSocket.
 * TTS already runs on Cartesia Sonic via /api/speak when the key is set.
 *
 * SSR / BUILD SAFETY
 * ───────────────────
 * All browser-API access is inside effects or event handlers — never at module
 * top level. The component renders server-safely (button stays disabled with
 * an explanatory title when the browser doesn't support SpeechRecognition).
 *
 * TYPESCRIPT
 * ───────────
 * SpeechRecognition is not in the TS dom lib for all targets. We use a minimal
 * local interface and narrow via (window as unknown as SpeechWindow) to avoid
 * any `any` and satisfy strict mode.
 */

import { useEffect, useRef, useState } from "react";

// ─── Minimal SpeechRecognition interface ─────────────────────────────────────
//
// The TS dom lib ships SpeechRecognition as a class, but its presence on
// `window` is not guaranteed across lib targets and is absent on some builds.
// We declare only the surface we actually use, using local minimal types to
// avoid relying on the global SpeechRecognitionEvent name which may not exist
// in the project's TS lib configuration.

/** Minimal shape of a single speech recognition alternative. */
interface MinimalSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

/** Minimal shape of a single SpeechRecognitionResult. */
interface MinimalSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: MinimalSpeechRecognitionAlternative;
}

/** Minimal shape of the SpeechRecognitionResultList. */
interface MinimalSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: MinimalSpeechRecognitionResult;
}

/** Minimal shape of the SpeechRecognitionEvent we care about. */
interface MinimalSpeechRecognitionEvent {
  readonly results: MinimalSpeechRecognitionResultList;
}

/** Minimal shape of a SpeechRecognitionError event (not in all TS lib targets). */
interface MinimalSpeechRecognitionErrorEvent {
  error: string;
}

interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  // Widened to MinimalSpeechRecognitionErrorEvent so we can access event.error
  // for diagnostics if needed (e.g., "not-allowed", "no-speech"). Using a
  // union rather than `Event` keeps this zero-`any` and type-safe.
  onerror: ((event: MinimalSpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

interface MinimalSpeechRecognitionConstructor {
  new (): MinimalSpeechRecognition;
}

// Window shape extended with speech globals (may be undefined)
interface SpeechWindow {
  SpeechRecognition?: MinimalSpeechRecognitionConstructor;
  webkitSpeechRecognition?: MinimalSpeechRecognitionConstructor;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface VoiceButtonProps {
  /** Called with the final transcript text from STT. Wire to handleSend. */
  onTranscript: (text: string) => void;
  /** The text to speak aloud via TTS (the agent's latest decision / reply). */
  speakText?: string;
  /**
   * A value that changes once per completed decision (e.g. the latest decision
   * trace id). TTS fires when this changes — so a brand-new decision is always
   * spoken, even when its wording is identical to the previous one.
   */
  speakKey?: string | number;
  /** Disable while the agent is processing a request. */
  disabled?: boolean;
}

// ─── VoiceButton ─────────────────────────────────────────────────────────────

export function VoiceButton({ onTranscript, speakText, speakKey, disabled }: VoiceButtonProps) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true); // optimistic; corrected in effect
  const recognizerRef = useRef<MinimalSpeechRecognition | null>(null);

  // Set to true the first time the user activates the mic. TTS is gated on this
  // flag so the component never auto-speaks on page load — it only reads aloud
  // when the user has explicitly opted in to voice interaction.
  const hasUsedVoice = useRef(false);

  // ── Feature detection (client-only, inside effect) ──────────────────────
  useEffect(() => {
    const win = window as unknown as SpeechWindow;
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
    }
  }, []);

  // ── TTS: speak latest assistant reply when speakText changes ────────────
  //
  // Gated on hasUsedVoice: TTS only fires after the user has activated the mic
  // at least once. This prevents the component from speaking on initial render
  // (e.g., when a prior reply is passed as a prop at mount time) and respects
  // the principle that audio output should be opt-in.
  useEffect(() => {
    if (!hasUsedVoice.current) return;
    if (!speakText || typeof window === "undefined") return;

    let cancelled = false;
    let audioEl: HTMLAudioElement | null = null;

    // Browser-native fallback — used when Cartesia isn't configured or errors,
    // so voice-out always works (just with the OS voice instead of Sonic).
    function fallbackSpeak() {
      if (cancelled || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(speakText);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }

    // Cartesia Sonic first (server proxy at /api/speak — the API key stays
    // server-side, the browser only ever receives audio). Any non-200 (e.g. 501
    // when no key is configured) drops to the Web Speech fallback.
    void (async () => {
      try {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: speakText }),
        });
        if (cancelled) return;
        if (!res.ok) {
          fallbackSpeak();
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        window.speechSynthesis?.cancel();
        const url = URL.createObjectURL(blob);
        audioEl = new Audio(url);
        audioEl.addEventListener("ended", () => URL.revokeObjectURL(url));
        await audioEl.play().catch(() => {
          URL.revokeObjectURL(url);
          fallbackSpeak();
        });
      } catch {
        fallbackSpeak();
      }
    })();

    // Cleanup: stop audio if a newer decision arrives or the component unmounts.
    return () => {
      cancelled = true;
      audioEl?.pause();
      window.speechSynthesis?.cancel();
    };
    // Keyed on speakKey (the decision id) so each new decision is spoken even when
    // its wording matches the previous one.
  }, [speakText, speakKey]);

  // ── Cleanup: stop recognition on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
      if (typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

  // ── Toggle STT listening ─────────────────────────────────────────────────
  function handleToggle() {
    if (!supported || disabled) return;

    if (listening) {
      // Stop listening
      recognizerRef.current?.stop();
      recognizerRef.current = null;
      setListening(false);
      return;
    }

    // Start listening
    const win = window as unknown as SpeechWindow;
    const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;

    rec.onresult = (event: MinimalSpeechRecognitionEvent) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && result[0]) {
          parts.push(result[0].transcript);
        }
      }
      const transcript = parts.join(" ").trim();
      if (transcript) {
        onTranscript(transcript);
      }
    };

    rec.onend = () => {
      setListening(false);
      recognizerRef.current = null;
    };

    rec.onerror = () => {
      setListening(false);
      recognizerRef.current = null;
    };

    recognizerRef.current = rec;
    rec.start();
    // Mark that the user has opted in to voice — enables TTS from this point on.
    hasUsedVoice.current = true;
    setListening(true);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isDisabled = disabled || !supported;
  const title = !supported
    ? "Voice not supported in this browser"
    : listening
      ? "Click to stop listening"
      : "Click to speak a refund request";

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isDisabled}
      aria-label={listening ? "Stop listening" : "Start voice input"}
      aria-pressed={listening}
      title={title}
      className={[
        // Base: match header-sized controls (h-8), same border-radius as ScenarioPicker
        "relative flex items-center justify-center w-8 h-8 rounded-lg border transition-all flex-shrink-0",
        // Listening: violet fill + pulsing ring
        listening
          ? "border-violet-500 bg-violet-700/30 text-violet-300"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
        isDisabled && "opacity-40 cursor-not-allowed pointer-events-none",
      ].join(" ")}
    >
      {/* Pulsing ring when listening */}
      {listening && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-lg border-2 border-violet-500 animate-ping opacity-60"
        />
      )}

      {/* Mic icon */}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className="w-3.5 h-3.5 relative"
        aria-hidden
      >
        {/* Mic capsule */}
        <rect
          x="5.5"
          y="1"
          width="5"
          height="8"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        {/* Stand arc */}
        <path
          d="M3 7.5C3 10.5376 5.46243 13 8.5 13C11.5376 13 14 10.5376 14 7.5"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        {/* Stem */}
        <line
          x1="8.5"
          y1="13"
          x2="8.5"
          y2="15"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        {/* Base */}
        <line
          x1="6"
          y1="15"
          x2="11"
          y2="15"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
