import nspell from "nspell";
import englishDictionary from "dictionary-en";
import frenchDictionary from "dictionary-fr";

const AUTOCORRECT_MODEL =
  process.env.OLLAMA_AUTOCORRECT_MODEL || "qwen3.5:4b";
const AUTOCORRECT_TIMEOUT_MS = Number(
  process.env.OLLAMA_AUTOCORRECT_TIMEOUT_MS || 45_000
);

type OllamaChatResponse = {
  message?: { content?: string };
};

type ProposedEdit = {
  from: string;
  to: string;
  confidence: number;
};

const englishSpeller = nspell({
  aff: Buffer.from(englishDictionary.aff),
  dic: Buffer.from(englishDictionary.dic),
});
const frenchSpeller = nspell({
  aff: Buffer.from(frenchDictionary.aff),
  dic: Buffer.from(frenchDictionary.dic),
});
const DOMAIN_WORDS = [
  "backfill",
  "ecommerce",
  "fintech",
  "autocorrect",
  "onboarding",
] as const;
for (const word of DOMAIN_WORDS) englishSpeller.add(word);
const PRESERVED_TERMS = new Set([
  "bc",
  "bro",
  "brother",
  "c",
  "dm",
  "dming",
  "dms",
  "ecom",
  "ein",
  "free",
  "gonna",
  "gotta",
  "idk",
  "imo",
  "lmao",
  "lmk",
  "llc",
  "lol",
  "pls",
  "plz",
  "rn",
  "ss4",
  "tho",
  "tmrw",
  "ur",
  "wanna",
]);
const CONFIRMED_CORRECTIONS: Record<string, string> = {
  baclfill: "backfill",
  baned: "banned",
  bnned: "banned",
  clsoed: "closed",
  doesnt: "doesn't",
  dosent: "doesn't",
  teh: "the",
  telegrm: "telegram",
};

export type AutocorrectResult = {
  text: string;
  changed: boolean;
  corrections: Array<{ from: string; to: string }>;
  model: string;
  safeFallback: boolean;
};

function ollamaUrl(): string {
  const configured = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const url = new URL(configured);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Autocorrect only accepts an Ollama address on this machine.");
  }
  return url.toString().replace(/\/$/, "");
}

function cleanInput(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").slice(0, 4000);
}

function protectedParts(value: string): string[] {
  return (
    value.match(
      /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|@[A-Za-z0-9_.]+|#[A-Za-z0-9_]+|(?:[$€£]\s*)?\b\d[\d,]*(?:\.\d+)?%?\b|\p{Extended_Pictographic}/gu
    ) || []
  );
}

function wordParts(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function safeCorrection(original: string, candidate: string): boolean {
  if (!candidate || candidate.length < original.length * 0.65) return false;
  if (candidate.length > original.length * 1.35) return false;
  if ((candidate.match(/\n/g) || []).length !== (original.match(/\n/g) || []).length) {
    return false;
  }
  if (wordParts(original).length !== wordParts(candidate).length) return false;

  const beforeProtected = protectedParts(original);
  const afterProtected = protectedParts(candidate);
  if (
    beforeProtected.length !== afterProtected.length ||
    beforeProtected.some((part, index) => part !== afterProtected[index])
  ) {
    return false;
  }

  const maxDistance = Math.max(4, Math.ceil(original.length * 0.2));
  return levenshteinDistance(original, candidate) <= maxDistance;
}

function readEdits(content: string): ProposedEdit[] {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed) as { edits?: unknown };
    if (!Array.isArray(parsed.edits)) return [];
    return parsed.edits
      .filter(
        (edit): edit is ProposedEdit =>
          !!edit &&
          typeof edit === "object" &&
          typeof (edit as ProposedEdit).from === "string" &&
          typeof (edit as ProposedEdit).to === "string" &&
          typeof (edit as ProposedEdit).confidence === "number"
      )
      .slice(0, 12);
  } catch {
    return [];
  }
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownWord(value: string): boolean {
  const normalized = value.replace(/’/g, "'");
  return englishSpeller.correct(normalized) || frenchSpeller.correct(normalized);
}

function languageEvidence(value: string, excludedWord: string): {
  english: number;
  french: number;
} {
  let english = 0;
  let french = 0;
  for (const word of wordParts(value)) {
    const normalized = word.toLocaleLowerCase().replace(/’/g, "'");
    if (normalized === excludedWord.toLocaleLowerCase()) continue;
    if (englishSpeller.correct(normalized)) english += 1;
    if (frenchSpeller.correct(normalized)) french += 1;
  }
  return { english, french };
}

function verifiedCorrection(
  from: string,
  proposed: string,
  message: string
): string | null {
  const normalizedFrom = from.toLocaleLowerCase();
  if (PRESERVED_TERMS.has(normalizedFrom)) return null;
  if (CONFIRMED_CORRECTIONS[normalizedFrom]) {
    const confirmed = CONFIRMED_CORRECTIONS[normalizedFrom];
    if (knownWord(from)) {
      const evidence = languageEvidence(message, from);
      const englishTarget = englishSpeller.correct(confirmed);
      const frenchTarget = frenchSpeller.correct(confirmed);
      if (englishTarget && !frenchTarget && evidence.english <= evidence.french) {
        return null;
      }
      if (frenchTarget && !englishTarget && evidence.french <= evidence.english) {
        return null;
      }
    }
    return confirmed;
  }
  if (knownWord(from)) return null;
  if (knownWord(proposed)) return proposed;

  const suggestions = Array.from(
    new Set([
      ...englishSpeller.suggest(from),
      ...frenchSpeller.suggest(from),
    ])
  ).filter((word) => {
    if (!knownWord(word)) return false;
    if (word[0]?.toLocaleLowerCase() !== from[0]?.toLocaleLowerCase()) return false;
    return (
      levenshteinDistance(from.toLocaleLowerCase(), word.toLocaleLowerCase()) <=
      Math.max(2, Math.ceil(from.length * 0.34))
    );
  });
  if (!suggestions.length) return null;

  const ranked = suggestions
    .map((word) => ({
      word,
      proposedDistance: levenshteinDistance(
        proposed.toLocaleLowerCase(),
        word.toLocaleLowerCase()
      ),
      sourceDistance: levenshteinDistance(
        from.toLocaleLowerCase(),
        word.toLocaleLowerCase()
      ),
    }))
    .sort(
      (left, right) =>
        left.proposedDistance - right.proposedDistance ||
        left.sourceDistance - right.sourceDistance
    );
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (runnerUp && runnerUp.proposedDistance === best.proposedDistance) return null;
  return best.proposedDistance <= 2 ? best.word : null;
}

