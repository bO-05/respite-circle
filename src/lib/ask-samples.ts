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
};

export const ASK_SAMPLE_NOTICE =
  "These examples are fictional. Use one as a starting point, then change it to your own words. Choosing one replaces what is in the box.";

export const ASK_SAMPLES: readonly AskSample[] = [
  {
    id: "marta",
    title: "Marta — a Saturday morning",
    body: "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.",
  },
  {
    id: "david",
    title: "David — a drive to physio",
    body: "June has physio on Tuesdays at two and I don't drive anymore. Someone patient to take her and wait would mean the world. She needs a hand getting out of the car, that's all.",
  },
  {
    id: "priya",
    title: "Priya — one meal that reheats",
    body: "Dad has dialysis three evenings a week and I work until six. One meal we can reheat on a Thursday would take so much pressure off. Nothing spicy, please, and no pork.",
  },
  {
    id: "personal-care",
    title: "Personal care — help with medication",
    body: "Mum won't take her pills unless someone puts them in her hand and watches. Could someone come at lunchtime and do her medication?",
  },
  {
    id: "safety",
    title: "Safety — leaving the house at night",
    body: "Dad keeps leaving the house at night and we found him two streets away. I am so scared something will happen.",
  },
] as const;

export function sampleById(id: string): AskSample | undefined {
  return ASK_SAMPLES.find((sample) => sample.id === id);
}
