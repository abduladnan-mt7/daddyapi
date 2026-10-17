import { readFileSync } from 'node:fs';
import { PoliteFetcher } from '@daddyapi/core';

/** Read an HTML fixture shared with the core package's tests. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../../core/test/fixtures/${name}`, import.meta.url), 'utf8');
}

/** A PoliteFetcher that serves canned HTML by URL, with no network and relaxed politeness. */
export function testFetcher(map: Record<string, string>): PoliteFetcher {
  const fetchImpl = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const body = map[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
  return new PoliteFetcher({
    userAgent: 'daddyapi-test',
    requestsPerSecond: 1000,
    respectRobotsTxt: false,
    cacheTtlMs: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    fetchImpl,
  });
}
