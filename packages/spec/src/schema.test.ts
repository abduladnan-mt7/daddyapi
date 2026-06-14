import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration';
import { parseSiteSpec, safeParseSiteSpec } from './load';

describe('siteSpec parsing', () => {
  it('parses a minimal valid spec and applies politeness defaults', () => {
    const spec = parseSiteSpec(`
name: example
baseUrl: https://example.com
resources:
  - name: items
    fetch:
      path: /
    list:
      selector: .item
      fields:
        title: .title
`);
    expect(spec.name).toBe('example');
    expect(spec.politeness.respectRobotsTxt).toBe(true);
    expect(spec.politeness.requestsPerSecond).toBe(1);
    expect(spec.politeness.cacheTtl).toBe('10m');
    expect(spec.resources[0]!.list?.fields.title).toBe('.title');
  });

  it('rejects a resource without list or item', () => {
    const res = safeParseSiteSpec(`
name: bad
baseUrl: https://example.com
resources:
  - name: items
    fetch:
      path: /
`);
    expect(res.success).toBe(false);
  });

  it('rejects an invalid baseUrl', () => {
    const res = safeParseSiteSpec(`
name: bad
baseUrl: not-a-url
resources:
  - name: items
    fetch: { path: / }
    item: { fields: { x: .y } }
`);
    expect(res.success).toBe(false);
  });

  it('rejects an unknown top-level key (strict schema)', () => {
    const res = safeParseSiteSpec(`
name: bad
baseUrl: https://example.com
surprise: true
resources:
  - name: items
    fetch: { path: / }
    item: { fields: { x: .y } }
`);
    expect(res.success).toBe(false);
  });
});

describe('parseDuration', () => {
  it('parses common durations', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('500')).toBe(500);
    expect(parseDuration(250)).toBe(250);
  });

  it('throws on garbage', () => {
    expect(() => parseDuration('soon')).toThrow();
  });
});
