import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { evaluateClaims } from "./evaluate.mjs";
import { validateArtifacts, writeAssessmentWorkspace, verifyAssessmentWorkspace } from "./workspace.mjs";
import { prepareAssessment, emptyPacket, attachWorkspace } from "../../../src/lib/assessment/core";
import { RUBRIC_HASH } from "../../../src/lib/assessment/jev";

const rawHash = (s: string) => createHash("sha256").update(s).digest("hex");
const hash = (s: string) => "sha256:" + rawHash(s);
const catalogText = JSON.stringify({ revision: "fixture.v1", chunks: [
  { ref: "c1", sourceRef: "s1", sectionPath: [], content: "104 hours" },
  { ref: "c2", sourceRef: "s1", sectionPath: [], content: "part-time" },
] });
const options = (gold: unknown) => ({ threshold: 0.5, goldSha256: rawHash(JSON.stringify(gold)), catalogText });
const fixture = () => {
  const gold = { schemaVersion: "claim-gold.v1", corpusSha256: rawHash(catalogText), sourceRevision: "fixture.v1",
    labelAuthority: "ai_review_provisional", split: "regression", cases: [
    { id: "numeric", sourceRef: "s1", claim: "The allowance is 104 hours.", category: "numeric",
      passages: [
        { chunkRef: "c1", textHash: hash("\n104 hours"), rationale: "Explicit hours match.", labels: { supports: true, contradicts: false, qualifies: false, needs_context: false } },
        { chunkRef: "c2", textHash: hash("\npart-time"), rationale: "Population restriction.", labels: { supports: false, contradicts: false, qualifies: true, needs_context: false } },
      ], evidenceGroups: [["c1"], ["c2"]] },
  ] };
  const predictions = { schemaVersion: "claim-predictions.v1", model: "fake-provider",
    rubricHash: RUBRIC_HASH, evaluatorRevision: "f".repeat(40), goldSha256: rawHash(JSON.stringify(gold)), corpusSha256: "b".repeat(64),
    cases: [{ id: "numeric", sourceRef: "s1", claimHash: hash(gold.cases[0].claim), candidateRefs: ["c1", "c2"],
      lexicalSelectedRefs: ["c1"], selectedRefs: ["c1", "c2"], passages: [
        { chunkRef: "c1", textHash: hash("\n104 hours"), probabilities: { supports: 0.9, contradicts: 0.8, qualifies: 0.1, needs_context: 0.1 } },
        { chunkRef: "c2", textHash: hash("\npart-time"), probabilities: null },
      ], elapsedMs: 10, inputTokens: 100 }] };
  predictions.corpusSha256 = rawHash(catalogText);
  return { gold, predictions };
};
describe("claim evaluation and workspace integrity", () => {
  it("separates judged quality, unavailable coverage, false conflict and multi-passage completeness", () => {
    const { gold, predictions } = fixture();
    const report = evaluateClaims(gold, predictions, options(gold));
    expect(report.coverage).toBe(0.5);
    expect(report.perSignal.contradicts.fp).toBe(1);
    expect(report.perSignal.qualifies.missedPositive).toBe(1);
    expect(report.positiveSignalRecovery).toBe(0.5);
    expect(report.positiveSignalTotal).toBe(2);
    expect(report.unavailableCounts.assessment_unavailable).toBe(1);
    expect(report.macroF1ContributingSignals).toBe(2);
    expect(report.multiplePositiveRate).toBe(1);
    expect(report.lexicalCompleteness).toBe(0);
    expect(report.diverseSelectionCompleteness).toBe(1);
    expect(report.semanticCalibrationDemonstrated).toBe(false);
  });
  it("rejects missing thresholds and mismatched claim, scope, gold, passage identities and duplicates", () => {
    const { gold, predictions } = fixture();
    expect(() => evaluateClaims(gold, predictions)).toThrow("explicit_threshold_required");
    expect(() => evaluateClaims(gold, predictions, { threshold: 0.5 })).toThrow("expected_identities_required");
    expect(() => evaluateClaims(gold, predictions, { ...options(gold), goldSha256: "c".repeat(64) })).toThrow("gold_identity_mismatch");
    for (const change of [{ sourceRef: "other" }, { claimHash: hash("other") }, { candidateRefs: ["c1"] },
      { passages: [predictions.cases[0].passages[0], predictions.cases[0].passages[0]] }]) {
      expect(() => evaluateClaims(gold, { ...predictions, cases: [{ ...predictions.cases[0], ...change }] }, options(gold))).toThrow();
    }
  });
  it("keeps no observations unknown rather than reporting perfect empty scores", () => {
    const { gold, predictions } = fixture();
    const report = evaluateClaims(gold, { ...predictions, cases: [] }, options(gold));
    expect(report.coverage).toBe(0);
    expect(report.macroF1OnJudged).toBeNull();
    expect(report.positiveSignalRecovery).toBe(0);
    expect(report.unavailableCounts.missing_case).toBe(2);
  });
  it("rejects tampering, duplicate stages and path traversal", () => {
    const packet = attachWorkspace(emptyPacket(prepareAssessment({ sourceRef: "source:employee-handbook",
      claim: "The allowance is 104 hours.", evidenceRefs: ["chunk:leave-accrual-table"] }), RUBRIC_HASH));
    expect(validateArtifacts(packet.workspace.artifacts)).toHaveLength(7);
    expect(() => validateArtifacts(packet.workspace.artifacts.map((a, i) => i ? a : { ...a, content: "{}" }))).toThrow();
    expect(() => validateArtifacts(packet.workspace.artifacts.map((a, i) => i ? a : { ...a, name: "../../escape.json" }))).toThrow();
  });
  it("keeps OR-group completeness separate from positive-passage recovery and rejects invalid refs", () => {
    const { gold, predictions } = fixture();
    gold.cases[0].passages[1].labels = { supports: true, contradicts: false, qualifies: false, needs_context: false };
    gold.cases[0].evidenceGroups = [["c1", "c2"]];
    predictions.goldSha256 = rawHash(JSON.stringify(gold));
    const report = evaluateClaims(gold, predictions, options(gold));
    expect(report.lexicalCompleteness).toBe(1);
    expect(report.positiveSignalRecovery).toBe(0.5);
    gold.cases[0].evidenceGroups = [["cross-source"]];
    predictions.goldSha256 = rawHash(JSON.stringify(gold));
    expect(() => evaluateClaims(gold, predictions, options(gold))).toThrow("gold_scope_or_passage_mismatch");
  });
  it("pins the provisional public fixtures to actual catalog text and runtime-supplied passage hashes", () => {
    const goldText = readFileSync(new URL("./northstar-gold.v1.json", import.meta.url), "utf8");
    const gold = JSON.parse(goldText);
    const rawCatalog = readFileSync(new URL("../../../src/data/okfCatalog.generated.json", import.meta.url), "utf8");
    const report = evaluateClaims(gold, { schemaVersion: "claim-predictions.v1", model: "not-run",
      rubricHash: RUBRIC_HASH, evaluatorRevision: "f".repeat(40), goldSha256: rawHash(goldText),
      corpusSha256: rawHash(rawCatalog), cases: [] }, { threshold: 0.5, goldSha256: rawHash(goldText), catalogText: rawCatalog });
    expect(report.caseCount).toBe(10); expect(report.coverage).toBe(0);
    expect(report.independentAdjudicationVerified).toBe(false);
    for (const c of gold.cases) {
      const actual = prepareAssessment({ sourceRef: c.sourceRef, claim: c.claim, evidenceRefs: c.passages.map((p: {chunkRef: string}) => p.chunkRef) });
      expect(actual.candidates.map((p) => p.passage.textHash)).toEqual(c.passages.map((p: {textHash: string}) => p.textHash));
    }
  });
  it("rejects foreign candidate scopes and mismatched corpus revisions", () => {
    const { gold, predictions } = fixture();
    expect(() => evaluateClaims(gold, { ...predictions, cases: [{ ...predictions.cases[0],
      candidateRefs: ["c1", "foreign-source"] }] }, options(gold))).toThrow("prediction_scope_or_claim_mismatch");
    expect(() => evaluateClaims({ ...gold, sourceRevision: "wrong" }, predictions, options(gold))).toThrow("corpus_identity_mismatch");
    expect(() => evaluateClaims(gold, predictions, { ...options(gold), catalogText: catalogText + " " })).toThrow("corpus_identity_mismatch");
  });
  it("materializes private handoffs and corrections, verifies integrity, and rejects tampering and symlinks", async () => {
    const base = new URL("../../../.local/claim-test-runs/", import.meta.url);
    await mkdir(base, { recursive: true, mode: 0o700 });
    const parent = await mkdtemp(new URL("run-", base).pathname);
    const packet = attachWorkspace(emptyPacket(prepareAssessment({ sourceRef: "source:employee-handbook",
      claim: "The allowance is 104 hours.", evidenceRefs: ["chunk:leave-accrual-table"] }), RUBRIC_HASH));
    const run = await writeAssessmentWorkspace({ ...packet,
      humanReview: [{ chunkRef: "chunk:leave-accrual-table", decision: "qualifies" }] }, parent);
    expect(await verifyAssessmentWorkspace(run)).toEqual({ integrity: "verified", complete: false, authenticated: false, artifactCount: 8 });
    const correction = JSON.parse(await readFile(run + "/75-review-corrections.json", "utf8"));
    expect(correction.answerApproval).toBe("pending");
    await writeFile(run + "/40-assess.json", "{}", { mode: 0o600 });
    await expect(verifyAssessmentWorkspace(run)).rejects.toThrow("workspace_integrity_invalid");
    await symlink(run, parent + "/linked");
    await expect(writeAssessmentWorkspace(packet, parent + "/linked")).rejects.toThrow("workspace_path_invalid");
    await expect(verifyAssessmentWorkspace(parent + "/does-not-exist")).rejects.toThrow();
  });
});
