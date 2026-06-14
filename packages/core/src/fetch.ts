import { parseDuration, type Politeness } from '@daddyapi/spec';
import { type Cache, MemoryCache } from './cache';
import { crawlDelay, isAllowed, parseRobots, type Robots, userAgentToken } from './robots';

export type FetchErrorCode =
  | 'robots-disallowed'
  | 'timeout'
  | 'http-error'
  | 'network-error';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly code: FetchErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface PoliteFetcherOptions {
  userAgent: string;
  requestsPerSecond: number;
  respectRobotsTxt: boolean;
  cacheTtlMs: number;
  timeoutMs: number;
  maxRetries: number;
  cache?: Cache;
  /** Injectable fetch (used in tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FetchResult {
  html: string;
  finalUrl: string;
  fromCache: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A well-behaved HTTP client: honours robots.txt, rate-limits per origin,
 * caches responses, retries transient failures, and always identifies itself.
 */
export class PoliteFetcher {
  private cache: Cache;
  private fetchImpl: typeof fetch;
  private token: string;
  private baseIntervalMs: number;
  private robotsByOrigin = new Map<string, Robots | null>();
  private nextAllowedByOrigin = new Map<string, number>();

  constructor(private options: PoliteFetcherOptions) {
    this.cache = options.cache ?? new MemoryCache();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = userAgentToken(options.userAgent);
    this.baseIntervalMs = 1000 / Math.max(options.requestsPerSecond, 0.001);
  }

  async getHtml(url: string): Promise<FetchResult> {
    const cached = await this.cache.get(url);
    if (cached && Date.now() - cached.storedAt < this.options.cacheTtlMs) {
      return { html: cached.body, finalUrl: cached.finalUrl, fromCache: true };
    }

    const target = new URL(url);

    if (this.options.respectRobotsTxt) {
      const robots = await this.loadRobots(target.origin);
      if (robots && !isAllowed(robots, this.token, target.pathname + target.search)) {
        throw new FetchError(
          `robots.txt disallows fetching ${url} for "${this.token}"`,
          'robots-disallowed',
        );
      }
      const delay = robots ? crawlDelay(robots, this.token) : undefined;
      await this.throttle(target.origin, delay ? delay * 1000 : 0);
    } else {
      await this.throttle(target.origin, 0);
    }

    const { body, finalUrl } = await this.fetchWithRetry(url);
    await this.cache.set(url, { body, finalUrl, storedAt: Date.now() });
    return { html: body, finalUrl, fromCache: false };
  }

  private async loadRobots(origin: string): Promise<Robots | null> {
    if (this.robotsByOrigin.has(origin)) return this.robotsByOrigin.get(origin) ?? null;
    let robots: Robots | null = null;
    try {
      const res = await this.rawFetch(`${origin}/robots.txt`);
      if (res.ok) robots = parseRobots(await res.text());
    } catch {
      // No robots.txt (or unreachable) means crawling is allowed.
      robots = null;
    }
    this.robotsByOrigin.set(origin, robots);
    return robots;
  }

  private async throttle(origin: string, extraDelayMs: number): Promise<void> {
    const now = Date.now();
    const next = this.nextAllowedByOrigin.get(origin) ?? 0;
    const wait = next - now;
    if (wait > 0) await sleep(wait);
    const interval = Math.max(this.baseIntervalMs, extraDelayMs);
    this.nextAllowedByOrigin.set(origin, Date.now() + interval);
  }

  private async fetchWithRetry(url: string): Promise<{ body: string; finalUrl: string }> {
    let lastError: FetchError | undefined;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const res = await this.rawFetch(url);
        if (res.status >= 500) {
          lastError = new FetchError(`HTTP ${res.status} from ${url}`, 'http-error', res.status);
        } else if (!res.ok) {
          // 4xx is not retryable.
          throw new FetchError(`HTTP ${res.status} from ${url}`, 'http-error', res.status);
        } else {
          return { body: await res.text(), finalUrl: res.url || url };
        }
      } catch (err) {
        if (err instanceof FetchError && err.code === 'http-error' && err.status && err.status < 500) {
          throw err;
        }
        lastError =
          err instanceof FetchError
            ? err
            : new FetchError(`Request to ${url} failed: ${String(err)}`, 'network-error');
      }
      if (attempt < this.options.maxRetries) await sleep(250 * 2 ** attempt);
    }
    throw lastError ?? new FetchError(`Request to ${url} failed`, 'network-error');
  }

  private async rawFetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        headers: { 'user-agent': this.options.userAgent, accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new FetchError(`Request to ${url} timed out`, 'timeout');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Build a PoliteFetcher from a spec's politeness block, with optional overrides. */
export function createFetcher(
  politeness: Politeness,
  overrides: Partial<PoliteFetcherOptions> = {},
): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: politeness.userAgent,
    requestsPerSecond: politeness.requestsPerSecond,
    respectRobotsTxt: politeness.respectRobotsTxt,
    cacheTtlMs: parseDuration(politeness.cacheTtl),
    timeoutMs: politeness.timeoutMs,
    maxRetries: politeness.maxRetries,
    ...overrides,
  });
}
