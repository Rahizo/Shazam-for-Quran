import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export async function preprocessForSpeech(inputPath: string, suffix = "speech"): Promise<string> {
  const ffmpegBinary = ffmpegPath;
  if (typeof ffmpegBinary !== "string") {
    throw new Error("ffmpeg-static could not provide an ffmpeg binary.");
  }

  const outputPath = `${inputPath}.${suffix}.wav`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBinary, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-af",
      "silenceremove=start_periods=1:start_duration=0.25:start_threshold=-45dB,highpass=f=90,lowpass=f=5200,afftdn=nf=-25,loudnorm=I=-18:LRA=11:TP=-1.5",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-y",
      outputPath
    ]);
    const errors: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(Buffer.concat(errors).toString("utf8") || `ffmpeg exited with code ${code}`));
      }
    });
  });

  return outputPath;
}
