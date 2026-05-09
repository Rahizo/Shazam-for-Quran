import crypto from "node:crypto";
import { Request, Response } from "express";
import { PublicUser, StoredUser } from "./saasTypes";

const cookieName = "qrs_session";

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function authSecret(): string {
  return process.env.AUTH_SECRET || process.env.OPENAI_API_KEY || "dev-only-change-me";
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus || null,
    createdAt: user.createdAt
  };
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [, salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const candidate = hashPassword(password, salt).split(":")[2];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

export function createSessionToken(user: StoredUser): string {
  const payload = base64Url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      plan: user.plan,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    })
  );
  const signature = crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token?: string): { userId: string } | null {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
  if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return { userId: parsed.sub };
}

export function readSessionToken(request: Request): string | undefined {
  const authHeader = request.header("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length);
  }

  const cookieHeader = request.header("cookie") || "";
  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`));

  return cookie ? decodeURIComponent(cookie.slice(cookieName.length + 1)) : undefined;
}

export function setSessionCookie(response: Response, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`);
}

export function clearSessionCookie(response: Response) {
  response.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
