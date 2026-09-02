import { z } from "zod";

import { SOURCE_REFS } from "@/lib/evidence/types";

const sourceRefSchema = z.enum(SOURCE_REFS);
const evidenceRefsSchema = z
  .array(z.string().regex(/^chunk:[a-z0-9-]+$/))
  .min(1)
  .max(5)
  .refine((refs) => new Set(refs).size === refs.length, {
    message: "Evidence references must be unique.",
  });

export const toolInputSchemas = {
  list_knowledge_sources: z.object({}).strict(),
  select_knowledge_source: z
    .object({
      sourceRef: sourceRefSchema,
    })
    .strict(),
  check_evidence_readiness: z
    .object({
      sourceRef: sourceRefSchema,
    })
    .strict(),
  search_evidence: z
    .object({
      sourceRef: sourceRefSchema,
      query: z.string().trim().min(2).max(160),
      limit: z.number().int().min(1).max(5).default(4),
    })
    .strict(),
  read_evidence_chunk: z
    .object({
      sourceRef: sourceRefSchema,
      chunkRef: z.string().regex(/^chunk:[a-z0-9-]+$/),
    })
    .strict(),
  stage_evidence_answer: z
    .object({
      sourceRef: sourceRefSchema,
      answer: z.string().trim().min(1).max(700),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
  export_evidence_packet: z
    .object({
      sourceRef: sourceRefSchema,
      answer: z.string().trim().min(1).max(700),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),
} as const;

export type ToolName = keyof typeof toolInputSchemas;

export type ToolInput<Name extends ToolName> = z.infer<
  (typeof toolInputSchemas)[Name]
>;

export type ToolDefinition = {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
};

const metadata: Record<
  ToolName,
  Omit<ToolDefinition, "name" | "inputSchema">
> = {
  list_knowledge_sources: {
    title: "List knowledge sources",
    description:
      "List the synthetic policy sources available in the Evidence Desk.",
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  },
  select_knowledge_source: {
    title: "Select a knowledge source",
    description:
      "Select one synthetic source in the shared page before investigating it.",
    annotations: { readOnlyHint: false, untrustedContentHint: false },
  },
  check_evidence_readiness: {
    title: "Check evidence readiness",
    description:
      "Check whether a selected synthetic source has bounded text and table evidence ready for use.",
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  },
  search_evidence: {
    title: "Search evidence",
    description:
      "Search bounded chunks inside one selected synthetic source. Use specific policy terms.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  read_evidence_chunk: {
    title: "Read an evidence chunk",
    description:
      "Read one bounded synthetic evidence chunk after validating that it belongs to the selected source.",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  stage_evidence_answer: {
    title: "Stage an evidence-backed answer",
    description:
      "Stage a concise answer with evidence references for human review. This does not approve the answer.",
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  export_evidence_packet: {
    title: "Export a sanitized evidence packet",
    description:
      "Create a pending verification packet using validated synthetic evidence labels. Only the human interface can attach an approval decision.",
    annotations: { readOnlyHint: true, untrustedContentHint: false },
  },
};

export const toolDefinitions: ToolDefinition[] = (
  Object.keys(toolInputSchemas) as ToolName[]
).map((name) => ({
  name,
  ...metadata[name],
  inputSchema: z.toJSONSchema(toolInputSchemas[name], {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>,
}));

export function parseToolInput<Name extends ToolName>(
  name: Name,
  input: unknown,
): ToolInput<Name> {
  return toolInputSchemas[name].parse(input) as ToolInput<Name>;
}
