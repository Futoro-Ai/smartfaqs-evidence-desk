#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { buildEvidenceSearchIndex, rankEvidenceCatalog } from "../../src/lib/evidence/ranking.ts";
import type { EvidenceChunk, KnowledgeSection, SourceRef } from "../../src/lib/evidence/types";
import { buildBeirSciFactBenchmark, loadBeirSciFactDataset } from "./beir-scifact-lib.mts";
import {
  buildSciFactBenchmark, loadSciFactDataset, sha256File,
} from "./scifact-lib.mts";
import {
  evaluateRerankerPools, formatRerankerPassage, validateRerankerQueries,
  type RerankerMeasurements, type RerankerQuery,
} from "./reranker-lib.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modelRevision = "ce0834f22110de6d9222af7a7a03628121708969";
const modelDir = path.join(root, ".local/models/ms-marco-MiniLM-L6-v2", modelRevision);
const modelManifestPath = path.join(root, "scripts/benchmarks/reranker-model.v1.json");
const workerPath = path.join(root, "scripts/benchmarks/reranker-worker.py");
const northstarCatalogPath = path.join(root, "src/data/okfCatalog.generated.json");
const northstarGoldPath = path.join(root, "scripts/benchmarks/northstar-independent-gold.v1.json");

type Dataset = "scifact-dev" | "beir-scifact" | "northstar-independent";
const northstarGoldSchema = z.object({
  schemaVersion: z.literal("smartfaqs-reranker-gold.v1"),
  reviewStatus: z.literal("independently_authored_before_model_scoring"),
  queries: z.array(z.object({
    id: z.string().min(1),
    category: z.enum(["table", "numeric_table", "numeric", "negation", "multiple_passages", "no_answer"]),
    sourceRef: z.string().startsWith("source:"),
    query: z.string().min(2).max(500),
    relevantChunkRefs: z.array(z.string().min(1)).max(100),
  }).strict()).min(1).max(500),
}).strict();
type BenchmarkInput = {
  sections: KnowledgeSection[];
  chunks: EvidenceChunk[];
  queries: Array<{ id: string; query: string; relevantChunkRefs: string[] }>;
  sourceRefs: Map<string, SourceRef>;
  searchIndex: ReturnType<typeof buildEvidenceSearchIndex>;
};

function parseArgs(args: string[]) {
  let dataset: Dataset = "scifact-dev";
  let enableModel = false;
  let queryLimit: number | undefined;
  let timeoutMs = 900_000;
  let python = "python3";
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--dataset") {
      const value = args[++index];
      if (value !== "scifact-dev" && value !== "beir-scifact" && value !== "northstar-independent") {
        throw new Error("invalid_dataset");
      }
      dataset = value;
    } else if (option === "--enable-model") {
      enableModel = true;
    } else if (option === "--query-limit") {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 500) {
        throw new Error("invalid_query_limit");
      }
      queryLimit = Number(value);
    } else if (option === "--timeout-ms") {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1_000 || Number(value) > 1_800_000) {
        throw new Error("invalid_timeout");
      }
      timeoutMs = Number(value);
    } else if (option === "--python") {
      python = args[++index];
      if (!python) throw new Error("invalid_python_path");
    } else {
      throw new Error(`unknown_option:${option}`);
    }
  }
  return { dataset, enableModel, queryLimit, timeoutMs, python };
}

async function loadBenchmark(dataset: Dataset): Promise<{
  benchmark: BenchmarkInput;
  inputFingerprints: Record<string, string>;
}> {
  if (dataset === "northstar-independent") {
    const catalog = JSON.parse(await readFile(northstarCatalogPath, "utf8")) as {
      schemaVersion: string; sections: KnowledgeSection[]; chunks: EvidenceChunk[];
    };
    const gold = northstarGoldSchema.parse(JSON.parse(await readFile(northstarGoldPath, "utf8")));
    if (catalog.schemaVersion !== "smartfaqs-okf-catalog.v1" ||
        gold.queries.length < 1 || gold.queries.length > 500) {
      throw new Error("invalid_northstar_gold");
    }
    const sourceByChunk = new Map(catalog.chunks.map(({ ref, sourceRef }) => [ref, sourceRef]));
    const sourceRefs = new Map<string, SourceRef>();
    const seenIds = new Set<string>();
    const sources = new Set(catalog.sections.map(({ sourceRef }) => sourceRef));
    for (const query of gold.queries) {
      if (seenIds.has(query.id) || !sources.has(query.sourceRef) ||
          query.relevantChunkRefs.some((ref) => sourceByChunk.get(ref) !== query.sourceRef) ||
          (query.category === "no_answer") !== (query.relevantChunkRefs.length === 0)) {
        throw new Error("invalid_northstar_gold");
      }
      seenIds.add(query.id);
      sourceRefs.set(query.id, query.sourceRef as SourceRef);
    }
    return {
      benchmark: {
        sections: catalog.sections, chunks: catalog.chunks,
        queries: gold.queries, sourceRefs,
        searchIndex: buildEvidenceSearchIndex(catalog.sections, catalog.chunks),
      },
      inputFingerprints: {
        catalogSha256: await sha256File(northstarCatalogPath),
        goldSha256: await sha256File(northstarGoldPath),
      },
    };
  }
  const dataDir = path.join(root, ".local/benchmarks", dataset === "scifact-dev" ? "scifact" : "beir-scifact", "data");
  if (dataset === "scifact-dev") {
    const { corpus, claims } = await loadSciFactDataset(dataDir);
    const benchmark = buildSciFactBenchmark(corpus, claims);
    return {
      benchmark: { ...benchmark, sourceRefs: new Map(benchmark.queries.map(({ id }) => [id, "source:scifact" as SourceRef])) },
      inputFingerprints: {
        corpusSha256: await sha256File(path.join(dataDir, "corpus.jsonl")),
        claimsSha256: await sha256File(path.join(dataDir, "claims_dev.jsonl")),
      },
    };
  }
  const { corpus, queries, qrels } = await loadBeirSciFactDataset(dataDir);
  const benchmark = buildBeirSciFactBenchmark(corpus, queries, qrels);
  return {
    benchmark: { ...benchmark, sourceRefs: new Map(benchmark.queries.map(({ id }) => [id, "source:scifact" as SourceRef])) },
    inputFingerprints: {
      corpusSha256: await sha256File(path.join(dataDir, "corpus.jsonl")),
      queriesSha256: await sha256File(path.join(dataDir, "queries.jsonl")),
      qrelsSha256: await sha256File(path.join(dataDir, "qrels/test.tsv")),
    },
  };
}

