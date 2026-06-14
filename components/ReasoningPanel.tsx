"use client";

/**
 * ReasoningPanel — the live reasoning dashboard (star of the show).
 *
 * Receives the flat list of all TraceEvents (across all messages, in order)
 * and renders a connected-node vertical timeline. Each event has a circular
 * node on the rail, colored by type. Cards sit to the right of their node.
 *
 * Rail architecture:
 *   - A 1px continuous vertical line (zinc-800) runs down the left.
 *   - Each event has a ~10px circular node centered on the rail, colored by type.
 *   - The last node when streaming pulses with a ping ring.
 *   - Nodes use nodePop keyframe for crisp entry; cards use traceIn.
 *   - No idx-scaled animation delay — events arrive naturally staggered.
 *
 * JSON rendering: a lightweight recursive colorizer. Colors match .json-* in globals.css.
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
        {/* tabular-nums: prevents number jitter as value updates */}
        <span className={["text-xs font-mono font-bold tabular-nums", textColor].join(" ")}>
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
    <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3.5 space-y-3">
      {/* Header row: badge + override pill + policy version */}
      <div className="flex items-center gap-2 flex-wrap">
        <DecisionBadge decision={outcome.decision} size="sm" />
        {outcome.overridden && (
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400 bg-amber-950/50 border border-amber-700/40 px-2 py-0.5 rounded">
            OVERRIDDEN BY POLICY
          </span>
        )}
        <span className="text-[10px] font-mono text-zinc-500 ml-auto tabular-nums">
          policy v{outcome.policy_version}
        </span>
      </div>

      {/* Money — the verdict climax. Large, confident, tabular-nums to prevent jitter. */}
      <div className="flex items-end gap-5">
        <div>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-0.5">
            Refund
          </p>
          <p className="text-3xl font-mono font-bold tabular-nums text-emerald-400 leading-none">
            ${outcome.amount.toFixed(2)}
          </p>
        </div>
        {outcome.restocking_fee > 0 && (
          <div className="pb-0.5">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-0.5">
              Restocking fee
            </p>
            <p className="text-lg font-mono font-bold tabular-nums text-rose-400 leading-none">
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

// ─── Rail node — the colored circle on the timeline rail ─────────────────────

/**
 * Node color map by event type. The node sits absolutely centered on the
 * rail line; the card body lives to its right.
 */
const NODE_COLOR: Record<
  string,
  { solid: string; ring: string }
> = {
  tool_call_lookup:       { solid: "bg-sky-400",     ring: "ring-sky-500/30" },
  tool_call_policy:       { solid: "bg-purple-400",  ring: "ring-purple-500/30" },
  tool_call_decision:     { solid: "bg-emerald-400", ring: "ring-emerald-500/30" },
  tool_result_lookup:     { solid: "bg-sky-600",     ring: "ring-sky-600/20" },
  tool_result_policy:     { solid: "bg-purple-600",  ring: "ring-purple-600/20" },
  tool_result_decision:   { solid: "bg-emerald-600", ring: "ring-emerald-600/20" },
  policy_violation:       { solid: "bg-red-400",     ring: "ring-red-500/30" },
  decision:               { solid: "bg-emerald-400", ring: "ring-emerald-500/30" },
  default:                { solid: "bg-zinc-600",    ring: "ring-zinc-600/20" },
};

function getNodeColor(event: TraceEvent): { solid: string; ring: string } {
  if (event.type === "policy_violation") return NODE_COLOR.policy_violation;
  if (event.type === "decision")         return NODE_COLOR.decision;
  if (event.type === "tool_call") {
    if (event.data.tool_name === "crm_lookup")   return NODE_COLOR.tool_call_lookup;
    if (event.data.tool_name === "policy_check") return NODE_COLOR.tool_call_policy;
    if (event.data.tool_name === "decide_refund") return NODE_COLOR.tool_call_decision;
  }
  if (event.type === "tool_result") {
    if (event.data.tool_name === "crm_lookup")   return NODE_COLOR.tool_result_lookup;
    if (event.data.tool_name === "policy_check") return NODE_COLOR.tool_result_policy;
    if (event.data.tool_name === "decide_refund") return NODE_COLOR.tool_result_decision;
  }
  return NODE_COLOR.default;
}

interface RailNodeProps {
  event: TraceEvent;
  isLive: boolean;
}

function RailNode({ event, isLive }: RailNodeProps) {
  const { solid, ring } = getNodeColor(event);
  return (
    /* Node centered on the rail (left-0, translateX(-50%) centers the 10px dot on the 1px line) */
    <div
      aria-hidden
      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 z-10 animate-node-pop"
    >
      {/* Ping ring — only on the last (live/streaming) node */}
      {isLive && (
        <span
          className={[
            "absolute inset-0 rounded-full animate-node-ping",
            solid,
          ].join(" ")}
        />
      )}
      {/* Solid node with subtle ring */}
      <span
        className={[
          "block w-full h-full rounded-full ring-2",
          solid,
          ring,
        ].join(" ")}
      />
    </div>
  );
}

// ─── Single trace event row ───────────────────────────────────────────────────

function TraceRow({ event, isLive }: { event: TraceEvent; isLive: boolean }) {
  const { type, data, timestamp, step } = event;

  // Format timestamp for compact display — readable contrast (zinc-500 min)
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
      <div className="relative pl-5">
        <RailNode event={event} isLive={isLive} />
        <div className="animate-trace-in animate-guardrail rounded-xl border border-red-700/50 bg-red-950/20 p-3 hover:bg-red-950/30 hover:border-red-700/70 transition-colors">
          <div className="flex items-start gap-2">
            {/* SVG shield-x icon — no emoji */}
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" aria-hidden>
              <path d="M8 1.5L13.5 3.5V8C13.5 11 11 13.5 8 14.5C5 13.5 2.5 11 2.5 8V3.5L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-wider">
                  POLICY GUARDRAIL FIRED — held the line
                </span>
                <span className="text-[10px] font-mono text-zinc-500 ml-auto tabular-nums">{time}</span>
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
      </div>
    );
  }

  // ── decision — prominent banner ──────────────────────────────────────────
  if (type === "decision" && data.decision) {
    return (
      <div className="relative pl-5">
        <RailNode event={event} isLive={isLive} />
        <div className="animate-trace-in rounded-xl border border-zinc-700 bg-zinc-900/70 p-3 hover:bg-zinc-900/90 hover:border-zinc-600 transition-colors">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">
              STEP {step} · FINAL OUTCOME
            </span>
            <span className="text-[10px] font-mono text-zinc-500 ml-auto tabular-nums">{time}</span>
          </div>
          <div className="flex items-center gap-2">
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
      <div className="relative pl-5">
        <RailNode event={event} isLive={isLive} />
        <div className="animate-trace-in rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 hover:bg-zinc-900/80 hover:border-zinc-700 transition-colors">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <RoleBadge toolName={data.tool_name} />
            <span className="text-xs font-mono text-zinc-400">{data.tool_name}</span>
            <span className="text-[10px] font-mono text-zinc-500 ml-auto tabular-nums">{time}</span>
          </div>
          {data.tool_args && (
            <pre className="text-[11px] font-mono leading-relaxed text-zinc-400 overflow-x-auto bg-zinc-950/60 rounded-lg p-2 border border-zinc-800">
              <ColorizedJson value={data.tool_args} />
            </pre>
          )}
        </div>
      </div>
    );
  }

  // ── tool_result ──────────────────────────────────────────────────────────
  if (type === "tool_result") {
    return (
      <div className="relative pl-5">
        <RailNode event={event} isLive={isLive} />
        <div className="animate-trace-in rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 hover:bg-zinc-900/60 hover:border-zinc-700 transition-colors">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wide">
              Result
            </span>
            <RoleBadge toolName={data.tool_name} />
            <span className="text-xs font-mono text-zinc-500">{data.tool_name}</span>
            <span className="text-[10px] font-mono text-zinc-500 ml-auto tabular-nums">{time}</span>
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
      </div>
    );
  }

  // ── thought / heartbeat / error — compact row ────────────────────────────
  return (
    <div className="relative pl-5 py-1">
      <RailNode event={event} isLive={isLive} />
      <div className="animate-trace-in flex items-start gap-2 py-1">
        <span
          className={[
            "text-[10px] font-mono uppercase tracking-wide flex-shrink-0 pt-0.5",
            type === "error" ? "text-rose-500" : "text-zinc-500",
          ].join(" ")}
        >
          {type}
        </span>
        <span className="text-xs text-zinc-500 leading-relaxed">
          {data.text ?? data.error_message ?? ""}
        </span>
        <span className="text-[10px] font-mono text-zinc-500 ml-auto flex-shrink-0 tabular-nums">{time}</span>
      </div>
    </div>
  );
}

