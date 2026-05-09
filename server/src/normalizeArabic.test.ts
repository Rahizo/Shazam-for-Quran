import { describe, expect, it } from "vitest";
import { normalizeArabic, tokenizeArabic } from "./normalizeArabic";

describe("normalizeArabic", () => {
  it("removes diacritics, Quran marks, punctuation, and normalizes letters", () => {
    expect(normalizeArabic("\u0625\u0650\u0646\u0651\u064E\u0627 \u0623\u064E\u0639\u0652\u0637\u064E\u064A\u0652\u0646\u064E\u0627\u0643\u064E \u0627\u0644\u0652\u0643\u064E\u0648\u0652\u062B\u064E\u0631\u064E \u06DD")).toBe(
      "\u0627\u0646\u0627 \u0627\u0639\u0637\u064A\u0646\u0627\u0643 \u0627\u0644\u0643\u0648\u062B\u0631"
    );
    expect(normalizeArabic("\u0671\u0644\u0644\u0651\u064E\u0647\u064F \u0627\u0644\u0635\u0651\u064E\u0645\u064E\u062F\u064F")).toBe("\u0627\u0644\u0644\u0647 \u0627\u0644\u0635\u0645\u062F");
    expect(normalizeArabic("\u0631\u064E\u062D\u0652\u0645\u064E\u0629\u064C\u060C \u0647\u064F\u062F\u064B\u0649")).toBe("\u0631\u062D\u0645\u0647 \u0647\u062F\u064A");
  });

  it("tokenizes normalized Arabic words", () => {
    expect(tokenizeArabic("\u0642\u064F\u0644\u0652 \u0647\u064F\u0648\u064E \u0627\u0644\u0644\u0651\u064E\u0647\u064F \u0623\u064E\u062D\u064E\u062F\u064C")).toEqual([
      "\u0642\u0644",
      "\u0647\u0648",
      "\u0627\u0644\u0644\u0647",
      "\u0627\u062D\u062F"
    ]);
  });
});
