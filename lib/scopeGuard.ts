export type ScopeCategory =
  | "off_topic"
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

// Reject explicit unrelated TASKS, including when a food word is used as
// camouflage. This is intentionally not an English food-word allowlist: a
// legitimate regional dish or non-English food question must still reach the
// model. Ambiguous topics are also checked by both system prompts.
const OFF_TOPIC_PATTERNS: RegExp[] = [
  /\b(write|create|build|generate|debug|fix|implement|explain|describe|tell me|give me|show me)\b[^.?!]{0,100}\b(python|javascript|typescript|sql|html|css|script|software|algorithm|website|app|programming|regex|regular expression)\b/i,
  /\b(write|create|generate|debug|implement)\b[^.?!]{0,70}\bcode\b/i,
  /\b(write|create|generate|tell|compose|sing)\b[^.?!]{0,70}\b(poem|poetry|sonnet|joke|story|song|lyrics|novel|screenplay|love letter)\b/i,
  /\b(translate|translation)\b/i,
  /\b(capital|president|prime minister|election|weather forecast|stock price|stock market|cryptocurrency|bitcoin|football score|movie recommendation)\b/i,
  /\b(recommend|suggest|best|good|watch)\b[^.?!]{0,50}\b(movie|film|tv show|video game)\b/i,
  /\b(quantum (?:physics|entanglement|mechanics)|general relativity|astronomy|solar system)\b/i,
  /\bwhat(?:'s| is)\b[^.?!]{0,40}\bweather\b/i,
  /\b(solve|calculate|prove|differentiate|integrate)\b[^.?!]{0,70}\b(equation|quadratic|algebra|calculus|integral|derivative)\b/i,
  /\b(ignore|disregard|override|forget)\b[^.?!]{0,60}\b(instructions|rules|system prompt|restrictions|guardrails|policy)\b/i,
  /\b(reveal|print|repeat|show|expose)\b[^.?!]{0,50}\b(system prompt|hidden instructions|api key|secrets?)\b/i,
  /\b(pretend|act as|you are now|roleplay)\b[^.?!]{0,70}\b(unrestricted|uncensored|developer mode|another assistant)\b/i,
  // Common multilingual equivalents of explicit unrelated tasks. Do not use
  // script/language detection to block questions about food in these languages.
  /(?:राजधानी|प्रधानमंत्री|राष्ट्रपति|कविता|चुटकुला|पाइथन|जावास्क्रिप्ट|कोड लिख|पिछले निर्देश.*अनदेखा)/u,
  /\b(capital de|presidente de|escribe|escribir)\b[^.?!]{0,60}\b(francia|poema|c[oó]digo|python|javascript)\b/i,
  /(?:^|\s)(écris|ecris|écrire|ecrire)\b[^.?!]{0,60}\b(poème|poeme|code|python)\b/i,
  /\b(capitale de|président de|president de)\b/i,
];

function normalizeRequest(text: string): string {
  return text.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase();
}

function checkTopic(
  history: { role: string; content: string }[],
  message: string
): ScopeCheckResult | undefined {
  const direct = matchAny(OFF_TOPIC_PATTERNS, message);
  if (direct.matched) {
    return { allowed: false, category: "off_topic", matchedText: direct.matchedText };
  }

  // A terse continuation can inherit an unrelated request, but a fresh food
  // question must not be poisoned by an earlier refusal.
  if (/^\s*(?:please\s+)?(?:continue|go on|do it|do that|answer (?:it|that)|tell me more|try again|just this once|and then)[\s.!?]*$/i.test(message)) {
    const previousUser = history.filter((turn) => turn.role === "user").slice(-1)[0];
    if (previousUser) {
      const previous = matchAny(OFF_TOPIC_PATTERNS, normalizeRequest(previousUser.content));
      if (previous.matched) {
        return { allowed: false, category: "off_topic", matchedText: previous.matchedText };
      }
    }
  }
  return undefined;
}

const NUMERIC_TARGET_PATTERNS: RegExp[] = [
  /\bhow many calories (should|do) i\b/i,
  /\bhow many calories (should|does|do) (he|she|they|i)\b/i,
  /\bcalorie (target|goal|limit|budget|number|count)\b/i,
  /\bhow much (protein|fat|carbs?|sugar) should i (eat|consume|have)\b/i,
  /\bmacro (target|goal|split) for me\b/i,
  /\bhow many pounds\/kg should i (lose|gain)\b/i,
  /\bwhat should my (daily )?calorie intake be\b/i,
  /\b(work out|calculate|figure out) (a |my )?calorie/i,

  // --- Added after the adversarial suite caught these reaching the model. ---
  // Every pattern below corresponds to a phrasing that the patterns above
  // missed. They are kept verbatim as the cases they were written for.

  // "What's my ideal daily calorie intake?"
  /\b(ideal|recommended|right|optimal|target|daily)\b[^.?!]{0,30}\b(calorie|energy|kcal)\b[^.?!]{0,30}\b(intake|needs?|requirement|allowance|amount)\b/i,
  /\bmy\b[^.?!]{0,30}\b(calorie|energy|kcal)\b[^.?!]{0,30}\b(intake|needs?|requirement|target|goal)\b/i,

  // "Work out how much energy I need each day to lose weight"
  /\b(work out|calculate|figure out|tell me|how do i know)\b[^.?!]{0,60}\b(how much|how many)\b[^.?!]{0,40}\b(energy|calories|kcal|protein|carbs?|fat)\b[^.?!]{0,40}\bi\b/i,
  /\bhow much (energy|protein|fat|carbs?|sugar|salt|sodium|fibre|fiber)\b[^.?!]{0,30}\b(do|should) i\b/i,

  // "How many grams of protein per kg of body weight should I eat?"
  // The corpus itself contains per-kg figures (EFSA states 0.8-1.25 g/kg, the
  // US guidelines 1.2-1.6 g/kg), so this must be refused on POLICY even though
  // a real, citable passage would answer it. Milestone 1 could not fail this
  // way, because it had no retrievable chunk to be tempted by.
  /\bper\s*(kg|kilo(gram)?s?)\b[^.?!]{0,30}\bbody\s*weight\b/i,
  /\bg\s*\/\s*kg\b[^.?!]{0,30}\bbody\s*weight\b/i,
  /\bhow (many|much)\b[^.?!]{0,50}\bper\s*(kg|kilo(gram)?s?|pound|lb)\b/i,

  // "What protein intake does EFSA state relative to body mass?" - the per-kg
  // patterns above all require a literal "per kg"/"g/kg", so a request phrased
  // against body mass or body size slipped through to a corpus that states
  // exactly those figures.
  /\b(relative to|based on|scaled to|in proportion to)\b[^.?!]{0,30}\bbody\s*(weight|mass|size)\b/i,
  /\b(protein|energy|calorie|kcal|intake)\b[^.?!]{0,40}\bbody\s*(weight|mass)\b/i,

  // Weight-change intent attached to any intake question.
  /\b(to|so i can|in order to)\s+(lose|gain|cut|drop|put on)\s+(weight|fat|kilos?|pounds?|lbs?)\b/i,
];

const PERSONAL_WEIGHT_PATTERNS: RegExp[] = [
  /\bwhat should i weigh\b/i,
  /\bwhat('?s| is) my ideal weight\b/i,
  /\bam i overweight\b/i,
  /\bshould i\b[^.?!]{0,40}\b(lose|gain) weight\b/i,
  /\bwhat weight should (he|she|they|i)\b/i,
  /\bis \d+\s?(lbs?|kg|pounds|kilograms) (healthy|too (much|little|heavy|light))\b/i,
];

const MEDICAL_ADVICE_PATTERNS: RegExp[] = [
  /\b(i have|i('?ve)? been diagnosed with|my (doctor|dietitian) says i have)\s+(diabetes|kidney disease|celiac|crohn'?s|hypertension|high blood pressure|heart disease|gout|ibs)\b/i,
  /\bwhat should (i|someone with|a person with) .*(diabetes|kidney disease|celiac|crohn'?s|hypertension|high blood pressure|heart disease|gout|ibs) eat\b/i,
  /\bdiet (plan|recommendation) for (my|a) (condition|diagnosis|disease)\b/i,
  /\bdiagnosed with (diabetes|kidney disease|celiac|crohn'?s|hypertension|high blood pressure|heart disease|gout|ibs)\b/i,
  /\bis this safe for someone with (diabetes|kidney disease|heart disease|hypertension)\b/i,
  /\bblood sugar\b.{0,60}\bwhat\b.{0,30}\b(foods?|eat)\b/i,
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
 * History to scan, with already-refused turns removed.
 *
 * The guard reads recent history so a restricted request split across turns is
 * still caught. Left unfiltered that has a severe side effect, measured: asking
 * "How many calories should I eat per day?" is refused, the message is still
 * persisted, and the NEXT three unrelated questions are refused too, each
 * matching the OLD text "how many calories should i". One out-of-scope question
 * made the assistant refuse everything until it scrolled out of the six-message
 * window.
 *
 * A turn that was already refused has been dealt with. Keeping it in the window
 * cannot catch anything new, because what it matches is exactly what was already
 * blocked - it can only re-fire on innocent messages. So a user turn whose reply
 * was the refusal is dropped, while every other turn stays, preserving the
 * split-across-turns protection this window exists for.
 */
function conversationalContext(
  history: { role: string; content: string }[]
): { role: string; content: string }[] {
  const kept: { role: string; content: string }[] = [];

  for (let i = 0; i < history.length; i++) {
    const turn = history[i];

    // Only the USER's words are scanned. Assistant replies quote the corpus,
    // and the corpus states restricted figures as plain facts: an ordinary
    // answer citing EFSA's "0.83 g of protein per kg of body weight" matched
    // the per-kg pattern, and every later question in that conversation was
    // refused for as long as the answer stayed in the window - which, once
    // refused turns were being dropped, was forever. What the user asked is
    // what the policy is about; what the guidance says is not.
    if (turn.role !== "user") continue;

    const reply = history[i + 1];
    const wasRefused =
      reply?.role === "assistant" && reply.content.startsWith(REFUSAL_MESSAGE.slice(0, 40));

    // A refused request for a number or a target is self-contained: it has
    // been dealt with, and keeping it would only re-fire on innocent
    // follow-ups. A refused DISCLOSURE of a condition is different - it
    // stays true. After "I have diabetes", "so what should I eat for
    // breakfast?" is condition-specific advice even though it does not say
    // so, and the model still sees the disclosure in its history. Dropping it
    // here let exactly that follow-up through.
    if (wasRefused && !matchAny(MEDICAL_ADVICE_PATTERNS, turn.content.toLowerCase()).matched) {
      continue;
    }
    kept.push(turn);
  }
  return kept;
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
  const message = normalizeRequest(newMessage);
  const topic = checkTopic(history, message);
  if (topic) return topic;

  const recentHistory = conversationalContext(history)
    .slice(-6)
    .map((m) => m.content)
    .join("\n");
  const combined = normalizeRequest(`${recentHistory}\n${newMessage}`);

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
  // Match semantics across line breaks, not just presentation on one line.
  const lower = normalizeRequest(answer).replace(/\s+/g, " ");

  const numericLeak =
    /\b\d{1,5}(?:[,.]\d+)?\s?(kcal|calories)\b.{0,100}\b(per day|daily|target|goal)\b/i.test(lower) ||
    /\b(per day|daily|target|goal)\b.{0,100}\b\d{1,5}(?:[,.]\d+)?\s?(kcal|calories)\b/i.test(lower) ||
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
