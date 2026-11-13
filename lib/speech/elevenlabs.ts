import "server-only";
import { elevenLabsEnv } from "@/lib/env";
import { SpeechError, speechFetch, type ServiceInfo } from "@/lib/speech/http";
import type { HeardChar } from "@/lib/speech/clarity";
import type { Lang } from "@/lib/types";

// ElevenLabs over REST:
//  - text to speech: POST /v1/text-to-speech/{voice_id}
//  - speech to text (Scribe): POST /v1/speech-to-text

const BASE_URL = "https://api.elevenlabs.io";

const ELEVENLABS: ServiceInfo = {
  name: "ElevenLabs",
  authHeaders: () => ({ "xi-api-key": elevenLabsEnv().ELEVENLABS_API_KEY }),
  keyHint: "Check ELEVENLABS_API_KEY.",
};

/** Chinese at ~80% speed for listen-and-repeat. */
export const SLOW_CHINESE_SPEED = 0.8;

// ---- Text to speech ---------------------------------------------------------

/** Merge consecutive same-language segments into runs, one request each. */
export function speechRuns(segments: Array<{ lang: Lang; text: string }>): Array<{ lang: Lang; text: string }> {
  const runs: Array<{ lang: Lang; texts: string[] }> = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const last = runs.at(-1);
    if (last && last.lang === segment.lang) last.texts.push(text);
    else runs.push({ lang: segment.lang, texts: [text] });
  }
  return runs.map(({ lang, texts }) => ({
    lang,
    // Separate Chinese items with a full stop so each is said on its own.
    text: lang === "zh" ? texts.map((t) => (/[。！？!?.]$/.test(t) ? t : `${t}。`)).join("") : texts.join(" "),
  }));
}

async function synthesizeRun(run: { lang: Lang; text: string }, slowChinese: boolean): Promise<Uint8Array> {
  const env = elevenLabsEnv();
  const voice = run.lang === "zh" ? env.ELEVENLABS_VOICE_ID_ZH : env.ELEVENLABS_VOICE_ID;
  const speed = run.lang === "zh" && slowChinese ? SLOW_CHINESE_SPEED : 1;
  const url = `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
  const request = (withSpeed: boolean) =>
    speechFetch(ELEVENLABS, "text to speech", url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: run.text,
        model_id: env.ELEVENLABS_TTS_MODEL,
        language_code: run.lang,
        ...(withSpeed && speed !== 1 ? { voice_settings: { speed } } : {}),
      }),
    });

  let response: Response;
  try {
    response = await request(true);
  } catch (error) {
    // If this model rejects a setting, still speak, just at normal speed.
    if (error instanceof SpeechError && error.status === 422 && speed !== 1) {
      console.warn("[speech] ElevenLabs rejected the speed setting; retrying without it:", error.message);
      response = await request(false);
    } else {
      throw error;
    }
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Length of an ID3v2 tag at the start of an MP3, or 0. */
function id3Length(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
  const footer = bytes[5]! & 0x10 ? 10 : 0;
  return Math.min(bytes.length, 10 + size + footer);
}

/** MP3 is a sequence of frames, so same-format clips can be joined end to end. */
export function concatMp3(parts: Uint8Array[]): Uint8Array {
  const trimmed = parts.map((p, i) => (i === 0 ? p : p.subarray(id3Length(p))));
  const out = new Uint8Array(trimmed.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of trimmed) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function elevenSynthesize(segments: Array<{ lang: Lang; text: string }>, slowChinese: boolean) {
  const runs = speechRuns(segments);
  // A few requests at a time keeps within ElevenLabs' concurrency limits.
  const parts = await mapLimited(runs, 3, (run) => synthesizeRun(run, slowChinese));
  return concatMp3(parts);
}

// ---- Speech to text (Scribe) ----------------------------------------------

interface ScribeWord {
  text: string;
  type?: "word" | "spacing" | "audio_event";
  logprob?: number | null;
}

interface ScribeResponse {
  text?: string;
  language_code?: string;
  words?: ScribeWord[];
}

async function scribe(wav: Uint8Array, options: { languageCode?: string; secondary?: string[] }): Promise<ScribeResponse> {
  const env = elevenLabsEnv();
  const build = (extras: boolean) => {
    const form = new FormData();
    form.append("model_id", env.ELEVENLABS_STT_MODEL);
    form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "speech.wav");
    if (options.languageCode) form.append("language_code", options.languageCode);
    if (extras) {
      form.append("tag_audio_events", "false");
      if (options.secondary?.length && env.ELEVENLABS_STT_MODEL.startsWith("scribe_v3")) {
        for (const code of options.secondary) form.append("secondary_language_codes", code);
      }
    }
    return form;
  };
  const url = `${BASE_URL}/v1/speech-to-text`;
  let response: Response;
  try {
    response = await speechFetch(ELEVENLABS, "transcription", url, { method: "POST", body: build(true) });
  } catch (error) {
    // Optional parameters vary by model; fall back to the essentials.
    if (error instanceof SpeechError && error.status === 422) {
      console.warn("[speech] ElevenLabs rejected optional transcription settings; retrying without them:", error.message);
      response = await speechFetch(ELEVENLABS, "transcription", url, { method: "POST", body: build(false) });
    } else {
      throw error;
    }
  }
  return (await response.json()) as ScribeResponse;
}

/** Conversation: English, Mandarin or a mix. */
export async function elevenTranscribe(wav: Uint8Array): Promise<string> {
  const result = await scribe(wav, { secondary: ["en", "zh"] });
  return (result.text ?? "").trim();
}

/** Practice: transcribe as Mandarin, with a confidence for each character. */
export async function elevenHearMandarin(wav: Uint8Array): Promise<{ text: string; chars: HeardChar[] }> {
  const result = await scribe(wav, { languageCode: "zh" });
  const text = (result.text ?? "").trim();
  const words = (result.words ?? []).filter((w) => (w.type ?? "word") === "word");
  const chars: HeardChar[] = words.length
    ? words.flatMap((w) => {
        const confidence = typeof w.logprob === "number" ? Math.exp(Math.min(0, w.logprob)) : null;
        return Array.from(w.text).map((char) => ({ char, confidence }));
      })
    : Array.from(text).map((char) => ({ char, confidence: null }));
  return { text, chars };
}
