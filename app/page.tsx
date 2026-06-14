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
 *   • Reset button
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
import type { TraceEvent } from "@/lib/types";
import { SEED_ORDERS } from "@/lib/crm/data";
import { ChatWindow } from "@/components/ChatWindow";
import { ReasoningPanel } from "@/components/ReasoningPanel";

// ─── Logo mark ───────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <div className="flex items-center gap-2.5">
      {/* Icon: shield + checkmark */}
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
    <select
      onChange={handleChange}
      disabled={disabled}
      defaultValue=""
      aria-label="Load a scenario"
      className={[
        "text-xs font-mono rounded-lg border bg-zinc-900 px-3 py-1.5 h-8",
        "text-zinc-300 border-zinc-700 focus:outline-none focus:border-violet-600",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "max-w-[260px] truncate",
      ].join(" ")}
    >
      <option value="" disabled className="text-zinc-600">
        Load scenario…
      </option>
      {SEED_ORDERS.map((order) => (
        <option key={order.order_id} value={order.order_id} className="bg-zinc-900">
          {order.name} — {order.item} (${order.price.toFixed(2)})
        </option>
      ))}
    </select>
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
        const result = ev.data.tool_result as Record<string, unknown> | null;
        if (result && typeof result.item === "string") {
          return result.item;
        }
      }
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-surface-base)]">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center gap-4 px-5 py-3 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm z-10">
        <LogoMark />

        {/* Policy version pill */}
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-violet-400 bg-violet-950/50 border border-violet-800/50 px-2 py-0.5 rounded-full flex-shrink-0">
          policy v1.3
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Scenario picker */}
        <ScenarioPicker onSelect={handleSend} disabled={isLoading} />

        {/* Reset */}
        <button
          onClick={handleReset}
          disabled={isLoading || messages.length === 0}
          className={[
            "text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors h-8",
            "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
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
              <span className="ml-auto text-[10px] font-mono text-zinc-600">
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
