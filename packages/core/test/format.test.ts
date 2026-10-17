import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import { toCsv, toNdjson } from '../src/format';
import { createServer } from '../src/serve';
import { fixture, testFetcher } from './helpers';

describe('toCsv', () => {
  it('writes a header in column order, then rows', () => {
    expect(toCsv([{ b: 2, a: 1 }], ['a', 'b'])).toBe('a,b\r\n1,2\r\n');
  });

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(toCsv([{ t: 'a,b' }, { t: 'say "hi"' }, { t: 'x\ny' }], ['t'])).toBe(
      't\r\n"a,b"\r\n"say ""hi"""\r\n"x\ny"\r\n',
    );
  });

  it('joins arrays, blanks nulls, and appends unexpected keys', () => {
    expect(toCsv([{ tags: ['a', 'b'], n: null, extra: true }], ['tags', 'n'])).toBe('tags,n,extra\r\na; b,,true\r\n');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(toCsv([{ v: '=HYPERLINK("x")' }, { v: '-1+1' }], ['v'])).toBe('v\r\n"\'=HYPERLINK(""x"")"\r\n\'-1+1\r\n');
  });

  it('treats a single object as one row', () => {
    expect(toCsv({ name: 'x' }, ['name'])).toBe('name\r\nx\r\n');
  });
});

describe('toNdjson', () => {
  it('writes one object per line', () => {
    expect(toNdjson([{ a: 1 }, { a: 2 }])).toBe('{"a":1}\n{"a":2}\n');
    expect(toNdjson([])).toBe('');
  });
});

describe('createServer ?format=', () => {
  const spec = parseSiteSpec(`
name: quotes
baseUrl: https://quotes.example.com
resources:
  - name: quotes
    fetch: { path: / }
    list:
      selector: .quote
      fields:
        text: .text
        author: .author
`);
  const app = () =>
    createServer(spec, { fetcher: testFetcher({ 'https://quotes.example.com/': fixture('quotes.html') }) });

  it('serves CSV', async () => {
    const res = await app().request('/quotes?format=csv&fields=author');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toBe('author');
    expect(lines).toHaveLength(4);
  });

  it('serves NDJSON', async () => {
    const res = await app().request('/quotes?format=ndjson');
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const rows = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { author: string });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveProperty('author');
  });

  it('gives each format its own ETag', async () => {
    const json = await app().request('/quotes');
    const csv = await app().request('/quotes?format=csv', { headers: { 'If-None-Match': json.headers.get('etag')! } });
    expect(csv.status).toBe(200);
  });

  it('rejects unknown formats', async () => {
    const res = await app().request('/quotes?format=xml');
    expect(res.status).toBe(400);
  });
});
