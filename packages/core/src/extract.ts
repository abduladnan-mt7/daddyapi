import type { FieldSpec, Fields } from '@daddyapi/spec';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Hooks } from './hooks';

export interface ExtractWarning {
  field: string;
  message: string;
}

export interface ExtractContext {
  /** The page's final URL, used to resolve relative links for the "url" transform. */
  baseUrl: string;
  warnings: ExtractWarning[];
  /** Optional code escape-hatch providing custom transforms. */
  hooks?: Hooks;
}

type ObjectFieldSpec = Exclude<FieldSpec, string>;

function normalizeField(spec: FieldSpec): ObjectFieldSpec {
  return typeof spec === 'string' ? { selector: spec } : spec;
}

/** Extract every field of a resource from a context element (or the whole page). */
export function extractFields(
  $: CheerioAPI,
  ctx: Cheerio<any> | null,
  fields: Fields,
  context: ExtractContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, rawSpec] of Object.entries(fields)) {
    out[name] = extractField($, ctx, name, normalizeField(rawSpec), context);
  }
  return out;
}

function selectNodes($: CheerioAPI, ctx: Cheerio<any> | null, selector?: string): Cheerio<any> {
  if (selector) return ctx ? ctx.find(selector) : $(selector);
  return ctx ?? $.root();
}

function extractField(
  $: CheerioAPI,
  ctx: Cheerio<any> | null,
  name: string,
  spec: ObjectFieldSpec,
  context: ExtractContext,
): unknown {
  const nodes = selectNodes($, ctx, spec.selector);

  if (spec.many) {
    const values: unknown[] = [];
    nodes.each((_i: number, el: any) => {
      values.push(readValue($(el), spec, name, context));
    });
    return values;
  }

  if (nodes.length === 0) {
    if (spec.default !== undefined) return spec.default;
    if (!spec.optional) {
      context.warnings.push({
        field: name,
        message: `no match for selector "${spec.selector ?? '(self)'}"`,
      });
    }
    return null;
  }

  return readValue(nodes.first(), spec, name, context);
}

function readValue(
  node: Cheerio<any>,
  spec: ObjectFieldSpec,
  fieldName: string,
  context: ExtractContext,
): unknown {
  let raw: string;
  if (spec.attr) raw = node.attr(spec.attr) ?? '';
  else if (spec.html) raw = node.html() ?? '';
  else raw = node.text();

  let value: unknown = spec.html ? raw : collapseWhitespace(raw);

  const transforms = spec.transform
    ? Array.isArray(spec.transform)
      ? spec.transform
      : [spec.transform]
    : [];
  for (const transform of transforms) value = applyTransform(value, transform, fieldName, context);
  return value;
}

const collapseWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();

function firstNumber(s: string): string {
  const match = /-?\d+(?:\.\d+)?/.exec(s.replace(/[,\s]/g, ''));
  return match ? match[0] : '';
}

function applyTransform(
  value: unknown,
  name: string,
  fieldName: string,
  context: ExtractContext,
): unknown {
  const str = value == null ? '' : String(value);
  switch (name) {
    case 'trim':
      return str.trim();
    case 'lower':
      return str.toLowerCase();
    case 'upper':
      return str.toUpperCase();
    case 'int': {
      const n = Number.parseFloat(firstNumber(str));
      return Number.isNaN(n) ? null : Math.trunc(n);
    }
    case 'float':
    case 'number': {
      const n = Number.parseFloat(firstNumber(str));
      return Number.isNaN(n) ? null : n;
    }
    case 'boolean':
      return /^(true|yes|1|on)$/i.test(str.trim());
    case 'url':
      try {
        return new URL(str, context.baseUrl).href;
      } catch {
        return str;
      }
    default: {
      // Not a built-in — try the spec's code escape-hatch.
      const custom = context.hooks?.transforms?.[name];
      if (custom) return custom(value, { baseUrl: context.baseUrl });
      context.warnings.push({
        field: fieldName,
        message: `unknown transform "${name}" (not built-in and not found in hooks)`,
      });
      return value;
    }
  }
}
