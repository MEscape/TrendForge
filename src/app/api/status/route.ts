import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/status — System health dashboard data
 */
export async function GET() {
  const [
    totalSubreddits,
    activeSubreddits,
    totalPosts,
    scoredPosts,
    classifiedPosts,
    processedPosts,
    cursor,
  ] = await Promise.all([
    prisma.subreddit.count(),
    prisma.subreddit.count({ where: { isActive: true } }),
    prisma.redditPost.count(),
    prisma.redditPost.count({ where: { status: "SCORED" } }),
    prisma.redditPost.count({ where: { status: "CLASSIFIED" } }),
    prisma.redditPost.count({ where: { status: "PROCESSED" } }),
    prisma.ingestionCursor.findUnique({ where: { id: "singleton" } }),
  ]);

  return NextResponse.json({
    subreddits: { total: totalSubreddits, active: activeSubreddits },
    posts: {
      total: totalPosts,
      scored: scoredPosts,
      classified: classifiedPosts,
      processed: processedPosts,
    },
    lastIngestion: cursor?.lastRunAt ?? null,
    ingestionOffset: cursor?.offset ?? 0,
    timestamp: new Date().toISOString(),
  });
}

