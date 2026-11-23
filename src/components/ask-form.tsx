"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  ASK_SAMPLES,
  ASK_SAMPLE_NOTICE,
} from "@/lib/ask-samples";
import {
  appendSpokenText,
  characterCountLabel,
  consentSentence,
  MAX_ASK_LENGTH,
  receiptSentence,
  validateAskSubmission,
} from "@/server/domain/ask-intake";

/**
 * The Ask form.
 *
 * Typing is the primary route: dictation is an enhancement that appends live
 * speech to the same box. When the browser has no SpeechRecognition, the
 * control explains that and nothing else changes — the textarea, the consent
 * line, and the send button behave exactly the same.
 *
 * The server re-validates everything. The checks here exist to give an
 * immediate, associated message and to move focus to the field that needs it.
 */

const TEXT_ERROR_ID = "ask-text-error";
const CONSENT_ERROR_ID = "ask-consent-error";
const FORM_ERROR_ID = "ask-form-error";
const TEXT_HELP_ID = "ask-text-help";
const CONSENT_HELP_ID = "ask-consent-help";
const DICTATE_NOTE_ID = "ask-dictate-note";

const UNSUPPORTED_NOTE =
  "This browser can't dictate. You can type your words instead — it works exactly the same.";
const READY_NOTE =
  "Press and hold to dictate, or tap Start dictating. Your words appear in the box as you speak.";
const LISTENING_NOTE = "Listening. Speak normally; tap Stop dictating when you're done.";
const STOPPED_NOTE = "Dictation stopped. Your words are in the box.";
const BLOCKED_NOTE =
  "This browser is blocking the microphone. You can type your words instead — it works exactly the same.";
const FAILED_NOTE =
  "Dictation could not start. You can type your words instead — it works exactly the same.";

type DictationState =
  | { kind: "idle" }
  | { kind: "listening"; interim: string }
  | { kind: "stopped" }
  | { kind: "blocked" }
  | { kind: "failed" };

/**
 * SpeechRecognition support is an external browser fact, so it is read with
 * `useSyncExternalStore` rather than set from an effect. The server snapshot is
 * always false; after hydration the real value arrives without a mismatch.
 */
function subscribeToSpeechSupport(): () => void {
  return () => undefined;
}

function speechSupportSnapshot(): boolean {
  return speechRecognitionConstructor() !== null;
}

function speechSupportServerSnapshot(): boolean {
  return false;
}

type FormError = {
  field: "text" | "consent" | "form";
  message: string;
};

type SpeechAlternative = { transcript: string };
type SpeechResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
};
type SpeechResultList = {
  length: number;
  [index: number]: SpeechResult;
};
type SpeechEvent = {
  resultIndex: number;
  results: SpeechResultList;
};
type SpeechErrorEvent = { error?: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return (
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
  );
}

function resultTranscript(result: SpeechResult): string {
  const alternative = result[0] as SpeechAlternative | undefined;
  return alternative?.transcript ?? "";
}

