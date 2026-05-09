import fs from "node:fs";
import OpenAI from "openai";

export type Transcriber = (filePath: string) => Promise<string>;

type DeepSeekChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const deepSeekUnsupportedMessage =
  "DeepSeek is configured, but DeepSeek's public API does not currently expose an audio transcription endpoint. Configure TRANSCRIPTION_PROVIDER=mock for local matching tests, or add a dedicated speech-to-text provider before live audio identification.";

function createOpenAITranscriber(): Transcriber {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";

  return async (filePath: string) => {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when TRANSCRIPTION_PROVIDER=openai.");
    }

    const openai = new OpenAI({ apiKey });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model,
      language: "ar",
      temperature: 0,
      chunking_strategy: "auto",
      prompt:
        "This is Arabic Quran recitation. Return only the heard Quranic Arabic text, without translation, commentary, timestamps, punctuation, or verse numbers."
    });

    return transcription.text || "";
  };
}

async function callDeepSeek(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required.");
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as DeepSeekChatResponse;
  return payload.choices?.[0]?.message?.content?.trim() || "";
}

export async function refineArabicTranscriptWithDeepSeek(transcript: string): Promise<string> {
  if (process.env.DEEPSEEK_REFINE_TRANSCRIPTS !== "true" || !process.env.DEEPSEEK_API_KEY || transcript.trim().length === 0) {
    return transcript;
  }

  try {
    const refined = await callDeepSeek([
      {
        role: "system",
        content:
          "Return only corrected Arabic Quran recitation text. Preserve Quran wording. Do not explain, translate, add ayah numbers, or add punctuation."
      },
      {
        role: "user",
        content: transcript
      }
    ]);

    return refined || transcript;
  } catch {
    return transcript;
  }
}

export function createConfiguredTranscriber(): Transcriber {
  const provider = process.env.TRANSCRIPTION_PROVIDER || "openai";

  if (provider === "openai") {
    return createOpenAITranscriber();
  }

  if (provider === "mock") {
    return async () => {
      const transcript = process.env.MOCK_TRANSCRIPT;
      if (!transcript) {
        throw new Error("MOCK_TRANSCRIPT is required when TRANSCRIPTION_PROVIDER=mock.");
      }
      return refineArabicTranscriptWithDeepSeek(transcript);
    };
  }

  if (provider === "deepseek") {
    return async () => {
      throw new Error(deepSeekUnsupportedMessage);
    };
  }

  return async () => {
    throw new Error(`Unsupported TRANSCRIPTION_PROVIDER '${provider}'.`);
  };
}
