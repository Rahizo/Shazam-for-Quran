import fs from "node:fs/promises";
import path from "node:path";
import cors from "cors";
import express from "express";
import multer from "multer";
import { AudioMatchDiagnostics, findAudioMatches } from "./audioFingerprint";
import { clearSessionCookie, createSessionToken, hashPassword, isAdminEmail, readSessionToken, setSessionCookie, toPublicUser, verifyPassword, verifySessionToken } from "./auth";
import { createCheckoutSession, handleStripeWebhook } from "./billing";
import { transcribeWithLocalWhisper } from "./localWhisper";
import { findMatches } from "./matcher";
import { tokenizeArabic } from "./normalizeArabic";
import { findVerse, listSurahs, loadQuranCorpus } from "./quranData";
import { CorrectionInput, MemorizationStatus, StoredUser } from "./saasTypes";
import { getStore } from "./store";
import { evaluateTajweedTranscript } from "./tajweed";
import { createConfiguredTranscriber, refineArabicTranscriptWithDeepSeek, transcribeWithWordTimestamps, Transcriber } from "./transcribe";
import { IdentifyResponse, MatchCandidate } from "./types";
import { assertRecognitionAllowed, usageSummary } from "./usage";

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

async function rateLimitIdentify(request: express.Request, response: express.Response, next: express.NextFunction) {
  const session = verifySessionToken(readSessionToken(request));
  if (session) {
    const user = await getStore().findUserById(session.userId).catch(() => null);
    if (isAdminEmail(user?.email)) {
      next();
      return;
    }
  }

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

function parseRequiredInt(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw Object.assign(new Error(`${field} must be a whole number.`), { status: 400 });
  }
  return parsed;
}

