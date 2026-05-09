import { describe, expect, it } from "vitest";
import { compareFingerprints, fingerprintSamples } from "./audioFingerprint";

describe("audio fingerprint comparison", () => {
  it("scores identical fingerprints higher than unrelated fingerprints", () => {
    const a = Array.from({ length: 20 }, () => [1, 0, 0]);
    const b = Array.from({ length: 20 }, () => [0, 1, 0]);

    expect(compareFingerprints(a, a)).toBeGreaterThan(0.9);
    expect(compareFingerprints(a, b)).toBeLessThan(0.2);
  });

  it("extracts frame fingerprints from non-silent samples", () => {
    const samples = new Float32Array(16000);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / 8000) * 0.4;
    }

    expect(fingerprintSamples(samples).length).toBeGreaterThan(0);
  });
});
