import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { MatchCandidate, QuranVerse } from "./types";

type Fingerprint = number[][];

const sampleRate = 11025;
const frameSize = 2048;
const hopSize = 1024;
const bandFrequencies = [120, 170, 240, 340, 480, 680, 950, 1320, 1850, 2600, 3600, 4700];
const referenceReciter = process.env.AUDIO_REFERENCE_RECITER || "Alafasy_128kbps";
const cacheRoot = path.join(process.cwd(), "server", "audio-cache");
const referenceAudioDir = path.join(cacheRoot, `reference-audio-${referenceReciter}`);
const fingerprintDir = path.join(cacheRoot, `fingerprints-v2-${referenceReciter}`);
const popularSurahNumbers = new Set([1, 18, 36, 55, 67, 78, 87, 93, 94, 95, 96, 97, 99, 100, 103, 108, 109, 112, 113, 114]);

type AudioCandidate = {
  key: string;
  verses: QuranVerse[];
};

export type AudioMatchDiagnostics = {
  candidateCount: number;
  queryFrames: number;
  successfulCandidates: number;
  failedCandidates: number;
};

export type AudioMatchOptions = {
  broadSearch?: boolean;
};

function verseKey(verse: QuranVerse) {
  return `${String(verse.surahNumber).padStart(3, "0")}${String(verse.ayahNumber).padStart(3, "0")}`;
}

function candidateKey(verses: QuranVerse[]) {
  const first = verses[0];
  const last = verses[verses.length - 1];
  return `${first.surahNumber}:${first.ayahNumber}-${last.ayahNumber}`;
}

function referenceAudioUrl(verse: QuranVerse) {
  return `https://everyayah.com/data/${referenceReciter}/${verseKey(verse)}.mp3`;
}

function goertzelPower(samples: Float32Array, start: number, frequency: number) {
  const k = Math.round((frameSize * frequency) / sampleRate);
  const omega = (2 * Math.PI * k) / frameSize;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let index = 0; index < frameSize; index += 1) {
    const sample = samples[start + index] || 0;
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (frameSize - 1));
    q0 = coeff * q1 - q2 + sample * window;
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - coeff * q1 * q2;
}

function normalizeFrames(frames: number[][]): Fingerprint {
  if (frames.length === 0) {
    return [];
  }

  const dimensions = frames[0].length;
  const means = Array(dimensions).fill(0);
  const deviations = Array(dimensions).fill(0);

  for (const frame of frames) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      means[dimension] += frame[dimension];
    }
  }
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    means[dimension] /= frames.length;
  }
  for (const frame of frames) {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      const delta = frame[dimension] - means[dimension];
      deviations[dimension] += delta * delta;
    }
  }
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    deviations[dimension] = Math.sqrt(deviations[dimension] / frames.length) || 1;
  }

  const normalized = frames.map((frame) =>
    frame.map((value, dimension) => Math.max(-3, Math.min(3, (value - means[dimension]) / deviations[dimension])))
  );

  return normalized.map((frame, index) => {
    const previous = normalized[Math.max(0, index - 1)];
    const deltas = frame.map((value, dimension) => (value - previous[dimension]) * 0.6);
    return [...frame, ...deltas];
  });
}

export function fingerprintSamples(samples: Float32Array): Fingerprint {
  const rawFrames: number[][] = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let rms = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const sample = samples[start + index];
      rms += sample * sample;
    }
    rms = Math.sqrt(rms / frameSize);
    if (rms < 0.0025) {
      continue;
    }

    const bands = bandFrequencies.map((frequency) => Math.log1p(goertzelPower(samples, start, frequency)));
    const total = bands.reduce((sum, value) => sum + value, 0) || 1;
    const centroid =
      bands.reduce((sum, value, index) => sum + value * Math.log(bandFrequencies[index]), 0) / total;
    rawFrames.push([Math.log1p(rms * 200), centroid, ...bands]);
  }

  return normalizeFrames(rawFrames);
}

function frameDistance(a: number[], b: number[]) {
  let sum = 0;
  const dimensions = Math.min(a.length, b.length);
  for (let index = 0; index < dimensions; index += 1) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum / dimensions);
}

