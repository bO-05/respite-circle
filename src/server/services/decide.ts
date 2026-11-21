import type { PolicyQuestion } from "@/db/schema";
import { NoObjectGeneratedError } from "ai";
import {
  detectLanguage,
  type LanguageDetection,
} from "@/server/domain/language";
import {
  resolveDecisionRouting,
  type DecisionRouting,
} from "@/server/domain/decision-routing";
import {
  DECISION_MIN_CONFIDENCE,
  QUESTION_IDS,
  answerTypeForQuestion,
  computeInputDigest,
  safeAnswerForQuestion,
  validateResponse,
  type AnswerType,
  type DecisionOutcome,
  type ModelAnswer,
  type QuestionId,
  type TypedAnswer,
} from "./decision-contract";
import {
  createDeterministicProvider,
  selectProvider,
  type DecisionProvider,
  type EnvLike,
  type ProviderCallResult,
  type ProviderName,
} from "./providers";

/**
 * `decide()` — the typed-decision service.
 *
 * One call runs the nine questions once, then two extra samples for every
 * question the policy marks with `samples: 3` (Q5 safety and Q9 personal care).
 * The service never throws to its caller: a timeout, a provider error, or an
 * invalid payload is retried once and then completed on the labelled
 * deterministic engine. A non-English ask and an empty ask are routed before a
 * model is called, so neither can produce English-guessed slots.
 */

export type DecisionEngine = "live" | "deterministic" | "routing";

export type DecideOptions = {
  askText: string;
  questions: readonly PolicyQuestion[];
  policyVersion?: string | null;
  /** Declared intake language; a detected non-English ask still wins. */
  language?: string | null;
  provider?: DecisionProvider;
  timeoutMs?: number;
  env?: EnvLike;
};

