import fs from "node:fs/promises";
import path from "node:path";
import { QuranVerse } from "../src/types";

type Chapter = {
  id: number;
  name_simple: string;
};

type VersePayload = {
  id: number;
  verse_key: string;
  text_uthmani: string;
};

type TranslationPayload = {
  verse_key: string;
  text: string;
};

const API_BASE = "https://api.quran.com/api/v4";
const TRANSLATION_ID = 131;

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function audioUrl(surah: number, ayah: number): string {
  return `https://verses.quran.com/AbdulBaset/Mujawwad/mp3/${String(surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}.mp3`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function main() {
  const chaptersResponse = await fetchJson<{ chapters: Chapter[] }>(`${API_BASE}/chapters?language=en`);
  const corpus: QuranVerse[] = [];

  for (const chapter of chaptersResponse.chapters) {
    const versesResponse = await fetchJson<{ verses: VersePayload[] }>(
      `${API_BASE}/quran/verses/uthmani?chapter_number=${chapter.id}`
    );
    const translationsResponse = await fetchJson<{ translations: TranslationPayload[] }>(
      `${API_BASE}/quran/translations/${TRANSLATION_ID}?chapter_number=${chapter.id}`
    );
    const translations = new Map(translationsResponse.translations.map((item) => [item.verse_key, stripHtml(item.text)]));

    for (const verse of versesResponse.verses) {
      const [, ayah] = verse.verse_key.split(":").map(Number);
      corpus.push({
        surahNumber: chapter.id,
        surahName: chapter.name_simple,
        ayahNumber: ayah,
        arabicText: verse.text_uthmani,
        englishTranslation: translations.get(verse.verse_key) || "",
        audioUrl: audioUrl(chapter.id, ayah)
      });
    }
  }

  const outputPath = path.join(process.cwd(), "server", "data", "quran-corpus.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  console.log(`Wrote ${corpus.length} verses to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
