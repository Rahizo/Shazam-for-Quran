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
});
