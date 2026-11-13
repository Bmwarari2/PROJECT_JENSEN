import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { loadSession } from "@/lib/tutor/session";

/** The active study session (if any) so the app can pick up where you left off. */
export async function GET() {
  try {
    return NextResponse.json(await loadSession());
  } catch (error) {
    return handleRouteError("session", error);
  }
}
