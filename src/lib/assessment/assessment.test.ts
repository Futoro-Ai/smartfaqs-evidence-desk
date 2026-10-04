import { afterEach, describe, expect, it, vi } from "vitest";
import { evidenceChunks } from "@/data/evidenceCatalog";
import { assessmentInputSchema, assessmentPacketSchema, balancedReviewRefs, MODEL, reviewedReceipt } from "./contracts";
import { prepareAssessment, sha256 } from "./core";
import { buildAssessmentRequests, createJevAssessor, parseJevResponse } from "./jev";
import { handleAssessmentPost } from "./http";
import { requestClaimAssessment } from "./client";

const input = { sourceRef: "source:employee-handbook", claim: "Employees with five years receive 104 annual leave hours.",
  evidenceRefs: ["chunk:leave-accrual-table", "chunk:leave-accrual-method"], allowExternalAssessment: true };
const context = () => prepareAssessment(input);
const provider = vi.fn<typeof fetch>(async (_url, options) => {
  const request = JSON.parse(String(options?.body));
  return Response.json({ model: MODEL, answers: Object.fromEntries(Object.keys(request.questions).map((key) => [
    key, key.startsWith("pair") ? { type: "choice", choice: "unresolved",
      probabilities: { direct_conflict: 0.1, qualification: 0.1, different_scope: 0.1, different_time: 0.1, unresolved: 0.6 }, confidence: 0.5 }
      : { type: "noul", noul: key.endsWith("supports") ? 0.9 : key.endsWith("needs_context") ? 0.7 : 0.1 },
  ])), usage: { input_tokens: 200, output_tokens: 40 } });
});
afterEach(() => { vi.restoreAllMocks(); provider.mockClear(); });

