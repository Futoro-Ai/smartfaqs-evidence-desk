import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  BM25F_BODY_ONLY_WEIGHTS,
  BM25F_FIELD_WEIGHTS,
  buildEvidenceSearchIndex,
  rankEvidenceCatalog,
  type EvidenceSearchIndex,
  type SearchFieldWeights,
} from "../../src/lib/evidence/ranking.ts";
import type {
  EvidenceChunk,
  KnowledgeSection,
  SourceRef,
} from "../../src/lib/evidence/types";

const MAX_DATASET_BYTES = 128 * 1024 * 1024;
const SOURCE_REF = "source:scifact" as SourceRef;
const EVIDENCE_K = [1, 3, 5, 10, 20, 50, 100] as const;
const SECTION_K = [1, 3, 5, 10] as const;
const VISIBLE_RESULT_LIMIT = 5;
const ANALYSIS_RESULT_LIMIT = 100;
const CANDIDATE_LIMIT = 1_000;

const corpusRowSchema = z
  .object({
    doc_id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    title: z.string().min(1),
    abstract: z.array(z.string()),
    structured: z.boolean().optional(),
  })
  .passthrough();

const rationaleSchema = z
  .object({
    label: z.enum(["SUPPORT", "CONTRADICT"]),
    sentences: z.array(z.number().int().nonnegative()),
  })
  .strict();

const claimRowSchema = z
  .object({
    id: z.union([z.number().int().nonnegative(), z.string().min(1)]),
    claim: z.string().min(1),
    evidence: z.record(z.string(), z.array(rationaleSchema)),
  })
  .passthrough();

type CorpusRow = z.infer<typeof corpusRowSchema>;
type ClaimRow = z.infer<typeof claimRowSchema>;

export type SciFactQuery = {
  id: string;
  query: string;
  relevantChunkRefs: string[];
  relevantSectionRefs: string[];
};

export type SciFactBenchmark = {
  sections: KnowledgeSection[];
  chunks: EvidenceChunk[];
  queries: SciFactQuery[];
  corpusDocumentCount: number;
  searchIndex: EvidenceSearchIndex;
};

type FailureCategory =
  | "success_within_visible_limit"
  | "relevant_below_visible_limit"
  | "relevant_below_analysis_limit"
  | "no_positive_lexical_match";

type RankingMode = {
  structuralBoost: boolean;
  hierarchyWeight: number;
  fieldWeights?: SearchFieldWeights;
};

type RankingMetric = {
  hitRate: number;
  meanRecall: number;
  mrr: number;
  ndcg: number;
};

function round(value: number): number {
  return Number(value.toFixed(6));
}

function sectionRef(docId: string): string {
  return `section:scifact-${docId}`;
}

function chunkRef(docId: string, sentenceIndex: number): string {
  return `chunk:scifact-${docId}-sentence-${sentenceIndex}`;
}

function conceptRef(docId: string): string {
  return `scifact@official/document-${docId}`;
}

export async function readJsonl<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new Error("scifact_input_not_file");
  if (fileStats.size > MAX_DATASET_BYTES) {
    throw new Error("scifact_input_too_large");
  }
  const input = await readFile(filePath, "utf8");
  return input
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return schema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`invalid_scifact_row:${index + 1}`, { cause: error });
      }
    });
}

export async function loadSciFactDataset(dataDirectory: string) {
  const [corpus, claims] = await Promise.all([
    readJsonl(`${dataDirectory}/corpus.jsonl`, corpusRowSchema),
    readJsonl(`${dataDirectory}/claims_dev.jsonl`, claimRowSchema),
  ]);
  return { corpus, claims };
}

