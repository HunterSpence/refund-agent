/**
 * lib/voice/speak.ts — single client-side voice-out controller.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Voice-out has several triggers (auto-speak after a mic turn, the manual speaker
 * button, the Web Speech fallback) and a decision can re-render more than once.
 * If each trigger spins up its own <audio>, they play ON TOP of each other —
 * "talking multiple times at once". This module funnels EVERY playback through:
 *   • ONE shared <audio> element  → a new clip replaces the old, never layers,
 *   • stopAll() before each play   → also cancels any Web Speech utterance,
 *   • per-decision dedup (by key)  → the same decision can't speak twice from a
 *                                    double effect-run.
 *
 * Client-only (uses window/Audio/fetch). Import from "use client" components.
 */

/** Tiny silent WAV used to "unlock" audio playback during a user gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

let audioEl: HTMLAudioElement | null = null;
let lastKey: string | undefined;
/** Bumped on every speak() call so a slow/stale fetch can't play after a newer one. */
let generation = 0;

function ensureEl(): HTMLAudioElement {
  if (!audioEl) audioEl = new Audio();
  return audioEl;
}

/** Stop any in-flight audio (the shared element) and any Web Speech utterance. */
function stopAll(): void {
  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function speechFallback(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

/**
 * Unlock audio playback within a user gesture (call from a click handler), so a
 * later programmatic play() isn't blocked by the browser's autoplay policy.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  const el = ensureEl();
  try {
    el.src = SILENT_WAV;
    const p = el.play();
    if (p && typeof p.then === "function") p.then(() => el.pause()).catch(() => {});
  } catch {
    /* ignore — fallback paths still work */
  }
}

/**
 * Speak `text` aloud via Cartesia (/api/speak), falling back to the browser voice.
 *
 * @param text  The sentence to speak.
 * @param opts.key  When provided, dedups: the same key won't speak twice (used by
 *                  the auto-speak effect, which can re-run for one decision). Omit
 *                  the key for the manual speaker button so it always replays.
 */
export async function speak(text: string, opts?: { key?: string }): Promise<void> {
  if (typeof window === "undefined" || !text) return;

  // Per-decision dedup for the auto path. The manual button passes no key.
  if (opts?.key !== undefined) {
    if (opts.key === lastKey) return;
    lastKey = opts.key;
  }

  const myGen = ++generation;
  stopAll(); // never layer on top of a previous clip / utterance

  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (myGen !== generation) return; // a newer speak() superseded this one
    if (!res.ok) {
      speechFallback(text);
      return;
    }
    const blob = await res.blob();
    if (myGen !== generation) return; // superseded while downloading
    stopAll();
    const el = ensureEl();
    const url = URL.createObjectURL(blob);
    el.src = url;
    el.onended = () => URL.revokeObjectURL(url);
    await el.play().catch(() => {
      URL.revokeObjectURL(url);
      speechFallback(text);
    });
  } catch {
    if (myGen === generation) speechFallback(text);
  }
}
