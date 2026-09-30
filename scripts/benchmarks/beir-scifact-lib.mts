import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import { buildSciFactBenchmark } from "./scifact-lib.mts";

const MAX_FILE_BYTES = 256 * 1024 * 1024;
const corpusSchema = z.object({
  _id: z.string().min(1),
  title: z.string().optional(),
  text: z.string().min(1),
}).passthrough();
const querySchema = z.object({
  _id: z.string().min(1),
  text: z.string().min(1),
}).passthrough();

export async function readBeirJsonl<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size > MAX_FILE_BYTES) {
    throw new Error("invalid_beir_input_file");
  }
  const rows = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
  return rows.map((row, index) => {
    try {
      return schema.parse(JSON.parse(row));
    } catch (error) {
      throw new Error(`invalid_beir_jsonl_row:${index + 1}`, { cause: error });
    }
  });
}

export function parseBeirQrels(value: string) {
  const lines = value.trim().split(/\r?\n/);
  if (lines.shift() !== "query-id\tcorpus-id\tscore") {
    throw new Error("invalid_beir_qrels_header");
  }
  const qrels = new Map<string, Map<string, number>>();
  for (const line of lines) {
    const columns = line.split("\t");
    if (columns.length !== 3 || !columns[0] || !columns[1] ||
        !/^\d+$/.test(columns[2])) {
      throw new Error("invalid_beir_qrels_row");
    }
    const documents = qrels.get(columns[0]) ?? new Map<string, number>();
    if (documents.has(columns[1])) throw new Error("duplicate_beir_qrel");
    documents.set(columns[1], Number(columns[2]));
    qrels.set(columns[0], documents);
  }
  if (qrels.size === 0) throw new Error("empty_beir_qrels");
  return qrels;
}

export async function loadBeirSciFactDataset(dataDirectory: string) {
  const [corpus, queries, qrelsText] = await Promise.all([
    readBeirJsonl(`${dataDirectory}/corpus.jsonl`, corpusSchema),
    readBeirJsonl(`${dataDirectory}/queries.jsonl`, querySchema),
    readFile(`${dataDirectory}/qrels/test.tsv`, "utf8"),
  ]);
  if (Buffer.byteLength(qrelsText) > MAX_FILE_BYTES) {
    throw new Error("invalid_beir_qrels_file");
  }
  return { corpus, queries, qrels: parseBeirQrels(qrelsText) };
}

export function buildBeirSciFactBenchmark(
  corpus: z.infer<typeof corpusSchema>[],
  queries: z.infer<typeof querySchema>[],
  qrels: Map<string, Map<string, number>>,
) {
  const queryById = new Map(queries.map((query) => [query._id, query]));
  if (queryById.size !== queries.length) throw new Error("duplicate_beir_query");
  const corpusIds = new Set(corpus.map((document) => document._id));
  if (corpusIds.size !== corpus.length) throw new Error("duplicate_beir_document");
  const claims = [...qrels].map(([queryId, documents]) => {
    const query = queryById.get(queryId);
    if (!query) throw new Error(`unknown_beir_query:${queryId}`);
    const evidence = Object.fromEntries([...documents]
      .filter(([, score]) => score > 0)
      .map(([docId, score]) => {
        if (score !== 1 || !corpusIds.has(docId)) {
          throw new Error(`unsupported_beir_qrel:${queryId}`);
        }
        return [docId, [{ label: "SUPPORT" as const, sentences: [0] }]];
      }));
    if (Object.keys(evidence).length === 0) throw new Error(`empty_beir_query:${queryId}`);
    return { id: queryId, claim: query.text, evidence };
  });
  const documents = corpus.map((document) => ({
    doc_id: document._id,
    title: document.title?.trim() || document._id,
    abstract: [document.text],
  }));
  const benchmark = buildSciFactBenchmark(documents, claims);
  if (benchmark.queries.length !== qrels.size) throw new Error("beir_query_count_mismatch");
  return benchmark;
}
