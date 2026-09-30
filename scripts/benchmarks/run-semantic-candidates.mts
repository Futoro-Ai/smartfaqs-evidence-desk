#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BM25F_BODY_ONLY_WEIGHTS, buildEvidenceSearchIndex, rankEvidenceCatalog } from "../../src/lib/evidence/ranking.ts";
import type { EvidenceChunk, KnowledgeSection, SourceRef } from "../../src/lib/evidence/types";
import { loadBrightRobotics } from "./bright-robotics-lib.mts";
import { sha256File } from "./scifact-lib.mts";
import { compileOkfCatalog } from "../okf/lib.mjs";
import {
  assessSemanticPaths, elmExtractionReviewSchema, invokeSemanticWorker, percentile, round, semanticDocuments,
  semanticGoldSchema, validateSemanticRefs, type SemanticQuery,
} from "./semantic-candidates-lib.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = path.join(root, ".local/benchmarks/semantic");

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--dataset" ||
    !["bright-robotics", "elm-development", "elm-heldout", "northstar-regression"].includes(args[1])) {
    throw new Error("usage: --dataset bright-robotics|elm-development|elm-heldout|northstar-regression");
  }
  const dataset = args[1];
  let chunks: EvidenceChunk[], sections: KnowledgeSection[], queries: SemanticQuery[];
  const fingerprints: Record<string, string> = {};
  let extractionProvenance: Record<string, unknown> | undefined;
  if (dataset === "bright-robotics") {
    const directory = path.join(root, ".local/benchmarks/bright-robotics");
    const receiptPath = path.join(directory, "download-receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (receipt.dataset !== "xlangai/BRIGHT" || receipt.split !== "robotics" ||
        receipt.revision !== "3066d29c9651a576c8aba4832d249807b181ecae") {
      throw new Error("bright_receipt_identity_mismatch");
    }
    for (const name of ["documents", "examples"]) {
      const actual = await sha256File(path.join(directory, "data", name + ".jsonl"));
      if (actual !== receipt.jsonlSha256?.[name]) throw new Error("bright_receipt_hash_mismatch");
      fingerprints[name + "Sha256"] = actual;
    }
    const { documents, examples } = await loadBrightRobotics(path.join(directory, "data"));
    sections = [];
    chunks = documents.map(({ id, content }) => ({
      ref: id, conceptRef: `bright@${id}`, sourceRef: "source:bright-robotics" as SourceRef,
      sectionRef: "section:bright-robotics", sectionConceptRef: "bright@robotics",
      sectionPath: [], label: "", section: "", page: null, kind: "text", content, keywords: [],
    }));
    queries = examples.map(({ id, query, gold_ids, excluded_ids }) => ({
      id, query, sourceRef: "source:bright-robotics", category: "bright",
      evidenceGroups: [gold_ids], excludedRefs: excluded_ids,
    }));
  } else if (dataset.startsWith("elm-")) {
    const bundlePath = path.join(root, ".local/okf/elmc5-full");
    const catalog = await compileOkfCatalog(bundlePath, { publicOnly: false });
    chunks = catalog.chunks; sections = catalog.sections;
    fingerprints.catalogSha256 = createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
    const goldPath = path.join(base, "gold", dataset + ".v1.json");
    const gold = semanticGoldSchema.parse(JSON.parse(await readFile(goldPath, "utf8")));
    if (`elm-${gold.split}` !== dataset) throw new Error("invalid_semantic_gold_split");
    queries = gold.queries;
    const categories = ["table_numeric", "negation_exception", "multi_passage", "unanswerable_cross_source"];
    if (queries.length !== 24 || categories.some((c) => queries.filter((q) => q.category === c).length !== 6)) {
      throw new Error("invalid_semantic_gold_balance");
    }
    const reviewPath = path.join(base, "elm/extraction-review.v1.json");
    const review = elmExtractionReviewSchema.parse(JSON.parse(await readFile(reviewPath, "utf8")));
    for (const [file, expected] of [
      ["elmc5.pdf", review.pdfSha256], ["elmc5.jsonl", review.exportSha256],
      ["elmc5.docling.json", review.doclingExportSha256],
    ]) {
      if (await sha256File(path.join(base, "elm", file)) !== expected) throw new Error("elm_extraction_hash_mismatch");
    }
    const blockedGold = new Set(chunks.filter((c) =>
      c.kind === "table" && c.page !== null && review.unverifiedGoldTablePages.includes(c.page)).map((c) => c.ref));
    validateSemanticRefs(chunks, queries, queries.map(() => []), blockedGold);
    extractionProvenance = { ...review, goldExcludedTableCount: blockedGold.size,
      catalogTableCount: chunks.filter((c) => c.kind === "table").length };
    fingerprints.extractionReviewSha256 = await sha256File(reviewPath);
    fingerprints.goldSha256 = await sha256File(goldPath);
  } else {
    const catalogPath = path.join(root, "src/data/okfCatalog.generated.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    if (catalog.schemaVersion !== "smartfaqs-okf-catalog.v1") throw new Error("invalid_semantic_catalog");
    chunks = catalog.chunks; sections = catalog.sections;
    fingerprints.catalogSha256 = await sha256File(catalogPath);
    const goldPath = path.join(root, "scripts/benchmarks", "northstar-independent-gold.v1.json");
    {
      const gold = JSON.parse(await readFile(goldPath, "utf8"));
      queries = gold.queries.map((q: {id:string;query:string;sourceRef:string;category:string;relevantChunkRefs:string[]}) => ({
        id: q.id, query: q.query, sourceRef: q.sourceRef,
        category: q.relevantChunkRefs.length ? q.category : "unanswerable_cross_source",
        evidenceGroups: q.relevantChunkRefs.map((ref) => [ref]),
      }));
    }
    fingerprints.goldSha256 = await sha256File(goldPath);
  }
  // Validate source and gold independently of semantic availability.
  validateSemanticRefs(chunks, queries, queries.map(() => []));
  const indexStart = performance.now();
  const index = buildEvidenceSearchIndex(sections, chunks);
  const lexicalIndexMs = performance.now() - indexStart;
  const lexicalLatencies: number[] = [];
  const lexical = queries.map((query) => {
    const started = performance.now();
    const result = rankEvidenceCatalog(sections, chunks, {
      sourceRef: query.sourceRef as SourceRef, query: query.query, searchIndex: index,
      resultLimit: 200, candidateLimit: 2000, excludedChunkRefs: new Set(query.excludedRefs ?? []),
      ...(dataset === "bright-robotics" ? { structuralBoost: false, fieldWeights: BM25F_BODY_ONLY_WEIGHTS } : {}),
    });
    lexicalLatencies.push(performance.now() - started);
    return result.results.map(({ chunk }) => chunk.ref);
  });
  await mkdir(base, { recursive: true });
  const inputPath = path.join(base, dataset + "-input.json");
  const input = JSON.stringify({
    schemaVersion: "smartfaqs-semantic-input.v1", documents: semanticDocuments(chunks),
    queries: queries.map((query) => ({
      sourceRef: query.sourceRef, text: query.query, excludedRefs: query.excludedRefs ?? [],
    })),
  });
  if (Buffer.byteLength(input) > 64 * 1024 * 1024) throw new Error("semantic_input_limit");
  await writeFile(inputPath, input, { mode: 0o600 });
  const started = performance.now();
  const result = await invokeSemanticWorker(
    process.env.SEMANTIC_PYTHON ?? path.join(root, ".local/semantic-venv/bin/python"),
    path.join(root, "scripts/benchmarks/semantic-worker.py"), inputPath);
  let dense = lexical.map((refs) => refs.slice(0, 100));
  let failure = result.failure ?? null;
  if (result.output) {
    try {
      validateSemanticRefs(chunks, queries, result.output.refsByQuery);
      if (result.output.latencyMsByQuery.length !== queries.length ||
          result.output.queryWindowCounts.length !== queries.length ||
          result.output.indexReceipts.reduce((sum, r) => sum + r.documentCount, 0) !== chunks.length) {
        throw new Error("invalid_semantic_response");
      }
      dense = result.output.refsByQuery;
    } catch { failure = "semantic_response_scope_invalid"; }
  }
  for (const name of ["semantic-model.v1.json", "semantic-worker.py", "semantic-candidates-lib.mts", "run-semantic-candidates.mts"]) {
    fingerprints[name] = await sha256File(path.join(root, "scripts/benchmarks", name));
  }
  fingerprints.rankingSha256 = await sha256File(path.join(root, "src/lib/evidence/ranking.ts"));
  fingerprints.protocolSha256 = await sha256File(path.join(root, "benchmarks/semantic-protocol.v1.json"));
  const report = {
    schemaVersion: "smartfaqs-semantic-analysis.v1", dataset, sourceCount: new Set(chunks.map((c) => c.sourceRef)).size,
    documentCount: chunks.length, fingerprints, generatedAt: new Date().toISOString(),
    ...(extractionProvenance ? { extractionProvenance } : {}),
    hardware: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length, totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
      semanticCpuThreads: 4 },
    semanticStatus: failure ? "lexical_fallback" : "ok", failureReason: failure,
    semanticWallMs: round(performance.now() - started),
    lexicalIndexMs: round(lexicalIndexMs), lexicalLatencyMs: {
      median: percentile(lexicalLatencies, 0.5), p95: percentile(lexicalLatencies, 0.95),
    },
    semanticReceipt: failure ? null : {
      startupMs: result.output!.startupMs, peakRssMiB: result.output!.peakRssMiB,
      indexReceipts: result.output!.indexReceipts, discardedTokenCount: result.output!.discardedTokenCount,
      multiWindowQueryCount: result.output!.queryWindowCounts.filter((c) => c > 1).length,
      latencyMs: { median: percentile(result.output!.latencyMsByQuery, 0.5), p95: percentile(result.output!.latencyMsByQuery, 0.95) },
    },
    ...assessSemanticPaths(queries, lexical, dense),
  };
  const reportPath = path.join(base, "results", dataset + ".json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath },
    (key, value) => key === "queryResults" ? undefined : value, 2));
  if (failure) process.exitCode = 2;
}

try { await main(); }
catch { console.error("semantic_benchmark_failed"); process.exitCode = 1; }
