import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CorrectionInput, MemorizationItem, MemorizationStatus, PlanId, RecognitionHistoryItem, StoredUser } from "./saasTypes";
import { IdentifyResponse, MatchCandidate } from "./types";

type StoreData = {
  users: StoredUser[];
  usageEvents: Array<{ id: string; userId?: string; anonymousKey?: string; kind: string; createdAt: string }>;
  history: RecognitionHistoryItem[];
  memorization: MemorizationItem[];
  corrections: Array<CorrectionInput & { id: string; createdAt: string }>;
};

export type AppStore = {
  createUser(email: string, passwordHash: string): Promise<StoredUser>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;
  findUserByStripeCustomerId(stripeCustomerId: string): Promise<StoredUser | null>;
  updateUserBilling(userId: string, updates: Partial<Pick<StoredUser, "plan" | "stripeCustomerId" | "stripeSubscriptionId" | "subscriptionStatus">>): Promise<StoredUser>;
  countUsage(input: { userId?: string; anonymousKey?: string; since: Date }): Promise<number>;
  recordUsage(input: { userId?: string; anonymousKey?: string; kind: string }): Promise<void>;
  saveRecognition(userId: string, response: IdentifyResponse): Promise<RecognitionHistoryItem>;
  listRecognitionHistory(userId: string, limit?: number): Promise<RecognitionHistoryItem[]>;
  addMemorizationItem(userId: string, input: Omit<MemorizationItem, "id" | "createdAt" | "updatedAt">): Promise<MemorizationItem>;
  listMemorizationItems(userId: string): Promise<MemorizationItem[]>;
  updateMemorizationItem(userId: string, id: string, status: MemorizationStatus): Promise<MemorizationItem | null>;
  saveCorrection(input: CorrectionInput): Promise<void>;
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizePlan(plan?: string | null): PlanId {
  return plan === "pro_monthly" || plan === "pro_yearly" ? plan : "free";
}

class JsonStore implements AppStore {
  private filePath = path.join(process.cwd(), "server", "data", "app-store.json");

  private async read(): Promise<StoreData> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as StoreData;
    } catch {
      return { users: [], usageEvents: [], history: [], memorization: [], corrections: [] };
    }
  }

  private async write(data: StoreData) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async createUser(email: string, passwordHash: string) {
    const data = await this.read();
    if (data.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
      throw new Error("An account with this email already exists.");
    }
    const user: StoredUser = {
      id: id("user"),
      email: email.toLowerCase(),
      passwordHash,
      plan: "free",
      createdAt: nowIso()
    };
    data.users.push(user);
    await this.write(data);
    return user;
  }

  async findUserByEmail(email: string) {
    const data = await this.read();
    return data.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null;
  }

  async findUserById(userId: string) {
    const data = await this.read();
    return data.users.find((user) => user.id === userId) || null;
  }

  async findUserByStripeCustomerId(stripeCustomerId: string) {
    const data = await this.read();
    return data.users.find((user) => user.stripeCustomerId === stripeCustomerId) || null;
  }

  async updateUserBilling(userId: string, updates: Partial<Pick<StoredUser, "plan" | "stripeCustomerId" | "stripeSubscriptionId" | "subscriptionStatus">>) {
    const data = await this.read();
    const user = data.users.find((item) => item.id === userId);
    if (!user) {
      throw new Error("User not found.");
    }
    Object.assign(user, updates, { plan: normalizePlan(updates.plan || user.plan) });
    await this.write(data);
    return user;
  }

  async countUsage(input: { userId?: string; anonymousKey?: string; since: Date }) {
    const data = await this.read();
    return data.usageEvents.filter((event) => {
      const ownerMatches = input.userId ? event.userId === input.userId : event.anonymousKey === input.anonymousKey;
      return ownerMatches && event.kind === "recognition" && new Date(event.createdAt) >= input.since;
    }).length;
  }

  async recordUsage(input: { userId?: string; anonymousKey?: string; kind: string }) {
    const data = await this.read();
    data.usageEvents.push({ id: id("usage"), createdAt: nowIso(), ...input });
    await this.write(data);
  }

  async saveRecognition(userId: string, response: IdentifyResponse) {
    const data = await this.read();
    const item: RecognitionHistoryItem = {
      id: id("history"),
      transcript: response.transcript,
      recognitionMode: response.recognitionMode,
      lowConfidence: response.lowConfidence,
      matches: response.matches,
      createdAt: nowIso()
    };
    data.history.push({ ...item, id: `${userId}:${item.id}` });
    await this.write(data);
    return item;
  }

  async listRecognitionHistory(userId: string, limit = 10) {
    const data = await this.read();
    return data.history
      .filter((item) => item.id.startsWith(`${userId}:`))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((item) => ({ ...item, id: item.id.split(":").slice(1).join(":") }));
  }

  async addMemorizationItem(userId: string, input: Omit<MemorizationItem, "id" | "createdAt" | "updatedAt">) {
    const data = await this.read();
    const item: MemorizationItem = { ...input, id: id("memo"), createdAt: nowIso(), updatedAt: nowIso() };
    data.memorization.push({ ...item, id: `${userId}:${item.id}` });
    await this.write(data);
    return item;
  }

  async listMemorizationItems(userId: string) {
    const data = await this.read();
    return data.memorization
      .filter((item) => item.id.startsWith(`${userId}:`))
      .map((item) => ({ ...item, id: item.id.split(":").slice(1).join(":") }));
  }

  async updateMemorizationItem(userId: string, itemId: string, status: MemorizationStatus) {
    const data = await this.read();
    const item = data.memorization.find((candidate) => candidate.id === `${userId}:${itemId}`);
    if (!item) {
      return null;
    }
    item.status = status;
    item.lastReviewedAt = nowIso();
    item.updatedAt = nowIso();
    await this.write(data);
    return { ...item, id: itemId };
  }

  async saveCorrection(input: CorrectionInput) {
    const data = await this.read();
    data.corrections.push({ ...input, id: id("correction"), createdAt: nowIso() });
    await this.write(data);
  }
}

