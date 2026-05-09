import fs from "node:fs";
import path from "node:path";
import { QuranVerse } from "./types";

const DATA_PATH = path.join(process.cwd(), "server", "data", "quran-corpus.json");

const fallbackCorpus: QuranVerse[] = [
  {
    surahNumber: 1,
    surahName: "Al-Fatihah",
    ayahNumber: 1,
    arabicText: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    englishTranslation: "In the name of Allah, the Entirely Merciful, the Especially Merciful.",
    audioUrl: "https://verses.quran.com/AbdulBaset/Mujawwad/mp3/001001.mp3"
  },
  {
    surahNumber: 1,
    surahName: "Al-Fatihah",
    ayahNumber: 2,
    arabicText: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    englishTranslation: "All praise is due to Allah, Lord of the worlds.",
    audioUrl: "https://verses.quran.com/AbdulBaset/Mujawwad/mp3/001002.mp3"
  },
  {
    surahNumber: 2,
    surahName: "Al-Baqarah",
    ayahNumber: 255,
    arabicText: "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ",
    englishTranslation: "Allah - there is no deity except Him, the Ever-Living, the Sustainer of existence.",
    audioUrl: "https://verses.quran.com/AbdulBaset/Mujawwad/mp3/002255.mp3"
  },
  {
    surahNumber: 112,
    surahName: "Al-Ikhlas",
    ayahNumber: 1,
    arabicText: "قُلْ هُوَ اللَّهُ أَحَدٌ",
    englishTranslation: "Say, He is Allah, One.",
    audioUrl: "https://verses.quran.com/AbdulBaset/Mujawwad/mp3/112001.mp3"
  },
  {
    surahNumber: 112,
    surahName: "Al-Ikhlas",
    ayahNumber: 2,
    arabicText: "اللَّهُ الصَّمَدُ",
    englishTranslation: "Allah, the Eternal Refuge.",
    audioUrl: "https://verses.quran.com/AbdulBaset/Mujawwad/mp3/112002.mp3"
  }
];

export function loadQuranCorpus(): QuranVerse[] {
  if (!fs.existsSync(DATA_PATH)) {
    return fallbackCorpus;
  }

  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const verses = JSON.parse(raw) as QuranVerse[];
  if (!Array.isArray(verses) || verses.length === 0) {
    return fallbackCorpus;
  }

  return verses;
}

export function findVerse(corpus: QuranVerse[], surah: number, ayah: number): QuranVerse | undefined {
  return corpus.find((verse) => verse.surahNumber === surah && verse.ayahNumber === ayah);
}

export function listSurahs(corpus: QuranVerse[]) {
  const surahs = new Map<number, string>();
  for (const verse of corpus) {
    if (!surahs.has(verse.surahNumber)) {
      surahs.set(verse.surahNumber, verse.surahName);
    }
  }

  return [...surahs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, name]) => ({ number, name }));
}
