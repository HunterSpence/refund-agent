/**
 * lib/agent/guard.ts — Task 1.4: Guardrails
 *
 * Two independent, pure defenses:
 *
 *   1. sanitizeInput  — PRE-LOOP middleware that scans customer text for
 *      prompt-injection / jailbreak patterns BEFORE the LLM is ever called.
 *      On a hit it short-circuits the agent loop to "escalate" and returns
 *      enough structured data for the caller to emit a trace event and log.
 *      It does NOT call console.log / emit / store anything itself — pure fn.
 *
 *   2. validateToolArgs — DEFENSE-IN-DEPTH that re-validates the structured
 *      arguments the LLM emits via tool calls. The tools already have Zod
 *      schemas; this is a bespoke second layer that catches adversarial edge
 *      cases (negative amounts, NaN confidence, etc.) and accumulates ALL
 *      errors rather than stopping at the first.
 *
 * Design boundaries (defensible in a live walkthrough):
 *
 *   - sanitizeInput guards against *instruction-subversion* only: patterns that
 *     attempt to modify the agent's operating rules, extract system context, or
 *     assume a new identity/role.
 *
 *   - Social engineering (legal threats, authority claims, "I'm the CEO",
 *     "it's day 31 but make an exception") is NOT injection — it is caught
 *     by the deterministic policy engine holding the line. Over-blocking
 *     legitimate angry-customer language here would harm real users.
 *
 *   - The regex patterns are written to be case-insensitive and to tolerate
 *     whitespace variation, but deliberately narrow: we want high precision
 *     (low false-positive rate) at the cost of some recall on exotic variants.
 *     Unknown exotic jailbreaks fall through to the LLM with a hard policy
 *     guardrail beneath it (applyRefundPolicy in policy.ts) — a sound
 *     defense-in-depth posture.
 */

import type { Decision } from "@/lib/types";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Result of scanning a customer message for prompt-injection / jailbreak attempts.
 *
 * When `safe` is true the agent loop should proceed normally.
 * When `safe` is false the loop MUST short-circuit: use `decision` and `reason`
 * to emit a trace event, log the `matched` labels, and return without calling
 * the LLM.
 */
export interface SanitizeResult {
  /** true when the text is clean; false when an injection attempt was detected. */
  safe: boolean;
  /** Labels of the patterns that matched (for logging + the trace). Empty when safe. */
  matched: string[];
  /** When unsafe, the forced decision the agent loop should short-circuit to. */
  decision?: Extract<Decision, "escalate">;
  /** When unsafe, a short human-readable reason for the trace/log. */
  reason?: string;
}

/**
 * Result of validating a single tool call's arguments.
 *
 * `valid` is true only when `errors` is empty. Collect ALL failures before
 * returning so the caller can log the full set at once — don't stop early.
 */
export interface ToolArgValidation {
  valid: boolean;
  errors: string[];
}

// ─── Injection pattern registry ───────────────────────────────────────────────

/**
 * A single labelled injection-detection rule.
 *
 * `label` is the canonical name that appears in SanitizeResult.matched and in
 * the reason string. Keep labels kebab-case and unique across the registry.
 *
 * `patterns` are tested with RegExp.test() against the full input string.
 * Any single pattern matching triggers the label. Using multiple patterns per
 * label allows one family to be covered by a few targeted regexes without a
 * single over-broad expression.
 */
interface InjectionRule {
  label: string;
  patterns: RegExp[];
}

/**
 * The active injection-detection registry.
 *
 * Ordering matters for the reason string (matched labels are reported in the
 * order they appear in this array), but the safety verdict is the same
 * regardless of order.
 *
 * Tuning notes (for reviewers):
 *   - Patterns are case-insensitive (`i` flag).
 *   - We deliberately avoid matching "rules" in isolation (too broad) and
 *     require a nearby instruction/policy/system qualifier.
 *   - "act as" is matched only when preceded by "pretend", "roleplay", or
 *     standalone "act to be" / "act as" with a word boundary — this avoids
 *     catching "I acted as a customer" style past-tense narratives.
 */
