import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/wav";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let nextResponse: (url: string) => Response;

beforeEach(() => {
  calls = [];
  vi.resetModules(); // fresh env cache per test
  process.env.AZURE_SPEECH_KEY = "azure-key";
  process.env.AZURE_SPEECH_REGION = "EastUS";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return nextResponse(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  delete process.env.STT_LOCALES;
});

const wav = new Uint8Array(encodeWav(new Float32Array(16000)));
const headersOf = (c: Call) => new Headers(c.init.headers);

describe("Azure Speech client", () => {
  it("synthesizes with SSML, the key and an mp3 output format", async () => {
    nextResponse = () => new Response(new Uint8Array([1, 2, 3]));
    const { synthesize } = await import("@/lib/speech/azure");
    const audio = await synthesize([{ lang: "zh", text: "你好" }], true);
    expect(Array.from(audio)).toEqual([1, 2, 3]);
    const [call] = calls;
    expect(call!.url).toBe("https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
    const h = headersOf(call!);
    expect(h.get("Ocp-Apim-Subscription-Key")).toBe("azure-key");
    expect(h.get("Content-Type")).toBe("application/ssml+xml");
    expect(h.get("X-Microsoft-OutputFormat")).toBe("audio-24khz-48kbitrate-mono-mp3");
    expect(String(call!.init.body)).toContain('<voice name="zh-CN-XiaoxiaoNeural">');
  });

  it("assesses pronunciation with a base64 config header", async () => {
    nextResponse = () =>
      Response.json({
        RecognitionStatus: "Success",
        NBest: [{ Display: "你好", PronScore: 91, AccuracyScore: 90, FluencyScore: 95, CompletenessScore: 100, Words: [] }],
      });
    const { assessPronunciation } = await import("@/lib/speech/azure");
    const outcome = await assessPronunciation(wav, "你好");
    expect(outcome).toMatchObject({ status: "ok", scores: { pron: 91 } });
    const [call] = calls;
    expect(call!.url).toBe(
      "https://eastus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed",
    );
    const h = headersOf(call!);
    expect(h.get("Content-Type")).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
    const config = JSON.parse(Buffer.from(h.get("Pronunciation-Assessment")!, "base64").toString("utf8"));
    expect(config).toEqual({
      ReferenceText: "你好",
      GradingSystem: "HundredMark",
      Granularity: "Phoneme",
      Dimension: "Comprehensive",
      EnableMiscue: "True",
    });
  });

  it("transcribes with the multilingual model and falls back to language ID", async () => {
    let n = 0;
    nextResponse = () =>
      n++ === 0
        ? new Response("multilingual not supported here", { status: 400 })
        : Response.json({ combinedPhrases: [{ text: "How do I say 你好?" }] });
    const { transcribe } = await import("@/lib/speech/azure");
    expect(await transcribe(wav)).toBe("How do I say 你好?");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(
      "https://eastus.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15",
    );
    const definition = (i: number) => JSON.parse(String((calls[i]!.init.body as FormData).get("definition")));
    expect(definition(0)).toEqual({ locales: [] });
    expect(definition(1)).toEqual({ locales: ["en-US", "zh-CN"] });
    expect((calls[0]!.init.body as FormData).get("audio")).toBeInstanceOf(Blob);
  });

  it("falls back to dual-language short audio when fast transcription is unavailable", async () => {
    nextResponse = (url) => {
      if (url.includes("transcriptions:transcribe")) return new Response("not available on this tier", { status: 403 + 1 });
      return url.includes("language=zh-CN")
        ? Response.json({ RecognitionStatus: "Success", NBest: [{ Display: "谢谢。", Confidence: 0.91 }] })
        : Response.json({ RecognitionStatus: "Success", NBest: [{ Display: "Shea shea.", Confidence: 0.42 }] });
    };
    const { transcribe } = await import("@/lib/speech/azure");
    expect(await transcribe(wav)).toBe("谢谢。");
    expect(calls.map((c) => new URL(c.url).searchParams.get("language") ?? "fast")).toEqual(["fast", "fast", "en-US", "zh-CN"]);

    // The working method is remembered: next time it goes straight to short audio.
    calls = [];
    await transcribe(wav);
    expect(calls).toHaveLength(2);
  });

  it("explains a rejected key", async () => {
    nextResponse = () => new Response("unauthorized", { status: 401 });
    const { synthesize, SpeechError } = await import("@/lib/speech/azure");
    const error = await synthesize([{ lang: "en", text: "hi" }], false).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpeechError);
    expect((error as InstanceType<typeof SpeechError>).userMessage).toMatch(/AZURE_SPEECH_KEY/);
  });
});
