import { createHash } from "node:crypto";
import { z } from "zod";
import type { PolicyQuestion } from "@/db/schema";

/**
 * The typed decision contract shared by every provider.
 *
 * The model can only return nine closed answers: enums, booleans, and a
 * bounded confidence number. There is no prose field, no explanation, and no
 * string longer than an enum member. `z.strictObject` rejects unknown keys, so
 * any model-authored sentence fails validation and the caller falls back to
 * the labelled deterministic engine.
 */

export const QUESTION_IDS = [
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "Q5",
  "Q6",
  "Q7",
  "Q8",
  "Q9",
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export const ANSWER_TYPES = ["yesno", "pick"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const PICK_ANSWERS = [
  "weekday_morning",
  "weekday_afternoon",
  "weekday_evening",
  "saturday",
  "sunday",
  "flexible",
  "none_stated",
  "reheats",
  "fresh",
  "either",
  "not_a_meal",
  "unknown",
] as const;

export type PickAnswer = (typeof PICK_ANSWERS)[number];
export type TypedAnswer = boolean | PickAnswer;

/** The only pick domains the typed questions allow. */
export const PICK_OPTIONS_BY_QUESTION: Partial<
  Record<QuestionId, readonly PickAnswer[]>
> = {
  Q4: [
    "weekday_morning",
    "weekday_afternoon",
    "weekday_evening",
    "saturday",
    "sunday",
    "flexible",
    "none_stated",
  ],
  Q7: ["reheats", "fresh", "either", "not_a_meal", "unknown"],
};

/** Human labels for the closed pick values (UI and trail copy). */
export const PICK_LABELS: Record<PickAnswer, string> = {
  weekday_morning: "weekday morning",
  weekday_afternoon: "weekday afternoon",
  weekday_evening: "weekday evening",
  saturday: "Saturday",
  sunday: "Sunday",
  flexible: "flexible",
  none_stated: "none stated",
  reheats: "reheats",
  fresh: "fresh",
  either: "either",
  not_a_meal: "not a meal",
  unknown: "unknown",
};

/** No answer below this stated confidence is used to construct a slot. */
export const DECISION_MIN_CONFIDENCE = 0.6;

/** Bumped whenever the prompt or the answer contract changes. */
export const PROMPT_VERSION = "typed-9q-v1";

export const ModelAnswerSchema = z.strictObject({
  questionId: z.enum(QUESTION_IDS),
  answerType: z.enum(ANSWER_TYPES),
  answer: z.union([z.boolean(), z.enum(PICK_ANSWERS)]),
  confidence: z.number().min(0).max(1),
});

export type ModelAnswer = z.infer<typeof ModelAnswerSchema>;

export const NineQuestionResponseSchema = z.strictObject({
  decisions: z.array(ModelAnswerSchema).length(QUESTION_IDS.length),
});

export type ModelResponse = z.infer<typeof NineQuestionResponseSchema>;

export function buildResponseSchema(questionIds: readonly QuestionId[]) {
  return z.strictObject({
    decisions: z.array(ModelAnswerSchema).length(questionIds.length),
  });
}

/** One answer as every consumer receives it. No prose is possible here. */
export type DecisionOutcome = {
  questionId: QuestionId;
  key: string;
  questionText: string;
  answerType: AnswerType;
  answer: TypedAnswer;
  confidence: number;
  abstained: boolean;
  samples: number;
  /**
   * Which source settled a Q5/Q9 answer: the model, or the app's fixed screen
   * over the ask's own words. Null/absent for the other seven questions and
   * for a provider that was never consulted. The receipt must not credit the
   * model with an answer a rule produced.
   */
  signalSource?: HoldSource | null;
};

/**
 * The two sources a safety or personal-care hold can come from. The rule
 * screen runs beside the model answer and may only add a hold, never remove
 * one; a model hold keeps its own label.
 */
export const HOLD_SOURCES = ["model", "rule"] as const;
export type HoldSource = (typeof HOLD_SOURCES)[number];

export type ValidatedResponse =
  | { ok: true; answers: ModelAnswer[] }
  | { ok: false; issues: string[] };

const PICK_SYNONYMS: Record<string, PickAnswer> = {
  "weekday morning": "weekday_morning",
  "weekday afternoons": "weekday_afternoon",
  "weekday afternoon": "weekday_afternoon",
  "weekday evenings": "weekday_evening",
  "weekday evening": "weekday_evening",
  saturday: "saturday",
  sunday: "sunday",
  flexible: "flexible",
  "any day": "flexible",
  "no preference": "flexible",
  none: "none_stated",
  "none stated": "none_stated",
  "not stated": "none_stated",
  reheats: "reheats",
  reheat: "reheats",
  fresh: "fresh",
  either: "either",
  "not a meal": "not_a_meal",
  "no meal": "not_a_meal",
  unknown: "unknown",
  unsure: "unknown",
};

function slugifyPick(value: string): string {
  const lowered = value.trim().toLowerCase();
  const synonym = PICK_SYNONYMS[lowered];
  if (synonym) return synonym;
  return lowered
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Normalise only the pick answer's presentation ("Saturday" → "saturday").
 * Unknown keys, string confidences, and any other prose are left untouched so
 * the strict schema rejects them rather than silently coercing them.
 */
export function normaliseModelPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.decisions)) return payload;

  return {
    ...record,
    decisions: record.decisions.map((decision) => {
      if (!decision || typeof decision !== "object") return decision;
      const entry = decision as Record<string, unknown>;
      if (entry.answerType !== "pick" || typeof entry.answer !== "string") {
        return decision;
      }
      return { ...entry, answer: slugifyPick(entry.answer) };
    }),
  };
}

