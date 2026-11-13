# Lǎoshī 老师: a voice Mandarin tutor

A personal web app that teaches Mandarin Chinese to a complete beginner, by voice. Talk to it in English, Chinese, or a mix. It talks back, teaches one small step at a time, asks you to repeat words, scores your pronunciation character by character, and remembers what you've learned.

- **Brain:** Claude Opus 5.5 (Anthropic API), following a 12-unit beginner course (roughly HSK 1)
- **Voice:** Azure AI Speech: native Mandarin voice (slowed down for learning), English voice, mixed-language speech recognition, and pronunciation scoring
- **Memory:** Supabase (Postgres): your words, review schedule, scores, and the tutor's notes about you
- **Hosting:** Railway, as one Next.js service

## What it does

- **Voice conversation.** Tap the mic, speak (English, Chinese, or both), and tap again. Replies are read aloud: English in an English voice, Chinese in a native Mandarin voice at about 70% speed.
- **Readable Chinese.** Every Chinese word shows characters coloured by tone, pinyin above each character, and the English meaning. Tap any word to hear it again.
- **Pronunciation practice.** When the tutor asks you to say something, a practice card appears. Your recording is scored by Azure's pronunciation assessment (overall, plus a score for each character), and the tutor coaches you on the weakest part.
- **Progress that sticks.** Words go into a spaced-repetition schedule driven by your scores. Each new lesson starts with a snapshot of your words, what's due for review, recent weak spots, and the tutor's own notes about you (your name, goals, recurring tone mix-ups).
- **Progress page.** Streak, words learned and mastered, what's due, recent scores, and your whole vocabulary list.

## Why these services

| Need | Choice | Why |
| --- | --- | --- |
| Tutor | Claude Opus 5.5 | Strong at patient, adaptive teaching and accurate pinyin and tones. Replies use structured JSON, so the app always knows which parts are English, which are Chinese, and what to ask you to repeat. |
| Voice | Azure AI Speech | The one service that covers all three things a Mandarin learner needs: native zh-CN voices (correct tones matter more than anything), per-language speed control (slow Chinese, normal English), and **pronunciation assessment for Mandarin** that scores your attempt against the target. Its free tier covers light personal use. |
| Database | Supabase | Managed Postgres with a generous free tier. |
| Hosting | Railway | Deploys straight from GitHub, with HTTPS (which browsers require for microphone access). |

## Setup

You need four things: an Anthropic API key, an Azure Speech key, a Supabase project, and a Railway account.

### 1. Anthropic

Create an API key at <https://platform.claude.com> (Settings → API keys). This becomes `ANTHROPIC_API_KEY`.

### 2. Azure AI Speech

