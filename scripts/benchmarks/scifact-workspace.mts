import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { evaluateSciFactBenchmark } from "./scifact-lib.mts";

type Evaluation = ReturnType<typeof evaluateSciFactBenchmark>;
type Report = Evaluation & {
  generatedAt: string;
  durationMs: number;
  inputFingerprints: Record<string, string>;
};

function jsonLine(value: unknown): string {
  return JSON.stringify(value);
}

function queryRecords(report: Report) {
  return Object.entries(report.modes).flatMap(([mode, result]) =>
    result.queryResults.map((query) => ({ mode, ...query })),
  );
}

export async function writeSciFactIcmWorkspace(
  workspaceRoot: string,
  report: Report,
) {
  const records = queryRecords(report);
  const files = new Map<string, string>([
    [
      "index.md",
      [
        "# SciFact Retrieval Run",
        "",
        "Local ICM-style artifacts for one deterministic retrieval evaluation.",
        "Records contain query identifiers, counts, ranks, metrics, and failure",
        "classes only. Claim text, abstracts, and evidence text are excluded.",
        "",
      ].join("\n"),
    ],
    [
      "00-contract/contract.json",
      `${JSON.stringify(
        {
          schemaVersion: report.schemaVersion,
          dataset: report.dataset,
          sourceScope: "source:scifact",
          bounds: report.bounds,
          rankingModes: Object.fromEntries(
            Object.entries(report.modes).map(([mode, value]) => [
              mode,
              value.config,
            ]),
          ),
          exclusions: ["query_text", "abstract_text", "evidence_text"],
        },
        null,
        2,
      )}\n`,
    ],
    [
      "30-retrieve/queries.jsonl",
      `${records
        .map(({ mode, queryId, positiveCandidateCount, candidatePoolCount, relevantPositiveCount }) =>
          jsonLine({
            mode,
            queryId,
            positiveCandidateCount,
            candidatePoolCount,
            relevantPositiveCount,
          }),
        )
        .join("\n")}\n`,
    ],
    [
      "40-rank/queries.jsonl",
      `${records
        .map(({ mode, queryId, firstRelevantRank, evidence, documentsFromEvidence, sectionNavigation }) =>
          jsonLine({
            mode,
            queryId,
            firstRelevantRank,
            evidence,
            documentsFromEvidence,
            sectionNavigation,
          }),
        )
        .join("\n")}\n`,
    ],
    [
      "50-verify/queries.jsonl",
      `${records
        .map(({ mode, queryId, failureCategory }) =>
          jsonLine({ mode, queryId, failureCategory }),
        )
        .join("\n")}\n`,
    ],
    [
      "80-export/report.json",
      `${JSON.stringify(
        {
          schemaVersion: report.schemaVersion,
          dataset: report.dataset,
          generatedAt: report.generatedAt,
          durationMs: report.durationMs,
          inputFingerprints: report.inputFingerprints,
          corpusDocumentCount: report.corpusDocumentCount,
          evidenceChunkCount: report.evidenceChunkCount,
          evaluatedQueryCount: report.evaluatedQueryCount,
          bounds: report.bounds,
          modes: Object.fromEntries(
            Object.entries(report.modes).map(([mode, value]) => [
              mode,
              {
                config: value.config,
                metrics: value.metrics,
                diagnostics: value.diagnostics,
              },
            ]),
          ),
          complementarity: report.complementarity,
        },
        null,
        2,
      )}\n`,
    ],
  ]);

  await Promise.all(
    [...files].map(async ([relativePath, content]) => {
      const filePath = path.join(workspaceRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
    }),
  );
}