export function buildSciFactBenchmark(
  corpus: CorpusRow[],
  claims: ClaimRow[],
): SciFactBenchmark {
  const documents = new Map<string, CorpusRow>();
  const sections: KnowledgeSection[] = [];
  const chunks: EvidenceChunk[] = [];

  corpus.forEach((document, sourceOrder) => {
    const docId = String(document.doc_id);
    if (documents.has(docId)) throw new Error(`duplicate_scifact_document:${docId}`);
    documents.set(docId, document);
    const ref = sectionRef(docId);
    const childRefs = document.abstract.map((_, sentenceIndex) =>
      chunkRef(docId, sentenceIndex),
    );
    sections.push({
      ref,
      conceptRef: conceptRef(docId),
      sourceRef: SOURCE_REF,
      label: document.title,
      description: document.title,
      sectionPath: [document.title],
      depth: 1,
      sourceOrder,
      structuralOrigin: "explicit_heading",
      headingRecordCount: 1,
      page: null,
      aliases: [],
      keywords: [],
      parentRef: null,
      rollup: {
        directSectionCount: 0,
        directEvidenceCount: childRefs.length,
        descendantEvidenceCount: childRefs.length,
        textCount: childRefs.length,
        tableCount: 0,
        pageStart: null,
        pageEnd: null,
        descendantDigest: `sha256:${createHash("sha256")
          .update(childRefs.join("\n"))
          .digest("hex")
          .slice(0, 24)}`,
      },
    });
    document.abstract.forEach((sentence, sentenceIndex) => {
      if (!sentence.trim()) return;
      chunks.push({
        ref: chunkRef(docId, sentenceIndex),
        conceptRef: `${conceptRef(docId)}/sentence-${sentenceIndex}`,
        sourceRef: SOURCE_REF,
        sectionRef: ref,
        sectionConceptRef: conceptRef(docId),
        sectionPath: [document.title],
        label: document.title,
        section: document.title,
        page: null,
        kind: "text",
        content: sentence,
        keywords: [],
      });
    });
  });

  const queries = claims
    .map((claim): SciFactQuery | null => {
      const relevantChunkRefs = new Set<string>();
      const relevantSectionRefs = new Set<string>();
      for (const [docId, rationales] of Object.entries(claim.evidence)) {
        const document = documents.get(docId);
        if (!document) throw new Error(`unknown_scifact_document:${docId}`);
        relevantSectionRefs.add(sectionRef(docId));
        for (const rationale of rationales) {
          for (const sentenceIndex of rationale.sentences) {
            if (!document.abstract[sentenceIndex]?.trim()) {
              throw new Error(`invalid_scifact_sentence:${docId}:${sentenceIndex}`);
            }
            relevantChunkRefs.add(chunkRef(docId, sentenceIndex));
          }
        }
      }
      if (relevantChunkRefs.size === 0) return null;
      return {
        id: String(claim.id),
        query: claim.claim,
        relevantChunkRefs: [...relevantChunkRefs],
        relevantSectionRefs: [...relevantSectionRefs],
      };
    })
    .filter((query): query is SciFactQuery => query !== null)
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));

  return {
    sections,
    chunks,
    queries,
    corpusDocumentCount: documents.size,
    searchIndex: buildEvidenceSearchIndex(sections, chunks),
  };
}

