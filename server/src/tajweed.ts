import { normalizeArabic, tokenizeArabic } from "./normalizeArabic";
import { TajweedWordFeedback } from "./saasTypes";
import { QuranVerse } from "./types";

const nonPronouncedQuranMarks = /[\u06D6-\u06ED\u06DD\u06DE\u06E9]/g;
const muqattaatLetters: Record<string, string> = {
  "\u0627\u0644\u0641": "\u0627",
  "\u0644\u0627\u0645": "\u0644",
  "\u0645\u064A\u0645": "\u0645",
  "\u0635\u0627\u062F": "\u0635",
  "\u0631\u0627": "\u0631",
  "\u0643\u0627\u0641": "\u0643",
  "\u0647\u0627": "\u0647",
  "\u064A\u0627": "\u064A",
  "\u0639\u064A\u0646": "\u0639",
  "\u0637\u0627": "\u0637",
  "\u0633\u064A\u0646": "\u0633",
  "\u062D\u0627": "\u062D",
  "\u0642\u0627\u0641": "\u0642",
  "\u0646\u0648\u0646": "\u0646"
};
const knownMuqattaat = new Set([
  "\u0627\u0644\u0645",
  "\u0627\u0644\u0645\u0635",
  "\u0627\u0644\u0631",
  "\u0627\u0644\u0645\u0631",
  "\u0643\u0647\u064A\u0639\u0635",
  "\u0637\u0647",
  "\u0637\u0633\u0645",
  "\u0637\u0633",
  "\u064A\u0633",
  "\u0635",
  "\u062D\u0645",
  "\u0639\u0633\u0642",
  "\u0642",
  "\u0646"
]);
const muqattaatPronunciations = new Map(
  [...knownMuqattaat].map((letters) => {
    const spoken = [...letters]
      .map((letter) => Object.entries(muqattaatLetters).find(([, value]) => value === letter)?.[0] || letter)
      .join("");
    return [letters, spoken];
  })
);

type AlignmentStep = {
  expected?: string;
  expectedToken?: string;
  heard?: string;
  heardToken?: string;
  status: TajweedWordFeedback["status"];
  similarity: number;
  start?: number;
  end?: number;
};

export type TajweedTimedWord = { word: string; start: number; end: number };

export type TajweedEvaluation = {
  transcript: string;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  score: number;
  summary: string;
  words: TajweedWordFeedback[];
  advice: string[];
  ruleSummary: Array<{ rule: string; count: number }>;
  infographicSvg: string;
};

type TajweedRule = {
  name: string;
  improvement: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function originalArabicWords(text: string) {
  return text
    .replace(/([\u0640\u0670])\s+(?=\p{Script=Arabic})/gu, "$1")
    .replace(/(\p{Script=Arabic})\s+(\u0670)/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) =>
      word
        .replace(nonPronouncedQuranMarks, "")
        .replace(/^[^\p{Script=Arabic}]+|[^\p{Script=Arabic}\u0610-\u061A\u064B-\u065F\u0670\u0640]+$/gu, "")
    )
    .filter((word) => word.length > 0 && normalizeArabic(word).length > 0);
}

function uniqueRules(rules: TajweedRule[]) {
  const seen = new Set<string>();
  return rules.filter((rule) => {
    if (seen.has(rule.name)) {
      return false;
    }
    seen.add(rule.name);
    return true;
  });
}

