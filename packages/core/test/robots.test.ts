import { describe, expect, it } from 'vitest';
import { crawlDelay, isAllowed, parseRobots } from '../src/robots';

const robots = parseRobots(`
User-agent: *
Disallow: /private
Crawl-delay: 5

User-agent: daddyapi-bot
Disallow:
`);

describe('robots', () => {
  it('applies the wildcard group to unknown agents', () => {
    expect(isAllowed(robots, 'somebot', '/private')).toBe(false);
    expect(isAllowed(robots, 'somebot', '/public')).toBe(true);
  });

  it('prefers the most specific agent group', () => {
    expect(isAllowed(robots, 'daddyapi-bot', '/private')).toBe(true);
  });

  it('reads crawl-delay from the matching group', () => {
    expect(crawlDelay(robots, 'somebot')).toBe(5);
  });

  it('supports wildcards and end anchors', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.json$');
    expect(isAllowed(r, 'x', '/a/b.json')).toBe(false);
    expect(isAllowed(r, 'x', '/a/b.html')).toBe(true);
  });

  it('lets Allow override a Disallow on ties', () => {
    const r = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs');
    expect(isAllowed(r, 'x', '/docs')).toBe(true);
  });
});
