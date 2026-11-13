import { NextResponse, type NextRequest } from "next/server";
import { BadRequest, handleRouteError, jsonError, readWavField } from "@/lib/api";
import { transcribe } from "@/lib/speech";
import type { TranscribeResponse } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const wav = await readWavField(form, "audio", 60);
    const body: TranscribeResponse = { text: await transcribe(wav) };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof BadRequest) return jsonError(400, error.message);
    return handleRouteError("transcribe", error);
  }
}
