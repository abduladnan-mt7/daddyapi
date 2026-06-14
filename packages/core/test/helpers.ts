import { readFileSync } from 'node:fs';
import { PoliteFetcher } from '../src/fetch';

/** Read an HTML fixture from the fixtures directory. */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** A fetch implementation that serves canned HTML by URL — no network. */
export function fakeFetch(map: Record<string, string>): typeof fetch {
  return (async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const body = map[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
}

/** A PoliteFetcher wired to canned fixtures, with politeness relaxed for tests. */
export function testFetcher(map: Record<string, string>): PoliteFetcher {
  return new PoliteFetcher({
    userAgent: 'daddyapi-test',
    requestsPerSecond: 1000,
    respectRobotsTxt: false,
    cacheTtlMs: 0,
    timeoutMs: 5000,
    maxRetries: 0,
    fetchImpl: fakeFetch(map),
  });
}
