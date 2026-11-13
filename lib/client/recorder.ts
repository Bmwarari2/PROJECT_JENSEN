"use client";

import { encodeWav, SAMPLE_RATE } from "@/lib/wav";

/**
 * Records from the microphone and returns 16 kHz mono WAV.
 *
 * MediaRecorder produces different containers per browser (WebM/Opus in
 * Chrome, MP4/AAC in Safari, Ogg in Firefox); every browser can decode its own
 * output, so we decode and resample to the one format Azure accepts for
 * pronunciation scoring. The mic is released after every recording.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelData: Uint8Array<ArrayBuffer> | null = null;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
  }

  async start(): Promise<void> {
    if (this.mediaRecorder) throw new Error("Already recording");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.mediaRecorder.start();

    // Level meter for visual feedback while speaking.
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.levelData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      source.connect(this.analyser);
    } catch {
      this.analyser = null;
    }
  }

  /** Current input level, 0..1. */
  level(): number {
    if (!this.analyser || !this.levelData) return 0;
    this.analyser.getByteTimeDomainData(this.levelData);
    let peak = 0;
    for (const v of this.levelData) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  }

  async stop(): Promise<Blob> {
    const recorder = this.mediaRecorder;
    if (!recorder) throw new Error("Not recording");
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    const recorded = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
    this.release();
    if (recorded.size === 0) throw new Error("No audio was captured.");
    return toWav16k(recorded);
  }

  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioContext?.close().catch(() => undefined);
    this.stream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.chunks = [];
  }
}

async function toWav16k(recorded: Blob): Promise<Blob> {
  const decodeContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(await recorded.arrayBuffer());
  } finally {
    void decodeContext.close().catch(() => undefined);
  }
  const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
  // Rendering into a 1-channel context also mixes stereo down to mono.
  const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0))], { type: "audio/wav" });
}