function buildCandidates(benchmark: BenchmarkInput, queryLimit?: number): RerankerQuery[] {
  return benchmark.queries.slice(0, queryLimit).map((query) => {
    const sourceRef = benchmark.sourceRefs.get(query.id);
    if (!sourceRef) throw new Error("query_source_missing");
    const ranked = rankEvidenceCatalog(benchmark.sections, benchmark.chunks, {
      sourceRef,
      query: query.query,
      resultLimit: 100,
      candidateLimit: 100,
      searchIndex: benchmark.searchIndex,
    });
    return {
      id: query.id,
      query: query.query,
      sourceRef,
      relevantRefs: query.relevantChunkRefs,
      candidates: ranked.results.map(({ chunk }) => ({
        ref: chunk.ref,
        sourceRef: chunk.sourceRef,
        text: formatRerankerPassage(chunk),
      })),
    };
  });
}

async function scoreWithLocalModel(
  queries: RerankerQuery[], python: string, timeoutMs: number,
): Promise<RerankerMeasurements> {
  const manifest = JSON.parse(await readFile(modelManifestPath, "utf8")) as {
    repository: string; revision: string; library: string; fileSha256: Record<string, string>;
  };
  if (manifest.revision !== modelRevision) throw new Error("model_checksum_mismatch");
  for (const [name, expected] of Object.entries(manifest.fileSha256)) {
    if (await sha256File(path.join(modelDir, name)) !== expected) {
      throw new Error("model_checksum_mismatch");
    }
  }
  const input = JSON.stringify({
    schemaVersion: "smartfaqs-reranker-input.v1",
    queries: queries.map(({ query, candidates }) => ({
      query, passages: candidates.map(({ text }) => text),
    })),
  });
  if (Buffer.byteLength(input) > 64 * 1024 * 1024) throw new Error("model_input_too_large");
  return await new Promise((resolve, reject) => {
    const child = spawn(python, [workerPath, modelDir], {
      cwd: root,
      env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let oversized = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      output += part;
      if (Buffer.byteLength(output) > 16 * 1024 * 1024) {
        oversized = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => { /* Worker exit is reported by close. */ });
    child.on("error", () => { clearTimeout(timer); reject(new Error("model_worker_unavailable")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("model_timeout"));
      else if (oversized) reject(new Error("model_output_too_large"));
      else if (code !== 0) reject(new Error("model_worker_failed"));
      else {
        try { resolve(JSON.parse(output) as RerankerMeasurements); }
        catch { reject(new Error("model_output_invalid")); }
      }
    });
    child.stdin.end(input);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { benchmark, inputFingerprints } = await loadBenchmark(options.dataset);
  const queries = buildCandidates(benchmark, options.queryLimit);
  validateRerankerQueries(queries);
  let measurements: RerankerMeasurements | null = null;
  let fallbackReason: string | undefined;
  if (options.enableModel) {
    try { measurements = await scoreWithLocalModel(queries, options.python, options.timeoutMs); }
    catch (error) {
      const code = error instanceof Error ? error.message : "model_worker_failed";
      fallbackReason = ["model_checksum_mismatch", "model_input_too_large", "model_timeout",
        "model_output_too_large", "model_output_invalid", "model_worker_unavailable",
        "model_worker_failed"].includes(code) ? code : "model_unavailable";
    }
  }
  let evaluation;
  try { evaluation = evaluateRerankerPools(queries, measurements, fallbackReason); }
  catch (error) {
    if (!measurements) throw error;
    evaluation = evaluateRerankerPools(queries, null, "model_output_invalid");
  }
  const report = {
    ...evaluation,
    dataset: options.dataset,
    generatedAt: new Date().toISOString(),
    model: options.enableModel ? {
      name: "cross-encoder/ms-marco-MiniLM-L6-v2",
      revision: modelRevision,
      modelManifestSha256: await sha256File(modelManifestPath),
      library: "sentence-transformers==6.1.0",
      maxTokens: 256,
      timeoutMs: options.timeoutMs,
    } : null,
    inputFingerprints,
    implementationFingerprints: {
      rankingSha256: await sha256File(path.join(root, "src/lib/evidence/ranking.ts")),
      evaluatorSha256: await sha256File(path.join(root, "scripts/benchmarks/reranker-lib.mts")),
      runnerSha256: await sha256File(path.join(root, "scripts/benchmarks/run-reranker.mts")),
      workerSha256: await sha256File(workerPath),
    },
  };
  const reportPath = path.join(root, ".local/benchmarks/reranker/results",
    `${options.dataset}-${options.queryLimit ?? "full"}-${options.enableModel ? "model" : "lexical"}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status, dataset: report.dataset, queryCount: report.queryCount,
    fallbackReason: report.fallbackReason, pools: report.pools,
    peakMemoryMiB: report.peakMemoryMiB,
  }, null, 2));
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
