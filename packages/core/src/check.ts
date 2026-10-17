import type { FieldSpec, Resource, SiteSpec } from '@daddyapi/spec';
import { createFetcher, FetchError, type PoliteFetcher } from './fetch';
import type { Hooks } from './hooks';
import { fieldValueType } from './openapi';
import { templateParams } from './params';
import { runResource } from './runtime';

/** Default share of rows a required field must fill when the spec doesn't say. */
export const DEFAULT_FILL_RATE = 0.9;

/** Statistics for one field across a resource's rows. */
export interface FieldProfile {
  /** Share of rows (0-1) with a non-empty value. */
  fillRate: number;
  /** Count of non-empty values by JSON type (string, number, boolean, array, object). */
  types: Record<string, number>;
}

/** What one run of a resource looked like, for comparing runs over time. */
export interface ResourceProfile {
  rows: number;
  fields: Record<string, FieldProfile>;
}

export type CheckSeverity = 'error' | 'warning';

export interface CheckIssue {
  severity: CheckSeverity;
  /** Field name, or undefined for resource-level issues. */
  field?: string;
  /** Stable identifier, e.g. "empty-list", "fill-rate", "type", "drift-rows". */
  code: string;
  message: string;
}

export interface ResourceCheck {
  resource: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'error';
  profile?: ResourceProfile;
  issues: CheckIssue[];
  /** Why the resource was skipped or errored. */
  reason?: string;
}

export interface CheckReport {
  spec: string;
  checkedAt: string;
  ok: boolean;
  resources: ResourceCheck[];
}

/** A saved profile per resource, written by `--update-baseline`. */
export interface Baseline {
  version: 1;
  spec: string;
  createdAt: string;
  resources: Record<string, ResourceProfile>;
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function fieldsOf(resource: Resource): Record<string, FieldSpec> {
  return resource.list?.fields ?? resource.item?.fields ?? {};
}

/** Profile extracted data: row count plus fill rate and value types per field. */
export function profileData(resource: Resource, data: unknown): ResourceProfile {
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  const fields: Record<string, FieldProfile> = {};
  for (const name of Object.keys(fieldsOf(resource))) {
    const types: Record<string, number> = {};
    let filled = 0;
    for (const row of rows) {
      const value = (row as Record<string, unknown>)?.[name];
      if (isEmpty(value)) continue;
      filled++;
      const t = jsonType(value);
      types[t] = (types[t] ?? 0) + 1;
    }
    fields[name] = { fillRate: rows.length === 0 ? 0 : filled / rows.length, types };
  }
  return { rows: Array.isArray(data) ? data.length : rows.length, fields };
}

function expectedType(spec: FieldSpec): string {
  if (typeof spec !== 'string' && spec.many) return 'array';
  return fieldValueType(spec);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Compare data against the resource's contract (implicit from the field specs,
 * plus anything in `expect`) and, when given, a baseline profile.
 */
export function evaluateResource(
  resource: Resource,
  data: unknown,
  baseline?: ResourceProfile,
): { profile: ResourceProfile; issues: CheckIssue[] } {
  const profile = profileData(resource, data);
  const issues: CheckIssue[] = [];
  const expect = resource.expect ?? {};
  const fieldSpecs = fieldsOf(resource);
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];

  for (const name of Object.keys(expect.fields ?? {})) {
    if (!(name in fieldSpecs)) {
      issues.push({ severity: 'error', field: name, code: 'unknown-field', message: `expect.fields.${name} is not a field of this resource` });
    }
  }

  if (resource.list) {
    const min = expect.minRows ?? 1;
    if (profile.rows < min) {
      issues.push({
        severity: 'error',
        code: profile.rows === 0 ? 'empty-list' : 'min-rows',
        message:
          profile.rows === 0
            ? `no rows matched "${resource.list.selector}"; the page layout may have changed`
            : `${profile.rows} rows, expected at least ${min}`,
      });
    }
    if (expect.maxRows !== undefined && profile.rows > expect.maxRows) {
      issues.push({ severity: 'error', code: 'max-rows', message: `${profile.rows} rows, expected at most ${expect.maxRows}` });
    }
  }

  if (rows.length > 0) {
    for (const [name, spec] of Object.entries(fieldSpecs)) {
      const field = profile.fields[name]!;
      const contract = expect.fields?.[name] ?? {};
      const optional = typeof spec !== 'string' && spec.optional === true;
      const requiredRate = contract.fillRate ?? (optional ? 0 : DEFAULT_FILL_RATE);
      if (field.fillRate < requiredRate) {
        issues.push({
          severity: 'error',
          field: name,
          code: field.fillRate === 0 ? 'missing-field' : 'fill-rate',
          message:
            field.fillRate === 0
              ? `never found; its selector may no longer match`
              : `filled in ${pct(field.fillRate)} of rows, expected at least ${pct(requiredRate)}`,
        });
      }

      const want = expectedType(spec);
      // A custom hook transform can return any type; only check known ones.
      const wrong = want === 'unknown' ? [] : Object.entries(field.types).filter(([t]) => t !== want);
      if (wrong.length > 0) {
        const count = wrong.reduce((n, [, c]) => n + c, 0);
        issues.push({
          severity: 'error',
          field: name,
          code: 'type',
          message: `${count} value(s) are ${wrong.map(([t]) => t).join('/')}, expected ${want}`,
        });
      }

      const pattern = contract.pattern ? new RegExp(contract.pattern) : undefined;
      let badPattern = 0;
      let outOfRange = 0;
      for (const row of rows) {
        const value = (row as Record<string, unknown>)?.[name];
        if (isEmpty(value)) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          if (pattern && !pattern.test(String(v))) badPattern++;
          if (typeof v === 'number' && ((contract.min !== undefined && v < contract.min) || (contract.max !== undefined && v > contract.max))) {
            outOfRange++;
          }
        }
      }
      if (badPattern > 0) {
        issues.push({ severity: 'error', field: name, code: 'pattern', message: `${badPattern} value(s) don't match /${contract.pattern}/` });
      }
      if (outOfRange > 0) {
        const range = `[${contract.min ?? '-∞'}, ${contract.max ?? '∞'}]`;
        issues.push({ severity: 'error', field: name, code: 'range', message: `${outOfRange} value(s) outside ${range}` });
      }
    }
  }

  if (baseline) issues.push(...compareToBaseline(profile, baseline));
  return { profile, issues };
}

