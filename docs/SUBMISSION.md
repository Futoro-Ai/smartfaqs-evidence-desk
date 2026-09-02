# Challenge Submission Copy

## Project Name

SmartFAQs Evidence Desk

## Tagline

A visible, evidence-first workspace where people and agents investigate the
same bounded sources together.

## Short Description

SmartFAQs Evidence Desk is a complete synthetic policy-research application
built around WebMCP. An agent can discover explicit tools to select a source,
check evidence readiness, search bounded text and tables, read a specific
chunk, and stage an evidence-backed answer. Every successful agent action is
reflected in the same interface the person is using. The person alone approves
or rejects the answer and can export a sanitized evidence packet.

The same fixed schemas and deterministic capability implementations are also
available through a standard MCP Streamable HTTP endpoint. The app requires no
account, API key, database, or private service.

## Problem

Agents commonly infer actions from page structure and return answers without a
clear, shared view of which evidence they used. That makes collaboration hard
to inspect and easy to mistrust.

## Solution

Evidence Desk gives the page an explicit, bounded tool contract while
preserving a complete human workflow. Source scope, evidence chunks, staged
answers, citations, and approval state remain visible. The agent receives only
the authority each named tool declares, and source checks prevent cross-source
chunk reads.

## WebMCP Use

The top-level page imperatively registers seven typed tools with
`document.modelContext.registerTool`. An `AbortController` manages lifecycle
cleanup. Calls use the same Zod schemas and deterministic functions as the
human application and remote MCP endpoint. Successful calls dispatch a bounded
custom event that updates the visible React state.

## What Makes It Complete

- full source, search, evidence-reading, answer-review, and export workflow;
- polished responsive interface usable without an agent;
- a table and surrounding-text evidence workflow using synthetic data;
- WebMCP and Streamable HTTP MCP interfaces;
- strict source boundaries and human-only approval;
- public tests, documentation, license, security policy, and live deployment.

## Built With

- Next.js 16
- React 19
- TypeScript
- Zod
- Model Context Protocol TypeScript SDK
- WebMCP `document.modelContext`
- Vitest and Playwright
- Vercel

## Submission Fields To Complete

- Live URL: pending deployment
- Public repository: https://github.com/Futoro-AI/smartfaqs-evidence-desk
- Demo video: pending upload
- Team members: add final entrant names
