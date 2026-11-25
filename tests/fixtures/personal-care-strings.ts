/**
 * The round-2 audit's own strings, defined once.
 *
 * `VAL-R2CARE-001` tested fourteen plain personal-care phrases through the
 * real ask pipeline. `VAL-R2CARE-003` then tested eleven of them at the
 * coordinator's draft screen, as a slot label and as an orientation note.
 * Every test and spec imports this file, so a phrase can never drift between
 * the ask route and the screen that guards the board.
 */

/** The fourteen phrases a family uses, run through Q9 (VAL-R2CARE-001). */
export const AUDITED_ASK_PERSONAL_CARE_PHRASES = [
  "nappies",
  "diapers",
  "he needs an injection",
  "eye drops",
  "inhaler",
  "brush his teeth",
  "get changed for bed",
  "help him undress",
  "he has accidents",
  "clean him up after accidents",
  "loo",
  "help her to the loo",
  "change his nappies",
  "insulin injection",
] as const;

/**
 * The eleven strings the audit typed into the coordinator's draft screen
 * (VAL-R2CARE-003). Each must be refused as a label and as a note, and no
 * `slot` row may carry it.
 */
export const AUDITED_DRAFT_PERSONAL_CARE_STRINGS = [
  "change his nappies",
  "he needs an injection",
  "help her to the loo",
  "help him undress",
  "clean him up after accidents",
  "eye drops and inhaler",
  "brush his teeth",
  "get changed for bed",
  "change her pads in the morning",
  "help her wash and get dressed",
  "make sure she takes her tablets with dinner",
] as const;
