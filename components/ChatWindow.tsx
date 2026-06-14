"use client";

/**
 * ChatWindow — the conversation pane.
 *
 * Renders:
 *   - User messages: right-aligned, accent (violet) bubble
 *   - Assistant messages: left-aligned, surface (zinc-900) bubble with AI avatar
 *   - Only `text` parts are rendered as bubble content (data-trace parts are
 *     consumed by the parent for the reasoning panel, not shown here)
 *   - An input row (textarea + Send button, Enter to send)
 *   - Typing/loading indicator while status is submitted|streaming
 *   - Error display
 *
 * Contrast: all informational text ≥ zinc-500 (#71717a, ~4.6:1 on zinc-950).
 * Placeholder at zinc-500, hint text at zinc-500.
 */

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import type { RefundUIMessage } from "@/lib/agent/orchestrate";

// ─── Typing indicator (three bouncing dots) ───────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800 w-fit">
      <span className="dot-bounce w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
      <span className="dot-bounce w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
      <span className="dot-bounce w-1.5 h-1.5 rounded-full bg-zinc-500 inline-block" />
    </div>
  );
}

// ─── AI avatar mark ───────────────────────────────────────────────────────────

function AIAvatar() {
  return (
    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-900/60 border border-violet-700/60 flex items-center justify-center mr-2 mt-1" aria-hidden>
      {/* Minimal shield glyph — matches the header logo family */}
      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 text-violet-400">
        <path d="M6 1L10 2.5V6C10 8.2 8.2 10 6 10.8C3.8 10 2 8.2 2 6V2.5L6 1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
        <path d="M4 6l1.5 1.5L8 4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ─── Individual message bubble ────────────────────────────────────────────────

function MessageBubble({ message }: { message: RefundUIMessage }) {
  const isUser = message.role === "user";

  // Extract only text parts for display
  const textParts = message.parts.filter(
    (p): p is { type: "text"; text: string } => p.type === "text",
  );

  if (textParts.length === 0) return null;

  const text = textParts.map((p) => p.text).join("");
  if (!text.trim()) return null;

  return (
    <div className={["flex w-full", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {/* AI avatar — refined SVG glyph, no emoji */}
      {!isUser && <AIAvatar />}

      <div
        className={[
          "max-w-[78%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-violet-700/25 border border-violet-600/35 text-zinc-100"
            : "rounded-tl-sm bg-zinc-900 border border-zinc-800 text-zinc-200",
        ].join(" ")}
      >
        {text}
      </div>
    </div>
  );
}

// ─── Empty state (refined — SVG motif, no emoji) ──────────────────────────────

function ChatEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16 select-none">
      {/* Minimal chat bubble SVG — clean, not cute */}
      <div className="w-10 h-10 rounded-xl bg-violet-900/30 border border-violet-700/30 flex items-center justify-center mb-4" aria-hidden>
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-violet-500">
          <path d="M3 4.5A1.5 1.5 0 014.5 3h11A1.5 1.5 0 0117 4.5v8A1.5 1.5 0 0115.5 14H11l-3 3v-3H4.5A1.5 1.5 0 013 12.5v-8z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
          <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-500 mb-1">Start a conversation</p>
      <p className="text-xs text-zinc-500 max-w-[220px] leading-relaxed">
        Pick a scenario from the header or type your refund request below.
      </p>
    </div>
  );
}

// ─── ChatWindow ───────────────────────────────────────────────────────────────

interface ChatWindowProps {
  messages: RefundUIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  onSend: (text: string) => void;
}

export function ChatWindow({ messages, status, error, onSend }: ChatWindowProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    onSend(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !isLoading && <ChatEmptyState />}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <AIAvatar />
            <TypingIndicator />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/20 px-3 py-2">
            <p className="text-xs font-mono text-rose-400">
              ⚠ {error.message ?? "An error occurred. Please try again."}
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div className="flex-shrink-0 border-t border-zinc-800 px-4 py-3">
        <div
          className={[
            "flex items-end gap-2 rounded-xl border bg-zinc-900 px-3 py-2 transition-colors",
            isLoading
              ? "border-zinc-800 opacity-70"
              : "border-zinc-700 focus-within:border-violet-600 focus-within:shadow-[0_0_0_1px_rgba(139,92,246,0.15)]",
          ].join(" ")}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={isLoading ? "Agent is thinking…" : "Ask about a refund…"}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none min-h-[24px] max-h-[120px] py-0.5"
          />

          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className={[
              "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900",
              isLoading || !input.trim()
                ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                : "bg-violet-600 text-white hover:bg-violet-500",
            ].join(" ")}
          >
            {isLoading ? (
              /* Spinner */
              <span className="spinner w-3.5 h-3.5 border-2 border-zinc-500 border-t-transparent rounded-full inline-block" />
            ) : (
              /* Arrow icon */
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
                aria-hidden
              >
                <path d="M8 1.5L14.5 8 8 14.5M14.5 8H1.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Hint text — raised to zinc-500 for readability (was zinc-700, ~2:1) */}
        <p className="text-[10px] text-zinc-500 mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