// ─── Empty state (refined — minimal node-rail glyph, no emoji) ───────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16 select-none">
      {/* Minimal inline-SVG motif: a node rail with three nodes, echoing the timeline */}
      <svg
        viewBox="0 0 40 72"
        fill="none"
        className="w-10 h-[4.5rem] mb-5 opacity-20"
        aria-hidden
      >
        {/* Vertical rail */}
        <line x1="20" y1="0" x2="20" y2="72" stroke="#52525b" strokeWidth="1" />
        {/* Node 1 — sky (lookup) */}
        <circle cx="20" cy="12" r="4" fill="#38bdf8" fillOpacity="0.7" />
        {/* Node 2 — purple (policy) */}
        <circle cx="20" cy="36" r="4" fill="#c084fc" fillOpacity="0.7" />
        {/* Node 3 — emerald (decision) */}
        <circle cx="20" cy="60" r="4" fill="#34d399" fillOpacity="0.7" />
      </svg>

      <p className="text-sm font-semibold text-zinc-500 mb-2">
        No reasoning yet
      </p>
      <p className="text-xs text-zinc-500 max-w-xs leading-relaxed">
        Pick a scenario or ask about a refund — the agent&apos;s full reasoning
        (lookup → policy → decision) streams here live.
      </p>

      {/* Subtle color key */}
      <div className="mt-6 flex items-center gap-3 opacity-25">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400" />
          lookup
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400" />
          policy
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          decision
        </span>
      </div>
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

  // Index of the last trace — that node gets the live ping ring while streaming
  const lastIdx = traces.length - 1;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Panel header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
        {/* Animated "live" dot — only while there are events */}
        {traces.length > 0 && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
          </span>
        )}
        <span className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-widest">
          Reasoning Timeline
        </span>
        {traces.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-zinc-500 tabular-nums">
            {traces.length} event{traces.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Scrollable timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {traces.length === 0 ? (
          <EmptyState />
        ) : (
          /* Connected-node timeline */
          <div className="relative">
            {/*
             * The continuous 1px vertical rail.
             * Positioned at left-2.5 (10px) so the rail runs through the
             * center of the 10px nodes (node: left-0 centered via translate,
             * so its center is at left: 0 + 5px offset from the pl-5 context).
             * Cards sit in pl-5 containers, so they start 20px from the panel edge.
             */}
            <div
              className="absolute top-0 bottom-0 bg-zinc-800"
              style={{ left: "10px", width: "1px" }}
              aria-hidden
            />

            <div className="space-y-2">
              {/* HITL approval card pinned above timeline if needed */}
              {needsApproval && latestOutcome && (
                <div className="mb-4 pl-5">
                  <ApprovalCard
                    outcome={latestOutcome}
                    itemName={itemName ?? "item"}
                  />
                </div>
              )}

              {traces.map((event, idx) => (
                <TraceRow
                  key={event.id}
                  event={event}
                  isLive={idx === lastIdx}
                />
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
