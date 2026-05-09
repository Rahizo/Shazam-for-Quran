import { normalizeArabic, tokenizeArabic } from "./normalizeArabic";
import { MatchCandidate, QuranVerse } from "./types";

type IndexedVerse = QuranVerse & {
  normalized: string;
  tokens: string[];
};

const commonTokens = new Set([
  "\u0627\u0646",
  "\u0627\u0644\u0630\u064A",
  "\u0627\u0644\u0630\u064A\u0646",
  "\u0627\u0644\u0644\u0647",
  "\u0627\u0644\u064A",
  "\u0627\u064A\u0647\u0627",
  "\u0642\u0627\u0644",
  "\u0642\u0644",
  "\u0641\u064A",
  "\u0644\u0627",
  "\u0645\u0627",
  "\u0645\u0646",
  "\u0648\u0645\u0627",
  "\u064A\u0627"
]);

function tokenWeight(token: string): number {
  return commonTokens.has(token) ? 0.45 : 1;
}

function jaccardScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;

  for (const token of aSet) {
    if (bSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function queryCoverageScore(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const meaningfulQueryTokens = queryTokens.filter((token) => token.length > 1);
  if (meaningfulQueryTokens.length === 0) {
    return 0;
  }

  let hits = 0;
  let total = 0;
  for (const token of meaningfulQueryTokens) {
    const weight = tokenWeight(token);
    total += weight;
    if (candidateSet.has(token)) {
      hits += weight;
    }
  }

  return total === 0 ? 0 : hits / total;
}

function orderedCoverageScore(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  let previous = new Array(candidateTokens.length + 1).fill(0);
  let current = new Array(candidateTokens.length + 1).fill(0);

  for (let queryIndex = 1; queryIndex <= queryTokens.length; queryIndex += 1) {
    const token = queryTokens[queryIndex - 1];
    const weight = tokenWeight(token);

    for (let candidateIndex = 1; candidateIndex <= candidateTokens.length; candidateIndex += 1) {
      current[candidateIndex] =
        token === candidateTokens[candidateIndex - 1]
          ? previous[candidateIndex - 1] + weight
          : Math.max(previous[candidateIndex], current[candidateIndex - 1]);
    }

    [previous, current] = [current, previous.fill(0)];
  }

  const total = queryTokens.reduce((sum, token) => sum + tokenWeight(token), 0);
  return total === 0 ? 0 : previous[candidateTokens.length] / total;
}

function sequenceScore(query: string, candidate: string): number {
  if (!query || !candidate) {
    return 0;
  }
  if (candidate.includes(query)) {
    return 1;
  }
  if (query.includes(candidate)) {
    return 0.9;
  }
  return 0;
}

function removeLeadingBismillah(tokens: string[]): string[] {
  const bismillah = ["\u0628\u0633\u0645", "\u0627\u0644\u0644\u0647", "\u0627\u0644\u0631\u062D\u0645\u0646", "\u0627\u0644\u0631\u062D\u064A\u0645"];
  const startsWithBismillah = bismillah.every((token, index) => tokens[index] === token);
  if (startsWithBismillah && tokens.length > bismillah.length + 2) {
    return tokens.slice(bismillah.length);
  }
  return tokens;
}

function buildCandidate(verses: IndexedVerse[], transcriptTokens: string[], transcriptText: string): MatchCandidate {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const arabicText = verses.map((verse) => verse.arabicText).join(" ");
  const englishTranslation = verses.map((verse) => `${verse.ayahNumber}. ${verse.englishTranslation}`).join(" ");
  const candidateTokens = verses.flatMap((verse) => verse.tokens);
  const candidateText = normalizeArabic(arabicText);
  const lexical = jaccardScore(transcriptTokens, candidateTokens);
  const queryCoverage = queryCoverageScore(transcriptTokens, candidateTokens);
  const orderedCoverage = orderedCoverageScore(transcriptTokens, candidateTokens);
  const sequential = sequenceScore(transcriptText, candidateText);
  const lengthFit = Math.min(transcriptTokens.length, candidateTokens.length) / Math.max(transcriptTokens.length, candidateTokens.length, 1);
  const confidence =
    Math.round(Math.min(1, queryCoverage * 0.55 + orderedCoverage * 0.25 + lexical * 0.1 + sequential * 0.07 + lengthFit * 0.03) * 100) / 100;

  return {
    surahNumber: first.surahNumber,
    surahName: first.surahName,
    ayahStart: first.ayahNumber,
    ayahEnd: last.ayahNumber,
    confidence,
    matchMethod: "text",
    matchedSnippet: arabicText,
    arabicText,
    englishTranslation,
    audioUrl: first.audioUrl
  };
}

export function findMatches(transcript: string, corpus: QuranVerse[], limit = 5): MatchCandidate[] {
  const transcriptTokens = removeLeadingBismillah(tokenizeArabic(transcript));
  const transcriptText = transcriptTokens.join(" ");
  if (transcriptTokens.length < 2) {
    return [];
  }

  const indexed = corpus.map((verse) => ({
    ...verse,
    normalized: normalizeArabic(verse.arabicText),
    tokens: tokenizeArabic(verse.arabicText)
  }));

  const candidates: MatchCandidate[] = [];

  for (let start = 0; start < indexed.length; start += 1) {
    const maxWindow = Math.min(10, indexed.length - start);
    for (let size = 1; size <= maxWindow; size += 1) {
      const window = indexed.slice(start, start + size);
      const sameSurah = window.every((verse) => verse.surahNumber === window[0].surahNumber);
      const continuous = window.every((verse, index) => index === 0 || verse.ayahNumber === window[index - 1].ayahNumber + 1);
      if (!sameSurah || !continuous) {
        continue;
      }
      candidates.push(buildCandidate(window, transcriptTokens, transcriptText));
    }
  }

  return candidates
    .sort((a, b) => b.confidence - a.confidence)
    .filter((candidate, index, sorted) => {
      return sorted.findIndex((item) => item.surahNumber === candidate.surahNumber && item.ayahStart === candidate.ayahStart && item.ayahEnd === candidate.ayahEnd) === index;
    })
    .slice(0, limit);
}
