import { describe, expect, it } from "vitest";

import {
  checkEvidenceReadiness,
  executeEvidenceTool,
  exportEvidencePacket,
  readEvidenceChunk,
  searchEvidence,
  stageEvidenceAnswer,
} from "@/lib/capabilities/evidence";

describe("Evidence Desk capability contracts", () => {
  it("lists only the fixed synthetic sources", () => {
    const result = executeEvidenceTool("list_knowledge_sources", {});

    expect(result).toMatchObject({ status: "ready", sourceCount: 3 });
    expect(result.sources).toHaveLength(3);
  });

  it("reports table and text readiness for the employee handbook", () => {
    const result = checkEvidenceReadiness({
      sourceRef: "source:employee-handbook",
    });

    expect(result).toMatchObject({
      status: "ready",
      boundedEvidenceAvailable: true,
      textChunkCount: 3,
      tableChunkCount: 1,
      citationLabelsAvailable: true,
      blockedBy: [],
    });
  });

  it("finds the bounded annual leave evidence", () => {
    const result = searchEvidence({
      sourceRef: "source:employee-handbook",
      query: "What annual leave applies after 5 years?",
      limit: 4,
    });

    expect(result.status).toBe("matches_found");
    expect(result.results[0]).toMatchObject({
      chunkRef: "chunk:leave-accrual-table",
      kind: "table",
    });
    expect(result.results[0].excerpt).toContain("104 hours");
  });

  it("fails closed when a chunk is outside the selected source", () => {
    expect(() =>
      readEvidenceChunk({
        sourceRef: "source:benefits-guide",
        chunkRef: "chunk:leave-accrual-table",
      }),
    ).toThrow("evidence_chunk_outside_selected_source");
  });

  it("rejects extra input fields", () => {
    expect(() =>
      executeEvidenceTool("search_evidence", {
        sourceRef: "source:employee-handbook",
        query: "annual leave",
        limit: 4,
        command: "execute anything",
      }),
    ).toThrow();
  });

  it("stages an answer for human review without approving it", () => {
    const result = stageEvidenceAnswer({
      sourceRef: "source:employee-handbook",
      answer:
        "Employees with 5-9 completed years receive 104 hours, or 13 days, each year.",
      evidenceRefs: [
        "chunk:leave-accrual-table",
        "chunk:leave-accrual-method",
      ],
    });

    expect(result.status).toBe("staged_for_human_review");
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.evidence).toHaveLength(2);
  });

  it("exports labels and counts without raw evidence content", () => {
    const result = exportEvidencePacket({
      sourceRef: "source:employee-handbook",
      answer:
        "Employees with 5-9 completed years receive 104 hours, or 13 days, each year.",
      evidenceRefs: ["chunk:leave-accrual-table"],
      decision: "approved",
    });

    expect(result).toEqual({
      packetVersion: "evidence-packet.v1",
      sourceLabel: "Northstar Employee Handbook",
      answerPresent: true,
      evidenceCount: 1,
      evidenceLabels: ["Annual leave schedule"],
      decision: "approved",
      boundaryStatus: "synthetic_public_data_only",
    });
    expect(JSON.stringify(result)).not.toContain("104 hours");
  });
});
