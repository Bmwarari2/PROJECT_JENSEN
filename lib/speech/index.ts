import "server-only";
import { speechSetup } from "@/lib/env";
import { azureAssessPronunciation, azureSynthesize, azureTranscribe } from "@/lib/speech/azure";
import { clarityCheck } from "@/lib/speech/clarity";
import { elevenHearMandarin, elevenSynthesize, elevenTranscribe } from "@/lib/speech/elevenlabs";
import type { AssessmentOutcome } from "@/lib/speech/pronunciation";
import { containsHan } from "@/lib/pinyin";
import type { Lang, PronunciationMethod } from "@/lib/types";

// One entry point for speech, routed to ElevenLabs or Azure (see speechSetup).

export { SpeechError } from "@/lib/speech/http";

export function synthesize(segments: Array<{ lang: Lang; text: string }>, slowChinese: boolean): Promise<Uint8Array> {
  return speechSetup().tts === "azure" ? azureSynthesize(segments, slowChinese) : elevenSynthesize(segments, slowChinese);
}

export function transcribe(wav: Uint8Array): Promise<string> {
  return speechSetup().stt === "azure" ? azureTranscribe(wav) : elevenTranscribe(wav);
}

export async function assessPronunciation(
  wav: Uint8Array,
  referenceText: string,
): Promise<{ outcome: AssessmentOutcome; method: PronunciationMethod }> {
  if (speechSetup().pronunciation === "azure") {
    return { outcome: await azureAssessPronunciation(wav, referenceText), method: "assessment" };
  }
  const heard = await elevenHearMandarin(wav);
  if (!heard.text) return { outcome: { status: "no_speech" }, method: "recognition" };
  if (!containsHan(heard.text)) return { outcome: { status: "no_match" }, method: "recognition" };
  const { scores, words } = clarityCheck(referenceText, heard.chars);
  return { outcome: { status: "ok", recognized: heard.text, scores, words }, method: "recognition" };
}
