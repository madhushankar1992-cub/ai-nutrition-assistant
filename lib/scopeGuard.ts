export type ScopeCategory =
  | "numeric_target"
  | "personal_weight_recommendation"
  | "medical_advice";

export interface ScopeCheckResult {
  allowed: boolean;
  category?: ScopeCategory;
  matchedText?: string;
}

export const REFUSAL_MESSAGE =
  "I can't provide calorie/weight targets or medical or condition-specific dietary advice. " +
  "Please consult a registered dietitian, physician, or other qualified professional for that.";

// Deliberately code-level (not just prompt-level) enforcement. Kept as its
// own module so the matching strategy (currently rules) can be swapped for
// a classifier without touching route logic.

const NUMERIC_TARGET_PATTERNS: RegExp[] = [
  /\bhow many calories (should|do) i\b/i,
  /\bhow many calories (should|does|do) (he|she|they|i)\b/i,
  /\bcalorie (target|goal|limit|budget)\b/i,
  /\bhow much (protein|fat|carbs?|sugar) should i (eat|consume|have)\b/i,
  /\bmacro (target|goal|split) for me\b/i,
  /\bhow many pounds\/kg should i (lose|gain)\b/i,
  /\bwhat should my (daily )?calorie intake be\b/i,
];

const PERSONAL_WEIGHT_PATTERNS: RegExp[] = [
  /\bwhat should i weigh\b/i,
  /\bwhat('?s| is) my ideal weight\b/i,
  /\bam i overweight\b/i,
  /\bshould i (lose|gain) weight\b/i,
  /\bwhat weight should (he|she|they|i)\b/i,
  /\bis \d+\s?(lbs?|kg|pounds|kilograms) (healthy|too (much|little|heavy|light))\b/i,
];

const MEDICAL_ADVICE_PATTERNS: RegExp[] = [
  /\b(i have|i('?ve)? been diagnosed with|my (doctor|dietitian) says i have)\s+(diabetes|kidney disease|celiac|crohn'?s|hypertension|high blood pressure|heart disease|gout|ibs)\b/i,
  /\bwhat should (i|someone with|a person with) .*(diabetes|kidney disease|celiac|crohn'?s|hypertension|high blood pressure|heart disease|gout|ibs) eat\b/i,
  /\bdiet (plan|recommendation) for (my|a) (condition|diagnosis|disease)\b/i,
  /\bis this safe for someone with (diabetes|kidney disease|heart disease|hypertension)\b/i,
];

function matchAny(
  patterns: RegExp[],
  text: string
): { matched: boolean; matchedText?: string } {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { matched: true, matchedText: match[0] };
    }
  }
  return { matched: false };
}

/**
 * Checks the new user message together with recent conversation history so
 * rephrased, indirect, or split-across-turns requests are still caught
 * (e.g. "asking about a friend" after the user described their own condition
 * earlier in the conversation).
 */
export function checkRequest(
  history: { role: string; content: string }[],
  newMessage: string
): ScopeCheckResult {
  const recentHistory = history
    .slice(-6)
    .map((m) => m.content)
    .join("\n");
  const combined = `${recentHistory}\n${newMessage}`.toLowerCase();

  const numeric = matchAny(NUMERIC_TARGET_PATTERNS, combined);
  if (numeric.matched) {
    return { allowed: false, category: "numeric_target", matchedText: numeric.matchedText };
  }

  const weight = matchAny(PERSONAL_WEIGHT_PATTERNS, combined);
  if (weight.matched) {
    return {
      allowed: false,
      category: "personal_weight_recommendation",
      matchedText: weight.matchedText,
    };
  }

  const medical = matchAny(MEDICAL_ADVICE_PATTERNS, combined);
  if (medical.matched) {
    return { allowed: false, category: "medical_advice", matchedText: medical.matchedText };
  }

  return { allowed: true };
}

/**
 * Defense-in-depth: scans the model's generated answer for disallowed
 * content that may have slipped through despite the system prompt, even
 * when the pre-call request check passed.
 */
export function checkResponse(answer: string): ScopeCheckResult {
  const lower = answer.toLowerCase();

  const numericLeak =
    /\b\d{2,4}\s?(kcal|calories)\b.*\b(per day|daily|target|goal)\b/i.test(lower) ||
    /\byou should (eat|consume|aim for) (about |around )?\d/i.test(lower);
  if (numericLeak) {
    return { allowed: false, category: "numeric_target" };
  }

  const medicalLeak =
    /\bif you have (diabetes|kidney disease|heart disease|hypertension)\b.*\byou should\b/i.test(
      lower
    );
  if (medicalLeak) {
    return { allowed: false, category: "medical_advice" };
  }

  return { allowed: true };
}
