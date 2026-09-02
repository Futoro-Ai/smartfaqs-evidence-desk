# WebMCP Guide

## Overview

Evidence Desk registers its tools through the browser's top-level
`document.modelContext` API. A compatible agent can discover and call those
tools while the person watches the same source selection, evidence results,
and staged answer update on screen.

The application uses imperative registration because it allows precise schemas,
deterministic handlers, lifecycle cleanup, and shared behavior with the remote
MCP endpoint.

## Prerequisites

- A browser or ChatGPT environment with WebMCP support.
- A secure deployed origin. Localhost may be used for local development where
  the browser treats it as a secure context.
- JavaScript enabled on the top-level page.

If WebMCP is unavailable, Evidence Desk remains fully usable as a human-facing
application and shows the unsupported adapter state without failing the page.

## Recommended Agent Workflow

1. Call `list_knowledge_sources`.
2. Call `select_knowledge_source` with one returned `sourceRef`.
3. Call `check_evidence_readiness` for that source.
4. Call `search_evidence` with a focused question and a bounded `limit`.
5. Call `read_evidence_chunk` only for returned chunks that need inspection.
6. Call `stage_evidence_answer` with one to five scoped `evidenceRefs`.
7. Ask the person to approve or reject the staged answer in the interface.
8. Leave final packet preparation to the person. The agent export tool can
   produce a pending packet, but it cannot carry an approval decision.

## Suggested Prompt

```text
Use the tools on this page. Select the Northstar Employee Handbook, verify that
its evidence is ready, and determine the annual leave allowance and accrual
method for an employee with five completed years. Read the minimum evidence
needed, stage a concise answer with citations, and stop for my approval.
```

## Observable Behavior

Successful agent calls dispatch a bounded `evidence-desk:tool-result` event.
The React interface listens for that event and updates its visible state. This
keeps agent actions inspectable and avoids a hidden parallel workflow.

## Safety Notes

- Tool input schemas reject unknown fields.
- Search and reads are constrained to a selected source.
- Results are bounded and synthetic.
- Tool handlers do not read hidden DOM content.
- No tool can approve an answer.
- Registration is cleaned up when the page component unmounts.
