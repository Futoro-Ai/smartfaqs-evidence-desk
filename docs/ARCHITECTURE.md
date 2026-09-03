# Architecture

## Purpose

Evidence Desk demonstrates a narrow, inspectable agent workflow over synthetic
knowledge. One deterministic capability layer serves three callers:

1. the human-operated React interface;
2. the top-level browser WebMCP adapter;
3. the remote MCP Streamable HTTP endpoint.

This avoids duplicating authority or allowing an agent-only path to perform
actions the visible application cannot represent.

## Data Flow

```text
OKF v0.2 Markdown bundle + YAML frontmatter
                    |
                    v
        build-time profile validation
                    |
                    v
        generated deterministic catalog
                    |
                    v
Strict Zod schemas + fixed capability registry
                  /   |   \
                 /    |    \
          React UI  WebMCP  MCP /mcp
                 \    |    /
                  visible state
```

All shipped source material is committed synthetic data. There is no database
or provider dependency. The application never parses files at request time;
build-time compilation produces a checked-in JSON catalog suitable for both
browser and server bundles.

## Knowledge and Workflow Layers

`knowledge/northstar` is the editable OKF v0.2 bundle. Section-numbered folders
provide hierarchy, plain `index.md` files support progressive disclosure, and
normal concept files carry standards-compliant frontmatter. Every section folder
has a `section.md` concept, so headings remain addressable knowledge rather than
disappearing during chunk conversion. Stable application IDs and
revision-qualified concept paths serve different purposes and are both retained.

`scripts/okf/lib.mjs` validates and compiles the bundle. Its Docling-compatible
converter uses the same profile but always emits local-private, draft output.
The public compiler accepts only stable synthetic-demo content.

`workflows/retrieve` records the ICM-style sequence from contract and scope
through retrieval, verification, human review, and export. These documents are
inspectable contracts, not executable authority. See
[OKF and Interpretable Retrieval](OKF_ICM.md).

## Capability Boundary

`src/lib/capabilities/contracts.ts` defines the complete public tool set and
input schemas. `src/lib/capabilities/evidence.ts` implements deterministic
behavior.

The registry contains no generic `execute`, shell, SQL, HTTP fetch, filesystem,
secret, authentication, or mutation facility. Adding a capability requires an
explicit schema, implementation, UI behavior, documentation, and tests.

## WebMCP Adapter

The browser adapter feature-detects `document.modelContext`, registers tools
imperatively on the top-level page, and unregisters them through an
`AbortController` during cleanup. Successful calls dispatch a bounded custom
event so the agent's work appears in the human interface.

The visible application does not rely on WebMCP for normal operation.

## MCP Endpoint

The `/mcp` route provides a standards-oriented Streamable HTTP surface over the
same registry. Requests are stateless, tool names are fixed, input is parsed by
the same strict schemas, and browser origins are checked against an explicit
allowlist.

## Human Approval

`stage_evidence_answer` creates a reviewable draft. Approval and rejection are
human-only interface actions. No WebMCP or remote MCP tool can change that
decision.

The agent-facing export tool can create only a pending packet. The human
interface can create a packet with the visible decision state. Both forms
contain only the source label, evidence labels, counts, decision state, and the
synthetic-data boundary marker.

## Retrieval

The current retrieval implementation is deterministic lexical scoring over one
selected source. It scores section concepts for navigation, uses heading
ancestry as a bounded boost for descendant chunks, and searches evidence titles,
content, keywords, and table cells. Search returns no more than three matched
sections and five evidence results. Section rollups contain counts, available
page ranges, and descendant-reference digests, never concatenated child content.
It is deliberately small and interpretable; this project does not claim vector,
semantic, graph, or production-scale retrieval.

## Trust Model

Evidence text is treated as untrusted content. It is data to inspect, not
instructions to execute. Tool descriptions and schemas set the authority
boundary; page text cannot add tools or broaden inputs.

See [SECURITY.md](../SECURITY.md) for the threat model and reporting process.
