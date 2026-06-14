import { type SiteSpec, siteSpecSchema } from '@daddyapi/spec';
import { type CheerioAPI, load } from 'cheerio';
import { PoliteFetcher, type PoliteFetcherOptions } from './fetch';

export interface InferOptions {
  fetcher?: PoliteFetcher;
  userAgent?: string;
}

const DEFAULT_UA = 'daddyapi-bot (+https://github.com/abduladnan-mt7/daddyapi)';

/** Crawl a single page and produce a draft SiteSpec for review. */
export async function inferSpec(startUrl: string, options: InferOptions = {}): Promise<SiteSpec> {
  const fetcherOptions: PoliteFetcherOptions = {
    userAgent: options.userAgent ?? DEFAULT_UA,
    requestsPerSecond: 1,
    respectRobotsTxt: true,
    cacheTtlMs: 600_000,
    timeoutMs: 15_000,
    maxRetries: 2,
  };
  const fetcher = options.fetcher ?? new PoliteFetcher(fetcherOptions);
  const { html, finalUrl } = await fetcher.getHtml(startUrl);
  return inferFromHtml(load(html), finalUrl);
}

/** The pure heuristic core: derive a draft SiteSpec from already-fetched HTML. */
export function inferFromHtml($: CheerioAPI, pageUrl: string): SiteSpec {
  const url = new URL(pageUrl);
  const repeating = findRepeatingSelector($);
  const pagination = repeating ? findPagination($) : null;

  const path = (url.pathname || '/') + (url.search || '');
  const draft: Record<string, unknown> = {
    name: hostnameToName(url.hostname),
    baseUrl: url.origin,
    description: `Auto-generated draft spec for ${url.origin}. Review selectors before relying on it.`,
    resources: [
      repeating
        ? {
            name: 'items',
            description: 'Auto-detected list — verify the row selector and fields.',
            fetch: {
              path,
              ...(pagination
                ? { pagination: { type: 'link', selector: pagination, maxPages: 1 } }
                : {}),
            },
            list: { selector: repeating.selector, fields: inferFields($, repeating.selector) },
          }
        : {
            name: 'page',
            description: 'No repeating structure found — extracting page-level fields.',
            fetch: { path },
            item: { fields: inferPageFields($) },
          },
    ],
  };

  // Validate + apply politeness defaults so the output is always a usable spec.
  return siteSpecSchema.parse(draft);
}

interface Repeat {
  selector: string;
  count: number;
}

function findRepeatingSelector($: CheerioAPI): Repeat | null {
  let best: Repeat | null = null;
  $('body *').each((_i: number, el: any) => {
    const children = $(el).children().toArray();
    if (children.length < 3) return;
    const groups = new Map<string, number>();
    for (const child of children) {
      const sig = signature(child);
      if (sig) groups.set(sig, (groups.get(sig) ?? 0) + 1);
    }
    for (const [selector, count] of groups) {
      if (count >= 3 && (best === null || count > best.count)) best = { selector, count };
    }
  });
  return best;
}

function signature(el: any): string | null {
  if (!el || el.type !== 'tag' || typeof el.name !== 'string') return null;
  const classes = String(el.attribs?.class ?? '')
    .trim()
    .split(/\s+/)
    .filter((c) => /^[a-zA-Z][\w-]*$/.test(c))
    .slice(0, 2);
  return el.name + classes.map((c) => `.${c}`).join('');
}

function inferFields($: CheerioAPI, rowSelector: string): Record<string, unknown> {
  const row = $(rowSelector).first();
  const fields: Record<string, unknown> = {};

  const heading = row.find('h1,h2,h3,h4,h5,h6').first();
  const anchorWithText = row.find('a').filter((_i: number, a: any) => $(a).text().trim().length > 0);
  if (heading.length > 0 && heading.text().trim().length > 0) {
    fields.title = { selector: 'h1,h2,h3,h4,h5,h6' };
  } else if (anchorWithText.length > 0) {
    fields.title = { selector: 'a' };
  }

  if (row.find('a[href]').length > 0) {
    fields.url = { selector: 'a', attr: 'href', transform: 'url' };
  }

  const price = row.find('[class*="price"]').first();
  if (price.length > 0 && price.text().trim().length > 0) {
    fields.price = { selector: '[class*="price"]', transform: ['float'] };
  }

  if (row.find('img[src]').length > 0) {
    fields.image = { selector: 'img', attr: 'src', transform: 'url' };
  }

  if (Object.keys(fields).length === 0) fields.text = {};
  return fields;
}

function inferPageFields($: CheerioAPI): Record<string, unknown> {
  const fields: Record<string, unknown> = { title: { selector: 'h1,h2,title' } };
  const description = $('meta[name="description"]').attr('content');
  if (description) fields.description = { selector: 'meta[name="description"]', attr: 'content' };
  return fields;
}

function findPagination($: CheerioAPI): string | null {
  if ($('a[rel="next"]').length > 0) return 'a[rel="next"]';
  let result: string | null = null;
  $('a').each((_i: number, a: any) => {
    if (result !== null) return;
    const $a = $(a);
    const text = $a.text().trim().toLowerCase();
    const cls = String($a.attr('class') ?? '').toLowerCase();
    if (/^(next|more|older|»|→)/.test(text) || /\b(next|more)\b/.test(cls)) {
      const parentClass = firstClass($a.parent().attr('class'));
      const ownClass = firstClass(cls);
      result = parentClass ? `.${parentClass} a` : ownClass ? `a.${ownClass}` : null;
    }
  });
  return result;
}

function firstClass(classAttr: string | undefined): string | null {
  if (!classAttr) return null;
  const match = classAttr
    .trim()
    .split(/\s+/)
    .find((c) => /^[a-zA-Z][\w-]*$/.test(c));
  return match ?? null;
}

function hostnameToName(hostname: string): string {
  const labels = hostname.replace(/^www\./, '').split('.');
  return labels[0] ?? hostname;
}
