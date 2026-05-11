import { normalizeArabic, tokenizeArabic } from "./normalizeArabic";
import { TajweedWordFeedback } from "./saasTypes";
import { QuranVerse } from "./types";

type AlignmentStep = {
  expected?: string;
  expectedToken?: string;
  heard?: string;
  heardToken?: string;
  status: TajweedWordFeedback["status"];
  similarity: number;
};

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
  infographicSvg: string;
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
    .map((word) => word.replace(/^[^\p{Script=Arabic}]+|[^\p{Script=Arabic}\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]+$/gu, ""))
    .filter(Boolean);
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
  const relaxedA = a.replace(/\u0627/g, "");
  const relaxedB = b.replace(/\u0627/g, "");
  if (relaxedA.length >= 2 && relaxedA === relaxedB) {
    return 1;
  }
  const distance = editDistance(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length));
}

function alignWords(expectedWords: string[], heardWords: string[]): AlignmentStep[] {
  const expectedTokens = expectedWords.map(normalizeArabic);
  const heardTokens = heardWords.map(normalizeArabic);
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
        heard: heardWords[j - 1],
        heardToken: heardTokens[j - 1],
        status: similarity >= 0.92 ? "correct" : similarity >= 0.68 ? "close" : "changed",
        similarity
      });
      i -= 1;
      j -= 1;
    } else if (move === "insert" || i === 0) {
      steps.push({
        heard: heardWords[j - 1],
        heardToken: heardTokens[j - 1],
        status: "extra",
        similarity: 0
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

function feedbackNote(step: AlignmentStep) {
  if (step.status === "correct") {
    return "Matched clearly.";
  }
  if (step.status === "close") {
    return "Close, but review the pronunciation carefully.";
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

export function evaluateTajweedTranscript(transcript: string, verses: QuranVerse[]): TajweedEvaluation {
  if (verses.length === 0) {
    throw new Error("Target ayah range was not found.");
  }

  const expectedText = verses.map((verse) => verse.arabicText).join(" ");
  const expectedWords = originalArabicWords(expectedText);
  const heardWords = tokenizeArabic(transcript);
  const alignment = alignWords(expectedWords, heardWords);
  const words: TajweedWordFeedback[] = alignment.map((step, index) => ({
    position: index + 1,
    expected: step.expected,
    heard: step.heard,
    status: step.status,
    note: feedbackNote(step)
  }));
  const score = scoreAlignment(alignment, expectedWords.length);
  const advice = buildAdvice(words, score, heardWords.length, expectedWords.length);
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
    infographicSvg: buildInfographicSvg({ surahName: first.surahName, ayahStart, ayahEnd, score, words, advice })
  };
}
