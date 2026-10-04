// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { toolDefinitions } from "@/lib/capabilities/contracts";
import {
  EVIDENCE_DESK_TOOL_RESULT_EVENT,
  ASSESSMENT_STARTED_EVENT,
  ASSESSMENT_CANCEL_EVENT,
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
  vi.unstubAllGlobals();
});

describe("Evidence Desk WebMCP adapter", () => {
  it("awaits the asynchronous assessment response before dispatching the shared result", async () => {
    const { prepareAssessment, attachWorkspace, emptyPacket } = await import("@/lib/assessment/core");
    const { RUBRIC_HASH } = await import("@/lib/assessment/jev");
    const input = { sourceRef: "source:employee-handbook", claim: "The allowance is 104 annual hours.",
      evidenceRefs: ["chunk:leave-accrual-table"], allowExternalAssessment: false };
    const packet = attachWorkspace(emptyPacket(prepareAssessment(input), RUBRIC_HASH));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(packet)));
    const registered = new Map<string, WebMcpToolDescriptor>();
    setModelContext({ registerTool: async (tool) => { registered.set(tool.name, tool); } });
    const registration = await registerEvidenceDeskWebMcpTools();
    const result = await registered.get("assess_evidence_claim")!.execute(input);
    expect(result.structuredContent).toMatchObject({ status: "unavailable", humanApprovalRequired: true });
    expect(fetch).toHaveBeenCalledWith("/api/assessments", expect.objectContaining({ credentials: "same-origin" }));
    registration.unregister();
  });
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
  it("binds assessment start/completion identity and cancels a superseded call", async () => {
    const registered = new Map<string, WebMcpToolDescriptor>();
    setModelContext({ registerTool: async (tool) => { registered.set(tool.name, tool); } });
    const started = vi.fn(), completed = vi.fn();
    window.addEventListener(ASSESSMENT_STARTED_EVENT, started);
    window.addEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, completed);
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
    })));
    const registration = await registerEvidenceDeskWebMcpTools();
    const input = { sourceRef: "source:employee-handbook", claim: "The allowance is 104 hours.",
      evidenceRefs: ["chunk:leave-accrual-table"] };
    const promise = registered.get("assess_evidence_claim")!.execute(input);
    const requestId = started.mock.calls[0][0].detail.requestId;
    expect(typeof requestId).toBe("string");
    window.dispatchEvent(new CustomEvent(ASSESSMENT_CANCEL_EVENT, { detail: { requestId } }));
    await expect(promise).rejects.toThrow("Cancelled");
    expect(completed).not.toHaveBeenCalled();
    registration.unregister();
    window.removeEventListener(ASSESSMENT_STARTED_EVENT, started);
    window.removeEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, completed);
  });

  it("rejects invalid replacements before cancelling a valid assessment and snapshots its input", async () => {
    const { prepareAssessment, attachWorkspace, emptyPacket } = await import("@/lib/assessment/core");
    const { RUBRIC_HASH } = await import("@/lib/assessment/jev");
    const input = { sourceRef: "source:employee-handbook", claim: "The allowance is 104 hours.",
      evidenceRefs: ["chunk:leave-accrual-table"] };
    const packet = attachWorkspace(emptyPacket(prepareAssessment(input), RUBRIC_HASH));
    const registered = new Map<string, WebMcpToolDescriptor>();
    setModelContext({ registerTool: async (tool) => { registered.set(tool.name, tool); } });
    let resolve!: (response: Response) => void;
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init!.signal!;
      return new Promise<Response>((r) => { resolve = r; });
    }));
    const started = vi.fn(), completed = vi.fn();
    window.addEventListener(ASSESSMENT_STARTED_EVENT, started);
    window.addEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, completed);
    const registration = await registerEvidenceDeskWebMcpTools();
    const tool = registered.get("assess_evidence_claim")!;
    const pending = tool.execute(input);
    input.claim = "A different claim."; input.evidenceRefs[0] = "chunk:invalid";
    await expect(tool.execute({ ...input, claim: "", command: "invalid" })).rejects.toThrow();
    expect(signal.aborted).toBe(false);
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0][0].detail.input.claim).toBe("The allowance is 104 hours.");
    resolve(Response.json(packet));
    await pending;
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed.mock.calls[0][0].detail.input.evidenceRefs).toEqual(["chunk:leave-accrual-table"]);
    registration.unregister();
    window.removeEventListener(ASSESSMENT_STARTED_EVENT, started);
    window.removeEventListener(EVIDENCE_DESK_TOOL_RESULT_EVENT, completed);
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
