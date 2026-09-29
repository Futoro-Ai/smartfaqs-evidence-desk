import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  evidenceChunks,
  knowledgeSections,
} from "../../src/data/evidenceCatalog.ts";
import {
  evaluateOkfRetrieval,
  loadOkfRetrievalGold,
} from "./okf-retrieval-lib.mts";

const gold = {
  schemaVersion: "smartfaqs-okf-retrieval-gold.v1" as const,
  sourceRef: "source:employee-handbook",
  queries: [
    {
      id: "annual-leave-table",
      query: "How much annual leave applies after five years?",
      relevantChunkRefs: ["chunk:leave-accrual-table"],
      relevantSectionRefs: ["section:employee-handbook-annual-leave"],
    },
  ],
};

describe("local OKF retrieval benchmark", () => {
  it("evaluates nested evidence without serializing queries or evidence refs", () => {
    const report = evaluateOkfRetrieval(knowledgeSections, evidenceChunks, gold);

    expect(report.modes.fieldedWithHierarchy.metrics).toMatchObject({
      evidenceHitAt5: 1,
      sectionHitAt3: 1,
    });
    expect(report.evaluatedQueryCount).toBe(1);
    expect(report.complementarity.meanSharedResultCount).toBeGreaterThan(0);
    expect(report.complementarity.meanJaccard).toBe(1);
    expect(JSON.stringify(report)).not.toContain("How much annual leave");
    expect(JSON.stringify(report)).not.toContain("chunk:leave-accrual-table");
  });

  it("rejects gold references outside the selected source", () => {
    expect(() =>
      evaluateOkfRetrieval(knowledgeSections, evidenceChunks, {
        ...gold,
        queries: [
          {
            ...gold.queries[0],
            relevantChunkRefs: ["chunk:medical-plan"],
          },
        ],
      }),
    ).toThrow("okf_gold_chunk_outside_source:annual-leave-table");
  });

  it("strictly validates local gold files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "okf-gold-"));
    const filePath = path.join(directory, "gold.json");
    try {
      await writeFile(
        filePath,
        JSON.stringify({ ...gold, arbitraryCommand: "run" }),
      );
      await expect(loadOkfRetrievalGold(filePath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
