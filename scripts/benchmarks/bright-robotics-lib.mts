import { z } from "zod";

import {
  BM25F_BODY_ONLY_WEIGHTS,
  buildEvidenceSearchIndex,
  rankEvidenceCatalog,
} from "../../src/lib/evidence/ranking.ts";
import type { EvidenceChunk, SourceRef } from "../../src/lib/evidence/types";
import { readBeirJsonl } from "./beir-scifact-lib.mts";
import { calculateRankingMetric } from "./scifact-lib.mts";

const SOURCE_REF = "source:bright-robotics" as SourceRef;
const documentSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
}).strict();
const exampleSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  excluded_ids: z.array(z.string()),
  gold_ids: z.array(z.string()).min(1),
}).strict();

export type BrightDocument = z.infer<typeof documentSchema>;
export type BrightExample = z.infer<typeof exampleSchema>;

export async function loadBrightRobotics(dataDirectory: string) {
  const [documents, examples] = await Promise.all([
    readBeirJsonl(`${dataDirectory}/documents.jsonl`, documentSchema),
    readBeirJsonl(`${dataDirectory}/examples.jsonl`, exampleSchema),
  ]);
  return { documents, examples };
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export function evaluateBrightRobotics(
  documents: BrightDocument[],
  examples: BrightExample[],
) {
  const ids = new Set(documents.map(({ id }) => id));
  if (ids.size !== documents.length) throw new Error("duplicate_bright_document");
  if (new Set(examples.map(({ id }) => id)).size !== examples.length || examples.length === 0) {
    throw new Error("invalid_bright_examples");
  }
  const chunks: EvidenceChunk[] = documents.map(({ id, content }) => ({
    ref: id,
    conceptRef: `bright@${id}`,
    sourceRef: SOURCE_REF,
    sectionRef: "section:bright-robotics",
    sectionConceptRef: "bright@robotics",
    sectionPath: [],
    label: "",
    section: "",
    page: null,
    kind: "text",
    content,
    keywords: [],
  }));
  const index = buildEvidenceSearchIndex([], chunks);

  function evaluateBodyOnly() {
    const results = examples.map((example) => {
      const gold = new Set(example.gold_ids);
      const excluded = new Set(example.excluded_ids);
      if (gold.size !== example.gold_ids.length || [...gold].some((id) => !ids.has(id) || excluded.has(id))) {
        throw new Error(`invalid_bright_gold:${example.id}`);
      }
      const ranked = rankEvidenceCatalog([], chunks, {
        sourceRef: SOURCE_REF,
        query: example.query,
        resultLimit: 1000,
        candidateLimit: 2000,
        sectionLimit: 1,
        structuralBoost: false,
        fieldWeights: BM25F_BODY_ONLY_WEIGHTS,
        searchIndex: index,
        excludedChunkRefs: excluded,
      });
      const rankedIds = ranked.results.map(({ chunk }) => chunk.ref);
      return {
        queryId: example.id,
        ndcgAt10: calculateRankingMetric(example.gold_ids, rankedIds, 10).ndcg,
        recallAt100: calculateRankingMetric(example.gold_ids, rankedIds, 100).meanRecall,
        firstRelevantRank: rankedIds.findIndex((id) => gold.has(id)) + 1 || null,
        candidateCount: ranked.diagnostics.candidatePoolCount,
      };
    });
    return {
      ndcgAt10: round(results.reduce((sum, row) => sum + row.ndcgAt10, 0) / results.length),
      recallAt100: round(results.reduce((sum, row) => sum + row.recallAt100, 0) / results.length),
      queryResults: results,
    };
  }

  return {
    documentCount: documents.length,
    queryCount: examples.length,
    bodyOnly: evaluateBodyOnly(),
  };
}
