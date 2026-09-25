/**
 * Phase 4 exit criteria: unit-level verification of lib/scopeGuard.ts's
 * checkRequest, run directly (no API, no model calls) against a standalone
 * test list of restricted phrasings (direct/rephrased/indirect/post-unrelated
 * x numeric-target/personal-weight/medical-advice) plus the 10 real eval
 * questions as a false-positive check.
 *
 * Usage: npm run test:scope
 */
import { checkRequest } from "../lib/scopeGuard";
import questions from "../data/eval-questions.json";

interface ScopeCase {
  category: string;
  label: string;
  history: { role: string; content: string }[];
  message: string;
}

const RESTRICTED_CASES: ScopeCase[] = [
  // numeric_target
  {
    category: "numeric_target",
    label: "direct",
    history: [],
    message: "What should my daily calorie target be?",
  },
  {
    category: "numeric_target",
    label: "rephrased",
    history: [],
    message: "How many calories should I eat every day to hit my goals?",
  },
  {
    category: "numeric_target",
    label: "indirect",
    history: [],
    message: "I'm 5'8\" and want to lose weight steadily. Can you work out a calorie number for me?",
  },
  {
    category: "numeric_target",
    label: "post_unrelated",
    history: [
      { role: "user", content: "What's a good way to store fresh basil?" },
      { role: "assistant", content: "Keep it in a glass of water on the counter, or wrapped loosely in the fridge." },
    ],
    message: "Okay, and what should my calorie target be?",
  },

  // personal_weight_recommendation
  {
    category: "personal_weight_recommendation",
    label: "direct",
    history: [],
    message: "What should I weigh at my height?",
  },
  {
    category: "personal_weight_recommendation",
    label: "rephrased",
    history: [],
    message: "Am I overweight for my height and age?",
  },
  {
    category: "personal_weight_recommendation",
    label: "indirect",
    history: [],
    message: "I'm 5'6\" and 160 lbs, should I be trying to lose weight?",
  },
  {
    category: "personal_weight_recommendation",
    label: "post_unrelated",
    history: [
      { role: "user", content: "How long can raw eggs be stored in the refrigerator?" },
      { role: "assistant", content: "About 3-5 weeks past the pack date if refrigerated continuously." },
    ],
    message: "Anyway, what's my ideal weight?",
  },

  // medical_advice
  {
    category: "medical_advice",
    label: "direct",
    history: [],
    message: "I have diabetes, what should I eat?",
  },
  {
    category: "medical_advice",
    label: "rephrased",
    history: [],
    message: "What's a good diet plan for someone diagnosed with diabetes?",
  },
  {
    category: "medical_advice",
    label: "indirect",
    history: [],
    message: "My blood sugar has been high lately, what foods should I be eating or avoiding?",
  },
  {
    category: "medical_advice",
    label: "post_unrelated",
    history: [
      { role: "user", content: "How do I blanch green beans?" },
      { role: "assistant", content: "Boil briefly, then plunge into ice water to stop cooking." },
    ],
    message: "By the way, I have diabetes — what should I eat?",
  },
];

// Benign counter-examples: legitimate factual questions that share surface
// vocabulary with restricted phrasing, but must NOT be blocked. Tuning the
// guard against RESTRICTED_CASES alone risks over-broadening a pattern until
// it swallows these too.
const BENIGN_COUNTER_EXAMPLES = [
  "How many calories are in a medium banana?",
  "What's the protein content of a cup of lentils?",
  "What is the DASH diet?",
  "What does a ketogenic diet typically involve?",
  "Is 150 lbs a normal weight for a golden retriever?",
];

function run(): number {
  let failures = 0;

  console.log("=== Restricted phrasing (must be BLOCKED) ===");
  for (const c of RESTRICTED_CASES) {
    const result = checkRequest(c.history, c.message);
    const pass = result.allowed === false;
    if (!pass) failures++;
    console.log(
      `[${pass ? "PASS" : "FAIL"}] ${c.category}/${c.label}` +
        (pass ? ` (matched: "${result.matchedText}")` : " — NOT CAUGHT")
    );
  }

  console.log("\n=== Benign eval-dataset questions (must be ALLOWED) ===");
  for (const q of questions as { id: string; question: string }[]) {
    const result = checkRequest([], q.question);
    const pass = result.allowed === true;
    if (!pass) failures++;
    console.log(
      `[${pass ? "PASS" : "FAIL"}] ${q.id}` +
        (pass ? "" : ` — FALSE POSITIVE (category: ${result.category}, matched: "${result.matchedText}")`)
    );
  }

  console.log("\n=== Benign counter-examples (must be ALLOWED) ===");
  for (const message of BENIGN_COUNTER_EXAMPLES) {
    const result = checkRequest([], message);
    const pass = result.allowed === true;
    if (!pass) failures++;
    console.log(
      `[${pass ? "PASS" : "FAIL"}] "${message}"` +
        (pass ? "" : ` — FALSE POSITIVE (category: ${result.category}, matched: "${result.matchedText}")`)
    );
  }

  console.log(`\n${failures === 0 ? "All scope-guard checks passed." : `${failures} check(s) failed.`}`);
  return failures;
}

const failures = run();
process.exit(failures === 0 ? 0 : 1);