export function calculateRankingMetric(
  expectedRefs: string[],
  rankedRefs: string[],
  k: number,
): RankingMetric {
  const expected = new Set(expectedRefs);
  const ranked = rankedRefs.slice(0, k);
  const relevantRanks = ranked
    .map((ref, index) => (expected.has(ref) ? index + 1 : null))
    .filter((rank): rank is number => rank !== null);
  const idealCount = Math.min(expected.size, k);
  const dcg = relevantRanks.reduce(
    (total, rank) => total + 1 / Math.log2(rank + 1),
    0,
  );
  const idcg = Array.from(
    { length: idealCount },
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((total, value) => total + value, 0);

  return {
    hitRate: relevantRanks.length > 0 ? 1 : 0,
    meanRecall: expected.size > 0 ? relevantRanks.length / expected.size : 0,
    mrr: relevantRanks[0] ? 1 / relevantRanks[0] : 0,
    ndcg: idcg > 0 ? dcg / idcg : 0,
  };
}

function aggregateMetrics(
  values: Array<Record<string, RankingMetric>>,
  kValues: readonly number[],
) {
  return Object.fromEntries(
    kValues.map((k) => {
      const metrics = values.map((value) => value[String(k)]);
      return [
        String(k),
        {
          hitRate: round(
            metrics.reduce((total, metric) => total + metric.hitRate, 0) /
              metrics.length,
          ),
          meanRecall: round(
            metrics.reduce((total, metric) => total + metric.meanRecall, 0) /
              metrics.length,
          ),
          mrr: round(
            metrics.reduce((total, metric) => total + metric.mrr, 0) /
              metrics.length,
          ),
          ndcg: round(
            metrics.reduce((total, metric) => total + metric.ndcg, 0) /
              metrics.length,
          ),
        },
      ];
    }),
  );
}

function metricsFor(
  expectedRefs: string[],
  rankedRefs: string[],
  kValues: readonly number[],
) {
  return Object.fromEntries(
    kValues.map((k) => [String(k), calculateRankingMetric(expectedRefs, rankedRefs, k)]),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return round(sorted[index] ?? 0);
}

function firstRelevantRank(expectedRefs: string[], rankedRefs: string[]) {
  const expected = new Set(expectedRefs);
  const index = rankedRefs.findIndex((ref) => expected.has(ref));
  return index < 0 ? null : index + 1;
}

function failureCategory(
  firstRank: number | null,
  relevantPositiveCount: number,
): FailureCategory {
  if (firstRank !== null && firstRank <= VISIBLE_RESULT_LIMIT) {
    return "success_within_visible_limit";
  }
  if (firstRank !== null) return "relevant_below_visible_limit";
  if (relevantPositiveCount > 0) return "relevant_below_analysis_limit";
  return "no_positive_lexical_match";
}

function evaluateMode(
  benchmark: SciFactBenchmark,
  queries: SciFactQuery[],
  mode: RankingMode,
) {
  const topFiveByQuery = new Map<string, string[]>();
  const latencyValues: number[] = [];
  const queryResults = queries.map((query) => {
    const startedAt = performance.now();
    const ranked = rankEvidenceCatalog(benchmark.sections, benchmark.chunks, {
      sourceRef: SOURCE_REF,
      query: query.query,
      resultLimit: ANALYSIS_RESULT_LIMIT,
      sectionLimit: SECTION_K.at(-1),
      candidateLimit: CANDIDATE_LIMIT,
      structuralBoost: mode.structuralBoost,
      hierarchyWeight: mode.hierarchyWeight,
      fieldWeights: mode.fieldWeights,
      searchIndex: benchmark.searchIndex,
    });
    latencyValues.push(performance.now() - startedAt);
    const evidenceRefs = ranked.results.map(({ chunk }) => chunk.ref);
    topFiveByQuery.set(query.id, evidenceRefs.slice(0, VISIBLE_RESULT_LIMIT));
    const evidenceSectionRefs = unique(
      ranked.results.map(({ chunk }) => chunk.sectionRef),
    );
    const navigationSectionRefs = ranked.matchedSections.map(
      ({ section }) => section.ref,
    );
    const positiveRefs = new Set(ranked.diagnostics.positiveChunkRefs);
    const relevantPositiveCount = query.relevantChunkRefs.filter((ref) =>
      positiveRefs.has(ref),
    ).length;
    const firstRank = firstRelevantRank(query.relevantChunkRefs, evidenceRefs);

    return {
      queryId: query.id,
      relevantEvidenceCount: query.relevantChunkRefs.length,
      relevantDocumentCount: query.relevantSectionRefs.length,
      retrievedEvidenceCount: evidenceRefs.length,
      retrievedNavigationSectionCount: navigationSectionRefs.length,
      positiveCandidateCount: ranked.diagnostics.positiveCandidateCount,
      candidatePoolCount: ranked.diagnostics.candidatePoolCount,
      relevantPositiveCount,
      firstRelevantRank: firstRank,
      failureCategory: failureCategory(firstRank, relevantPositiveCount),
      evidence: metricsFor(query.relevantChunkRefs, evidenceRefs, EVIDENCE_K),
      documentsFromEvidence: metricsFor(
        query.relevantSectionRefs,
        evidenceSectionRefs,
        EVIDENCE_K,
      ),
      sectionNavigation: metricsFor(
        query.relevantSectionRefs,
        navigationSectionRefs,
        SECTION_K,
      ),
    };
  });

  return {
    report: {
      config: mode,
      metrics: {
        evidence: aggregateMetrics(
          queryResults.map(({ evidence }) => evidence),
          EVIDENCE_K,
        ),
        documentsFromEvidence: aggregateMetrics(
          queryResults.map(({ documentsFromEvidence }) => documentsFromEvidence),
          EVIDENCE_K,
        ),
        sectionNavigation: aggregateMetrics(
          queryResults.map(({ sectionNavigation }) => sectionNavigation),
          SECTION_K,
        ),
      },
      diagnostics: {
        meanPositiveCandidateCount: round(
          queryResults.reduce(
            (total, result) => total + result.positiveCandidateCount,
            0,
          ) / queryResults.length,
        ),
        failureCategoryCounts: Object.fromEntries(
          [
            "success_within_visible_limit",
            "relevant_below_visible_limit",
            "relevant_below_analysis_limit",
            "no_positive_lexical_match",
          ].map((category) => [
            category,
            queryResults.filter((result) => result.failureCategory === category)
              .length,
          ]),
        ),
        latencyMs: {
          median: percentile(latencyValues, 0.5),
          p95: percentile(latencyValues, 0.95),
        },
      },
      queryResults,
    },
    topFiveByQuery,
  };
}

function compareModes(
  queries: SciFactQuery[],
  first: Map<string, string[]>,
  second: Map<string, string[]>,
) {
  let bothHit = 0;
  let firstOnly = 0;
  let secondOnly = 0;
  let neither = 0;
  let identicalTopFive = 0;
  let totalShared = 0;
  let totalJaccard = 0;

  for (const query of queries) {
    const expected = new Set(query.relevantChunkRefs);
    const firstRefs = first.get(query.id) ?? [];
    const secondRefs = second.get(query.id) ?? [];
    const firstSet = new Set(firstRefs);
    const secondSet = new Set(secondRefs);
    const firstHit = firstRefs.some((ref) => expected.has(ref));
    const secondHit = secondRefs.some((ref) => expected.has(ref));
    if (firstHit && secondHit) bothHit += 1;
    else if (firstHit) firstOnly += 1;
    else if (secondHit) secondOnly += 1;
    else neither += 1;

    const shared = [...firstSet].filter((ref) => secondSet.has(ref)).length;
    const union = new Set([...firstSet, ...secondSet]).size;
    totalShared += shared;
    totalJaccard += union === 0 ? 1 : shared / union;
    if (JSON.stringify(firstRefs) === JSON.stringify(secondRefs)) {
      identicalTopFive += 1;
    }
  }

  return {
    cutoff: VISIBLE_RESULT_LIMIT,
    bothHit,
    firstOnly,
    secondOnly,
    neither,
    unionHitRate: round((bothHit + firstOnly + secondOnly) / queries.length),
    meanSharedResultCount: round(totalShared / queries.length),
    meanJaccard: round(totalJaccard / queries.length),
    identicalTopFiveCount: identicalTopFive,
  };
}

export function evaluateSciFactBenchmark(
  benchmark: SciFactBenchmark,
  queryLimit?: number,
  titleWeight = BM25F_FIELD_WEIGHTS.title,
) {
  if (queryLimit !== undefined && (!Number.isInteger(queryLimit) || queryLimit < 1)) {
    throw new Error("invalid_query_limit");
  }
  if (titleWeight !== 0.35 && titleWeight !== 0.5) {
    throw new Error("invalid_title_weight");
  }
  const queries = benchmark.queries.slice(0, queryLimit);
  if (queries.length === 0) throw new Error("no_scifact_queries_with_evidence");
  const fieldWeights = { ...BM25F_FIELD_WEIGHTS, title: titleWeight };

  const lexicalBodyOnly = evaluateMode(benchmark, queries, {
    structuralBoost: false,
    hierarchyWeight: 0,
    fieldWeights: BM25F_BODY_ONLY_WEIGHTS,
  });
  const fieldedWithoutHierarchy = evaluateMode(benchmark, queries, {
    structuralBoost: false,
    hierarchyWeight: 0,
    fieldWeights,
  });
  const fieldedWithHierarchy = evaluateMode(benchmark, queries, {
    structuralBoost: true,
    hierarchyWeight: 0.15,
    fieldWeights,
  });

  return {
    schemaVersion: "smartfaqs-scifact-benchmark.v2",
    dataset: "SciFact labeled development split",
    corpusDocumentCount: benchmark.corpusDocumentCount,
    evidenceChunkCount: benchmark.chunks.length,
    eligibleQueryCount: benchmark.queries.length,
    evaluatedQueryCount: queries.length,
    bounds: {
      visibleEvidenceResultLimit: VISIBLE_RESULT_LIMIT,
      analysisEvidenceResultLimit: ANALYSIS_RESULT_LIMIT,
      candidateLimit: CANDIDATE_LIMIT,
      visibleNavigationSectionLimit: 3,
      analysisNavigationSectionLimit: SECTION_K.at(-1),
    },
    modes: {
      lexicalBodyOnly: lexicalBodyOnly.report,
      fieldedWithoutHierarchy: fieldedWithoutHierarchy.report,
      fieldedWithHierarchy: fieldedWithHierarchy.report,
    },
    complementarity: compareModes(
      queries,
      fieldedWithoutHierarchy.topFiveByQuery,
      fieldedWithHierarchy.topFiveByQuery,
    ),
  };
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
