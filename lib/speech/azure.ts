import "server-only";
import { speechEnv } from "@/lib/env";
import { buildSsml } from "@/lib/speech/ssml";
import { normalizeAssessment, type AssessmentOutcome, type AzureShortAudioResponse } from "@/lib/speech/pronunciation";
import type { Lang } from "@/lib/types";

// Azure AI Speech over plain REST (no SDK needed on the server):
//  - text to speech:          {region}.tts.speech.microsoft.com
//  - fast transcription:      {region}.api.cognitive.microsoft.com (multilingual)
//  - pronunciation assessment: {region}.stt.speech.microsoft.com (short audio)

const USER_AGENT = "laoshi-tutor";
const FAST_TRANSCRIPTION_API_VERSION = "2025-10-15";
const TIMEOUT_MS = 20_000;

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

async function azureFetch(what: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Ocp-Apim-Subscription-Key": speechEnv().AZURE_SPEECH_KEY,
        "User-Agent": USER_AGENT,
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpeechError(`${what}: ${String(error)}`, "Couldn't reach the speech service. Please try again.");
  }
  if (response.ok) return response;

  const body = (await response.text().catch(() => "")).slice(0, 500);
  if (response.status === 401 || response.status === 403) {
    throw new SpeechError(
      `${what}: HTTP ${response.status} ${body}`,
      "The Azure Speech key or region was rejected. Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.",
      500,
    );
  }
  if (response.status === 429) {
    throw new SpeechError(`${what}: HTTP 429 ${body}`, "The speech service is busy. Wait a moment and try again.", 429);
  }
  throw new SpeechError(`${what}: HTTP ${response.status} ${body}`, "The speech service returned an error.", 502);
}

// ---- Text to speech ---------------------------------------------------------

export async function synthesize(segments: Array<{ lang: Lang; text: string }>, slowChinese: boolean) {
  const env = speechEnv();
  const ssml = buildSsml(segments, { voiceEn: env.TTS_VOICE_EN, voiceZh: env.TTS_VOICE_ZH, slowChinese });
  const response = await azureFetch(
    "text to speech",
    `https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      },
      body: ssml,
    },
  );
  return new Uint8Array(await response.arrayBuffer());
}

// ---- Transcription (English, Mandarin, or both) -----------------------------

interface FastTranscriptionResponse {
  combinedPhrases?: Array<{ text?: string }>;
  phrases?: Array<{ text?: string }>;
}

async function fastTranscription(wav: Uint8Array, locales: string[]): Promise<string> {
  const env = speechEnv();
  const form = new FormData();
  form.append("audio", new Blob([wav as BlobPart], { type: "audio/wav" }), "speech.wav");
  // No locales = the multilingual model, which follows switches between
  // English and Mandarin phrase by phrase.
  form.append("definition", JSON.stringify({ locales }));
  const response = await azureFetch(
    "transcription",
    `https://${env.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${FAST_TRANSCRIPTION_API_VERSION}`,
    { method: "POST", body: form },
  );
  const data = (await response.json()) as FastTranscriptionResponse;
  const combined = data.combinedPhrases?.map((p) => p.text ?? "").join(" ").trim();
  return combined || (data.phrases ?? []).map((p) => p.text ?? "").join(" ").trim();
}

/** Short-audio recognition in one language; returns text and confidence. */
async function shortAudio(wav: Uint8Array, language: string): Promise<{ text: string; confidence: number }> {
  const env = speechEnv();
  const response = await azureFetch(
    "short-audio transcription",
    `https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`,
    {
      method: "POST",
      headers: { "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", Accept: "application/json" },
      body: wav as BodyInit,
    },
  );
  const data = (await response.json()) as AzureShortAudioResponse & { NBest?: Array<{ Confidence?: number }> };
  if (data.RecognitionStatus !== "Success") return { text: "", confidence: 0 };
  const best = data.NBest?.[0];
  return { text: (best?.Display ?? data.DisplayText ?? "").trim(), confidence: best?.Confidence ?? 0 };
}

/**
 * Recognise English and Mandarin separately and keep the more confident
 * result. Works on every pricing tier; it can't follow a switch of language
 * mid-sentence, which is why it's only the last resort.
 */
async function dualLanguageShortAudio(wav: Uint8Array): Promise<string> {
  const [en, zh] = await Promise.all([shortAudio(wav, "en-US"), shortAudio(wav, "zh-CN")]);
  return (zh.confidence > en.confidence ? zh : en).text;
}

type Method = "multilingual" | "language-id" | "short-audio";
// Remember what works for this resource so we don't retry failing calls.
let workingMethod: Method | null = null;

export async function transcribe(wav: Uint8Array): Promise<string> {
  const env = speechEnv();
  if (env.STT_LOCALES.length > 0) return fastTranscription(wav, env.STT_LOCALES);

  const methods: Method[] = workingMethod ? [workingMethod] : ["multilingual", "language-id", "short-audio"];
  let lastError: unknown;
  for (const method of methods) {
    try {
      const text =
        method === "multilingual"
          ? await fastTranscription(wav, [])
          : method === "language-id"
            ? await fastTranscription(wav, ["en-US", "zh-CN"])
            : await dualLanguageShortAudio(wav);
      workingMethod = method;
      return text;
    } catch (error) {
      // Auth and rate-limit errors won't be fixed by another method.
      if (!(error instanceof SpeechError) || error.status !== 502) throw error;
      console.warn(`[speech] ${method} transcription failed:`, error.message);
      lastError = error;
    }
  }
  if (workingMethod) {
    workingMethod = null; // something changed; probe all methods next time
  }
  throw lastError;
}

// ---- Pronunciation assessment (Mandarin) ------------------------------------

export async function assessPronunciation(wav: Uint8Array, referenceText: string): Promise<AssessmentOutcome> {
  const env = speechEnv();
  const config = {
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: "True",
  };
  const response = await azureFetch(
    "pronunciation assessment",
    `https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed`,
    {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        Accept: "application/json",
        "Pronunciation-Assessment": Buffer.from(JSON.stringify(config), "utf8").toString("base64"),
      },
      body: wav as BodyInit,
    },
  );
  return normalizeAssessment((await response.json()) as AzureShortAudioResponse);
}
