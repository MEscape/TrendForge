/** Seed domains — the discovery system expands from these */
export const SEED_DOMAINS = [
  "fitness",
  "selfimprovement",
  "nutrition",
  "mentalhealth",
  "productivity",
] as const;

/** Seed subreddits per domain — small set, discovery expands dynamically */
export const SEED_SUBREDDITS: Record<string, string[]> = {
  fitness: ["fitness", "gym", "bodybuilding"],
  selfimprovement: ["selfimprovement", "getdisciplined", "DecidingToBeBetter"],
  nutrition: ["nutrition", "mealprepsunday", "intermittentfasting"],
  mentalhealth: ["mentalhealth", "anxiety", "meditation"],
  productivity: ["productivity", "getmotivated", "lifeprotips"],
};

export const REDDIT_BASE_URL = "https://www.reddit.com";

/**
 * User-Agent MUST follow Reddit's required format:
 * <platform>:<app_id>:<version> (by /u/<reddit_username>)
 * Set REDDIT_USERNAME in env to personalise; defaults to a generic value.
 */
export const REDDIT_USER_AGENT = `web:trendforge:v2.0 (by /u/${process.env.REDDIT_USERNAME ?? "trendforgebot"})`;

/** Max subreddits to fetch per cron invocation (Vercel 10s limit) */
export const INGESTION_BATCH_SIZE = 5;

/** Posts to fetch per subreddit */
export const POSTS_PER_SUBREDDIT = 25;

/** Max active subreddits to maintain */
export const MAX_ACTIVE_SUBREDDITS = 50;

/** Minimum relevance score to keep a subreddit active */
export const MIN_RELEVANCE_SCORE = 20;

/** How many top trending posts to keep for processing */
export const TOP_TRENDING_COUNT = 40;

/** HuggingFace analysis limit */
export const HF_ANALYSIS_LIMIT = 40;
