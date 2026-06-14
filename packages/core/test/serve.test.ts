import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/serve';
import { fixture, testFetcher } from './helpers';

const spec = parseSiteSpec(`
name: quotes
baseUrl: https://quotes.example.com
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
`);

function quotesFetcher() {
  return testFetcher({
    'https://quotes.example.com/': fixture('quotes.html'),
    'https://quotes.example.com/page/2/': fixture('quotes-page2.html'),
  });
}

describe('createServer', () => {
  it('serves resource data as JSON', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/quotes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(5);
  });

  it('honours the ?pages query parameter', async () => {
    const app = createServer(spec, { fetcher: quotesFetcher() });
    const res = await app.request('/quotes?pages=1');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(3);
  });

  it('serves a generated OpenAPI document', async () => {
    const app = createServer(spec, { fetcher: testFetcher({}) });
    const res = await app.request('/openapi.json');
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.paths['/quotes']).toBeDefined();
  });

  it('lists resources at the index route', async () => {
    const app = createServer(spec, { fetcher: testFetcher({}) });
    const body = (await (await app.request('/')).json()) as {
      resources: Array<{ name: string }>;
    };
    expect(body.resources.map((r) => r.name)).toContain('quotes');
  });
});
