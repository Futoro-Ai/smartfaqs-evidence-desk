import { z } from "zod";
import { SOURCE_REFS } from "@/lib/evidence/types";

export const SIGNALS = ["supports", "contradicts", "qualifies", "needs_context"] as const;
export const RELATIONS = ["direct_conflict", "qualification", "different_scope", "different_time", "unresolved"] as const;
export const MODEL = "jev-1.13.0";
export const RUBRIC_VERSION = "claim-evidence.v1";
export const MAX_PASSAGES = 20;
export const MAX_PASSAGE_CHARS = 1800;
export const assessmentInputSchema = z.object({
  sourceRef: z.enum(SOURCE_REFS), claim: z.string().trim().min(3).max(500),
  evidenceRefs: z.array(z.string().regex(/^chunk:[a-z0-9-]+$/)).min(1).max(MAX_PASSAGES)
    .refine((refs) => new Set(refs).size === refs.length, "Evidence references must be unique."),
  allowExternalAssessment: z.boolean().default(false),
}).strict();
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;
export type Signal = (typeof SIGNALS)[number];
export type Relation = (typeof RELATIONS)[number];
export const probabilitySchema = z.number().finite().min(0).max(1);
export const signalsSchema = z.object({ supports: probabilitySchema, contradicts: probabilitySchema,
  qualifies: probabilitySchema, needs_context: probabilitySchema }).strict();
export type Signals = z.infer<typeof signalsSchema>;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const passageAssessmentSchema = z.object({
  chunkRef: z.string().regex(/^chunk:[a-z0-9-]+$/), conceptRef: z.string().max(512),
  label: z.string().max(256), sectionPath: z.array(z.string().max(256)).max(20),
  page: z.number().int().positive().nullable(), kind: z.enum(["text", "table"]),
  textHash: digest, suppliedChars: z.number().int().min(1).max(MAX_PASSAGE_CHARS),
  originalChars: z.number().int().positive(), truncated: z.boolean(),
  originalRank: z.number().int().min(1).max(MAX_PASSAGES), probabilities: signalsSchema.nullable(),
}).strict();
export type PassageAssessment = z.infer<typeof passageAssessmentSchema>;
export const pairAssessmentSchema = z.object({
  leftRef: z.string(), rightRef: z.string(), relation: z.enum(RELATIONS),
  probabilities: z.object({ direct_conflict: probabilitySchema, qualification: probabilitySchema,
    different_scope: probabilitySchema, different_time: probabilitySchema, unresolved: probabilitySchema }).strict(),
  confidence: probabilitySchema,
}).strict();
export const STAGE_NAMES = ["00-contract.json", "10-scope.json", "30-retrieve.json", "40-assess.json",
  "50-compare.json", "70-human-review.json", "80-receipt.json"] as const;
const stageSchema = z.object({ name: z.enum(STAGE_NAMES),
  sha256: digest, content: z.string().max(60000) }).strict();
export const assessmentPacketSchema = z.object({
  packetVersion: z.literal("claim-assessment.v1"), status: z.enum(["assessed", "unavailable"]),
  failureReason: z.string().max(80).nullable(),
  sourceRef: z.enum(SOURCE_REFS), sourceLabel: z.string().max(256), sourceRevision: z.string().max(100),
  claimHash: digest, inputHash: digest, rubricHash: digest,
  model: z.literal(MODEL), rubricVersion: z.literal(RUBRIC_VERSION),
  passages: z.array(passageAssessmentSchema).min(1).max(MAX_PASSAGES),
  comparisons: z.array(pairAssessmentSchema).max(3),
  comparisonStatus: z.enum(["assessed", "not_needed", "unavailable"]),
  comparisonFailureReason: z.string().max(80).nullable(),
  elapsedMs: z.number().finite().nonnegative(), cacheHit: z.boolean(),
  requestCount: z.number().int().nonnegative(), reservedInputTokens: z.number().int().nonnegative(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict(),
  humanApprovalRequired: z.literal(true), judgmentAuthority: z.literal("model_advisory"),
  boundaryStatus: z.literal("synthetic_public_data_only"),
  workspace: z.object({ manifestVersion: z.literal("claim-workspace.v1"),
    complete: z.boolean(), artifacts: z.array(stageSchema).length(7) }).strict(),
}).strict().refine((p) =>
  new Set(p.passages.map((v) => v.chunkRef)).size === p.passages.length &&
  p.passages.every((v, i) => v.originalRank === i + 1 && v.originalChars >= v.suppliedChars &&
    v.truncated === (v.originalChars > v.suppliedChars) &&
    (p.status === "assessed" ? v.probabilities !== null : v.probabilities === null)) &&
  (p.status === "assessed" ? p.failureReason === null : p.failureReason !== null) &&
  p.comparisons.every((v) => v.leftRef !== v.rightRef &&
    [v.leftRef, v.rightRef].every((ref) => p.passages.some((a) => a.chunkRef === ref))) &&
  (p.comparisonStatus === "assessed" ? p.comparisons.length > 0 && p.comparisonFailureReason === null :
    p.comparisons.length === 0) &&
  p.workspace.complete === (p.status === "assessed" && p.comparisonStatus !== "unavailable") &&
  new Set(p.workspace.artifacts.map((a) => a.name)).size === STAGE_NAMES.length,
  "assessment_packet_inconsistent");
export type AssessmentPacket = z.infer<typeof assessmentPacketSchema>;
export const REVIEW_DECISIONS = ["unreviewed", ...SIGNALS, "irrelevant", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export function signalOrder(passages: PassageAssessment[], signal: Signal): PassageAssessment[] {
  return passages.filter((p) => p.probabilities !== null).toSorted((a, b) =>
    b.probabilities![signal] - a.probabilities![signal] || a.originalRank - b.originalRank);
}

export function balancedReviewRefs(passages: PassageAssessment[], limit = 5): string[] {
  const boundedLimit = Math.max(1, Math.min(5, Math.floor(limit)));
  const refs: string[] = [];
  for (const signal of SIGNALS) {
    const next = signalOrder(passages, signal).find((p) => !refs.includes(p.chunkRef));
    if (next && refs.length < boundedLimit) refs.push(next.chunkRef);
  }
  for (const p of passages) if (refs.length < boundedLimit && !refs.includes(p.chunkRef)) refs.push(p.chunkRef);
  return refs;
}

export function reviewedReceipt(packet: AssessmentPacket, decisions: Record<string, ReviewDecision>) {
  return { ...packet, humanReview: packet.passages.map((p) => ({ chunkRef: p.chunkRef,
    decision: REVIEW_DECISIONS.includes(decisions[p.chunkRef]) ? decisions[p.chunkRef] : "unreviewed" })),
    answerApproval: "pending" as const };
}
