import type { PolicyQuestion } from "@/db/schema";

/**
 * The deterministic keyword engine: the labelled last resort.
 *
 * It never writes a sentence. It maps the caregiver's own words onto the same
 * nine typed questions with the same closed answers the model must use, and it
 * is always labelled `provider: "deterministic"` / `model: "rule-engine-v1"`.
 *
 * The rules are conservative: a signal and its negation in the same ask makes
 * the answer abstain (confidence below 0.60), which routes safety and personal
 * care to a human rather than a slot. Calibration labels are the specification;
 * when the baseline misses, fix a rule here rather than the labels.
 */

export type KeywordAnswer = {
  questionId: string;
  answerType: "yesno" | "pick";
  answer: boolean | string;
  confidence: number;
};

type BooleanOutcome = { answer: boolean; confidence: number };
type PickOutcome = { answer: string; confidence: number };

const AMBIGUOUS_CONFIDENCE = 0.45;
const POSITIVE_CONFIDENCE = 0.9;
const EXPLICIT_NEGATIVE_CONFIDENCE = 0.86;
const DEFAULT_NEGATIVE_CONFIDENCE = 0.72;
const SAFETY_DEFAULT_CONFIDENCE = 0.78;

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/**
 * A positive signal plus its negation is not a licence to answer NO: it
 * abstains, so a safety flag or a slot is left to a person.
 */
function resolveBoolean(
  text: string,
  positive: RegExp,
  negative: RegExp,
  defaultConfidence = DEFAULT_NEGATIVE_CONFIDENCE,
  positiveText: string = text,
): BooleanOutcome {
  const positiveHit = matches(positiveText, positive);
  const negativeHit = matches(text, negative);

  if (positiveHit && negativeHit) {
    return { answer: false, confidence: AMBIGUOUS_CONFIDENCE };
  }
  if (positiveHit) return { answer: true, confidence: POSITIVE_CONFIDENCE };
  if (negativeHit) {
    return { answer: false, confidence: EXPLICIT_NEGATIVE_CONFIDENCE };
  }
  return { answer: false, confidence: defaultConfidence };
}

// Q1 — sitting / companionship.
// The calibration labels are the specification, so the evidence list covers the
// phrasing a coordinator reads as "someone should be with this person": staying
// with, visits, reading to, a chat, a check-in, and the exchange a caregiver
// names for themselves ("so I can sleep", "haven't been able to go").
const SIT_POSITIVE =
  /\b(sit|sits|sitting|companion|companionship|company|keep (her|him|them) company|to myself|time to myself|few (quiet )?hours|quiet hours|a break|need a break|watch (her|him|them)|watch over|can'?t be alone|cannot be alone|not be alone|never alone|alone all day|on my own|respite|stays? with|staying with|be with (her|him|them)|keep an eye on|look after (her|him|them)|someone (reads?|visits?|stays?|sits?|comes?)|reads? to (her|him|them)|a visit|visits?|chat|notice if|so (i|we) (can|could) (sleep|rest|shower|shop|work|go|breathe|eat)|haven'?t been able to go|something to go to|need (a|some|two|three|four|few) (quiet )?hours?)\b/i;
