import { describe, expect, it } from "vitest";

import {
  evaluateRerankerPools,
  formatRerankerPassage,
  type RerankerQuery,
} from "./reranker-lib.mts";

const queries: RerankerQuery[] = [{
  id: "q1",
  query: "How much leave is earned?",
  sourceRef: "source:handbook",
  relevantRefs: ["chunk:gold"],
  candidates: Array.from({ length: 21 }, (_, index) => ({
    ref: index === 20 ? "chunk:gold" : `chunk:other-${index}`,
    sourceRef: "source:handbook",
    text: `Evidence ${index}`,
  })),
}];

describe("reranker pool evaluation", () => {
  it("separates first-stage misses from reranking gains", () => {
    const scores = queries[0].candidates.map((_, index) => index === 20 ? 10 : 0);
    const report = evaluateRerankerPools(queries, {
      scoresByPool: [[scores.slice(0, 20), scores, scores]],
      latencyMsByPool: [[4, 8, 12]],
      truncatedCountByPool: [[0, 1, 1]],
      peakMemoryMiB: 120,
    });
    expect(report.pools[0]).toMatchObject({
      candidateHitRate: 0,
      rerankedHitAt5: 0,
      hitAt5Gains: 0,
    });
    expect(report.pools[1]).toMatchObject({
      candidateHitRate: 1,
      lexicalHitAt5: 0,
      rerankedHitAt5: 1,
      hitAt5Gains: 1,
      truncatedPairCount: 1,
    });
  });

  it("reports lexical fallback without claiming a reranker gain", () => {
    const report = evaluateRerankerPools(queries, null, "model_timeout");
    expect(report.status).toBe("lexical_fallback");
    expect(report.fallbackReason).toBe("model_timeout");
    expect(report.pools[1].rerankedHitAt5).toBe(report.pools[1].lexicalHitAt5);
    expect(report.pools[1].latencyMs).toBeNull();
  });

  it("rejects cross-source candidates and invalid model outputs", () => {
    expect(() => evaluateRerankerPools([{ ...queries[0], candidates: [{
      ref: "chunk:other", sourceRef: "source:elsewhere", text: "Wrong source",
    }] }], null)).toThrow("invalid_reranker_candidate");
    expect(() => evaluateRerankerPools(queries, {
      scoresByPool: [[Array(20).fill(Number.NaN), Array(21).fill(0), Array(21).fill(0)]],
      latencyMsByPool: [[1, 2, 3]],
      truncatedCountByPool: [[0, 0, 0]],
      peakMemoryMiB: 1,
    })).toThrow("invalid_reranker_measurements");
  });

  it("keeps unanswerable queries separate from retrieval hit metrics", () => {
    const report = evaluateRerankerPools([...queries, {
      ...queries[0], id: "q2", relevantRefs: [], candidates: [],
    }], null);
    expect(report.answerableQueryCount).toBe(1);
    expect(report.unanswerableQueryCount).toBe(1);
    expect(report.pools[1].candidateHitRate).toBe(1);
  });

  it("includes structured table values in the bounded model passage", () => {
    const passage = formatRerankerPassage({
      label: "Annual leave schedule",
      content: "Full-time leave by service.",
      table: { headers: ["Service", "Annual hours"], rows: [["5-9 years", "104 hours"]] },
    });
    expect(passage).toContain("5-9 years | 104 hours");
    expect(passage.length).toBeLessThanOrEqual(2_000);
  });

  it("uses each pool's own scores instead of reusing a larger pool", () => {
    const relevantRefs = ["chunk:other-0"];
    const scores20 = Array(20).fill(0);
    scores20[0] = 10;
    const scores50 = Array(21).fill(0);
    scores50[0] = -10;
    const report = evaluateRerankerPools([{ ...queries[0], relevantRefs }], {
      scoresByPool: [[scores20, scores50, scores50]],
      latencyMsByPool: [[4, 8, 12]],
      truncatedCountByPool: [[0, 0, 0]],
      peakMemoryMiB: 120,
    });
    expect(report.pools[0].rerankedHitAt5).toBe(1);
    expect(report.pools[1].rerankedHitAt5).toBe(0);
  });
});
