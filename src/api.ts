import { Platform } from "react-native";

export type MatchCandidate = {
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  confidence: number;
  matchMethod?: "audio" | "text" | "hybrid";
  matchedSnippet: string;
  arabicText: string;
  englishTranslation: string;
  audioUrl?: string;
};

export type IdentifyResponse = {
  transcript: string;
  recognitionMode?: RecognitionMode;
  lowConfidence: boolean;
  matches: MatchCandidate[];
  usage?: UsageSummary;
  diagnostics?: {
    audioFile?: {
      bytes: number;
      mimetype: string;
      originalname: string;
      storedExtension: string;
    };
    audioMatcher?: {
      attempted: boolean;
      candidateCount?: number;
      queryFrames?: number;
      successfulCandidates?: number;
      failedCandidates?: number;
      error?: string;
    };
    transcription?: {
      attempted: boolean;
      tokenCount: number;
      error?: string;
    };
  };
};

export type SurahOption = {
  number: number;
  name: string;
};

export type RecognitionMode = "openai_hybrid" | "local_whisper";

export type PlanId = "free" | "pro_monthly" | "pro_yearly";

export type PublicUser = {
  id: string;
  email: string;
  plan: PlanId;
  subscriptionStatus?: string | null;
  createdAt: string;
  isAdmin?: boolean;
};

export type UsageSummary = {
  plan: PlanId;
  limit: number;
  used: number;
  remaining: number;
  period: "day" | "month";
  isUnlimited?: boolean;
};

export type RecognitionHistoryItem = {
  id: string;
  transcript: string;
  recognitionMode?: RecognitionMode;
  lowConfidence: boolean;
  matches: MatchCandidate[];
  createdAt: string;
};

export type MemorizationStatus = "recognized" | "needs_review" | "low_confidence";

export type MemorizationItem = {
  id: string;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  status: MemorizationStatus;
  lastReviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TajweedWordStatus = "correct" | "close" | "changed" | "missing" | "extra";

export type TajweedWordFeedback = {
  position: number;
  expected?: string;
  heard?: string;
  status: TajweedWordStatus;
  note: string;
};

export type TajweedAttempt = {
  id: string;
  userId?: string;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  score: number;
  transcript: string;
  feedback: TajweedWordFeedback[];
  advice: string[];
  createdAt: string;
};

export type TajweedEvaluationResponse = {
  transcript: string;
  recognitionMode?: RecognitionMode;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  score: number;
  summary: string;
  words: TajweedWordFeedback[];
  advice: string[];
  infographicSvg: string;
  attempt?: TajweedAttempt;
  history?: TajweedAttempt[];
  usage?: UsageSummary;
  diagnostics?: IdentifyResponse["diagnostics"];
};

export type DashboardSummary = {
  usage: UsageSummary;
  history: RecognitionHistoryItem[];
  memorization: MemorizationItem[];
  tajweedAttempts: TajweedAttempt[];
  stats: {
    totalRecognitions: number;
    dueReviews: number;
    weakAyahs: number;
    tajweedPracticeCount: number;
    bestTajweedScore: number;
    latestTajweedScore: number;
  };
};

export type AuthState = {
  token?: string;
  user: PublicUser | null;
  usage?: UsageSummary;
};

function defaultApiBaseUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return "";
  }

  return "http://localhost:8787";
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? defaultApiBaseUrl();
const tokenStorageKey = "quran_recognition_token";
const anonymousKeyStorageKey = "quran_recognition_anon";

export function getStoredToken(): string | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return undefined;
  }
  return window.localStorage.getItem(tokenStorageKey) || undefined;
}

export function storeToken(token?: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return;
  }
  if (token) {
    window.localStorage.setItem(tokenStorageKey, token);
  } else {
    window.localStorage.removeItem(tokenStorageKey);
  }
}

export function getAnonymousKey(): string {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return "native";
  }
  const existing = window.localStorage.getItem(anonymousKeyStorageKey);
  if (existing) {
    return existing;
  }
  const created = `anon_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  window.localStorage.setItem(anonymousKeyStorageKey, created);
  return created;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function parseJsonResponse(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error:
        "The server returned an empty response. On free hosting this usually means the request crashed or timed out; use OpenAI Hybrid instead of Local Whisper."
    };
  }

  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return {
      error:
        response.ok
          ? "The server returned a response the app could not read."
          : "The server returned an error page instead of JSON. Check Render logs for the exact backend error."
    };
  }
}

function filenameForBlob(blob: Blob): string {
  if (blob.type.includes("mp4")) {
    return "recitation.m4a";
  }
  if (blob.type.includes("mpeg")) {
    return "recitation.mp3";
  }
  if (blob.type.includes("wav")) {
    return "recitation.wav";
  }
  if (blob.type.includes("ogg")) {
    return "recitation.ogg";
  }
  return "recitation.webm";
}

export async function identifyRecitation(recording: string | Blob, surahNumbers: number[] = [], recognitionMode: RecognitionMode = "openai_hybrid"): Promise<IdentifyResponse> {
  const formData = new FormData();
  if (Platform.OS === "web" && recording instanceof Blob) {
    const blob = recording;
    formData.append("audio", blob, filenameForBlob(blob));
  } else if (Platform.OS === "web") {
    const blob = await fetch(recording as string).then((response) => response.blob());
    formData.append("audio", blob, filenameForBlob(blob));
  } else {
    formData.append("audio", {
      uri: recording as string,
      name: "recitation.m4a",
      type: "audio/m4a"
    } as unknown as Blob);
  }
  if (surahNumbers.length > 0) {
    formData.append("surahNumbers", surahNumbers.join(","));
  }
  formData.append("recognitionMode", recognitionMode);
  formData.append("anonymousKey", getAnonymousKey());

  const token = getStoredToken();
  const headers: HeadersInit = {
    Accept: "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/identify`, {
    method: "POST",
    body: formData,
    headers
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || "Unable to identify this recitation.");
  }

  return payload as unknown as IdentifyResponse;
}

