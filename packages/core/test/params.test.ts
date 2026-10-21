import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../src/infer';
import { ParamError, parseResourceQuery, resourceInputs, shapeData, templateParams } from '../src/params';

const spec = parseSiteSpec(`
name: shop
baseUrl: https://shop.example.com
resources:
  - name: products
    fetch:
      path: /category/{slug}/
      pagination: { type: link, selector: a.next, maxPages: 2 }
    list:
      selector: .product
      fields:
        title: h3
        price: { selector: .price, transform: float }
  - name: product
    fetch: { path: "/p/{id}/" }
    item:
      fields:
        title: h1
`);
const products = spec.resources[0]!;
const product = spec.resources[1]!;

function paramError(fn: () => unknown): ParamError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ParamError) return err;
    throw err;
  }
  throw new Error('expected a ParamError');
}

describe('templateParams / resourceInputs', () => {
  it('finds each placeholder once, in order', () => {
    expect(templateParams('/a/{x}/b/{y}/{x}')).toEqual(['x', 'y']);
  });

  it('describes what a resource accepts', () => {
    expect(resourceInputs(products)).toEqual({
      pathParams: ['slug'],
      paginated: true,
      isList: true,
      fieldNames: ['title', 'price'],
    });
    expect(resourceInputs(product).isList).toBe(false);
  });
});

describe('parseResourceQuery', () => {
  it('accepts valid input', () => {
    expect(
      parseResourceQuery(products, { slug: 'books', pages: '2', limit: '5', offset: '0', fields: 'title' }),
    ).toEqual({ params: { slug: 'books' }, maxPages: 2, limit: 5, offset: 0, fields: ['title'] });
  });

  it('rejects a missing path parameter', () => {
    expect(paramError(() => parseResourceQuery(products, {})).param).toBe('slug');
  });

  it.each([
    ['pages', 'abc'],
    ['pages', '0'],
    ['pages', '2.5'],
    ['pages', '999'],
    ['limit', '-1'],
    ['offset', 'x'],
  ])('rejects %s=%s', (name, value) => {
    expect(paramError(() => parseResourceQuery(products, { slug: 's', [name]: value })).param).toBe(name);
  });

  it('respects a custom pages ceiling', () => {
    expect(() => parseResourceQuery(products, { slug: 's', pages: '5' }, { maxPagesLimit: 4 })).toThrow(
      /between 1 and 4/,
    );
  });

  it('rejects unknown fields and names the real ones', () => {
    const err = paramError(() => parseResourceQuery(products, { slug: 's', fields: 'title,nope' }));
    expect(err.message).toContain('nope');
    expect(err.message).toContain('Available: title, price');
  });

  it('rejects limit/offset on a single-item resource', () => {
    expect(paramError(() => parseResourceQuery(product, { id: '1', limit: '2' })).param).toBe('limit');
  });
});

describe('shapeData', () => {
  const rows = [
    { title: 'a', price: 1 },
    { title: 'b', price: 2 },
    { title: 'c', price: 3 },
  ];

  it('slices with offset and limit and reports the total', () => {
    expect(shapeData(rows, { offset: 1, limit: 1 })).toEqual({ data: [{ title: 'b', price: 2 }], total: 3 });
  });

  it('picks fields on rows and on single objects', () => {
    expect(shapeData(rows, { fields: ['price'] }).data).toEqual([{ price: 1 }, { price: 2 }, { price: 3 }]);
    expect(shapeData({ title: 'x', price: 9 }, { fields: ['title'] })).toEqual({ data: { title: 'x' } });
  });
});

describe('normalizeUrl', () => {
  it('adds https:// to a bare host', () => {
    expect(normalizeUrl('quotes.toscrape.com')).toBe('https://quotes.toscrape.com/');
    expect(normalizeUrl('  books.toscrape.com/catalogue/  ')).toBe('https://books.toscrape.com/catalogue/');
  });

  it('keeps explicit http(s) URLs and localhost', () => {
    expect(normalizeUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('explains what is wrong with non-URLs', () => {
    expect(() => normalizeUrl('hello')).toThrow(/isn't a valid web address/);
    expect(() => normalizeUrl('ftp://example.com')).toThrow(/http:\/\/ or https:\/\//);
  });
});
