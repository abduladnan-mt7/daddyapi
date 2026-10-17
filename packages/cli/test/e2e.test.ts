import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end: run the built CLI as a real process against a local copy of a
// website, and talk to it the way users and agents do (HTTP and MCP stdio).
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const FIXTURES = new URL('../../core/test/fixtures/', import.meta.url);
const built = existsSync(CLI);

let site: Server;
let siteUrl: string;
let dir: string;
let specPath: string;
const hits: string[] = [];
let pages: Record<string, string> = {};

beforeAll(async () => {
  if (!built) return;
  pages = {
    '/': readFileSync(new URL('quotes.html', FIXTURES), 'utf8'),
    '/page/2/': readFileSync(new URL('quotes-page2.html', FIXTURES), 'utf8'),
    '/robots.txt': 'User-agent: *\nDisallow: /private/\n',
  };
  site = createServer((req, res) => {
    hits.push(req.url ?? '');
    const body = pages[req.url ?? ''];
    if (body === undefined) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': req.url === '/robots.txt' ? 'text/plain' : 'text/html' }).end(body);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  dir = mkdtempSync(join(tmpdir(), 'daddyapi-e2e-'));
  specPath = join(dir, 'quotes.yaml');
  writeFileSync(
    specPath,
    `name: quotes
baseUrl: ${siteUrl}
politeness: { requestsPerSecond: 50, cacheTtl: 1m }
resources:
  - name: quotes
    description: Quotes with their author
    fetch:
      path: /
      pagination: { type: link, selector: "li.next a", maxPages: 5 }
    list:
      selector: .quote
      fields:
        text: .text
        author: .author
  - name: secret
    fetch: { path: /private/ }
    item:
      fields:
        title: h1
`,
  );
});

afterAll(async () => {
  if (!built) return;
  await new Promise<void>((resolve) => site.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Start `daddyapi dev` on a free port and resolve with its base URL once it is listening. */
function startDev(extra: string[], env: NodeJS.ProcessEnv = {}): Promise<{ child: ChildProcess; base: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'dev', specPath, '--port', '0', '--host', '127.0.0.1', ...extra], {
      env: { ...process.env, ...env },
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`dev did not start: ${out}`)), 15_000);
    child.stdout!.on('data', (d) => {
      out += d;
      const match = /API\s+(http:\/\/127\.0\.0\.1:\d+)\//.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve({ child, base: match[1]! });
      }
    });
    child.stderr!.on('data', (d) => (out += d));
    child.on('exit', (code) => reject(new Error(`dev exited with ${code}: ${out}`)));
  });
}

