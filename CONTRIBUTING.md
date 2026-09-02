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

Only fictional, repository-local data may be added. Do not contribute customer
documents, copied confidential material, credentials, or private service URLs.

## License

By contributing, you agree that your contribution is licensed under Apache-2.0.
