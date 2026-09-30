import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { EvidenceChunk } from "../../src/lib/evidence/types";
import { fuseRefs, POOL_SIZES } from "./candidate-analysis-lib.mts";
import { calculateRankingMetric } from "./scifact-lib.mts";

export type SemanticQuery = {
  id: string; query: string; sourceRef: string; category: string;
  evidenceGroups: string[][]; excludedRefs?: string[];
};
const refSchema = z.string().min(1).max(256);
export const semanticGoldSchema = z.object({
  schemaVersion: z.literal("smartfaqs-semantic-gold.v1"),
  reviewStatus: z.literal("ai_source_review_not_external_human_adjudication"),
  split: z.enum(["development", "heldout"]),
  queries: z.array(z.object({
    id: z.string().min(1), query: z.string().min(2).max(25000),
    sourceRef: refSchema, category: z.enum([
      "table_numeric", "negation_exception", "multi_passage", "unanswerable_cross_source",
    ]),
    evidenceGroups: z.array(z.array(refSchema).min(1)),
    rationale: z.string().min(1), reason: z.string().optional(),
  }).strict()).min(1).max(500),
}).strict();

const count = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const elmExtractionReviewSchema = z.object({
  schemaVersion: z.literal("smartfaqs-elm-extraction-review.v1"),
  pdfSha256: hash, exportSha256: hash, doclingExportSha256: hash,
  unverifiedGoldTablePages: z.array(z.number().int().positive()),
  emptyTableItemCount: count,
  warnings: z.array(z.object({
    code: z.literal("docling_table_cells_dropped"), cellCount: count,
    mappingStatus: z.literal("not_verified"),
  }).strict()),
}).strict();
export const semanticOutputSchema = z.object({
  schemaVersion: z.literal("smartfaqs-semantic-output.v1"),
  refsByQuery: z.array(z.array(refSchema).max(100)).max(500),
  latencyMsByQuery: z.array(z.number().finite().nonnegative()),
  queryWindowCounts: z.array(count),
  startupMs: z.number().finite().nonnegative(), peakRssMiB: z.number().finite().nonnegative(),
  discardedTokenCount: z.literal(0),
  indexReceipts: z.array(z.object({
    schemaVersion: z.literal("smartfaqs-semantic-index.v1"), identity: hash,
    corpusSha256: hash, modelManifestSha256: hash, dimension: z.literal(384),
    documentCount: count, windowCount: count, inputTokenCount: count,
    multiWindowDocumentCount: count, discardedTokenCount: z.literal(0),
    buildMs: z.number().finite().nonnegative(), vectorsSha256: hash, parentsSha256: hash,
    sourceHash: z.string().regex(/^[a-f0-9]{24}$/), cacheHit: z.boolean(), cacheBytes: count,
  }).strict()).max(100),
}).strict();

export function semanticDocuments(chunks: EvidenceChunk[]) {
  return chunks.map((chunk) => ({
    ref: chunk.ref, sourceRef: chunk.sourceRef,
    text: [
      chunk.label, ...chunk.sectionPath,
      ...(chunk.table ? [chunk.table.headers.join(" | "),
        ...chunk.table.rows.map((row) => row.join(" | "))] : []),
      chunk.content,
    ].filter(Boolean).join("\n"),
  }));
}

export function validateSemanticRefs(chunks: EvidenceChunk[], queries: SemanticQuery[], refs: string[][],
  goldExcludedRefs = new Set<string>()) {
  if (refs.length !== queries.length) throw new Error("semantic_response_count_mismatch");
  const bySource = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    const set = bySource.get(chunk.sourceRef) ?? new Set<string>();
    if (set.has(chunk.ref)) throw new Error("duplicate_semantic_ref");
    set.add(chunk.ref);
    bySource.set(chunk.sourceRef, set);
  }
  if (!queries.length || queries.length > 500 || new Set(queries.map((q) => q.id)).size !== queries.length) {
    throw new Error("invalid_semantic_queries");
  }
  queries.forEach((query, i) => {
    const scope = bySource.get(query.sourceRef);
    const excluded = new Set(query.excludedRefs ?? []);
    if (!scope || query.query.length < 2 || query.query.length > 25000 ||
      query.evidenceGroups.some((g) => !g.length || new Set(g).size !== g.length ||
        g.some((ref) => !scope.has(ref) || excluded.has(ref) || goldExcludedRefs.has(ref))) ||
      ((query.category === "unanswerable_cross_source") !== (query.evidenceGroups.length === 0)) ||
      refs[i].length > 100 || new Set(refs[i]).size !== refs[i].length ||
      refs[i].some((ref) => !scope.has(ref) || excluded.has(ref))) {
      throw new Error("invalid_semantic_scope");
    }
  });
}

