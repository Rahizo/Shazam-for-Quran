import { describe, expect, it } from "vitest";
import { loadQuranCorpus } from "./quranData";
import { evaluateTajweedTranscript } from "./tajweed";

describe("tajweed evaluator", () => {
  it("keeps Quran orthography words whole and accepts plain Arabic Fatiha transcript", () => {
    const corpus = loadQuranCorpus();
    const verses = corpus.filter((verse) => verse.surahNumber === 1 && verse.ayahNumber >= 1 && verse.ayahNumber <= 7);
    const transcript =
      "بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين اياك نعبد واياك نستعين اهدنا الصراط المستقيم صراط الذين انعمت عليهم غير المغضوب عليهم ولا الضالين";

    const result = evaluateTajweedTranscript(transcript, verses);

    expect(result.score).toBe(100);
    expect(result.words.find((word) => word.expected?.includes("مَـٰلِكِ"))?.status).toBe("correct");
    expect(result.ruleSummary.some((item) => item.rule === "Madd")).toBe(true);
    expect(result.words.filter((word) => word.status === "missing" || word.status === "changed")).toHaveLength(0);
  });

  it("repairs internal Quran-script spacing before deciding word boundaries", () => {
    const result = evaluateTajweedTranscript("الحمد لله رب العالمين", [
      {
        surahNumber: 1,
        surahName: "Al-Fatihah",
        ayahNumber: 2,
        arabicText: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰ لَمِينَ",
        englishTranslation: ""
      }
    ]);

    expect(result.score).toBe(100);
    expect(result.words.map((word) => word.expected)).toEqual(["ٱلْحَمْدُ", "لِلَّهِ", "رَبِّ", "ٱلْعَـٰلَمِينَ"]);
    expect(result.words.filter((word) => word.status !== "correct")).toHaveLength(0);
  });

  it("ignores standalone Quran pause marks and accepts common STT text for disconnected letters", () => {
    const result = evaluateTajweedTranscript("الف لام ميم ذلك الكتاب لا ريب فيه هدى للمتقين", [
      {
        surahNumber: 2,
        surahName: "Al-Baqarah",
        ayahNumber: 1,
        arabicText: "\u0627\u0644\u0653\u0645\u0653",
        englishTranslation: ""
      },
      {
        surahNumber: 2,
        surahName: "Al-Baqarah",
        ayahNumber: 2,
        arabicText:
          "\u0630\u064E\u0670\u0644\u0650\u0643\u064E \u0671\u0644\u0652\u0643\u0650\u062A\u064E\u0640\u0670\u0628\u064F \u0644\u064E\u0627 \u0631\u064E\u064A\u0652\u0628\u064E \u06DB \u0641\u0650\u064A\u0647\u0650 \u06DB \u0647\u064F\u062F\u064B\u0649 \u0644\u0651\u0650\u0644\u0652\u0645\u064F\u062A\u0651\u064E\u0642\u0650\u064A\u0646\u064E",
        englishTranslation: ""
      }
    ]);

    expect(result.score).toBe(100);
    expect(result.words[0]).toMatchObject({
      expected: "\u0627\u0644\u0653\u0645\u0653",
      heard: "\u0627\u0644\u0641\u0644\u0627\u0645\u0645\u064A\u0645",
      status: "correct"
    });
    expect(result.words.map((word) => word.expected)).toEqual([
      "\u0627\u0644\u0653\u0645\u0653",
      "\u0630\u064E\u0670\u0644\u0650\u0643\u064E",
      "\u0671\u0644\u0652\u0643\u0650\u062A\u064E\u0640\u0670\u0628\u064F",
      "\u0644\u064E\u0627",
      "\u0631\u064E\u064A\u0652\u0628\u064E",
      "\u0641\u0650\u064A\u0647\u0650",
      "\u0647\u064F\u062F\u064B\u0649",
      "\u0644\u0651\u0650\u0644\u0652\u0645\u064F\u062A\u0651\u064E\u0642\u0650\u064A\u0646\u064E"
    ]);
    expect(result.words.filter((word) => word.expected === "\u06DB")).toHaveLength(0);
    expect(result.words.filter((word) => word.status !== "correct")).toHaveLength(0);
  });

  it("groups other disconnected-letter sequences instead of flagging their pronounced letter names as extra", () => {
    const result = evaluateTajweedTranscript("حا ميم عين سين قاف", [
      {
        surahNumber: 42,
        surahName: "Ash-Shuraa",
        ayahNumber: 1,
        arabicText: "\u062D\u0645\u0653",
        englishTranslation: ""
      },
      {
        surahNumber: 42,
        surahName: "Ash-Shuraa",
        ayahNumber: 2,
        arabicText: "\u0639\u0653\u0633\u0653\u0642\u0653",
        englishTranslation: ""
      }
    ]);

    expect(result.score).toBe(100);
    expect(result.words).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expected: "\u062D\u0645\u0653", heard: "\u062D\u0627\u0645\u064A\u0645", status: "correct" }),
        expect.objectContaining({ expected: "\u0639\u0653\u0633\u0653\u0642\u0653", heard: "\u0639\u064A\u0646\u0633\u064A\u0646\u0642\u0627\u0641", status: "correct" })
      ])
    );
    expect(result.words.filter((word) => word.status === "extra")).toHaveLength(0);
  });
});
