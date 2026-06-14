import type { Resource, SiteSpec } from '@daddyapi/spec';
import { type CheerioAPI, load } from 'cheerio';
import { type ExtractWarning, extractFields } from './extract';
import { createFetcher, type PoliteFetcher } from './fetch';
import type { Hooks } from './hooks';

export interface RunOptions {
  params?: Record<string, string | number>;
  maxPages?: number;
  fetcher?: PoliteFetcher;
  /** Code escape-hatch: custom transforms and post-processors. */
  hooks?: Hooks;
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

/** Fetch, extract, normalize, and post-process a single resource. */
export async function runResource(
  spec: SiteSpec,
  resource: Resource,
  options: RunOptions = {},
): Promise<RunResult> {
  const fetcher = options.fetcher ?? createFetcher(spec.politeness);
  const params = options.params ?? {};
  const startUrl = new URL(fillTemplate(resource.fetch.path, params), spec.baseUrl).href;
  const warnings: ExtractWarning[] = [];

  let data: unknown;
  let pages = 0;
  let fromCache = false;

  if (resource.list) {
    const list = resource.list;
    const maxPages = options.maxPages ?? resource.fetch.pagination?.maxPages ?? 1;
    const rows: unknown[] = [];
    let url: string | null = startUrl;

    while (url !== null && pages < maxPages) {
      const fetched = await fetcher.getHtml(url);
      fromCache = fromCache || fetched.fromCache;
      const $ = load(fetched.html);
      $(list.selector).each((_i: number, el: any) => {
        rows.push(
          extractFields($, $(el), list.fields, {
            baseUrl: fetched.finalUrl,
            warnings,
            hooks: options.hooks,
          }),
        );
      });
      pages++;
      url = pages < maxPages ? nextPageUrl($, fetched.finalUrl, resource) : null;
    }
    data = rows;
  } else {
    const fetched = await fetcher.getHtml(startUrl);
    fromCache = fetched.fromCache;
    pages = 1;
    const $ = load(fetched.html);
    data = extractFields($, null, resource.item!.fields, {
      baseUrl: fetched.finalUrl,
      warnings,
      hooks: options.hooks,
    });
  }

  if (resource.postProcess) {
    const fn = options.hooks?.postProcess?.[resource.postProcess];
    if (fn) {
      data = await fn(data, { baseUrl: startUrl, spec, resource });
    } else {
      warnings.push({
        field: '(postProcess)',
        message: `no hook named "${resource.postProcess}" found`,
      });
    }
  }

  return {
    data,
    warnings,
    meta: {
      resource: resource.name,
      source: startUrl,
      pages,
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

export interface ClientOptions {
  fetcher?: PoliteFetcher;
  hooks?: Hooks;
}

/** Build a data SDK: one method per resource, sharing a fetcher and hooks. */
export function createClient(spec: SiteSpec, base: ClientOptions = {}): Client {
  const fetcher = base.fetcher ?? createFetcher(spec.politeness);
  const client: Client = {};
  for (const resource of spec.resources) {
    client[resource.name] = (options: RunOptions = {}) =>
      runResource(spec, resource, { fetcher, hooks: base.hooks, ...options });
  }
  return client;
}
