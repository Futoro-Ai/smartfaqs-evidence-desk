import type {
  EvidenceChunk,
  KnowledgeSection,
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

export type RankEvidenceOptions = {
  sourceRef: SourceRef;
  query: string;
  resultLimit: number;
  sectionLimit?: number;
  structuralBoost?: boolean;
};

export function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? [],
    ),
  );
}

function scoreChunk(
  chunk: EvidenceChunk,
  terms: string[],
  structuralBoost: boolean,
): number {
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
    const ancestryBoost =
      structuralBoost && structuralContext.includes(term) ? 2 : 0;
    return (
      score +
      keywordBoost +
      ancestryBoost +
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

export function rankEvidenceCatalog(
  sections: KnowledgeSection[],
  chunks: EvidenceChunk[],
  {
    sourceRef,
    query,
    resultLimit,
    sectionLimit = 3,
    structuralBoost = true,
  }: RankEvidenceOptions,
) {
  const terms = queryTerms(query);
  const matchedSections = sections
    .filter((section) => section.sourceRef === sourceRef)
    .map((section) => ({ section, score: scoreSection(section, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.section.sourceOrder - right.section.sourceOrder,
    )
    .slice(0, sectionLimit);
  const results = chunks
    .filter((chunk) => chunk.sourceRef === sourceRef)
    .map((chunk, sourceOrder) => ({
      chunk,
      score: scoreChunk(chunk, terms, structuralBoost),
      sourceOrder,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.chunk.page ?? Number.MAX_SAFE_INTEGER) -
          (right.chunk.page ?? Number.MAX_SAFE_INTEGER) ||
        left.sourceOrder - right.sourceOrder,
    )
    .slice(0, resultLimit)
    .map(({ chunk, score }) => ({ chunk, score }));

  return { matchedSections, results };
}
