/**
 * Discovery Pipeline
 *
 * Designed to complete within Vercel's 10s function limit.
 * Each cron invocation does ONE small unit of work:
 *
 *   Phase A — Seed:     Insert up to SEEDS_PER_RUN missing seeds (NO Reddit API calls)
 *   Phase B — Discover: Run ONE search query, score results, save top candidates
 *                        (max 2 fetchAbout() calls to stay within budget)
 *   Phase C — Prune:    Pure DB operation, always runs, always fast
 *
 * A cursor in IngestionCursor (reused as "discoverySearchOffset") tracks
 * which search term to use next so each run advances through the term list.
 */

import { prisma } from "@/lib/db";
import {
  SEED_SUBREDDITS,
  MAX_ACTIVE_SUBREDDITS,
  MIN_RELEVANCE_SCORE,
} from "@/features/shared/config";
import { searchSubreddits, fetchSubredditAbout } from "@/features/ingestion";
import { scoreSubredditRelevance } from "./relevance-scorer";

// ─── Tuning constants ────────────────────────────────────────────────────────

/** Seeds inserted per cron run (no Reddit API — just DB writes, very fast) */
const SEEDS_PER_RUN = 5;

/** Max fetchAbout() calls during discovery (each = 1 Reddit API call) */
const MAX_ABOUT_CALLS = 2;

/** Flat list of all seed subreddit names */
const ALL_SEEDS = Object.values(SEED_SUBREDDITS).flat();

/** Search terms rotated each run */
const SEARCH_TERMS = [
  "fitness motivation",
  "healthy lifestyle",
  "self improvement",
  "workout community",
  "mental wellness",
  "nutrition tips",
  "gym beginner",
  "weight loss journey",
  "bodyweight training",
  "running community",
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiscoveryResult {
  phase: "seed" | "discover" | "prune-only";
  seeded: number;
  discovered: number;
  pruned: number;
  totalActive: number;
  duration: number;
}

// ─── Phase A: Seed ───────────────────────────────────────────────────────────

/**
 * Insert up to SEEDS_PER_RUN missing seed subreddits.
 * No Reddit API calls — metadata will be filled lazily by ingestion.
 * Returns the number inserted.
 */
async function seedNext(): Promise<number> {
  const existing = await prisma.subreddit.findMany({
    where: { isSeed: true },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((s: { name: string }) => s.name));

  const missing = ALL_SEEDS
    .map((n) => n.toLowerCase())
    .filter((n) => !existingNames.has(n));

  if (missing.length === 0) return 0;

  const batch = missing.slice(0, SEEDS_PER_RUN);
  let inserted = 0;

  for (const name of batch) {
    try {
      await prisma.subreddit.create({
        data: {
          name,
          displayName: `r/${name}`,
          description: "",
          subscribers: 0,
          activeUsers: 0,
          relevanceScore: 80,
          isActive: true,
          isSeed: true,
        },
      });
      inserted++;
    } catch {
      // Already exists — race condition, skip
    }
  }

  return inserted;
}

// ─── Phase B: Discover ───────────────────────────────────────────────────────

/**
 * Run one search term, score candidates, save relevant ones.
 * MAX_ABOUT_CALLS limits Reddit API usage to stay within 10s.
 */
async function discoverOne(searchTermIndex: number): Promise<number> {
  const term = SEARCH_TERMS[searchTermIndex % SEARCH_TERMS.length];

  const existing = await prisma.subreddit.findMany({
    select: { name: true },
  });
  const existingNames = new Set(existing.map((s: { name: string }) => s.name));

  const results = await searchSubreddits(term, 15);

  // Pre-score all results using search data only (no extra API calls yet)
  const candidates = results
    .map((r) => ({
      ...r,
      name: r.name.toLowerCase(),
      score: scoreSubredditRelevance({
        name: r.name.toLowerCase(),
        subscribers: r.subscribers,
        activeUsers: 0,
        description: r.description,
      }),
    }))
    .filter(
      (r) =>
        r.name.length >= 2 &&
        !existingNames.has(r.name) &&
        r.score >= MIN_RELEVANCE_SCORE
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ABOUT_CALLS); // Only fetch about for the top N

  let discovered = 0;

  for (const candidate of candidates) {
    const about = await fetchSubredditAbout(candidate.name);

    const finalScore = about
      ? scoreSubredditRelevance({
          name: candidate.name,
          subscribers: about.subscribers,
          activeUsers: about.activeUsers,
          description: about.description,
        })
      : candidate.score;

    if (finalScore < MIN_RELEVANCE_SCORE) continue;

    try {
      await prisma.subreddit.create({
        data: {
          name: candidate.name,
          displayName: about?.displayName ?? `r/${candidate.name}`,
          description: (about?.description ?? candidate.description).slice(0, 500),
          subscribers: about?.subscribers ?? candidate.subscribers,
          activeUsers: about?.activeUsers ?? 0,
          relevanceScore: finalScore,
          isActive: true,
          isSeed: false,
        },
      });
      existingNames.add(candidate.name);
      discovered++;
    } catch {
      // Unique constraint — skip
    }
  }

  return discovered;
}

// ─── Phase C: Prune ──────────────────────────────────────────────────────────

async function pruneSubreddits(): Promise<number> {
  const pruned = await prisma.subreddit.updateMany({
    where: {
      isSeed: false,
      relevanceScore: { lt: MIN_RELEVANCE_SCORE / 2 },
      isActive: true,
    },
    data: { isActive: false },
  });

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

// ─── Cursor helpers ──────────────────────────────────────────────────────────
// We store the discovery search-term index in a dedicated row in IngestionCursor
// using id = "discovery" to avoid colliding with ingestion's "singleton".

async function getDiscoveryOffset(): Promise<number> {
  const row = await prisma.ingestionCursor.upsert({
    where: { id: "discovery" },
    create: { id: "discovery", offset: 0 },
    update: {},
  });
  return row.offset;
}

async function advanceDiscoveryOffset(current: number) {
  await prisma.ingestionCursor.update({
    where: { id: "discovery" },
    data: {
      offset: (current + 1) % SEARCH_TERMS.length,
      lastRunAt: new Date(),
    },
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runDiscovery(): Promise<DiscoveryResult> {
  const start = Date.now();

  // Phase A — seed missing seeds first (fast, no Reddit calls)
  const seeded = await seedNext();

  let discovered = 0;
  let phase: DiscoveryResult["phase"] = "prune-only";

  if (seeded > 0) {
    // This run was a seeding run — don't also hit Reddit for discovery
    phase = "seed";
  } else {
    // All seeds exist — do one discovery search
    phase = "discover";
    const offset = await getDiscoveryOffset();
    discovered = await discoverOne(offset);
    await advanceDiscoveryOffset(offset);
  }

  // Phase C — prune (pure DB, always fast)
  const pruned = await pruneSubreddits();

  const totalActive = await prisma.subreddit.count({ where: { isActive: true } });

  return {
    phase,
    seeded,
    discovered,
    pruned,
    totalActive,
    duration: Date.now() - start,
  };
}

