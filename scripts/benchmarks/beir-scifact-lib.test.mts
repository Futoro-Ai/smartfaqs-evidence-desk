import { describe, expect, it } from "vitest";

import { buildBeirSciFactBenchmark, parseBeirQrels } from "./beir-scifact-lib.mts";
import { evaluateSciFactBenchmark } from "./scifact-lib.mts";

describe("BEIR SciFact adapter", () => {
  it("maps official document judgments into the existing ranker", () => {
    const qrels = parseBeirQrels("query-id\tcorpus-id\tscore\nq1\td1\t1\n");
    const benchmark = buildBeirSciFactBenchmark(
      [{ _id: "d1", title: "Grounded title", text: "The relevant abstract." },
        { _id: "d2", title: "Other", text: "Unrelated details." }],
      [{ _id: "q1", text: "relevant abstract" }],
      qrels,
    );
    const result = evaluateSciFactBenchmark(benchmark);
    expect(result.corpusDocumentCount).toBe(2);
    expect(result.evaluatedQueryCount).toBe(1);
    expect(result.modes.fieldedWithoutHierarchy.metrics.evidence["1"].hitRate).toBe(1);
  });

  it("rejects unknown documents and duplicate judgments", () => {
    expect(() => parseBeirQrels("query-id\tcorpus-id\tscore\nq1\td1\t1\nq1\td1\t1"))
      .toThrow("duplicate_beir_qrel");
    expect(() => buildBeirSciFactBenchmark(
      [{ _id: "d1", text: "Abstract." }],
      [{ _id: "q1", text: "question" }],
      parseBeirQrels("query-id\tcorpus-id\tscore\nq1\td2\t1"),
    )).toThrow("unsupported_beir_qrel:q1");
  });
});
