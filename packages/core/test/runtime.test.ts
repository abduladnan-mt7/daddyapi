import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import { getResource, runResource } from '../src/runtime';
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
        tags: { selector: "a.tag", many: true }
  - name: title
    fetch: { path: / }
    item:
      fields:
        title: title
`);

describe('runResource', () => {
  it('extracts a list and follows link pagination to the end', async () => {
    const fetcher = testFetcher({
      'https://quotes.example.com/': fixture('quotes.html'),
      'https://quotes.example.com/page/2/': fixture('quotes-page2.html'),
    });
    const result = await runResource(spec, getResource(spec, 'quotes'), { fetcher });
    const data = result.data as Array<Record<string, unknown>>;

    expect(data).toHaveLength(5);
    expect(data[0]!.author).toBe('Author One');
    expect(data[0]!.text).toBe('"Quote one"');
    expect(data[0]!.tags).toEqual(['a', 'b']);
    expect(data[2]!.tags).toEqual([]);
    expect(result.meta.pages).toBe(2);
    expect(result.warnings).toHaveLength(0);
  });

  it('respects a maxPages override', async () => {
    const fetcher = testFetcher({
      'https://quotes.example.com/': fixture('quotes.html'),
      'https://quotes.example.com/page/2/': fixture('quotes-page2.html'),
    });
    const result = await runResource(spec, getResource(spec, 'quotes'), { fetcher, maxPages: 1 });
    expect((result.data as unknown[]).length).toBe(3);
    expect(result.meta.pages).toBe(1);
  });

  it('extracts a single item resource', async () => {
    const fetcher = testFetcher({ 'https://quotes.example.com/': fixture('quotes.html') });
    const result = await runResource(spec, getResource(spec, 'title'), { fetcher });
    expect((result.data as Record<string, unknown>).title).toBe('All Quotes');
  });
});
