import type { Fields } from '@daddyapi/spec';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { type ExtractWarning, extractFields } from '../src/extract';
import { fixture } from './helpers';

describe('extractFields', () => {
  it('extracts fields from a row and applies transforms', () => {
    const $ = load(fixture('books.html'));
    const row = $('article.product_pod').first();
    const warnings: ExtractWarning[] = [];
    const fields: Fields = {
      title: { selector: 'h3 a', attr: 'title' },
      url: { selector: 'h3 a', attr: 'href', transform: 'url' },
      price: { selector: '.price_color', transform: ['float'] },
    };
    const data = extractFields($, row, fields, {
      baseUrl: 'https://books.example.com/catalogue/page-1.html',
      warnings,
    });

    expect(data.title).toBe('Book One');
    expect(data.price).toBeCloseTo(51.77);
    expect(String(data.url)).toContain('book-1');
    expect(warnings).toHaveLength(0);
  });

  it('collects repeated matches with "many"', () => {
    const $ = load(fixture('quotes.html'));
    const row = $('.quote').first();
    const warnings: ExtractWarning[] = [];
    const fields: Fields = { tags: { selector: 'a.tag', many: true } };
    const data = extractFields($, row, fields, { baseUrl: 'https://q.example.com', warnings });
    expect(data.tags).toEqual(['a', 'b']);
  });

  it('warns on a missing required field', () => {
    const $ = load('<div class="x"></div>');
    const warnings: ExtractWarning[] = [];
    extractFields($, $('.x'), { missing: '.nope' }, { baseUrl: 'https://e.com', warnings });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.field).toBe('missing');
  });
});
