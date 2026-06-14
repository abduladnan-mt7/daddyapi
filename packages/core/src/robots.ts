/**
 * A small, dependency-free robots.txt parser and matcher. Good enough to be a
 * polite citizen: it honours User-agent groups, Allow/Disallow longest-match
 * precedence, simple `*` wildcards / `$` anchors, and Crawl-delay.
 */

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelay?: number;
}

export interface Robots {
  groups: RobotsGroup[];
}

export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share the rules that follow them.
      if (current === null || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    if (current === null) {
      current = { agents: ['*'], allow: [], disallow: [] };
      groups.push(current);
    }
    lastWasAgent = false;

    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    }
  }

  return { groups };
}

/** Bare product token from a full UA string, e.g. "daddyapi-bot (+url)" -> "daddyapi-bot". */
export function userAgentToken(userAgent: string): string {
  const token = userAgent.split(/[\s/(]/)[0] ?? userAgent;
  return token.toLowerCase();
}

function selectGroup(robots: Robots, token: string): RobotsGroup | null {
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  let star: RobotsGroup | null = null;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        star = star ?? group;
      } else if (token.startsWith(agent) && agent.length > bestLen) {
        best = group;
        bestLen = agent.length;
      }
    }
  }
  return best ?? star;
}

function ruleMatches(pattern: string, path: string): number {
  if (pattern === '') return -1; // empty Disallow means "allow everything"
  // Translate the robots pattern into a regex anchored at the start.
  let regex = '^';
  for (const ch of pattern) {
    if (ch === '*') regex += '.*';
    else if (ch === '$') regex += '$';
    else regex += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  try {
    return new RegExp(regex).test(path) ? pattern.length : -1;
  } catch {
    return path.startsWith(pattern) ? pattern.length : -1;
  }
}

/** Is `path` crawlable for `token` under these rules? Defaults to allowed. */
export function isAllowed(robots: Robots, token: string, path: string): boolean {
  const group = selectGroup(robots, token);
  if (group === null) return true;

  let allowLen = -1;
  for (const rule of group.allow) allowLen = Math.max(allowLen, ruleMatches(rule, path));

  let disallowLen = -1;
  for (const rule of group.disallow) disallowLen = Math.max(disallowLen, ruleMatches(rule, path));

  if (disallowLen === -1) return true;
  // Allow wins ties (more permissive), matching common crawler behaviour.
  return allowLen >= disallowLen;
}

/** Crawl-delay (seconds) for the matching group, if any. */
export function crawlDelay(robots: Robots, token: string): number | undefined {
  return selectGroup(robots, token)?.crawlDelay;
}
