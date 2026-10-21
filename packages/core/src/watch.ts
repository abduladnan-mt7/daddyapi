import { createHmac } from 'node:crypto';

type Row = Record<string, unknown>;

/** One field that differs between two versions of a row. */
export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface RowChange {
  key: string;
  before: Row;
  after: Row;
  fields: FieldChange[];
}

/** What changed between two runs of a resource. */
export interface DataDiff {
  added: Row[];
  removed: Row[];
  changed: RowChange[];
  /** Rows (or keys) seen in the new run. */
  total: number;
}

export function hasChanges(diff: DataDiff): boolean {
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}

function asRows(data: unknown): Row[] {
  const rows = Array.isArray(data) ? data : data === null || data === undefined ? [] : [data];
  return rows.map((row) => (row !== null && typeof row === 'object' && !Array.isArray(row) ? (row as Row) : { value: row }));
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Row).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/**
 * Identity of a row: the values of `keyFields`, or the whole row when no key is
 * given (then any edit shows up as one removal plus one addition).
 */
export function rowKey(row: Row, keyFields: string[] = []): string {
  if (keyFields.length === 0) return stable(row);
  return stable(keyFields.map((f) => row[f] ?? null));
}

/**
 * Compare two runs. List resources are matched row-by-row on `keyFields`; a
 * single-item resource is one row whose fields are compared directly.
 * Duplicate keys keep the first occurrence.
 */
export function diffData(previous: unknown, next: unknown, keyFields: string[] = []): DataDiff {
  const single = !Array.isArray(previous) && !Array.isArray(next);
  const keys = single ? ['__item__'] : keyFields;
  const keyOf = (row: Row) => (single ? '__item__' : rowKey(row, keys));

  const before = new Map<string, Row>();
  for (const row of asRows(previous)) if (!before.has(keyOf(row))) before.set(keyOf(row), row);
  const after = new Map<string, Row>();
  for (const row of asRows(next)) if (!after.has(keyOf(row))) after.set(keyOf(row), row);

  const diff: DataDiff = { added: [], removed: [], changed: [], total: after.size };
  for (const [key, row] of after) {
    const old = before.get(key);
    if (!old) {
      diff.added.push(row);
      continue;
    }
    const fields: FieldChange[] = [];
    for (const field of new Set([...Object.keys(old), ...Object.keys(row)])) {
      if (stable(old[field]) !== stable(row[field])) fields.push({ field, before: old[field], after: row[field] });
    }
    if (fields.length > 0) diff.changed.push({ key: single ? '' : key, before: old, after: row, fields });
  }
  for (const [key, row] of before) if (!after.has(key)) diff.removed.push(row);
  return diff;
}

/** Saved between runs of `daddyapi watch`. */
export interface WatchState {
  version: 1;
  spec: string;
  resource: string;
  key: string[];
  updatedAt: string;
  data: unknown;
}

/** A change event as printed or sent to a webhook. */
export interface WatchEvent {
  spec: string;
  resource: string;
  detectedAt: string;
  source: string;
  summary: { added: number; removed: number; changed: number; total: number };
  added: Row[];
  removed: Row[];
  changed: RowChange[];
}

export function buildWatchEvent(
  spec: string,
  resource: string,
  source: string,
  diff: DataDiff,
  detectedAt = new Date().toISOString(),
): WatchEvent {
  return {
    spec,
    resource,
    detectedAt,
    source,
    summary: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length, total: diff.total },
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
  };
}

/**
 * GitHub-style signature for a webhook body: `sha256=<hex HMAC>`, so the
 * receiver can verify the event came from you.
 */
export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function short(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text === undefined ? 'null' : text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Readable lines for the terminal. */
export function formatWatchEvent(event: WatchEvent, keyFields: string[] = []): string[] {
  const label = (row: Row) => {
    if (keyFields.length > 0) return keyFields.map((f) => short(row[f])).join(' / ');
    const first = Object.values(row).find((v) => typeof v === 'string' && v.trim());
    return short(first ?? row);
  };
  const lines: string[] = [];
  for (const row of event.added) lines.push(`+ added    ${label(row)}`);
  for (const row of event.removed) lines.push(`- removed  ${label(row)}`);
  for (const change of event.changed) {
    const what = change.fields.map((f) => `${f.field}: ${short(f.before)} → ${short(f.after)}`).join(', ');
    lines.push(`~ changed  ${label(change.after)}  (${what})`);
  }
  return lines;
}
