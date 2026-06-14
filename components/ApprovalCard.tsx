"use client";

/**
 * ApprovalCard — Human-in-the-loop approval widget.
 *
 * Renders when the agent produces a `decide_refund` outcome where:
 *   decision === "approve" AND amount > 500
 *
 * The pending state is the HITL "wow" moment — a human authorizing a large
 * payout. The amount is heroic (large mono, emerald, tabular-nums).
 * The resolved states (approved / escalated) are calm and final.
 *
 * Production path (AI SDK v6):
 *   The real HITL flow uses `addToolApprovalResponse()` from useChat to inject
 *   a tool-approval response into the message stream, continuing the agentic
 *   loop after the human decision. The UI structure here is designed to adopt
 *   that pattern: button handlers would call `addToolApprovalResponse(toolCallId, approved)`
 *   instead of (or in addition to) updating local state.
 *
 * See: https://sdk.vercel.ai/docs/ai-sdk-ui/chatbot-with-tool-calling#human-in-the-loop
 */

import { useState } from "react";
import { DecisionBadge } from "@/components/DecisionBadge";
import type { RefundOutcome } from "@/lib/types";

interface ApprovalCardProps {
  outcome: RefundOutcome;
  /** Item name for display. Sourced from the `crm_lookup` tool result. */
  itemName: string;
}

type ApprovalState = "pending" | "approved" | "escalated";

export function ApprovalCard({ outcome, itemName }: ApprovalCardProps) {
  const [state, setState] = useState<ApprovalState>("pending");

  if (state === "approved") {
    return (
      <div className="animate-scale-in rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3.5 flex items-center gap-3">
        {/* SVG check circle */}
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-emerald-400 flex-shrink-0" aria-hidden>
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.25"/>
          <path d="M6.5 10.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div>
          <p className="text-sm font-semibold text-emerald-400">
            Approved by human reviewer —{" "}
            <span className="font-mono tabular-nums">${outcome.amount.toFixed(2)}</span>{" "}
            released
          </p>
          <p className="text-xs text-emerald-600 mt-0.5">
            Payout authorized and queued
          </p>
        </div>
      </div>
    );
  }

  if (state === "escalated") {
    return (
      <div className="animate-scale-in rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3.5 flex items-center gap-3">
        {/* SVG arrow-up circle */}
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-amber-400 flex-shrink-0" aria-hidden>
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.25"/>
          <path d="M10 13.5V7M7.5 9.5L10 7l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div>
          <p className="text-sm font-semibold text-amber-400">Escalated to senior review</p>
          <p className="text-xs text-amber-600 mt-0.5">
            Human reviewer overrode agent recommendation — case forwarded
          </p>
        </div>
      </div>
    );
  }

  // pending state — the HITL "wow" moment: a human authorizing a large payout
  return (
    <div className="animate-scale-in rounded-xl border border-violet-600/50 bg-violet-950/25 overflow-hidden shadow-[0_0_0_1px_rgba(139,92,246,0.08),0_4px_24px_rgba(139,92,246,0.06)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-800/30 flex items-center gap-2.5">
        {/* Pulsing indicator */}
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500" />
        </span>
        <span className="text-xs font-mono font-semibold text-violet-300 uppercase tracking-wider">
          Human approval required
        </span>
        <DecisionBadge decision="approve" size="xs" />
      </div>

      {/* Body — the amount is the hero */}
      <div className="px-4 pt-4 pb-3">
        {/* Heroic amount */}
        <div className="mb-3">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-1">
            Pending payout
          </p>
          <p className="text-3xl font-mono font-bold tabular-nums text-emerald-400 leading-none">
            ${outcome.amount.toFixed(2)}
          </p>
          <p className="text-sm text-zinc-400 mt-1.5">
            refund for{" "}
            <span className="text-zinc-200 font-semibold">{itemName}</span>
          </p>
        </div>

        <p className="text-xs text-zinc-500 leading-relaxed">
          Exceeds the $500 auto-approval threshold — a human must authorize this payout.
        </p>
        {outcome.overridden && (
          <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1.5">
            <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 flex-shrink-0" aria-hidden>
              <path d="M6 1L11 10H1L6 1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
              <path d="M6 5v2.5M6 8.5v.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            Policy engine adjusted agent proposal
          </p>
        )}
        <p className="text-[10px] font-mono text-zinc-600 mt-2 tabular-nums">
          policy v{outcome.policy_version}
        </p>
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-2">
        {/*
         * Production path: call `addToolApprovalResponse(toolCallId, true)` here
         * to inject an approval into the AI SDK message stream and continue the loop.
         */}
        <button
          onClick={() => setState("approved")}
          className="flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold bg-emerald-700/20 text-emerald-400 border border-emerald-700/40 hover:bg-emerald-700/35 hover:border-emerald-600/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950"
        >
          Approve payout
        </button>
        {/*
         * Production path: call `addToolApprovalResponse(toolCallId, false)` here
         * to reject and continue the loop with an escalation outcome.
         */}
        <button
          onClick={() => setState("escalated")}
          className="flex-1 px-3 py-2.5 rounded-lg text-sm font-semibold bg-amber-700/20 text-amber-400 border border-amber-700/40 hover:bg-amber-700/35 hover:border-amber-600/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950"
        >
          Override → escalate
        </button>
      </div>
    </div>
  );
}
