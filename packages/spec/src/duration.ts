const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a human-friendly duration ("10m", "30s", "1h", "500") into milliseconds.
 * A bare number is treated as milliseconds.
 */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}"`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  return Math.round(amount * UNITS[unit]!);
}
