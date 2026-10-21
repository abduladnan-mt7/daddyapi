import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, parseFlags } from '../src/index';

describe('parseFlags', () => {
  it('parses positionals, valued flags, booleans, and params', () => {
    const result = parseFlags([
      'quotes.yaml',
      'quotes',
      '--cache',
      '--params',
      'author=Albert, tag=life',
      '--verbose',
    ]);

    expect(result).toEqual({
      positionals: ['quotes.yaml', 'quotes'],
      flags: {
        cache: true,
        params: 'author=Albert, tag=life',
        verbose: true,
      },
    });
  });
});

describe('CLI commands', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints help and exits 1 for an unknown command', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'daddyapi', 'wat']);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await main();

    expect(process.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith('Unknown command: wat\n\n');
    expect(stdout.mock.calls.flat().join('')).toContain('Usage:');
  });

  it('validates the quotes example without fetching it', async () => {
    const specPath = fileURLToPath(new URL('../../../examples/quotes.yaml', import.meta.url));
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'daddyapi', 'validate', specPath]);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await main();

    expect(process.exitCode).toBeUndefined();
    expect(stdout.mock.calls.flat().join('')).toMatch(/is valid \(\d+ resource\(s\)\)/);
  });
});
