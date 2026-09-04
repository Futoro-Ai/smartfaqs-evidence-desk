import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSciFactBenchmark,
  calculateRankingMetric,
  evaluateSciFactBenchmark,
} from "./scifact-lib.mts";
import { writeSciFactIcmWorkspace } from "./scifact-workspace.mts";

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

  it("compares body-only, fielded, and hierarchy-aware BM25 retrieval", () => {
    const result = evaluateSciFactBenchmark(
      buildSciFactBenchmark(corpus, claims),
    );

    expect(
      result.modes.lexicalBodyOnly.metrics.evidence["1"].hitRate,
    ).toBe(0);
    expect(
      result.modes.fieldedWithoutHierarchy.metrics.evidence["3"].hitRate,
    ).toBe(1);
    expect(
      result.modes.fieldedWithHierarchy.metrics.evidence["3"].hitRate,
    ).toBe(1);
    expect(
      result.modes.fieldedWithHierarchy.metrics.sectionNavigation["1"]
        .hitRate,
    ).toBe(1);
    expect(
      result.modes.fieldedWithHierarchy.diagnostics.failureCategoryCounts
        .success_within_visible_limit,
    ).toBe(1);
    expect(result.complementarity).toMatchObject({
      bothHit: 1,
      unionHitRate: 1,
      meanSharedResultCount: 2,
      identicalTopFiveCount: 1,
    });
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

  it("writes sanitized ICM stage artifacts without benchmark text", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "evidence-desk-scifact-"));
    const evaluation = evaluateSciFactBenchmark(
      buildSciFactBenchmark(corpus, claims),
    );

    try {
      await writeSciFactIcmWorkspace(directory, {
        ...evaluation,
        generatedAt: "2026-09-04T00:00:00.000Z",
        durationMs: 10,
        inputFingerprints: { corpusSha256: "a", claimsDevSha256: "b" },
      });
      const paths = [
        "index.md",
        "00-contract/contract.json",
        "30-retrieve/queries.jsonl",
        "40-rank/queries.jsonl",
        "50-verify/queries.jsonl",
        "80-export/report.json",
      ];
      const output = (
        await Promise.all(
          paths.map((relativePath) =>
            readFile(path.join(directory, relativePath), "utf8"),
          ),
        )
      ).join("\n");

      expect(output).toContain("success_within_visible_limit");
      expect(output).toContain('"queryId":"10"');
      expect(output).not.toContain("104 hours");
      expect(output).not.toContain("Benefits overview");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
