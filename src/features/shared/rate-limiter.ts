/**
 * Token-bucket rate limiter for Reddit API requests.
 * Reddit allows ~60 requests/minute for unauthenticated access.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number = 30,
    private refillRate: number = 30, // tokens per minute
    private refillIntervalMs: number = 60_000
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor((elapsed / this.refillIntervalMs) * this.refillRate);
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // Wait until a token is available
    const waitMs = Math.ceil(this.refillIntervalMs / this.refillRate);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens--;
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}

/** Singleton rate limiter for Reddit requests */
export const redditRateLimiter = new RateLimiter(30, 30, 60_000);

