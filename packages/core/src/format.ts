/** Output formats the HTTP API and CLI can emit besides the JSON envelope. */
export type DataFormat = 'json' | 'csv' | 'ndjson';

export const DATA_FORMATS: readonly DataFormat[] = ['json', 'csv', 'ndjson'];

export const FORMAT_CONTENT_TYPES: Record<DataFormat, string> = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  ndjson: 'application/x-ndjson; charset=utf-8',
};

function rowsOf(data: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(data) ? data : data === null || data === undefined ? [] : [data];
  return rows.map((row) => (row !== null && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : { value: row }));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('; ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise spreadsheet formula injection (cells starting with = + - @ tab or CR).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * RFC 4180 CSV of the data rows. Columns follow `columns` (e.g. the spec's
 * field order), then any extra keys. Arrays are joined with "; ".
 */
export function toCsv(data: unknown, columns: string[] = []): string {
  const rows = rowsOf(data);
  const header = [...columns];
  for (const row of rows) for (const key of Object.keys(row)) if (!header.includes(key)) header.push(key);
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(header.map((key) => csvCell(row[key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** One JSON object per line. */
export function toNdjson(data: unknown): string {
  return rowsOf(data)
    .map((row) => JSON.stringify(row))
    .join('\n')
    .concat(rowsOf(data).length > 0 ? '\n' : '');
}
