import { assessmentInputSchema, assessmentPacketSchema, type AssessmentInput, type AssessmentPacket } from "./contracts";

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return "sha256:" + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validateAssessmentResponse(input: AssessmentInput, value: unknown): Promise<AssessmentPacket> {
  const packet = assessmentPacketSchema.parse(value);
  if (packet.sourceRef !== input.sourceRef || packet.claimHash !== await digest(input.claim) ||
      packet.passages.length !== input.evidenceRefs.length ||
      packet.passages.some((p, i) => p.chunkRef !== input.evidenceRefs[i])) throw new Error("assessment_scope_mismatch");
  for (const artifact of packet.workspace.artifacts) {
    if (artifact.sha256 !== await digest(artifact.content)) throw new Error("assessment_receipt_invalid");
  }
  return packet;
}

export async function requestClaimAssessment(input: unknown, signal?: AbortSignal): Promise<AssessmentPacket> {
  const validated = assessmentInputSchema.parse(input);
  const response = await fetch("/api/assessments", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(validated),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000) });
  if (!response.ok) throw new Error("claim_assessment_request_failed");
  return validateAssessmentResponse(validated, await response.json());
}
