# Security Policy

## Scope

This repository is a synthetic-data demonstration. It must not contain or
connect to private SmartFAQs documents, production credentials, private
services, or customer data.

Please report suspected vulnerabilities privately through GitHub's security
advisory feature for this repository. Do not open a public issue containing an
exploit, credential, or private data.

## Security Boundaries

- All evidence is synthetic and repository-local.
- The public runtime catalog is generated only from stable OKF concepts marked
  `synthetic_public_demo`.
- Tool inputs are schema validated and bounded.
- WebMCP tools are registered only in the top-level page.
- The MCP endpoint exposes a fixed tool registry, not a generic executor.
- Human approval cannot be invoked by WebMCP or MCP tools.
- Tool results never include environment variables, filesystem paths, or
  deployment credentials.

## Threat Model

The main untrusted inputs are agent tool arguments, remote MCP JSON-RPC
requests, browser origins, search text, and synthetic evidence content.

Controls include:

- strict schemas that reject extra fields;
- source-scoped chunk authorization;
- bounded query, answer, evidence-reference, and result sizes;
- a fixed registry with no dynamic command dispatch;
- browser-origin validation on the remote MCP endpoint;
- human-only answer approval;
- synthetic repository-local data with no provider connection;
- sanitized evidence exports.

## Knowledge Ingestion Boundary

OKF Markdown and imported Docling content are untrusted data. They cannot add
tools, change workflow instructions, broaden source scope, or authorize a
review decision. React escapes displayed content, and the runtime reads only a
build-time generated catalog.

The Docling converter:

- enforces file, row, chunk, path, and frontmatter bounds;
- sanitizes headings before using them as relative paths;
- preserves headings as structural concepts while keeping them distinct from
  substantive citeable evidence;
- omits raw input document IDs, chunk IDs, and source references;
- returns only counts from `--dry-run`;
- writes atomically, refuses to overwrite by default, and allows `--force`
  only for a converter-marked destination;
- always marks output `draft` and `local_private_only`.

`.local/` is ignored. Do not move a converted third-party or private bundle into
`knowledge/` unless rights, privacy, provenance, lifecycle, and content review
have been completed. The compiler's rights check is a guard, not legal advice.

Evidence packets are illustrative summaries. They are not signed and do not
cryptographically bind an approval decision to answer text.

This demo is not an authentication or multi-tenant reference implementation.
Deployments that add private data must add authenticated identity, per-tenant
authorization, auditability, rate limits, retention rules, and an independent
security review before use.

## Supported Versions

Security fixes are applied to the current `main` branch. This challenge demo
does not maintain older release branches.
