import type { Resource, SiteSpec } from '@daddyapi/spec';
import { type CheerioAPI, load } from 'cheerio';
import { type ExtractWarning, extractFields } from './extract';
import { createFetcher, type PoliteFetcher } from './fetch';

export interface RunOptions {
  params?: Record<string, string | number>;
  maxPages?: number;
  fetcher?: PoliteFetcher;
}

export interface RunResult {
  data: unknown;
  warnings: ExtractWarning[];
  meta: {
    resource: string;
    source: string;
    pages: number;
    fromCache: boolean;
    fetchedAt: string;
  };
}

function fillTemplate(path: string, params: Record<string, string | number>): string {
  return path.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Missing required parameter "${key}" for path "${path}"`);
    }
    return encodeURIComponent(String(value));
  });
}

/** Fetch, extract, and normalize a single resource. */
export async function runResource(
  spec: SiteSpec,
  resource: Resource,
  options: RunOptions = {},
): Promise<RunResult> {
  const fetcher = options.fetcher ?? createFetcher(spec.politeness);
  const params = options.params ?? {};
  const startUrl = new URL(fillTemplate(resource.fetch.path, params), spec.baseUrl).href;
  const warnings: ExtractWarning[] = [];

  if (resource.list) {
    const list = resource.list;
    const maxPages = options.maxPages ?? resource.fetch.pagination?.maxPages ?? 1;
    const rows: unknown[] = [];
    let url: string | null = startUrl;
    let pages = 0;
    let anyFromCache = false;

    while (url !== null && pages < maxPages) {
      const { html, finalUrl, fromCache } = await fetcher.getHtml(url);
      anyFromCache = anyFromCache || fromCache;
      const $ = load(html);
      $(list.selector).each((_i: number, el: any) => {
        rows.push(extractFields($, $(el), list.fields, { baseUrl: finalUrl, warnings }));
      });
      pages++;
      url = pages < maxPages ? nextPageUrl($, finalUrl, resource) : null;
    }

    return {
      data: rows,
      warnings,
      meta: {
        resource: resource.name,
        source: startUrl,
        pages,
        fromCache: anyFromCache,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  const { html, finalUrl, fromCache } = await fetcher.getHtml(startUrl);
  const $ = load(html);
  const data = extractFields($, null, resource.item!.fields, { baseUrl: finalUrl, warnings });
  return {
    data,
    warnings,
    meta: {
      resource: resource.name,
      source: startUrl,
      pages: 1,
      fromCache,
      fetchedAt: new Date().toISOString(),
    },
  };
}

function nextPageUrl($: CheerioAPI, currentUrl: string, resource: Resource): string | null {
  const pagination = resource.fetch.pagination;
  if (!pagination) return null;

  if (pagination.type === 'link') {
    if (!pagination.selector) return null;
    const href = $(pagination.selector).first().attr('href');
    if (!href) return null;
    try {
      return new URL(href, currentUrl).href;
    } catch {
      return null;
    }
  }

  if (pagination.type === 'query' && pagination.param) {
    const url = new URL(currentUrl);
    const step = pagination.step ?? 1;
    const start = pagination.start ?? 1;
    const current = Number(url.searchParams.get(pagination.param) ?? String(start));
    url.searchParams.set(pagination.param, String(current + step));
    return url.href;
  }

  return null;
}

/** Find a resource by name, with a helpful error listing the alternatives. */
export function getResource(spec: SiteSpec, name: string): Resource {
  const resource = spec.resources.find((r) => r.name === name);
  if (!resource) {
    const available = spec.resources.map((r) => r.name).join(', ');
    throw new Error(`Unknown resource "${name}". Available: ${available}`);
  }
  return resource;
}

export type Client = Record<string, (options?: RunOptions) => Promise<RunResult>>;

/** Build a typed-ish data SDK: one method per resource, sharing a fetcher. */
export function createClient(spec: SiteSpec, base: { fetcher?: PoliteFetcher } = {}): Client {
  const fetcher = base.fetcher ?? createFetcher(spec.politeness);
  const client: Client = {};
  for (const resource of spec.resources) {
    client[resource.name] = (options: RunOptions = {}) =>
      runResource(spec, resource, { fetcher, ...options });
  }
  return client;
}
