"use client";

/**
 * ReasoningPanel — the live reasoning dashboard (star of the show).
 *
 * Receives the flat list of all TraceEvents (across all messages, in order)
 * and renders a vertical timeline. Each event type has a distinct visual
 * treatment — tool calls, tool results, policy decisions, and guardrail
 * violations are all immediately recognizable at a glance.
 *
 * New rows animate in via CSS traceIn keyframes (defined in globals.css).
 * Respects prefers-reduced-motion.
 *
 * JSON rendering: a lightweight recursive colorizer — no external syntax
 * highlighting library needed. Colors match the .json-* classes in globals.css.
 */

import { useEffect, useRef } from "react";
import type { TraceEvent, RefundOutcome } from "@/lib/types";
import { DecisionBadge } from "@/components/DecisionBadge";
import { ApprovalCard } from "@/components/ApprovalCard";

// ─── JSON colorizer ───────────────────────────────────────────────────────────

/**
 * Recursively render a JSON value as React-compatible JSX with syntax coloring.
 * Produces a `<span>` tree colored with the .json-* classes from globals.css.
 * No external dependency — intentionally minimal.
 */
function ColorizedJson({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): React.ReactElement {
  if (value === null) {
    return <span className="json-null">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="json-bool">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="json-number">{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <span className="json-string">{`"${value}"`}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>;
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    return (
      <span>
        {"[\n"}
        {value.map((item, i) => (
          <span key={i}>
            {indent}
            <ColorizedJson value={item} depth={depth + 1} />
            {i < value.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {closeIndent}
        {"]"}
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-zinc-500">{"{}"}</span>;
    const indent = "  ".repeat(depth + 1);
    const closeIndent = "  ".repeat(depth);
    return (
      <span>
        {"{\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {indent}
            <span className="json-key">{`"${k}"`}</span>
            {": "}
            <ColorizedJson value={v} depth={depth + 1} />
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {closeIndent}
        {"}"}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

// ─── Role badge (tool name → display label + color) ──────────────────────────

const TOOL_ROLE: Record<string, { label: string; bg: string; text: string; border: string }> = {
  crm_lookup: {
    label: "LOOKUP",
    bg: "bg-sky-950/60",
    text: "text-sky-400",
    border: "border-sky-700/50",
  },
  policy_check: {
    label: "POLICY",
    bg: "bg-purple-950/60",
    text: "text-purple-400",
    border: "border-purple-700/50",
  },
  decide_refund: {
    label: "DECISION",
    bg: "bg-emerald-950/60",
    text: "text-emerald-400",
    border: "border-emerald-700/50",
  },
};

const FALLBACK_ROLE = {
  label: "TOOL",
  bg: "bg-zinc-800/60",
  text: "text-zinc-400",
  border: "border-zinc-700/50",
};

function RoleBadge({ toolName }: { toolName: string | undefined }) {
  const cfg = toolName ? (TOOL_ROLE[toolName] ?? FALLBACK_ROLE) : FALLBACK_ROLE;
  return (
    <span
      className={[
        "inline-flex items-center text-[10px] font-mono font-bold px-2 py-0.5 rounded border",
        cfg.bg,
        cfg.text,
        cfg.border,
      ].join(" ")}
    >
      {cfg.label}
    </span>
  );
}

// ─── Clause chips ─────────────────────────────────────────────────────────────

function ClauseChips({ clauses }: { clauses: string[] }) {
  if (!clauses || clauses.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {clauses.map((c) => (
        <span
          key={c}
          className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700"
        >
          {c}
        </span>
      ))}
    </div>
  );
}

// ─── Confidence meter ─────────────────────────────────────────────────────────

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  // Color: green ≥65%, amber 40–64%, red <40%
  const barColor =
    pct >= 65
      ? "bg-emerald-500"
      : pct >= 40
        ? "bg-amber-500"
        : "bg-rose-500";
  const textColor =
    pct >= 65 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">
          Confidence
        </span>
        <span className={["text-xs font-mono font-bold", textColor].join(" ")}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={["h-full rounded-full animate-fill-bar", barColor].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {pct < 65 && (
        <p className="text-[10px] text-rose-400 mt-1">
          Below 65% threshold — escalation required
        </p>
      )}
    </div>
  );
}

// ─── Outcome card (inside tool_result for decide_refund) ──────────────────────

function OutcomeCard({ outcome }: { outcome: RefundOutcome }) {
  return (
    <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <DecisionBadge decision={outcome.decision} size="sm" />
        {outcome.overridden && (
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400 bg-amber-950/50 border border-amber-700/40 px-2 py-0.5 rounded">
            OVERRIDDEN BY POLICY
          </span>
        )}
        <span className="text-[10px] font-mono text-zinc-500 ml-auto">
          policy v{outcome.policy_version}
        </span>
      </div>

      {/* Money */}
      <div className="flex gap-4">
        <div>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">Refund</p>
          <p className="text-base font-mono font-bold text-emerald-400">
            ${outcome.amount.toFixed(2)}
          </p>
        </div>
        {outcome.restocking_fee > 0 && (
          <div>
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">
              Restocking fee
            </p>
            <p className="text-base font-mono font-bold text-rose-400">
              −${outcome.restocking_fee.toFixed(2)}
            </p>
          </div>
        )}
      </div>

      {/* Reason */}
      <p className="text-xs text-zinc-400 leading-relaxed">{outcome.reason}</p>

      {/* Confidence */}
      <ConfidenceMeter confidence={outcome.confidence} />

      {/* Violated clauses */}
      {outcome.violated_clauses.length > 0 && (
        <div>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-1">
            Governing clauses
          </p>
          <ClauseChips clauses={outcome.violated_clauses} />
        </div>
      )}
    </div>
  );
}

// ─── Single trace event row ───────────────────────────────────────────────────

function TraceRow({ event, idx }: { event: TraceEvent; idx: number }) {
  const { type, data, timestamp, step } = event;

  // Format timestamp for compact display
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Is this a decide_refund result? Cast to RefundOutcome if so.
  const isDecideResult =
    type === "tool_result" &&
    data.tool_name === "decide_refund" &&
    data.tool_result !== null &&
    typeof data.tool_result === "object" &&
    "decision" in (data.tool_result as object);

  const outcome = isDecideResult ? (data.tool_result as RefundOutcome) : null;

  // ── policy_violation — striking guardrail callout ────────────────────────
  if (type === "policy_violation") {
    return (
      <div
        className="animate-trace-in animate-guardrail relative rounded-xl border border-red-700/50 bg-red-950/20 p-3 ml-2"
        style={{ animationDelay: `${idx * 30}ms` }}
      >
        {/* Left accent bar */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500 rounded-l-xl" />
        <div className="flex items-start gap-2 pl-3">
          <span className="text-red-400 text-base mt-0.5" aria-hidden>⛔</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-wider">
                POLICY GUARDRAIL FIRED — held the line
              </span>
              <span className="text-[10px] font-mono text-zinc-600 ml-auto">{time}</span>
            </div>
            {data.error_message && (
              <p className="text-xs text-red-300/90 mt-1 leading-relaxed">
                {data.error_message}
              </p>
            )}
            {data.violated_clauses && data.violated_clauses.length > 0 && (
              <ClauseChips clauses={data.violated_clauses} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── decision — prominent banner ──────────────────────────────────────────
  if (type === "decision" && data.decision) {
    return (
      <div
        className="animate-trace-in relative rounded-xl border border-zinc-700 bg-zinc-900/70 p-3 ml-2"
        style={{ animationDelay: `${idx * 30}ms` }}
      >
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-600 rounded-l-xl" />
        <div className="pl-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">
              STEP {step} · FINAL OUTCOME
            </span>
            <span className="text-[10px] font-mono text-zinc-600 ml-auto">{time}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <DecisionBadge decision={data.decision} size="md" />
          </div>
          {data.violated_clauses && data.violated_clauses.length > 0 && (
            <ClauseChips clauses={data.violated_clauses} />
          )}
        </div>
      </div>
    );
  }

  // ── tool_call ────────────────────────────────────────────────────────────
  if (type === "tool_call") {
    return (
      <div
        className="animate-trace-in relative rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 ml-2"
        style={{ animationDelay: `${idx * 30}ms` }}
      >
        {/* Rail dot */}
        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-zinc-600" />
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <RoleBadge toolName={data.tool_name} />
          <span className="text-xs font-mono text-zinc-400">{data.tool_name}</span>
          <span className="text-[10px] font-mono text-zinc-600 ml-auto">{time}</span>
        </div>
        {data.tool_args && (
          <pre className="text-[11px] font-mono leading-relaxed text-zinc-400 overflow-x-auto bg-zinc-950/60 rounded-lg p-2 border border-zinc-800">
            <ColorizedJson value={data.tool_args} />
          </pre>
        )}
      </div>
    );
  }

  // ── tool_result ──────────────────────────────────────────────────────────
  if (type === "tool_result") {
    return (
      <div
        className="animate-trace-in relative rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 ml-2"
        style={{ animationDelay: `${idx * 30}ms` }}
      >
        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-zinc-700" />
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wide">
            Result
          </span>
          <RoleBadge toolName={data.tool_name} />
          <span className="text-xs font-mono text-zinc-500">{data.tool_name}</span>
          <span className="text-[10px] font-mono text-zinc-600 ml-auto">{time}</span>
        </div>

        {/* Rich outcome card for decide_refund */}
        {outcome ? (
          <OutcomeCard outcome={outcome} />
        ) : (
          /* Compact JSON for other tools */
          <pre className="text-[11px] font-mono leading-relaxed text-zinc-400 overflow-x-auto bg-zinc-950/60 rounded-lg p-2 border border-zinc-800">
            <ColorizedJson value={data.tool_result} />
          </pre>
        )}
      </div>
    );
  }

  // ── thought / heartbeat / error — compact row ────────────────────────────
  return (
    <div
      className="animate-trace-in relative flex items-start gap-2 py-1.5 pl-2"
      style={{ animationDelay: `${idx * 30}ms` }}
    >
      <div className="absolute -left-2 top-2.5 w-1 h-1 rounded-full bg-zinc-700 flex-shrink-0" />
      <span
        className={[
          "text-[10px] font-mono uppercase tracking-wide flex-shrink-0 pt-0.5",
          type === "error" ? "text-rose-500" : "text-zinc-600",
        ].join(" ")}
      >
        {type}
      </span>
      <span className="text-xs text-zinc-500 leading-relaxed">
        {data.text ?? data.error_message ?? ""}
      </span>
      <span className="text-[10px] font-mono text-zinc-700 ml-auto flex-shrink-0">{time}</span>
    </div>
  );
}

// ─── ReasoningPanel ───────────────────────────────────────────────────────────

interface ReasoningPanelProps {
  /** Flat ordered list of all trace events across all messages. */
  traces: TraceEvent[];
  /** Item name sourced from the first crm_lookup tool result, for ApprovalCard. */
  itemName?: string;
}

export function ReasoningPanel({ traces, itemName }: ReasoningPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new traces arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [traces.length]);

  // Find the latest decide_refund outcome (if any) to conditionally show ApprovalCard
  let latestOutcome: RefundOutcome | null = null;
  for (let i = traces.length - 1; i >= 0; i--) {
    const ev = traces[i];
    if (
      ev.type === "tool_result" &&
      ev.data.tool_name === "decide_refund" &&
      ev.data.tool_result !== null &&
      typeof ev.data.tool_result === "object" &&
      "decision" in (ev.data.tool_result as object)
    ) {
      latestOutcome = ev.data.tool_result as RefundOutcome;
      break;
    }
  }

  const needsApproval =
    latestOutcome !== null &&
    latestOutcome.decision === "approve" &&
    latestOutcome.amount > 500;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Panel header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
        {/* Animated "live" dot */}
        {traces.length > 0 && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
          </span>
        )}
        <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-widest">
          Reasoning Timeline
        </span>
        {traces.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-zinc-600">
            {traces.length} event{traces.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Scrollable timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {traces.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full text-center py-16 select-none">
            {/* Decorative icon cluster */}
            <div className="flex items-center gap-3 mb-5 opacity-30">
              <span className="text-2xl">🔍</span>
              <span className="text-zinc-600 text-lg">→</span>
              <span className="text-2xl">📋</span>
              <span className="text-zinc-600 text-lg">→</span>
              <span className="text-2xl">✓</span>
            </div>
            <p className="text-sm font-semibold text-zinc-500 mb-2">
              No reasoning yet
            </p>
            <p className="text-xs text-zinc-600 max-w-xs leading-relaxed">
              Pick a scenario or ask about a refund — the agent&apos;s full reasoning
              (lookup → policy → decision) streams here live.
            </p>
            <div className="mt-6 flex gap-2 opacity-20">
              <span className="h-1 w-8 rounded-full bg-sky-500" />
              <span className="h-1 w-8 rounded-full bg-purple-500" />
              <span className="h-1 w-8 rounded-full bg-emerald-500" />
            </div>
          </div>
        ) : (
          /* Timeline */
          <div className="relative">
            {/* Vertical rail line */}
            <div
              className="absolute left-0 top-0 bottom-0 w-px bg-zinc-800"
              aria-hidden
            />

            <div className="space-y-2 pl-4">
              {/* HITL approval card pinned above timeline if needed */}
              {needsApproval && latestOutcome && (
                <div className="mb-4">
                  <ApprovalCard
                    outcome={latestOutcome}
                    itemName={itemName ?? "item"}
                  />
                </div>
              )}

              {traces.map((event, idx) => (
                <TraceRow key={event.id} event={event} idx={idx} />
              ))}
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
