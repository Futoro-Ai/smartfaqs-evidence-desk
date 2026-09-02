# Security Policy

## Scope

This repository is a synthetic-data demonstration. It must not contain or
connect to private SmartFAQs documents, production credentials, private UCI
services, or customer data.

Please report suspected vulnerabilities privately through GitHub's security
advisory feature for this repository. Do not open a public issue containing an
exploit, credential, or private data.

## Security Boundaries

- All evidence is synthetic and repository-local.
- Tool inputs are schema validated and bounded.
- WebMCP tools are registered only in the top-level page.
- The MCP endpoint exposes a fixed tool registry, not a generic executor.
- Human approval cannot be invoked by WebMCP or MCP tools.
- Tool results never include environment variables, filesystem paths, or
  deployment credentials.
