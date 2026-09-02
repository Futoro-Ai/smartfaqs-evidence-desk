# Release Checklist

## Repository

- [ ] Repository visibility is public under Futoro-AI.
- [ ] Default branch is `main`.
- [ ] `LICENSE`, `NOTICE`, `TRADEMARKS.md`, `SECURITY.md`, and `PRIVACY.md` are visible.
- [x] No private URL, credential, customer identifier, or private source file is present.
- [ ] CI passes from a clean `npm ci` install.

## Application

- [x] Human workflow works without WebMCP.
- [x] WebMCP registers all seven fixed tools in a top-level browser integration test.
- [x] WebMCP actions visibly update the workspace in browser integration tests.
- [x] Human approval cannot be invoked or overwritten by an agent tool.
- [x] `/mcp` initializes and returns the fixed tool list.
- [x] `/mcp` rejects unknown tools, invalid inputs, oversized bodies, and disallowed browser origins.
- [x] Desktop and mobile screenshots show no overlap or clipped controls.

## Security

- [x] Dependency audit has no known high or critical findings.
- [x] Secret and private-reference scan is clean.
- [x] Independent security review has no unresolved high-severity finding.
- [ ] Deployed `MCP_ALLOWED_ORIGINS` uses exact HTTPS origins and no wildcard.
- [ ] The hosting edge applies a shared request-rate policy to `/mcp`.
- [x] Production bundle contains only synthetic evidence.

## Submission

- [ ] Live URL is public and loads without sign-in.
- [ ] Public repository URL resolves without sign-in.
- [ ] Demo video is public and under three minutes.
- [ ] Demo shows an actual WebMCP tool-driven workflow.
- [ ] Devpost description and technology list match shipped behavior.
- [ ] Final submission is completed before September 3, 2026 at 1:00 PM PDT.
