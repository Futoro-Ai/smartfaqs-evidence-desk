import {
  evidenceChunks,
  knowledgeSections,
  knowledgeSources,
} from "@/data/evidenceCatalog";
import {
  parseToolInput,
  type ToolInput,
  type ToolName,
} from "@/lib/capabilities/contracts";
import type {
  EvidenceChunk,
  EvidencePacket,
  EvidenceSearchResult,
  KnowledgeSection,
  KnowledgeSource,
  SourceRef,
} from "@/lib/evidence/types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "does",
  "for",
  "how",
  "in",
  "is",
  "it",
  "of",
  "the",
  "to",
  "what",
]);

function requireSource(sourceRef: SourceRef): KnowledgeSource {
  const source = knowledgeSources.find((item) => item.ref === sourceRef);
  if (!source) {
    throw new Error("knowledge_source_not_found");
  }
  return source;
}

function requireScopedChunk(
  sourceRef: SourceRef,
  chunkRef: string,
): EvidenceChunk {
  const chunk = evidenceChunks.find(
    (item) => item.ref === chunkRef && item.sourceRef === sourceRef,
  );
  if (!chunk) {
    throw new Error("evidence_chunk_outside_selected_source");
  }
  return chunk;
}

function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? [],
    ),
  );
}

function scoreChunk(chunk: EvidenceChunk, terms: string[]): number {
  const structuralContext = chunk.sectionPath.join(" ").toLowerCase();
  const searchable = [
    chunk.label,
    chunk.section,
    chunk.content,
    chunk.keywords.join(" "),
    chunk.table?.headers.join(" ") ?? "",
    chunk.table?.rows.flat().join(" ") ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => {
    const keywordBoost = chunk.keywords.includes(term) ? 3 : 0;
    const structuralBoost = structuralContext.includes(term) ? 2 : 0;
    return (
      score +
      keywordBoost +
      structuralBoost +
      (searchable.includes(term) ? 1 : 0)
    );
  }, 0);
}

