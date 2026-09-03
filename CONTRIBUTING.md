# Contributing

Thank you for improving SmartFAQs Evidence Desk.

## Development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Before opening a pull request, run:

```bash
npm run check
npm run test:e2e
```

When changing `knowledge/northstar`, regenerate and inspect the catalog:

```bash
npm run okf:compile
npm run okf:check
```

## Capability Changes

The tool registry is intentionally closed. A new tool must include:

- one narrowly named capability;
- a strict bounded input schema;
- deterministic or clearly bounded behavior;
- visible human-interface behavior where applicable;
- WebMCP and remote MCP coverage;
- positive and negative tests;
- updates to the public tool reference and security boundaries.

Do not add generic execution, arbitrary URL fetching, filesystem access,
credential access, hidden approval, or production/private data dependencies.

## Data

Only fictional, repository-local data marked `synthetic_public_demo` may be
added to the public runtime catalog. Do not contribute customer documents,
third-party text without redistribution rights, copied confidential material,
credentials, raw document/chunk identifiers, or private service URLs.

Use the local Docling converter only in `.local/`. A pull request that promotes
converted material must document source rights, provenance, review state, and
why publication is permitted. Generated catalog changes without their matching
OKF source changes are not accepted.

## License

By contributing, you agree that your contribution is licensed under Apache-2.0.