/** Drift between two runs: sharp drops in rows or fill rate, and type changes. */
export function compareToBaseline(current: ResourceProfile, baseline: ResourceProfile): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (baseline.rows > 0 && current.rows < baseline.rows * 0.5) {
    issues.push({ severity: 'error', code: 'drift-rows', message: `rows dropped from ${baseline.rows} to ${current.rows}` });
  } else if (baseline.rows > 0 && current.rows > baseline.rows * 2) {
    issues.push({ severity: 'warning', code: 'drift-rows', message: `rows grew from ${baseline.rows} to ${current.rows}` });
  }
  for (const [name, before] of Object.entries(baseline.fields)) {
    const now = current.fields[name];
    if (!now) continue;
    const drop = before.fillRate - now.fillRate;
    if (drop >= 0.2) {
      issues.push({
        severity: drop >= 0.5 ? 'error' : 'warning',
        field: name,
        code: 'drift-fill-rate',
        message: `fill rate fell from ${pct(before.fillRate)} to ${pct(now.fillRate)}`,
      });
    }
    const beforeTypes = Object.keys(before.types).sort().join('/');
    const nowTypes = Object.keys(now.types).sort().join('/');
    if (beforeTypes && nowTypes && beforeTypes !== nowTypes) {
      issues.push({ severity: 'error', field: name, code: 'drift-type', message: `type changed from ${beforeTypes} to ${nowTypes}` });
    }
  }
  return issues;
}

export interface CheckOptions {
  fetcher?: PoliteFetcher;
  hooks?: Hooks;
  baseline?: Baseline;
  /** Only check these resources. */
  only?: string[];
  /** Pages to fetch per resource (default 1, so checks stay light on the site). */
  pages?: number;
}

/** Run every resource once and check it. Network failures are reported, not thrown. */
export async function checkSpec(spec: SiteSpec, options: CheckOptions = {}): Promise<CheckReport> {
  const fetcher = options.fetcher ?? createFetcher(spec.politeness);
  const resources: ResourceCheck[] = [];

  for (const resource of spec.resources) {
    if (options.only && !options.only.includes(resource.name)) continue;
    const needed = templateParams(resource.fetch.path);
    const params = resource.expect?.params ?? {};
    const missing = needed.filter((p) => params[p] === undefined);
    if (missing.length > 0) {
      resources.push({
        resource: resource.name,
        status: 'skipped',
        issues: [],
        reason: `needs example values for ${missing.map((p) => `{${p}}`).join(', ')}; add them under expect.params`,
      });
      continue;
    }

    try {
      const result = await runResource(spec, resource, {
        fetcher,
        params,
        maxPages: options.pages ?? 1,
        hooks: options.hooks,
      });
      const { profile, issues } = evaluateResource(resource, result.data, options.baseline?.resources[resource.name]);
      const status = issues.some((i) => i.severity === 'error') ? 'fail' : issues.length > 0 ? 'warn' : 'pass';
      resources.push({ resource: resource.name, status, profile, issues });
    } catch (err) {
      resources.push({
        resource: resource.name,
        status: 'error',
        issues: [],
        reason: err instanceof FetchError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    spec: spec.name,
    checkedAt: new Date().toISOString(),
    ok: resources.every((r) => r.status === 'pass' || r.status === 'warn' || r.status === 'skipped'),
    resources,
  };
}

/** Turn a passing report into a baseline to compare future runs against. */
export function baselineFromReport(report: CheckReport): Baseline {
  const resources: Record<string, ResourceProfile> = {};
  for (const r of report.resources) if (r.profile) resources[r.resource] = r.profile;
  return { version: 1, spec: report.spec, createdAt: report.checkedAt, resources };
}

/** Human-readable report for the terminal. */
export function formatReport(report: CheckReport): string {
  const icon: Record<ResourceCheck['status'], string> = {
    pass: 'PASS ',
    warn: 'WARN ',
    fail: 'FAIL ',
    skipped: 'SKIP ',
    error: 'ERROR',
  };
  const lines = [`daddyapi check: ${report.spec}`, ''];
  for (const r of report.resources) {
    const rows = r.profile ? ` (${r.profile.rows} row${r.profile.rows === 1 ? '' : 's'})` : '';
    lines.push(`  ${icon[r.status]}  ${r.resource}${rows}${r.reason ? `: ${r.reason}` : ''}`);
    for (const issue of r.issues) {
      const where = issue.field ? `${issue.field}: ` : '';
      lines.push(`           ${issue.severity === 'error' ? '✗' : '!'} ${where}${issue.message}`);
    }
  }
  const counts = report.resources.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  lines.push('', `  ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')}`, report.ok ? '  OK' : '  Problems found');
  return lines.join('\n');
}
