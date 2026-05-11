import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("identify API", () => {
  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  it("identifies using a mocked transcription and deletes uploaded audio", async () => {
    const tmpFile = path.join(os.tmpdir(), `recitation-${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, "fake audio");

    const app = createApp(async () => "قل هو الله احد");
    const response = await request(app).post("/api/identify").attach("audio", tmpFile, {
      filename: "recitation.webm",
      contentType: "audio/webm"
    });

    fs.unlinkSync(tmpFile);

    expect(response.status).toBe(200);
    expect(response.body.transcript).toBe("قل هو الله احد");
    expect(response.body.matches[0].surahNumber).toBe(112);
    expect(response.body.matches[0].ayahStart).toBe(1);
  });

  it("rejects requests without audio", async () => {
    const app = createApp(async () => "", async () => "");
    const response = await request(app).post("/api/identify");
    expect(response.status).toBe(400);
  });

  it("accepts the local whisper recognition mode", async () => {
    const tmpFile = path.join(os.tmpdir(), `recitation-${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, "fake audio");

    const app = createApp(async () => "");
    const response = await request(app)
      .post("/api/identify")
      .field("recognitionMode", "local_whisper")
      .attach("audio", tmpFile, {
        filename: "recitation.webm",
        contentType: "audio/webm"
      });

    fs.unlinkSync(tmpFile);

    expect(response.status).toBe(200);
    expect(response.body.recognitionMode).toBe("local_whisper");
    expect(response.body.diagnostics.transcription.tokenCount).toBe(0);
  });

  it("evaluates a targeted tajweed practice recording", async () => {
    const tmpFile = path.join(os.tmpdir(), `tajweed-${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, "fake audio");

    const app = createApp(async () => "\u0642\u0644 \u0647\u0648 \u0627\u0644\u0644\u0647 \u0627\u062d\u062f");
    const response = await request(app)
      .post("/api/tajweed/evaluate")
      .field("surahNumber", "112")
      .field("ayahStart", "1")
      .field("ayahEnd", "1")
      .attach("audio", tmpFile, {
        filename: "tajweed.webm",
        contentType: "audio/webm"
      });

    fs.unlinkSync(tmpFile);

    expect(response.status).toBe(200);
    expect(response.body.surahNumber).toBe(112);
    expect(response.body.ayahStart).toBe(1);
    expect(response.body.score).toBeGreaterThanOrEqual(80);
    expect(response.body.infographicSvg).toContain("<svg");
    expect(response.body.words.length).toBeGreaterThan(0);
  });

  it("identifies from a typed transcript", async () => {
    const app = createApp(async () => "");
    const response = await request(app).post("/api/identify-text").send({
      transcript: "الله الصمد"
    });

    expect(response.status).toBe(200);
    expect(response.body.matches[0].surahNumber).toBe(112);
    expect(response.body.matches[0].ayahStart).toBe(2);
  });

  it("limits typed transcript matching to selected surahs", async () => {
    const app = createApp(async () => "");
    const response = await request(app).post("/api/identify-text").send({
      transcript: "الله الصمد",
      surahNumbers: [1]
    });

    expect(response.status).toBe(200);
    expect(response.body.matches.every((match: { surahNumber: number }) => match.surahNumber === 1)).toBe(true);
  });

  it("returns the surah list", async () => {
    const app = createApp(async () => "");
    const response = await request(app).get("/api/surahs");

    expect(response.status).toBe(200);
    expect(response.body.surahs.length).toBeGreaterThan(0);
    expect(response.body.surahs[0]).toEqual({ number: 1, name: "Al-Fatihah" });
  });

  it("creates an account, returns a session, and opens the dashboard", async () => {
    const app = createApp(async () => "");
    const email = `test-${Date.now()}@example.com`;
    const signup = await request(app).post("/api/auth/signup").send({
      email,
      password: "password123"
    });

    expect(signup.status).toBe(200);
    expect(signup.body.user.email).toBe(email);
    expect(signup.body.token).toBeTruthy();

    const dashboard = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${signup.body.token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.usage.plan).toBe("free");
  });

  it("marks configured admin emails and gives unlimited usage", async () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    const app = createApp(async () => "");
    const signup = await request(app).post("/api/auth/signup").send({
      email: "owner@example.com",
      password: "password123"
    });

    expect(signup.status).toBe(200);
    expect(signup.body.user.isAdmin).toBe(true);
    expect(signup.body.usage.isUnlimited).toBe(true);

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${signup.body.token}`);
    expect(me.body.user.isAdmin).toBe(true);
    expect(me.body.usage.remaining).toBe(999999);
  });

  it("requires sign-in before starting checkout", async () => {
    const app = createApp(async () => "");
    const response = await request(app).post("/api/billing/checkout").send({ interval: "month" });
    expect(response.status).toBe(401);
  });
});
