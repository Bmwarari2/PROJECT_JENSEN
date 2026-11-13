import "server-only";

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    /** 502 = upstream failure worth retrying another way; others are final. */
    readonly status = 502,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

const TIMEOUT_MS = 25_000;

export interface ServiceInfo {
  /** Shown to the user, e.g. "Azure Speech". */
  name: string;
  /** Headers that authenticate every request. */
  authHeaders: () => Record<string, string>;
  /** Hint for a rejected key, e.g. "Check ELEVENLABS_API_KEY." */
  keyHint: string;
}

/** fetch with a timeout and friendly errors. Non-2xx responses throw SpeechError. */
export async function speechFetch(service: ServiceInfo, what: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "User-Agent": "laoshi-tutor", ...service.authHeaders(), ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpeechError(`${service.name} ${what}: ${String(error)}`, `Couldn't reach ${service.name}. Please try again.`);
  }
  if (response.ok) return response;

  const body = (await response.text().catch(() => "")).slice(0, 600);
  const detail = `${service.name} ${what}: HTTP ${response.status} ${body}`;
  if (/quota_exceeded|insufficient.?credits/i.test(body)) {
    throw new SpeechError(detail, `You've run out of ${service.name} credits for now.`, 402);
  }
  if (response.status === 401 || response.status === 403) {
    throw new SpeechError(detail, `${service.name} rejected the API key. ${service.keyHint}`, 500);
  }
  if (response.status === 429) {
    throw new SpeechError(detail, `${service.name} is busy. Wait a moment and try again.`, 429);
  }
  throw new SpeechError(detail, `${service.name} returned an error.`, response.status === 422 ? 422 : 502);
}
