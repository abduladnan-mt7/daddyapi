# @daddyapi/cli

The `daddyapi` command line for [daddyapi](../../README.md).

```bash
daddyapi init <url> [--out spec.yaml]      # crawl a site → draft SiteSpec
daddyapi dev <spec> [--port 8787]          # serve as a live API + Swagger docs
daddyapi run <spec> <resource> [--pages N] [--params k=v,...]
daddyapi validate <spec>                   # check against the schema
daddyapi build <spec> [--out openapi.json] # emit the OpenAPI document
```

MIT
