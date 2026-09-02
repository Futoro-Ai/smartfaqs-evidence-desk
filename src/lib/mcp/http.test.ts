import { describe, expect, it } from "vitest";

import { toolDefinitions } from "@/lib/capabilities/contracts";
import {
  handleMcpGet,
  handleMcpOptions,
  handleMcpPost,
  type McpHttpOptions,
} from "@/lib/mcp/http";

const MCP_URL = "http://localhost:3000/mcp";
const MCP_ACCEPT = "application/json, text/event-stream";

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      Accept: MCP_ACCEPT,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-11-25",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, options: McpHttpOptions = {}) {
  const response = await handleMcpPost(postRequest(body), options);
  return { response, payload: await response.json() };
}

describe("Evidence Desk MCP Streamable HTTP endpoint", () => {
  it("negotiates initialize through the MCP SDK", async () => {
    const { response, payload } = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "protocol-test", version: "1.0.0" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "smartfaqs-evidence-desk", version: "0.1.0" },
      },
    });
  });

  it("lists exactly the fixed capability definitions", async () => {
    const { payload } = await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    expect(payload.result.tools.map(({ name }: { name: string }) => name)).toEqual(
      toolDefinitions.map(({ name }) => name),
    );
    expect(payload.result.tools[0]).toMatchObject({
      title: toolDefinitions[0].title,
      description: toolDefinitions[0].description,
      inputSchema: toolDefinitions[0].inputSchema,
    });
  });

  it("executes an allowlisted fixed tool with text and structured content", async () => {
    const request = postRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_evidence",
          arguments: {
            sourceRef: "source:employee-handbook",
            query: "annual leave after five years",
            limit: 4,
          },
        },
      },
      { Origin: "https://agent.example" },
    );
    const response = await handleMcpPost(request, {
      allowedOrigins: ["https://agent.example"],
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://agent.example",
    );
    expect(payload.result).toMatchObject({
      content: [{ type: "text" }],
      structuredContent: {
        status: "matches_found",
        resultCount: 4,
      },
    });
  });

  it("returns InvalidParams when strict Zod input validation fails", async () => {
    const { payload } = await post({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "search_evidence",
        arguments: {
          sourceRef: "source:employee-handbook",
          query: "annual leave",
          limit: 4,
          command: "execute arbitrary code",
        },
      },
    });

    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: -32602,
        message: expect.stringContaining(
          "Invalid input for tool: search_evidence",
        ),
      },
    });
  });

  it("returns InvalidParams for a tool outside the fixed registry", async () => {
    const { payload } = await post({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "generic_execute",
        arguments: { command: "anything" },
      },
    });

    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: 5,
      error: {
        code: -32602,
        message: expect.stringContaining("Unknown tool: generic_execute"),
      },
    });
  });

  it("rejects a disallowed browser Origin before protocol dispatch", async () => {
    const response = await handleMcpPost(
      postRequest(
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/list",
          params: {},
        },
        { Origin: "https://untrusted.example" },
      ),
      { allowedOrigins: ["https://trusted.example"] },
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Forbidden origin." },
      id: null,
    });
  });

  it("rejects oversized request bodies before protocol dispatch", async () => {
    const response = await handleMcpPost(
      postRequest({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "search_evidence",
          arguments: {
            sourceRef: "source:employee-handbook",
            query: "x".repeat(66_000),
          },
        },
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Request body too large." },
    });
  });

  it("accepts same-origin browser requests without an allowlist entry", async () => {
    const response = await handleMcpPost(
      postRequest(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/list",
          params: {},
        },
        { Origin: "http://localhost:3000" },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("requires an explicit allowlist when same-origin trust is disabled", async () => {
    const response = await handleMcpPost(
      postRequest(
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/list",
          params: {},
        },
        { Origin: "http://localhost:3000" },
      ),
      { allowSameOrigin: false },
    );

    expect(response.status).toBe(403);
  });

  it("returns a protocol-shaped 405 for the unsupported standalone GET stream", async () => {
    const response = handleMcpGet(
      new Request(MCP_URL, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000 },
    });
  });

  it("answers allowed browser preflight without widening the origin policy", () => {
    const response = handleMcpOptions(
      new Request(MCP_URL, {
        method: "OPTIONS",
        headers: { Origin: "https://agent.example" },
      }),
      { allowedOrigins: "https://agent.example" },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://agent.example",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
  });
});
