import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import {
  buildOpenApi,
  createFetcher,
  createServer,
  FileCache,
  getResource,
  type Hooks,
  inferSpec,
  loadHooks,
  type PoliteFetcher,
  runResource,
} from '@daddyapi/core';
import { loadSiteSpec, type SiteSpec, safeParseSiteSpec } from '@daddyapi/spec';
import { stringify as toYaml } from 'yaml';

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function resolveHooks(spec: SiteSpec, specPath: string): Promise<Hooks | undefined> {
  if (!spec.hooks) return undefined;
  const hookPath = resolve(dirname(specPath), spec.hooks);
  return loadHooks(hookPath);
}

// Build a fetcher with a persistent disk cache when --cache is passed, so
// repeated runs don't re-hit the site. Defaults the cache dir to .daddyapi-cache.
function buildFetcher(spec: SiteSpec, flags: Flags): PoliteFetcher | undefined {
  const cache = flags.cache;
  if (!cache) return undefined;
  const dir = typeof cache === 'string' ? cache : '.daddyapi-cache';
  return createFetcher(spec.politeness, { cache: new FileCache(dir) });
}

function parseParams(raw: string | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (!raw) return params;
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    params[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return params;
}

async function cmdRun(positionals: string[], flags: Flags): Promise<void> {
  const [specPath, resourceName] = positionals;
  if (!specPath || !resourceName) {
    throw new Error('Usage: daddyapi run <spec> <resource> [--pages N] [--params k=v,k2=v2]');
  }
  const spec = loadSiteSpec(specPath);
  const resource = getResource(spec, resourceName);
  const hooks = await resolveHooks(spec, specPath);
  const pagesFlag = str(flags.pages);
  const result = await runResource(spec, resource, {
    params: parseParams(str(flags.params)),
    maxPages: pagesFlag ? Number(pagesFlag) : undefined,
    hooks,
    fetcher: buildFetcher(spec, flags),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.warnings.length > 0) {
    process.stderr.write(`\n${result.warnings.length} warning(s):\n`);
    for (const w of result.warnings) process.stderr.write(`  - ${w.field}: ${w.message}\n`);
  }
}

async function cmdDev(positionals: string[], flags: Flags): Promise<void> {
  const [specPath] = positionals;
  if (!specPath) throw new Error('Usage: daddyapi dev <spec> [--port N]');
  const spec = loadSiteSpec(specPath);
  const hooks = await resolveHooks(spec, specPath);
  const portFlag = str(flags.port);
  const port = portFlag ? Number(portFlag) : 8787;
  const app = createServer(spec, { hooks, fetcher: buildFetcher(spec, flags) });
  serve({ fetch: app.fetch, port });
  process.stdout.write(`\n  daddyapi serving "${spec.name}"\n`);
  process.stdout.write(`  API      http://localhost:${port}/\n`);
  process.stdout.write(`  Docs     http://localhost:${port}/docs\n`);
  process.stdout.write(`  OpenAPI  http://localhost:${port}/openapi.json\n\n`);
  for (const resource of spec.resources) {
    process.stdout.write(`  GET http://localhost:${port}/${resource.name}\n`);
  }
  process.stdout.write('\n  Press Ctrl+C to stop.\n');
}

function cmdValidate(positionals: string[]): void {
  const [specPath] = positionals;
  if (!specPath) throw new Error('Usage: daddyapi validate <spec>');
  const result = safeParseSiteSpec(readFileSync(specPath, 'utf8'));
  if (result.success) {
    const count = result.data.resources.length;
    process.stdout.write(`OK  ${specPath} is valid (${count} resource(s))\n`);
    return;
  }
  process.stderr.write(`FAIL  ${specPath} is invalid:\n`);
  const error = result.error as { issues?: Array<{ path: Array<string | number>; message: string }> };
  if (error.issues) {
    for (const issue of error.issues) {
      process.stderr.write(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}\n`);
    }
  } else {
    process.stderr.write(`  ${result.error.message}\n`);
  }
  process.exitCode = 1;
}

async function cmdInit(positionals: string[], flags: Flags): Promise<void> {
  const [url] = positionals;
  if (!url) throw new Error('Usage: daddyapi init <url> [--out spec.yaml]');
  process.stderr.write(`Crawling ${url} ...\n`);
  const spec = await inferSpec(url);
  const header =
    '# Auto-generated DRAFT spec — review the selectors before relying on it.\n' +
    `# Generated by: daddyapi init ${url}\n\n`;
  const yaml = header + toYaml(spec);
  const out = str(flags.out);
  if (out) {
    writeFileSync(out, yaml);
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(yaml);
  }
}

function cmdBuild(positionals: string[], flags: Flags): void {
  const [specPath] = positionals;
  if (!specPath) throw new Error('Usage: daddyapi build <spec> [--out openapi.json]');
  const spec = loadSiteSpec(specPath);
  const doc = `${JSON.stringify(buildOpenApi(spec), null, 2)}\n`;
  const out = str(flags.out);
  if (out) {
    writeFileSync(out, doc);
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(doc);
  }
}

function printHelp(): void {
  process.stdout.write(`daddyapi — point it at a bot-friendly website, get a documented API.

Usage:
  daddyapi init <url> [--out spec.yaml]      Crawl a site and write a draft SiteSpec
  daddyapi dev <spec> [--port 8787] [--cache [dir]]
                                             Serve the spec as a live API with Swagger docs
  daddyapi run <spec> <resource> [--pages N] [--params k=v,...] [--cache [dir]]
                                             Fetch one resource and print JSON

  --cache [dir]  Persist fetched pages to disk (default dir: .daddyapi-cache),
                 so repeated runs don't re-hit the site.
  daddyapi validate <spec>                   Check a spec against the schema
  daddyapi build <spec> [--out openapi.json] Emit the OpenAPI document
  daddyapi help                              Show this help

Docs & examples: https://github.com/abduladnan-mt7/daddyapi
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseFlags(rest);

  switch (command) {
    case 'run':
      return cmdRun(positionals, flags);
    case 'dev':
      return cmdDev(positionals, flags);
    case 'validate':
      return cmdValidate(positionals);
    case 'init':
      return cmdInit(positionals, flags);
    case 'build':
      return cmdBuild(positionals, flags);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return printHelp();
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
