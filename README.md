# Lǎoshī 老师: a voice Mandarin tutor

A personal web app that teaches Mandarin Chinese to a complete beginner, by voice. Talk to it in English, Chinese, or a mix. It talks back, teaches one small step at a time, asks you to repeat words, checks your pronunciation character by character, and remembers what you've learned.

- **Brain:** Claude Opus 5.5 (Anthropic API), following a 12-unit beginner course (roughly HSK 1)
- **Voice:** ElevenLabs (Scribe speech-to-text and Eleven v4 voices). Azure AI Speech is optional, for precise pronunciation scores.
- **Memory:** Supabase (Postgres): your words, review schedule, scores, and the tutor's notes about you
- **Hosting:** Railway, as one Next.js service

## What it does

- **Voice conversation.** Tap the mic, speak (English, Chinese, or both), and tap again. Replies are read aloud, with the Chinese parts slowed down so you can hear each syllable.
- **Readable Chinese.** Every Chinese word shows characters coloured by tone, pinyin above each character, and the English meaning. Tap any word to hear it again.
- **Pronunciation practice.** When the tutor asks you to say something, a practice card appears. You record yourself, see a score for each character, and the tutor coaches you on the weakest part.
- **Progress that sticks.** Words go into a spaced-repetition schedule driven by your scores. Each new lesson starts with a snapshot of your words, what's due for review, recent weak spots, and the tutor's own notes about you (your name, goals, recurring tone mix-ups).
- **Progress page.** Streak, words learned and mastered, what's due, recent scores, and your whole vocabulary list.

## Voice providers: ElevenLabs, Azure, or both

Set whichever keys you have; the app works out who does what.

| You configure | Listening (speech → text) | Speaking (text → speech) | Pronunciation scoring |
| --- | --- | --- | --- |
| ElevenLabs only | ElevenLabs Scribe | ElevenLabs voice | **Clarity check** (see below) |
| ElevenLabs + Azure | ElevenLabs Scribe | ElevenLabs voice | **Azure pronunciation assessment** |
| Azure only | Azure | Azure neural voices | Azure pronunciation assessment |

`STT_PROVIDER` and `TTS_PROVIDER` override the defaults when both are set.

**Clarity check vs. Azure assessment.** Without Azure, your attempt is transcribed as Mandarin by ElevenLabs, and each target character is compared, by sound, with what the recogniser heard. If it heard 歇 xiē when you meant 谢 xiè, that's flagged as a **tone** error; a different syllable counts as mispronounced, and a missing one as missed. That's genuinely useful, but it measures "would a native-trained listener understand you" rather than grading each sound. Azure's pronunciation assessment is purpose-built for language learning and scores at the phoneme level. If pronunciation feedback matters most to you, add Azure (its free tier is enough for personal use). The tutor is told which kind of result it's looking at and coaches accordingly.

## Setup

You need: an Anthropic API key, an ElevenLabs API key (and optionally Azure Speech), a Supabase project, and a Railway account.

### 1. Anthropic

Create an API key at <https://platform.claude.com> (Settings → API keys). This becomes `ANTHROPIC_API_KEY`.

### 2. ElevenLabs

1. Sign up at <https://elevenlabs.io>. The free plan includes monthly credits.
2. Go to **Developers → API keys** and create a key. This becomes `ELEVENLABS_API_KEY`.
3. Optionally, pick voices in **Voices → Voice Library**. A native Mandarin voice for the Chinese parts (`ELEVENLABS_VOICE_ID_ZH`) gives the most authentic tones. Copy a voice's ID from its menu. Without it, one default voice speaks both languages.

### 3. Azure AI Speech (optional, for precise pronunciation scores)

