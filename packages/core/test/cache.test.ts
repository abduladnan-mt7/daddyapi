import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCache, MemoryCache } from '../src/cache';

describe('MemoryCache', () => {
  it('round-trips an entry and misses cleanly', async () => {
    const cache = new MemoryCache();
    await cache.set('k', { body: 'b', finalUrl: 'u', storedAt: 1 });
    expect((await cache.get('k'))?.body).toBe('b');
    expect(await cache.get('missing')).toBeUndefined();
  });
});

describe('FileCache', () => {
  it('round-trips an entry to disk and misses cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'daddyapi-cache-'));
    try {
      const cache = new FileCache(dir);
      await cache.set('https://e.com/x', {
        body: '<html>hi</html>',
        finalUrl: 'https://e.com/x',
        storedAt: 123,
      });
      const got = await cache.get('https://e.com/x');
      expect(got?.body).toBe('<html>hi</html>');
      expect(got?.finalUrl).toBe('https://e.com/x');
      expect(await cache.get('https://e.com/missing')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
