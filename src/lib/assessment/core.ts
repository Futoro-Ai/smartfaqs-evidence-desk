import { createHash } from "node:crypto";
import { evidenceChunks, knowledgeSources } from "@/data/evidenceCatalog";
import { assessmentInputSchema, MODEL, RUBRIC_VERSION, MAX_PASSAGE_CHARS, type AssessmentInput,
  type AssessmentPacket, type PassageAssessment } from "./contracts";

export const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export type AssessmentContext = ReturnType<typeof prepareAssessment>;

export function prepareAssessment(value: unknown) {
  const input: AssessmentInput = assessmentInputSchema.parse(value);
  const source = knowledgeSources.find((s) => s.ref === input.sourceRef);
  if (!source) throw new Error("knowledge_source_not_found");
  const candidates = input.evidenceRefs.map((ref, index) => {
    const chunk = evidenceChunks.find((c) => c.ref === ref && c.sourceRef === source.ref);
    if (!chunk) throw new Error("evidence_chunk_outside_selected_source");
    const fullText = [chunk.sectionPath.join(" > "), chunk.content,
      ...(chunk.table ? [chunk.table.headers.join(" | "), ...chunk.table.rows.map((r) => r.join(" | "))] : [])].join("\n");
    const text = fullText.slice(0, MAX_PASSAGE_CHARS);
    const passage: PassageAssessment = { chunkRef: chunk.ref, conceptRef: chunk.conceptRef,
      label: chunk.label, sectionPath: chunk.sectionPath, page: chunk.page, kind: chunk.kind,
      textHash: sha256(text), suppliedChars: text.length, originalChars: fullText.length,
      truncated: text.length < fullText.length, originalRank: index + 1, probabilities: null };
    return { text, passage };
  });
  const claimHash = sha256(input.claim);
  const inputHash = sha256(JSON.stringify({ claim: input.claim, sourceRef: source.ref,
    revision: source.version, candidates: candidates.map((c) => ({ ref: c.passage.chunkRef, text: c.text })) }));
  return { input, source, candidates, claimHash, inputHash };
}

export function attachWorkspace(packet: Omit<AssessmentPacket, "workspace">): AssessmentPacket {
  const contents: [AssessmentPacket["workspace"]["artifacts"][number]["name"], unknown][] = [
    ["00-contract.json", { model: packet.model, rubricVersion: packet.rubricVersion,
      rubricHash: packet.rubricHash, judgmentAuthority: packet.judgmentAuthority, humanApprovalRequired: true }],
    ["10-scope.json", { sourceRef: packet.sourceRef, sourceRevision: packet.sourceRevision,
      claimHash: packet.claimHash, inputHash: packet.inputHash }],
    ["30-retrieve.json", { candidateCount: packet.passages.length, candidates: packet.passages.map(({ probabilities, ...p }) => {
      void probabilities; return p;
    }) }],
    ["40-assess.json", { status: packet.status, failureReason: packet.failureReason,
      signals: packet.passages.map(({ chunkRef, probabilities }) => ({ chunkRef, probabilities })) }],
    ["50-compare.json", { status: packet.comparisonStatus, failureReason: packet.comparisonFailureReason, comparisons: packet.comparisons }],
    ["70-human-review.json", { answerApproval: "pending", humanApprovalRequired: true }],
    ["80-receipt.json", { elapsedMs: packet.elapsedMs, cacheHit: packet.cacheHit, requestCount: packet.requestCount,
      reservedInputTokens: packet.reservedInputTokens, usage: packet.usage, boundaryStatus: packet.boundaryStatus }],
  ];
  return { ...packet, workspace: { manifestVersion: "claim-workspace.v1",
    complete: packet.status === "assessed" && packet.comparisonStatus !== "unavailable",
    artifacts: contents.map(([name, value]) => { const content = JSON.stringify(value, null, 2); return { name, content, sha256: sha256(content) }; }) } };
}

export function emptyPacket(context: AssessmentContext, rubricHash: string): Omit<AssessmentPacket, "workspace"> {
  return { packetVersion: "claim-assessment.v1", status: "unavailable", failureReason: "assessment_disabled",
    sourceRef: context.source.ref, sourceLabel: context.source.label, sourceRevision: context.source.version,
    claimHash: context.claimHash, inputHash: context.inputHash, rubricHash, model: MODEL, rubricVersion: RUBRIC_VERSION,
    passages: context.candidates.map((c) => ({ ...c.passage })), comparisons: [], comparisonStatus: "unavailable",
    comparisonFailureReason: "assessment_unavailable", elapsedMs: 0, cacheHit: false, requestCount: 0,
    reservedInputTokens: 0, usage: { inputTokens: 0, outputTokens: 0 },
    humanApprovalRequired: true, judgmentAuthority: "model_advisory", boundaryStatus: "synthetic_public_data_only" };
}
