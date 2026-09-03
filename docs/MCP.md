# MCP Endpoint Guide

## Endpoint

Evidence Desk exposes its fixed tool registry at:

```text
POST /mcp
```

The public deployment is available at:

```text
https://smartfaqs-evidence-desk.vercel.app/mcp
```

It implements the MCP Streamable HTTP request/response surface needed for
initialization, `tools/list`, and `tools/call`. The transport is stateless so a
client can repeat initialization without server-side session storage.

The endpoint does not retain a selected source between calls. Remote clients
must send `sourceRef` with every source-scoped tool call, even after calling
`select_knowledge_source`. WebMCP calls can additionally update the source
selection visible in the open page.

Search and read results include revision-qualified OKF concept references. The
client still supplies stable `chunkRef` values for reads and staging, preserving
the fixed request contract.

`GET /mcp` intentionally returns `405 Method Not Allowed`. This sessionless
server has no independent server-to-client SSE messages; Streamable HTTP
permits that response when a standalone SSE stream is unavailable.

## Origin Policy

Browser requests with an `Origin` header must match the comma-separated
`MCP_ALLOWED_ORIGINS` environment variable in production. Local development
also accepts same-origin requests. Non-browser clients commonly omit `Origin`;
those requests are accepted because they are not subject to browser
cross-origin behavior.

Example local value:

```dotenv
MCP_ALLOWED_ORIGINS=http://localhost:3000
```

Use exact HTTPS origins in deployed environments. Do not use `*`.

Requests larger than 64 KiB are rejected before MCP dispatch. Production
deployments should additionally apply shared host or edge rate limits; an
in-process limiter would not coordinate reliably across serverless replicas.

## Client Sequence

1. Send MCP `initialize`.
2. Send `notifications/initialized` if required by the client.
3. Send `tools/list`.
4. Send `tools/call` with one fixed tool name and schema-valid arguments.

## Example Tool Call

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_evidence",
    "arguments": {
      "sourceRef": "source:employee-handbook",
      "query": "annual leave after five years",
      "limit": 4
    }
  }
}
```

## Integration Boundary

The remote endpoint and WebMCP adapter share the same schemas and deterministic
functions. The endpoint cannot access browser state, approve a human decision,
fetch arbitrary URLs, read files, execute commands, or access credentials.

For every available operation and field, see [Tool Reference](TOOL_REFERENCE.md).
