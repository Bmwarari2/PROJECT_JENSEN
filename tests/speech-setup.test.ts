import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["ELEVENLABS_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "STT_PROVIDER", "TTS_PROVIDER"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const setup = async () => (await import("@/lib/env")).speechSetup();

describe("speechSetup", () => {
  it("uses ElevenLabs for everything when it's the only provider", async () => {
    process.env.ELEVENLABS_API_KEY = "x";
    expect(await setup()).toEqual({ stt: "elevenlabs", tts: "elevenlabs", pronunciation: "elevenlabs" });
  });

  it("uses Azure for everything when it's the only provider", async () => {
    process.env.AZURE_SPEECH_KEY = "x";
    process.env.AZURE_SPEECH_REGION = "eastus";
    expect(await setup()).toEqual({ stt: "azure", tts: "azure", pronunciation: "azure" });
  });

  it("with both, prefers ElevenLabs for voice and Azure for scoring", async () => {
    process.env.ELEVENLABS_API_KEY = "x";
    process.env.AZURE_SPEECH_KEY = "x";
    process.env.AZURE_SPEECH_REGION = "eastus";
    expect(await setup()).toEqual({ stt: "elevenlabs", tts: "elevenlabs", pronunciation: "azure" });
    process.env.TTS_PROVIDER = "azure";
    vi.resetModules();
    expect((await setup()).tts).toBe("azure");
  });

  it("explains what's missing", async () => {
    await expect(setup()).rejects.toThrow(/ELEVENLABS_API_KEY/);
    process.env.ELEVENLABS_API_KEY = "x";
    process.env.STT_PROVIDER = "azure";
    vi.resetModules();
    await expect(setup()).rejects.toThrow(/stt is set to use azure/);
  });
});