const INJECTION_RULES: InjectionRule[] = [
  {
    // Family 1: explicit "ignore X instructions / prompts / rules" phrasing.
    // Also covers "disregard" variants (disregard your instructions/rules/policy).
    label: "ignore-instructions",
    patterns: [
      /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
      /disregard\s+(all\s+)?(the\s+)?(instructions?|rules?|policy|policies)/i,
    ],
  },
  {
    // Family 2: identity hijack via "you are now …" or "new instructions:" header.
    // "you are now" is highly specific; "new instructions:" is the classic prompt-
    // header injection technique used in multi-turn attacks.
    label: "you-are-now",
    patterns: [
      /you\s+are\s+now\b/i,
      /new\s+instructions?\s*:/i,
    ],
  },
  {
    // Family 3: system prompt extraction — asking the agent to reveal, print,
    // repeat, or describe its own internal instructions/system prompt.
    label: "system-prompt-extraction",
    patterns: [
      /(reveal|show|print|repeat|what('?s| is))\s+.{0,40}(system\s+prompt|your\s+(instructions?|prompt|rules?))/i,
    ],
  },
  {
    // Family 4: policy / refund directive override — "override the policy",
    // "override the rules", "override refund system". Distinct from family 1
    // in that it targets the policy/system specifically rather than instructions.
    label: "override-policy",
    patterns: [
      /override\s+.{0,30}(policy|policies|refund|rules?|system)/i,
      /disregard\s+.{0,30}(policy|policies|rules?|instructions?)/i,
    ],
  },
  {
    // Family 5: roleplay / pretend / act-as identity substitution.
    // We require a clear role-assignment verb + a subject framing ("you are",
    // "to be", "as") to avoid catching past-tense narratives or metaphors.
    // "roleplay as" without a subject is also caught.
    label: "roleplay-pretend",
    patterns: [
      /\b(pretend|roleplay|act)\s+(you\s+are|to\s+be|as\b)/i,
    ],
  },
  {
    // Family 6: developer/admin/god/DAN mode activation and the "jailbreak" keyword.
    // "DAN" (Do Anything Now) is a well-known ChatGPT jailbreak persona.
    // Word-boundary on the mode suffixes prevents matching "administrator" etc.
    label: "dev-mode-jailbreak",
    patterns: [
      /\b(developer|admin|god|dan)\s+mode\b/i,
      /\bjailbreak\b/i,
    ],
  },
];

// ─── sanitizeInput ────────────────────────────────────────────────────────────

/**
 * Pre-loop injection middleware: scan untrusted customer text.
 *
 * Tests every registered InjectionRule against the input. If any rule fires,
 * the function returns a SanitizeResult with safe=false, the union of all
 * matched rule labels, decision="escalate", and a reason string that names
 * the labels for the trace/log.
 *
 * Pure function — no side effects, no I/O, no state mutation. The caller is
 * responsible for logging and emitting trace events.
 *
 * @param text  Raw customer message to scan.
 * @returns     SanitizeResult — caller checks `.safe` before calling the LLM.
 */
export function sanitizeInput(text: string): SanitizeResult {
  const matched: string[] = [];

  for (const rule of INJECTION_RULES) {
    const hit = rule.patterns.some((pattern) => pattern.test(text));
    if (hit) {
      matched.push(rule.label);
    }
  }

  if (matched.length === 0) {
    return { safe: true, matched: [] };
  }

  const labelList = matched.join(", ");
  return {
    safe: false,
    matched,
    decision: "escalate",
    reason: `Possible prompt-injection detected: ${labelList}`,
  };
}

// ─── validateToolArgs ─────────────────────────────────────────────────────────

/**
 * Defense-in-depth validation of tool-call arguments by tool name.
 *
 * Runs a bespoke validation pass on the raw `args` object the LLM emitted.
 * All errors are collected before returning — the caller receives the full
 * picture, not just the first failure. `valid` is true iff errors is empty.
 *
 * Supported tools:
 *   - "crm_lookup"   : requires non-empty string `order_id`.
 *   - "policy_check" : requires non-empty string `order_id`.
 *   - "decide_refund": full multi-field validation (decision enum, confidence
 *                      range, reason length, proposed_amount).
 *
 * Unknown tool names produce a single descriptive error without throwing.
 *
 * @param toolName  The name of the tool as emitted by the LLM.
 * @param args      The raw argument object from the tool call.
 * @returns         ToolArgValidation with `valid` and accumulated `errors`.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): ToolArgValidation {
  const errors: string[] = [];

  switch (toolName) {
    case "crm_lookup":
    case "policy_check":
      // Both tools share the same single-field contract.
      validateOrderId(args, errors);
      break;

    case "decide_refund":
      validateDecideRefund(args, errors);
      break;

    default:
      errors.push(`unknown tool: ${toolName}`);
      break;
  }

  return { valid: errors.length === 0, errors };
}

// ─── Field validators (private helpers) ──────────────────────────────────────

/**
 * Validate that args.order_id is a non-empty, non-whitespace-only string.
 * Appends an error to `errors` if the check fails.
 */
function validateOrderId(args: Record<string, unknown>, errors: string[]): void {
  const id = args["order_id"];
  if (typeof id !== "string" || id.trim().length === 0) {
    errors.push(
      "order_id: must be a non-empty string (e.g. \"ORD-1234\"); got " +
        JSON.stringify(id),
    );
  }
}

/** Valid values for the `decision` field of decide_refund. */
const VALID_DECISIONS: ReadonlySet<string> = new Set(["approve", "deny", "escalate"]);

/**
 * Full validation pass for the decide_refund tool.
 *
 * Checks performed (all failures collected, none short-circuits):
 *   1. decision ∈ {"approve","deny","escalate"} — exact match, case-sensitive.
 *   2. confidence is a finite number in [0, 1].
 *   3. reason is a string with length ≥ 20.
 *   4. proposed_amount is null OR a finite number ≥ 0.
 */
function validateDecideRefund(
  args: Record<string, unknown>,
  errors: string[],
): void {
  // ── 1. decision ────────────────────────────────────────────────────────────
  const decision = args["decision"];
  if (typeof decision !== "string" || !VALID_DECISIONS.has(decision)) {
    errors.push(
      `decision: must be one of "approve", "deny", "escalate" (exact, case-sensitive); got ${JSON.stringify(decision)}`,
    );
  }

  // ── 2. confidence ──────────────────────────────────────────────────────────
  const confidence = args["confidence"];
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    errors.push(
      `confidence: must be a finite number in [0, 1]; got ${JSON.stringify(confidence)}`,
    );
  }

  // ── 3. reason ──────────────────────────────────────────────────────────────
  const reason = args["reason"];
  if (typeof reason !== "string" || reason.length < 20) {
    errors.push(
      `reason: must be a string of at least 20 characters (cite the governing clause); got ${JSON.stringify(reason)}`,
    );
  }

  // ── 4. proposed_amount ─────────────────────────────────────────────────────
  const pa = args["proposed_amount"];
  if (pa !== null) {
    // null is the valid sentinel for deny/escalate decisions.
    // Anything else must be a finite non-negative number.
    if (
      typeof pa !== "number" ||
      !Number.isFinite(pa) ||
      pa < 0
    ) {
      errors.push(
        `proposed_amount: must be null or a finite non-negative number; got ${JSON.stringify(pa)}`,
      );
    }
  }
}