function targetVerses(corpus: ReturnType<typeof loadQuranCorpus>, surahNumber: number, ayahStart: number, ayahEnd: number) {
  if (surahNumber < 1 || surahNumber > 114) {
    throw Object.assign(new Error("Select a valid surah."), { status: 400 });
  }
  if (ayahStart < 1 || ayahEnd < ayahStart) {
    throw Object.assign(new Error("Select a valid ayah range."), { status: 400 });
  }
  if (ayahEnd - ayahStart > 9) {
    throw Object.assign(new Error("Tajweed practice currently supports up to 10 ayahs at a time."), { status: 400 });
  }

  const verses = corpus.filter((verse) => verse.surahNumber === surahNumber && verse.ayahNumber >= ayahStart && verse.ayahNumber <= ayahEnd);
  if (verses.length !== ayahEnd - ayahStart + 1) {
    throw Object.assign(new Error("That surah/ayah range was not found."), { status: 400 });
  }
  return verses;
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

async function currentUser(request: express.Request): Promise<StoredUser | null> {
  const session = verifySessionToken(readSessionToken(request));
  return session ? getStore().findUserById(session.userId) : null;
}

function requireUser(user: StoredUser | null, response: express.Response): user is StoredUser {
  if (!user) {
    response.status(401).json({ error: "Sign in to use this feature." });
    return false;
  }
  return true;
}

export function createApp(transcriber: Transcriber = createConfiguredTranscriber(), localTranscriber: Transcriber = transcribeWithLocalWhisper) {
  const app = express();
  const corpus = loadQuranCorpus();
  const corsOrigin = process.env.CORS_ORIGIN;
  const store = getStore();

  app.disable("x-powered-by");
  app.use(cors(corsOrigin ? { origin: corsOrigin.split(",").map((origin: string) => origin.trim()) } : undefined));
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (request, response) => {
    try {
      response.json(await handleStripeWebhook(store, request.body as Buffer, request.header("stripe-signature")));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Webhook failed." });
    }
  });
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      corpusSize: corpus.length,
      recognitionModes: ["openai_hybrid", "local_whisper"],
      aiProviders: ["openai", "deepseek"],
      transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || "openai",
      billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      databaseConfigured: Boolean(process.env.DATABASE_URL)
    });
  });

  app.post("/api/auth/signup", async (request, response) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!email.includes("@") || password.length < 8) {
      response.status(400).json({ error: "Enter a valid email and a password with at least 8 characters." });
      return;
    }

    try {
      const user = await store.createUser(email, hashPassword(password));
      const token = createSessionToken(user);
      setSessionCookie(response, token);
      response.json({ token, user: toPublicUser(user), usage: await usageSummary(store, user) });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Could not create account." });
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const user = await store.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      response.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = createSessionToken(user);
    setSessionCookie(response, token);
    response.json({ token, user: toPublicUser(user), usage: await usageSummary(store, user) });
  });

  app.post("/api/auth/logout", (_request, response) => {
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/auth/me", async (request, response) => {
    const user = await currentUser(request);
    response.json({ user: user ? toPublicUser(user) : null, usage: await usageSummary(store, user, request.query.anonymousKey as string | undefined) });
  });

  app.post("/api/billing/checkout", async (request, response) => {
    const user = await currentUser(request);
    if (!requireUser(user, response)) {
      return;
    }

    try {
      const session = await createCheckoutSession(store, user, request.body?.interval);
      response.json({ url: session.url });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : "Could not start checkout." });
    }
  });

  app.get("/api/dashboard", async (request, response) => {
    const user = await currentUser(request);
    if (!requireUser(user, response)) {
      return;
    }

    const [usage, history, memorization, tajweedAttempts] = await Promise.all([
      usageSummary(store, user),
      store.listRecognitionHistory(user.id, 10),
      store.listMemorizationItems(user.id),
      store.listTajweedAttempts(user.id, 10)
    ]);
    response.json({
      usage,
      history,
      memorization,
      tajweedAttempts,
      stats: {
        totalRecognitions: history.length,
        dueReviews: memorization.filter((item) => item.status === "needs_review" || item.status === "low_confidence").length,
        weakAyahs: memorization.filter((item) => item.status === "low_confidence").length,
        tajweedPracticeCount: tajweedAttempts.length,
        bestTajweedScore: tajweedAttempts.reduce((best, attempt) => Math.max(best, attempt.score), 0),
        latestTajweedScore: tajweedAttempts[0]?.score || 0
      }
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

      const user = await currentUser(request);
      const anonymousKey = typeof request.body?.anonymousKey === "string" ? request.body.anonymousKey : request.ip;
      const usageBefore = await assertRecognitionAllowed(store, user, anonymousKey);
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
      const rawAudioMatches =
        process.env.NODE_ENV === "test"
          ? []
          : await findAudioMatches(transcriptionPath, corpus, surahNumbers, textMatches, audioMatcherDiagnostics, {
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
      await store.recordUsage({ userId: user?.id, anonymousKey: user ? undefined : anonymousKey, kind: "recognition" });
      if (user) {
        await store.saveRecognition(user.id, payload);
      }
      const usageAfter = await usageSummary(store, user, anonymousKey);
      (payload as IdentifyResponse & { usage?: typeof usageBefore }).usage = usageAfter;
      response.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to identify recitation.";
      response.status((error as Error & { status?: number }).status || 500).json({ error: message, usage: (error as Error & { usage?: unknown }).usage });
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
      const user = await currentUser(request);
      const anonymousKey = typeof request.body?.anonymousKey === "string" ? request.body.anonymousKey : request.ip;
      await assertRecognitionAllowed(store, user, anonymousKey);
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
      await store.recordUsage({ userId: user?.id, anonymousKey: user ? undefined : anonymousKey, kind: "recognition" });
      if (user) {
        await store.saveRecognition(user.id, payload);
      }
      (payload as IdentifyResponse & { usage?: unknown }).usage = await usageSummary(store, user, anonymousKey);
      response.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to identify transcript.";
      response.status((error as Error & { status?: number }).status || 500).json({ error: message, usage: (error as Error & { usage?: unknown }).usage });
    }
  });

  app.post("/api/tajweed/evaluate", rateLimitIdentify, upload.single("audio"), async (request, response) => {
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

      const user = await currentUser(request);
      const anonymousKey = typeof request.body?.anonymousKey === "string" ? request.body.anonymousKey : request.ip;
      await assertRecognitionAllowed(store, user, anonymousKey);
      const surahNumber = parseRequiredInt(request.body?.surahNumber, "Surah");
      const ayahStart = parseRequiredInt(request.body?.ayahStart, "Starting ayah");
      const ayahEnd =
        request.body?.ayahEnd === undefined || request.body?.ayahEnd === ""
          ? ayahStart
          : parseRequiredInt(request.body?.ayahEnd, "Ending ayah");
      const recognitionMode = parseRecognitionMode(request.body?.recognitionMode);
      const verses = targetVerses(corpus, surahNumber, ayahStart, ayahEnd);
      transcriptionPath = await ensureTranscriptionFilename(file);
      const readyTranscriptionPath = transcriptionPath;
      const storedExtension = path.extname(readyTranscriptionPath);
      let transcriptionError: string | undefined;
      let timedWords: Array<{ word: string; start: number; end: number }> = [];
      const transcript = await (recognitionMode === "openai_hybrid"
        ? transcribeWithWordTimestamps(readyTranscriptionPath)
            .then((timed) => {
              timedWords = timed.words;
              return timed.text;
            })
            .catch(() => transcriber(readyTranscriptionPath))
        : localTranscriber(readyTranscriptionPath)
      ).catch((error) => {
        transcriptionError = error instanceof Error ? error.message : "Transcription failed.";
        return "";
      });
      const transcriptTokens = tokenizeArabic(transcript);
      const evaluation = evaluateTajweedTranscript(transcript, verses, timedWords);
      const attempt = user
        ? await store.saveTajweedAttempt(user.id, {
            surahNumber: evaluation.surahNumber,
            surahName: evaluation.surahName,
            ayahStart: evaluation.ayahStart,
            ayahEnd: evaluation.ayahEnd,
            score: evaluation.score,
            transcript: evaluation.transcript,
            feedback: evaluation.words,
            advice: evaluation.advice,
            ruleSummary: evaluation.ruleSummary
          })
        : undefined;

      await store.recordUsage({ userId: user?.id, anonymousKey: user ? undefined : anonymousKey, kind: "recognition" });
      const history = user
        ? (await store.listTajweedAttempts(user.id, 40))
            .filter(
              (item) =>
                item.surahNumber === evaluation.surahNumber &&
                item.ayahStart === evaluation.ayahStart &&
                item.ayahEnd === evaluation.ayahEnd
            )
            .slice(0, 8)
        : [];
      response.json({
        ...evaluation,
        recognitionMode,
        attempt,
        history,
        usage: await usageSummary(store, user, anonymousKey),
        diagnostics: {
          audioFile: {
            bytes: file.size,
            mimetype: file.mimetype,
            originalname: file.originalname,
            storedExtension
          },
          transcription: {
            attempted: true,
            tokenCount: transcriptTokens.length,
            error: transcriptionError
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to evaluate tajweed practice.";
      response.status((error as Error & { status?: number }).status || 500).json({ error: message, usage: (error as Error & { usage?: unknown }).usage });
    } finally {
      if (transcriptionPath) {
        await fs.unlink(transcriptionPath).catch(() => undefined);
      }
      await fs.unlink(file.path).catch(() => undefined);
    }
  });

  app.post("/api/memorization", async (request, response) => {
    const user = await currentUser(request);
    if (!requireUser(user, response)) {
      return;
    }

    const item = await store.addMemorizationItem(user.id, {
      surahNumber: Number(request.body?.surahNumber),
      surahName: String(request.body?.surahName || ""),
      ayahStart: Number(request.body?.ayahStart),
      ayahEnd: Number(request.body?.ayahEnd),
      status: (request.body?.status || "needs_review") as MemorizationStatus,
      lastReviewedAt: null
    });
    response.json({ item });
  });

  app.patch("/api/memorization/:id", async (request, response) => {
    const user = await currentUser(request);
    if (!requireUser(user, response)) {
      return;
    }

    const status = request.body?.status as MemorizationStatus;
    if (!["recognized", "needs_review", "low_confidence"].includes(status)) {
      response.status(400).json({ error: "Invalid memorization status." });
      return;
    }

    const item = await store.updateMemorizationItem(user.id, request.params.id, status);
    if (!item) {
      response.status(404).json({ error: "Memorization item not found." });
      return;
    }
    response.json({ item });
  });

  app.post("/api/corrections", async (request, response) => {
    const user = await currentUser(request);
    const correction: CorrectionInput = {
      userId: user?.id,
      anonymousKey: typeof request.body?.anonymousKey === "string" ? request.body.anonymousKey : request.ip,
      transcript: typeof request.body?.transcript === "string" ? request.body.transcript : undefined,
      verdict: request.body?.verdict === "correct" ? "correct" : "wrong",
      actual: request.body?.actual,
      expectedSurahNumber: request.body?.expectedSurahNumber ? Number(request.body.expectedSurahNumber) : undefined,
      expectedAyahStart: request.body?.expectedAyahStart ? Number(request.body.expectedAyahStart) : undefined,
      expectedAyahEnd: request.body?.expectedAyahEnd ? Number(request.body.expectedAyahEnd) : undefined
    };
    await store.saveCorrection(correction);
    response.json({ ok: true });
  });

  return app;
}
