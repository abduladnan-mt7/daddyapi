import { pathToFileURL } from 'node:url';
import type { Resource, SiteSpec } from '@daddyapi/spec';

/** The built-in transform names handled by the extractor itself. */
export const BUILTIN_TRANSFORMS = new Set([
  'trim',
  'int',
  'float',
  'number',
  'boolean',
  'url',
  'lower',
  'upper',
]);

export interface TransformContext {
  /** The page's final URL (useful for resolving links). */
  baseUrl: string;
}

export interface PostProcessContext {
  baseUrl: string;
  spec: SiteSpec;
  resource: Resource;
}

/** A custom field transform — the per-value escape-hatch. */
export type CustomTransform = (value: unknown, ctx: TransformContext) => unknown;

/** A resource post-processor — the per-resource escape-hatch. */
export type PostProcess = (
  data: unknown,
  ctx: PostProcessContext,
) => unknown | Promise<unknown>;

/**
 * The shape of a spec's `hooks` module. Authors export named functions to
 * handle the hard cases the declarative spec can't express.
 *
 * ```js
 * // hooks.mjs
 * export const transforms = {
 *   rating: (value) => ({ one: 1, two: 2, three: 3 }[String(value).toLowerCase()] ?? null),
 * };
 * export const postProcess = {
 *   dedupe: (rows) => Array.from(new Map(rows.map((r) => [r.url, r])).values()),
 * };
 * ```
 */
export interface Hooks {
  transforms?: Record<string, CustomTransform>;
  postProcess?: Record<string, PostProcess>;
}

/**
 * Dynamically import a hooks module from a filesystem path. Accepts a module
 * that exports `transforms`/`postProcess` as named exports or as a default
 * export object.
 */
export async function loadHooks(modulePath: string): Promise<Hooks> {
  const mod = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  const candidate = (mod.default ?? mod) as Hooks;
  return {
    transforms: candidate.transforms,
    postProcess: candidate.postProcess,
  };
}
