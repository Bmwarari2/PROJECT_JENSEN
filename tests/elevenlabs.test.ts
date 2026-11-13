import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/wav";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let respond: (call: Call) => Response;

beforeEach(() => {
  calls = [];
  vi.resetModules();
  process.env.ELEVENLABS_API_KEY = "el-key";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_VOICE_ID_ZH", "ELEVENLABS_STT_MODEL"]) delete process.env[k];
});

const wav = new Uint8Array(encodeWav(new Float32Array(16000)));
const json = (c: Call) => JSON.parse(String(c.init.body));
const form = (c: Call) => c.init.body as FormData;

describe("ElevenLabs text to speech", () => {
  it("speaks each language run with the right settings and joins the audio", async () => {
    process.env.ELEVENLABS_VOICE_ID_ZH = "zh-voice";
    respond = (c) => new Response(new Uint8Array(json(c).language_code === "zh" ? [0xff, 2] : [0xff, 1]));
    const { elevenSynthesize } = await import("@/lib/speech/elevenlabs");
    const audio = await elevenSynthesize(
      [
        { lang: "en", text: "Hello is" },
        { lang: "zh", text: "你好" },
        { lang: "zh", text: "您好！" },
        { lang: "en", text: "Try it." },
      ],
      true,
    );
    expect(Array.from(audio)).toEqual([0xff, 1, 0xff, 2, 0xff, 1]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128",
    );
    expect(new Headers(calls[0]!.init.headers).get("xi-api-key")).toBe("el-key");
    expect(json(calls[0]!)).toEqual({ text: "Hello is", model_id: "eleven_v4", language_code: "en" });
    expect(calls[1]!.url).toContain("/text-to-speech/zh-voice?");
    expect(json(calls[1]!)).toEqual({
      text: "你好。您好！",
      model_id: "eleven_v4",
      language_code: "zh",
      voice_settings: { speed: 0.8 },
    });
  });

  it("retries without the speed setting if the model rejects it", async () => {
    let n = 0;
    respond = () => (n++ === 0 ? new Response('{"detail":"speed"}', { status: 422 }) : new Response(new Uint8Array([1])));
    const { elevenSynthesize } = await import("@/lib/speech/elevenlabs");
    await elevenSynthesize([{ lang: "zh", text: "你好" }], true);
    expect(json(calls[1]!).voice_settings).toBeUndefined();
  });

  it("explains exhausted credits", async () => {
    respond = () => new Response('{"detail":{"status":"quota_exceeded"}}', { status: 401 });
    const { elevenSynthesize } = await import("@/lib/speech/elevenlabs");
    const error = await elevenSynthesize([{ lang: "en", text: "hi" }], false).catch((e: unknown) => e);
    expect((error as { userMessage: string }).userMessage).toMatch(/run out of ElevenLabs credits/);
  });
});

describe("concatMp3", () => {
  it("drops ID3 tags from all but the first clip", async () => {
    const { concatMp3 } = await import("@/lib/speech/elevenlabs");
    const tagged = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 9, 9, 0xff, 7]);
    expect(Array.from(concatMp3([tagged, tagged]))).toEqual([...tagged, 0xff, 7]);
  });
});

describe("ElevenLabs speech to text", () => {
  it("transcribes conversation with Scribe v3 and secondary languages", async () => {
    respond = () => Response.json({ text: " How do I say 你好? ", language_code: "eng", words: [] });
    const { elevenTranscribe } = await import("@/lib/speech/elevenlabs");
    expect(await elevenTranscribe(wav)).toBe("How do I say 你好?");
    const f = form(calls[0]!);
    expect(calls[0]!.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(f.get("model_id")).toBe("scribe_v3");
    expect(f.get("file")).toBeInstanceOf(Blob);
    expect(f.getAll("secondary_language_codes")).toEqual(["en", "zh"]);
    expect(f.get("language_code")).toBeNull();
    expect(f.get("tag_audio_events")).toBe("false");
  });

  it("falls back to the essentials if optional fields are rejected", async () => {
    let n = 0;
    respond = () => (n++ === 0 ? new Response("{}", { status: 422 }) : Response.json({ text: "hi" }));
    const { elevenTranscribe } = await import("@/lib/speech/elevenlabs");
    expect(await elevenTranscribe(wav)).toBe("hi");
    expect(form(calls[1]!).getAll("secondary_language_codes")).toEqual([]);
    expect(form(calls[1]!).get("model_id")).toBe("scribe_v3");
  });

  it("hears practice attempts as Mandarin with per-character confidence", async () => {
    respond = () =>
      Response.json({
        text: "谢谢。",
        words: [
          { text: "谢谢", type: "word", logprob: Math.log(0.5) },
          { text: "。", type: "spacing", logprob: 0 },
        ],
      });
    const { elevenHearMandarin } = await import("@/lib/speech/elevenlabs");
    const heard = await elevenHearMandarin(wav);
    expect(form(calls[0]!).get("language_code")).toBe("zh");
    expect(heard.text).toBe("谢谢。");
    expect(heard.chars.map((c) => c.char)).toEqual(["谢", "谢"]);
    expect(heard.chars[0]!.confidence).toBeCloseTo(0.5);
  });
});