function dtwDistance(a: Fingerprint, b: Fingerprint) {
  const n = a.length;
  const m = b.length;
  const band = Math.max(8, Math.ceil(Math.max(n, m) * 0.22));
  const previous = Array(m + 1).fill(Number.POSITIVE_INFINITY);
  let current = Array(m + 1).fill(Number.POSITIVE_INFINITY);
  previous[0] = 0;

  for (let i = 1; i <= n; i += 1) {
    current[0] = Number.POSITIVE_INFINITY;
    const start = Math.max(1, i - band);
    const end = Math.min(m, i + band);

    for (let j = 1; j < start; j += 1) {
      current[j] = Number.POSITIVE_INFINITY;
    }
    for (let j = start; j <= end; j += 1) {
      const cost = frameDistance(a[i - 1], b[j - 1]);
      current[j] = cost + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    for (let j = end + 1; j <= m; j += 1) {
      current[j] = Number.POSITIVE_INFINITY;
    }

    for (let j = 0; j <= m; j += 1) {
      previous[j] = current[j];
    }
    current = Array(m + 1).fill(Number.POSITIVE_INFINITY);
  }

  return previous[m] / (n + m);
}

export function compareFingerprints(query: Fingerprint, reference: Fingerprint): number {
  if (query.length < 8 || reference.length < 8) {
    return 0;
  }

  const shorter = query.length <= reference.length ? query : reference;
  const longer = query.length <= reference.length ? reference : query;
  const coverage = Math.sqrt(shorter.length / longer.length);
  const rates = [0.72, 0.84, 1, 1.18, 1.36];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const rate of rates) {
    const windowLength = Math.round(shorter.length * rate);
    if (windowLength < 8 || windowLength > longer.length) {
      continue;
    }

    const step = Math.max(1, Math.floor(windowLength / 10));
    for (let start = 0; start + windowLength <= longer.length; start += step) {
      const window = longer.slice(start, start + windowLength);
      bestDistance = Math.min(bestDistance, dtwDistance(shorter, window));
    }

    if (longer.length > windowLength) {
      const tail = longer.slice(longer.length - windowLength);
      bestDistance = Math.min(bestDistance, dtwDistance(shorter, tail));
    }
  }

  if (!Number.isFinite(bestDistance)) {
    return 0;
  }

  const similarity = Math.exp(-bestDistance / 0.24) * coverage;
  return Math.round(Math.max(0, Math.min(1, similarity)) * 100) / 100;
}

async function decodeAudioFile(filePath: string): Promise<Float32Array> {
  const ffmpegBinary = ffmpegPath;
  if (typeof ffmpegBinary !== "string") {
    throw new Error("ffmpeg-static could not provide an ffmpeg binary.");
  }

  const output = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegBinary, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-af",
      "highpass=f=90,lowpass=f=5200,loudnorm=I=-18:LRA=11:TP=-1.5",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "pipe:1"
    ]);
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(Buffer.concat(errors).toString("utf8") || `ffmpeg exited with code ${code}`));
      }
    });
  });

  const samples = new Float32Array(Math.floor(output.length / 2));
  for (let offset = 0; offset + 1 < output.length; offset += 2) {
    samples[offset / 2] = output.readInt16LE(offset) / 32768;
  }
  return samples;
}

export async function fingerprintAudioFile(filePath: string): Promise<Fingerprint> {
  return fingerprintSamples(await decodeAudioFile(filePath));
}

async function downloadReferenceAudio(verse: QuranVerse): Promise<string> {
  await fs.mkdir(referenceAudioDir, { recursive: true });
  const outputPath = path.join(referenceAudioDir, `${verseKey(verse)}.mp3`);

  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {
    const url = referenceAudioUrl(verse);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download reference audio ${url}: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, bytes);
    return outputPath;
  }
}

async function getVerseFingerprint(verse: QuranVerse): Promise<Fingerprint> {
  await fs.mkdir(fingerprintDir, { recursive: true });
  const outputPath = path.join(fingerprintDir, `${verseKey(verse)}.json`);

  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8")) as Fingerprint;
  } catch {
    const audioPath = await downloadReferenceAudio(verse);
    const fingerprint = await fingerprintAudioFile(audioPath);
    await fs.writeFile(outputPath, JSON.stringify(fingerprint), "utf8");
    return fingerprint;
  }
}

