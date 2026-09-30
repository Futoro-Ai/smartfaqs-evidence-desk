import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  BM25F_FIELD_WEIGHTS, buildEvidenceSearchIndex, queryTerms, rankEvidenceCatalog,
  type EvidenceSearchIndex, type SearchFieldWeights,
} from "../../src/lib/evidence/ranking.ts";
import type { EvidenceChunk, KnowledgeSection, SourceRef } from "../../src/lib/evidence/types";
import { calculateRankingMetric } from "./scifact-lib.mts";

export const POOL_SIZES = [20, 50, 100] as const;
export type CandidateQuery = {
  id: string;
  query: string;
  sourceRef: SourceRef;
  relevantRefs: string[];
  excludedRefs?: string[];
};
type Input = {
  sections: KnowledgeSection[];
  chunks: EvidenceChunk[];
  queries: CandidateQuery[];
  searchIndex?: EvidenceSearchIndex;
  fieldWeights?: SearchFieldWeights;
  structuralBoost?: boolean;
};

const round = (n: number) => Number(n.toFixed(6));
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0);
}
function firstRank(gold: ReadonlySet<string>, refs: string[]) {
  const index = refs.findIndex((ref) => gold.has(ref));
  return index < 0 ? null : index + 1;
}

export function fuseRefs(primary: string[], secondary: string[], depth: number) {
  const scores = new Map<string, { score: number; order: number }>();
  for (const list of [primary, secondary]) {
    list.slice(0, depth).forEach((ref, index) => {
      const old = scores.get(ref);
      scores.set(ref, {
        score: (old?.score ?? 0) + 1 / (60 + index + 1),
        order: old?.order ?? scores.size,
      });
    });
  }
  return [...scores].sort((a, b) =>
    b[1].score - a[1].score || a[1].order - b[1].order,
  ).map(([ref]) => ref).slice(0, depth);
}

