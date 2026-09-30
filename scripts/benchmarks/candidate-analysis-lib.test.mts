import assert from "node:assert/strict";
import { it } from "vitest";

import type { EvidenceChunk, SourceRef } from "../../src/lib/evidence/types";
import { analyzeCandidatePaths, fuseRefs } from "./candidate-analysis-lib.mts";

const sourceA = "source:a" as SourceRef;
const sourceB = "source:b" as SourceRef;
function chunk(ref: string, sourceRef: SourceRef, content: string): EvidenceChunk {
  return {
    ref, conceptRef: ref, sourceRef, sectionRef: "section:one",
    sectionConceptRef: "section:one", sectionPath: [], label: "", section: "",
    page: null, kind: "text", content, keywords: [],
  };
}
const chunks = [
  chunk("a1", sourceA, "alpha beta bronze bridge"),
  chunk("a2", sourceA, "alpha beta bronze bridge"),
  chunk("a3", sourceA, "alpha beta bronze bridge"),
  chunk("a4", sourceA, "bronze bridge unseen"),
  chunk("b1", sourceB, "alpha beta bronze bridge"),
];

it("fixed-budget RRF is deterministic and keeps overlap ahead of single-list hits", () => {
  assert.deepEqual(fuseRefs(["a", "b"], ["b", "c"], 3), ["b", "a", "c"]);
  assert.deepEqual(fuseRefs(["a", "b"], ["b", "c"], 2), ["b", "a"]);
});

it("source-scoped feedback can recover a relevant item without a literal query match", () => {
  const report = analyzeCandidatePaths({
    sections: [], chunks,
    queries: [{ id: "one", query: "alpha beta", sourceRef: sourceA, relevantRefs: ["a4"] }],
  });
  assert.equal(report.queryCount, 1);
  assert.equal(report.failureCategoryCounts.no_positive_lexical_match, 1);
  assert.equal(report.queryResults[0].lexicalFirstRelevantRank, null);
  assert.ok(report.queryResults[0].secondaryFirstRelevantRank);
  assert.equal(report.queryResults[0].queryHash.length, 16);
  assert.equal(JSON.stringify(report).includes("bronze"), false);
  assert.equal(JSON.stringify(report).includes("source:b"), false);
});

it("cross-source gold and excluded gold are rejected", () => {
  assert.throws(() => analyzeCandidatePaths({
    sections: [], chunks,
    queries: [{ id: "one", query: "alpha beta", sourceRef: sourceA, relevantRefs: ["b1"] }],
  }), /invalid_candidate_query_scope/);
  assert.throws(() => analyzeCandidatePaths({
    sections: [], chunks,
    queries: [{
      id: "one", query: "alpha beta", sourceRef: sourceA,
      relevantRefs: ["a4"], excludedRefs: ["a4"],
    }],
  }), /invalid_candidate_query_scope/);
  const report = analyzeCandidatePaths({
    sections: [], chunks,
    queries: [{
      id: "one", query: "alpha beta", sourceRef: sourceA,
      relevantRefs: ["a4"], excludedRefs: ["not_in_this_public_corpus"],
    }],
  });
  assert.equal(report.queryCount, 1);
});

it("unanswerable cases are classified but not scored as ranking hits", () => {
  const report = analyzeCandidatePaths({
    sections: [], chunks,
    queries: [{ id: "none", query: "alpha beta", sourceRef: sourceA, relevantRefs: [] }],
  });
  assert.equal(report.answerableQueryCount, 0);
  assert.equal(report.failureCategoryCounts.unanswerable_not_scored, 1);
  assert.equal(report.pools[0].lexicalHitAt5, 0);
});
