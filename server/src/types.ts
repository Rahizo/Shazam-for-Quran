export type QuranVerse = {
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  arabicText: string;
  englishTranslation: string;
  audioUrl?: string;
};

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
  recognitionMode?: "openai_hybrid" | "local_whisper";
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
