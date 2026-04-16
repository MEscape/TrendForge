/**
 * Ingestion Pipeline
 *
 * Fetches posts from a batch of subreddits, scores them, and persists to DB.
 * Designed to run within Vercel's 10s function timeout by processing
 * only a small batch per invocation, using a cursor for continuation.
 */

import { prisma } from "@/lib/db";
import { POSTS_PER_SUBREDDIT } from "@/features/shared/config";
import { fetchSubredditPosts } from "./reddit-client";
import { scorePosts } from "./trend-scorer";

// ─── Tuning ───────────────────────────────────────────────────────────────────
// 3 subs × 2 Reddit calls = 6 API calls
// 3 subs × ~37 posts = ~111 upserts → ~2s on Neon
// Total budget comfortably under 10s
const INGESTION_BATCH_SIZE = 3;

export interface IngestionResult {
  subredditsProcessed: string[];
  postsIngested: number;
  postsUpdated: number;
  nextOffset: number;
  duration: number;
}

/**
 * Run one ingestion cycle:
 * 1. Read cursor to know which subreddits to process next
 * 2. Fetch posts from those subreddits (hot + rising)
 * 3. Score posts
 * 4. Upsert into DB
 * 5. Advance cursor
 */
export async function runIngestion(): Promise<IngestionResult> {
  const start = Date.now();

  // 1. Get active subreddits ordered by relevance
  const allSubs = await prisma.subreddit.findMany({
    where: { isActive: true },
    orderBy: { relevanceScore: "desc" },
    select: { name: true },
  });

  if (allSubs.length === 0) {
    return {
      subredditsProcessed: [],
      postsIngested: 0,
      postsUpdated: 0,
      nextOffset: 0,
      duration: Date.now() - start,
    };
  }

  // 2. Get cursor
  const cursor = await prisma.ingestionCursor.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", offset: 0 },
    update: {},
  });

  const offset = cursor.offset % allSubs.length;
  const batch: string[] = [];
  for (let i = 0; i < INGESTION_BATCH_SIZE && offset + i < allSubs.length; i++) {
    batch.push(allSubs[offset + i].name);
  }

  // 3. Fetch posts from each sub (hot + rising)
  const allPosts = [];
  for (const sub of batch) {
    const [hot, rising] = await Promise.all([
      fetchSubredditPosts(sub, "hot", POSTS_PER_SUBREDDIT),
      fetchSubredditPosts(sub, "rising", Math.floor(POSTS_PER_SUBREDDIT / 2)),
    ]);

    // Deduplicate by ID
    const seen = new Set<string>();
    for (const p of [...hot, ...rising]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        allPosts.push(p);
      }
    }

    // Update lastFetchedAt
    await prisma.subreddit.update({
      where: { name: sub },
      data: { lastFetchedAt: new Date() },
    });
  }

  // 4. Score
  const scored = scorePosts(allPosts);

  // 5. Upsert into DB
  let ingested = 0;
  let updated = 0;

  // Use upsert directly — no prior findUnique needed (halves DB round-trips)
  for (const post of scored) {
    // Filter NSFW
    if (post.isNsfw) continue;

    try {
      const result = await prisma.redditPost.upsert({
        where: { id: post.id },
        create: {
          id: post.id,
          title: post.title,
          selftext: post.selftext.slice(0, 5000),
          author: post.author,
          upvotes: post.upvotes,
          comments: post.comments,
          permalink: post.permalink,
          url: post.url,
          flair: post.flair,
          isNsfw: post.isNsfw,
          createdAtUtc: new Date(post.createdUtc * 1000),
          trendScore: post.trendScore,
          engagementRate: post.engagementRate,
          ageHours: post.ageHours,
          subredditName: post.subreddit.toLowerCase(),
          status: "SCORED",
        },
        update: {
          upvotes: post.upvotes,
          comments: post.comments,
          trendScore: post.trendScore,
          engagementRate: post.engagementRate,
          ageHours: post.ageHours,
        },
        select: { ingestedAt: true, updatedAt: true },
      });
      // If ingestedAt ≈ updatedAt, it was just created
      const isNew = Math.abs(result.ingestedAt.getTime() - result.updatedAt.getTime()) < 1000;
      if (isNew) ingested++; else updated++;
    } catch (error) {
      // Skip posts that fail (e.g. FK violation if subreddit not yet discovered)
      console.warn(`Failed to upsert post ${post.id}:`, error);
    }
  }

  // 6. Advance cursor
  const nextOffset = offset + INGESTION_BATCH_SIZE;
  await prisma.ingestionCursor.update({
    where: { id: "singleton" },
    data: {
      offset: nextOffset >= allSubs.length ? 0 : nextOffset,
      lastRunAt: new Date(),
    },
  });

  return {
    subredditsProcessed: batch,
    postsIngested: ingested,
    postsUpdated: updated,
    nextOffset: nextOffset >= allSubs.length ? 0 : nextOffset,
    duration: Date.now() - start,
  };
}
