import { describe, expect, it } from "vitest";
import { findMatches } from "./matcher";
import { QuranVerse } from "./types";

const corpus: QuranVerse[] = [
  {
    surahNumber: 112,
    surahName: "Al-Ikhlas",
    ayahNumber: 1,
    arabicText: "\u0642\u064F\u0644\u0652 \u0647\u064F\u0648\u064E \u0627\u0644\u0644\u0651\u064E\u0647\u064F \u0623\u064E\u062D\u064E\u062F\u064C",
    englishTranslation: "Say, He is Allah, One."
  },
  {
    surahNumber: 112,
    surahName: "Al-Ikhlas",
    ayahNumber: 2,
    arabicText: "\u0627\u0644\u0644\u0651\u064E\u0647\u064F \u0627\u0644\u0635\u0651\u064E\u0645\u064E\u062F\u064F",
    englishTranslation: "Allah, the Eternal Refuge."
  },
  {
    surahNumber: 113,
    surahName: "Al-Falaq",
    ayahNumber: 1,
    arabicText: "\u0642\u064F\u0644\u0652 \u0623\u064E\u0639\u064F\u0648\u0630\u064F \u0628\u0650\u0631\u064E\u0628\u0651\u0650 \u0627\u0644\u0652\u0641\u064E\u0644\u064E\u0642\u0650",
    englishTranslation: "Say, I seek refuge in the Lord of daybreak."
  }
];

describe("findMatches", () => {
  it("finds an exact verse match", () => {
    const [top] = findMatches("\u0642\u0644 \u0647\u0648 \u0627\u0644\u0644\u0647 \u0627\u062D\u062F", corpus);
    expect(top.surahNumber).toBe(112);
    expect(top.ayahStart).toBe(1);
    expect(top.confidence).toBeGreaterThan(0.9);
  });

  it("finds a multi-ayah window", () => {
    const [top] = findMatches("\u0642\u0644 \u0647\u0648 \u0627\u0644\u0644\u0647 \u0627\u062D\u062F \u0627\u0644\u0644\u0647 \u0627\u0644\u0635\u0645\u062F", corpus);
    expect(top.surahNumber).toBe(112);
    expect(top.ayahStart).toBe(1);
    expect(top.ayahEnd).toBe(2);
  });

  it("handles noisy partial text", () => {
    const [top] = findMatches("\u0627\u0639\u0648\u0630 \u0628\u0631\u0628 \u0627\u0644\u0641\u0644\u0642", corpus);
    expect(top.surahNumber).toBe(113);
    expect(top.ayahStart).toBe(1);
  });

  it("does not produce broad Quran matches from a one-word transcript", () => {
    expect(findMatches("\u0627\u0644\u0643\u0648\u0627\u0641\u0631", corpus)).toEqual([]);
  });

  it("prioritizes partial long-verse transcript coverage over short common surahs", () => {
    const extendedCorpus: QuranVerse[] = [
      ...corpus,
      {
        surahNumber: 60,
        surahName: "Al-Mumtahanah",
        ayahNumber: 3,
        arabicText:
          "\u0644\u064E\u0646\u0652 \u062A\u064E\u0646\u0652\u0641\u064E\u0639\u064E\u0643\u064F\u0645\u0652 \u0623\u064E\u0631\u0652\u062D\u064E\u0627\u0645\u064F\u0643\u064F\u0645\u0652 \u0648\u064E\u0644\u064E\u0627 \u0623\u064E\u0648\u0652\u0644\u064E\u0627\u062F\u064F\u0643\u064F\u0645\u0652 \u064A\u064E\u0648\u0652\u0645\u064E \u0627\u0644\u0652\u0642\u0650\u064A\u064E\u0627\u0645\u064E\u0629\u0650 \u064A\u064E\u0641\u0652\u0635\u0650\u0644\u064F \u0628\u064E\u064A\u0652\u0646\u064E\u0643\u064F\u0645\u0652",
        englishTranslation: "Never will your relatives or your children benefit you; the Day of Resurrection He will judge between you."
      }
    ];

    const [top] = findMatches(
      "\u0644\u0646 \u062A\u0646\u0641\u0639\u0643\u0645 \u0623\u0631\u062D\u0627\u0645\u0643\u0645 \u064A\u0648\u0645 \u0627\u0644\u0642\u064A\u0627\u0645\u0629",
      extendedCorpus
    );
    expect(top.surahNumber).toBe(60);
    expect(top.ayahStart).toBe(3);
  });

  it("ignores leading bismillah when matching later verse content", () => {
    const extendedCorpus: QuranVerse[] = [
      ...corpus,
      {
        surahNumber: 60,
        surahName: "Al-Mumtahanah",
        ayahNumber: 3,
        arabicText:
          "\u0644\u064E\u0646\u0652 \u062A\u064E\u0646\u0652\u0641\u064E\u0639\u064E\u0643\u064F\u0645\u0652 \u0623\u064E\u0631\u0652\u062D\u064E\u0627\u0645\u064F\u0643\u064F\u0645\u0652 \u0648\u064E\u0644\u064E\u0627 \u0623\u064E\u0648\u0652\u0644\u064E\u0627\u062F\u064F\u0643\u064F\u0645\u0652 \u064A\u064E\u0648\u0652\u0645\u064E \u0627\u0644\u0652\u0642\u0650\u064A\u064E\u0627\u0645\u064E\u0629\u0650",
        englishTranslation: "Never will your relatives or your children benefit you on the Day of Resurrection."
      }
    ];

    const [top] = findMatches(
      "\u0628\u0633\u0645 \u0627\u0644\u0644\u0647 \u0627\u0644\u0631\u062D\u0645\u0646 \u0627\u0644\u0631\u062D\u064A\u0645 \u0644\u0646 \u062A\u0646\u0641\u0639\u0643\u0645 \u0623\u0631\u062D\u0627\u0645\u0643\u0645 \u0648\u0644\u0627 \u0623\u0648\u0644\u0627\u062F\u0643\u0645 \u064A\u0648\u0645 \u0627\u0644\u0642\u064A\u0627\u0645\u0629",
      extendedCorpus
    );
    expect(top.surahNumber).toBe(60);
    expect(top.ayahStart).toBe(3);
  });
});
