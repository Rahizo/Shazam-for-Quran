# Shazam For Quran

Expo + Express MVP for identifying likely Quran surah/ayah ranges from short recitation audio.

## Production Launch

This repo is configured for a SaaS-style website deploy with Docker. The production container builds the Expo web app, starts the Express API, and serves both from one domain.

Read the full launch checklist here:

- [Launch guide](docs/LAUNCH.md)
- [Privacy policy draft](docs/PRIVACY_POLICY_DRAFT.md)
- [Terms of service draft](docs/TERMS_OF_SERVICE_DRAFT.md)

Before public launch, rotate any API keys that were pasted into chat, screenshots, logs, or Git history.

## Run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`. Optionally set `DEEPSEEK_API_KEY` to let DeepSeek clean up typed or transcribed Arabic text before matching.
3. Download the Quran corpus:
   ```bash
   npm run download:quran
   ```
4. Start the backend:
   ```bash
   npm run server
   ```
5. Start the app:
   ```bash
   npm run web
   ```

The app runs on Expo web and iOS. The backend deletes uploaded recordings after each request.

## Production Check

Run this before deploying:

```bash
npm run predeploy:check
```

The Docker deployment uses:

```bash
SERVE_WEB_DIST=true
EXPO_PUBLIC_API_BASE_URL=
```

Leaving `EXPO_PUBLIC_API_BASE_URL` empty makes the website call `/api/*` on the same domain.

## SaaS Features

The web app now includes:

- Free account signup/login.
- Daily free recognition limits and higher Pro limits.
- Stripe Checkout hooks for monthly and annual Pro subscriptions.
- Saved recognition history for signed-in users.
- Memorization Coach with saved ayah ranges and weak-review tracking.
- Typed Arabic search.
- User correction feedback for future ranking improvements.
- Privacy, Terms, and Pricing sections.

Local development can run without a database by using a small ignored JSON store at `server/data/app-store.json`. Production should use Postgres with Prisma:

```bash
DATABASE_URL=postgresql://...
npm run db:generate
npm run db:push
```

Stripe requires these variables:

```bash
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_MONTHLY_PRICE_ID=
STRIPE_YEARLY_PRICE_ID=
APP_URL=https://your-domain.com
```

If Stripe is not configured, the Pricing page still renders, but checkout returns a setup error.

OpenAI is used for speech-to-text because DeepSeek's public API currently exposes chat/text completions, not audio transcription. DeepSeek remains available for Arabic transcript cleanup/refinement before matching. For local matcher testing without live audio transcription, set:

The backend preprocesses uploaded audio before transcription by trimming leading silence, reducing noise, normalizing volume, and converting to 16 kHz mono WAV. Set `PREPROCESS_TRANSCRIPTION_AUDIO=false` only if you need to debug the original upload path.

```bash
TRANSCRIPTION_PROVIDER=mock
MOCK_TRANSCRIPT=قل هو الله احد
```

Then `POST /api/identify` will use that mocked transcript, and `POST /api/identify-text` can identify directly from typed Arabic text.

## Audio Matching

The backend also includes a local audio fingerprint matcher. It decodes the user's recording with bundled ffmpeg, downloads/cache Quran reference recitations under `server/audio-cache/`, and compares acoustic fingerprints before combining those results with text matches. The default reference reciter is Mishary Rashid Alafasy via `AUDIO_REFERENCE_RECITER=Alafasy_128kbps`.

The UI has two recognition modes:

- `OpenAI Hybrid`: OpenAI transcribes the audio, text matching searches the full Quran, and local audio matching verifies likely candidates.
- `Local Whisper`: no OpenAI transcription is used. The backend runs Python `faster-whisper` (`LOCAL_WHISPER_MODEL`, default `medium`), matches the local transcript against Quran text, and uses EveryAyah audio fingerprints as a secondary signal.

Install the local Whisper dependency once:

```bash
python -m pip install faster-whisper
```

The first Local Whisper request downloads the model into `server/model-cache/`, so it can take a while. The `medium` model is slower than `small`, but much better for Quran recitation. For best accuracy and speed, record 15-30 seconds in a quiet room and select likely surahs in the UI before recording. The local reference audio comes from EveryAyah verse-level MP3 URLs such as `https://everyayah.com/data/Alafasy_128kbps/001001.mp3`.

The matcher is intentionally conservative: text matches below the confidence threshold and weak audio-only guesses are hidden instead of being presented as real answers.

## Local Whisper Testing

Local Whisper is enabled on `localhost` and disabled on the hosted Render website because Render Free is not strong enough to run it reliably.

To test it locally:

1. Install Python dependency once:
   ```bash
   python -m pip install faster-whisper
   ```
2. Make sure the Quran corpus exists:
   ```bash
   npm run download:quran
   ```
3. Start the backend:
   ```bash
   npm run server
   ```
4. Start the web app:
   ```bash
   npm run web
   ```
5. Open the local Expo URL, usually:
   ```text
   http://localhost:8081
   ```
6. Choose `Local Whisper`, record, and inspect the transcript/results.

You can also test a saved audio file directly from the terminal:

```bash
npm run test:local-whisper -- path/to/recitation.webm
```

To narrow matching to likely surahs:

```bash
npm run test:local-whisper -- path/to/recitation.webm --surahs=1,60
```

For faster iteration, set `LOCAL_WHISPER_MODEL=small` in `.env`. For better local accuracy, try `medium`, but the first run downloads a larger model and will be slower.

## Data Attribution

The intended production corpus is Tanzil Quran text, used verbatim with required attribution. Translation/audio display can be backed by Quran.com / Quran.Foundation APIs.
