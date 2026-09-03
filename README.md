# SmartFAQs Evidence Desk

SmartFAQs Evidence Desk is a complete synthetic-data application for exploring
how a person and an AI agent can investigate the same source material through
WebMCP. The visible workspace and the agent-facing tools share one fixed,
schema-validated capability layer. Its editable knowledge is an Open Knowledge
Format (OKF) v0.2 Markdown hierarchy compiled into the same bounded runtime
catalog used by the page, WebMCP, and MCP endpoint.

**Live application:** [smartfaqs-evidence-desk.vercel.app](https://smartfaqs-evidence-desk.vercel.app/)

The demo includes:

- a working evidence search and review interface;
- imperative WebMCP tools registered in the top-level page;
- a standards-oriented MCP Streamable HTTP endpoint at `/mcp`;
- bounded text and table evidence from three fictional policy sources;
- source-scoped citation selection and human answer approval;
- a sanitized evidence packet export;
- an inspectable OKF knowledge bundle organized by source and section;
- a reusable, fail-closed Docling JSONL-to-OKF conversion module;
- an ICM-style folder workflow that documents each retrieval decision;
- unit, protocol, build, and browser-level checks.

No SmartFAQs production service, customer document, credential, private
repository code, or private development tool is included or contacted.

## Quick Start

Requirements:

- Node.js 22 or newer
- npm 10 or newer

```bash
git clone https://github.com/Futoro-AI/smartfaqs-evidence-desk.git
cd smartfaqs-evidence-desk
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The application does not require an API key, database, or external service.

The shipped corpus is fictional. Private or third-party Docling exports can be
converted only into ignored local output and cannot pass the public-catalog
rights gate without an explicit reviewed metadata change.

## Try the Human Workflow

1. Select **Northstar Employee Handbook**.
2. Search for `annual leave after five years`.
3. Inspect the annual leave table and accrual-method text.
4. Add both evidence items to the review set.
5. Stage this answer:

   > Employees with 5-9 completed years receive 104 hours, or 13 days, of
   > annual leave. It is credited in equal increments each biweekly pay period.

6. Approve or reject the staged answer.
7. Copy or download the sanitized evidence packet.

## Try It With ChatGPT WebMCP

WebMCP requires a compatible browser environment and a secure context in a
deployed build. Open the live application from ChatGPT's browser and ask:

```text
Use the tools on this page. Select the Northstar Employee Handbook, check its
evidence readiness, and find the annual leave allowance and accrual method for
an employee with five completed years. Stage an answer with the evidence you
used, but leave the final decision to me.
```

Agent-triggered actions are reflected in the same visible interface. The agent
can stage an answer, but it cannot approve it.

See [WebMCP Guide](docs/WEBMCP.md) and [Tool Reference](docs/TOOL_REFERENCE.md).

## Use the MCP Endpoint

The same fixed capability registry is available over Streamable HTTP:

```text
https://smartfaqs-evidence-desk.vercel.app/mcp
```

The endpoint supports MCP initialization, tool discovery, and tool calls. It
does not expose a generic command, arbitrary URL fetch, filesystem access, or
credential access. See [MCP Endpoint Guide](docs/MCP.md) for examples.

## Commands

```bash
npm run dev        # local development server
npm run lint       # ESLint
npm test           # Vitest unit and protocol tests
npm run okf:check  # validate OKF and confirm the catalog is current
npm run okf:compile # regenerate the catalog after approved knowledge edits
npm run build      # production build
npm run test:e2e   # Playwright browser tests
npm run check      # lint, unit tests, and production build
```

## Project Map

```text
src/app/                    Next.js UI and /mcp route
knowledge/northstar/        Editable OKF v0.2 synthetic knowledge bundle
scripts/okf/                OKF compiler, validator, and Docling converter
src/data/                   Generated deterministic runtime catalog
src/lib/capabilities/       Shared schemas and deterministic tool behavior
src/lib/webmcp/             Browser WebMCP registration adapter
src/lib/mcp/                Streamable HTTP MCP adapter
workflows/retrieve/         ICM-style inspectable retrieval stages
docs/                       Public architecture and usage documentation
```

## Design Boundaries

- Every tool is explicitly named and schema validated.
- Searches are limited to one selected synthetic source and at most five
  bounded results.
- Public builds accept only stable concepts marked `synthetic_public_demo`.
- Chunk reads fail closed if the chunk is outside the selected source.
- Agent tools cannot approve or reject a staged answer.
- Evidence exports contain labels and counts, not raw evidence bodies.
- Remote MCP browser origins are checked against `MCP_ALLOWED_ORIGINS`.
- The interface remains fully usable without an agent.

See [OKF and Interpretable Retrieval](docs/OKF_ICM.md),
[Architecture](docs/ARCHITECTURE.md), and [Security Policy](SECURITY.md).

## Challenge Entry

This standalone application was created for the 2026 OpenAI WebMCP Challenge.
Submission notes, evidence, and the short demo script are in
[CHALLENGE.md](CHALLENGE.md) and [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## License

Source code is licensed under the [Apache License 2.0](LICENSE). The license
permits commercial use. The Futoro-AI and SmartFAQs names and marks remain
subject to [TRADEMARKS.md](TRADEMARKS.md).