function applySafeEdits(
  original: string,
  edits: ProposedEdit[]
): { text: string; corrections: Array<{ from: string; to: string }> } {
  let corrected = original.replace(/[ \t]+([,;:!?])/g, "$1");
  const corrections: Array<{ from: string; to: string }> = [];
  if (corrected !== original) {
    corrections.push({ from: "punctuation spacing", to: "fixed" });
  }
  for (const edit of edits) {
    const from = edit.from.trim();
    const to = edit.to.trim();
    if (edit.confidence < 0.97 || !from || !to || from === to) continue;
    if (from.length > 40 || to.length > 40) continue;
    if (!/^[\p{L}\p{N}'’-]+$/u.test(from) || !/^[\p{L}\p{N}'’-]+$/u.test(to)) {
      continue;
    }
    if (from.toLocaleLowerCase() === to.toLocaleLowerCase()) continue;
    if (from[0].toLocaleLowerCase() !== to[0].toLocaleLowerCase()) continue;
    const verified = verifiedCorrection(from, to, original);
    if (!verified) continue;
    const distance = levenshteinDistance(
      from.toLocaleLowerCase(),
      verified.toLocaleLowerCase()
    );
    if (distance > Math.max(2, Math.ceil(from.length * 0.34))) continue;

    const matcher = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapedRegex(from)}(?![\\p{L}\\p{N}])`,
      "gu"
    );
    const before = corrected;
    corrected = corrected.replace(matcher, verified);
    if (
      corrected !== before &&
      !corrections.some(
        (correction) => correction.from === from && correction.to === verified
      )
    ) {
      corrections.push({ from, to: verified });
    }
  }
  return { text: corrected, corrections };
}

function confirmedEdits(message: string): ProposedEdit[] {
  return wordParts(message)
    .filter((word) => CONFIRMED_CORRECTIONS[word.toLocaleLowerCase()])
    .map((word) => ({
      from: word,
      to: CONFIRMED_CORRECTIONS[word.toLocaleLowerCase()],
      confidence: 1,
    }));
}

export async function autocorrectLocally(
  value: string,
  requestSignal?: AbortSignal
): Promise<AutocorrectResult> {
  const original = cleanInput(value);
  if (!original.trim()) {
    return {
      text: original,
      changed: false,
      corrections: [],
      model: AUTOCORRECT_MODEL,
      safeFallback: false,
    };
  }

  const immediate = applySafeEdits(original, confirmedEdits(original));
  if (immediate.text !== original && safeCorrection(original, immediate.text)) {
    return {
      text: immediate.text,
      changed: true,
      corrections: immediate.corrections,
      model: AUTOCORRECT_MODEL,
      safeFallback: false,
    };
  }

  const controller = new AbortController();
  const abortFromRequest = () => controller.abort();
  requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  const timer = setTimeout(() => controller.abort(), AUTOCORRECT_TIMEOUT_MS);
  try {
    const response = await fetch(`${ollamaUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model: AUTOCORRECT_MODEL,
        stream: false,
        think: false,
        keep_alive: "10m",
        format: {
          type: "object",
          properties: {
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  confidence: { type: "number" },
                },
                required: ["from", "to", "confidence"],
              },
            },
          },
          required: ["edits"],
        },
        options: { temperature: 0 },
        messages: [
          {
            role: "system",
            content:
              "Find only clear spelling mistakes and missing apostrophes in a casual direct message. Return each correction as one exact original word and one correctly spelled replacement word, with confidence from 0 to 1. Do not return punctuation edits. Do not rewrite the sentence. Never change language, code-switching, slang, abbreviations, casing, names, product terms, links, handles, emails, numbers, or valid words. Text-message shorthand such as c, rn, lmk, dms, ecom, LLC, EIN, SS4, and free must stay unchanged. Use confidence 0.97 or higher only when the correction is certain; omit uncertain edits. Examples: bnned -> banned (0.99), baclfill -> backfill (0.99), dosent -> doesn't (0.99), comte -> compte only in the French phrase ouvrir un comte (0.99). Return only the requested JSON object.",
          },
          { role: "user", content: original },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Local autocorrect returned ${response.status}.`);
    }
    const payload = (await response.json()) as OllamaChatResponse;
    const edits = readEdits(payload.message?.content || "");
    const candidate = applySafeEdits(original, edits);
    if (!safeCorrection(original, candidate.text)) {
      return {
        text: original,
        changed: false,
        corrections: [],
        model: AUTOCORRECT_MODEL,
        safeFallback: true,
      };
    }
    return {
      text: candidate.text,
      changed: candidate.text !== original,
      corrections: candidate.corrections,
      model: AUTOCORRECT_MODEL,
      safeFallback: false,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Local autocorrect took too long.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}
