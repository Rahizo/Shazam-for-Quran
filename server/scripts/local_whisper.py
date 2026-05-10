import argparse
import json
import os
import sys

from faster_whisper import WhisperModel

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--cache-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)

    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        download_root=args.cache_dir,
    )
    segments, _info = model.transcribe(
        args.audio,
        language="ar",
        task="transcribe",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt="This is Arabic Quran recitation. Transcribe only the heard Quranic Arabic text.",
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    print(json.dumps({"text": text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
