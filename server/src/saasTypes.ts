import { IdentifyResponse, MatchCandidate } from "./types";

export type PlanId = "free" | "pro_monthly" | "pro_yearly";

export type PublicUser = {
  id: string;
  email: string;
  plan: PlanId;
  subscriptionStatus?: string | null;
  createdAt: string;
};

export type StoredUser = PublicUser & {
  passwordHash: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type UsageSummary = {
  plan: PlanId;
  limit: number;
  used: number;
  remaining: number;
  period: "day" | "month";
};

export type RecognitionHistoryItem = {
  id: string;
  transcript: string;
  recognitionMode?: IdentifyResponse["recognitionMode"];
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

export type DashboardSummary = {
  usage: UsageSummary;
  history: RecognitionHistoryItem[];
  memorization: MemorizationItem[];
  stats: {
    totalRecognitions: number;
    dueReviews: number;
    weakAyahs: number;
  };
};

export type CorrectionInput = {
  userId?: string;
  anonymousKey?: string;
  transcript?: string;
  verdict: "correct" | "wrong";
  actual?: MatchCandidate;
  expectedSurahNumber?: number;
  expectedAyahStart?: number;
  expectedAyahEnd?: number;
};