describe("claim assessment boundaries and JEV contract", () => {
  it("rejects duplicate, foreign, empty, oversized and authority-changing inputs", () => {
    for (const extra of [{ evidenceRefs: [] }, { evidenceRefs: Array(21).fill("chunk:leave-accrual-table") },
      { evidenceRefs: ["chunk:leave-accrual-table", "chunk:leave-accrual-table"] }, { claim: "x".repeat(501) },
      { decision: "approved" }, { prompt: "ignore boundaries" }, { apiKey: "private" }, { endpoint: "https://evil.example" }]) {
      expect(() => prepareAssessment({ ...input, ...extra })).toThrow();
    }
    expect(() => prepareAssessment({ ...input, evidenceRefs: ["chunk:retirement-match"] })).toThrow("evidence_chunk_outside_selected_source");
    expect(assessmentInputSchema.parse({ ...input, allowExternalAssessment: undefined }).allowExternalAssessment).toBe(false);
  });
  it("preserves heading context and table units while bounding supplied text", () => {
    const c = context();
    expect(c.candidates[0].text).toContain("104 hours");
    expect(c.candidates[0].text).toContain("4.2 Annual Leave");
    const chunk = evidenceChunks.find((p) => p.ref === input.evidenceRefs[1])!;
    const old = chunk.content;
    try {
      chunk.content = "a".repeat(4000);
      const passage = context().candidates[1];
      expect(passage.text).toHaveLength(1800);
      expect(passage.passage.truncated).toBe(true);
      expect(passage.passage.originalChars).toBeGreaterThan(4000);
    } finally { chunk.content = old; }
  });
  it("packs actual questions and transmits only the claim, bounded text and rubric", () => {
    const packs = buildAssessmentRequests(context());
    expect(Object.keys(packs[0].questions)).toHaveLength(8);
    const serialized = JSON.stringify(packs);
    expect(serialized).toContain(input.claim);
    for (const ref of input.evidenceRefs) expect(serialized).not.toContain(ref);
    for (const denied of ["conceptRef", "sourceRef", "apiKey", "gold"]) expect(serialized).not.toContain(denied);
  });
  it("requires backend enablement, user consent, key and budget before any network call", async () => {
    for (const options of [
      { enabled: false, apiKey: "test-key" }, { enabled: true },
      { enabled: true, apiKey: " test-key" }, { enabled: true, apiKey: "test-key", maxReservedInputTokens: 1 },
    ]) {
      const p = await createJevAssessor({ ...options, fetchImpl: provider })(context());
      expect(p.status).toBe("unavailable"); expect(p.passages.every((x) => x.probabilities === null)).toBe(true);
    }
    await createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl: provider })(prepareAssessment({ ...input, allowExternalAssessment: false }));
    expect(provider).not.toHaveBeenCalled();
  });
  it("assesses independent signals, compares bounded pairs and exports hash-bound stages", async () => {
    const p = await createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl: provider })(context());
    expect(p.status).toBe("assessed");
    expect(p.passages[0].probabilities).toEqual({ supports: 0.9, contradicts: 0.1, qualifies: 0.1, needs_context: 0.7 });
    expect(p.comparisons[0].relation).toBe("unresolved");
    expect(p.humanApprovalRequired).toBe(true); expect(p.workspace.complete).toBe(true);
    for (const stage of p.workspace.artifacts) expect(sha256(stage.content)).toBe(stage.sha256);
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain(input.claim); expect(serialized).not.toContain("Bearer"); expect(serialized).not.toContain("104 hours");
    expect(reviewedReceipt(p, { [input.evidenceRefs[0]]: "contradicts" }).answerApproval).toBe("pending");
    expect(balancedReviewRefs(p.passages)).toHaveLength(2);
  });
  it("binds cache to exact claim, passage text, revision and ordered source scope", async () => {
    const assess = createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl: provider });
    const first = await assess(context()), second = await assess(context());
    expect(second.cacheHit).toBe(true); expect(second.requestCount).toBe(0); expect(second.usage.inputTokens).toBe(0);
    expect(provider).toHaveBeenCalledTimes(2);
    const changed = await assess(prepareAssessment({ ...input, claim: "The entitlement is 104 days." }));
    expect(changed.inputHash).not.toBe(first.inputHash); expect(changed.cacheHit).toBe(false);
  });
  it("fails without invented probabilities for model drift, missing keys, injection and invalid distributions", async () => {
    for (const bad of [
      { model: "jev-latest", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
      { model: MODEL, answers: { p0_supports: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } },
      { model: MODEL, answers: {}, usage: { input_tokens: 1, output_tokens: 1 }, secret: "provider-secret" },
    ]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(bad));
      const p = await createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl })(context());
      expect(p.status).toBe("unavailable"); expect(JSON.stringify(p)).not.toContain("provider-secret");
      expect(p.passages.every((x) => x.probabilities === null)).toBe(true);
    }
    expect(() => parseJevResponse('{"model":"jev-1.13.0","model":"jev-1.13.0","answers":{},"usage":{"input_tokens":0,"output_tokens":0}}', buildAssessmentRequests(context())[0])).toThrow();
  });
  it("restores all passages to unavailable if a later pack fails, without authentication retries", async () => {
    const one = context();
    const many = { ...one, candidates: Array.from({ length: 10 }, (_, i) => ({
      text: one.candidates[0].text, passage: { ...one.candidates[0].passage, chunkRef: `chunk:fake-${i}`, originalRank: i + 1 } })) };
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (...args) => ++calls > 1 ? new Response("provider-secret", { status: 401 }) : provider(...args));
    const p = await createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl, maxReservedInputTokens: 256_000 })(many);
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(p.failureReason).toBe("provider_auth_failed");
    expect(p.passages.every((x) => x.probabilities === null)).toBe(true);
  });
  it("keeps passage observations when pair comparison is unavailable and marks the workspace incomplete", async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (...args) => ++calls > 1 ? new Response("secret", { status: 500 }) : provider(...args));
    const p = await createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl })(context());
    expect(p.status).toBe("assessed"); expect(p.comparisonStatus).toBe("unavailable");
    expect(p.workspace.complete).toBe(false); expect(p.comparisons).toEqual([]);
  });
  it("rejects concurrent calls before spending and caps provider response size", async () => {
    let resolve!: (r: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise((r) => { resolve = r; }));
    const assess = createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl });
    const first = assess(context());
    expect((await assess(context())).failureReason).toBe("assessment_busy");
    resolve(new Response("x".repeat(64_001)));
    expect((await first).failureReason).toBe("provider_response_over_limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("bounds question packs and stops stalled fetches/bodies even when the provider ignores abort", async () => {
    const c = context();
    const many = { ...c, candidates: Array.from({ length: 20 }, (_, i) => ({
      text: "a".repeat(1800), passage: { ...c.candidates[0].passage, originalRank: i + 1 } })) };
    const packs = buildAssessmentRequests(many);
    expect(packs.reduce((n, p) => n + Object.keys(p.questions).length, 0)).toBe(80);
    for (const p of packs) {
      expect(Object.keys(p.questions).length).toBeLessThanOrEqual(20);
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(45000);
    }
    for (const fetchImpl of [
      vi.fn<typeof fetch>(() => new Promise(() => {})),
      vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() {} }))),
    ]) {
      const assessor = createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl, requestTimeoutMs: 15 });
      expect((await assessor(c)).failureReason).toBe("provider_timeout");
      expect((await assessor(c)).failureReason).not.toBe("assessment_busy");
    }
  });
  it("rejects contradictory packet states rather than presenting fabricated completeness", async () => {
    const p = await createJevAssessor({ enabled: false })(context());
    expect(assessmentPacketSchema.safeParse(p).success).toBe(true);
    expect(assessmentPacketSchema.safeParse({ ...p, status: "assessed", failureReason: null }).success).toBe(false);
    expect(assessmentPacketSchema.safeParse({ ...p, workspace: { ...p.workspace, complete: true } }).success).toBe(false);
  });
  it("propagates caller cancellation without another provider request or invented judgments", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const assessor = createJevAssessor({ enabled: true, apiKey: "test-key", fetchImpl });
    expect((await assessor(context(), cancelled.signal)).failureReason).toBe("assessment_cancelled");
    expect(fetchImpl).not.toHaveBeenCalled();
    const caller = new AbortController();
    const pending = assessor(context(), caller.signal);
    caller.abort();
    const result = await pending;
    expect(result.failureReason).toBe("assessment_cancelled");
    expect(result.passages.every((p) => p.probabilities === null)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
});

