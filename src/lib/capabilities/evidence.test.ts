import { describe, expect, it } from "vitest";

import { toolDefinitions } from "@/lib/capabilities/contracts";
import {
  checkEvidenceReadiness,
  executeEvidenceTool,
  exportEvidencePacket,
  listKnowledgeSources,
  readEvidenceChunk,
  searchEvidence,
  stageEvidenceAnswer,
} from "@/lib/capabilities/evidence";

describe("Evidence Desk capability contracts", () => {
  it("publishes defaulted inputs as optional", () => {
    const search = toolDefinitions.find(
      ({ name }) => name === "search_evidence",
    );
    const exported = toolDefinitions.find(
      ({ name }) => name === "export_evidence_packet",
    );

    expect(search?.inputSchema.required).not.toContain("limit");
    expect(exported?.inputSchema.properties).not.toHaveProperty("decision");
  });

  it("lists only the fixed synthetic sources", () => {
    const result = listKnowledgeSources();

    expect(result).toMatchObject({ status: "ready", sourceCount: 3 });
    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({ sectionCount: 4, chunkCount: 4 });
  });

  it("reports table and text readiness for the employee handbook", () => {
    const result = checkEvidenceReadiness({
      sourceRef: "source:employee-handbook",
    });

    expect(result).toMatchObject({
      status: "ready",
      boundedEvidenceAvailable: true,
      structuralNavigationAvailable: true,
      sectionCount: 4,
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
    expect(result.matchedSections[0]).toMatchObject({
      sectionRef: "section:employee-handbook-annual-leave",
      label: "4.2 Annual Leave",
      sectionPath: ["4 Time Away", "4.2 Annual Leave"],
      descendantEvidenceCount: 2,
    });
    expect(result.results[0]).toMatchObject({
      chunkRef: "chunk:leave-accrual-table",
      conceptRef:
        "northstar-demo@2026.3/employee-handbook/04-time-away/04-02-annual-leave/annual-leave-schedule",
      sectionRef: "section:employee-handbook-annual-leave",
      sectionConceptRef:
        "northstar-demo@2026.3/employee-handbook/04-time-away/04-02-annual-leave/section",
      sectionPath: ["4 Time Away", "4.2 Annual Leave"],
      kind: "table",
    });
    expect(result.results[0].excerpt).toContain("104 hours");
  });

  it("uses a reviewed question hint without returning it as evidence", () => {
    const result = searchEvidence({
      sourceRef: "source:employee-handbook",
      query: "How often does vacation time show up in my account?",
      limit: 4,
    });

    expect(result.results[0].chunkRef).toBe("chunk:leave-accrual-method");
    expect(result.results[0]).not.toHaveProperty("answerQuestions");
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

  it("keeps approval state outside the agent tool contract", () => {
    expect(() =>
      executeEvidenceTool("export_evidence_packet", {
        sourceRef: "source:employee-handbook",
        answer: "A staged answer.",
        evidenceRefs: ["chunk:leave-accrual-table"],
        decision: "approved",
      }),
    ).toThrow();

    expect(
      executeEvidenceTool("export_evidence_packet", {
        sourceRef: "source:employee-handbook",
        answer: "A staged answer.",
        evidenceRefs: ["chunk:leave-accrual-table"],
      }),
    ).toMatchObject({ decision: "pending" });
  });
});
