import path from "node:path";
import { transcribeWithLocalWhisper } from "../src/localWhisper";
import { findMatches } from "../src/matcher";
import { loadQuranCorpus } from "../src/quranData";

function parseArgs() {
  const audio = process.argv[2];
  const surahsArg = process.argv.find((arg) => arg.startsWith("--surahs="));
  const surahs = surahsArg
    ? surahsArg
        .slice("--surahs=".length)
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 114)
    : [];

  if (!audio) {
    throw new Error("Usage: npm run test:local-whisper -- path/to/audio.webm --surahs=1,60");
  }

  return { audio: path.resolve(audio), surahs };
}

async function main() {
  const { audio, surahs } = parseArgs();
  const corpus = loadQuranCorpus();
  const searchableCorpus = surahs.length > 0 ? corpus.filter((verse) => surahs.includes(verse.surahNumber)) : corpus;
  const transcript = await transcribeWithLocalWhisper(audio);
  const matches = findMatches(transcript, searchableCorpus, 5);

  console.log(JSON.stringify({ transcript, matches }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
