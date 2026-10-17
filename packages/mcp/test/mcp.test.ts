import { parseSiteSpec } from '@daddyapi/spec';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { fixture, testFetcher } from './helpers';
import { createMcpServer, toolName } from '../src/index';

const spec = parseSiteSpec(`
name: quotes
baseUrl: https://quotes.example.com
description: Quotes from a scraping sandbox
resources:
  - name: quotes
    description: Quotes with their author and tags
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
`);

async function connect(fetcherMap: Record<string, string> = {
  'https://quotes.example.com/': fixture('quotes.html'),
  'https://quotes.example.com/page/2/': fixture('quotes-page2.html'),
}) {
  const server = createMcpServer(spec, { fetcher: testFetcher(fetcherMap), maxPagesLimit: 10 });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe('createMcpServer', () => {
  it('identifies itself and gives agents instructions', async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe('daddyapi-quotes');
    expect(client.getInstructions()).toContain('no LLM involved');
  });

  it('exposes one read-only tool per resource with typed inputs', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['author_page', 'quotes']);

    const quotes = tools.find((t) => t.name === 'quotes')!;
    expect(quotes.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(quotes.description).toContain('Returns a list of rows with fields: text, author, tags');
    const props = quotes.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(props).sort()).toEqual(['fields', 'limit', 'offset', 'pages']);
    expect(props.pages).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 });
    expect(quotes.outputSchema?.properties).toHaveProperty('data');

    const author = tools.find((t) => t.name === 'author_page')!;
    expect(author.inputSchema.required).toEqual(['slug']);
  });

  it('returns structured, typed data', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'quotes', arguments: { pages: 1 } });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { data: Array<Record<string, unknown>>; meta: Record<string, unknown> };
    expect(payload.data).toHaveLength(3);
    expect(payload.data[0]).toHaveProperty('author');
    expect(Array.isArray(payload.data[0]!.tags)).toBe(true);
    expect(payload.meta).toMatchObject({ resource: 'quotes', pages: 1, total: 3, returned: 3 });
    // The same payload is available as text for clients without structured output.
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(payload);
  });

  it('follows pagination and applies limit, offset and fields', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'quotes',
      arguments: { pages: 2, offset: 2, limit: 2, fields: ['author'] },
    });
    const payload = result.structuredContent as { data: Array<Record<string, unknown>>; meta: Record<string, unknown> };
    expect(payload.meta).toMatchObject({ pages: 2, total: 5, returned: 2 });
    expect(payload.data.every((row) => Object.keys(row).join() === 'author')).toBe(true);
  });

  it('rejects arguments outside the schema before fetching anything', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'quotes', arguments: { pages: 99 } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/pages/);
  });

  it('reports a missing required argument as a tool error', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'author_page', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/slug/);
  });

  it('reports an upstream failure as a tool error, not a crash', async () => {
    const client = await connect({});
    const result = await client.callTool({ name: 'quotes', arguments: { pages: 1 } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('could not be fetched (http-error)');
  });

  it('serves the OpenAPI document as an MCP resource', async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('daddyapi://quotes/openapi.json');
    const read = await client.readResource({ uri: 'daddyapi://quotes/openapi.json' });
    const doc = JSON.parse((read.contents[0] as { text: string }).text) as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty('/quotes');
  });
});

describe('toolName', () => {
  it('makes names safe and supports a prefix', () => {
    expect(toolName(spec.resources[1]!)).toBe('author_page');
    expect(toolName(spec.resources[0]!, 'my-site')).toBe('my_site_quotes');
  });
});
