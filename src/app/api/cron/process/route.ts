import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { runProcessing } from "@/features/processing";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const result = await runProcessing();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Processing cron failed:", error);
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}