function tajweedRulesForWord(word: string, nextWord?: string): TajweedRule[] {
  const rules: TajweedRule[] = [];
  const plain = normalizeArabic(word);
  const nextPlain = normalizeArabic(nextWord || "");
  const joinedPlain = `${plain} ${nextPlain}`;
  const hasTanween = /[\u064B-\u064D]/.test(word);
  const hasNoonSakinah = /\u0646\u0652/.test(word);
  const nextFirst = nextPlain[0] || "";
  const ikhfaLetters = new Set("تثجدذزسشصضطظفقك");
  const idghamLetters = new Set("يرملون");

  if (/[\u0670]|\u064E[\u0627\u0649]|\u064F\u0648|\u0650\u064A/.test(word)) {
    rules.push({ name: "Madd", improvement: "Hold the long vowel for its proper count; do not clip it short." });
  }
  if (/[\u0646\u0645]\u0651/.test(word)) {
    rules.push({ name: "Ghunnah", improvement: "Keep the nasal sound smooth and held for about two counts." });
  }
  if (/[قطبجد]\u0652/.test(word) || /[قطبجد][\u064B-\u0652]*$/.test(word)) {
    rules.push({ name: "Qalqalah", improvement: "Give the qalqalah letter a light echo without adding a vowel." });
  }
  if (/ٱ?ل[\u0652]?[تثدذرزسشصضطظلن]\u0651/.test(word)) {
    rules.push({ name: "Lam Shamsiyyah", improvement: "Do not pronounce the lam; merge into the shaddah sun letter." });
  }
  if (/الله|اللهم/.test(plain)) {
    rules.push({ name: "Heavy Lam", improvement: "Pronounce the lam of Allah heavy after fatḥah or ḍammah." });
  }
  if (/[خصضغطظق]/.test(plain)) {
    rules.push({ name: "Tafkheem", improvement: "Keep heavy letters full and elevated without flattening them." });
  }
  if ((hasNoonSakinah || hasTanween) && nextFirst === "ب") {
    rules.push({ name: "Iqlab", improvement: "Convert the noon/tanween sound toward meem with nasalization before ba." });
  } else if ((hasNoonSakinah || hasTanween) && idghamLetters.has(nextFirst)) {
    rules.push({ name: "Idgham", improvement: "Merge noon/tanween into the next letter according to the idgham type." });
  } else if ((hasNoonSakinah || hasTanween) && ikhfaLetters.has(nextFirst)) {
    rules.push({ name: "Ikhfa", improvement: "Hide the noon/tanween softly with nasalization before the next letter." });
  }
  if (/م\u0652/.test(word) && nextFirst === "ب") {
    rules.push({ name: "Ikhfa Shafawi", improvement: "Hide the meem before ba with a gentle nasal sound." });
  }
  if (/م\u0652/.test(word) && nextFirst === "م") {
    rules.push({ name: "Idgham Shafawi", improvement: "Merge the meem into the next meem with ghunnah." });
  }
  if (/ء|أ|إ|ؤ|ئ/.test(word) || joinedPlain.includes("ا ا")) {
    rules.push({ name: "Hamzah clarity", improvement: "Make the hamzah clean and distinct without swallowing it." });
  }

  return uniqueRules(rules);
}

