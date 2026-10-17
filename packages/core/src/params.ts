import type { Resource } from '@daddyapi/spec';
import { DATA_FORMATS, type DataFormat } from './format';

/**
 * A caller-side mistake: a missing path parameter or an invalid query value.
 * The HTTP server answers these with 400 and the MCP server with a tool error,
 * so they never look like an upstream site failure.
 */
export class ParamError extends Error {
  constructor(
    message: string,
    readonly param: string,
  ) {
    super(message);
    this.name = 'ParamError';
  }
}

/** Names of the `{param}` placeholders in a resource's fetch path, in order. */
export function templateParams(path: string): string[] {
  const params: string[] = [];
  for (const match of path.matchAll(/\{(\w+)\}/g)) {
    if (!params.includes(match[1]!)) params.push(match[1]!);
  }
  return params;
}

/** Everything a caller can pass to a resource, shared by HTTP, OpenAPI and MCP. */
export interface ResourceInputs {
  /** Required path parameters from `fetch.path`. */
  pathParams: string[];
  /** Whether the resource paginates, so `pages` is meaningful. */
  paginated: boolean;
  /** Whether the resource returns a list, so `limit`/`offset` apply. */
  isList: boolean;
  /** Field names, for `fields` selection. */
  fieldNames: string[];
}

export function resourceInputs(resource: Resource): ResourceInputs {
  const fields = resource.list?.fields ?? resource.item?.fields ?? {};
  return {
    pathParams: templateParams(resource.fetch.path),
    paginated: resource.list !== undefined && resource.fetch.pagination !== undefined,
    isList: resource.list !== undefined,
    fieldNames: Object.keys(fields),
  };
}

/** Hard ceiling on pages per request, so one call can't crawl a whole site. */
export const DEFAULT_MAX_PAGES_LIMIT = 20;

/** Validated request options for one resource call. */
export interface ResourceQuery {
  params: Record<string, string>;
  maxPages?: number;
  limit?: number;
  offset?: number;
  fields?: string[];
  /** Response format (HTTP only); defaults to the JSON envelope. */
  format?: DataFormat;
}

export interface RawQuery {
  [key: string]: string | number | string[] | undefined;
}

function positiveInt(name: string, raw: string | number, min: number, max?: number): number {
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new ParamError(`"${name}" must be a whole number, got "${raw}"`, name);
  }
  const value = Number(text);
  if (value < min || (max !== undefined && value > max)) {
    const range = max !== undefined ? `between ${min} and ${max}` : `at least ${min}`;
    throw new ParamError(`"${name}" must be ${range}, got ${value}`, name);
  }
  return value;
}

/**
 * Turn raw caller input (an HTTP query or MCP tool arguments) into a validated
 * ResourceQuery. Throws ParamError on anything the caller got wrong.
 */
export function parseResourceQuery(
  resource: Resource,
  raw: RawQuery,
  options: { maxPagesLimit?: number } = {},
): ResourceQuery {
  const inputs = resourceInputs(resource);
  const maxPagesLimit = options.maxPagesLimit ?? DEFAULT_MAX_PAGES_LIMIT;
  const query: ResourceQuery = { params: {} };

  for (const name of inputs.pathParams) {
    const value = raw[name];
    if (value === undefined || String(value).trim() === '') {
      throw new ParamError(`Missing required parameter "${name}"`, name);
    }
    query.params[name] = String(value);
  }

  if (raw.pages !== undefined && raw.pages !== '') {
    query.maxPages = positiveInt('pages', raw.pages as string | number, 1, maxPagesLimit);
  }

  if (raw.limit !== undefined && raw.limit !== '') {
    if (!inputs.isList) throw new ParamError('"limit" only applies to list resources', 'limit');
    query.limit = positiveInt('limit', raw.limit as string | number, 1);
  }
  if (raw.offset !== undefined && raw.offset !== '') {
    if (!inputs.isList) throw new ParamError('"offset" only applies to list resources', 'offset');
    query.offset = positiveInt('offset', raw.offset as string | number, 0);
  }

  if (raw.format !== undefined && raw.format !== '') {
    const format = String(raw.format).toLowerCase();
    if (!(DATA_FORMATS as readonly string[]).includes(format)) {
      throw new ParamError(`"format" must be one of ${DATA_FORMATS.join(', ')}, got "${raw.format}"`, 'format');
    }
    query.format = format as DataFormat;
  }

  if (raw.fields !== undefined && raw.fields !== '') {
    const requested = (Array.isArray(raw.fields) ? raw.fields : String(raw.fields).split(','))
      .map((f) => String(f).trim())
      .filter(Boolean);
    const unknown = requested.filter((f) => !inputs.fieldNames.includes(f));
    if (unknown.length > 0) {
      throw new ParamError(
        `Unknown field(s): ${unknown.join(', ')}. Available: ${inputs.fieldNames.join(', ')}`,
        'fields',
      );
    }
    if (requested.length > 0) query.fields = requested;
  }

  return query;
}

function pick(row: unknown, fields: string[]): unknown {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in source) out[f] = source[f];
  return out;
}

/** Apply `offset`/`limit` and `fields` to extracted data. Returns the shaped data and the total row count. */
export function shapeData(
  data: unknown,
  query: Pick<ResourceQuery, 'limit' | 'offset' | 'fields'>,
): { data: unknown; total?: number } {
  if (Array.isArray(data)) {
    const total = data.length;
    const start = query.offset ?? 0;
    const end = query.limit !== undefined ? start + query.limit : undefined;
    let rows = data.slice(start, end);
    if (query.fields) rows = rows.map((r) => pick(r, query.fields!));
    return { data: rows, total };
  }
  return { data: query.fields ? pick(data, query.fields) : data };
}