describe.skipIf(!built)('e2e: daddyapi dev (HTTP API)', () => {
  let child: ChildProcess;
  let base: string;

  beforeAll(async () => {
    ({ child, base } = await startDev(['--api-key', 'k1', '--rate-limit', '5/min', '--cors', 'https://app.example']));
  });
  afterAll(() => child?.kill());

  it('serves the index, health, OpenAPI and docs without a key', async () => {
    const index = (await (await fetch(`${base}/`)).json()) as { name: string; auth: string };
    expect(index).toMatchObject({ name: 'quotes', auth: 'api-key' });
    expect(((await (await fetch(`${base}/health`)).json()) as { status: string }).status).toBe('ok');
    const doc = (await (await fetch(`${base}/openapi.json`)).json()) as { components: Record<string, unknown> };
    expect(doc.components).toHaveProperty('securitySchemes');
    expect((await fetch(`${base}/docs`)).headers.get('content-type')).toContain('text/html');
  });

  it('requires the API key on resources', async () => {
    expect((await fetch(`${base}/quotes`)).status).toBe(401);
    expect((await fetch(`${base}/quotes`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
  });

  it('returns real data from the site, following pagination', async () => {
    const res = await fetch(`${base}/quotes?pages=2&fields=author`, {
      headers: { 'X-API-Key': 'k1', Origin: 'https://app.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const body = (await res.json()) as { data: Array<{ author: string }>; meta: { pages: number; total: number } };
    expect(body.meta).toMatchObject({ pages: 2, total: 5 });
    expect(body.data.every((row) => typeof row.author === 'string')).toBe(true);
  });

  it('answers 304 for unchanged content', async () => {
    const headers = { 'X-API-Key': 'k1' };
    const first = await fetch(`${base}/quotes?pages=1`, { headers });
    const tag = first.headers.get('etag')!;
    const second = await fetch(`${base}/quotes?pages=1`, { headers: { ...headers, 'If-None-Match': tag } });
    expect(second.status).toBe(304);
  });

  it('honours robots.txt with a 403', async () => {
    const res = await fetch(`${base}/secret`, { headers: { 'X-API-Key': 'k1' } });
    expect(res.status).toBe(403);
    expect(hits).not.toContain('/private/');
  });

  it('validates input with a 400', async () => {
    const res = await fetch(`${base}/quotes?pages=nope`, { headers: { 'X-API-Key': 'k1' } });
    expect(res.status).toBe(400);
  });

  it('rate-limits per client with 429', async () => {
    let last = 0;
    for (let i = 0; i < 8; i++) {
      last = (await fetch(`${base}/quotes?pages=1`, { headers: { 'X-API-Key': 'k1' } })).status;
    }
    expect(last).toBe(429);
  });
});

describe.skipIf(!built)('e2e: daddyapi mcp (stdio)', () => {
  it('lists typed tools and returns real data to an MCP client', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp', specPath],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['quotes', 'secret']);

      const result = await client.callTool({ name: 'quotes', arguments: { pages: 2, limit: 4 } });
      expect(result.isError).toBeFalsy();
      const payload = result.structuredContent as { data: unknown[]; meta: { total: number; returned: number } };
      expect(payload.meta).toMatchObject({ total: 5, returned: 4 });

      const blocked = await client.callTool({ name: 'secret', arguments: {} });
      expect(blocked.isError).toBe(true);
      expect((blocked.content as Array<{ text: string }>)[0]!.text).toContain('robots.txt');
    } finally {
      await client.close();
    }
  });
});

describe.skipIf(!built)('e2e: CLI commands', () => {
  it('init drafts a valid spec from a live page', async () => {
    const out = join(dir, 'draft.yaml');
    const init = await run(['init', `${siteUrl}/`, '--out', out]);
    expect(init.code).toBe(0);
    const validate = await run(['validate', out]);
    expect(validate.stdout).toContain('is valid');
  });

  it('explains when a URL is passed instead of a spec file', async () => {
    const res = await run(['dev', 'quotes.toscrape.com']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('needs a spec file');
    expect(res.stderr).toContain('daddyapi init quotes.toscrape.com --out site.yaml');
  });

  it('run prints the extracted JSON', async () => {
    const res = await run(['run', specPath, 'quotes', '--pages', '1']);
    expect(res.code).toBe(0);
    expect((JSON.parse(res.stdout) as { data: unknown[] }).data).toHaveLength(3);
  });

  it('build emits the OpenAPI document', async () => {
    const res = await run(['build', specPath]);
    expect((JSON.parse(res.stdout) as { openapi: string }).openapi).toBe('3.0.3');
  });
});

describe.skipIf(!built)('e2e: check, types and formats', () => {
  it('run --format csv writes CSV', async () => {
    const res = await run(['run', specPath, 'quotes', '--pages', '1', '--format', 'csv']);
    expect(res.code).toBe(0);
    const lines = res.stdout.trim().split(/\r?\n/);
    expect(lines[0]).toBe('text,author');
    expect(lines).toHaveLength(4);
  });

  it('check passes, saves a baseline, then catches a site redesign', async () => {
    const only = ['--only', 'quotes'];
    const baseline = join(dir, 'quotes.baseline.json');

    const first = await run(['check', specPath, ...only, '--update-baseline']);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('PASS   quotes');
    expect(existsSync(baseline)).toBe(true);

    const original = pages['/']!;
    pages['/'] = original.replace(/class="author"/g, 'class="writer"');
    try {
      const second = await run(['check', specPath, ...only, '--json']);
      expect(second.code).toBe(1);
      const report = JSON.parse(second.stdout) as {
        ok: boolean;
        resources: Array<{ status: string; issues: Array<{ field?: string; code: string }> }>;
      };
      expect(report.ok).toBe(false);
      expect(report.resources[0]!.status).toBe('fail');
      expect(report.resources[0]!.issues.map((i) => `${i.field}:${i.code}`)).toEqual(
        expect.arrayContaining(['author:missing-field', 'author:drift-fill-rate']),
      );
    } finally {
      pages['/'] = original;
    }
  });

  it('check exits 2 when the site cannot be reached', async () => {
    const broken = join(dir, 'down.yaml');
    writeFileSync(
      broken,
      `name: down
baseUrl: http://127.0.0.1:9
politeness: { maxRetries: 0, timeoutMs: 2000 }
resources:
  - name: r
    fetch: { path: / }
    list: { selector: .x, fields: { x: .x } }
`,
    );
    const res = await run(['check', broken]);
    expect(res.code).toBe(2);
    expect(res.stdout).toContain('ERROR  r');
  });

  it('types writes a TypeScript client', async () => {
    const out = join(dir, 'client.ts');
    const res = await run(['types', specPath, '--out', out]);
    expect(res.code).toBe(0);
    const source = readFileSync(out, 'utf8');
    expect(source).toContain('export interface QuotesRow');
    expect(source).toContain('export class QuotesClient');
  });

  it('types --json-schema writes JSON Schema', async () => {
    const res = await run(['types', specPath, '--json-schema']);
    const schema = JSON.parse(res.stdout) as { $defs: Record<string, unknown> };
    expect(Object.keys(schema.$defs)).toEqual(['Quotes', 'Secret']);
  });
});

describe.skipIf(!built)('e2e: watch', () => {
  it('saves a baseline, detects changes, and delivers a signed webhook (retrying after a failure)', async () => {
    const { createHmac } = await import('node:crypto');
    const state = join(dir, 'quotes.watch.json');
    const received: Array<{ body: string; signature?: string }> = [];
    let failNext = true;
    const hook = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        if (failNext) {
          failNext = false;
          res.writeHead(500).end();
          return;
        }
        received.push({ body, signature: req.headers['x-daddyapi-signature'] as string | undefined });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve));
    const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;
    const args = ['watch', specPath, 'quotes', '--key', 'text', '--once', '--state', state, '--pages', '1'];

    try {
      const first = await run([...args, '--json']);
      expect(first.code).toBe(0);
      expect(first.stderr).toContain('Baseline saved: watching 3 rows');
      expect(first.stdout).toBe('');

      const unchanged = await run([...args, '--json']);
      expect(unchanged.stderr).toContain('No changes (3 rows)');

      const original = pages['/']!;
      const firstAuthor = /class="author">([^<]+)</.exec(original)![1]!;
      pages['/'] = original.replace(`class="author">${firstAuthor}<`, 'class="author">Someone Else<');
      try {
        const withHook = [...args, '--json', '--webhook', hookUrl, '--webhook-secret', 'sh'];

        // The receiver fails the first delivery: exit 1 and keep the old state.
        const failed = await run(withHook);
        expect(failed.code).toBe(1);
        expect(failed.stderr).toContain('Webhook failed');

        // Next run sends the same change again, signed.
        const delivered = await run(withHook);
        expect(delivered.code).toBe(0);
        const event = JSON.parse(delivered.stdout) as {
          summary: Record<string, number>;
          changed: Array<{ fields: Array<{ field: string; before: unknown; after: unknown }> }>;
        };
        expect(event.summary).toMatchObject({ added: 0, removed: 0, changed: 1 });
        expect(event.changed[0]!.fields).toEqual([{ field: 'author', before: firstAuthor, after: 'Someone Else' }]);

        expect(received).toHaveLength(1);
        const expected = `sha256=${createHmac('sha256', 'sh').update(received[0]!.body).digest('hex')}`;
        expect(received[0]!.signature).toBe(expected);

        // Delivered, so the state moved on.
        expect((await run([...args, '--json'])).stderr).toContain('No changes');
      } finally {
        pages['/'] = original;
      }

      const human = await run(args.filter((a) => a !== '--once').concat('--once'));
      expect(human.stdout).toContain('quotes: 0 added, 0 removed, 1 changed');
      expect(human.stdout).toMatch(/~ changed .*\(author: Someone Else → /);
    } finally {
      await new Promise<void>((resolve) => hook.close(() => resolve()));
    }
  }, 60_000);

  it('refuses a too-short interval', async () => {
    const res = await run(['watch', specPath, 'quotes', '--every', '5s']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('at least 30s');
  });
});
