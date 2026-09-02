// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { toolDefinitions } from "@/lib/capabilities/contracts";
import {
  EVIDENCE_DESK_TOOL_RESULT_EVENT,
  isWebMcpAvailable,
  registerEvidenceDeskWebMcpTools,
  type EvidenceDeskToolResultDetail,
  type WebMcpModelContext,
  type WebMcpToolDescriptor,
} from "@/lib/webmcp/adapter";

function setModelContext(modelContext?: WebMcpModelContext) {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });
}

afterEach(() => {
  setModelContext(undefined);
});

describe("Evidence Desk WebMCP adapter", () => {
  it("returns a graceful unsupported state when WebMCP is unavailable", async () => {
    expect(isWebMcpAvailable()).toBe(false);

    const registration = await registerEvidenceDeskWebMcpTools();

    expect(registration).toMatchObject({
      status: "unsupported",
      reason: "api_unavailable",
      toolCount: 0,
    });
    expect(() => registration.unregister()).not.toThrow();
  });

  it("registers the fixed tools and aborts every registration on cleanup", async () => {
    const registeredTools = new Map<string, WebMcpToolDescriptor>();
    const signals: AbortSignal[] = [];
    const registerTool = vi.fn<WebMcpModelContext["registerTool"]>(
      async (tool, { signal }) => {
        registeredTools.set(tool.name, tool);
        signals.push(signal);
        signal.addEventListener(
          "abort",
          () => registeredTools.delete(tool.name),
          { once: true },
        );
      },
    );
    setModelContext({ registerTool });

    const registration = await registerEvidenceDeskWebMcpTools();

    expect(registration).toMatchObject({
      status: "registered",
      toolCount: toolDefinitions.length,
    });
    expect(registerTool).toHaveBeenCalledTimes(toolDefinitions.length);
    expect(Array.from(registeredTools.keys())).toEqual(
      toolDefinitions.map(({ name }) => name),
    );
    expect(new Set(signals).size).toBe(1);

    registration.unregister();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(registeredTools.size).toBe(0);
  });

  it("returns MCP-style content and dispatches a visible result event", async () => {
    const registeredTools = new Map<string, WebMcpToolDescriptor>();
    setModelContext({
      registerTool: async (tool) => {
        registeredTools.set(tool.name, tool);
      },
    });
    const listener = vi.fn();
    window.addEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, listener);

    const registration = await registerEvidenceDeskWebMcpTools();
    const searchTool = registeredTools.get("search_evidence");
    const result = await searchTool?.execute({
      sourceRef: "source:employee-handbook",
      query: "annual leave after five years",
      limit: 4,
    });

    expect(result?.content[0]).toMatchObject({ type: "text" });
    expect(result?.structuredContent).toMatchObject({
      status: "matches_found",
      resultCount: 4,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent<
      EvidenceDeskToolResultDetail
    >;
    expect(event.detail).toMatchObject({
      name: "search_evidence",
      input: {
        sourceRef: "source:employee-handbook",
        query: "annual leave after five years",
      },
      result: { status: "matches_found" },
    });

    registration.unregister();
    window.removeEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, listener);
  });

  it("keeps strict registry validation authoritative and emits no failed result", async () => {
    const registeredTools = new Map<string, WebMcpToolDescriptor>();
    setModelContext({
      registerTool: async (tool) => {
        registeredTools.set(tool.name, tool);
      },
    });
    const listener = vi.fn();
    window.addEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, listener);
    const registration = await registerEvidenceDeskWebMcpTools();

    await expect(
      registeredTools.get("search_evidence")?.execute({
        sourceRef: "source:employee-handbook",
        query: "annual leave",
        limit: 4,
        command: "read hidden state",
      }),
    ).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();

    registration.unregister();
    window.removeEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, listener);
  });
});