export function AskForm({
  coordinatorFirstName,
  autoPublishLowRisk = false,
}: {
  coordinatorFirstName: string | null;
  /** The switch on the signed policy in force; qualifies the consent copy. */
  autoPublishLowRisk?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [pending, setPending] = useState(false);
  const [dictationState, setDictationState] = useState<DictationState>({
    kind: "idle",
  });
  const supported = useSyncExternalStore(
    subscribeToSpeechSupport,
    speechSupportSnapshot,
    speechSupportServerSnapshot,
  );
  const listening = dictationState.kind === "listening";

  const dictationNote = !supported
    ? UNSUPPORTED_NOTE
    : dictationState.kind === "listening"
      ? dictationState.interim.length > 0
        ? `Listening… ${dictationState.interim}`
        : LISTENING_NOTE
      : dictationState.kind === "stopped"
        ? STOPPED_NOTE
        : dictationState.kind === "blocked"
          ? BLOCKED_NOTE
          : dictationState.kind === "failed"
            ? FAILED_NOTE
            : READY_NOTE;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const baseTextRef = useRef("");
  const finalTextRef = useRef("");
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);
  const pointerActiveRef = useRef(false);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // A browser that has already torn down the engine is fine.
        }
      }
    };
  }, []);

  function finishDictation() {
    listeningRef.current = false;
    recognitionRef.current = null;
    setDictationState({ kind: "stopped" });
    setText(appendSpokenText(baseTextRef.current, finalTextRef.current));
  }

  function startDictation() {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) return;
    if (recognitionRef.current) return;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      typeof navigator !== "undefined" &&
      navigator.language?.toLowerCase().startsWith("en")
        ? navigator.language
        : "en-US";

    baseTextRef.current = text;
    finalTextRef.current = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const transcript = resultTranscript(result);
        if (result.isFinal) {
          finalTextRef.current = appendSpokenText(
            finalTextRef.current,
            transcript,
          );
        } else {
          interim = appendSpokenText(interim, transcript);
        }
      }

      setText(
        appendSpokenText(
          baseTextRef.current,
          appendSpokenText(finalTextRef.current, interim),
        ),
      );
      setDictationState({ kind: "listening", interim });
    };

    recognition.onerror = (event) => {
      setDictationState({
        kind:
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
            ? "blocked"
            : "failed",
      });
    };

    recognition.onend = () => {
      finishDictation();
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      listeningRef.current = true;
      setDictationState({ kind: "listening", interim: "" });
    } catch {
      recognitionRef.current = null;
      listeningRef.current = false;
      setDictationState({ kind: "failed" });
    }
  }

  function stopDictation() {
    recognitionRef.current?.stop();
  }

  function toggleDictation() {
    if (listeningRef.current) {
      stopDictation();
    } else {
      startDictation();
    }
  }

  function handleDictatePointerDown() {
    pointerActiveRef.current = true;
    holdFiredRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      holdFiredRef.current = true;
      if (!listeningRef.current) startDictation();
    }, 250);
  }

  function handleDictatePointerUp() {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (holdFiredRef.current) {
      holdFiredRef.current = false;
      if (listeningRef.current) stopDictation();
      return;
    }

    // A quick tap is a toggle, so a phone user does not have to hold a button
    // for the length of a sentence.
    toggleDictation();
  }

  function applySample(sampleText: string) {
    setText(sampleText);
    setError(null);
    textareaRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validation = validateAskSubmission({ text, consent });
    if (!validation.ok) {
      const field = validation.code === "consent_required" ? "consent" : "text";
      setError({ field, message: validation.message });
      (field === "consent" ? consentRef : textareaRef).current?.focus();
      return;
    }

    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/asks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, consent: true }),
      });

      const body = (await response.json().catch(() => null)) as
        | { askId?: string; message?: string }
        | null;

      if (!response.ok) {
        setError({
          field: "form",
          message:
            body?.message ??
            "We couldn't send that just now. Please try again, or call the church office.",
        });
        return;
      }

      if (body?.askId) {
        router.push(`/ask/${body.askId}`);
        return;
      }

      setError({
        field: "form",
        message:
          "We couldn't send that just now. Please try again, or call the church office.",
      });
    } catch {
      setError({
        field: "form",
        message:
          "We couldn't reach the church just now. Please try again in a moment.",
      });
    } finally {
      setPending(false);
    }
  }

  const textError = error?.field === "text" ? error : null;
  const consentError = error?.field === "consent" ? error : null;
  const formError = error?.field === "form" ? error : null;

  const textDescribedBy = [
    TEXT_HELP_ID,
    textError ? TEXT_ERROR_ID : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <label
          htmlFor="ask-text"
          className="text-xl font-semibold leading-snug text-ink"
        >
          Tell us what a hard week looks like
        </label>
        <p id={TEXT_HELP_ID} className="max-w-prose text-base leading-relaxed text-ink-muted">
          Type it in your own words, or dictate. There is no right way to say
          it, and you can change it later — the church keeps your original words
          as you first wrote them.
        </p>
        <textarea
          ref={textareaRef}
          id="ask-text"
          name="text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error?.field === "text" || error?.field === "consent") {
              setError(null);
            }
          }}
          aria-required="true"
          aria-invalid={textError ? true : undefined}
          aria-describedby={textDescribedBy}
          rows={9}
          className="min-h-48 w-full rounded-md border border-line bg-surface px-4 py-3 text-xl leading-relaxed text-ink"
          placeholder="For example: the nights are long, and I haven't had a morning to myself since March."
        />
        <p className="text-base text-ink-muted">
          {characterCountLabel(text.length)}
          {text.length > MAX_ASK_LENGTH ? null : (
            <span className="text-ink-muted">
              {" "}
              · up to {MAX_ASK_LENGTH.toLocaleString("en-US")}
            </span>
          )}
        </p>
        {textError ? (
          <p
            id={TEXT_ERROR_ID}
            role="alert"
            data-testid="ask-error"
            className="rounded-md border border-red-soft bg-red-soft px-4 py-3 text-base font-semibold text-ink"
          >
            {textError.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <h2 className="font-serif text-2xl text-ink">Or speak it aloud</h2>
        <button
          type="button"
          onClick={(event) => {
            if (event.detail === 0) toggleDictation();
          }}
          onPointerDown={handleDictatePointerDown}
          onPointerUp={handleDictatePointerUp}
          onPointerCancel={handleDictatePointerUp}
          onPointerLeave={() => {
            if (holdFiredRef.current) {
              holdFiredRef.current = false;
              if (listeningRef.current) stopDictation();
            }
          }}
          aria-pressed={listening}
          aria-describedby={DICTATE_NOTE_ID}
          className="inline-flex min-h-11 w-fit touch-manipulation items-center gap-2 rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground"
        >
          <span aria-hidden="true">{listening ? "■" : "●"}</span>
          {!supported
            ? "Dictate (not available in this browser)"
            : listening
              ? "Stop dictating"
              : "Start dictating"}
        </button>
        <p
          id={DICTATE_NOTE_ID}
          role="status"
          aria-live="polite"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {dictationNote}
        </p>
      </div>

      <section aria-labelledby="ask-samples" className="flex flex-col gap-3">
        <h2 id="ask-samples" className="font-serif text-2xl text-ink">
          Examples from other families
        </h2>
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          {ASK_SAMPLE_NOTICE}
        </p>
        <ul className="flex flex-col gap-2">
          {ASK_SAMPLES.map((sample) => (
            <li key={sample.id}>
              <button
                type="button"
                onClick={() => applySample(sample.body)}
                className="inline-flex min-h-11 w-full items-center rounded-md border border-line bg-surface px-4 py-3 text-left text-base font-semibold text-ink hover:bg-accent-soft"
              >
                Use the example: {sample.title}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <label htmlFor="ask-consent" className="flex items-start gap-3 text-base leading-relaxed text-ink">
          <input
            ref={consentRef}
            id="ask-consent"
            name="consent"
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (error?.field === "consent") setError(null);
            }}
            aria-required="true"
            aria-invalid={consentError ? true : undefined}
            aria-describedby={
              consentError ? `${CONSENT_HELP_ID} ${CONSENT_ERROR_ID}` : CONSENT_HELP_ID
            }
            className="mt-1 h-11 w-11 shrink-0 rounded border-line accent-accent"
          />
          <span>{consentSentence(coordinatorFirstName, autoPublishLowRisk)}</span>
        </label>
        <p id={CONSENT_HELP_ID} className="text-base leading-relaxed text-ink-muted">
          {receiptSentence(coordinatorFirstName, autoPublishLowRisk)}
        </p>
        {consentError ? (
          <p
            id={CONSENT_ERROR_ID}
            role="alert"
            data-testid="ask-error"
            className="rounded-md border border-red-soft bg-red-soft px-4 py-3 text-base font-semibold text-ink"
          >
            {consentError.message}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p
          id={FORM_ERROR_ID}
          role="alert"
          data-testid="ask-error"
          className="rounded-md border border-red-soft bg-red-soft px-4 py-3 text-base font-semibold text-ink"
        >
          {formError.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-12 w-fit items-center rounded-md bg-accent px-6 py-3 text-lg font-semibold text-accent-foreground disabled:opacity-70"
        >
          {pending ? "Sending your words…" : "Send this to " + (coordinatorFirstName ?? "my coordinator")}
        </button>
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          {autoPublishLowRisk
            ? "Your words are never shown to a neighbour. Under the church's signed low-risk policy, a meal time from this ask may go on the congregation board before a person approves it."
            : "Nothing is sent to a neighbour. The next thing that happens is a person reading your words."}
        </p>
      </div>
    </form>
  );
}