1. In the [Azure portal](https://portal.azure.com): **Create a resource → Speech → Create**.
2. Region **East US** (`eastus`), pricing tier **Free F0**.
3. Open the resource → **Keys and Endpoint**. Copy **Key 1** (`AZURE_SPEECH_KEY`) and the region (`AZURE_SPEECH_REGION`, for example `eastus`).

### 4. Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. Run [`supabase/migrations/20261113000000_init.sql`](supabase/migrations/20261113000000_init.sql) in the **SQL Editor** (or `supabase db push` with the CLI).
3. Copy the **Project URL** (`SUPABASE_URL`) and the **secret** key from **Project Settings → API Keys** (`SUPABASE_SECRET_KEY`).

The secret key stays on the server. Row-level security is on with no policies, so the public key can't read your data.

### 5. Run it locally (optional)

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
```

### 6. Deploy to Railway

1. In Railway: **New Project → Deploy from GitHub repo**, and pick this repository and branch.
2. In the service's **Variables** tab, add `APP_PASSWORD`, `SESSION_SECRET` (generate it with `openssl rand -base64 48`), `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the Azure pair if you use it.
3. **Settings → Networking → Generate Domain** gives you an HTTPS URL (browsers need HTTPS for the microphone).

`railway.json` sets the build and start commands and a health check at `/api/health`. Open the URL, sign in, and tap **Start lesson**.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `APP_PASSWORD` | yes | | The password for the login screen. Changing it signs out every device. |
| `SESSION_SECRET` | yes | | 32+ random characters; signs the login cookie. |
| `ANTHROPIC_API_KEY` | yes | | |
| `TUTOR_MODEL` | | `claude-opus-5-5` | |
| `TUTOR_EFFORT` | | `low` | How hard Claude thinks before replying. `low` keeps spoken replies quick; `medium` or `high` are more thorough but slower. |
| `ELEVENLABS_API_KEY` | one voice provider | | |
| `ELEVENLABS_VOICE_ID` | | `JBFqnCBsd6RMkjVDRZzb` ("George") | Voice for English, and for Chinese unless the next one is set. |
| `ELEVENLABS_VOICE_ID_ZH` | | same as above | For example, a native Mandarin voice. |
| `ELEVENLABS_TTS_MODEL` | | `eleven_v4` | `eleven_v4_turbo` is faster. |
| `ELEVENLABS_STT_MODEL` | | `scribe_v3` | |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | one voice provider | | Region like `eastus`. |
| `TTS_VOICE_EN`, `TTS_VOICE_ZH` | | `en-US-AvaMultilingualNeural`, `zh-CN-XiaoxiaoNeural` | Azure voices (when Azure speaks). |
| `STT_LOCALES` | | (empty) | Azure transcription only. Empty means automatic English/Mandarin. |
| `STT_PROVIDER`, `TTS_PROVIDER` | | see the table above | `elevenlabs` or `azure`. |
| `SUPABASE_URL` | yes | | |
| `SUPABASE_SECRET_KEY` | yes | | The legacy `SUPABASE_SERVICE_ROLE_KEY` also works. |

In the app's menu (⋮) you can turn off auto-play, switch Chinese to normal speed, or hide pinyin once you can read the characters.

## How it works

```
Browser ──(mic → 16 kHz WAV)──▶ /api/transcribe ──▶ ElevenLabs Scribe (or Azure)
   │                            /api/pronounce  ──▶ Azure assessment, or Scribe + clarity check ──▶ Supabase
   ├──(text / attempt id)─────▶ /api/chat       ──▶ Claude Opus 5.5 (structured JSON reply) ──▶ Supabase
   └──(reply segments)────────▶ /api/tts        ──▶ ElevenLabs (or Azure) voice, Chinese slowed
```

- **Study sessions.** Each lesson is one Claude conversation. A new one starts when you tap **Start lesson**, after 3 hours away, or when a session gets long. Its system prompt holds the course outline and a frozen snapshot of your progress.
- **Append-only history.** Within a session, messages are stored exactly as sent and replayed verbatim. Claude Opus 5.5 ties its reasoning to the exact conversation, so the app never edits history. Appends go through a locked database function, so overlapping requests can't interleave turns. The static prompt and the growing conversation are prompt-cached.
- **Structured replies.** Claude answers in a JSON schema (`lib/tutor/schema.ts`) with ordered English and Chinese speech segments, an optional on-screen note, an optional practice target, vocabulary to save, updated learner notes, and a unit-complete flag.
- **Speaking.** Each run of English or Chinese is synthesized separately (Chinese with `language_code: zh`, at 0.8× speed when "Slow Chinese" is on). The runs are generated in parallel and joined into one clip.
- **Safety net.** If a safety classifier ever declines a turn (unlikely for language lessons), server-side fallbacks retry it on another model within the same request.
- **Spaced repetition** (`lib/srs.ts`). A score of 70+ counts as a pass and stretches the review gap (1 → ~2.5 → ~6 → ~15 days, up to 120). A weaker attempt brings the word back next session.

## Costs (rough)

- **Claude:** at the default low effort, an exchange is typically one to two cents, so an active 30-minute lesson costs well under a dollar.
- **ElevenLabs:** speech-to-text is about $0.22 per hour of audio. Voices use credits per character spoken. The free monthly credits cover light use; daily practice will likely need a paid plan. Replayed audio is cached.
- **Azure Speech** (optional): the free tier is plenty for personal pronunciation scoring.
- **Supabase:** free tier. Free projects pause after a week of inactivity.
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
lib/speech/            provider routing, ElevenLabs + Azure clients, clarity check, SSML
lib/client/            browser: recorder (→ 16 kHz WAV), audio player, settings, API calls
lib/db.ts              Supabase data access
supabase/migrations/   database schema
proxy.ts               password gate for every page and API route
```

## Troubleshooting

- **"Microphone access was blocked."** Allow the microphone for the site in your browser settings. The deployed app must be served over HTTPS (Railway domains are).
- **No sound on iPhone.** Check the ringer switch. Audio starts after your first tap, as iOS requires.
- **"You've run out of ElevenLabs credits."** Top up or upgrade in ElevenLabs, or set `TTS_PROVIDER=azure` (with Azure keys) to move the speaking to Azure.
- **"…rejected the API key."** Check the named key. For Azure, `AZURE_SPEECH_REGION` must match the resource's region (for example `eastus`).
- **"Couldn't reach the progress database."** Check `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and whether a free project is paused.
- **Server logs** (Railway → Deployments → Logs) record the technical detail behind every error shown in the app.