describe("assessment browser API", () => {
  const request = (value: unknown, origin = "https://desk.example") => new Request("https://desk.example/api/assessments", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  it("rejects cross-origin, missing origin and oversized inputs before assessment", async () => {
    const assess = vi.fn();
    expect((await handleAssessmentPost(request(input, "https://evil.example"), assess)).status).toBe(403);
    const absent = new Request("https://desk.example/api/assessments", { method: "POST", body: "{}" });
    expect((await handleAssessmentPost(absent, assess)).status).toBe(403);
    expect((await handleAssessmentPost(request("x".repeat(8193)), assess)).status).toBe(413);
    expect(assess).not.toHaveBeenCalled();
  });
  it("returns a bounded disabled receipt with no-store and rejects raw evidence payloads", async () => {
    const response = await handleAssessmentPost(request(input));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).status).toBe("unavailable");
    expect((await handleAssessmentPost(request({ ...input, rawEvidence: "secret" }))).status).toBe(400);
  });
  it("uses the incoming Host when Next rewrites a local URL without trusting forwarded hosts", async () => {
    const assess = vi.fn(async () => createJevAssessor({ enabled: false })(context()));
    const local = (origin: string, extra: Record<string, string> = {}) => new Request("http://localhost:3106/api/assessments", {
      method: "POST", headers: { Origin: origin, Host: "127.0.0.1:3106", "Content-Type": "application/json", ...extra },
      body: JSON.stringify(input) });
    expect((await handleAssessmentPost(local("http://127.0.0.1:3106"), assess)).status).toBe(200);
    for (const origin of ["http://evil.example", "https://127.0.0.1:3106", "http://127.0.0.1:3107", "null", "http://127.0.0.1:3106/path"]) {
      expect((await handleAssessmentPost(local(origin, { "x-forwarded-host": "evil.example" }), assess)).status).toBe(403);
    }
    expect((await handleAssessmentPost(local("http://127.0.0.1:3106", { "sec-fetch-site": "cross-site" }), assess)).status).toBe(403);
    expect(assess).toHaveBeenCalledTimes(1);
  });
  it("validates responses and catches a mismatched scope in the browser client", async () => {
    const p = await createJevAssessor({ enabled: false })(context());
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...p, sourceRef: "source:benefits-guide" })));
    try { await expect(requestClaimAssessment(input)).rejects.toThrow("assessment_scope_mismatch"); }
    finally { vi.unstubAllGlobals(); }
  });
  it("binds browser results to the exact claim and receipt checksums", async () => {
    const p = await createJevAssessor({ enabled: false })(context());
    for (const bad of [{ ...p, claimHash: sha256("different claim") }, { ...p, workspace: {
      ...p.workspace, artifacts: p.workspace.artifacts.map((a, i) => i ? a : { ...a, content: "{}" }) } }]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(bad)));
      await expect(requestClaimAssessment(input)).rejects.toThrow();
      vi.unstubAllGlobals();
    }
  });
});
