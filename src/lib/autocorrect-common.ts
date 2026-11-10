export const CONFIRMED_CORRECTIONS: Readonly<Record<string, string>> = {
  adress: "address",
  aplication: "application",
  availble: "available",
  baclfill: "backfill",
  baned: "banned",
  becuase: "because",
  bnned: "banned",
  buisness: "business",
  calender: "calendar",
  clsoed: "closed",
  definately: "definitely",
  doesnt: "doesn't",
  dosent: "doesn't",
  langauge: "language",
  mesage: "message",
  recieve: "receive",
  schdule: "schedule",
  seperate: "separate",
  teh: "the",
  telegrm: "telegram",
  tommorow: "tomorrow",
  wierd: "weird",
};

export type InstantAutocorrectResult = {
  text: string;
  changed: boolean;
  corrections: Array<{ from: string; to: string }>;
};

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCase(source: string, replacement: string): string {
  if (source === source.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (source[0] === source[0]?.toLocaleUpperCase()) {
    return replacement[0]?.toLocaleUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function applyInstantAutocorrect(value: string): InstantAutocorrectResult {
  const protectedValues: string[] = [];
  let text = value.replace(
    /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|@[A-Za-z0-9_.]+|#[A-Za-z0-9_]+/g,
    (matched) => {
      protectedValues.push(matched);
      return `\uE000${protectedValues.length - 1}\uE001`;
    }
  );
  const originalProtected = text;
  text = text.replace(/[ \t]+([,;:!?])/g, "$1");
  const corrections: InstantAutocorrectResult["corrections"] = [];
  if (text !== originalProtected) corrections.push({ from: "punctuation spacing", to: "fixed" });

  for (const [misspelling, replacement] of Object.entries(CONFIRMED_CORRECTIONS)) {
    const matcher = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapedRegex(misspelling)}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    text = text.replace(matcher, (matched) => {
      const corrected = matchCase(matched, replacement);
      if (!corrections.some((entry) => entry.from === matched && entry.to === corrected)) {
        corrections.push({ from: matched, to: corrected });
      }
      return corrected;
    });
  }

  text = text.replace(/\uE000(\d+)\uE001/g, (_, index: string) => protectedValues[Number(index)] || "");
  return { text, changed: text !== value, corrections };
}
