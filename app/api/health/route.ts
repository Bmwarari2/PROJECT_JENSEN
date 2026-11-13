// Used by Railway's health check. Deliberately touches no external services.
export function GET() {
  return Response.json({ ok: true });
}
