import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import { AudioMatchDiagnostics, findAudioMatches } from "./audioFingerprint";
import { transcribeWithLocalWhisper } from "./localWhisper";
import { findMatches } from "./matcher";
import { tokenizeArabic } from "./normalizeArabic";
import { findVerse, listSurahs, loadQuranCorpus } from "./quranData";
import { createConfiguredTranscriber, refineArabicTranscriptWithDeepSeek, Transcriber } from "./transcribe";
import { IdentifyResponse, MatchCandidate } from "./types";

const upload = multer({
  dest: "server/uploads",
  limits: {
    fileSize: 25 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/x-m4a", "audio/aac", "video/webm"]);
    callback(null, allowed.has(file.mimetype) || file.mimetype.startsWith("audio/"));
  }
});

const identifyRequests = new Map<string, { count: number; resetAt: number }>();

function rateLimitIdentify(request: express.Request, response: express.Response, next: express.NextFunction) {
  const limit = Number(process.env.API_RATE_LIMIT_PER_HOUR || 30);
  if (limit <= 0) {
    next();
    return;
  }

  const now = Date.now();
  const key = request.ip || request.socket.remoteAddress || "unknown";
  const existing = identifyRequests.get(key);

  if (!existing || existing.resetAt <= now) {
    identifyRequests.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    next();
    return;
  }

  if (existing.count >= limit) {
    response.status(429).json({ error: "Too many recognition requests. Please try again later." });
    return;
  }

  existing.count += 1;
  next();
}

