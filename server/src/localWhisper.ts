import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { preprocessForSpeech } from "./audioPreprocess";

function pythonCommand() {
  return process.env.PYTHON || "python";
}

export async function transcribeWithLocalWhisper(filePath: string): Promise<string> {
  const wavPath = await preprocessForSpeech(filePath, "local-whisper");
  const scriptPath = path.join(process.cwd(), "server", "scripts", "local_whisper.py");
  const model = process.env.LOCAL_WHISPER_MODEL || "small";
  const cacheDir = path.join(process.cwd(), "server", "model-cache", "faster-whisper");

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(pythonCommand(), [scriptPath, "--audio", wavPath, "--model", model, "--cache-dir", cacheDir], {
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8"
        }
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", reject);
      child.on("close", (code: number | null) => {
        const output = Buffer.concat(stdout).toString("utf8").trim();
        const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          reject(new Error(errorOutput || `Local Whisper exited with code ${code}`));
          return;
        }

        try {
          const parsed = JSON.parse(output) as { text?: string; error?: string };
          if (parsed.error) {
            reject(new Error(parsed.error));
            return;
          }
          resolve(parsed.text || "");
        } catch {
          reject(new Error(output || "Local Whisper returned no transcript."));
        }
      });
    });
  } finally {
    await fs.unlink(wavPath).catch(() => undefined);
  }
}
