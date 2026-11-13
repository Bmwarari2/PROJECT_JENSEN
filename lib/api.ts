import "server-only";
import { NextResponse } from "next/server";
import { ConfigError } from "@/lib/env";
import { DatabaseError } from "@/lib/db";
import { TutorError } from "@/lib/tutor/engine";
import { SpeechError } from "@/lib/speech/http";
import { readWavInfo, SAMPLE_RATE } from "@/lib/wav";

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Map known failures to a friendly message; log the technical detail. */
export function handleRouteError(route: string, error: unknown) {
  console.error(`[${route}]`, error);
  if (error instanceof TutorError || error instanceof SpeechError) {
    return jsonError(error.status, error.userMessage);
  }
  if (error instanceof DatabaseError) {
    if (error.isConcurrentUpdate) {
      return jsonError(409, "Another reply was being saved at the same time. Refresh to see the latest conversation.");
    }
    return jsonError(500, "Couldn't reach the progress database. Check the Supabase settings and try again.");
  }
  if (error instanceof ConfigError) {
    // Only the signed-in owner sees this, and it says exactly what to fix.
    return jsonError(500, error.message);
  }
  return jsonError(500, "Something went wrong. Please try again.");
}

export class BadRequest extends Error {}

/** Read and validate a 16 kHz mono 16-bit WAV upload from a form field. */
export async function readWavField(form: FormData, field: string, maxSeconds: number): Promise<Uint8Array> {
  const file = form.get(field);
  if (!(file instanceof Blob)) throw new BadRequest("No audio was uploaded.");
  if (file.size > 4 * 1024 * 1024) throw new BadRequest("That recording is too large.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = readWavInfo(bytes);
  if (!info || info.sampleRate !== SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) {
    throw new BadRequest("Unsupported audio format (expected 16 kHz mono WAV).");
  }
  if (info.durationSeconds < 0.3) throw new BadRequest("That recording was too short. Hold on a little longer.");
  if (info.durationSeconds > maxSeconds) {
    throw new BadRequest(`Recordings can be at most ${maxSeconds} seconds long.`);
  }
  return bytes;
}
