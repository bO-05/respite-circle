/**
 * The fictional examples offered on the Ask screen.
 *
 * The first three are the approved hero asks for Marta, David, and Priya from
 * the source specification. The last two show the two situations the app must
 * never turn into a volunteer slot: personal care and a safety risk. All five
 * are fictional, and the screen says so before anyone taps one.
 *
 * This module is client-safe: the form imports it directly.
 */

export type AskSampleId =
  | "marta"
  | "david"
  | "priya"
  | "personal-care"
  | "safety";

export type AskSample = {
  id: AskSampleId;
  title: string;
  body: string;
  /**
   * False for the two examples that demonstrate a refusal. Their titles name
   * what happens — the ask stops and a person calls — so a caregiver cannot
   * mistake one for a request the app can fill.
   */
  supported: boolean;
};

export const ASK_SAMPLE_NOTICE =
  "These examples are fictional. Use one as a starting point, then change it to your own words. Choosing one replaces what is in the box. The last two are not requests this app can arrange: each one stops, and a person calls instead.";

export const ASK_SAMPLES: readonly AskSample[] = [
  {
    id: "marta",
    title: "Marta — a Saturday morning",
    body: "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.",
    supported: true,
  },
  {
    id: "david",
    title: "David — a drive to physio",
    body: "June has physio on Tuesdays at two and I don't drive anymore. Someone patient to take her and wait would mean the world. She needs a hand getting out of the car, that's all.",
    supported: true,
  },
  {
    id: "priya",
    title: "Priya — one meal that reheats",
    body: "Dad has dialysis three evenings a week and I work until six. One meal we can reheat on a Thursday would take so much pressure off. Nothing spicy, please, and no pork.",
    supported: true,
  },
  {
    id: "personal-care",
    title: "Personal care — the ask stops, and a person calls",
    body: "Mum won't take her pills unless someone puts them in her hand and watches. Could someone come at lunchtime and do her medication?",
    supported: false,
  },
  {
    id: "safety",
    title: "Safety — the ask stops, and a person calls today",
    body: "Dad keeps leaving the house at night and we found him two streets away. I am so scared something will happen.",
    supported: false,
  },
] as const;

export function sampleById(id: string): AskSample | undefined {
  return ASK_SAMPLES.find((sample) => sample.id === id);
}

/**
 * The home page's one sample receipt: three of the nine typed answers, so a
 * visitor can see the shape of what a coordinator reads instead of a paragraph
 * explaining "what the computer does".
 *
 * The label names the role, never a person. A coordinator's name is resolved
 * per church (the receipt and the desk do that), and the public home page has
 * no church to resolve one from, so any name here would be false on every
 * other church's screen. Three lines only; the full receipt keeps all nine.
 */
export type SampleReceiptLine = {
  label: string;
  answer: "Yes" | "No";
};

export const SAMPLE_RECEIPT_LABEL = "A sample of what your coordinator reads";

export const SAMPLE_RECEIPT_NOTE =
  "Fictional example. The full record has nine answers; this card shows three.";

const SAMPLE_RECEIPT_LINES: readonly SampleReceiptLine[] = [
  { label: "Someone to sit with her", answer: "Yes" },
  { label: "A meal that reheats", answer: "No" },
  { label: "A safety concern", answer: "No" },
];

export const SAMPLE_RECEIPT = {
  words: "I need a Tuesday morning with Mum so I can go to the dentist.",
  lines: SAMPLE_RECEIPT_LINES,
  note: SAMPLE_RECEIPT_NOTE,
} as const;
