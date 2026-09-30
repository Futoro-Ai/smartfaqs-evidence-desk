#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const SOURCE_URL =
  "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip";
const EXPECTED_MD5 = "5f7d1de60b170fc8027bb7898e2efca1";
const EXPECTED_ARCHIVE_SHA256 = "536e14446a0ba56ed1398ab1055f39fe852686ecad24a6306c80c490fa8e0165";
const EXPECTED_FILE_SHA256 = {
  "corpus.jsonl": "dec31c8182f3d744c7d2c09423756fd1d17cbef75808db13ba01cc0aab4d1ac6",
  "queries.jsonl": "8ff84a7c903f722981cd8d595c022660140c51867b27608a6d4910db86080313",
  "qrels/test.tsv": "0864bb985e0ca2367ba217977e72004d549054b2b06666ed9d4825ac7c21284c",
};
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const benchmarkRoot = path.join(repositoryRoot, ".local/benchmarks/beir-scifact");
const dataDirectory = path.join(benchmarkRoot, "data");
const requiredFiles = Object.keys(EXPECTED_FILE_SHA256);

if (process.argv.length > 2) throw new Error(`unexpected_argument:${process.argv[2]}`);

async function prepare() {
  const existing = await stat(dataDirectory).catch(() => null);
  if (existing) {
    if (!(await Promise.all(requiredFiles.map((name) =>
      stat(path.join(dataDirectory, name)).then((value) => value.isFile()).catch(() => false),
    ))).every(Boolean)) {
      throw new Error("incomplete_beir_scifact_dataset_directory");
    }
    await verifyFiles(dataDirectory);
    return { status: "already_prepared", dataDirectory };
  }

  await mkdir(benchmarkRoot, { recursive: true });
  const temporaryRoot = path.join(benchmarkRoot, `.prepare-${process.pid}-${Date.now()}`);
  await mkdir(temporaryRoot);
  try {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`beir_download_failed:${response.status}`);
    if (new URL(response.url).hostname !== new URL(SOURCE_URL).hostname) {
      throw new Error("beir_download_redirect_host_blocked");
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_ARCHIVE_BYTES) {
      throw new Error("beir_archive_too_large");
    }
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length > MAX_ARCHIVE_BYTES) throw new Error("beir_archive_too_large");
    if (createHash("md5").update(archive).digest("hex") !== EXPECTED_MD5 ||
      createHash("sha256").update(archive).digest("hex") !== EXPECTED_ARCHIVE_SHA256) {
      throw new Error("beir_archive_hash_mismatch");
    }
    const archivePath = path.join(temporaryRoot, "scifact.zip");
    await writeFile(archivePath, archive);
    const listing = await execute("unzip", ["-Z1", archivePath], { maxBuffer: 1024 * 1024 });
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
    if (entries.length === 0 || entries.some((entry) => {
      const normalized = path.posix.normalize(entry);
      return entry.includes("\\") || entry.startsWith("/") ||
        (normalized !== "scifact" && !normalized.startsWith("scifact/")) ||
        normalized.includes("../");
    })) {
      throw new Error("beir_archive_path_blocked");
    }
    await execute("unzip", ["-q", archivePath, "-d", temporaryRoot]);
    const extracted = path.join(temporaryRoot, "scifact");
    const fingerprints = await verifyFiles(extracted);
    await rename(extracted, dataDirectory);
    await writeFile(path.join(benchmarkRoot, "download-receipt.json"),
      `${JSON.stringify({
        sourceUrl: SOURCE_URL,
        archiveMd5: EXPECTED_MD5,
        archiveSha256: EXPECTED_ARCHIVE_SHA256,
        fileSha256: fingerprints,
        preparedAt: new Date().toISOString(),
      }, null, 2)}\n`);
    return { status: "prepared", dataDirectory };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function verifyFiles(directory) {
  return Object.fromEntries(await Promise.all(requiredFiles.map(async (name) => {
    const contents = await readFile(path.join(directory, name));
    if (contents.length === 0) throw new Error(`beir_file_empty:${name}`);
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== EXPECTED_FILE_SHA256[name]) throw new Error(`beir_file_hash_mismatch:${name}`);
    return [name, actual];
  })));
}

try {
  console.log(JSON.stringify(await prepare(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
