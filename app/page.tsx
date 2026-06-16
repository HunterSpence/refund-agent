"use client";

/**
 * app/page.tsx — Full split-view experience
 *
 * Layout: full-viewport-height, two columns.
 *   Left  ≈42% — ChatWindow (conversation pane)
 *   Right ≈58% — ReasoningPanel (live reasoning dashboard)
 *
 * A slim header bar spans both columns:
 *   • Product name + logo mark
 *   • Subtitle + policy version pill
 *   • Scenario picker (15 SEED_ORDERS)
 *   • VoiceButton
 *   • Reset button
 *
 * All header controls: consistent 32px (h-8) height, shared hover/focus rings.
 *
 * AI SDK v6 wiring:
 *   import { useChat }              from "@ai-sdk/react"
 *   import { DefaultChatTransport } from "ai"
 *
 *   const { messages, sendMessage, status, error } = useChat<RefundUIMessage>({
 *     transport: new DefaultChatTransport({ api: "/api/agent" }),
 *   });
 *
 *   sendMessage({ text: "..." }) — sends a user message (text shorthand)
 *   status: "submitted" | "streaming" | "ready" | "error"
 *
 * Trace events are data-trace UIMessage parts. They are flattened across all
 * messages and passed to <ReasoningPanel> for rendering.
 */

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";

import type { RefundUIMessage } from "@/lib/agent/orchestrate";
import type { TraceEvent, RefundOutcome } from "@/lib/types";
import { SEED_ORDERS } from "@/lib/crm/data";
import { ChatWindow } from "@/components/ChatWindow";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import { VoiceButton } from "@/components/VoiceButton";

// ─── Logo mark ───────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <div className="flex items-center gap-2.5">
      {/* Icon: shield + checkmark — consistent violet accent */}
      <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-600/40 flex items-center justify-center flex-shrink-0">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="w-4 h-4 text-violet-400"
          aria-hidden
        >
          <path
            d="M8 1.5L13.5 3.5V8C13.5 11 11 13.5 8 14.5C5 13.5 2.5 11 2.5 8V3.5L8 1.5Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path
            d="M5.5 8L7 9.5L10.5 6"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <span className="text-sm font-semibold text-zinc-100 leading-none block">
          Refund Agent
        </span>
        <span className="text-[10px] text-zinc-500 leading-none block mt-0.5">
          Policy-governed refund agent
        </span>
      </div>
    </div>
  );
}

// ─── Scenario picker ──────────────────────────────────────────────────────────

interface ScenarioPickerProps {
  onSelect: (text: string) => void;
  disabled: boolean;
}

