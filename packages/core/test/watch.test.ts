import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildWatchEvent, diffData, formatWatchEvent, hasChanges, rowKey, signPayload } from '../src/watch';

const v1 = [
  { url: '/a', title: 'Dune', price: 12 },
  { url: '/b', title: 'Emma', price: 8 },
  { url: '/c', title: 'Ulysses', price: 15 },
];

describe('diffData with a key', () => {
  it('reports added, removed and changed rows with the fields that changed', () => {
    const v2 = [
      { url: '/a', title: 'Dune', price: 9 },
      { url: '/c', title: 'Ulysses', price: 15 },
      { url: '/d', title: 'Beloved', price: 11 },
    ];
    const diff = diffData(v1, v2, ['url']);
    expect(diff.added).toEqual([{ url: '/d', title: 'Beloved', price: 11 }]);
    expect(diff.removed).toEqual([{ url: '/b', title: 'Emma', price: 8 }]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.fields).toEqual([{ field: 'price', before: 12, after: 9 }]);
    expect(diff.total).toBe(3);
  });

  it('ignores reordering and key order inside rows', () => {
    const shuffled = [v1[2], { price: 8, title: 'Emma', url: '/b' }, v1[0]];
    expect(hasChanges(diffData(v1, shuffled, ['url']))).toBe(false);
  });

  it('compares nested values such as tag arrays', () => {
    const before = [{ url: '/a', tags: ['x', 'y'] }];
    const after = [{ url: '/a', tags: ['x', 'z'] }];
    expect(diffData(before, after, ['url']).changed[0]!.fields[0]).toMatchObject({ field: 'tags' });
  });

  it('supports composite keys', () => {
    expect(rowKey({ a: 1, b: 2, c: 3 }, ['a', 'b'])).toBe(rowKey({ b: 2, a: 1, c: 9 }, ['a', 'b']));
  });
});

describe('diffData without a key', () => {
  it('treats an edited row as one removal plus one addition', () => {
    const v2 = [v1[0], { ...v1[1]!, price: 7 }, v1[2]];
    const diff = diffData(v1, v2);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed).toEqual([]);
  });
});

describe('diffData for a single item', () => {
  it('reports field changes on the object', () => {
    const diff = diffData({ name: 'A', born: '1879' }, { name: 'A', born: '1880' });
    expect(diff.changed[0]!.fields).toEqual([{ field: 'born', before: '1879', after: '1880' }]);
    expect(diff.added).toEqual([]);
  });

  it('treats a first run (no previous data) as an addition', () => {
    expect(diffData(undefined, [{ url: '/a' }], ['url']).added).toHaveLength(1);
  });
});

describe('events', () => {
  const diff = diffData(v1, [{ url: '/a', title: 'Dune', price: 9 }, v1[1]], ['url']);
  const event = buildWatchEvent('books', 'books', 'https://books.example/', diff, '2026-10-17T00:00:00.000Z');

  it('summarises the diff', () => {
    expect(event.summary).toEqual({ added: 0, removed: 1, changed: 1, total: 2 });
  });

  it('formats readable lines', () => {
    expect(formatWatchEvent(event, ['title'])).toEqual(['- removed  Ulysses', '~ changed  Dune  (price: 12 → 9)']);
  });

  it('signs payloads like GitHub webhooks', () => {
    const body = JSON.stringify(event);
    const expected = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`;
    expect(signPayload(body, 's3cret')).toBe(expected);
  });
});
