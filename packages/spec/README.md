# @daddyapi/spec

The **SiteSpec** schema, loader, and validator for [daddyapi](../../README.md) —
the language-neutral contract that describes how to turn a website into an API.

```ts
import { loadSiteSpec, parseSiteSpec, safeParseSiteSpec } from '@daddyapi/spec';

const spec = loadSiteSpec('quotes.yaml'); // reads + validates a YAML/JSON file
```

Exports the zod schema (`siteSpecSchema`) and types (`SiteSpec`, `Resource`,
`FieldSpec`, …), plus a `parseDuration` helper. No I/O beyond reading a file —
this package is what a second-language runtime must agree with.

MIT
