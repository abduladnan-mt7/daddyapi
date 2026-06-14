import { z } from 'zod';

/**
 * The SiteSpec is the heart of daddyapi: one declarative document that describes
 * how to turn a bot-friendly website into a documented API. Every other package
 * either produces a SiteSpec (the crawler/infer step) or consumes one (runtime,
 * server, SDK). Keeping it a plain data structure is what lets a future Python
 * runtime read the exact same files.
 */

/** Value transforms applied after a raw string is pulled from the page. */
export const transformSchema = z.enum([
  'trim',
  'int',
  'float',
  'number',
  'boolean',
  'url',
  'lower',
  'upper',
]);
export type Transform = z.infer<typeof transformSchema>;

/**
 * How to extract one field. A bare string is shorthand for a CSS selector whose
 * trimmed text content becomes the value.
 */
export const fieldSpecSchema = z.union([
  z.string(),
  z
    .object({
      /** CSS selector relative to the row/page. Omit to use the context element itself. */
      selector: z.string().optional(),
      /** Pull an attribute instead of text (e.g. "href", "src", "id"). */
      attr: z.string().optional(),
      /** Pull inner HTML instead of text. */
      html: z.boolean().optional(),
      /** Collect every match into an array (e.g. a list of tags). */
      many: z.boolean().optional(),
      /**
       * One transform or an ordered list. Built-in names are listed in
       * `transformSchema`; any other name is resolved from the spec's `hooks`
       * module (the code escape-hatch) at runtime.
       */
      transform: z.union([z.string(), z.array(z.string())]).optional(),
      /** Value to use when nothing matches. */
      default: z.unknown().optional(),
      /** When true, a missing value yields null instead of a warning. */
      optional: z.boolean().optional(),
    })
    .strict(),
]);
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const fieldsSchema = z.record(z.string(), fieldSpecSchema);
export type Fields = z.infer<typeof fieldsSchema>;

/** How to walk from one page to the next. */
export const paginationSchema = z
  .object({
    type: z.enum(['link', 'query']),
    /** For type "link": selector for the "next page" anchor. */
    selector: z.string().optional(),
    /** For type "query": the query parameter to increment (e.g. "page"). */
    param: z.string().optional(),
    /** For type "query": first page number (default 1). */
    start: z.number().int().optional(),
    /** For type "query": increment between pages (default 1). */
    step: z.number().int().optional(),
    /** Hard cap on pages fetched per request. */
    maxPages: z.number().int().positive().default(1),
  })
  .strict();
export type Pagination = z.infer<typeof paginationSchema>;

export const fetchSpecSchema = z
  .object({
    /** Path relative to baseUrl. Supports {param} templating from query params. */
    path: z.string(),
    pagination: paginationSchema.optional(),
  })
  .strict();
export type FetchSpec = z.infer<typeof fetchSpecSchema>;

/** A collection endpoint: a repeating row selector plus per-row fields. */
export const listSpecSchema = z
  .object({
    selector: z.string(),
    fields: fieldsSchema,
  })
  .strict();
export type ListSpec = z.infer<typeof listSpecSchema>;

/** A single-object endpoint: fields extracted from the whole page. */
export const itemSpecSchema = z
  .object({
    fields: fieldsSchema,
  })
  .strict();
export type ItemSpec = z.infer<typeof itemSpecSchema>;

export const resourceSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9-]+$/i, 'resource name must be url-safe (letters, numbers, hyphens)'),
    description: z.string().optional(),
    fetch: fetchSpecSchema,
    list: listSpecSchema.optional(),
    item: itemSpecSchema.optional(),
    /** Name of a function in the spec's `hooks` module to post-process this resource's data. */
    postProcess: z.string().optional(),
  })
  .strict()
  .refine((r) => r.list !== undefined || r.item !== undefined, {
    message: 'resource must define either "list" or "item"',
  });
export type Resource = z.infer<typeof resourceSchema>;

/**
 * Politeness defaults are deliberately conservative. daddyapi targets sites that
 * welcome bots; these settings keep it a good citizen out of the box.
 */
export const politenessSchema = z
  .object({
    requestsPerSecond: z.number().positive().default(1),
    respectRobotsTxt: z.boolean().default(true),
    cacheTtl: z.string().default('10m'),
    userAgent: z
      .string()
      .default('daddyapi-bot (+https://github.com/abduladnan-mt7/daddyapi)'),
    timeoutMs: z.number().int().positive().default(15_000),
    maxRetries: z.number().int().nonnegative().default(2),
  })
  .strict()
  .default({});
export type Politeness = z.infer<typeof politenessSchema>;

export const siteSpecSchema = z
  .object({
    name: z.string(),
    baseUrl: z.string().url(),
    description: z.string().optional(),
    /** Path (relative to the spec file) to a JS module of code escape-hatch hooks. */
    hooks: z.string().optional(),
    politeness: politenessSchema,
    resources: z.array(resourceSchema).min(1),
  })
  .strict();
export type SiteSpec = z.infer<typeof siteSpecSchema>;
