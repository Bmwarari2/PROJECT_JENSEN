"use client";

import { api } from "@/lib/client/api";
import { encodeWav } from "@/lib/wav";
import type { Lang } from "@/lib/types";

/**
 * One shared <audio> element for all speech. Mobile Safari only lets a page
 * play audio that a user gesture started, so we "unlock" this element on the
 * first tap and reuse it for every later reply.
 */

type Listener = (playingKey: string | null) => void;

class Player {
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private cache = new Map<string, string>(); // key -> object URL
  private listeners = new Set<Listener>();
  private currentKey: string | null = null;
  private requestId = 0;

  private element(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
      // Not "pause": switching clips pauses asynchronously and would clear the
      // highlight of the clip that just started.
      this.audio.addEventListener("ended", () => this.setCurrent(null));
      this.audio.addEventListener("error", () => this.setCurrent(null));
    }
    return this.audio;
  }

  /** Call from a click/tap handler. */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const audio = this.element();
    // 0.1 s of silence.
    audio.src = URL.createObjectURL(new Blob([encodeWav(new Float32Array(1600))], { type: "audio/wav" }));
    audio.play().catch(() => {
      this.unlocked = false;
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setCurrent(key: string | null) {
    if (this.currentKey === key) return;
    this.currentKey = key;
    for (const l of this.listeners) l(key);
  }

  /**
   * Speak the segments. `key` identifies what is playing (for UI highlights).
   * Starting new audio stops whatever is playing.
   */
  async play(key: string, segments: Array<{ lang: Lang; text: string }>, slowChinese: boolean): Promise<void> {
    const id = ++this.requestId;
    this.stop();
    this.setCurrent(key);
    const cacheKey = JSON.stringify({ segments, slowChinese });
    let url = this.cache.get(cacheKey);
    try {
      if (!url) {
        url = URL.createObjectURL(await api.tts({ segments, slowChinese }));
        this.cache.set(cacheKey, url);
        if (this.cache.size > 150) {
          const [oldKey, oldUrl] = this.cache.entries().next().value!;
          URL.revokeObjectURL(oldUrl);
          this.cache.delete(oldKey);
        }
      }
      if (id !== this.requestId) return; // superseded while loading
      const audio = this.element();
      audio.src = url;
      this.setCurrent(key);
      await audio.play();
    } catch (error) {
      if (id === this.requestId) this.setCurrent(null);
      // Autoplay refusals aren't errors worth surfacing; the user can tap play.
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      throw error;
    }
  }

  stop(): void {
    if (this.audio && !this.audio.paused) this.audio.pause();
    this.setCurrent(null);
  }
}

export const player = new Player();
