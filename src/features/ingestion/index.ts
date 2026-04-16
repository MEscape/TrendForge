export { runIngestion, type IngestionResult } from "./pipeline";
export { fetchSubredditPosts, fetchSubredditAbout, searchSubreddits } from "./reddit-client";
export type { RawRedditPost } from "./reddit-client";
export { scorePosts, type ScoredPost } from "./trend-scorer";

