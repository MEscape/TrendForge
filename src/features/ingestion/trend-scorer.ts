/**
 * Trend Detection Engine
 *
 * Score formula: trendScore = engagementRate * recencyBoost * antiSaturationFactor
 *
 * - engagementRate = (upvotes + comments * 2) / ageHours
 * - recencyBoost = 1 / (1 + ageHours / 6)
 * - antiSaturation = 1 / (1 + log10(upvotes + 1) / 4)
 */

import type { RawRedditPost } from "./reddit-client";

export interface ScoredPost extends RawRedditPost {
  trendScore: number;
  engagementRate: number;
  ageHours: number;
}

function computeTrendScore(post: RawRedditPost, nowSeconds: number): ScoredPost {
  const ageSeconds = Math.max(nowSeconds - post.createdUtc, 60);
  const ageHours = ageSeconds / 3600;

  const engagementRate = (post.upvotes + post.comments * 2) / ageHours;
  const recencyBoost = 1 / (1 + ageHours / 6);
  const antiSaturation = 1 / (1 + Math.log10(post.upvotes + 1) / 4);

  const trendScore = engagementRate * recencyBoost * antiSaturation;

  return {
    ...post,
    trendScore: Math.round(trendScore * 100) / 100,
    engagementRate: Math.round(engagementRate * 100) / 100,
    ageHours: Math.round(ageHours * 100) / 100,
  };
}

/** Score and rank posts, returning the top N rising trends */
export function scorePosts(posts: RawRedditPost[], limit?: number): ScoredPost[] {
  const now = Math.floor(Date.now() / 1000);

  const scored = posts
    .map((p) => computeTrendScore(p, now))
    .sort((a, b) => b.trendScore - a.trendScore);

  return limit ? scored.slice(0, limit) : scored;
}

