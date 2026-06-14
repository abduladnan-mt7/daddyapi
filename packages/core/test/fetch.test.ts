import { describe, expect, it } from 'vitest';
import { PoliteFetcher } from '../src/fetch';

function fetcher(impl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new PoliteFetcher({
    userAgent: 'daddyapi-bot',
    requestsPerSecond: 1000,
    respectRobotsTxt: false,
    cacheTtlMs: 60_000,
    timeoutMs: 2000,
    maxRetries: 0,
    fetchImpl: impl,
    ...overrides,
  });
}

describe('PoliteFetcher', () => {
  it('serves a second request from cache within TTL', async () => {
    let calls = 0;
    const impl = (async () => {
      calls++;
      return new Response('<html>hi</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const f = fetcher(impl);

    const a = await f.getHtml('https://e.com/x');
    const b = await f.getHtml('https://e.com/x');
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(calls).toBe(1);
  });

  it('refuses URLs disallowed by robots.txt', async () => {
    const impl = (async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /private', { status: 200 });
      }
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const f = fetcher(impl, { respectRobotsTxt: true, cacheTtlMs: 0 });

    await expect(f.getHtml('https://e.com/private/x')).rejects.toThrow(/robots/i);
    const ok = await f.getHtml('https://e.com/public');
    expect(ok.html).toContain('ok');
  });

  it('retries on 5xx then succeeds', async () => {
    let calls = 0;
    const impl = (async () => {
      calls++;
      if (calls < 2) return new Response('err', { status: 503 });
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    const f = fetcher(impl, { maxRetries: 2, cacheTtlMs: 0 });

    const result = await f.getHtml('https://e.com/x');
    expect(result.html).toContain('ok');
    expect(calls).toBe(2);
  });

  it('does not retry 4xx', async () => {
    let calls = 0;
    const impl = (async () => {
      calls++;
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const f = fetcher(impl, { maxRetries: 3, cacheTtlMs: 0 });

    await expect(f.getHtml('https://e.com/x')).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