function scoreSection(section: KnowledgeSection, terms: string[]): number {
  const searchable = [
    section.label,
    section.description,
    section.sectionPath.join(" "),
    section.aliases.join(" "),
    section.keywords.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return terms.reduce((score, term) => {
    const keywordBoost = section.keywords.includes(term) ? 3 : 0;
    return score + keywordBoost + (searchable.includes(term) ? 1 : 0);
  }, 0);
}

function excerptFor(chunk: EvidenceChunk): string {
  const tableSummary = chunk.table
    ? ` ${chunk.table.headers.join(" / ")}: ${chunk.table.rows
        .map((row) => row.join(" / "))
        .join("; ")}.`
    : "";
  return `${chunk.content}${tableSummary}`.slice(0, 260);
}

export function listKnowledgeSources() {
  return {
    status: "ready" as const,
    sourceCount: knowledgeSources.length,
    sources: knowledgeSources.map(
      ({ ref, label, summary, owner, version, chunkCount, sectionCount }) => ({
        sourceRef: ref,
        label,
        summary,
        owner,
        version,
        chunkCount,
        sectionCount,
      }),
    ),
  };
}

export function selectKnowledgeSource(
  input: ToolInput<"select_knowledge_source">,
) {
  const source = requireSource(input.sourceRef);
  return {
    status: "selected" as const,
    sourceRef: source.ref,
    label: source.label,
    version: source.version,
    nextRecommendedTool: "check_evidence_readiness" as const,
  };
}

export function checkEvidenceReadiness(
  input: ToolInput<"check_evidence_readiness">,
) {
  const source = requireSource(input.sourceRef);
  const scopedChunks = evidenceChunks.filter(
    (chunk) => chunk.sourceRef === source.ref,
  );
  const scopedSections = knowledgeSections.filter(
    (section) => section.sourceRef === source.ref,
  );
  const tableChunkCount = scopedChunks.filter(
    (chunk) => chunk.kind === "table",
  ).length;

  return {
    status: "ready" as const,
    sourceLabel: source.label,
    boundedEvidenceAvailable: scopedChunks.length > 0,
    structuralNavigationAvailable:
      scopedSections.length > 0 &&
      scopedSections.every(
        (section) =>
          Boolean(section.conceptRef) &&
          section.rollup.descendantDigest.startsWith("sha256:"),
      ),
    sectionCount: scopedSections.length,
    textChunkCount: scopedChunks.length - tableChunkCount,
    tableChunkCount,
    citationLabelsAvailable: scopedChunks.every(
      (chunk) => Boolean(chunk.label) && Boolean(chunk.conceptRef),
    ),
    blockedBy: [] as string[],
  };
}

export function searchEvidence(input: ToolInput<"search_evidence">) {
  const source = requireSource(input.sourceRef);
  const terms = queryTerms(input.query);
  const matchedSections = knowledgeSections
    .filter((section) => section.sourceRef === source.ref)
    .map((section) => ({ section, score: scoreSection(section, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.section.sourceOrder - right.section.sourceOrder,
    )
    .slice(0, 3)
    .map(({ section, score }) => ({
      sectionRef: section.ref,
      conceptRef: section.conceptRef,
      label: section.label,
      sectionPath: section.sectionPath,
      parentSectionRef: section.parentRef,
      descendantEvidenceCount: section.rollup.descendantEvidenceCount,
      score,
    }));
  const results: EvidenceSearchResult[] = evidenceChunks
    .filter((chunk) => chunk.sourceRef === source.ref)
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.chunk.page ?? Number.MAX_SAFE_INTEGER) -
          (b.chunk.page ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, input.limit)
    .map(({ chunk, score }) => ({
      chunkRef: chunk.ref,
      conceptRef: chunk.conceptRef,
      sectionRef: chunk.sectionRef,
      sectionConceptRef: chunk.sectionConceptRef,
      sectionPath: chunk.sectionPath,
      label: chunk.label,
      section: chunk.section,
      page: chunk.page,
      kind: chunk.kind,
      excerpt: excerptFor(chunk),
      score,
    }));

  return {
    status: results.length > 0 ? ("matches_found" as const) : ("no_matches" as const),
    sourceLabel: source.label,
    query: input.query,
    resultCount: results.length,
    matchedSectionCount: matchedSections.length,
    matchedSections,
    results,
  };
}

export function readEvidenceChunk(
  input: ToolInput<"read_evidence_chunk">,
) {
  const source = requireSource(input.sourceRef);
  const chunk = requireScopedChunk(source.ref, input.chunkRef);
  return {
    status: "ready" as const,
    sourceLabel: source.label,
    chunkRef: chunk.ref,
    conceptRef: chunk.conceptRef,
    sectionRef: chunk.sectionRef,
    sectionConceptRef: chunk.sectionConceptRef,
    sectionPath: chunk.sectionPath,
    label: chunk.label,
    section: chunk.section,
    page: chunk.page,
    kind: chunk.kind,
    content: chunk.content,
    table: chunk.table ?? null,
  };
}

export function stageEvidenceAnswer(
  input: ToolInput<"stage_evidence_answer">,
) {
  const source = requireSource(input.sourceRef);
  const chunks = input.evidenceRefs.map((ref) =>
    requireScopedChunk(source.ref, ref),
  );
  return {
    status: "staged_for_human_review" as const,
    sourceLabel: source.label,
    answer: input.answer,
    evidence: chunks.map(({
      ref,
      conceptRef,
      sectionConceptRef,
      sectionPath,
      label,
      section,
      page,
      kind,
    }) => ({
      chunkRef: ref,
      conceptRef,
      sectionConceptRef,
      sectionPath,
      label,
      section,
      page,
      kind,
    })),
    humanApprovalRequired: true,
  };
}

export function exportEvidencePacket(
  input: ToolInput<"export_evidence_packet"> & {
    decision?: EvidencePacket["decision"];
  },
): EvidencePacket {
  const source = requireSource(input.sourceRef);
  const chunks = input.evidenceRefs.map((ref) =>
    requireScopedChunk(source.ref, ref),
  );
  return {
    packetVersion: "evidence-packet.v1",
    sourceLabel: source.label,
    answerPresent: input.answer.length > 0,
    evidenceCount: chunks.length,
    evidenceLabels: chunks.map((chunk) => chunk.label),
    decision: input.decision ?? "pending",
    boundaryStatus: "synthetic_public_data_only",
  };
}

export function executeEvidenceTool<Name extends ToolName>(
  name: Name,
  rawInput: unknown,
) {
  const input = parseToolInput(name, rawInput);
  switch (name) {
    case "list_knowledge_sources":
      return listKnowledgeSources();
    case "select_knowledge_source":
      return selectKnowledgeSource(
        input as ToolInput<"select_knowledge_source">,
      );
    case "check_evidence_readiness":
      return checkEvidenceReadiness(
        input as ToolInput<"check_evidence_readiness">,
      );
    case "search_evidence":
      return searchEvidence(input as ToolInput<"search_evidence">);
    case "read_evidence_chunk":
      return readEvidenceChunk(input as ToolInput<"read_evidence_chunk">);
    case "stage_evidence_answer":
      return stageEvidenceAnswer(
        input as ToolInput<"stage_evidence_answer">,
      );
    case "export_evidence_packet":
      return exportEvidencePacket(
        input as ToolInput<"export_evidence_packet">,
      );
    default: {
      const exhaustive: never = name;
      throw new Error(`unsupported_tool:${String(exhaustive)}`);
    }
  }
}
