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

describe('extractFields with the date transform', () => {
  const parseDate = (text: string) => {
    const $ = load(`<div class="row"><time class="when">${text}</time></div>`);
    const warnings: ExtractWarning[] = [];
    const fields: Fields = { when: { selector: 'time.when', transform: 'date' } };
    const data = extractFields($, $('.row').first(), fields, {
      baseUrl: 'https://e.com',
      warnings,
    });
    expect(warnings).toHaveLength(0);
    return data.when;
  };

  it('keeps a date-only value as an ISO date', () => {
    expect(parseDate('2026-06-14')).toBe('2026-06-14');
  });

  it('turns a free-text date into an ISO date', () => {
    expect(parseDate('14 June 2026')).toBe('2026-06-14');
  });

  it('turns a date-time into a full ISO timestamp', () => {
    expect(parseDate('2026-06-14T10:00Z')).toBe('2026-06-14T10:00:00.000Z');
  });

  it('returns null for an unparseable value', () => {
    expect(parseDate('sometime last week')).toBeNull();
  });

  it('keeps an ISO date-only value the same day west of UTC', () => {
    const prior = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // Date.parse reads date-only ISO strings as UTC midnight; without the
      // UTC-day branch this lands on 2026-06-13 in a negative offset.
      expect(parseDate('2026-06-14')).toBe('2026-06-14');
      expect(parseDate('14 June 2026')).toBe('2026-06-14');
    } finally {
      if (prior === undefined) delete process.env.TZ;
      else process.env.TZ = prior;
    }
  });
});
