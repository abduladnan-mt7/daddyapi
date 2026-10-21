import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import {
  baselineFromReport,
  checkSpec,
  compareToBaseline,
  evaluateResource,
  formatReport,
  profileData,
} from '../src/check';
import { fixture, testFetcher } from './helpers';

const spec = parseSiteSpec(`
name: shop
baseUrl: https://shop.example.com
resources:
  - name: products
    fetch: { path: / }
    list:
      selector: .product
      fields:
        title: h3
        price: { selector: .price, transform: float }
        note: { selector: .note, optional: true }
        tags: { selector: .tag, many: true, optional: true }
    expect:
      minRows: 2
      fields:
        title: { pattern: "^[A-Z]" }
        price: { min: 0, max: 100 }
  - name: product
    fetch: { path: "/p/{id}/" }
    item:
      fields:
        title: h1
`);
const products = spec.resources[0]!;

const good = [
  { title: 'Alpha', price: 10, note: null, tags: ['a'] },
  { title: 'Beta', price: 20, note: 'sale', tags: [] },
  { title: 'Gamma', price: 30, note: null, tags: ['b', 'c'] },
];

function codes(data: unknown, baseline = undefined as Parameters<typeof evaluateResource>[2]) {
  return evaluateResource(products, data, baseline).issues.map((i) => `${i.field ?? '-'}:${i.code}`);
}

describe('profileData', () => {
  it('measures rows, fill rate and value types', () => {
    const profile = profileData(products, good);
    expect(profile.rows).toBe(3);
    expect(profile.fields.title).toEqual({ fillRate: 1, types: { string: 3 } });
    expect(profile.fields.price!.types).toEqual({ number: 3 });
    expect(profile.fields.note!.fillRate).toBeCloseTo(1 / 3);
    expect(profile.fields.tags).toEqual({ fillRate: 2 / 3, types: { array: 2 } });
  });
});

describe('evaluateResource', () => {
  it('passes healthy data', () => {
    expect(codes(good)).toEqual([]);
  });

  it('flags an empty list as a layout change', () => {
    const [issue] = evaluateResource(products, []).issues;
    expect(issue).toMatchObject({ code: 'empty-list', severity: 'error' });
    expect(issue!.message).toContain('.product');
  });

  it('enforces minRows', () => {
    expect(codes([good[0]])).toContain('-:min-rows');
  });

  it('flags a required field that disappeared', () => {
    const data = good.map((r) => ({ ...r, price: null }));
    expect(codes(data)).toContain('price:missing-field');
  });

  it('flags a required field that is only sometimes filled', () => {
    const data = [...good, { title: 'Delta', price: null }, { title: 'Echo', price: null }];
    expect(codes(data)).toContain('price:fill-rate');
  });

  it('ignores gaps in optional fields', () => {
    expect(codes(good.map((r) => ({ ...r, note: null })))).toEqual([]);
  });

  it('catches a value of the wrong type', () => {
    const data = good.map((r, i) => (i === 0 ? { ...r, price: 'N/A' } : r));
    expect(codes(data)).toContain('price:type');
  });

  it('checks patterns and numeric ranges', () => {
    const data = good.map((r, i) => (i === 0 ? { ...r, title: 'lowercase', price: 500 } : r));
    expect(codes(data)).toEqual(expect.arrayContaining(['title:pattern', 'price:range']));
  });

  it('reports expect.fields entries that name no field', () => {
    const typo = parseSiteSpec(`
name: x
baseUrl: https://x.example.com
resources:
  - name: r
    fetch: { path: / }
    list: { selector: .r, fields: { a: .a } }
    expect: { fields: { b: { fillRate: 1 } } }
`).resources[0]!;
    expect(evaluateResource(typo, [{ a: 'x' }]).issues[0]).toMatchObject({ field: 'b', code: 'unknown-field' });
  });
});

describe('compareToBaseline', () => {
  const baseline = profileData(products, good);

  it('flags a sharp drop in rows', () => {
    const now = profileData(products, [good[0]]);
    expect(compareToBaseline(now, baseline)[0]).toMatchObject({ code: 'drift-rows', severity: 'error' });
  });

  it('flags a fill-rate collapse and a type change', () => {
    const now = profileData(
      products,
      good.map((r) => ({ ...r, tags: null, price: String(r.price) })),
    );
    const issues = compareToBaseline(now, baseline).map((i) => `${i.field}:${i.code}`);
    expect(issues).toEqual(expect.arrayContaining(['tags:drift-fill-rate', 'price:drift-type']));
  });

  it('stays quiet when nothing meaningful changed', () => {
    expect(compareToBaseline(profileData(products, good), baseline)).toEqual([]);
  });
});

describe('checkSpec', () => {
  const quotes = parseSiteSpec(`
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
  - name: author
    fetch: { path: "/author/{slug}/" }
    item: { fields: { name: h3 } }
  - name: broken
    fetch: { path: /gone/ }
    list: { selector: .x, fields: { x: .x } }
`);

  it('runs every resource and reports pass, skipped and error', async () => {
    const report = await checkSpec(quotes, {
      fetcher: testFetcher({ 'https://quotes.example.com/': fixture('quotes.html') }),
    });
    const status = Object.fromEntries(report.resources.map((r) => [r.resource, r.status]));
    expect(status).toEqual({ quotes: 'pass', author: 'skipped', broken: 'error' });
    expect(report.resources.find((r) => r.resource === 'author')!.reason).toContain('expect.params');
    expect(report.ok).toBe(false);
    expect(formatReport(report)).toContain('ERROR  broken');
  });

  it('detects a site redesign against a saved baseline', async () => {
    const only = ['quotes'];
    const before = await checkSpec(quotes, {
      only,
      fetcher: testFetcher({ 'https://quotes.example.com/': fixture('quotes.html') }),
    });
    expect(before.ok).toBe(true);
    const baseline = baselineFromReport(before);

    // The site renames its CSS classes: rows still match, authors vanish.
    const redesigned = fixture('quotes.html').replace(/class="author"/g, 'class="writer"');
    const after = await checkSpec(quotes, {
      only,
      baseline,
      fetcher: testFetcher({ 'https://quotes.example.com/': redesigned }),
    });
    expect(after.ok).toBe(false);
    const issues = after.resources[0]!.issues.map((i) => `${i.field}:${i.code}`);
    expect(issues).toEqual(expect.arrayContaining(['author:missing-field', 'author:drift-fill-rate']));
  });
});

describe('custom hook transforms', () => {
  const hooked = parseSiteSpec(`
name: books
baseUrl: https://books.example.com
resources:
  - name: books
    fetch: { path: / }
    list:
      selector: .book
      fields:
        title: h3
        rating: { selector: .star-rating, attr: class, transform: rating }
        price: { selector: .price, transform: [trim, float] }
        shout: { selector: h3, transform: [float, upper] }
`).resources[0]!;

  it('does not assume a type for a hook transform, and uses the last built-in one', async () => {
    const { fieldValueType } = await import('../src/openapi');
    const fields = hooked.list!.fields;
    expect(fieldValueType(fields.rating!)).toBe('unknown');
    expect(fieldValueType(fields.price!)).toBe('number');
    expect(fieldValueType(fields.shout!)).toBe('string');
  });

  it('does not flag the values a hook returns as the wrong type', () => {
    const data = [
      { title: 'A', rating: 3, price: 10, shout: 'A' },
      { title: 'B', rating: 5, price: 12, shout: 'B' },
    ];
    expect(evaluateResource(hooked, data).issues).toEqual([]);
  });
});
