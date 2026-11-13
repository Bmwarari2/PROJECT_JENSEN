import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api";
import { synthesize } from "@/lib/speech/azure";
import type { TtsRequest } from "@/lib/types";

const Body = z.object({
  segments: z
    .array(z.object({ lang: z.enum(["en", "zh"]), text: z.string().max(1000) }))
    .min(1)
    .max(40),
  slowChinese: z.boolean(),
}) satisfies z.ZodType<TtsRequest>;

// Replaying a word is common (tap to hear it again), so keep recent audio in
// memory. ~200 short clips is only a few MB.
const CACHE_LIMIT = 200;
const cache = new Map<string, Uint8Array>();

function remember(key: string, audio: Uint8Array) {
  cache.delete(key);
  cache.set(key, audio);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  const totalChars = parsed.data.segments.reduce((n, s) => n + s.text.length, 0);
  if (totalChars > 3000) return jsonError(400, "That's too much text to read aloud at once.");

  const key = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  try {
    let audio = cache.get(key);
    if (audio) {
      remember(key, audio); // refresh recency
    } else {
      audio = await synthesize(parsed.data.segments, parsed.data.slowChinese);
      remember(key, audio);
    }
    return new Response(audio as BodyInit, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" },
    });
  } catch (error) {
    return handleRouteError("tts", error);
  }
}
