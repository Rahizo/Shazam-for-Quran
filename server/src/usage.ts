import { AppStore } from "./store";
import { PlanId, StoredUser, UsageSummary } from "./saasTypes";

function startOfDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function planLimit(plan: PlanId | undefined) {
  if (plan === "pro_monthly" || plan === "pro_yearly") {
    return {
      limit: Number(process.env.PRO_MONTHLY_RECOGNITIONS || 100),
      since: startOfMonth(),
      period: "month" as const
    };
  }

  return {
    limit: Number(process.env.FREE_DAILY_RECOGNITIONS || 5),
    since: startOfDay(),
    period: "day" as const
  };
}

export async function usageSummary(store: AppStore, user: StoredUser | null, anonymousKey?: string): Promise<UsageSummary> {
  const plan = user?.plan || "free";
  const rule = planLimit(plan);
  const used = await store.countUsage({ userId: user?.id, anonymousKey: user ? undefined : anonymousKey, since: rule.since });
  return {
    plan,
    limit: rule.limit,
    used,
    remaining: Math.max(0, rule.limit - used),
    period: rule.period
  };
}

export async function assertRecognitionAllowed(store: AppStore, user: StoredUser | null, anonymousKey?: string) {
  const summary = await usageSummary(store, user, anonymousKey);
  if (process.env.NODE_ENV === "test") {
    return summary;
  }
  if (summary.remaining <= 0) {
    const label = summary.plan === "free" ? "Free" : "Pro";
    const reset = summary.period === "day" ? "tomorrow" : "next month";
    const error = new Error(`${label} recognition limit reached. Try again ${reset} or upgrade for more.`);
    (error as Error & { status?: number; usage?: UsageSummary }).status = 429;
    (error as Error & { status?: number; usage?: UsageSummary }).usage = summary;
    throw error;
  }
  return summary;
}
