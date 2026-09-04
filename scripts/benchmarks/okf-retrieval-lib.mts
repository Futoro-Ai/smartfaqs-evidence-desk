import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  buildEvidenceSearchIndex,
  rankEvidenceCatalog,
  type EvidenceSearchIndex,
} from "../../src/lib/evidence/ranking.ts";
import type {
  EvidenceChunk,
  KnowledgeSection,
  SourceRef,
} from "../../src/lib/evidence/types";
import { calculateRankingMetric } from "./scifact-lib.mts";

const MAX_GOLD_BYTES = 1024 * 1024;

const querySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    query: z.string().trim().min(2).max(500),
    relevantChunkRefs: z.array(z.string().min(1).max(200)).min(1).max(20),
    relevantSectionRefs: z.array(z.string().min(1).max(200)).min(1).max(20),
  })
  .strict();

const goldSchema = z
  .object({
    schemaVersion: z.literal("smartfaqs-okf-retrieval-gold.v1"),
    sourceRef: z.string().regex(/^source:[a-z0-9][a-z0-9-]*$/),
    queries: z.array(querySchema).min(1).max(500),
  })
  .strict();

export type OkfRetrievalGold = z.infer<typeof goldSchema>;

function round(value: number): number {
  return Number(value.toFixed(6));
}

export async function loadOkfRetrievalGold(
  filePath: string,
): Promise<OkfRetrievalGold> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new Error("okf_gold_not_file");
  if (fileStats.size > MAX_GOLD_BYTES) throw new Error("okf_gold_too_large");
  return goldSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}

function validateGold(
  sections: KnowledgeSection[],
  chunks: EvidenceChunk[],
  gold: OkfRetrievalGold,
) {
  const queryIds = new Set<string>();
  const sectionRefs = new Set(
    sections
      .filter(({ sourceRef }) => sourceRef === gold.sourceRef)
      .map(({ ref }) => ref),
  );
  const chunkRefs = new Set(
    chunks
      .filter(({ sourceRef }) => sourceRef === gold.sourceRef)
      .map(({ ref }) => ref),
  );
  if (sectionRefs.size === 0 || chunkRefs.size === 0) {
    throw new Error("okf_gold_source_not_found");
  }
  for (const query of gold.queries) {
    if (queryIds.has(query.id)) throw new Error(`duplicate_okf_query:${query.id}`);
    queryIds.add(query.id);
    if (query.relevantChunkRefs.some((ref) => !chunkRefs.has(ref))) {
      throw new Error(`okf_gold_chunk_outside_source:${query.id}`);
    }
    if (query.relevantSectionRefs.some((ref) => !sectionRefs.has(ref))) {
      throw new Error(`okf_gold_section_outside_source:${query.id}`);
    }
  }
}

function evaluateMode(
  sections: KnowledgeSection[],
  chunks: EvidenceChunk[],
  gold: OkfRetrievalGold,
  structuralBoost: boolean,
  searchIndex: EvidenceSearchIndex,
) {
  const topFiveByQuery = new Map<string, string[]>();
  const queryResults = gold.queries.map((query) => {
    const ranked = rankEvidenceCatalog(sections, chunks, {
      sourceRef: gold.sourceRef as SourceRef,
      query: query.query,
      resultLimit: 5,
      sectionLimit: 3,
      structuralBoost,
      searchIndex,
    });
    const evidenceRefs = ranked.results.map(({ chunk }) => chunk.ref);
    const sectionRefs = ranked.matchedSections.map(({ section }) => section.ref);
    const evidence = calculateRankingMetric(query.relevantChunkRefs, evidenceRefs, 5);
    const navigation = calculateRankingMetric(
      query.relevantSectionRefs,
      sectionRefs,
      3,
    );
    topFiveByQuery.set(query.id, evidenceRefs);
    return {
      queryId: query.id,
      retrievedEvidenceCount: evidenceRefs.length,
      retrievedSectionCount: sectionRefs.length,
      evidence,
      navigation,
      structuralRoutingUsed: ranked.diagnostics.structuralRoutingUsed,
    };
  });

  return {
    report: {
      structuralBoost,
      metrics: {
        evidenceHitAt5: round(
          queryResults.reduce((total, result) => total + result.evidence.hitRate, 0) /
            queryResults.length,
        ),
        evidenceMeanRecallAt5: round(
          queryResults.reduce((total, result) => total + result.evidence.meanRecall, 0) /
            queryResults.length,
        ),
        evidenceMrrAt5: round(
          queryResults.reduce((total, result) => total + result.evidence.mrr, 0) /
            queryResults.length,
        ),
        sectionHitAt3: round(
          queryResults.reduce((total, result) => total + result.navigation.hitRate, 0) /
            queryResults.length,
        ),
      },
      structuralRoutingQueryCount: queryResults.filter(
        ({ structuralRoutingUsed }) => structuralRoutingUsed,
      ).length,
      queryResults,
    },
    topFiveByQuery,
  };
}

export function evaluateOkfRetrieval(
  sections: KnowledgeSection[],
  chunks: EvidenceChunk[],
  gold: OkfRetrievalGold,
) {
  validateGold(sections, chunks, gold);
  const searchIndex = buildEvidenceSearchIndex(sections, chunks);
  const withoutHierarchy = evaluateMode(
    sections,
    chunks,
    gold,
    false,
    searchIndex,
  );
  const withHierarchy = evaluateMode(
    sections,
    chunks,
    gold,
    true,
    searchIndex,
  );
  let sameTopFiveCount = 0;
  let hierarchyOnlyHitCount = 0;
  let noHierarchyOnlyHitCount = 0;
  let sharedResultTotal = 0;
  let jaccardTotal = 0;

  for (const query of gold.queries) {
    const relevant = new Set(query.relevantChunkRefs);
    const withoutRefs = withoutHierarchy.topFiveByQuery.get(query.id) ?? [];
    const withRefs = withHierarchy.topFiveByQuery.get(query.id) ?? [];
    const withoutHit = withoutRefs.some((ref) => relevant.has(ref));
    const withHit = withRefs.some((ref) => relevant.has(ref));
    const withoutSet = new Set(withoutRefs);
    const withSet = new Set(withRefs);
    const sharedCount = [...withoutSet].filter((ref) => withSet.has(ref)).length;
    const unionCount = new Set([...withoutSet, ...withSet]).size;
    sharedResultTotal += sharedCount;
    jaccardTotal += unionCount === 0 ? 1 : sharedCount / unionCount;
    if (withHit && !withoutHit) hierarchyOnlyHitCount += 1;
    if (withoutHit && !withHit) noHierarchyOnlyHitCount += 1;
    if (JSON.stringify(withoutRefs) === JSON.stringify(withRefs)) {
      sameTopFiveCount += 1;
    }
  }

  return {
    schemaVersion: "smartfaqs-okf-retrieval-report.v1",
    sourceScope: gold.sourceRef,
    evaluatedQueryCount: gold.queries.length,
    modes: {
      fieldedWithoutHierarchy: withoutHierarchy.report,
      fieldedWithHierarchy: withHierarchy.report,
    },
    complementarity: {
      sameTopFiveCount,
      hierarchyOnlyHitCount,
      noHierarchyOnlyHitCount,
      meanSharedResultCount: round(sharedResultTotal / gold.queries.length),
      meanJaccard: round(jaccardTotal / gold.queries.length),
    },
  };
}
