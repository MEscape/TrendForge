/**
 * Subreddit Relevance Scorer
 *
 * Heuristic-based scoring to evaluate whether a subreddit is
 * high-signal and relevant to our seed domains.
 */

import { SEED_DOMAINS } from "@/features/shared/config";

interface SubredditSignals {
  name: string;
  subscribers: number;
  activeUsers: number;
  description: string;
}

/**
 * Score a subreddit 0-100 based on heuristics:
 * - Size factor: sweet spot is 50k-2M subscribers
 * - Activity ratio: activeUsers/subscribers
 * - Keyword relevance: description matches seed domain terms
 * - Name quality: short names, no excessive numbers/special chars
 */
export function scoreSubredditRelevance(sub: SubredditSignals): number {
  let score = 0;

  // 1. Size factor (0-30 points)
  // Sweet spot: 50k-2M. Too small = low signal, too big = noise
  const subs = sub.subscribers;
  if (subs >= 50_000 && subs <= 2_000_000) {
    score += 30;
  } else if (subs >= 10_000 && subs < 50_000) {
    score += 20;
  } else if (subs > 2_000_000 && subs <= 10_000_000) {
    score += 15;
  } else if (subs >= 5_000) {
    score += 10;
  }

  // 2. Activity ratio (0-25 points)
  if (subs > 0 && sub.activeUsers > 0) {
    const ratio = sub.activeUsers / subs;
    if (ratio > 0.005) score += 25;
    else if (ratio > 0.002) score += 20;
    else if (ratio > 0.001) score += 15;
    else if (ratio > 0.0005) score += 10;
  }

  // 3. Keyword relevance (0-30 points)
  const desc = `${sub.name} ${sub.description}`.toLowerCase();
  const domainKeywords = getDomainKeywords();
  let matches = 0;
  for (const kw of domainKeywords) {
    if (desc.includes(kw)) matches++;
  }
  score += Math.min(30, matches * 10);

  // 4. Name quality (0-15 points)
  if (sub.name.length <= 20 && !/\d{3,}/.test(sub.name)) {
    score += 15;
  } else if (sub.name.length <= 30) {
    score += 8;
  }

  return Math.min(100, score);
}

function getDomainKeywords(): string[] {
  const keywords: string[] = [];
  for (const domain of SEED_DOMAINS) {
    keywords.push(domain);
  }
  // Add common related terms
  keywords.push(
    "workout", "exercise", "health", "wellness", "diet",
    "motivation", "discipline", "mindset", "habit", "goal",
    "weight", "muscle", "strength", "cardio", "yoga",
    "meditation", "sleep", "recovery", "supplement", "protein",
    "mental", "anxiety", "stress", "focus", "energy"
  );
  return [...new Set(keywords)];
}

