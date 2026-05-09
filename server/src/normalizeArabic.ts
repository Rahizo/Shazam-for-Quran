const arabicDiacritics = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const quranMarks = /[\u06D6-\u06ED\u06DD\u06DE\u06E9]/g;
const punctuation = /[^\p{Script=Arabic}\p{Number}\s]/gu;

export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(arabicDiacritics, "")
    .replace(quranMarks, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0640/g, "")
    .replace(punctuation, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeArabic(input: string): string[] {
  const normalized = normalizeArabic(input);
  return normalized.length === 0 ? [] : normalized.split(" ");
}