export function invokeSemanticWorker(python: string, script: string, input: string, timeoutMs = 3600000) {
  return new Promise<{ output?: z.infer<typeof semanticOutputSchema>; failure?: string }>((resolve) => {
    const child = spawn(python, [script, input], {
      shell: false, stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1",
        HF_HUB_DISABLE_TELEMETRY: "1", PYTHONDONTWRITEBYTECODE: "1" },
    });
    const buffers: Buffer[] = [];
    let size = 0, finished = false;
    const finish = (result: { output?: z.infer<typeof semanticOutputSchema>; failure?: string }) => {
      if (!finished) { finished = true; clearTimeout(timer); resolve(result); }
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL"); finish({ failure: "semantic_timeout" });
    }, timeoutMs);
    child.stdout.on("data", (buffer: Buffer) => {
      size += buffer.length;
      if (size > 8 * 1024 * 1024) {
        child.kill("SIGKILL"); finish({ failure: "semantic_output_limit" });
      } else buffers.push(buffer);
    });
    child.on("error", () => finish({ failure: "semantic_unavailable" }));
    child.on("close", (code) => {
      if (code !== 0) return finish({ failure: "semantic_worker_failed" });
      try {
        finish({ output: semanticOutputSchema.parse(JSON.parse(Buffer.concat(buffers).toString("utf8"))) });
      } catch { finish({ failure: "semantic_output_invalid" }); }
    });
  });
}

export const round = (value: number) => Number(value.toFixed(6));
export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0);
}
function pairedInterval(deltas: number[]) {
  let seed = 20260930;
  const samples: number[] = [];
  for (let n = 0; n < 2000; n++) {
    let sum = 0;
    for (let i = 0; i < deltas.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      sum += deltas[seed % deltas.length];
    }
    samples.push(sum / Math.max(1, deltas.length));
  }
  return [percentile(samples, 0.025), percentile(samples, 0.975)];
}

export function assessSemanticPaths(queries: SemanticQuery[], lexical: string[][], dense: string[][]) {
  if (lexical.length !== queries.length || dense.length !== queries.length) throw new Error("invalid_path_counts");
  const answerable = queries.map((query, i) => ({ query, i })).filter(({ query }) => query.evidenceGroups.length);
  const rows = POOL_SIZES.map((k) => {
    const metrics = answerable.map(({ query, i }) => {
      const l = lexical[i].slice(0, k), d = dense[i].slice(0, k), f = fuseRefs(l, d, k);
      const union = [...new Set([...l, ...d])];
      const gold = [...new Set(query.evidenceGroups.flat())];
      const metric = (refs: string[]) => ({
        hitAt5: calculateRankingMetric(gold, refs, 5).hitRate,
        hitAtK: calculateRankingMetric(gold, refs, k).hitRate,
        recallAtK: calculateRankingMetric(gold, refs, k).meanRecall,
        ndcgAt10: calculateRankingMetric(gold, refs, 10).ndcg,
        completeAt5: Number(query.evidenceGroups.every((group) => group.some((ref) => refs.slice(0, 5).includes(ref)))),
      });
      const hit = (refs: string[]) => Number(refs.some((ref) => gold.includes(ref)));
      return {
        category: query.category, lexical: metric(l), dense: metric(d), fused: metric(f),
        lexical2KHit: hit(lexical[i].slice(0, 2 * k)), unionHit: hit(union),
        newRelevant: d.filter((ref) => gold.includes(ref) && !l.includes(ref)).length,
        recoveredQuery: Number(!hit(l) && !!hit(d)),
        overlap: l.filter((ref) => d.includes(ref)).length / Math.max(1, union.length),
        queryHash: createHash("sha256").update(query.id).digest("hex").slice(0, 16),
      };
    });
    const n = Math.max(1, metrics.length);
    const aggregate = (subset: typeof metrics) => Object.fromEntries(
      (["lexical", "dense", "fused"] as const).map((key) => [key,
        Object.fromEntries(["hitAt5", "hitAtK", "recallAtK", "ndcgAt10", "completeAt5"].map((m) => [
          m, round(subset.reduce((sum, row) => sum + row[key][m as keyof typeof row.lexical], 0) / Math.max(1, subset.length)),
        ])),
      ]),
    );
    return {
      poolSize: k, ...aggregate(metrics),
      unionOpportunityHit: round(metrics.reduce((sum, row) => sum + row.unionHit, 0) / n),
      lexical2KHit: round(metrics.reduce((sum, row) => sum + row.lexical2KHit, 0) / n),
      meanJaccard: round(metrics.reduce((sum, row) => sum + row.overlap, 0) / n),
      newRelevantOccurrences: metrics.reduce((sum, row) => sum + row.newRelevant, 0),
      newlyRecoveredQueries: metrics.reduce((sum, row) => sum + row.recoveredQuery, 0),
      top5Gains: metrics.filter((row) => row.fused.hitAt5 > row.lexical.hitAt5).length,
      top5Losses: metrics.filter((row) => row.fused.hitAt5 < row.lexical.hitAt5).length,
      pairedNdcgDelta95: pairedInterval(metrics.map((row) => row.fused.ndcgAt10 - row.lexical.ndcgAt10)),
      categories: Object.fromEntries([...new Set(metrics.map((row) => row.category))].map((category) => [
        category, aggregate(metrics.filter((row) => row.category === category)),
      ])),
      queryResults: metrics,
    };
  });
  return { queryCount: queries.length, answerableQueryCount: answerable.length,
    unanswerableNotScoredCount: queries.length - answerable.length, pools: rows };
}