1. Sign in to the [Azure portal](https://portal.azure.com). A free account works.
2. **Create a resource** → search for **Speech** → Create.
3. Pick a **region** (East US, `eastus`, has every feature this app uses) and a pricing tier. **Free F0** is fine to start; **Standard S0** is pay-as-you-go and inexpensive for one person.
4. Open the resource → **Keys and Endpoint**. Copy **Key 1** (`AZURE_SPEECH_KEY`) and the **Location/Region**, for example `eastus` (`AZURE_SPEECH_REGION`).

Transcription uses Azure's multilingual "fast transcription" model, so you can mix English and Chinese in one sentence. If your tier or region doesn't offer it, the app falls back automatically: first to language detection, then to recognizing English and Mandarin separately and keeping the more confident result.

### 3. Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. Open the **SQL Editor**, paste the contents of [`supabase/migrations/20261113113124_init.sql`](supabase/migrations/20261113113124_init.sql), and click **Run**. (Or use the Supabase CLI: `supabase link` then `supabase db push`.)
3. In **Project Settings → API Keys**, copy the **secret** key (`SUPABASE_SECRET_KEY`). In **Project Settings → Data API**, copy the **Project URL** (`SUPABASE_URL`).

The secret key stays on the server. Row-level security is on with no policies, so the public key can't read your data.

### 4. Run it locally (optional)

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
```

Browsers allow the microphone on `localhost` without HTTPS, so voice works locally.

### 5. Deploy to Railway

1. Push this repository to GitHub (already done if you're reading this there).
2. In Railway: **New Project → Deploy from GitHub repo**, and pick this repository and branch.
3. In the service's **Variables** tab, add everything from `.env.example`: `APP_PASSWORD`, `SESSION_SECRET` (generate it with `openssl rand -base64 48`), `ANTHROPIC_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`.
4. **Settings → Networking → Generate Domain** gives you an HTTPS URL.

`railway.json` sets the build and start commands and a health check at `/api/health`. Open the URL, sign in with your password, and tap **Start lesson**.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `APP_PASSWORD` | yes | | The password for the login screen. Changing it signs out every device. |
| `SESSION_SECRET` | yes | | 32+ random characters; signs the login cookie. |
| `ANTHROPIC_API_KEY` | yes | | |
| `TUTOR_MODEL` | | `claude-opus-5-5` | |
| `TUTOR_EFFORT` | | `low` | How hard Claude thinks before replying. `low` keeps spoken replies quick; `medium` or `high` give more thorough explanations but slower replies. |
| `AZURE_SPEECH_KEY` | yes | | |
| `AZURE_SPEECH_REGION` | yes | | For example `eastus`. |
| `TTS_VOICE_EN` | | `en-US-AvaMultilingualNeural` | Any [Azure neural voice](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts). |
| `TTS_VOICE_ZH` | | `zh-CN-XiaoxiaoNeural` | Set both voices to `zh-CN-XiaoxiaoMultilingualNeural` for one bilingual voice. |
| `STT_LOCALES` | | (empty) | Empty means automatic English/Mandarin. For example, `en-US,zh-CN` forces language detection. |
| `SUPABASE_URL` | yes | | |
| `SUPABASE_SECRET_KEY` | yes | | The legacy `SUPABASE_SERVICE_ROLE_KEY` also works. |

In the app's menu (⋮) you can turn off auto-play, switch Chinese to normal speed, or hide pinyin once you can read the characters.

## How it works

```
Browser ──(mic → 16 kHz WAV)──▶ /api/transcribe ──▶ Azure fast transcription (multilingual)
   │                            /api/pronounce  ──▶ Azure pronunciation assessment (zh-CN) ──▶ Supabase
   ├──(text / attempt id)─────▶ /api/chat       ──▶ Claude Opus 5.5 (structured JSON reply) ──▶ Supabase
   └──(reply segments)────────▶ /api/tts        ──▶ Azure neural voices (SSML; Chinese slowed)
```

- **Study sessions.** Each lesson is one Claude conversation. A new one starts when you tap **Start lesson**, after 3 hours away, or when a session gets long. Its system prompt holds the course outline and a frozen snapshot of your progress.
- **Append-only history.** Within a session, messages are stored exactly as sent and replayed verbatim. Claude Opus 5.5 ties its reasoning to the exact conversation, so the app never edits history. Appends go through a locked database function, so two overlapping requests can't interleave turns. The static part of the prompt is cached, and so is the growing conversation.
- **Structured replies.** Claude answers in a JSON schema (`lib/tutor/schema.ts`) with ordered English and Chinese speech segments, an optional on-screen note, an optional practice target, vocabulary to save, updated learner notes, and a unit-complete flag.
- **Safety net.** If a safety classifier ever declines a turn (unlikely for language lessons), server-side fallbacks retry it on another model within the same request.
- **Spaced repetition** (`lib/srs.ts`). A pronunciation score of 70+ counts as a pass and stretches the review gap (1 → ~2.5 → ~6 → ~15 days, up to 120). A weaker attempt brings the word back next session.

## Costs (rough)

- **Claude:** at the default low effort, an exchange is typically one to two cents, so an active 30-minute lesson costs well under a dollar. Prompt caching keeps resent history cheap. Raising `TUTOR_EFFORT` increases cost and latency.
- **Azure Speech:** the free tier includes a monthly allowance of speech-to-text hours and text-to-speech characters. Check current limits on the [pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/). Replayed audio is cached in the browser and on the server.
- **Supabase:** free tier. Note that free projects pause after a week of inactivity.
- **Railway:** the Hobby plan.

## Development

```bash
npm test           # unit + integration tests (offline; external APIs are mocked)
npm run typecheck
npm run lint
npm run build
```

Project layout:

```
app/                   pages (lesson, login, progress) and API routes
components/            UI: TutorApp (state machine), messages, mic button, Chinese text
lib/tutor/             prompt + course, JSON schema, Claude engine, session orchestration
lib/speech/            Azure REST client, SSML builder, pronunciation result parsing
lib/client/            browser: recorder (→ 16 kHz WAV), audio player, settings, API calls
lib/db.ts              Supabase data access
supabase/migrations/   database schema
proxy.ts               password gate for every page and API route
```

## Troubleshooting

- **"Microphone access was blocked."** Allow the microphone for the site in your browser settings. The deployed app must be served over HTTPS (Railway domains are).
- **No sound on iPhone.** Check the ringer switch. Audio starts after your first tap, as iOS requires.
- **"The Azure Speech key or region was rejected."** `AZURE_SPEECH_REGION` must match the resource's region exactly (for example `eastus`, not `East US`).
- **"Couldn't reach the progress database."** Check `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, confirm the migration ran, and check whether a free-tier project is paused.
- **Server logs** (Railway → Deployments → Logs) record the technical detail behind every error shown in the app.
