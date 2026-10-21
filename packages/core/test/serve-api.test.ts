import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import { PoliteFetcher } from '../src/fetch';
import { createServer } from '../src/serve';
import { fakeFetch, fixture, testFetcher } from './helpers';

const spec = parseSiteSpec(`
name: quotes
baseUrl: https://quotes.example.com
politeness: { cacheTtl: 5m }
resources:
  - name: quotes
    fetch:
      path: /
      pagination: { type: link, selector: "li.next a", maxPages: 5 }
    list:
      selector: .quote
      fields:
        text: .text
        author: .author
  - name: author
    fetch: { path: "/author/{slug}/" }
    item:
      fields:
        name: h3
`);

function quotesFetcher() {
  return testFetcher({
    'https://quotes.example.com/': fixture('quotes.html'),
    'https://quotes.example.com/page/2/': fixture('quotes-page2.html'),
  });
}

interface ErrorJson {
  error: { code: string; message: string; param?: string };
  requestId: string;
}

describe('createServer: request validation and errors', () => {
  it('answers a missing path parameter with 400 and names it', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/author');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorJson;
    expect(body.error).toMatchObject({ code: 'bad-request', param: 'slug' });
    expect(body.requestId).toBeTruthy();
  });

  it('rejects a non-numeric pages value instead of silently using 1', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/quotes?pages=abc');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorJson).error.param).toBe('pages');
  });

  it('caps pages at maxPagesLimit', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher(), maxPagesLimit: 3 });
    expect((await app.request('/quotes?pages=4')).status).toBe(400);
    expect((await app.request('/quotes?pages=3')).status).toBe(200);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as ErrorJson).error.code).toBe('not-found');
  });

  it('maps an upstream HTTP failure to 502', async () => {
    const app = createServer(spec, { fetcher: testFetcher({}) });
    const res = await app.request('/quotes');
    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorJson).error.code).toBe('upstream-http-error');
  });

  it('maps a robots.txt block to 403', async () => {
    const fetcher = new PoliteFetcher({
      userAgent: 'daddyapi-test',
      requestsPerSecond: 1000,
      respectRobotsTxt: true,
      cacheTtlMs: 0,
      timeoutMs: 5000,
      maxRetries: 0,
      fetchImpl: fakeFetch({
        'https://quotes.example.com/robots.txt': 'User-agent: *\nDisallow: /',
        'https://quotes.example.com/': fixture('quotes.html'),
      }),
    });
    const app = createServer(spec, { fetcher });
    const res = await app.request('/quotes');
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorJson).error.code).toBe('robots-disallowed');
  });
});

describe('createServer: shaping results', () => {
  it('applies limit, offset and fields and reports totals in meta', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/quotes?pages=1&offset=1&limit=1&fields=author');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; meta: Record<string, unknown> };
    expect(body.data).toHaveLength(1);
    expect(Object.keys(body.data[0]!)).toEqual(['author']);
    expect(body.meta).toMatchObject({ total: 3, returned: 1, offset: 1, limit: 1, fields: ['author'] });
  });
});

describe('createServer: HTTP behaviour', () => {
  it('sends CORS headers by default and can turn them off', async () => {
    const on = createServer(spec, { fetcher: quotesFetcher() });
    const res = await on.request('/quotes', { headers: { Origin: 'https://app.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const off = createServer(spec, { fetcher: quotesFetcher(), cors: false });
    const res2 = await off.request('/quotes', { headers: { Origin: 'https://app.example' } });
    expect(res2.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a preflight request', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher(), cors: 'https://app.example' });
    const res = await app.request('/quotes', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
  });

  it('sets an ETag and returns 304 when it matches', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const first = await app.request('/quotes?pages=1&fields=author');
    const tag = first.headers.get('etag');
    expect(tag).toBeTruthy();
    expect(first.headers.get('cache-control')).toBe('public, max-age=300');
    const second = await app.request('/quotes?pages=1&fields=author', { headers: { 'If-None-Match': tag! } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    // Different content, different tag.
    const other = await app.request('/quotes?pages=1&fields=text', { headers: { 'If-None-Match': tag! } });
    expect(other.status).toBe(200);
    expect(other.headers.get('etag')).not.toBe(tag);
  });

  it('gives the static routes an ETag too', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const doc = await app.request('/openapi.json');
    const tag = doc.headers.get('etag')!;
    expect((await app.request('/openapi.json', { headers: { 'If-None-Match': tag } })).status).toBe(304);
  });

  it('echoes or creates a request id', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/health', { headers: { 'X-Request-Id': 'abc-123' } });
    expect(res.headers.get('x-request-id')).toBe('abc-123');
    const res2 = await app.request('/health');
    expect(res2.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('serves /health', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const body = (await (await app.request('/health')).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', name: 'quotes', resources: 2 });
  });
});

describe('createServer: API keys', () => {
  const app = () => createServer(spec, { fetcher: quotesFetcher(), apiKeys: ['s3cret', 'other'] });

  it('requires a key on resource routes', async () => {
    const res = await app().request('/quotes');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect(((await res.json()) as ErrorJson).error.code).toBe('unauthorized');
  });

  it('rejects a wrong key', async () => {
    const res = await app().request('/quotes', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorJson).error.message).toBe('Invalid API key');
  });

  it('accepts a bearer token or an X-API-Key header', async () => {
    expect((await app().request('/quotes?pages=1', { headers: { Authorization: 'Bearer s3cret' } })).status).toBe(200);
    const res = await app().request('/quotes?pages=1', { headers: { 'X-API-Key': 'other' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/^private/);
  });

  it('keeps index, health, docs and OpenAPI public, and documents the scheme', async () => {
    for (const path of ['/', '/health', '/docs', '/openapi.json']) {
      expect((await app().request(path)).status).toBe(200);
    }
    const doc = (await (await app().request('/openapi.json')).json()) as {
      components: { securitySchemes?: Record<string, unknown> };
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(doc.paths['/quotes']!.get.responses).toHaveProperty('401');
  });
});

describe('createServer: rate limiting', () => {
  it('allows the limit, then answers 429 with Retry-After', async () => {
    const app = createServer(spec, {
      fetcher: quotesFetcher(),
      rateLimit: { limit: 2, windowMs: 60_000 },
      clientId: () => '10.0.0.1',
    });
    const a = await app.request('/quotes?pages=1');
    expect(a.status).toBe(200);
    expect(a.headers.get('ratelimit-limit')).toBe('2');
    expect(a.headers.get('ratelimit-remaining')).toBe('1');
    expect((await app.request('/quotes?pages=1')).status).toBe(200);
    const c = await app.request('/quotes?pages=1');
    expect(c.status).toBe(429);
    expect(Number(c.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await c.json()) as ErrorJson).error.code).toBe('rate-limited');
  });

  it('counts clients separately', async () => {
    let ip = '1.1.1.1';
    const app = createServer(spec, {
      fetcher: quotesFetcher(),
      rateLimit: { limit: 1 },
      clientId: () => ip,
    });
    expect((await app.request('/quotes?pages=1')).status).toBe(200);
    expect((await app.request('/quotes?pages=1')).status).toBe(429);
    ip = '2.2.2.2';
    expect((await app.request('/quotes?pages=1')).status).toBe(200);
  });

  it('does not rate-limit the public routes', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher(), rateLimit: { limit: 1 }, clientId: () => 'x' });
    for (let i = 0; i < 3; i++) expect((await app.request('/health')).status).toBe(200);
  });
});