export async function evaluateTajweed(
  recording: string | Blob,
  target: { surahNumber: number; ayahStart: number; ayahEnd: number },
  recognitionMode: RecognitionMode = "openai_hybrid"
): Promise<TajweedEvaluationResponse> {
  const formData = new FormData();
  if (Platform.OS === "web" && recording instanceof Blob) {
    formData.append("audio", recording, filenameForBlob(recording));
  } else if (Platform.OS === "web") {
    const blob = await fetch(recording as string).then((response) => response.blob());
    formData.append("audio", blob, filenameForBlob(blob));
  } else {
    formData.append("audio", {
      uri: recording as string,
      name: "tajweed-practice.m4a",
      type: "audio/m4a"
    } as unknown as Blob);
  }
  formData.append("surahNumber", String(target.surahNumber));
  formData.append("ayahStart", String(target.ayahStart));
  formData.append("ayahEnd", String(target.ayahEnd));
  formData.append("recognitionMode", recognitionMode);
  formData.append("anonymousKey", getAnonymousKey());

  const token = getStoredToken();
  const headers: HeadersInit = {
    Accept: "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/tajweed/evaluate`, {
    method: "POST",
    body: formData,
    headers
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || "Unable to evaluate this practice recording.");
  }
  return payload as unknown as TajweedEvaluationResponse;
}

export async function fetchSurahs(): Promise<SurahOption[]> {
  const payload = await apiFetch("/api/surahs");

  return payload.surahs as SurahOption[];
}

export async function identifyText(transcript: string, surahNumbers: number[] = []): Promise<IdentifyResponse> {
  return apiFetch("/api/identify-text", {
    method: "POST",
    body: JSON.stringify({ transcript, surahNumbers, anonymousKey: getAnonymousKey() })
  }) as Promise<IdentifyResponse>;
}

export async function signup(email: string, password: string): Promise<AuthState> {
  const payload = (await apiFetch("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) })) as AuthState;
  storeToken(payload.token);
  return payload;
}

export async function login(email: string, password: string): Promise<AuthState> {
  const payload = (await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) })) as AuthState;
  storeToken(payload.token);
  return payload;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  storeToken(undefined);
}

export async function fetchMe(): Promise<AuthState> {
  return apiFetch(`/api/auth/me?anonymousKey=${encodeURIComponent(getAnonymousKey())}`) as Promise<AuthState>;
}

export async function fetchDashboard(): Promise<DashboardSummary> {
  return apiFetch("/api/dashboard") as Promise<DashboardSummary>;
}

export async function createCheckout(interval: "month" | "year"): Promise<string> {
  const payload = (await apiFetch("/api/billing/checkout", { method: "POST", body: JSON.stringify({ interval }) })) as { url: string };
  return payload.url;
}

export async function saveMemorization(match: MatchCandidate, status: MemorizationStatus = "needs_review"): Promise<MemorizationItem> {
  const payload = (await apiFetch("/api/memorization", {
    method: "POST",
    body: JSON.stringify({
      surahNumber: match.surahNumber,
      surahName: match.surahName,
      ayahStart: match.ayahStart,
      ayahEnd: match.ayahEnd,
      status
    })
  })) as { item: MemorizationItem };
  return payload.item;
}

export async function updateMemorization(id: string, status: MemorizationStatus): Promise<MemorizationItem> {
  const payload = (await apiFetch(`/api/memorization/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  })) as { item: MemorizationItem };
  return payload.item;
}

export async function saveCorrection(input: {
  transcript?: string;
  verdict: "correct" | "wrong";
  actual?: MatchCandidate;
  expectedSurahNumber?: number;
  expectedAyahStart?: number;
  expectedAyahEnd?: number;
}) {
  await apiFetch("/api/corrections", {
    method: "POST",
    body: JSON.stringify({ ...input, anonymousKey: getAnonymousKey() })
  });
}
