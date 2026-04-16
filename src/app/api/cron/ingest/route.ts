import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { runIngestion } from "@/features/ingestion";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const result = await runIngestion();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Ingestion cron failed:", error);
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}

