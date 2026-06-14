"use client";

/**
 * ApprovalCard — Human-in-the-loop approval widget.
 *
 * Renders when the agent produces a `decide_refund` outcome where:
 *   decision === "approve" AND amount > 500
 *
 * This is a presentational HITL demonstration. The two buttons update local
 * component state to show a resolved status.
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
      <div className="animate-scale-in rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 flex items-center gap-3">
        <span className="text-emerald-400 text-lg leading-none">✓</span>
        <div>
          {/* "human reviewer" — accurate: the button click is the human action */}
          <p className="text-sm font-semibold text-emerald-400">
            ✓ Approved by human reviewer — ${outcome.amount.toFixed(2)} released
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
      <div className="animate-scale-in rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 flex items-center gap-3">
        <span className="text-amber-400 text-lg leading-none">↑</span>
        <div>
          <p className="text-sm font-semibold text-amber-400">Escalated to senior review</p>
          <p className="text-xs text-amber-600 mt-0.5">
            Human reviewer overrode agent recommendation — case forwarded
          </p>
        </div>
      </div>
    );
  }

  // pending state
  return (
    <div className="animate-scale-in rounded-xl border border-violet-700/50 bg-violet-950/20 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-800/30 flex items-center gap-2">
        {/* Pulsing indicator */}
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500" />
        </span>
        <span className="text-xs font-mono font-semibold text-violet-300 uppercase tracking-wider">
          Human approval required
        </span>
        <DecisionBadge decision="approve" size="xs" />
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-sm text-zinc-200 font-medium mb-1">
          <span className="font-mono text-emerald-400 font-semibold">
            ${outcome.amount.toFixed(2)}
          </span>{" "}
          refund for{" "}
          <span className="text-zinc-100 font-semibold">{itemName}</span>
        </p>
        <p className="text-xs text-zinc-400 mb-1">
          Exceeds the $500 auto-approval threshold — a human must authorize this payout.
        </p>
        {outcome.overridden && (
          <p className="text-xs text-amber-400 mb-1">
            ⚠ Policy engine adjusted agent proposal
          </p>
        )}
        <p className="text-[11px] font-mono text-zinc-500 mt-2">
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
          className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-700/20 text-emerald-400 border border-emerald-700/40 hover:bg-emerald-700/35 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Approve payout
        </button>
        {/*
         * Production path: call `addToolApprovalResponse(toolCallId, false)` here
         * to reject and continue the loop with an escalation outcome.
         */}
        <button
          onClick={() => setState("escalated")}
          className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold bg-amber-700/20 text-amber-400 border border-amber-700/40 hover:bg-amber-700/35 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        >
          Override → escalate
        </button>
      </div>
    </div>
  );
}
