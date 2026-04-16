import { NextResponse } from "next/server";

/**
 * Verify CRON_SECRET header for cron API routes.
 * Returns null if valid, or an error Response if invalid.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("CRON_SECRET not set — allowing request in development");
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
    return null;
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