class PrismaStore implements AppStore {
  constructor(private prisma: PrismaClient) {}

  private mapUser(user: Awaited<ReturnType<PrismaClient["user"]["findUnique"]>>): StoredUser | null {
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      plan: normalizePlan(user.plan),
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      subscriptionStatus: user.subscriptionStatus,
      createdAt: user.createdAt.toISOString()
    };
  }

  async createUser(email: string, passwordHash: string) {
    const user = await this.prisma.user.create({ data: { email: email.toLowerCase(), passwordHash } });
    return this.mapUser(user)!;
  }

  async findUserByEmail(email: string) {
    return this.mapUser(await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } }));
  }

  async findUserById(id: string) {
    return this.mapUser(await this.prisma.user.findUnique({ where: { id } }));
  }

  async findUserByStripeCustomerId(stripeCustomerId: string) {
    return this.mapUser(await this.prisma.user.findUnique({ where: { stripeCustomerId } }));
  }

  async updateUserBilling(userId: string, updates: Partial<Pick<StoredUser, "plan" | "stripeCustomerId" | "stripeSubscriptionId" | "subscriptionStatus">>) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: updates });
    return this.mapUser(user)!;
  }

  async countUsage(input: { userId?: string; anonymousKey?: string; since: Date }) {
    return this.prisma.usageEvent.count({
      where: {
        kind: "recognition",
        createdAt: { gte: input.since },
        userId: input.userId,
        anonymousKey: input.userId ? undefined : input.anonymousKey
      }
    });
  }

  async recordUsage(input: { userId?: string; anonymousKey?: string; kind: string }) {
    await this.prisma.usageEvent.create({ data: input });
  }

  async saveRecognition(userId: string, response: IdentifyResponse) {
    const item = await this.prisma.recognitionHistory.create({
      data: {
        userId,
        transcript: response.transcript,
        recognitionMode: response.recognitionMode,
        lowConfidence: response.lowConfidence,
        matchesJson: response.matches
      }
    });
    return {
      id: item.id,
      transcript: item.transcript,
      recognitionMode: item.recognitionMode as IdentifyResponse["recognitionMode"],
      lowConfidence: item.lowConfidence,
      matches: item.matchesJson as MatchCandidate[],
      createdAt: item.createdAt.toISOString()
    };
  }

  async listRecognitionHistory(userId: string, limit = 10) {
    const items = await this.prisma.recognitionHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
    return items.map((item) => ({
      id: item.id,
      transcript: item.transcript,
      recognitionMode: item.recognitionMode as IdentifyResponse["recognitionMode"],
      lowConfidence: item.lowConfidence,
      matches: item.matchesJson as MatchCandidate[],
      createdAt: item.createdAt.toISOString()
    }));
  }

  async addMemorizationItem(userId: string, input: Omit<MemorizationItem, "id" | "createdAt" | "updatedAt">) {
    const item = await this.prisma.memorizationItem.create({ data: { ...input, userId } });
    return {
      ...item,
      status: item.status as MemorizationStatus,
      lastReviewedAt: item.lastReviewedAt?.toISOString() || null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  async listMemorizationItems(userId: string) {
    const items = await this.prisma.memorizationItem.findMany({ where: { userId }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
    return items.map((item) => ({
      ...item,
      status: item.status as MemorizationStatus,
      lastReviewedAt: item.lastReviewedAt?.toISOString() || null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    }));
  }

  async updateMemorizationItem(userId: string, id: string, status: MemorizationStatus) {
    const item = await this.prisma.memorizationItem
      .update({ where: { id, userId }, data: { status, lastReviewedAt: new Date() } })
      .catch(() => null);
    return item
      ? {
          ...item,
          status: item.status as MemorizationStatus,
          lastReviewedAt: item.lastReviewedAt?.toISOString() || null,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString()
        }
      : null;
  }

  async saveCorrection(input: CorrectionInput) {
    await this.prisma.correction.create({
      data: {
        userId: input.userId,
        anonymousKey: input.anonymousKey,
        transcript: input.transcript,
        verdict: input.verdict,
        actualJson: input.actual,
        expectedSurahNumber: input.expectedSurahNumber,
        expectedAyahStart: input.expectedAyahStart,
        expectedAyahEnd: input.expectedAyahEnd
      }
    });
  }
}

let store: AppStore | undefined;

export function getStore(): AppStore {
  if (!store) {
    store = process.env.DATABASE_URL ? new PrismaStore(new PrismaClient()) : new JsonStore();
  }
  return store;
}