const SIT_REFUSAL =
  /\b(fine for company|we'?re fine for company|don'?t need (any )?company|doesn'?t need company|no company needed|not lonely|never lonely)\b/i;
const SIT_NEGATIVE =
  /\b(don'?t need (company|someone)|doesn'?t need (company|someone)|not lonely|never lonely)\b/i;

// Q2 — transport that is not already arranged
const TRANSPORT_POSITIVE =
  /\b(ride|rides|transport|pick ?up|lift to|lift (home|back)|drive (her|him|them|us|to)|driving (her|him|them)|driver|no car|don'?t have a car|(don'?t|do not|can'?t|cannot) drive|needs? a lift|take (her|him|them) to|wheelchair van|(any|some) other way to get)\b/i;
const TRANSPORT_APPOINTMENT_NEED =
  /\b(take|bring|get|drive|ride|transport)\s+(?:\w+\s+){0,3}to\s+(?:the\s+)?(?:appointment|physio|physical therapy|clinic|hospital|dialysis|doctor|dentist)\b/i;
const TRANSPORT_NEGATIVE =
  /\b(have|has|got) (a |her |his |their )?(ride|lift|transport)|ride is (already )?arranged|transport is (already )?arranged|no (ride|transport) needed|don'?t need (a )?(ride|lift|transport)|someone (drives|takes) (her|him|them)|(transport|ride|lift)[^.;]{0,32}(is|are) (already )?(covered|arranged|handled|sorted)|(covered|arranged) by (family|friends|neighbours|neighbors|church)\b/i;
// An ask that says the transport is already covered is answering Q2, not
// asking for a driver. "Transport to dialysis is covered by family" is the
// calibration case that exposed this.
const TRANSPORT_EXPLICITLY_ARRANGED =
  /\b(transport|ride|lift)[^.;]{0,32}(is|are|was|were)\s+(already\s+)?(covered|arranged|handled|sorted)\b|\b(covered|arranged)\s+by\s+(family|friends|neighbours|neighbors|church)\b/i;

// Q3 — meal. "Grocery shopping" is an errand, not a meal; the calibration
// labels treat it as companionship time. Groceries only count as a meal when
// they are explicitly delivered.
const MEAL_POSITIVE =
  /\b(meal|meals|food|cook|cooking|cooked|dinner|supper|breakfast|reheat|reheatable|casserole|lasagna|soup|stew|hot dish|grocery delivery|groceries delivered)\b/i;
const LUNCH_DELIVERY =
  /\b(bring|brings|deliver|delivers|drop off|make|makes|provide|prepare|skip|miss)(ed|ing|es)?\b[^.]{0,24}\blunch\b|\blunch\b[^.]{0,24}\b(bring|deliver|drop off|provide|prepare)\b/i;
const MEAL_NEGATIVE =
  /\b(meals? (are|is) (covered|arranged|handled|taken care of)|no meal|don'?t need (a )?meal|don'?t need meals|food is (covered|arranged)|we'?re fine for food|we are fine for food)\b/i;

// Q4 — window
const WINDOW_FLEXIBLE =
  /\b(flexible|any day|anytime|any time|no preference|whenever|whatever works)\b/i;
const WINDOW_WEEKDAY_MORNING = /\bweekday mornings?\b/i;
const WINDOW_WEEKDAY_AFTERNOON = /\bweekday afternoons?\b/i;
const WINDOW_WEEKDAY_EVENING = /\bweekday evenings?\b/i;
const WINDOW_MORNING = /\bmornings?\b/i;
const WINDOW_AFTERNOON = /\bafternoons?\b/i;
const WINDOW_EVENING = /\b(evenings?|night time|at night|after work)\b/i;
const WINDOW_CLOCK =
  /\b(?:at|around|by)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;

// Q5 — immediate safety risk.
// Calibration cases added wandering that leaves the house, a hidden medication
// or refused food, a door found open, burns, and "doesn't want to be here".
// A stroke is only immediate when the ask says it is happening or just
// happened; "since the stroke" is history, not an emergency.
//
// Round 2: a plain disclosure is a disclosure. Suicidal ideation ("Sometimes I
// want to die", "I wish I wasn't alive"), abuse ("my husband hits me", "she
// threatened me", "I'm scared of him") and "I'm not safe at home" are named in
// the words families use. A phrase that only declines risk belongs on the
// negative side, which is why the bare word "safe" is gone from it: it inverted
// the plainest safety sentence in the set.
//
// The positive side names the disclosure, never the bare noun or verb. Bare
// "die" and bare "alive" once sat here to carry the disclosure phrases and held
// ordinary sentences with them ("my husband died last year", "she is 93 and
// still alive"), which turns a tired caregiver away from respite. The forms
// below are specific to a disclosure: wanting to die, wishing not to be alive,
// not wanting to be here, no reason to live, better off dead, killing oneself,
// and the self-harm terms. Never remove a disclosure term to clear a false
// hold; narrow the pattern and add the ordinary form to the negative side.
//
// Bare "hurt" was the last of the word-level positives, and it read the
// caregiver's own strain as harm done to someone: "my knees hurt and I am
// exhausted" answered YES at 0.9 and held the ask. It now names harm done to a
// person — "hurt me", "he hurt me", "she hurt him" — and the caregiver's own
// pain sits on the ordinary-talk side below. Bare "fall" stays: Q5 asks about
// a recent fall, so "she fell yesterday" is exactly the signal the question
// exists to catch.
//
// The one harm-name that is not harm is the idiom. "It hurts me to ask for
// help, but could someone sit with Mum on Saturday?" is a caregiver asking for
// respite, and "it hurts her to walk to the shops" is a mobility remark; both
// matched `hurt ... <person>` through "hurts me"/"hurts her" and held the ask
// at 0.9. The idiom is excluded by its shape only — an impersonal "it hurts"
// plus a person pronoun and "to <verb>", or the bare "it hurts to ask" — in
// SAFETY_ORDINARY_TALK below, and CAREGIVER_STRAIN_IDIOM strips that same
// shape from the text the positive rule reads so the two do not abstain
// against each other. A sentence that names harm without that shape ("it hurt
// him", "he hurt me last night") never matches the idiom and still holds.
const SAFETY_POSITIVE =
  /\b(fall|falls|fell|fallen|falling|tripped|emergency|911|unsafe|danger|dangerous|in danger|hurt(?:s|ing)?\s+(?:me|us|him|her|them)|injur(?:y|ed|ies)|wander(?:s|ed|ing)?|went missing|gone missing|missing|got lost|locked out|abuse|abusive|neglect|chest pain|seizure|overdose|suicid(?:e|al)|self.?harm|can'?t breathe|bleeding|police|aggressive|violent|left the stove|stove on|fire|leav(?:e|es|ing) the (house|home|flat|apartment)|left the (house|home)|out of the house at night|found (her|him|them)[^.;]{0,24}(streets?|blocks?|miles?) away|hiding (her|his|their) (medication|meds|medicine|pills|tablets)|refus(?:es|ing) to eat|won'?t eat|stopped eating|not eating|(?:do not|don'?t|does not|doesn'?t) want to be here|no reason to live|better off dead|front door (wide )?open|coat gone|burn(?:s|ed|ing)?|(?:having|had|signs? of|suspected|possible) (?:a )?stroke|stroke (?:last night|this morning|today)|want(?:s|ed)? (?:to die|to be dead)|wish (?:i|he|she|they) (?:was|were)n'?t (?:still )?alive|wish (?:i|he|she|they) (?:was|were) dead|kill(?:s|ed|ing)?\s+(?:my|your|her|him|our|them)sel(?:f|ves)|hit(?:s|ting)? me|threaten(?:s|ed|ing)?|scared of (?:him|her|them)|(?:not|never)\s+(?:felt\s+|feel(?:ing)?\s+)?safe|(?:don'?t|doesn'?t|didn'?t)\s+(?:feel|feeling)\s+safe|(?:isn'?t|aren'?t|wasn'?t|weren'?t)\s+safe)\b/i;

// The risk words a denial may name. `SAFETY_NEGATIVE` and `NEGATED_CARE_TERM`
// are both built from this one fragment, so a declining phrase and the strip
// that removes it before the positive rule runs can never drift apart.
const SAFETY_DECLINE_TERMS = String.raw`falls?|fallen|falling|injur(?:y|ed|ies)|hurt|unsafe|danger|dangerous|emergency`;

// A genuine denial: the person says they are safe, or names no risk. It is
// deliberately not "safe" on its own — "I'm not safe at home" contains the
// word and denies nothing.
//
// Ordinary talk of death, bereavement and old age belongs here too. A husband
// who died last year, a mother who is 93 and still alive, a garden that died in
// the frost, a caregiver dead on her feet, and a family that talked about what
// happens when someone dies are all descriptions of life. Holding them turns a
// tired caregiver away from respite, so they settle Q5 at the explicit-negative
// confidence. If a disclosure phrase appears beside one of them — "my husband
// died and sometimes I want to die" — `resolveBoolean` abstains and the ask
// holds, so the ordinary form can never suppress a disclosure.
//
// The caregiver's own body belongs here for the same reason. "My back hurts
// from lifting her", "my knees hurt and I am exhausted" and "it hurts to lift
// him" describe the strain of caring, not danger to anyone. They are the asks
// the app exists for, so they settle Q5 at 0.86 and keep the ordinary route.
//
// The "it hurts me to ask" idiom belongs here too. It is the one harm-name
// that is not harm: "It hurts me to ask for help, but could someone sit with
// Mum on Saturday?" and "it hurts her to walk to the shops" are how a caregiver
// asks for respite, and the narrowed `hurt` positive still caught the "hurts
// me"/"hurts her" inside them. The shape is deliberately narrow — impersonal
// "it hurts", a person pronoun, then "to" and a verb — plus the bare "it hurts
// to ask". The word after "to" is kept off determiners, so "it hurt her to
// the point of tears" is not read as the idiom: it keeps its positive match
// and holds. The same fragment is stripped from the positive text in
// CAREGIVER_STRAIN_IDIOM so both sides can never drift apart.
const HURT_TO_IDIOM_FRAGMENT = String.raw`it\s+hurts?\s+(?:me|us|him|her|them)\s+to\s+(?!the\b|a\b|an\b|no\b|some\b|any\b|this\b|that\b|these\b|those\b|my\b|your\b|his\b|her\b|their\b|our\b|its\b)\w+`;

const SAFETY_ORDINARY_TALK = String.raw`(?:husband|wife|partner|mother|mum|mom|father|dad|nana|grandma|grandad|grandpa|granny|brother|sister|son|daughter|friend|neighbou?r|uncle|aunt|he|she|they)\s+(?:died|has died|passed away)|still\s+(?:alive|with us)|(?:garden|gardens|plant|plants|flowers?|tree|trees|bush|bushes|lawn|grass|crops?|roses?)\s+(?:died|dies)|dead on (?:my|her|his|their|your|our) feet|when (?:i|he|she|they|we)\s+(?:die|dies)|(?:my|our|her|his|their)\s+(?:back|knees?|shoulders?|hips?|legs?|arms?|hands?|wrists?|joints?)\s+(?:hurts?|aches?|is sore|are sore|is going|are going|is giving out|are giving out)|it\s+hurts?(?:\s+me)?\s+to\s+(?:lift|bend|kneel|get up|stand|walk|sit|move|carry|dress|wash|roll)|${HURT_TO_IDIOM_FRAGMENT}|it\s+hurts?\s+to\s+ask`;

const SAFETY_DENIALS = String.raw`(?:i'?m|i am|we'?re|we are|they'?re|they are|he'?s|she'?s|he is|she is|it'?s|it is|is|are|am)\s+safe|safe\s+(?:for now|at the moment|for the moment|right now)|not unsafe|nothing dangerous|not in danger|no\s+(?:${SAFETY_DECLINE_TERMS})|(?:hasn'?t|haven'?t|never)\s+fallen|${SAFETY_ORDINARY_TALK}`;

const SAFETY_NEGATIVE = new RegExp(
  String.raw`\b(?:${SAFETY_DENIALS})\b`,
  "i",
);

/**
 * The idiom "it hurts me to ask" names the difficulty of asking, not harm done
 * to anyone, but it contains the positive shape `hurts me`/`hurts her`.
 * Removing that one clause before the positive rule runs keeps the two sides
 * from abstaining against each other, so Q5 settles at the explicit-negative
 * 0.86 instead of the 0.45 that would hold the ask. The pattern is deliberately
 * the impersonal "it hurts" plus a person pronoun and "to <verb>"; "it hurt
 * him" and "he hurt me last night" do not match it and still hold.
 */
const CAREGIVER_STRAIN_IDIOM = new RegExp(
  String.raw`\b(?:${HURT_TO_IDIOM_FRAGMENT})\b`,
  "gi",
);

// Q6 — familiar faces
const FAMILIAR_POSITIVE =
  /\b(people (she|he|they) knows?|people (we|i) know|someone (she|he|they) knows?|familiar|fine with people|comfortable with (people|someone)|knows (her|him|them)|recogni[sz]es?|friends from (church|the church)|our (friends|neighbours|neighbors)|already know)\b/i;
const FAMILIAR_NEGATIVE =
  /\b(fine with (anyone|strangers|new people)|doesn'?t mind (strangers|new people)|happy with (anyone|strangers))\b/i;

// Q7 — reheat preference
const REHEAT_REHEATS = /\b(reheat|reheats|reheatable|microwave|warm up)\b/i;
const REHEAT_FRESH = /\b(fresh|home.?cooked|cook(?:ed)? it fresh)\b/i;
const REHEAT_EITHER = /\beither\b/i;
const REHEAT_NOT_A_MEAL = /\b(not a meal|no meal)\b/i;

// Q8 — mobility (orientation only)
const MOBILITY_POSITIVE =
  /\b(walker|walking frame|wheelchair|mobility|stairs|steps|balance|transfer|steady hand|hand getting (in|out)|getting (in|out) of|help (getting|moving|walking)|help moving|physically help|lift(?:ing)? (her|him|them))\b/i;
const MOBILITY_NEGATIVE =
  /\b(doesn'?t need (help )?(walking|moving)|walks fine|no mobility (issues|problems)|gets around fine)\b/i;

// Q9 — personal care.
// The audit at 410cc1b found weak words missing: pills, tablets, wash, "get
// dressed", bathroom, pads, briefs, and hygiene all named care while the rule
// answered a confident NO. They are one shared fragment precisely because the
// positive rule and every strip that governs it must move together; a word
// added to one list and forgotten in another turns "she takes her own tablets"
// into a care hold. "briefs" is plural deliberately: a "brief visit" is not care.
const WEAK_CARE_WORDS =
  String.raw`pills?|tablets?|wash(?:es|ed|ing)?|bathroom|pads?|briefs|hygiene|get(?:s|ting)? dressed`;

// A third-person self-care verb that can take a reflexive pronoun, including
// the compound "washes and dresses herself".
const SELF_CARE_VERBS = String.raw`showers?|bathes?|washes?|dresses?|feeds?|toilets?|get(?:s|ting)? dressed`;
const SELF_CARE_REFLEXIVE = String.raw`\b(?:${SELF_CARE_VERBS})(?:\s+(?:and|,)\s+(?:${SELF_CARE_VERBS}))*\s+(?:herself|himself|themselves)\b`;

const PERSONAL_CARE_POSITIVE = new RegExp(
  String.raw`\b(medication|medications|meds|medicine|bathing|bathe|bathes|bath|shower(?:ing|s)?|toileting|toilet|incontinent|incontinence|diaper|nappy|lifting|lift (her|him|them)|transfers?|dressing|undressing|feeding|feeding tube|tube feed(?:ing)?|catheter|wound care|insulin|administer|${WEAK_CARE_WORDS})\b`,
  "i",
);
const PERSONAL_CARE_NEGATIVE = new RegExp(
  String.raw`\b(no personal care|not personal care|no (?:medication|meds|pills?|tablets?|bathing|washing|hygiene|toileting|dressing|feeding|lifting)|(?:doesn'?t|does not|doesnt) (?:need|take) (?:help with )?(?:medication|meds|pills?|tablets?)|(?:doesn'?t|does not|doesnt) need help with (?:bathing|medication|toileting|dressing|feeding|washing|hygiene|pills?|tablets?|pads?|briefs|the bathroom|getting dressed)|no help (?:needed )?(?:with |in |to )?(?:the )?(?:bathroom|pills?|tablets?|pads?|briefs|washing|hygiene)|no lifting|can (?:bathe|dress|feed|wash|get dressed) (?:herself|himself|themselves)|${SELF_CARE_REFLEXIVE}|(?:manages?|handles?|takes?|changes?|do(?:es)?) (?:her|his|their) own (?:shower|showering|bath|bathing|medication|medications|meds|medicine|tablets|pills|dressing|toileting|washing|hygiene|pads?|briefs)|takes? (?:her|his|their) own (?:medication|medications|meds|medicine|tablets|pills))\b`,
  "i",
);

/**
 * Strip phrases where a care term is explicitly negated before running the
 * positive safety/personal-care rules. "No falls so far" is not a fall, and
 * "does not need help with medication" is not personal care, while "no falls,
 * but she wanders at night" still leaves the wandering signal intact.
 */
const NEGATED_CARE_TERM = new RegExp(
  String.raw`\b(?:no|not|never|doesn'?t|does not|doesnt|don'?t|do not|without|hasn'?t|haven'?t)\b[^.;]{0,32}?\b(?:${SAFETY_DECLINE_TERMS}|medication|medications|meds|medicine|bathing|toileting|lifting|transfers?|dressing|feeding|personal care|walking|moving|mobility|stairs|steps|${WEAK_CARE_WORDS})\b`,
  "gi",
);

function withoutNegatedCareTerms(text: string): string {
  return text.replace(NEGATED_CARE_TERM, " omitted ");
}

/**
 * An ask can decline personal care in one clause and use a care word in
 * another ("doesn't need help with bathing or medication"), describe the
 * caregiver's own shower ("so I can shower and rest"), or say the person
 * manages it themselves ("she manages her own shower"). None of those is a
 * personal-care need, so they are removed before the positive rule runs.
 */
const PERSONAL_CARE_DECLINED_CLAUSE = new RegExp(
  String.raw`\b(?:no|not|never|doesn'?t|does not|doesnt|don'?t|do not|without)\b[^.;]{0,80}?\b(?:personal care|medication|medications|meds|medicine|bathing|bathe|toileting|lifting|transfers?|dressing|feeding|${WEAK_CARE_WORDS})\b[^.;]{0,48}`,
  "gi",
);
const SELF_CARE_STATEMENT = new RegExp(
  String.raw`\b(?:manages?|handles?|takes?|changes?|do(?:es)?) (?:her|his|their) own\b[^.;]{0,48}|${SELF_CARE_REFLEXIVE}`,
  "gi",
);
const CAREGIVER_SELF_CARE =
  /\b(?:so|while) (?:i|we) (?:can |could )?(?:shower|bathe|wash|sleep|rest|shop|work|go|eat|breathe)\b/gi;

/**
 * A caregiver's own body is not a personal-care need for the person they care
 * for. "My back hurts from lifting her" and "it hurts to lift him" describe
 * the strain of caring, not a request for a volunteer to transfer anyone; Q9
 * answers NO so the ordinary route keeps its slot. A lift the person needs
 * ("he needs lifting from the bed to his wheelchair") still counts: the strip
 * needs the caregiver's own body in the clause, or an "it hurts to lift" form.
 */
const CAREGIVER_LIFTING_STRAIN = new RegExp(
  String.raw`\b(?:my|our|her|his|their)\s+(?:back|knees?|shoulders?|hips?|legs?|arms?|hands?|wrists?|joints?)\b[^.;]{0,32}\blift(?:s|ing|ed)?\b|\bit\s+hurts?(?:\s+me)?\s+to\s+(?:lift|transfer|roll|move)\b`,
  "gi",
);

function positiveTextForPersonalCare(text: string): string {
  // The declined-clause and self-care strips run first, on the original words:
  // "doesn't need help with bathing or medication" must lose the whole list,
  // not just the first item, before the generic negation strip runs.
  return withoutNegatedCareTerms(
    text
      .replace(PERSONAL_CARE_DECLINED_CLAUSE, " omitted ")
      .replace(SELF_CARE_STATEMENT, " omitted ")
      .replace(CAREGIVER_SELF_CARE, " omitted ")
      .replace(CAREGIVER_LIFTING_STRAIN, " omitted "),
  );
}

/**
 * True when the text names a personal-care need.
 *
 * Q9 uses this evidence, and so does the coordinator's draft editor: a label or
 * an orientation note may not carry personal-care instructions onto a volunteer
 * slot. Running the same positive rule over the same declining-clause strips is
 * what keeps the two in agreement — the built-in default notes ("no medication",
 * "no bathing or toileting") still pass, and "she takes her own tablets" is not
 * a care need.
 */
export function mentionsPersonalCare(text: string): boolean {
  return matches(positiveTextForPersonalCare(text), PERSONAL_CARE_POSITIVE);
}

function resolveWindow(text: string): PickOutcome {
  if (matches(text, /\bsaturdays?\b/i)) {
    return { answer: "saturday", confidence: POSITIVE_CONFIDENCE };
  }
  if (matches(text, /\bsundays?\b/i)) {
    return { answer: "sunday", confidence: POSITIVE_CONFIDENCE };
  }
  if (matches(text, WINDOW_WEEKDAY_MORNING)) {
    return { answer: "weekday_morning", confidence: POSITIVE_CONFIDENCE };
  }
  if (matches(text, WINDOW_WEEKDAY_AFTERNOON)) {
    return { answer: "weekday_afternoon", confidence: POSITIVE_CONFIDENCE };
  }
  if (matches(text, WINDOW_WEEKDAY_EVENING)) {
    return { answer: "weekday_evening", confidence: POSITIVE_CONFIDENCE };
  }
  if (matches(text, WINDOW_MORNING)) {
    return { answer: "weekday_morning", confidence: 0.82 };
  }
  if (matches(text, WINDOW_AFTERNOON)) {
    return { answer: "weekday_afternoon", confidence: 0.82 };
  }
  if (matches(text, WINDOW_EVENING)) {
    return { answer: "weekday_evening", confidence: 0.82 };
  }
  if (matches(text, WINDOW_CLOCK)) {
    const clock = /\b(?:at|around|by)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.exec(
      text,
    );
    const word = clock?.[1].toLowerCase();
    if (word && ["six", "seven", "eight", "nine", "ten", "eleven", "twelve"].includes(word)) {
      return { answer: "weekday_evening", confidence: 0.75 };
    }
    if (word && ["one", "two", "three", "four", "five"].includes(word)) {
      return { answer: "weekday_afternoon", confidence: 0.75 };
    }
  }
  if (matches(text, WINDOW_FLEXIBLE)) {
    return { answer: "flexible", confidence: POSITIVE_CONFIDENCE };
  }
  return { answer: "none_stated", confidence: 0.7 };
}

function resolveReheat(text: string): PickOutcome {
  if (matches(text, REHEAT_REHEATS)) {
    return { answer: "reheats", confidence: POSITIVE_CONFIDENCE };
  }
  if (matches(text, REHEAT_FRESH)) {
    return { answer: "fresh", confidence: 0.85 };
  }
  if (matches(text, REHEAT_EITHER)) {
    return { answer: "either", confidence: 0.8 };
  }
  if (matches(text, REHEAT_NOT_A_MEAL)) {
    return { answer: "not_a_meal", confidence: 0.85 };
  }
  return { answer: "unknown", confidence: 0.7 };
}

function resolveTransport(text: string): BooleanOutcome {
  const explicitlyArranged = matches(text, TRANSPORT_EXPLICITLY_ARRANGED);
  // Remove the arranged clause before looking for a need, so "transport to
  // dialysis is covered by family" cannot match its own transport keyword.
  const remaining = explicitlyArranged
    ? text.replace(TRANSPORT_EXPLICITLY_ARRANGED, " omitted ")
    : text;
  const explicitNeed = matches(remaining, TRANSPORT_POSITIVE);
  const appointmentNeed = matches(remaining, TRANSPORT_APPOINTMENT_NEED);
  const alreadyArranged = matches(text, TRANSPORT_NEGATIVE);

  if (explicitlyArranged && !explicitNeed && !appointmentNeed) {
    return { answer: false, confidence: EXPLICIT_NEGATIVE_CONFIDENCE };
  }
  if ((explicitNeed || appointmentNeed) && alreadyArranged) {
    return { answer: false, confidence: AMBIGUOUS_CONFIDENCE };
  }
  if (explicitNeed || appointmentNeed) {
    return { answer: true, confidence: POSITIVE_CONFIDENCE };
  }
  if (alreadyArranged || explicitlyArranged) {
    return { answer: false, confidence: EXPLICIT_NEGATIVE_CONFIDENCE };
  }
  return { answer: false, confidence: DEFAULT_NEGATIVE_CONFIDENCE };
}

function resolveMeal(text: string): BooleanOutcome {
  const positive = matches(text, MEAL_POSITIVE) || matches(text, LUNCH_DELIVERY);
  const negative = matches(text, MEAL_NEGATIVE);

  if (positive && negative) {
    return { answer: false, confidence: AMBIGUOUS_CONFIDENCE };
  }
  if (positive) return { answer: true, confidence: POSITIVE_CONFIDENCE };
  if (negative) {
    return { answer: false, confidence: EXPLICIT_NEGATIVE_CONFIDENCE };
  }
  return { answer: false, confidence: DEFAULT_NEGATIVE_CONFIDENCE };
}

function answerFor(
  questionId: string,
  text: string,
): { answer: boolean | string; confidence: number } {
  switch (questionId) {
    case "Q1": {
      if (matches(text, SIT_REFUSAL)) {
        return { answer: false, confidence: EXPLICIT_NEGATIVE_CONFIDENCE };
      }
      return resolveBoolean(text, SIT_POSITIVE, SIT_NEGATIVE, 0.68);
    }
    case "Q2":
      return resolveTransport(text);
    case "Q3":
      return resolveMeal(text);
    case "Q4":
      return resolveWindow(text);
    case "Q5": {
      const positiveText = withoutNegatedCareTerms(text).replace(
        CAREGIVER_STRAIN_IDIOM,
        " omitted ",
      );
      return resolveBoolean(
        text,
        SAFETY_POSITIVE,
        SAFETY_NEGATIVE,
        SAFETY_DEFAULT_CONFIDENCE,
        positiveText,
      );
    }
    case "Q6":
      return resolveBoolean(text, FAMILIAR_POSITIVE, FAMILIAR_NEGATIVE);
    case "Q7":
      return resolveReheat(text);
    case "Q8": {
      const positiveText = withoutNegatedCareTerms(text);
      return resolveBoolean(
        text,
        MOBILITY_POSITIVE,
        MOBILITY_NEGATIVE,
        SAFETY_DEFAULT_CONFIDENCE,
        positiveText,
      );
    }
    case "Q9": {
      return resolveBoolean(
        text,
        PERSONAL_CARE_POSITIVE,
        PERSONAL_CARE_NEGATIVE,
        SAFETY_DEFAULT_CONFIDENCE,
        positiveTextForPersonalCare(text),
      );
    }
    default:
      return { answer: false, confidence: AMBIGUOUS_CONFIDENCE };
  }
}

/** Run the rules for exactly the requested questions, in the requested order. */
export function runKeywordEngine(input: {
  askText: string;
  questions: readonly PolicyQuestion[];
}): KeywordAnswer[] {
  const text = input.askText.normalize("NFC");

  return input.questions.map((question) => {
    const outcome = answerFor(question.id, text);
    const answerType = question.answerType === "pick" ? "pick" : "yesno";
    const answer =
      answerType === "yesno"
        ? outcome.answer === true
        : String(outcome.answer);

    return {
      questionId: question.id,
      answerType,
      answer,
      confidence: outcome.confidence,
    };
  });
}
