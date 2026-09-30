import { expect, it } from "vitest";
import type { EvidenceChunk } from "../../src/lib/evidence/types";
import {
  assessSemanticPaths, invokeSemanticWorker, semanticDocuments, validateSemanticRefs,
  type SemanticQuery,
} from "./semantic-candidates-lib.mts";

const chunks: EvidenceChunk[] = [
  { ref: "a", sourceRef: "source:employee-handbook", label: "Entitlement", sectionPath: ["Leave"],
    table: { headers: ["Service", "Hours"], rows: [["5-9", "104 hours"]] }, content: "13 days", kind: "table" },
  { ref: "b", sourceRef: "source:employee-handbook", sectionPath: [], content: "prorated", kind: "text" },
  { ref: "foreign", sourceRef: "source:benefits-guide", sectionPath: [], content: "104 hours", kind: "text" },
] as EvidenceChunk[];
const q: SemanticQuery = {
  id: "q1", query: "What applies?", sourceRef: "source:employee-handbook",
  category: "multi_passage", evidenceGroups: [["a"], ["b"]],
};

it("preserves table headers, rows, units, and ancestry without character truncation", () => {
  const [doc] = semanticDocuments(chunks);
  expect(doc.text).toContain("Service | Hours");
  expect(doc.text).toContain("5-9 | 104 hours");
  expect(doc.text).toContain("Leave");
  expect(semanticDocuments([{ ...chunks[1], content: "x".repeat(3000) }])[0].text.length).toBe(3000);
});
it("rejects out-of-source gold, foreign results, duplicates and excluded refs", () => {
  expect(() => validateSemanticRefs(chunks, [q], [["a", "b"]])).not.toThrow();
  for (const refs of [["foreign"], ["a", "a"]]) {
    expect(() => validateSemanticRefs(chunks, [q], [refs])).toThrow("invalid_semantic_scope");
  }
  expect(() => validateSemanticRefs(chunks, [{ ...q, excludedRefs: ["a"] }], [["b"]])).toThrow();
  expect(() => validateSemanticRefs(chunks, [{ ...q, evidenceGroups: [["foreign"]] }], [[]])).toThrow();
});
it("semantic-only hits are novel; multiple evidence groups require complete coverage", () => {
  const r = assessSemanticPaths([q], [["a"]], [["b", "a"]]);
  expect(r.pools[0].newRelevantOccurrences).toBe(1);
  const p = r.pools[0] as unknown as {lexical:{completeAt5:number};fused:{completeAt5:number}};
  expect(p.lexical.completeAt5).toBe(0);
  expect(p.fused.completeAt5).toBe(1);
});
it("keeps unanswerable cases out of positive retrieval denominators", () => {
  const r = assessSemanticPaths([{ ...q, evidenceGroups: [], category: "unanswerable_cross_source" }], [["a"]], [["b"]]);
  expect(r.answerableQueryCount).toBe(0);
  expect(r.unanswerableNotScoredCount).toBe(1);
});
it("rejects result-count mismatches and empty alternative groups", () => {
  expect(() => validateSemanticRefs(chunks, [q], [])).toThrow("semantic_response_count_mismatch");
  expect(() => validateSemanticRefs(chunks, [{ ...q, evidenceGroups: [[]] }], [[]])).toThrow();
});
it("excludes unverified extracted evidence from gold without changing retrieval scope", () => {
  expect(() => validateSemanticRefs(chunks, [q], [[]], new Set(["a"]))).toThrow("invalid_semantic_scope");
  expect(() => validateSemanticRefs(chunks, [{ ...q, evidenceGroups: [["b"]] }], [["a"]], new Set(["a"])))
    .not.toThrow();
});
it("missing interpreter fails safely with no raw exception serialization", async () => {
  expect(await invokeSemanticWorker("/nonexistent/evidence-desk-python", "unused", "unused", 1000))
    .toEqual({ failure: "semantic_unavailable" });
});
it("malformed worker output fails closed", async () => {
  expect(await invokeSemanticWorker(process.execPath, "-e", 'process.stdout.write("private text")', 1000))
    .toEqual({ failure: "semantic_output_invalid" });
});
it("kills stalled workers at the deadline", async () => {
  expect(await invokeSemanticWorker(process.execPath, "-e", "setInterval(()=>{},1000)", 40))
    .toEqual({ failure: "semantic_timeout" });
});
it("kills workers that exceed the output limit", async () => {
  expect(await invokeSemanticWorker(process.execPath, "-e", 'process.stdout.write("x".repeat(9*1024*1024))', 1000))
    .toEqual({ failure: "semantic_output_limit" });
});
it("lexical fallback retains identical candidates and reports no fabricated recovery", () => {
  const r = assessSemanticPaths([q], [["a", "b"]], [["a", "b"]]);
  expect(r.pools.every((p) => p.newlyRecoveredQueries === 0 && p.top5Losses === 0 && p.meanJaccard === 1)).toBe(true);
});
