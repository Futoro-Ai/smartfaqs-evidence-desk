import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";

import { toolDefinitions } from "@/lib/capabilities/contracts";
import { executeEvidenceTool } from "@/lib/capabilities/evidence";

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function toToolResult(value: unknown): CallToolResult {
  const structuredContent = toStructuredContent(value);
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function toSafeToolError(error: unknown): CallToolResult {
  const safeMessages = new Set([
    "knowledge_source_not_found",
    "evidence_chunk_outside_selected_source",
  ]);
  const message =
    error instanceof Error && safeMessages.has(error.message)
      ? error.message
      : "Tool execution failed.";

  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function createEvidenceDeskMcpServer(): Server {
  const server = new Server(
    {
      name: "smartfaqs-evidence-desk",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Use only the fixed synthetic Evidence Desk tools. Human approval remains outside MCP.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema as {
        type: "object";
        properties?: Record<string, unknown>;
        required?: string[];
      },
      annotations: {
        readOnlyHint: definition.annotations.readOnlyHint,
        destructiveHint: false,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = toolDefinitions.find(
      ({ name }) => name === request.params.name,
    );
    if (!definition) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown tool: ${request.params.name}`,
      );
    }

    try {
      return toToolResult(
        executeEvidenceTool(
          definition.name,
          request.params.arguments ?? {},
        ),
      );
    } catch (error) {
      if (error instanceof ZodError) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid input for tool: ${definition.name}`,
          {
            issues: error.issues.map(({ code, path, message }) => ({
              code,
              path,
              message,
            })),
          },
        );
      }

      return toSafeToolError(error);
    }
  });

  return server;
}
