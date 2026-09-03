import { describe, expect, it } from "vitest";

import {
  buildSciFactBenchmark,
  calculateRankingMetric,
  evaluateSciFactBenchmark,
} from "./scifact-lib.mts";

const corpus = [
  {
    doc_id: 2,
    title: "Benefits overview",
    abstract: ["Annual leave is described here."],
  },
  {
    doc_id: 1,
    title: "Annual Leave Entitlement",
    abstract: ["Employees receive 104 hours after five years."],
  },
];

const claims = [
  {
    id: 10,
    claim: "annual leave",
    evidence: {
      "1": [{ label: "SUPPORT" as const, sentences: [0] }],
    },
  },
];

describe("SciFact benchmark adapter", () => {
  it("maps papers to heading sections and rationale sentences to evidence", () => {
    const benchmark = buildSciFactBenchmark(corpus, claims);

    expect(benchmark).toMatchObject({
      corpusDocumentCount: 2,
      sections: [
        { ref: "section:scifact-2", structuralOrigin: "explicit_heading" },
        { ref: "section:scifact-1", structuralOrigin: "explicit_heading" },
      ],
      queries: [
        {
          id: "10",
          relevantChunkRefs: ["chunk:scifact-1-sentence-0"],
          relevantSectionRefs: ["section:scifact-1"],
        },
      ],
    });
    expect(benchmark.chunks).toHaveLength(2);
  });

  it("measures the production ancestry boost against a no-ancestry ablation", () => {
    const result = evaluateSciFactBenchmark(
      buildSciFactBenchmark(corpus, claims),
    );

    expect(
      result.modes.productionWithAncestry.metrics.evidence["1"].hitRate,
    ).toBe(1);
    expect(
      result.modes.ablationWithoutAncestry.metrics.evidence["1"].hitRate,
    ).toBe(0);
    expect(
      result.modes.productionWithAncestry.metrics.sectionNavigation["1"]
        .hitRate,
    ).toBe(1);
    expect(JSON.stringify(result)).not.toContain("104 hours");
    expect(JSON.stringify(result)).not.toContain("Benefits overview");
  });

  it("computes bounded binary ranking metrics", () => {
    expect(
      calculateRankingMetric(["a", "c"], ["x", "a", "b", "c"], 3),
    ).toEqual({
      hitRate: 1,
      meanRecall: 0.5,
      mrr: 0.5,
      ndcg: 1 / Math.log2(3) / (1 + 1 / Math.log2(3)),
    });
  });

  it("fails closed when a rationale points outside its abstract", () => {
    expect(() =>
      buildSciFactBenchmark(corpus, [
        {
          id: 11,
          claim: "invalid rationale",
          evidence: {
            "1": [{ label: "SUPPORT", sentences: [99] }],
          },
        },
      ]),
    ).toThrow("invalid_scifact_sentence:1:99");
  });

  it("rejects an empty query selection", () => {
    expect(() =>
      evaluateSciFactBenchmark(buildSciFactBenchmark(corpus, claims), 0),
    ).toThrow("invalid_query_limit");
  });
});
