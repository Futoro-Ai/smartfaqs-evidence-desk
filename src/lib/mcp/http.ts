import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { createEvidenceDeskMcpServer } from "@/lib/mcp/server";

const MAX_MCP_REQUEST_BYTES = 64 * 1024;

export type McpHttpOptions = {
  allowedOrigins?: string | readonly string[];
  allowSameOrigin?: boolean;
};

type OriginDecision =
  | { allowed: true; origin: string | null }
  | { allowed: false };

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin === "null") {
      return null;
    }

    const withoutTrailingSlash = value.endsWith("/")
      ? value.slice(0, -1)
      : value;
    return withoutTrailingSlash === url.origin ? url.origin : null;
  } catch {
    return null;
  }
}

function configuredOrigins(options: McpHttpOptions): Set<string> {
  const configured =
    options.allowedOrigins ?? process.env.MCP_ALLOWED_ORIGINS ?? "";
  const values: readonly string[] =
    typeof configured === "string" ? configured.split(",") : configured;

  return new Set(
    values
      .map((value) => normalizeOrigin(value.trim()))
      .filter((value): value is string => value !== null),
  );
}

function validateOrigin(
  request: Request,
  options: McpHttpOptions,
): OriginDecision {
  const originHeader = request.headers.get("origin");

  // Non-browser MCP clients generally omit Origin. Browser requests always send
  // one for cross-origin calls, so an absent header is intentionally accepted.
  if (originHeader === null) {
    return { allowed: true, origin: null };
  }

  const origin = normalizeOrigin(originHeader);
  if (origin === null) {
    return { allowed: false };
  }

  const requestOrigin = new URL(request.url).origin;
  const allowSameOrigin =
    options.allowSameOrigin ?? process.env.NODE_ENV !== "production";
  if (
    configuredOrigins(options).has(origin) ||
    (allowSameOrigin && origin === requestOrigin)
  ) {
    return { allowed: true, origin };
  }

  return { allowed: false };
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    },
    { status, headers },
  );
}

function addCorsHeaders(response: Response, origin: string | null): Response {
  if (origin === null) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.append("Vary", "Origin");
  return response;
}

function forbiddenOriginResponse(): Response {
  return jsonRpcError(403, ErrorCode.ConnectionClosed, "Forbidden origin.");
}

async function requestBodyIsTooLarge(request: Request): Promise<boolean> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MAX_MCP_REQUEST_BYTES) return true;
  }

  return (await request.clone().arrayBuffer()).byteLength > MAX_MCP_REQUEST_BYTES;
}

export async function handleMcpPost(
  request: Request,
  options: McpHttpOptions = {},
): Promise<Response> {
  const origin = validateOrigin(request, options);
  if (!origin.allowed) {
    return forbiddenOriginResponse();
  }

  try {
    if (await requestBodyIsTooLarge(request)) {
      return addCorsHeaders(
        jsonRpcError(413, ErrorCode.InvalidRequest, "Request body too large."),
        origin.origin,
      );
    }
  } catch {
    return addCorsHeaders(
      jsonRpcError(400, ErrorCode.InvalidRequest, "Invalid request body."),
      origin.origin,
    );
  }

  // A fresh server and transport per request avoids cross-client state and ID
  // collisions. JSON response mode is sufficient for this fixed synchronous set.
  const server = createEvidenceDeskMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  let response: Response;
  try {
    await server.connect(transport);
    response = await transport.handleRequest(request);
  } catch {
    response = jsonRpcError(
      500,
      ErrorCode.InternalError,
      "Internal server error.",
    );
  } finally {
    await server.close().catch(() => undefined);
  }

  return addCorsHeaders(response, origin.origin);
}

export function handleMcpGet(
  request: Request,
  options: McpHttpOptions = {},
): Response {
  const origin = validateOrigin(request, options);
  if (!origin.allowed) {
    return forbiddenOriginResponse();
  }

  // Streamable HTTP permits 405 when a server does not provide an independent
  // server-to-client SSE stream. This sessionless endpoint has no such messages.
  return addCorsHeaders(
    jsonRpcError(
      405,
      ErrorCode.ConnectionClosed,
      "Method not allowed: no standalone SSE stream is available.",
      { Allow: "POST, OPTIONS" },
    ),
    origin.origin,
  );
}

export function handleMcpOptions(
  request: Request,
  options: McpHttpOptions = {},
): Response {
  const origin = validateOrigin(request, options);
  if (!origin.allowed) {
    return forbiddenOriginResponse();
  }

  return addCorsHeaders(
    new Response(null, {
      status: 204,
      headers: {
        Allow: "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": [
          "Accept",
          "Content-Type",
          "Last-Event-ID",
          "MCP-Protocol-Version",
          "MCP-Session-Id",
          "Mcp-Method",
          "Mcp-Name",
        ].join(", "),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    }),
    origin.origin,
  );
}
