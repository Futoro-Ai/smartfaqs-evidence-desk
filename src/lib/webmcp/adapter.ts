"use client";

import {
  toolDefinitions,
  type ToolName,
} from "@/lib/capabilities/contracts";
import { executeEvidenceTool } from "@/lib/capabilities/evidence";

export const EVIDENCE_DESK_TOOL_RESULT_EVENT =
  "evidence-desk:tool-result" as const;

export type WebMcpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
};

export type EvidenceDeskToolResultDetail = {
  name: ToolName;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type WebMcpToolDescriptor = {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: unknown) => Promise<WebMcpToolResult>;
};

export type WebMcpModelContext = {
  registerTool: (
    tool: WebMcpToolDescriptor,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

type WebMcpDocument = Document & {
  modelContext?: WebMcpModelContext;
};

export type WebMcpRegistration =
  | {
      status: "registered";
      toolCount: number;
      unregister: () => void;
    }
  | {
      status: "unsupported";
      reason: "api_unavailable" | "not_top_level";
      toolCount: 0;
      unregister: () => void;
    }
  | {
      status: "registration_failed";
      error: unknown;
      toolCount: 0;
      unregister: () => void;
    };

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function toWebMcpResult(value: unknown): WebMcpToolResult {
  const structuredContent = toStructuredContent(value);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
  };
}

function inertRegistration(
  reason: "api_unavailable" | "not_top_level",
): WebMcpRegistration {
  return {
    status: "unsupported",
    reason,
    toolCount: 0,
    unregister: () => undefined,
  };
}

export function isWebMcpAvailable(targetDocument: Document = document): boolean {
  const targetWindow = targetDocument.defaultView;
  if (!targetWindow || targetWindow.self !== targetWindow.top) {
    return false;
  }

  const modelContext = (targetDocument as WebMcpDocument).modelContext;
  return typeof modelContext?.registerTool === "function";
}

export async function registerEvidenceDeskWebMcpTools(
  targetDocument: Document = document,
): Promise<WebMcpRegistration> {
  const targetWindow = targetDocument.defaultView;
  if (!targetWindow || targetWindow.self !== targetWindow.top) {
    return inertRegistration("not_top_level");
  }

  const modelContext = (targetDocument as WebMcpDocument).modelContext;
  if (typeof modelContext?.registerTool !== "function") {
    return inertRegistration("api_unavailable");
  }

  const controller = new AbortController();
  const unregister = () => controller.abort();

  try {
    await Promise.all(
      toolDefinitions.map((definition) =>
        modelContext.registerTool(
          {
            ...definition,
            execute: async (input: unknown) => {
              const output = executeEvidenceTool(definition.name, input ?? {});
              const result = toWebMcpResult(output);
              const eventInput =
                typeof input === "object" && input !== null && !Array.isArray(input)
                  ? (input as Record<string, unknown>)
                  : {};

              targetWindow.dispatchEvent(
                new targetWindow.CustomEvent<EvidenceDeskToolResultDetail>(
                  EVIDENCE_DESK_TOOL_RESULT_EVENT,
                  {
                    detail: {
                      name: definition.name,
                      input: eventInput,
                      result: result.structuredContent,
                    },
                  },
                ),
              );

              return result;
            },
          },
          { signal: controller.signal },
        ),
      ),
    );

    return {
      status: "registered",
      toolCount: toolDefinitions.length,
      unregister,
    };
  } catch (error) {
    unregister();
    return {
      status: "registration_failed",
      error,
      toolCount: 0,
      unregister,
    };
  }
}
