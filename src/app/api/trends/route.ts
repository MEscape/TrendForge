import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/trends — Returns top trending posts from DB
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "40"), 100);
  const status = searchParams.get("status") ?? undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const posts = await prisma.redditPost.findMany({
    where,
    orderBy: { trendScore: "desc" },
    take: limit,
    include: {
      subreddit: { select: { name: true, displayName: true } },
      processedData: true,
    },
  });

  const subreddits = [...new Set(posts.map((p: { subredditName: string }) => p.subredditName))];

  return NextResponse.json({
    posts,
    fetchedAt: new Date().toISOString(),
    subreddits,
    count: posts.length,
  });
}


