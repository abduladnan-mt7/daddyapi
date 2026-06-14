import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { inferFromHtml } from '../src/infer';
import { fixture } from './helpers';

describe('inferFromHtml', () => {
  it('detects a repeating list and common fields', () => {
    const $ = load(fixture('books.html'));
    const spec = inferFromHtml($, 'https://books.example.com/catalogue/page-1.html');

    expect(spec.name).toBe('books');
    expect(spec.baseUrl).toBe('https://books.example.com');

    const resource = spec.resources[0]!;
    expect(resource.list).toBeDefined();
    expect(resource.list!.selector).toContain('product_pod');
    expect(Object.keys(resource.list!.fields)).toEqual(
      expect.arrayContaining(['title', 'url', 'price', 'image']),
    );
    // It found the rel="next" link as pagination.
    expect(resource.fetch.pagination?.selector).toBe('a[rel="next"]');
  });

  it('produces a valid spec even with no repeating structure', () => {
    const $ = load('<html><head><title>Hi</title></head><body><h1>Hello</h1></body></html>');
    const spec = inferFromHtml($, 'https://example.com/');
    expect(spec.resources[0]!.item).toBeDefined();
  });
});
