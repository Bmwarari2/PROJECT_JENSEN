// Used by Railway's health check. Deliberately touches no external services.
// Reports the deployed commit (set by Railway) so a deploy can be verified.
export function GET() {
  return Response.json({ ok: true, commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null });
}