function summarizeRules(words: TajweedWordFeedback[]) {
  const counts = new Map<string, number>();
  for (const word of words) {
    for (const rule of word.rules || []) {
      counts.set(rule, (counts.get(rule) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule, count]) => ({ rule, count }));
}

function timingHint(step: AlignmentStep, rules: TajweedRule[]) {
  if (step.start === undefined || step.end === undefined || step.status === "missing" || step.status === "extra") {
    return undefined;
  }
  const duration = Math.max(0, step.end - step.start);
  const ruleNames = new Set(rules.map((rule) => rule.name));
  if (ruleNames.has("Madd") && duration > 0 && duration < 0.45) {
    return `Heard in ${duration.toFixed(2)}s. If this is a madd position, do not rush the long vowel.`;
  }
  if (ruleNames.has("Ghunnah") && duration > 0 && duration < 0.55) {
    return `Heard in ${duration.toFixed(2)}s. Leave enough time for the nasal ghunnah.`;
  }
  if ((ruleNames.has("Qalqalah") || ruleNames.has("Hamzah clarity")) && duration > 1.8) {
    return `Heard in ${duration.toFixed(2)}s. Keep the consonant crisp without stretching it into an added vowel.`;
  }
  return duration > 0 ? `Audio timing: ${duration.toFixed(2)}s.` : undefined;
}

function editDistance(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function tokenSimilarity(a = "", b = "") {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const aliases: Record<string, string[]> = {
    "\u0627\u0644\u0645": ["\u0627\u0633\u0644\u0627\u0645", "\u0627\u0644\u0641\u0644\u0627\u0645\u0645\u064A\u0645", "\u0627\u0644\u0641\u0644\u0627\u0645\u064A\u0645", "\u0627\u0644\u0641\u0627\u0644\u0645"]
  };
  const pronouncedA = muqattaatPronunciations.get(a);
  const pronouncedB = muqattaatPronunciations.get(b);
  if (pronouncedA === b || pronouncedB === a) {
    return 1;
  }
  if (aliases[a]?.includes(b) || aliases[b]?.includes(a)) {
    return 1;
  }
  const relaxedA = a.replace(/\u0627/g, "");
  const relaxedB = b.replace(/\u0627/g, "");
  if (relaxedA.length >= 2 && relaxedA === relaxedB) {
    return 1;
  }
  const distance = editDistance(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

function combineHeardMuqattaat(items: TajweedTimedWord[]) {
  const words = items.map((item) => item.word);
  const combined: TajweedTimedWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const currentLetter = muqattaatLetters[words[index]];
    const nextWord = words[index + 1];
    if (currentLetter && nextWord && knownMuqattaat.has(nextWord) && nextWord.startsWith(currentLetter)) {
      continue;
    }

    let matched = false;
    for (let length = 5; length >= 1; length -= 1) {
      const slice = words.slice(index, index + length);
      if (slice.length !== length || slice.some((word) => !muqattaatLetters[word])) {
        continue;
      }
      const letters = slice.map((word) => muqattaatLetters[word]).join("");
      if (knownMuqattaat.has(letters)) {
        combined.push({ word: slice.join(""), start: items[index].start, end: items[index + length - 1].end });
        index += length - 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      combined.push(items[index]);
    }
  }
  return combined;
}

function alignWords(expectedWords: string[], heardItems: TajweedTimedWord[]): AlignmentStep[] {
  const expectedTokens = expectedWords.map(normalizeArabic);
  const combinedHeardItems = combineHeardMuqattaat(heardItems);
  const heardTokens = combinedHeardItems.map((item) => normalizeArabic(item.word));
  const rows = expectedTokens.length + 1;
  const cols = heardTokens.length + 1;
  const costs = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  const moves = Array.from({ length: rows }, () => Array<string>(cols).fill(""));

  for (let i = 1; i < rows; i += 1) {
    costs[i][0] = i;
    moves[i][0] = "delete";
  }
  for (let j = 1; j < cols; j += 1) {
    costs[0][j] = j * 0.75;
    moves[0][j] = "insert";
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const similarity = tokenSimilarity(expectedTokens[i - 1], heardTokens[j - 1]);
      const substitutionCost = similarity >= 0.92 ? 0 : similarity >= 0.68 ? 0.35 : 1;
      const choices = [
        { cost: costs[i - 1][j - 1] + substitutionCost, move: "substitute" },
        { cost: costs[i - 1][j] + 1, move: "delete" },
        { cost: costs[i][j - 1] + 0.75, move: "insert" }
      ].sort((a, b) => a.cost - b.cost);
      costs[i][j] = choices[0].cost;
      moves[i][j] = choices[0].move;
    }
  }

  const steps: AlignmentStep[] = [];
  let i = expectedTokens.length;
  let j = heardTokens.length;
  while (i > 0 || j > 0) {
    const move = moves[i][j];
    if (move === "substitute") {
      const similarity = tokenSimilarity(expectedTokens[i - 1], heardTokens[j - 1]);
      steps.push({
        expected: expectedWords[i - 1],
        expectedToken: expectedTokens[i - 1],
        heard: combinedHeardItems[j - 1].word,
        heardToken: heardTokens[j - 1],
        status: similarity >= 0.92 ? "correct" : similarity >= 0.68 ? "close" : "changed",
        similarity,
        start: combinedHeardItems[j - 1].start,
        end: combinedHeardItems[j - 1].end
      });
      i -= 1;
      j -= 1;
    } else if (move === "insert" || i === 0) {
      steps.push({
        heard: combinedHeardItems[j - 1].word,
        heardToken: heardTokens[j - 1],
        status: "extra",
        similarity: 0,
        start: combinedHeardItems[j - 1].start,
        end: combinedHeardItems[j - 1].end
      });
      j -= 1;
    } else {
      steps.push({
        expected: expectedWords[i - 1],
        expectedToken: expectedTokens[i - 1],
        status: "missing",
        similarity: 0
      });
      i -= 1;
    }
  }

  return steps.reverse();
}

function feedbackNote(step: AlignmentStep, rules: TajweedRule[]) {
  const ruleHint = rules.length > 0 ? ` Focus rule: ${rules.slice(0, 2).map((rule) => rule.name).join(", ")}.` : "";
  if (step.status === "correct") {
    return `Matched clearly.${ruleHint}`;
  }
  if (step.status === "close") {
    return `Close, but review the pronunciation carefully.${ruleHint}`;
  }
  if (step.status === "missing") {
    return "This word sounds missing from the recording.";
  }
  if (step.status === "extra") {
    return "Extra word heard outside the selected ayah text.";
  }
  return `Expected ${step.expected || ""}${step.heard ? `, heard ${step.heard}` : ""}.`;
}

function scoreAlignment(steps: AlignmentStep[], expectedCount: number) {
  if (expectedCount === 0) {
    return 0;
  }
  let points = 0;
  let extraPenalty = 0;
  for (const step of steps) {
    if (step.status === "correct") {
      points += 1;
    } else if (step.status === "close") {
      points += 0.7;
    } else if (step.status === "changed") {
      points += 0.2;
    } else if (step.status === "extra") {
      extraPenalty += 0.3;
    }
  }
  return Math.max(0, Math.min(100, Math.round(((points - extraPenalty) / expectedCount) * 100)));
}

function buildAdvice(words: TajweedWordFeedback[], score: number, transcriptTokenCount: number, expectedCount: number) {
  const missing = words.filter((word) => word.status === "missing").length;
  const changed = words.filter((word) => word.status === "changed").length;
  const close = words.filter((word) => word.status === "close").length;
  const extra = words.filter((word) => word.status === "extra").length;
  const advice: string[] = [];
  const ruleSummary = summarizeRules(words);

  if (score >= 90) {
    advice.push("Strong recitation. Repeat once more at the same pace to build consistency.");
  } else if (score >= 70) {
    advice.push("Good attempt. Slow down around the marked words and repeat this exact range.");
  } else {
    advice.push("Practice this range in smaller pieces, then record again when the words feel steady.");
  }
  if (transcriptTokenCount < Math.max(2, expectedCount * 0.45)) {
    advice.push("The app heard much less than expected. Move closer to the microphone and record at least 15 seconds.");
  }
  if (missing > 0) {
    advice.push(`${missing} expected word${missing === 1 ? "" : "s"} sounded missing. Focus on not skipping while transitioning between words.`);
  }
  if (changed > 0 || close > 0) {
    advice.push("Listen to the reference recitation for the highlighted words, then imitate only those words before reciting the full ayah.");
  }
  if (extra > 0) {
    advice.push("Extra words were heard. Make sure the selected surah and ayah range matches what you are reciting.");
  }
  if (ruleSummary.length > 0) {
    advice.push(`Main tajweed focus: ${ruleSummary.slice(0, 3).map((item) => item.rule).join(", ")}.`);
  }
  return advice.slice(0, 4);
}

function colorForStatus(status: TajweedWordFeedback["status"]) {
  if (status === "correct") {
    return { fill: "#dcfce7", stroke: "#86efac", text: "#14532d" };
  }
  if (status === "close") {
    return { fill: "#fef9c3", stroke: "#fde047", text: "#713f12" };
  }
  if (status === "changed") {
    return { fill: "#ffedd5", stroke: "#fb923c", text: "#7c2d12" };
  }
  if (status === "missing") {
    return { fill: "#fee2e2", stroke: "#f87171", text: "#7f1d1d" };
  }
  return { fill: "#e0e7ff", stroke: "#818cf8", text: "#312e81" };
}

function buildInfographicSvg(input: {
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  score: number;
  words: TajweedWordFeedback[];
  advice: string[];
}) {
  const width = 1120;
  const margin = 52;
  const rowHeight = 64;
  const extraWords = input.words.filter((word) => word.status === "extra");
  const ayahWords = input.words.filter((word) => word.status !== "extra");
  const rows: Array<TajweedWordFeedback[]> = [[]];
  let rowWidth = 0;
  for (const word of ayahWords) {
    const label = word.expected || word.heard || "";
    const estimated = Math.max(72, label.length * 18 + 34);
    if (rowWidth + estimated > width - margin * 2 && rows[rows.length - 1].length > 0) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1].push(word);
    rowWidth += estimated + 10;
  }

  const legendY = 130;
  const firstRowY = 210;
  const adviceY = firstRowY + rows.length * rowHeight + 34;
  const extraY = adviceY + input.advice.length * 30 + 18;
  const height = extraY + (extraWords.length > 0 ? 74 : 20);
  const range = input.ayahStart === input.ayahEnd ? String(input.ayahStart) : `${input.ayahStart}-${input.ayahEnd}`;
  const title = `${input.surahName} ${range}`;

  const legend = [
    ["Matched", "correct"],
    ["Close", "close"],
    ["Changed", "changed"],
    ["Missing", "missing"]
  ]
    .map(([label, status], index) => {
      const colors = colorForStatus(status as TajweedWordFeedback["status"]);
      const x = margin + index * 156;
      return `<rect x="${x}" y="${legendY}" width="24" height="24" rx="6" fill="${colors.fill}" stroke="${colors.stroke}" /><text x="${x + 34}" y="${legendY + 18}" font-size="18" fill="#17211f">${label}</text>`;
    })
    .join("");

  const wordMarkup = rows
    .map((row, rowIndex) => {
      let x = width - margin;
      const y = firstRowY + rowIndex * rowHeight;
      return row
        .map((word) => {
          const label = word.expected || word.heard || "";
          const boxWidth = Math.max(72, label.length * 18 + 34);
          x -= boxWidth;
          const colors = colorForStatus(word.status);
          const markup = `<rect x="${x}" y="${y}" width="${boxWidth}" height="46" rx="10" fill="${colors.fill}" stroke="${colors.stroke}" /><text x="${x + boxWidth - 18}" y="${y + 31}" direction="rtl" unicode-bidi="bidi-override" text-anchor="end" font-size="26" font-family="Arial, Tahoma, sans-serif" fill="${colors.text}">${escapeXml(label)}</text>`;
          x -= 10;
          return markup;
        })
        .join("");
    })
    .join("");

  const adviceMarkup = input.advice
    .map((line, index) => `<text x="${margin}" y="${adviceY + index * 30}" font-size="20" fill="#43524e">${escapeXml(line)}</text>`)
    .join("");
  const extraMarkup =
    extraWords.length > 0
      ? `<text x="${margin}" y="${extraY}" font-size="22" font-weight="700" fill="#312e81">Extra heard</text><text x="${width - margin}" y="${extraY + 36}" direction="rtl" unicode-bidi="bidi-override" text-anchor="end" font-size="24" font-family="Arial, Tahoma, sans-serif" fill="#312e81">${escapeXml(extraWords.map((word) => word.heard).filter(Boolean).join(" "))}</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fffdf8"/>
  <text x="${margin}" y="58" font-size="24" font-weight="800" fill="#0f766e">Tajweed Practice Report</text>
  <text x="${margin}" y="96" font-size="34" font-weight="900" fill="#17211f">${escapeXml(title)}</text>
  <circle cx="${width - 108}" cy="78" r="52" fill="#0f766e"/>
  <text x="${width - 108}" y="88" text-anchor="middle" font-size="30" font-weight="900" fill="#fff">${input.score}%</text>
  ${legend}
  ${wordMarkup}
  <text x="${margin}" y="${adviceY - 36}" font-size="24" font-weight="900" fill="#17211f">How to improve</text>
  ${adviceMarkup}
  ${extraMarkup}
</svg>`;
}

export function evaluateTajweedTranscript(transcript: string, verses: QuranVerse[], timedWords?: TajweedTimedWord[]): TajweedEvaluation {
  if (verses.length === 0) {
    throw new Error("Target ayah range was not found.");
  }

  const expectedText = verses.map((verse) => verse.arabicText).join(" ");
  const expectedWords = originalArabicWords(expectedText);
  const heardWords = timedWords?.length ? timedWords.map((item) => item.word) : tokenizeArabic(transcript);
  const heardItems = timedWords?.length
    ? timedWords.map((item) => ({ word: normalizeArabic(item.word), start: item.start, end: item.end })).filter((item) => item.word.length > 0)
    : heardWords.map((word) => ({ word, start: 0, end: 0 }));
  const alignment = alignWords(expectedWords, heardItems);
  const expectedRuleMap = new Map<string, TajweedRule[]>();
  expectedWords.forEach((word, index) => {
    expectedRuleMap.set(`${index + 1}:${word}`, tajweedRulesForWord(word, expectedWords[index + 1]));
  });
  let expectedPosition = 0;
  const words: TajweedWordFeedback[] = alignment.map((step, index) => {
    const currentExpectedPosition = step.expected ? (expectedPosition += 1) : 0;
    const rules = step.expected ? expectedRuleMap.get(`${currentExpectedPosition}:${step.expected}`) || [] : [];
    return {
      position: index + 1,
      expected: step.expected,
      heard: step.heard,
      status: step.status,
      note: feedbackNote(step, rules),
      rules: rules.map((rule) => rule.name),
      improvement: rules[0]?.improvement,
      start: step.start,
      end: step.end,
      timingNote: timingHint(step, rules)
    };
  });
  const score = scoreAlignment(alignment, expectedWords.length);
  const advice = buildAdvice(words, score, heardWords.length, expectedWords.length);
  const ruleSummary = summarizeRules(words);
  const first = verses[0];
  const last = verses[verses.length - 1];
  const ayahStart = first.ayahNumber;
  const ayahEnd = last.ayahNumber;
  const summary =
    score >= 90
      ? "Excellent word accuracy for the selected ayahs."
      : score >= 70
        ? "Good attempt with a few words to review."
        : "Several words need review before moving on.";

  return {
    transcript,
    surahNumber: first.surahNumber,
    surahName: first.surahName,
    ayahStart,
    ayahEnd,
    score,
    summary,
    words,
    advice,
    ruleSummary,
    infographicSvg: buildInfographicSvg({ surahName: first.surahName, ayahStart, ayahEnd, score, words, advice })
  };
}
