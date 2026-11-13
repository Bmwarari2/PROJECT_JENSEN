import { NextResponse, type NextRequest } from "next/server";
import { BadRequest, handleRouteError, jsonError, readWavField } from "@/lib/api";
import { assessPronunciation } from "@/lib/speech/azure";
import { recordAttempt } from "@/lib/db";
import { containsHan } from "@/lib/pinyin";
import type { PronunciationResult } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const field = (form: FormData, name: string, max: number) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};

/** Score a recording of the learner saying the current practice item. */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const target = {
      hanzi: field(form, "hanzi", 40),
      pinyin: field(form, "pinyin", 200),
      english: field(form, "english", 200),
    };
    if (!containsHan(target.hanzi)) throw new BadRequest("Missing the Chinese text to practise.");
    const rawConversationId = field(form, "conversationId", 64);
    const conversationId = UUID.test(rawConversationId) ? rawConversationId : null;
    // Azure scores at most 30 seconds of audio per request.
    const wav = await readWavField(form, "audio", 30);

    const outcome = await assessPronunciation(wav, target.hanzi);
    if (outcome.status === "no_speech") {
      return jsonError(422, "I couldn't hear anything. Check your mic and try again.");
    }
    if (outcome.status === "no_match") {
      return jsonError(422, "I heard you, but couldn't make it out as Mandarin. Try again a little louder and slower.");
    }
    if (outcome.status === "error") {
      console.error("[pronounce]", outcome.detail);
      return jsonError(502, "The pronunciation check failed. Please try again.");
    }

    const saved = await recordAttempt({
      conversationId,
      target,
      recognized: outcome.recognized,
      scores: outcome.scores,
      words: outcome.words,
    });
    const result: PronunciationResult = {
      attemptId: saved.id,
      target,
      recognized: outcome.recognized,
      scores: outcome.scores,
      words: outcome.words,
      passed: saved.passed,
    };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BadRequest) return jsonError(400, error.message);
    return handleRouteError("pronounce", error);
  }
}
