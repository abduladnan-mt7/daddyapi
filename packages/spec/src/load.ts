import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { siteSpecSchema, type SiteSpec } from './schema';

/** Parse a SiteSpec from a YAML or JSON string. Throws on invalid input. */
export function parseSiteSpec(source: string): SiteSpec {
  // yaml.parse accepts JSON too, so this covers both formats.
  const raw = parseYaml(source);
  return siteSpecSchema.parse(raw);
}

/** Like parseSiteSpec but returns a zod SafeParseReturn instead of throwing. */
export function safeParseSiteSpec(source: string) {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
  return siteSpecSchema.safeParse(raw);
}

/** Read and parse a SiteSpec file, adding the file path to any error message. */
export function loadSiteSpec(path: string): SiteSpec {
  const source = readFileSync(path, 'utf8');
  try {
    return parseSiteSpec(source);
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Failed to load spec "${path}":\n${err.message}`;
    }
    throw err;
  }
}
