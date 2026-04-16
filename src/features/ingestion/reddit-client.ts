/**
 * Reddit Public JSON API Client
 *
 * Uses Reddit's public .json endpoints — no authentication required.
 * Includes built-in rate limiting and retry logic for 429 responses.
 */

import { redditRateLimiter } from "@/features/shared";
import { REDDIT_BASE_URL, REDDIT_USER_AGENT } from "@/features/shared/config";

interface RedditListingResponse {
  kind: "Listing";
  data: {
    children: RedditRawChild[];
    after: string | null;
  };
}

interface RedditRawChild {
  kind: string;
  data: {
    id: string;
    title: string;
    subreddit: string;
    ups: number;
    num_comments: number;
    created_utc: number;
    permalink: string;
    url: string;
    selftext: string;
    author: string;
    link_flair_text?: string | null;
    over_18: boolean;
  };
}

export interface RawRedditPost {
  id: string;
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  upvotes: number;
  comments: number;
  createdUtc: number;
  permalink: string;
  url: string;
  flair: string | null;
  isNsfw: boolean;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await redditRateLimiter.acquire();

    const res = await fetch(url, {
      headers: { "User-Agent": REDDIT_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) return res;

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "3", 10);
      const wait = Math.max(retryAfter * 1000, RETRY_DELAY_MS) * (attempt + 1);
      console.warn(`Reddit 429 — waiting ${wait}ms (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (res.status === 403 || res.status === 404) {
      throw new Error(`Reddit ${res.status} for ${url}`);
    }

    throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
  }
  throw new Error(`Reddit API failed after ${MAX_RETRIES + 1} attempts`);
}

/**
 * Fetch posts from a subreddit listing (hot, rising, new, top).
 */
export async function fetchSubredditPosts(
  subreddit: string,
  sort: "hot" | "rising" | "new" | "top" = "hot",
  limit = 25
): Promise<RawRedditPost[]> {
  const url = `${REDDIT_BASE_URL}/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;

  try {
    const res = await fetchWithRetry(url);
    const json: RedditListingResponse = await res.json();

    return json.data.children
      .filter((c) => c.kind === "t3")
      .map((c) => ({
        id: c.data.id,
        title: c.data.title,
        selftext: c.data.selftext ?? "",
        subreddit: c.data.subreddit,
        author: c.data.author,
        upvotes: c.data.ups,
        comments: c.data.num_comments,
        createdUtc: c.data.created_utc,
        permalink: c.data.permalink,
        url: c.data.url,
        flair: c.data.link_flair_text ?? null,
        isNsfw: c.data.over_18,
      }));
  } catch (error) {
    console.error(`Failed to fetch r/${subreddit}/${sort}:`, error);
    return [];
  }
}

/**
 * Fetch subreddit metadata (about).
 */
export async function fetchSubredditAbout(subreddit: string): Promise<{
  name: string;
  displayName: string;
  description: string;
  subscribers: number;
  activeUsers: number;
} | null> {
  const url = `${REDDIT_BASE_URL}/r/${subreddit}/about.json?raw_json=1`;

  try {
    const res = await fetchWithRetry(url);
    const json = await res.json();
    const d = json.data;
    return {
      name: d.display_name?.toLowerCase() ?? subreddit,
      displayName: d.display_name_prefixed ?? `r/${subreddit}`,
      description: (d.public_description ?? "").slice(0, 500),
      subscribers: d.subscribers ?? 0,
      activeUsers: d.accounts_active ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Search for subreddits by query.
 */
export async function searchSubreddits(
  query: string,
  limit = 10
): Promise<Array<{ name: string; subscribers: number; description: string }>> {
  const url = `${REDDIT_BASE_URL}/subreddits/search.json?q=${encodeURIComponent(query)}&limit=${limit}&raw_json=1`;

  try {
    const res = await fetchWithRetry(url);
    const json: RedditListingResponse = await res.json();

    return (json.data.children as Array<{ data: Record<string, unknown> }>).map((c) => ({
      name: (c.data.display_name as string)?.toLowerCase() ?? "",
      subscribers: (c.data.subscribers as number) ?? 0,
      description: ((c.data.public_description as string) ?? "").slice(0, 300),
    }));
  } catch {
    return [];
  }
}

