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

function defaultApiBaseUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return "";
  }

  return "http://localhost:8787";
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? defaultApiBaseUrl();

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

  const response = await fetch(`${API_BASE_URL}/api/identify`, {
    method: "POST",
    body: formData,
    headers: {
      Accept: "application/json"
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Unable to identify this recitation.");
  }

  return payload as IdentifyResponse;
}

export async function fetchSurahs(): Promise<SurahOption[]> {
  const response = await fetch(`${API_BASE_URL}/api/surahs`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Unable to load surahs.");
  }

  return payload.surahs as SurahOption[];
}
