#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  BM25F_BODY_ONLY_WEIGHTS, buildEvidenceSearchIndex, type EvidenceSearchIndex,
} from "../../src/lib/evidence/ranking.ts";
import type { EvidenceChunk, KnowledgeSection, SourceRef } from "../../src/lib/evidence/types";
import { buildBeirSciFactBenchmark, loadBeirSciFactDataset } from "./beir-scifact-lib.mts";
import { loadBrightRobotics } from "./bright-robotics-lib.mts";
import { analyzeCandidatePaths, type CandidateQuery } from "./candidate-analysis-lib.mts";
import { buildSciFactBenchmark, loadSciFactDataset, sha256File } from "./scifact-lib.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
type Dataset = "scifact-dev" | "beir-scifact" | "bright-robotics" | "northstar-independent";
const datasets: Dataset[] = ["scifact-dev", "beir-scifact", "bright-robotics", "northstar-independent"];
const northstarGoldSchema = z.object({
  schemaVersion: z.literal("smartfaqs-reranker-gold.v1"),
  reviewStatus: z.literal("independently_authored_before_model_scoring"),
  queries: z.array(z.object({
    id: z.string().min(1),
    category: z.string(),
    sourceRef: z.string().startsWith("source:"),
    query: z.string().min(2),
    relevantChunkRefs: z.array(z.string()),
  }).strict()).min(1),
}).strict();

function parseArgs(args: string[]) {
  if (args.length !== 2 || args[0] !== "--dataset" || !datasets.includes(args[1] as Dataset)) {
    throw new Error("usage: --dataset scifact-dev|beir-scifact|bright-robotics|northstar-independent");
  }
  return args[1] as Dataset;
}

async function loadInput(dataset: Dataset): Promise<{
  sections: KnowledgeSection[];
  chunks: EvidenceChunk[];
  queries: CandidateQuery[];
  inputFingerprints: Record<string, string>;
  bodyOnly: boolean;
  searchIndex?: EvidenceSearchIndex;
}> {
  const data = path.join(root, ".local/benchmarks",
    dataset === "scifact-dev" ? "scifact" : dataset, "data");
  if (dataset === "scifact-dev" || dataset === "beir-scifact") {
    const benchmark = dataset === "scifact-dev"
      ? await loadSciFactDataset(data).then(({ corpus, claims }) => buildSciFactBenchmark(corpus, claims))
      : await loadBeirSciFactDataset(data).then(({ corpus, queries, qrels }) =>
        buildBeirSciFactBenchmark(corpus, queries, qrels));
    return {
      sections: benchmark.sections, chunks: benchmark.chunks,
      searchIndex: benchmark.searchIndex,
      queries: benchmark.queries.map(({ id, query, relevantChunkRefs }) => ({
        id, query, sourceRef: "source:scifact" as SourceRef, relevantRefs: relevantChunkRefs,
      })),
      inputFingerprints: dataset === "scifact-dev" ? {
        corpusSha256: await sha256File(path.join(data, "corpus.jsonl")),
        claimsSha256: await sha256File(path.join(data, "claims_dev.jsonl")),
      } : {
        corpusSha256: await sha256File(path.join(data, "corpus.jsonl")),
        queriesSha256: await sha256File(path.join(data, "queries.jsonl")),
        qrelsSha256: await sha256File(path.join(data, "qrels/test.tsv")),
      },
      bodyOnly: false,
    };
  }
  if (dataset === "bright-robotics") {
    const { documents, examples } = await loadBrightRobotics(data);
    const sourceRef = "source:bright-robotics" as SourceRef;
    return {
      sections: [],
      chunks: documents.map(({ id, content }): EvidenceChunk => ({
        ref: id, conceptRef: `bright@${id}`, sourceRef,
        sectionRef: "section:bright-robotics", sectionConceptRef: "bright@robotics",
        sectionPath: [], label: "", section: "", page: null,
        kind: "text", content, keywords: [],
      })),
      queries: examples.map(({ id, query, gold_ids, excluded_ids }) => ({
        id, query, sourceRef, relevantRefs: gold_ids, excludedRefs: excluded_ids,
      })),
      inputFingerprints: {
        documentsSha256: await sha256File(path.join(data, "documents.jsonl")),
        examplesSha256: await sha256File(path.join(data, "examples.jsonl")),
        receiptSha256: await sha256File(path.join(root, ".local/benchmarks/bright-robotics/download-receipt.json")),
      },
      bodyOnly: true,
    };
  }
  const catalogPath = path.join(root, "src/data/okfCatalog.generated.json");
  const goldPath = path.join(root, "scripts/benchmarks/northstar-independent-gold.v1.json");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
    schemaVersion: string; sections: KnowledgeSection[]; chunks: EvidenceChunk[];
  };
  const gold = northstarGoldSchema.parse(JSON.parse(await readFile(goldPath, "utf8")));
  if (catalog.schemaVersion !== "smartfaqs-okf-catalog.v1") throw new Error("invalid_northstar_catalog");
  return {
    sections: catalog.sections, chunks: catalog.chunks,
    queries: gold.queries.map(({ id, query, sourceRef, relevantChunkRefs, category }) => {
      if ((category === "no_answer") !== (relevantChunkRefs.length === 0)) {
        throw new Error("invalid_northstar_gold");
      }
      return { id, query, sourceRef: sourceRef as SourceRef, relevantRefs: relevantChunkRefs };
    }),
    inputFingerprints: {
      catalogSha256: await sha256File(catalogPath),
      goldSha256: await sha256File(goldPath),
    },
    bodyOnly: false,
  };
}

async function main() {
  const dataset = parseArgs(process.argv.slice(2));
  const input = await loadInput(dataset);
  const started = performance.now();
  const analysis = analyzeCandidatePaths({
    ...input,
    searchIndex: input.searchIndex ?? buildEvidenceSearchIndex(input.sections, input.chunks),
    ...(input.bodyOnly ? { fieldWeights: BM25F_BODY_ONLY_WEIGHTS, structuralBoost: false } : {}),
  });
  const report = {
    ...analysis, dataset, generatedAt: new Date().toISOString(),
    fullRunMs: Number((performance.now() - started).toFixed(3)),
    inputFingerprints: input.inputFingerprints,
    implementationFingerprints: {
      rankingSha256: await sha256File(path.join(root, "src/lib/evidence/ranking.ts")),
      analysisSha256: await sha256File(path.join(root, "scripts/benchmarks/candidate-analysis-lib.mts")),
      runnerSha256: await sha256File(fileURLToPath(import.meta.url)),
    },
  };
  const reportPath = path.join(root, ".local/benchmarks/candidate-analysis/results", `${dataset}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    dataset, queryCount: report.queryCount, failureCategoryCounts: report.failureCategoryCounts,
    expansionAppliedCount: report.expansionAppliedCount, latencyMs: report.latencyMs,
    pools: report.pools, reportPath,
  }, null, 2));
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
