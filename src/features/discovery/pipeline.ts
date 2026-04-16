/**
 * Discovery Pipeline
 *
 * Dynamically discovers new subreddits by:
 * 1. Seeding initial subreddits from config
 * 2. Searching Reddit for related communities
 * 3. Scoring each for relevance
 * 4. Storing top ones in DB
 * 5. Pruning low-performers over time
 */

import { prisma } from "@/lib/db";
import {
  SEED_SUBREDDITS,
  MAX_ACTIVE_SUBREDDITS,
  MIN_RELEVANCE_SCORE,
} from "@/features/shared/config";
import { searchSubreddits, fetchSubredditAbout } from "@/features/ingestion";
import { scoreSubredditRelevance } from "./relevance-scorer";

export interface DiscoveryResult {
  seeded: number;
  discovered: number;
  pruned: number;
  totalActive: number;
  duration: number;
}

/**
 * Ensure seed subreddits exist in DB.
 */
async function ensureSeeds(): Promise<number> {
  let seeded = 0;

  for (const [, subs] of Object.entries(SEED_SUBREDDITS)) {
    for (const name of subs) {
      const existing = await prisma.subreddit.findUnique({
        where: { name: name.toLowerCase() },
      });

      if (!existing) {
        const about = await fetchSubredditAbout(name);
        await prisma.subreddit.create({
          data: {
            name: name.toLowerCase(),
            displayName: about?.displayName ?? `r/${name}`,
            description: about?.description ?? "",
            subscribers: about?.subscribers ?? 0,
            activeUsers: about?.activeUsers ?? 0,
            relevanceScore: 80, // Seeds get a high base score
            isActive: true,
            isSeed: true,
          },
        });
        seeded++;
      }
    }
  }

  return seeded;
}

/**
 * Discover new subreddits by searching Reddit for terms related to our domains.
 */
async function discoverNewSubreddits(): Promise<number> {
  // Get existing names to avoid duplicates
  const existing = await prisma.subreddit.findMany({
    select: { name: true },
  });
  const existingNames = new Set(existing.map((s: { name: string }) => s.name));

  // Search terms derived from top-performing subreddits + seed domains
  const topSubs = await prisma.subreddit.findMany({
    where: { isActive: true },
    orderBy: { relevanceScore: "desc" },
    take: 5,
    select: { name: true, description: true },
  });

  const searchTerms = [
    ...topSubs.map((s: { name: string }) => s.name),
    ...Object.keys(SEED_SUBREDDITS),
    // Cross-domain search terms
    "fitness motivation",
    "healthy lifestyle",
    "self improvement tips",
    "workout community",
    "mental wellness",
  ];

  let discovered = 0;

  // Only search a few terms per run to stay within rate limits
  const termsThisRun = searchTerms.slice(0, 3);

  for (const term of termsThisRun) {
    const results = await searchSubreddits(term, 10);

    for (const r of results) {
      const normalizedName = r.name.toLowerCase();
      if (existingNames.has(normalizedName)) continue;
      if (!normalizedName || normalizedName.length < 2) continue;

      const score = scoreSubredditRelevance({
        name: normalizedName,
        subscribers: r.subscribers,
        activeUsers: 0, // Not available from search
        description: r.description,
      });

      if (score < MIN_RELEVANCE_SCORE) continue;

      // Fetch full about for active user count
      const about = await fetchSubredditAbout(normalizedName);
      const finalScore = about
        ? scoreSubredditRelevance({
            name: normalizedName,
            subscribers: about.subscribers,
            activeUsers: about.activeUsers,
            description: about.description,
          })
        : score;

      if (finalScore < MIN_RELEVANCE_SCORE) continue;

      try {
        await prisma.subreddit.create({
          data: {
            name: normalizedName,
            displayName: about?.displayName ?? `r/${normalizedName}`,
            description: (about?.description ?? r.description).slice(0, 500),
            subscribers: about?.subscribers ?? r.subscribers,
            activeUsers: about?.activeUsers ?? 0,
            relevanceScore: finalScore,
            isActive: true,
            isSeed: false,
          },
        });
        existingNames.add(normalizedName);
        discovered++;
      } catch {
        // Unique constraint or other error — skip
      }
    }
  }

  return discovered;
}

/**
 * Prune low-performing subreddits and enforce max active limit.
 */
async function pruneSubreddits(): Promise<number> {
  // Deactivate non-seed subreddits with very low relevance
  const pruned = await prisma.subreddit.updateMany({
    where: {
      isSeed: false,
      relevanceScore: { lt: MIN_RELEVANCE_SCORE / 2 },
      isActive: true,
    },
    data: { isActive: false },
  });

  // If still over limit, deactivate lowest-scoring non-seeds
  const activeCount = await prisma.subreddit.count({ where: { isActive: true } });
  if (activeCount > MAX_ACTIVE_SUBREDDITS) {
    const excess = activeCount - MAX_ACTIVE_SUBREDDITS;
    const toDeactivate = await prisma.subreddit.findMany({
      where: { isActive: true, isSeed: false },
      orderBy: { relevanceScore: "asc" },
      take: excess,
      select: { id: true },
    });

    if (toDeactivate.length > 0) {
      await prisma.subreddit.updateMany({
        where: { id: { in: toDeactivate.map((s: { id: string }) => s.id) } },
        data: { isActive: false },
      });
      return pruned.count + toDeactivate.length;
    }
  }

  return pruned.count;
}

/**
 * Run the full discovery cycle.
 */
export async function runDiscovery(): Promise<DiscoveryResult> {
  const start = Date.now();

  const seeded = await ensureSeeds();
  const discovered = await discoverNewSubreddits();
  const pruned = await pruneSubreddits();

  const totalActive = await prisma.subreddit.count({
    where: { isActive: true },
  });

  return {
    seeded,
    discovered,
    pruned,
    totalActive,
    duration: Date.now() - start,
  };
}




