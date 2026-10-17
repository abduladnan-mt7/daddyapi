import type { FieldSpec, Fields, Resource, SiteSpec } from '@daddyapi/spec';
import { DEFAULT_MAX_PAGES_LIMIT, resourceInputs } from './params';

type JsonSchema = Record<string, unknown>;

/** JSON Schema type a field's value will have after its transforms. */
export function fieldValueType(spec: FieldSpec): 'string' | 'number' | 'boolean' {
  if (typeof spec === 'string') return 'string';
  const transforms = spec.transform
    ? Array.isArray(spec.transform)
      ? spec.transform
      : [spec.transform]
    : [];
  if (transforms.some((t) => t === 'int' || t === 'float' || t === 'number')) return 'number';
  if (transforms.includes('boolean')) return 'boolean';
  return 'string';
}

function fieldSchema(spec: FieldSpec): JsonSchema {
  const scalar: JsonSchema = { type: fieldValueType(spec) };
  if (typeof spec !== 'string' && spec.many) return { type: 'array', items: scalar };
  if (typeof spec !== 'string' && spec.optional) return { ...scalar, nullable: true };
  return scalar;
}

function itemSchema(fields: Fields): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [name, spec] of Object.entries(fields)) properties[name] = fieldSchema(spec);
  return { type: 'object', properties };
}

/** JSON Schema of a resource's `data` (an array of rows for lists, one object otherwise). */
export function resourceDataSchema(resource: Resource): JsonSchema {
  if (resource.list) return { type: 'array', items: itemSchema(resource.list.fields) };
  return itemSchema(resource.item!.fields);
}

export interface OpenApiOptions {
  /** Document the API-key security scheme and 401 responses. */
  apiKeys?: boolean;
  /** Document 429 responses and rate-limit headers. */
  rateLimit?: boolean;
  /** Upper bound advertised for `pages`. */
  maxPagesLimit?: number;
}

const errorSchemaRef = { $ref: '#/components/schemas/Error' };

function errorResponse(description: string): JsonSchema {
  return { description, content: { 'application/json': { schema: errorSchemaRef } } };
}

/** Generate an OpenAPI 3 document from a SiteSpec. */
export function buildOpenApi(spec: SiteSpec, options: OpenApiOptions = {}): JsonSchema {
  const paths: Record<string, unknown> = {};
  const maxPagesLimit = options.maxPagesLimit ?? DEFAULT_MAX_PAGES_LIMIT;

  for (const resource of spec.resources) {
    const inputs = resourceInputs(resource);
    const parameters: JsonSchema[] = [];
    for (const param of inputs.pathParams) {
      parameters.push({ name: param, in: 'query', required: true, schema: { type: 'string' } });
    }
    if (inputs.paginated) {
      parameters.push({
        name: 'pages',
        in: 'query',
        required: false,
        description: `Maximum number of pages to fetch (default ${resource.fetch.pagination?.maxPages ?? 1}).`,
        schema: { type: 'integer', minimum: 1, maximum: maxPagesLimit },
      });
    }
    if (inputs.isList) {
      parameters.push(
        {
          name: 'limit',
          in: 'query',
          required: false,
          description: 'Return at most this many rows.',
          schema: { type: 'integer', minimum: 1 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          description: 'Skip this many rows first.',
          schema: { type: 'integer', minimum: 0 },
        },
      );
    }
    parameters.push(
      {
        name: 'fields',
        in: 'query',
        required: false,
        description: `Comma-separated subset of fields to return: ${inputs.fieldNames.join(', ')}.`,
        schema: { type: 'string' },
      },
      {
        name: 'format',
        in: 'query',
        required: false,
        description: 'Response format: the JSON envelope (default), CSV, or newline-delimited JSON rows.',
        schema: { type: 'string', enum: ['json', 'csv', 'ndjson'], default: 'json' },
      },
    );

    const responses: Record<string, unknown> = {
      '200': {
        description: 'OK',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: resourceDataSchema(resource),
                warnings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { field: { type: 'string' }, message: { type: 'string' } },
                  },
                },
                meta: { $ref: '#/components/schemas/Meta' },
              },
            },
          },
          'text/csv': { schema: { type: 'string' } },
          'application/x-ndjson': { schema: { type: 'string' } },
        },
      },
      '304': { description: 'Not modified (matches If-None-Match)' },
      '400': errorResponse('Missing or invalid parameter'),
      '403': errorResponse("The site's robots.txt disallows this page"),
      '502': errorResponse('The upstream site returned an error'),
      '504': errorResponse('The upstream site timed out'),
    };
    if (options.apiKeys) responses['401'] = errorResponse('Missing or invalid API key');
    if (options.rateLimit) responses['429'] = errorResponse('Rate limit exceeded; see Retry-After');

    paths[`/${resource.name}`] = {
      get: {
        operationId: `get_${resource.name.replace(/-/g, '_')}`,
        summary: resource.description ?? `Fetch ${resource.name}`,
        tags: ['resources'],
        parameters,
        responses,
        ...(options.apiKeys ? { security: [{ bearerAuth: [] }, { apiKeyHeader: [] }] } : {}),
      },
    };
  }

  paths['/health'] = {
    get: {
      operationId: 'health',
      summary: 'Liveness check',
      tags: ['service'],
      responses: { '200': { description: 'The server is up' } },
    },
  };

  const components: JsonSchema = {
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'requestId'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'bad-request' },
              message: { type: 'string' },
              param: { type: 'string' },
            },
          },
          requestId: { type: 'string' },
        },
      },
      Meta: {
        type: 'object',
        properties: {
          resource: { type: 'string' },
          source: { type: 'string', format: 'uri' },
          pages: { type: 'integer' },
          fromCache: { type: 'boolean' },
          fetchedAt: { type: 'string', format: 'date-time' },
          total: { type: 'integer', description: 'Rows extracted before limit/offset' },
          returned: { type: 'integer' },
          offset: { type: 'integer' },
          limit: { type: 'integer' },
          fields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  };
  if (options.apiKeys) {
    components.securitySchemes = {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: `${spec.name} API`,
      version: '0.1.0',
      description: spec.description ?? `Auto-generated by daddyapi from ${spec.baseUrl}`,
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'resources', description: `Data extracted from ${spec.baseUrl}` },
      { name: 'service', description: 'Service endpoints' },
    ],
    paths,
    components,
  };
}
