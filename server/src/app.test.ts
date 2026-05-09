import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("identify API", () => {
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
});