export function answerTypeForQuestion(question: PolicyQuestion): AnswerType {
  return question.answerType === "pick" ? "pick" : "yesno";
}

export function pickOptionsForQuestion(
  questionId: string,
): readonly PickAnswer[] | null {
  return PICK_OPTIONS_BY_QUESTION[questionId as QuestionId] ?? null;
}

/** A typed answer used when the service cannot answer (abstention). */
export function safeAnswerForQuestion(question: PolicyQuestion): TypedAnswer {
  if (answerTypeForQuestion(question) === "yesno") return false;
  return question.id === "Q7" ? "unknown" : "none_stated";
}

/**
 * Validate a provider payload against the requested questions.
 *
 * The schema already enforces the shape. This second pass enforces the semantic
 * contract: exactly the requested ids, the question's own answer type, and the
 * question's own closed pick list.
 */
export function validateResponse(
  payload: unknown,
  questions: readonly PolicyQuestion[],
): ValidatedResponse {
  const requestedIds = questions.map((question) => question.id);
  const schema = buildResponseSchema(requestedIds as QuestionId[]);
  const parsed = schema.safeParse(normaliseModelPayload(payload));

  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "response"}: ${issue.message}`,
      ),
    };
  }

  const issues: string[] = [];
  const seen = new Set<string>();

  for (const answer of parsed.data.decisions) {
    const question = questions.find((item) => item.id === answer.questionId);
    if (!question) {
      issues.push(`Unexpected question ${answer.questionId}.`);
      continue;
    }
    if (seen.has(answer.questionId)) {
      issues.push(`Duplicate answer for ${answer.questionId}.`);
    }
    seen.add(answer.questionId);

    const expectedType = answerTypeForQuestion(question);
    if (answer.answerType !== expectedType) {
      issues.push(
        `${answer.questionId} must be ${expectedType}, not ${answer.answerType}.`,
      );
      continue;
    }

    if (expectedType === "yesno") {
      if (typeof answer.answer !== "boolean") {
        issues.push(`${answer.questionId} needs a yes/no answer.`);
      }
      continue;
    }

    if (typeof answer.answer !== "string") {
      issues.push(`${answer.questionId} needs a pick answer.`);
      continue;
    }
    const options = pickOptionsForQuestion(answer.questionId);
    if (!options) {
      issues.push(`${answer.questionId} has no closed pick list.`);
      continue;
    }
    if (!options.includes(answer.answer as PickAnswer)) {
      issues.push(
        `${answer.questionId} answered "${answer.answer}", outside its pick list.`,
      );
    }
  }

  if (seen.size !== questions.length) {
    issues.push(
      `Expected ${questions.length} answers; received ${seen.size}.`,
    );
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, answers: parsed.data.decisions };
}

/**
 * PostgreSQL `real` is a 4-byte float; a stored 0.93 reads back as
 * 0.930000007. Digests round to four decimals so a recomputation from the row
 * matches the value written at decision time.
 */
export function roundConfidence(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * The digest of the request the model saw. Raw ask text enters the hash and
 * nothing else: only this digest is copied into decision rows or the audit log.
 */
export function computeInputDigest(input: {
  askText: string;
  questions: readonly PolicyQuestion[];
  policyVersionId: string | null;
}): string {
  return sha256Hex(
    stableStringify({
      promptVersion: PROMPT_VERSION,
      policyVersionId: input.policyVersionId,
      askText: input.askText,
      questions: input.questions.map((question) => ({
        id: question.id,
        key: question.key,
        text: question.text,
        answerType: question.answerType,
        options: question.options ?? [],
        samples: question.samples ?? 1,
      })),
    }),
  );
}

export type DecisionDigestFields = {
  askId: string;
  policyVersionId: string;
  questionId: QuestionId;
  questionText: string;
  answerType: AnswerType;
  answer: TypedAnswer;
  confidence: number;
  abstained: boolean;
  samples: number;
  provider: string;
  model: string;
  latencyMs: number;
  inputDigest: string;
  /** Provenance of a Q5/Q9 answer; bound into the digest when present. */
  signalSource?: HoldSource | null;
};

/** The per-row digest a coordinator or an auditor can recompute. */
export function computeDecisionDigest(fields: DecisionDigestFields): string {
  return sha256Hex(
    stableStringify({
      askId: fields.askId,
      policyVersionId: fields.policyVersionId,
      questionId: fields.questionId,
      questionText: fields.questionText,
      answerType: fields.answerType,
      answer: fields.answer,
      confidence: roundConfidence(fields.confidence),
      abstained: fields.abstained,
      samples: fields.samples,
      provider: fields.provider,
      model: fields.model,
      latencyMs: fields.latencyMs,
      inputDigest: fields.inputDigest,
      // Always present, so a reader can recompute from the stored row: a null
      // source is the seven other questions or an unlabelled row.
      signalSource: fields.signalSource ?? null,
    }),
  );
}