const supportedAudioExtensions = new Set([".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".oga", ".ogg", ".wav", ".webm"]);

function extensionFromMimeType(mimetype: string): string {
  const normalized = mimetype.toLowerCase().split(";")[0];
  const byMime: Record<string, string> = {
    "audio/aac": ".m4a",
    "audio/flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mpga": ".mpga",
    "audio/ogg": ".ogg",
    "audio/oga": ".oga",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/webm": ".webm",
    "video/webm": ".webm"
  };

  return byMime[normalized] || "";
}

function extensionFromUpload(file: Express.Multer.File): string {
  const originalExtension = path.extname(file.originalname || "").toLowerCase();
  if (supportedAudioExtensions.has(originalExtension)) {
    return originalExtension;
  }

  const mimetypeExtension = extensionFromMimeType(file.mimetype);
  if (supportedAudioExtensions.has(mimetypeExtension)) {
    return mimetypeExtension;
  }

  return ".webm";
}

async function ensureTranscriptionFilename(file: Express.Multer.File): Promise<string> {
  const currentExtension = path.extname(file.path).toLowerCase();
  if (supportedAudioExtensions.has(currentExtension)) {
    return file.path;
  }

  const transcriptionPath = `${file.path}${extensionFromUpload(file)}`;
  await fs.rename(file.path, transcriptionPath);
  return transcriptionPath;
}

function parseSurahFilter(value: unknown): number[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 114);
}

function parseRecognitionMode(value: unknown): "openai_hybrid" | "local_whisper" {
  return value === "local_whisper" || value === "local_audio" ? "local_whisper" : "openai_hybrid";
}

function filterCorpusBySurah(corpus: ReturnType<typeof loadQuranCorpus>, surahNumbers: number[]) {
  if (surahNumbers.length === 0) {
    return corpus;
  }

  const allowed = new Set(surahNumbers);
  return corpus.filter((verse) => allowed.has(verse.surahNumber));
}

function matchKey(match: MatchCandidate) {
  return `${match.surahNumber}:${match.ayahStart}-${match.ayahEnd}`;
}

function mergeMatches(audioMatches: MatchCandidate[], textMatches: MatchCandidate[]) {
  const merged = new Map<string, MatchCandidate>();
  const usableTextMatches = textMatches.filter((match) => match.confidence >= 0.25);

  for (const match of usableTextMatches) {
    merged.set(matchKey(match), { ...match, matchMethod: "text" });
  }

  for (const match of audioMatches) {
    const existing = merged.get(matchKey(match));
    if (existing) {
      merged.set(matchKey(match), {
        ...existing,
      confidence: Math.min(0.99, Math.max(existing.confidence, match.confidence) + 0.1),
        matchMethod: "hybrid"
      });
    } else {
      merged.set(matchKey(match), match);
    }
  }

  return [...merged.values()].sort((a, b) => {
    const methodBoost = (method?: MatchCandidate["matchMethod"]) => (method === "hybrid" ? 0.18 : method === "text" ? 0.06 : 0);
    return b.confidence + methodBoost(b.matchMethod) - (a.confidence + methodBoost(a.matchMethod));
  });
}

export function createApp(transcriber: Transcriber = createConfiguredTranscriber(), localTranscriber: Transcriber = transcribeWithLocalWhisper) {
  const app = express();
  const corpus = loadQuranCorpus();
  const corsOrigin = process.env.CORS_ORIGIN;

  app.disable("x-powered-by");
  app.use(cors(corsOrigin ? { origin: corsOrigin.split(",").map((origin: string) => origin.trim()) } : undefined));
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      corpusSize: corpus.length,
      recognitionModes: ["openai_hybrid", "local_whisper"],
      aiProviders: ["openai", "deepseek"],
      transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || "openai"
    });
  });

  app.get("/api/surahs", (_request, response) => {
    response.json({ surahs: listSurahs(corpus) });
  });

  app.get("/api/verses/:surah/:ayah", (request, response) => {
    const surah = Number(request.params.surah);
    const ayah = Number(request.params.ayah);
    const verse = findVerse(corpus, surah, ayah);

    if (!verse) {
      response.status(404).json({ error: "Verse not found." });
      return;
    }

    response.json(verse);
  });

  app.post("/api/identify", rateLimitIdentify, upload.single("audio"), async (request, response) => {
    const file = request.file;
    let transcriptionPath = file?.path;
    if (!file) {
      response.status(400).json({ error: "An audio file is required in the 'audio' field." });
      return;
    }

    try {
      if (file.size <= 0) {
        response.status(400).json({ error: "Audio file is empty." });
        return;
      }

      const surahNumbers = parseSurahFilter(request.body?.surahNumbers);
      const recognitionMode = parseRecognitionMode(request.body?.recognitionMode);
      const searchableCorpus = filterCorpusBySurah(corpus, surahNumbers);
      transcriptionPath = await ensureTranscriptionFilename(file);
      const storedExtension = path.extname(transcriptionPath);
      let transcriptionError: string | undefined;
      let audioMatcherError: string | undefined;
      const transcript = await (recognitionMode === "openai_hybrid" ? transcriber(transcriptionPath) : localTranscriber(transcriptionPath)).catch((error) => {
        transcriptionError = error instanceof Error ? error.message : "Transcription failed.";
        return "";
      });
      const transcriptTokens = tokenizeArabic(transcript);
      const textMatches = transcriptTokens.length >= 4 ? findMatches(transcript, searchableCorpus, 12) : [];
      const audioMatcherDiagnostics: AudioMatchDiagnostics = { candidateCount: 0, queryFrames: 0, successfulCandidates: 0, failedCandidates: 0 };
      const rawAudioMatches = await findAudioMatches(transcriptionPath, corpus, surahNumbers, textMatches, audioMatcherDiagnostics, {
        broadSearch: recognitionMode === "local_whisper" && textMatches.length === 0
      }).catch((error) => {
        audioMatcherError = error instanceof Error ? error.message : "Audio matching failed.";
        return [];
      });
      const audioMatches = rawAudioMatches.filter((match) => {
        const hasTextMatchForRange = textMatches.some((textMatch) => matchKey(textMatch) === matchKey(match));
        return hasTextMatchForRange || match.confidence >= (textMatches.length > 0 ? 0.42 : 0.55);
      });
      const matches = mergeMatches(audioMatches, textMatches)
        .filter((match) => match.confidence >= (match.matchMethod === "audio" ? 0.55 : 0.25))
        .slice(0, 5);
      const payload: IdentifyResponse = {
        transcript,
        recognitionMode,
        lowConfidence: matches.length === 0 || matches[0].confidence < 0.45,
        matches,
        diagnostics: {
          audioFile: {
            bytes: file.size,
            mimetype: file.mimetype,
            originalname: file.originalname,
            storedExtension
          },
          audioMatcher: {
            attempted: true,
            candidateCount: audioMatcherDiagnostics.candidateCount,
            queryFrames: audioMatcherDiagnostics.queryFrames,
            successfulCandidates: audioMatcherDiagnostics.successfulCandidates,
            failedCandidates: audioMatcherDiagnostics.failedCandidates,
            error: audioMatcherError
          },
          transcription: {
            attempted: true,
            tokenCount: transcriptTokens.length,
            error: transcriptionError
          }
        }
      };
      response.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to identify recitation.";
      response.status(500).json({ error: message });
    } finally {
      if (transcriptionPath) {
        await fs.unlink(transcriptionPath).catch(() => undefined);
      }
      await fs.unlink(file.path).catch(() => undefined);
    }
  });

  app.post("/api/identify-text", async (request, response) => {
    const transcript = typeof request.body?.transcript === "string" ? request.body.transcript : "";
    if (!transcript.trim()) {
      response.status(400).json({ error: "A transcript field is required." });
      return;
    }

    try {
      const surahNumbers = Array.isArray(request.body?.surahNumbers)
        ? request.body.surahNumbers.filter((item: unknown): item is number => typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 114)
        : parseSurahFilter(request.body?.surahNumbers);
      const searchableCorpus = filterCorpusBySurah(corpus, surahNumbers);
      const refinedTranscript = await refineArabicTranscriptWithDeepSeek(transcript);
      const matches = findMatches(refinedTranscript, searchableCorpus);
      const payload: IdentifyResponse = {
        transcript: refinedTranscript,
        lowConfidence: matches.length === 0 || matches[0].confidence < 0.45,
        matches
      };
      response.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to identify transcript.";
      response.status(500).json({ error: message });
    }
  });

  return app;
}
