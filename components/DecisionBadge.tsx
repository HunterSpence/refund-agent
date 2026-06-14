"use client";

/**
 * DecisionBadge — reusable colored pill for approve / deny / escalate decisions.
 *
 * Design: compact, high-contrast badge with a subtle filled background and
 * matching border. Uses semantic design tokens from globals.css @theme.
 * Rendered in the ReasoningPanel decision banners, tool-result cards, and
 * the ApprovalCard header.
 *
 * The `md` (verdict) size adds a colored glow ring so the final decision
 * reads as important and draws the eye at a glance.
 */

import type { Decision } from "@/lib/types";

interface DecisionBadgeProps {
  decision: Decision;
  /** Optional size override. Defaults to "sm". */
  size?: "xs" | "sm" | "md";
}

const DECISION_CONFIG: Record<
  Decision,
  { label: string; bg: string; text: string; border: string; dot: string; glow: string }
> = {
  approve: {
    label: "APPROVE",
    bg: "bg-emerald-950/70",
    text: "text-emerald-400",
    border: "border-emerald-600/60",
    dot: "bg-emerald-400",
    glow: "shadow-[0_0_0_2px_rgba(52,211,153,0.18),0_0_12px_rgba(52,211,153,0.12)]",
  },
  deny: {
    label: "DENY",
    bg: "bg-rose-950/70",
    text: "text-rose-400",
    border: "border-rose-600/60",
    dot: "bg-rose-400",
    glow: "shadow-[0_0_0_2px_rgba(251,113,133,0.18),0_0_12px_rgba(251,113,133,0.12)]",
  },
  escalate: {
    label: "ESCALATE",
    bg: "bg-amber-950/70",
    text: "text-amber-400",
    border: "border-amber-600/60",
    dot: "bg-amber-400",
    glow: "shadow-[0_0_0_2px_rgba(251,191,36,0.18),0_0_12px_rgba(251,191,36,0.12)]",
  },
};

const SIZE_CLASSES = {
  xs: "text-[10px] px-1.5 py-0.5 gap-1",
  sm: "text-[11px] px-2 py-1 gap-1.5",
  md: "text-sm px-3 py-1.5 gap-2 font-bold tracking-wider",
};

const DOT_SIZE = {
  xs: "w-1 h-1",
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
};

export function DecisionBadge({ decision, size = "sm" }: DecisionBadgeProps) {
  const cfg = DECISION_CONFIG[decision];
  const isVerdict = size === "md";
  return (
    <span
      aria-label={cfg.label}
      className={[
        "inline-flex items-center font-mono font-semibold rounded border transition-shadow",
        cfg.bg,
        cfg.text,
        cfg.border,
        SIZE_CLASSES[size],
        // Verdict size: add colored glow ring so it reads as the definitive outcome
        isVerdict ? cfg.glow : "",
      ].join(" ")}
    >
      {/* Decorative colored dot — hidden from assistive tech, label on parent covers it */}
      <span
        aria-hidden="true"
        className={["rounded-full flex-shrink-0", cfg.dot, DOT_SIZE[size]].join(" ")}
      />
      {cfg.label}
    </span>
  );
}
