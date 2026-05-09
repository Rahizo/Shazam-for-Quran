# Launch Checklist

This app is now set up for a one-container web launch: the Docker service builds the Expo website, downloads the Quran corpus, starts the Express API, and serves both the web app and `/api/*` from the same domain.

## 1. Before You Deploy

1. Rotate any API keys that were pasted into chat, screenshots, logs, or Git history.
2. Create a GitHub repository and push this project.
3. Run the local predeploy check:
   ```bash
   npm run predeploy:check
   ```
4. Decide your first production recognition mode:
   - `OpenAI Hybrid`: best practical MVP quality, but every transcription costs money.
   - `Local Whisper`: no OpenAI transcription cost, but needs more server CPU/RAM and is slower without GPU.
5. Keep raw audio deletion enabled. The current API deletes uploads after each request.

## 2. Required Production Environment Variables

Set these on your hosting platform, not in Git:

```bash
SERVE_WEB_DIST=true
TRANSCRIPTION_PROVIDER=openai
OPENAI_API_KEY=your_real_key
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
AUDIO_REFERENCE_RECITER=Alafasy_128kbps
LOCAL_WHISPER_MODEL=medium
EXPO_PUBLIC_API_BASE_URL=
CORS_ORIGIN=
API_RATE_LIMIT_PER_HOUR=30
PORT=8787
```

Notes:
- Leave `EXPO_PUBLIC_API_BASE_URL` empty when the website and API are served by the same container.
- Leave `CORS_ORIGIN` empty for same-origin deployment. If you split frontend/backend later, set it to your website origin, for example `https://yourdomain.com`.
- Raise or lower `API_RATE_LIMIT_PER_HOUR` after you understand real usage.

## 3. Deploy On Render

1. Sign in to Render.
2. Connect your GitHub repository.
3. Choose **Blueprint** if Render detects `render.yaml`, or create a **Web Service** manually.
4. Runtime: **Docker**.
5. Health check path: `/api/health`.
6. Add secret environment variables:
   - `OPENAI_API_KEY`
   - optional `DEEPSEEK_API_KEY`
7. Deploy.
8. Open:
   ```text
   https://your-render-service.onrender.com/api/health
   ```
   You should see `ok: true`.
9. Open the root URL and test recording.

Render reads Docker services from a `Dockerfile` and supports environment variables/secrets in the dashboard.

## 4. Deploy On Railway

1. Sign in to Railway.
2. Create a new project from your GitHub repository.
3. Railway should detect the `Dockerfile`. If needed, set:
   ```bash
   RAILWAY_DOCKERFILE_PATH=Dockerfile
   ```
4. Add the same production environment variables from section 2.
5. Generate a public domain.
6. Test:
   ```text
   https://your-railway-domain.up.railway.app/api/health
   ```

Railway supports Dockerfile-based deployments and service variables from the project dashboard.

## 5. Custom Domain

1. Buy a domain from Namecheap, Cloudflare, Google Domains/Squarespace, etc.
2. In your host, add the custom domain.
3. In your DNS provider, add the record your host gives you:
   - usually a `CNAME` for `www`
   - sometimes an `A` record or `ALIAS` for the root domain
4. Wait for DNS to propagate.
5. Confirm HTTPS is active before sharing the app.
6. Set `CORS_ORIGIN=https://yourdomain.com` only if your API is on a different domain.

## 6. Production Smoke Test

After every deploy:

1. Open `/api/health`.
2. Open the website.
3. Allow microphone permission.
4. Record 15-30 seconds from a known ayah.
5. Confirm the top result is plausible.
6. Try pressing record twice, stop, and play/stop recitation.
7. Confirm no uploaded audio files remain in `server/uploads`.
8. Watch host logs for transcription errors, rate limits, or memory crashes.

## 7. Cost Controls

1. Keep `API_RATE_LIMIT_PER_HOUR` on.
2. Start with OpenAI Hybrid for accuracy, but cap usage.
3. If traffic grows, add login/payment before increasing limits.
4. Cache local Whisper models and reference audio on persistent storage if your host supports disks.
5. Monitor OpenAI usage daily during launch week.

## 8. Legal And Trust Checklist

Before public launch:

1. Publish Privacy Policy and Terms pages.
2. State that recordings are uploaded for recognition and deleted after processing.
3. State whether OpenAI/DeepSeek or another provider processes audio/text.
4. Add Quran text/audio attribution.
5. Add a contact email.
6. Do not market this as perfect. Say results are ranked possible matches.
7. Get legal review before charging users.