function feedbackTerms(query: string, chunks: EvidenceChunk[], index: EvidenceSearchIndex, sourceRef: SourceRef) {
  const source = index.bySource.get(sourceRef);
  if (!source) return [];
  const original = new Set(queryTerms(query));
  const counts = new Map<string, number>();
  for (const chunk of chunks.slice(0, 3)) {
    for (const term of new Set(queryTerms(chunk.content))) {
      if (!original.has(term)) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts].filter(([term, count]) => count >= 2 && source.chunkPostings.has(term))
    .sort(([a], [b]) =>
      (source.chunkPostings.get(a)?.size ?? Infinity) -
      (source.chunkPostings.get(b)?.size ?? Infinity) ||
      a.localeCompare(b, "en"),
    ).slice(0, 6).map(([term]) => term);
}

export function analyzeCandidatePaths({
  sections, chunks, queries, searchIndex,
  fieldWeights = BM25F_FIELD_WEIGHTS, structuralBoost = true,
}: Input) {
  if (queries.length < 1 || queries.length > 500 ||
      new Set(queries.map((q) => q.id)).size !== queries.length) {
    throw new Error("invalid_candidate_queries");
  }
  const index = searchIndex ?? buildEvidenceSearchIndex(sections, chunks);
  const refsBySource = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    const refs = refsBySource.get(chunk.sourceRef) ?? new Set<string>();
    if (refs.has(chunk.ref)) throw new Error("duplicate_candidate_ref");
    refs.add(chunk.ref);
    refsBySource.set(chunk.sourceRef, refs);
  }
  let observedPeakRssMiB = process.memoryUsage().rss / 1024 / 1024;
  const rows = queries.map((item) => {
    const scope = refsBySource.get(item.sourceRef);
    const excluded = new Set(item.excludedRefs ?? []);
    if (!scope || item.query.length < 2 || item.query.length > 25_000 ||
        new Set(item.relevantRefs).size !== item.relevantRefs.length ||
        item.relevantRefs.some((ref) => !scope.has(ref) || excluded.has(ref))) {
      throw new Error("invalid_candidate_query_scope");
    }
    const options = {
      sourceRef: item.sourceRef, resultLimit: 100, candidateLimit: 2_000,
      fieldWeights, structuralBoost, searchIndex: index, excludedChunkRefs: excluded,
    };
    const start = performance.now();
    const lexical = rankEvidenceCatalog(sections, chunks, { ...options, query: item.query });
    const terms = feedbackTerms(item.query, lexical.results.map(({ chunk }) => chunk), index, item.sourceRef);
    const secondary = terms.length
      ? rankEvidenceCatalog(sections, chunks, { ...options, query: `${item.query} ${terms.join(" ")}` })
      : lexical;
    const gold = new Set(item.relevantRefs);
    const primaryRefs = lexical.results.map(({ chunk }) => chunk.ref);
    const secondaryRefs = secondary.results.map(({ chunk }) => chunk.ref);
    const rank = firstRank(gold, primaryRefs);
    const category = !gold.size ? "unanswerable_not_scored"
      : rank !== null && rank <= 5 ? "lexical_top5"
      : rank !== null ? "ranked_below_top5"
      : lexical.diagnostics.positiveChunkRefs.some((ref) => gold.has(ref))
        ? "positive_beyond_top100" : "no_positive_lexical_match";
    observedPeakRssMiB = Math.max(observedPeakRssMiB, process.memoryUsage().rss / 1024 / 1024);
    return {
      queryHash: createHash("sha256").update(item.id).digest("hex").slice(0, 16),
      category, relevantRefs: item.relevantRefs, expansionTermCount: terms.length,
      elapsedMs: performance.now() - start, primaryRefs, secondaryRefs,
    };
  });
  const answerable = rows.filter((row) => row.relevantRefs.length);
  const pools = POOL_SIZES.map((poolSize) => {
    const counts = {
      lexicalCandidateHit: 0, unionCandidateHit: 0, fusionCandidateHit: 0,
      lexicalHitAt5: 0, secondaryHitAt5: 0, fusionHitAt5: 0,
      lexicalNdcgAt10: 0, secondaryNdcgAt10: 0, fusionNdcgAt10: 0,
      secondaryRecoveryCount: 0, fusionHitGains: 0, fusionHitLosses: 0,
      meanOverlap: 0,
    };
    for (const row of answerable) {
      const primary = row.primaryRefs.slice(0, poolSize);
      const secondary = row.secondaryRefs.slice(0, poolSize);
      const fused = fuseRefs(primary, secondary, poolSize);
      const gold = new Set(row.relevantRefs);
      const union = new Set([...primary, ...secondary]);
      const hit = (refs: Iterable<string>) => Number([...refs].some((ref) => gold.has(ref)));
      counts.lexicalCandidateHit += hit(primary);
      counts.unionCandidateHit += hit(union);
      counts.fusionCandidateHit += hit(fused);
      counts.secondaryRecoveryCount += Number(!hit(primary) && !!hit(secondary));
      counts.meanOverlap += primary.filter((ref) => secondary.includes(ref)).length / Math.max(1, union.size);
      const lexicalHit = calculateRankingMetric(row.relevantRefs, primary, 5).hitRate;
      const secondaryHit = calculateRankingMetric(row.relevantRefs, secondary, 5).hitRate;
      const fusionHit = calculateRankingMetric(row.relevantRefs, fused, 5).hitRate;
      counts.lexicalHitAt5 += lexicalHit;
      counts.secondaryHitAt5 += secondaryHit;
      counts.fusionHitAt5 += fusionHit;
      counts.lexicalNdcgAt10 += calculateRankingMetric(row.relevantRefs, primary, 10).ndcg;
      counts.secondaryNdcgAt10 += calculateRankingMetric(row.relevantRefs, secondary, 10).ndcg;
      counts.fusionNdcgAt10 += calculateRankingMetric(row.relevantRefs, fused, 10).ndcg;
      counts.fusionHitGains += Number(fusionHit > lexicalHit);
      counts.fusionHitLosses += Number(fusionHit < lexicalHit);
    }
    const denominator = answerable.length || 1;
    const normalized = Object.fromEntries(Object.entries(counts).map(([key, value]) => [
      key, /Count$|Gains$|Losses$/.test(key) ? value : round(value / denominator),
    ])) as typeof counts;
    return { poolSize, ...normalized };
  });
  return {
    schemaVersion: "smartfaqs-candidate-analysis.v1",
    method: "top3_pseudo_relevance_feedback_rrf60",
    queryCount: rows.length,
    answerableQueryCount: answerable.length,
    failureCategoryCounts: Object.fromEntries([...new Set(rows.map((row) => row.category))]
      .sort().map((category) => [category, rows.filter((row) => row.category === category).length])),
    expansionAppliedCount: rows.filter((row) => row.expansionTermCount).length,
    observedPeakRssMiB: round(observedPeakRssMiB),
    passageTruncationCount: 0,
    latencyMs: {
      median: percentile(rows.map((row) => row.elapsedMs), 0.5),
      p95: percentile(rows.map((row) => row.elapsedMs), 0.95),
    },
    pools,
    queryResults: rows.map((row) => ({
      queryHash: row.queryHash, category: row.category,
      expansionTermCount: row.expansionTermCount,
      lexicalFirstRelevantRank: firstRank(new Set(row.relevantRefs), row.primaryRefs),
      secondaryFirstRelevantRank: firstRank(new Set(row.relevantRefs), row.secondaryRefs),
      fusionFirstRelevantRank: firstRank(new Set(row.relevantRefs), fuseRefs(row.primaryRefs, row.secondaryRefs, 100)),
    })),
  };
}
