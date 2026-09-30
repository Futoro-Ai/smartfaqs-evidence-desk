import { calculateRankingMetric } from "./scifact-lib.mts";
import type { EvidenceChunk } from "../../src/lib/evidence/types";

export const RERANKER_POOL_SIZES = [20, 50, 100] as const;

export type RerankerCandidate = {
  ref: string;
  sourceRef: string;
  text: string;
};

export type RerankerQuery = {
  id: string;
  query: string;
  sourceRef: string;
  relevantRefs: string[];
  candidates: RerankerCandidate[];
};

export type RerankerMeasurements = {
  scoresByPool: number[][][];
  latencyMsByPool: number[][];
  truncatedCountByPool: number[][];
  peakMemoryMiB: number;
};

export function formatRerankerPassage(chunk: Pick<EvidenceChunk, "label" | "content" | "table">): string {
  const table = chunk.table
    ? [chunk.table.headers, ...chunk.table.rows].map((row) => row.join(" | ")).join("\n")
    : "";
  return [chunk.label, table, chunk.content].filter(Boolean).join("\n").slice(0, 2_000);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]);
}

export function validateRerankerQueries(queries: RerankerQuery[]): void {
  if (queries.length < 1 || queries.length > 500) throw new Error("invalid_reranker_query_count");
  const ids = new Set<string>();
  for (const query of queries) {
    if (!query.id || ids.has(query.id) || query.query.length < 2 || query.query.length > 500 ||
        !query.sourceRef.startsWith("source:") || query.candidates.length > 100) {
      throw new Error("invalid_reranker_query");
    }
    ids.add(query.id);
    const refs = new Set<string>();
    for (const candidate of query.candidates) {
      if (!candidate.ref || refs.has(candidate.ref) || candidate.sourceRef !== query.sourceRef ||
          candidate.text.length < 1 || candidate.text.length > 2_000) {
        throw new Error("invalid_reranker_candidate");
      }
      refs.add(candidate.ref);
    }
    if (new Set(query.relevantRefs).size !== query.relevantRefs.length) {
      throw new Error("duplicate_reranker_gold_ref");
    }
  }
}

export function evaluateRerankerPools(
  queries: RerankerQuery[],
  measurements: RerankerMeasurements | null,
  fallbackReason?: string,
) {
  validateRerankerQueries(queries);
  if (measurements) {
    if (measurements.scoresByPool.length !== queries.length ||
        measurements.latencyMsByPool.length !== queries.length ||
        measurements.truncatedCountByPool.length !== queries.length ||
        !Number.isFinite(measurements.peakMemoryMiB) || measurements.peakMemoryMiB < 0) {
      throw new Error("invalid_reranker_measurements");
    }
    measurements.scoresByPool.forEach((scoresByPool, index) => {
      if (scoresByPool.length !== RERANKER_POOL_SIZES.length ||
          scoresByPool.some((scores, poolIndex) =>
            scores.length !== Math.min(RERANKER_POOL_SIZES[poolIndex], queries[index].candidates.length) ||
            scores.some((score) => !Number.isFinite(score))) ||
          measurements.latencyMsByPool[index].length !== RERANKER_POOL_SIZES.length ||
          measurements.truncatedCountByPool[index].length !== RERANKER_POOL_SIZES.length ||
          measurements.latencyMsByPool[index].some((value) => !Number.isFinite(value) || value < 0) ||
          measurements.truncatedCountByPool[index].some((value, poolIndex) =>
            !Number.isInteger(value) || value < 0 ||
            value > Math.min(RERANKER_POOL_SIZES[poolIndex], queries[index].candidates.length))) {
        throw new Error("invalid_reranker_measurements");
      }
    });
  }

  const answerable = queries.filter((query) => query.relevantRefs.length > 0);
  const pools = RERANKER_POOL_SIZES.map((poolSize, poolIndex) => {
    let candidateHitCount = 0;
    let candidateRecallTotal = 0;
    let lexicalHitTotal = 0;
    let rerankedHitTotal = 0;
    let lexicalNdcgTotal = 0;
    let rerankedNdcgTotal = 0;
    let gains = 0;
    let losses = 0;
    const latencies: number[] = [];
    let truncatedCount = 0;

    queries.forEach((query, queryIndex) => {
      const candidates = query.candidates.slice(0, poolSize);
      if (measurements) {
        latencies.push(measurements.latencyMsByPool[queryIndex][poolIndex]);
        truncatedCount += measurements.truncatedCountByPool[queryIndex][poolIndex];
      }
      if (query.relevantRefs.length === 0) return;
      const expected = new Set(query.relevantRefs);
      const relevantInPool = candidates.filter((candidate) => expected.has(candidate.ref)).length;
      if (relevantInPool > 0) candidateHitCount += 1;
      candidateRecallTotal += relevantInPool / expected.size;
      const lexicalRefs = candidates.map((candidate) => candidate.ref);
      const rerankedRefs = measurements
        ? candidates.map((candidate, index) => ({ candidate, index }))
          .sort((left, right) =>
            measurements.scoresByPool[queryIndex][poolIndex][right.index] -
            measurements.scoresByPool[queryIndex][poolIndex][left.index] ||
            left.index - right.index)
          .map(({ candidate }) => candidate.ref)
        : lexicalRefs;
      const lexicalHit = calculateRankingMetric(query.relevantRefs, lexicalRefs, 5).hitRate;
      const rerankedHit = calculateRankingMetric(query.relevantRefs, rerankedRefs, 5).hitRate;
      lexicalHitTotal += lexicalHit;
      rerankedHitTotal += rerankedHit;
      lexicalNdcgTotal += calculateRankingMetric(query.relevantRefs, lexicalRefs, 10).ndcg;
      rerankedNdcgTotal += calculateRankingMetric(query.relevantRefs, rerankedRefs, 10).ndcg;
      if (rerankedHit > lexicalHit) gains += 1;
      if (rerankedHit < lexicalHit) losses += 1;
    });

    const denominator = answerable.length || 1;
    return {
      poolSize,
      candidateHitRate: round(candidateHitCount / denominator),
      candidateMeanRecall: round(candidateRecallTotal / denominator),
      lexicalHitAt5: round(lexicalHitTotal / denominator),
      rerankedHitAt5: round(rerankedHitTotal / denominator),
      lexicalNdcgAt10: round(lexicalNdcgTotal / denominator),
      rerankedNdcgAt10: round(rerankedNdcgTotal / denominator),
      hitAt5Gains: gains,
      hitAt5Losses: losses,
      latencyMs: measurements ? { median: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) } : null,
      truncatedPairCount: measurements ? truncatedCount : null,
    };
  });

  return {
    schemaVersion: "smartfaqs-reranker-experiment.v1",
    status: measurements ? "reranked" : "lexical_fallback",
    fallbackReason: measurements ? null : fallbackReason ?? "model_not_requested",
    queryCount: queries.length,
    answerableQueryCount: answerable.length,
    unanswerableQueryCount: queries.length - answerable.length,
    peakMemoryMiB: measurements ? round(measurements.peakMemoryMiB) : null,
    pools,
  };
}
