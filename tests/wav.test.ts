import { describe, expect, it } from "vitest";
import { encodeWav, readWavInfo, SAMPLE_RATE } from "@/lib/wav";

describe("wav", () => {
  it("round-trips the header", () => {
    const wav = new Uint8Array(encodeWav(new Float32Array(SAMPLE_RATE * 2))); // 2 s
    expect(readWavInfo(wav)).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, durationSeconds: 2 });
  });

  it("clamps samples to 16-bit range", () => {
    const wav = encodeWav(new Float32Array([2, -2, 0.5]));
    const view = new DataView(wav);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(Math.trunc(0.5 * 0x7fff));
  });

  it("rejects non-WAV data", () => {
    expect(readWavInfo(new TextEncoder().encode("definitely not a wav file, but long enough"))).toBeNull();
    expect(readWavInfo(new Uint8Array(10))).toBeNull();
  });
});
