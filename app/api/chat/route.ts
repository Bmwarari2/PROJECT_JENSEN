import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/api";
import { runChatTurn } from "@/lib/tutor/session";
import type { ChatRequest } from "@/lib/types";

const Body = z.object({
  input: z.discriminatedUnion("type", [
    z.object({ type: z.literal("start") }),
    z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(2000), via: z.enum(["voice", "text"]) }),
    z.object({ type: z.literal("attempt"), attemptId: z.number().int().positive() }),
  ]),
  newSession: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
}) satisfies z.ZodType<ChatRequest>;

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Invalid request.");
  try {
    return NextResponse.json(await runChatTurn(parsed.data));
  } catch (error) {
    return handleRouteError("chat", error);
  }
}