export type DecideResult = {
  provider: ProviderName;
  model: string;
  engine: DecisionEngine;
  latencyMs: number;
  /** SHA-256 of the request; the only representation copied into storage. */
  digest: string;
  degraded: boolean;
  decisions: DecisionOutcome[];
  routing: DecisionRouting;
  language: LanguageDetection;
  /** Provider calls made before any fallback. */
  attempts: number;
  emptyInput: boolean;
  contractError: boolean;
  /** True when a Q5/Q9 sample call failed and the answer abstained. */
  samplesIncomplete: boolean;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const REPAIR_ATTEMPTS = 2;

class DecisionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The decision provider exceeded ${timeoutMs} ms.`);
    this.name = "DecisionTimeoutError";
  }
}

class ProviderAttemptError extends Error {
  readonly issues: string[];
  readonly attempts: number;
  readonly latencyMs: number;

  constructor(issues: string[], attempts: number, latencyMs: number) {
    super("The decision provider did not return a valid typed response.");
    this.name = "ProviderAttemptError";
    this.issues = issues;
    this.attempts = attempts;
    this.latencyMs = latencyMs;
  }
}

function readTimeout(env: EnvLike): number {
  const raw = env.RC_AI_TIMEOUT_MS ?? env.LLM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  return DEFAULT_TIMEOUT_MS;
}

function callWithTimeout(
  provider: DecisionProvider,
  input: {
    askText: string;
    questions: readonly PolicyQuestion[];
    repairHint?: string;
  },
  timeoutMs: number,
): Promise<ProviderCallResult> {
  const controller = new AbortController();

  return new Promise<ProviderCallResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new DecisionTimeoutError(timeoutMs));
    }, timeoutMs);

    provider
      .call({
        askText: input.askText,
        questions: input.questions,
        repairHint: input.repairHint,
        signal: controller.signal,
      })
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

/**
 * A schema-parse failure deserves a repair hint on the retry; a transport
 * failure does not. Never include ask text (or a provider message that could
 * echo it) in the hint.
 */
function repairHintFor(error: unknown): string[] {
  if (error instanceof NoObjectGeneratedError) {
    return [
      "The previous response did not match the typed schema. Pick answers must be one of the exact lower-case tokens listed; yes/no answers must be true or false; confidence must be a number between 0 and 1.",
    ];
  }
  return [];
}

/**
 * Two attempts against one provider. The second carries the validation issues
 * as a repair hint when the first payload was the wrong shape; a transport
 * error is simply retried. Anything still failing is the caller's fallback.
 */
async function attemptProvider(
  provider: DecisionProvider,
  input: {
    askText: string;
    questions: readonly PolicyQuestion[];
  },
  timeoutMs: number,
): Promise<{
  answers: ModelAnswer[];
  provider: ProviderName;
  model: string;
  attempts: number;
  latencyMs: number;
}> {
  let validationIssues: string[] = [];
  let latencyMs = 0;

  for (let attempt = 1; attempt <= REPAIR_ATTEMPTS; attempt += 1) {
    const repairHint =
      attempt > 1 && validationIssues.length > 0
        ? validationIssues.join("; ")
        : undefined;

    try {
      const result = await callWithTimeout(
        provider,
        { ...input, repairHint },
        timeoutMs,
      );
      latencyMs += result.latencyMs;

      const validated = validateResponse(result.payload, input.questions);
      if (!validated.ok) {
        validationIssues = validated.issues;
        continue;
      }

      return {
        answers: validated.answers,
        provider: result.provider,
        model: result.model,
        attempts: attempt,
        latencyMs,
      };
    } catch (error) {
      // A transport failure, an abort, or a thrown parse error. A parse error
      // gets one repair hint; a transport error is retried unchanged.
      validationIssues = repairHintFor(error);
    }
  }

  throw new ProviderAttemptError(
    validationIssues,
    REPAIR_ATTEMPTS,
    latencyMs,
  );
}

function outcomeFor(
  question: PolicyQuestion,
  answer: ModelAnswer,
  samples: number,
): DecisionOutcome {
  const abstained = answer.confidence < DECISION_MIN_CONFIDENCE;
  return {
    questionId: question.id as QuestionId,
    key: question.key,
    questionText: question.text,
    answerType: answerTypeForQuestion(question),
    answer: abstained
      ? safeAnswerForQuestion(question)
      : (answer.answer as TypedAnswer),
    confidence: answer.confidence,
    abstained,
    samples,
  };
}

/**
 * Q5/Q9 resolution: any YES wins, three agreeing NOs are a NO, and everything
 * else abstains. A missing sample can never become a silent NO.
 */
function outcomeForSampleAgreement(
  question: PolicyQuestion,
  samples: readonly ModelAnswer[],
): DecisionOutcome {
  const confidences = samples.map((sample) => sample.confidence);
  const lowestConfidence =
    confidences.length > 0 ? Math.min(...confidences) : 0;
  const anyYes = samples.some((sample) => sample.answer === true);
  const threeAgreeingNos =
    samples.length === 3 &&
    samples.every(
      (sample) =>
        sample.answer === false && sample.confidence >= DECISION_MIN_CONFIDENCE,
    );

  let answer: TypedAnswer;
  let abstained: boolean;

  if (anyYes) {
    answer = true;
    abstained = false;
  } else if (threeAgreeingNos) {
    answer = false;
    abstained = false;
  } else {
    answer = safeAnswerForQuestion(question);
    abstained = true;
  }

  return {
    questionId: question.id as QuestionId,
    key: question.key,
    questionText: question.text,
    answerType: answerTypeForQuestion(question),
    answer,
    confidence: lowestConfidence,
    abstained,
    samples: samples.length,
  };
}

type ProviderResolution = {
  decisions: DecisionOutcome[];
  provider: ProviderName;
  model: string;
  attempts: number;
  samplesIncomplete: boolean;
};

async function resolveWithProvider(
  provider: DecisionProvider,
  askText: string,
  questions: readonly PolicyQuestion[],
  timeoutMs: number,
): Promise<ProviderResolution> {
  const base = await attemptProvider(
    provider,
    { askText, questions },
    timeoutMs,
  );

  const sampledQuestions = questions.filter(
    (question) => (question.samples ?? 1) >= 3,
  );
  const sampleAnswers = new Map<string, ModelAnswer[]>();

  for (const question of sampledQuestions) {
    const answer = base.answers.find(
      (entry) => entry.questionId === question.id,
    );
    sampleAnswers.set(question.id, answer ? [answer] : []);
  }

  let samplesIncomplete = false;

  if (sampledQuestions.length > 0) {
    for (let sample = 0; sample < 2; sample += 1) {
      try {
        const call = await attemptProvider(
          provider,
          { askText, questions: sampledQuestions },
          timeoutMs,
        );
        for (const question of sampledQuestions) {
          const answer = call.answers.find(
            (entry) => entry.questionId === question.id,
          );
          if (answer) sampleAnswers.get(question.id)?.push(answer);
        }
      } catch {
        // A failed safety sample is not a NO. Leave the missing sample out and
        // let the resolution abstain; that routes the ask to a person.
        samplesIncomplete = true;
      }
    }
  }

  const decisions = questions.map((question) => {
    const samples = sampleAnswers.get(question.id);
    if (samples) return outcomeForSampleAgreement(question, samples);

    const baseAnswer = base.answers.find(
      (entry) => entry.questionId === question.id,
    );
    if (!baseAnswer) {
      return {
        questionId: question.id as QuestionId,
        key: question.key,
        questionText: question.text,
        answerType: answerTypeForQuestion(question),
        answer: safeAnswerForQuestion(question),
        confidence: 0,
        abstained: true,
        samples: 0,
      } satisfies DecisionOutcome;
    }
    return outcomeFor(question, baseAnswer, 1);
  });

  return {
    decisions,
    provider: base.provider,
    model: base.model,
    attempts: base.attempts,
    samplesIncomplete,
  };
}

function isCompleteQuestionSet(questions: readonly PolicyQuestion[]): boolean {
  if (questions.length !== QUESTION_IDS.length) return false;
  const ids = new Set(questions.map((question) => question.id));
  if (ids.size !== QUESTION_IDS.length) return false;
  for (const id of QUESTION_IDS) {
    if (!ids.has(id)) return false;
  }
  return questions.every(
    (question) =>
      Boolean(question.id) &&
      Boolean(question.key) &&
      Boolean(question.text) &&
      (question.answerType === "yesno" || question.answerType === "pick"),
  );
}

const FALLBACK_QUESTION_TEXT: Record<QuestionId, string> = {
  Q1: "Sitting or companionship need",
  Q2: "Transport need that is not already arranged",
  Q3: "Meal need",
  Q4: "Best time of week",
  Q5: "Immediate safety risk",
  Q6: "Comfort with familiar faces",
  Q7: "Reheat preference",
  Q8: "Physical help moving",
  Q9: "Personal care",
};

const FALLBACK_ANSWER_TYPE: Record<QuestionId, AnswerType> = {
  Q1: "yesno",
  Q2: "yesno",
  Q3: "yesno",
  Q4: "pick",
  Q5: "yesno",
  Q6: "yesno",
  Q7: "pick",
  Q8: "yesno",
  Q9: "yesno",
};

function guardDecisions(
  questions: readonly PolicyQuestion[] | undefined,
): DecisionOutcome[] {
  const list = Array.isArray(questions) ? questions : [];
  const byId = new Map(list.map((question) => [question.id, question]));

  return QUESTION_IDS.map((questionId) => {
    const question = byId.get(questionId);
    const answerType = question
      ? answerTypeForQuestion(question)
      : FALLBACK_ANSWER_TYPE[questionId];
    return {
      questionId,
      key: question?.key ?? questionId.toLowerCase(),
      questionText: question?.text ?? FALLBACK_QUESTION_TEXT[questionId],
      answerType,
      answer:
        (question
          ? safeAnswerForQuestion(question)
          : answerType === "yesno"
            ? false
            : "none_stated") as TypedAnswer,
      confidence: 0,
      abstained: true,
      samples: 0,
    } satisfies DecisionOutcome;
  });
}

function guardResult(
  options: DecideOptions,
  startedAt: number,
  digest: string,
  language: LanguageDetection,
  reason: { emptyInput: boolean; contractError: boolean; unavailable?: boolean },
): DecideResult {
  const decisions = guardDecisions(options.questions);
  const routing = resolveDecisionRouting({
    decisions,
    language,
    emptyInput: reason.emptyInput,
  });
  if (reason.contractError || reason.unavailable) {
    routing.slotConstructionAllowed = false;
  }

  const model = reason.emptyInput
    ? "empty-ask-guard-v1"
    : reason.contractError
      ? "contract-guard-v1"
      : language.nonEnglish
        ? "language-router-v1"
        : "unavailable-guard-v1";

  return {
    provider: "deterministic",
    model,
    engine: "routing",
    latencyMs: Math.max(0, Date.now() - startedAt),
    digest,
    degraded: true,
    decisions,
    routing,
    language,
    attempts: 0,
    emptyInput: reason.emptyInput,
    contractError: reason.contractError,
    samplesIncomplete: false,
  };
}

async function decideInternal(options: DecideOptions): Promise<DecideResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? readTimeout(env);
  const askText = typeof options.askText === "string" ? options.askText : "";
  const questions = Array.isArray(options.questions) ? options.questions : [];

  const digest = computeInputDigest({
    askText,
    questions,
    policyVersionId: options.policyVersion ?? null,
  });

  const language = detectLanguage(askText, options.language);
  const emptyInput = askText.trim().length === 0;
  const contractError = !isCompleteQuestionSet(questions);

  if (emptyInput || contractError || language.nonEnglish) {
    return guardResult(options, startedAt, digest, language, {
      emptyInput,
      contractError,
    });
  }

  const selectedProvider = options.provider ?? selectProvider(env);
  let resolution: ProviderResolution;
  let primaryAttempts = 0;

  try {
    resolution = await resolveWithProvider(
      selectedProvider,
      askText,
      questions,
      timeoutMs,
    );
    primaryAttempts = resolution.attempts;
  } catch (error) {
    primaryAttempts =
      error instanceof ProviderAttemptError ? error.attempts : 0;
    // The provider failed after its retry. Complete on the labelled rules
    // engine; the caregiver sees a calm result, never an exception.
    try {
      resolution = await resolveWithProvider(
        createDeterministicProvider(),
        askText,
        questions,
        timeoutMs,
      );
    } catch {
      return guardResult(options, startedAt, digest, language, {
        emptyInput: false,
        contractError: false,
        unavailable: true,
      });
    }
  }

  const routing = resolveDecisionRouting({
    decisions: resolution.decisions,
    language,
    emptyInput,
  });

  const degraded = resolution.provider === "deterministic";

  return {
    provider: resolution.provider,
    model: resolution.model,
    engine: degraded ? "deterministic" : "live",
    latencyMs: Math.max(0, Date.now() - startedAt),
    digest,
    degraded,
    decisions: resolution.decisions,
    routing,
    language,
    attempts: primaryAttempts,
    emptyInput,
    contractError: false,
    samplesIncomplete: resolution.samplesIncomplete,
  };
}

/**
 * The only public entry point. It is deliberately total: it returns a typed,
 * conservative result for every input, including provider failure.
 */
export async function decide(options: DecideOptions): Promise<DecideResult> {
  try {
    return await decideInternal(options);
  } catch {
    const startedAt = Date.now();
    let digest = "";
    try {
      digest = computeInputDigest({
        askText: options.askText ?? "",
        questions: options.questions ?? [],
        policyVersionId: options.policyVersion ?? null,
      });
    } catch {
      digest = "";
    }
    return guardResult(
      options,
      startedAt,
      digest,
      detectLanguage(options.askText ?? "", options.language),
      { emptyInput: false, contractError: false, unavailable: true },
    );
  }
}