function buildCandidate(verses: QuranVerse[], confidence: number): MatchCandidate {
  const first = verses[0];
  const last = verses[verses.length - 1];
  const displayConfidence = Math.round(Math.pow(confidence, 0.6) * 100) / 100;

  return {
    surahNumber: first.surahNumber,
    surahName: first.surahName,
    ayahStart: first.ayahNumber,
    ayahEnd: last.ayahNumber,
    confidence: displayConfidence,
    matchMethod: "audio",
    matchedSnippet: verses.map((verse) => verse.arabicText).join(" "),
    arabicText: verses.map((verse) => verse.arabicText).join(" "),
    englishTranslation: verses.map((verse) => `${verse.ayahNumber}. ${verse.englishTranslation}`).join(" "),
    audioUrl: referenceAudioUrl(first)
  };
}

function windowsForSurah(verses: QuranVerse[], includeDenseWindows: boolean): AudioCandidate[] {
  const candidates: AudioCandidate[] = [];
  if (verses.length <= 16) {
    candidates.push({ key: candidateKey(verses), verses });
  }

  if (!includeDenseWindows) {
    return candidates;
  }

  for (let start = 0; start < verses.length; start += 1) {
    for (let size = 1; size <= 7 && start + size <= verses.length; size += 1) {
      const window = verses.slice(start, start + size);
      candidates.push({ key: candidateKey(window), verses: window });
    }
  }
  return candidates;
}

function audioCandidates(corpus: QuranVerse[], selectedSurahs: number[], textMatches: MatchCandidate[], options: AudioMatchOptions = {}): AudioCandidate[] {
  const byKey = new Map<string, AudioCandidate>();
  const selected = new Set(selectedSurahs);
  const allSurahs = new Map<number, QuranVerse[]>();
  for (const verse of corpus) {
    if (!allSurahs.has(verse.surahNumber)) {
      allSurahs.set(verse.surahNumber, []);
    }
    allSurahs.get(verse.surahNumber)?.push(verse);
  }

  for (const match of textMatches.slice(0, 6)) {
    const verses = corpus.filter(
      (verse) => verse.surahNumber === match.surahNumber && verse.ayahNumber >= match.ayahStart && verse.ayahNumber <= match.ayahEnd
    );
    if (verses.length > 0) {
      byKey.set(candidateKey(verses), { key: candidateKey(verses), verses });
    }
  }

  const transcriptSurahs = new Set(textMatches.map((match) => match.surahNumber));
  const surahsToTry =
    selected.size > 0
      ? selected
      : transcriptSurahs.size > 0
        ? transcriptSurahs
        : options.broadSearch
          ? new Set(allSurahs.keys())
          : popularSurahNumbers;
  for (const surahNumber of surahsToTry) {
    const verses = allSurahs.get(surahNumber) || [];
    const includeDenseWindows = selected.size > 0 || transcriptSurahs.has(surahNumber) || verses.length <= (options.broadSearch ? 30 : 16);
    for (const candidate of windowsForSurah(verses, includeDenseWindows)) {
      byKey.set(candidate.key, candidate);
    }
  }

  return [...byKey.values()].slice(0, selected.size > 0 ? 260 : transcriptSurahs.size > 0 ? 220 : options.broadSearch ? 1800 : 120);
}

async function candidateFingerprint(candidate: AudioCandidate): Promise<Fingerprint> {
  const pieces = await Promise.all(candidate.verses.map(getVerseFingerprint));
  return pieces.flat();
}

export async function findAudioMatches(
  userAudioPath: string,
  corpus: QuranVerse[],
  selectedSurahs: number[],
  textMatches: MatchCandidate[] = [],
  diagnostics?: AudioMatchDiagnostics,
  options: AudioMatchOptions = {}
): Promise<MatchCandidate[]> {
  const query = await fingerprintAudioFile(userAudioPath);
  const candidates = audioCandidates(corpus, selectedSurahs, textMatches, options);
  if (diagnostics) {
    diagnostics.candidateCount = candidates.length;
    diagnostics.queryFrames = query.length;
  }
  if (query.length < 8) {
    throw new Error("No usable audio frames decoded from the recording. Check that the microphone is capturing the recitation.");
  }
  const matches: MatchCandidate[] = [];

  for (const candidate of candidates) {
    try {
      const reference = await candidateFingerprint(candidate);
      const confidence = compareFingerprints(query, reference);
      matches.push(buildCandidate(candidate.verses, confidence));
      if (diagnostics) {
        diagnostics.successfulCandidates += 1;
      }
    } catch {
      if (diagnostics) {
        diagnostics.failedCandidates += 1;
      }
      // Missing or temporarily unavailable reference audio should not block identification.
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
