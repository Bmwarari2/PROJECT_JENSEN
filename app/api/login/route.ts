import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

const Body = z.object({ password: z.string().max(500) });

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your password." }, { status: 400 });

  let ok: boolean;
  try {
    ok = passwordMatches(parsed.data.password);
  } catch (error) {
    console.error("[login]", error);
    return NextResponse.json({ error: "Login isn't configured: set APP_PASSWORD and SESSION_SECRET." }, { status: 500 });
  }
  if (!ok) {
    // Slow down guessing.
    await new Promise((resolve) => setTimeout(resolve, 750));
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
