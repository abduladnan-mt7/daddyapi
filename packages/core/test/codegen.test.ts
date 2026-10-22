import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSiteSpec } from '@daddyapi/spec';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { camelCase, generateJsonSchema, generateTypeScript, pascalCase } from '../src/codegen';
import { createServer } from '../src/serve';
import { fixture, testFetcher } from './helpers';

const spec = parseSiteSpec(`
name: quotes-site
baseUrl: https://quotes.example.com
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
        tags: { selector: .tag, many: true }
  - name: author-page
    fetch: { path: "/author/{slug}/" }
    item:
      fields:
        name: h3
        born-year: { selector: .born, transform: int, optional: true }
`);

const dir = mkdtempSync(join(tmpdir(), 'daddyapi-codegen-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('naming', () => {
  it('converts resource names to TypeScript identifiers', () => {
    expect(pascalCase('author-page')).toBe('AuthorPage');
    expect(camelCase('author-page')).toBe('authorPage');
    expect(pascalCase('2fa-codes')).toBe('_2faCodes');
  });
});

describe('generateTypeScript', () => {
  const source = generateTypeScript(spec);

  it('emits interfaces, params types and a typed client', () => {
    expect(source).toContain('export interface QuotesRow {');
    expect(source).toContain('tags: string[] | null;');
    expect(source).toContain('"born-year": number | null;');
    expect(source).toContain('export interface AuthorPageParams {\n  slug: string | number;');
    expect(source).toContain('fields?: Array<"text" | "author" | "tags">;');
    expect(source).toContain('export class QuotesSiteClient {');
    expect(source).toContain('quotes(params?: QuotesParams): Promise<Envelope<QuotesRow[]>>');
    expect(source).toContain('authorPage(params: AuthorPageParams): Promise<Envelope<AuthorPage>>');
  });

  it('type-checks under strict mode', () => {
    const file = join(dir, 'client.ts');
    writeFileSync(file, source);
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      skipLibCheck: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    );
    expect(diagnostics).toEqual([]);
  });

  it('produces a client that works against a real daddyapi server', async () => {
    const app = createServer(spec, {
      apiKeys: ['k'],
      fetcher: testFetcher({
        'https://quotes.example.com/': fixture('quotes.html'),
        'https://quotes.example.com/page/2/': fixture('quotes-page2.html'),
      }),
    });
    const js = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const file = join(dir, 'client.mjs');
    writeFileSync(file, js);
    const mod = (await import(/* @vite-ignore */ decodeURI(pathToFileURL(file).href))) as Record<string, any>;

    const viaApp = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
    const client = new mod.QuotesSiteClient('http://api.local/', { apiKey: 'k', fetch: viaApp });
    const page = await client.quotes({ pages: 2, limit: 2, fields: ['author'] });
    expect(page.meta).toMatchObject({ total: 5, returned: 2 });
    expect(Object.keys(page.data[0])).toEqual(['author']);

    const anonymous = new mod.QuotesSiteClient('http://api.local', { fetch: viaApp });
    await expect(anonymous.quotes()).rejects.toMatchObject({ name: 'ApiError', status: 401, code: 'unauthorized' });
  });
});

describe('generateJsonSchema', () => {
  it('describes each resource', () => {
    const schema = generateJsonSchema(spec) as { $defs: Record<string, any> };
    expect(schema.$defs.Quotes.type).toBe('array');
    expect(schema.$defs.Quotes.items.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(schema.$defs.AuthorPage.properties['born-year']).toMatchObject({ type: 'number' });
  });
});

describe('generateTypeScript with hostile spec text', () => {
  it('cannot break out of generated comments to inject code', () => {
    // Built from JSON so the line break and comment terminators reach the spec verbatim.
    const hostile = parseSiteSpec(
      JSON.stringify({
        name: "evil" + String.fromCharCode(10) + "console.log('pwned') //",
        baseUrl: 'https://x.example.com',
        resources: [
          {
            name: 'r',
            description: "nice */ console.log('pwned'); /*",
            fetch: { path: '/' },
            list: { selector: '.r', fields: { a: '.a' } },
          },
        ],
      }),
    );
    expect(hostile.name).toContain(String.fromCharCode(10));
    const source = generateTypeScript(hostile);
    const { outputText } = ts.transpileModule(source, { compilerOptions: { removeComments: true } });
    expect(outputText).not.toContain("console.log('pwned')");
  });
});
