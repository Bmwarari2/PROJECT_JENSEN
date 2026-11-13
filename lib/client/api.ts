"use client";

import type {
  ChatRequest,
  ChatResponse,
  ChineseItem,
  ProgressResponse,
  PronunciationResult,
  SessionResponse,
  TranscribeResponse,
  TtsRequest,
} from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError("You seem to be offline. Check your connection and try again.", 0);
  }
  if (response.status === 401 && !url.startsWith("/api/login")) {
    // Full reload so no stale state survives.
    window.location.replace(new URL("/login", window.location.origin));
    throw new ApiError("Please sign in again.", 401);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${response.status}).`, response.status);
  }
  return response.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export const api = {
  session: () => request<SessionResponse>("/api/session"),

  chat: (body: Omit<ChatRequest, "timezone">) =>
    request<ChatResponse>("/api/chat", json({ ...body, timezone: browserTimezone() })),

  transcribe: (wav: Blob) => {
    const form = new FormData();
    form.append("audio", wav, "speech.wav");
    return request<TranscribeResponse>("/api/transcribe", { method: "POST", body: form });
  },

  pronounce: (wav: Blob, target: ChineseItem, conversationId: string | null) => {
    const form = new FormData();
    form.append("audio", wav, "attempt.wav");
    form.append("hanzi", target.hanzi);
    form.append("pinyin", target.pinyin);
    form.append("english", target.english);
    if (conversationId) form.append("conversationId", conversationId);
    return request<PronunciationResult>("/api/pronounce", { method: "POST", body: form });
  },

  progress: () => request<ProgressResponse>(`/api/progress?tz=${encodeURIComponent(browserTimezone())}`),

  tts: async (body: TtsRequest): Promise<Blob> => {
    const response = await fetch("/api/tts", json(body)).catch(() => null);
    if (!response) throw new ApiError("You seem to be offline.", 0);
    if (!response.ok) {
      const err = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(err?.error ?? "Couldn't play audio.", response.status);
    }
    return response.blob();
  },

  login: (password: string) => request<{ ok: true }>("/api/login", json({ password })),
  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),
};