function ScenarioPicker({ onSelect, disabled }: ScenarioPickerProps) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const orderId = e.target.value;
    if (!orderId) return;

    const order = SEED_ORDERS.find((o) => o.order_id === orderId);
    if (!order) return;

    // Build a natural opening that includes order_id + reason_for_return
    const message =
      `Hi, I'd like a refund for order ${order.order_id} (${order.item}). ` +
      `Reason: ${order.reason_for_return}.`;

    // Reset the select back to placeholder
    e.target.value = "";

    onSelect(message);
  }

  return (
    /* Custom-styled select: consistent h-8, custom chevron via appearance-none + SVG bg */
    <div className="relative flex-shrink-0">
      <select
        onChange={handleChange}
        disabled={disabled}
        defaultValue=""
        aria-label="Load a scenario"
        className={[
          "appearance-none text-xs font-mono rounded-lg border bg-zinc-900",
          "pl-3 pr-8 h-8",
          "text-zinc-300 border-zinc-700",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950 focus-visible:border-violet-600",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "max-w-[240px] truncate",
          "transition-colors hover:border-zinc-600",
        ].join(" ")}
      >
        <option value="" disabled className="text-zinc-500 bg-zinc-950">
          Load scenario…
        </option>
        {SEED_ORDERS.map((order) => (
          <option key={order.order_id} value={order.order_id} className="bg-zinc-900 text-zinc-200">
            {order.name} — {order.item} (${order.price.toFixed(2)})
          </option>
        ))}
      </select>
      {/* Custom chevron icon */}
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden>
        <svg viewBox="0 0 10 6" fill="none" className="w-2.5 h-1.5">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  // AI SDK v6: useChat with DefaultChatTransport pointing at /api/agent
  const { messages, sendMessage, status, error, setMessages } = useChat<RefundUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });

  // Flatten all data-trace parts from all messages into an ordered list
  const traces = useMemo<TraceEvent[]>(() => {
    const result: TraceEvent[] = [];
    for (const msg of messages) {
      for (const part of msg.parts) {
        // AI SDK v6: data parts typed as { type: "data-<key>"; data: <T> }
        // Our generic is UIMessage<unknown, { trace: TraceEvent }> →
        // trace data parts arrive as type "data-trace"
        if (part.type === "data-trace") {
          // The part shape is { type: "data-trace"; data: TraceEvent }
          // Cast through unknown for type safety since the SDK uses a union
          const tracePart = part as { type: "data-trace"; data: TraceEvent };
          result.push(tracePart.data);
        }
      }
    }
    return result;
  }, [messages]);

  // Derive item name from the latest crm_lookup result for ApprovalCard
  const itemName = useMemo<string | undefined>(() => {
    for (let i = traces.length - 1; i >= 0; i--) {
      const ev = traces[i];
      if (ev.type === "tool_result" && ev.data.tool_name === "crm_lookup") {
        const result = ev.data.tool_result as { order?: { item?: unknown } } | null;
        if (result?.order && typeof result.order.item === "string") {
          return result.order.item;
        }
      }
    }
    return undefined;
  }, [traces]);

  // Derive the latest assistant message text for TTS (joined text parts)
  const latestAssistantText = useMemo<string | undefined>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        const text = msg.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        if (text.trim()) return text.trim();
      }
    }
    return undefined;
  }, [messages]);

  // Build a short, speakable sentence from the latest decision outcome (for TTS).
  // The reasoning card renders the decision visually; this gives the voice path an
  // actual spoken sentence to read back.
  const spokenSummary = useMemo<string | undefined>(() => {
    for (let i = traces.length - 1; i >= 0; i--) {
      const ev = traces[i];
      if (ev.type === "tool_result" && ev.data.tool_name === "decide_refund") {
        const o = ev.data.tool_result as Partial<RefundOutcome> | null;
        if (!o || typeof o.decision !== "string") return undefined;
        const reason = (o.reason ?? "")
          .replace(/§/g, "section ")
          .replace(/[()]/g, "")
          .trim();
        if (o.decision === "approve") {
          const amt = typeof o.amount === "number" ? ` for $${o.amount.toFixed(2)}` : "";
          return `Refund approved${amt}. ${reason}`.trim();
        }
        if (o.decision === "deny") return `Refund denied. ${reason}`.trim();
        return `This one needs a human review. ${reason}`.trim();
      }
    }
    return undefined;
  }, [traces]);

  // Changes once per completed decision (latest decision trace id) — drives TTS so
  // each new decision is spoken even when its wording repeats. Covers both the
  // normal decide_refund path and the guard-escalate path.
  const speakKey = useMemo<string | undefined>(() => {
    for (let i = traces.length - 1; i >= 0; i--) {
      if (traces[i].type === "decision") return traces[i].id;
    }
    return undefined;
  }, [traces]);

  const isLoading = status === "submitted" || status === "streaming";

  function handleSend(text: string) {
    sendMessage({ text });
  }

  function handleReset() {
    // Clear messages locally — starts a fresh conversation
    setMessages([]);
  }

  // Speak the latest decision on demand. Triggered by a direct button click (a
  // user gesture), so playback can't be blocked by autoplay policy. Tries the
  // Cartesia voice (/api/speak) and falls back to the browser voice on any error.
  async function handleSpeak() {
    if (!spokenSummary) return;
    const fallback = () => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(spokenSummary);
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    };
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spokenSummary }),
      });
      if (!res.ok) {
        fallback();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play().catch(() => {
        URL.revokeObjectURL(url);
        fallback();
      });
    } catch {
      fallback();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-surface-base)]">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center gap-3 px-5 py-0 h-14 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm z-10">
        <LogoMark />

        {/* Policy version pill */}
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-violet-400 bg-violet-950/50 border border-violet-800/50 px-2 py-0.5 rounded-full flex-shrink-0">
          policy v1.3
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Scenario picker — consistent h-8, custom chevron */}
        <ScenarioPicker onSelect={handleSend} disabled={isLoading} />

        {/* Voice input toggle — Web Speech default, keyless */}
        <VoiceButton
          onTranscript={handleSend}
          speakText={latestAssistantText ?? spokenSummary}
          speakKey={speakKey}
          disabled={isLoading}
        />

        {/* Hear the decision — direct-click playback, can't be blocked by autoplay */}
        <button
          onClick={handleSpeak}
          disabled={!spokenSummary}
          aria-label="Hear the decision"
          title={spokenSummary ? "Hear the decision aloud" : "No decision yet"}
          className={[
            "flex items-center justify-center w-8 h-8 rounded-lg border transition-all flex-shrink-0",
            "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden>
            <path d="M8.5 2.5L4.5 5.5H2.5V10.5H4.5L8.5 13.5V2.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M11 5.5C11.6 6.2 12 7.05 12 8C12 8.95 11.6 9.8 11 10.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        </button>

        {/* Reset — consistent h-8 height, focus ring */}
        <button
          onClick={handleReset}
          disabled={isLoading || messages.length === 0}
          className={[
            "text-xs font-mono px-3 h-8 rounded-lg border transition-colors flex-shrink-0",
            "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          Reset
        </button>
      </header>

      {/* ─── Split body ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Chat column ≈42% */}
        <div
          className="flex flex-col border-r border-zinc-800 bg-zinc-950/50"
          style={{ width: "42%" }}
        >
          {/* Chat column header */}
          <div className="flex-shrink-0 px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-widest">
              Conversation
            </span>
            {messages.filter((m) => m.role === "user").length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-zinc-500 tabular-nums">
                {messages.filter((m) => m.role === "user").length} turn
                {messages.filter((m) => m.role === "user").length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Chat window fills remaining height */}
          <div className="flex-1 min-h-0">
            <ChatWindow
              messages={messages}
              status={status}
              error={error}
              onSend={handleSend}
            />
          </div>
        </div>

        {/* Right: Reasoning dashboard ≈58% */}
        <div
          className="flex flex-col bg-[var(--color-surface-panel)]"
          style={{ width: "58%" }}
        >
          <ReasoningPanel traces={traces} itemName={itemName} />
        </div>
      </div>
    </div>
  );
}
