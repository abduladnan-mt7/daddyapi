import { fileURLToPath } from 'node:url';
import { parseSiteSpec } from '@daddyapi/spec';
import { describe, expect, it } from 'vitest';
import { type Hooks, loadHooks } from '../src/hooks';
import { getResource, runResource } from '../src/runtime';
import { fixture, testFetcher } from './helpers';

const spec = parseSiteSpec(`
name: quotes
baseUrl: https://quotes.example.com
hooks: ./hooks.mjs
resources:
  - name: quotes
    fetch: { path: / }
    postProcess: first
    list:
      selector: .quote
      fields:
        author:
          selector: small.author
          transform: shout
`);

const hooks: Hooks = {
  transforms: { shout: (v) => `${String(v).toUpperCase()}!` },
  postProcess: { first: (data) => (Array.isArray(data) ? data.slice(0, 1) : data) },
};

describe('hooks (code escape-hatch)', () => {
  it('applies a custom transform and a postProcess hook', async () => {
    const fetcher = testFetcher({ 'https://quotes.example.com/': fixture('quotes.html') });
    const result = await runResource(spec, getResource(spec, 'quotes'), { fetcher, hooks });
    const data = result.data as Array<Record<string, unknown>>;

    expect(data).toHaveLength(1); // postProcess "first" kept a single row
    expect(data[0]!.author).toBe('AUTHOR ONE!'); // custom "shout" transform
    expect(result.warnings).toHaveLength(0);
  });

  it('warns when a transform is unknown and no hook supplies it', async () => {
    const fetcher = testFetcher({ 'https://quotes.example.com/': fixture('quotes.html') });
    const result = await runResource(spec, getResource(spec, 'quotes'), { fetcher });
    expect(result.warnings.some((w) => w.message.includes('unknown transform'))).toBe(true);
  });

  it('loads a hooks module from disk', async () => {
    const path = fileURLToPath(new URL('./fixtures/hooks.mjs', import.meta.url));
    const loaded = await loadHooks(path);
    expect(typeof loaded.transforms?.shout).toBe('function');
    expect(typeof loaded.postProcess?.first).toBe('function');
  });
});
