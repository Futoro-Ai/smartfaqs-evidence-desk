import { describe, expect, it } from "vitest";

import {
  BM25F_BODY_ONLY_WEIGHTS,
  buildEvidenceSearchIndex,
  queryTerms,
  rankEvidenceCatalog,
} from "@/lib/evidence/ranking";
import type {
  EvidenceChunk,
  KnowledgeSection,
  SourceRef,
} from "@/lib/evidence/types";

const sourceA = "source:test-a" as SourceRef;
const sourceB = "source:test-b" as SourceRef;

function section(
  ref: string,
  path: string[],
  sourceRef = sourceA,
  parentRef: string | null = null,
): KnowledgeSection {
  return {
    ref,
    conceptRef: `test@1/${ref}`,
    sourceRef,
    label: path.at(-1) ?? ref,
    description: path.at(-1) ?? ref,
    sectionPath: path,
    depth: path.length,
    sourceOrder: path.length,
    structuralOrigin: "explicit_heading",
    headingRecordCount: 1,
    page: null,
    aliases: [],
    keywords: [],
    parentRef,
    rollup: {
      directSectionCount: 0,
      directEvidenceCount: 1,
      descendantEvidenceCount: 1,
      textCount: 1,
      tableCount: 0,
      pageStart: null,
      pageEnd: null,
      descendantDigest: "sha256:000000000000000000000000",
    },
  };
}

function chunk(
  ref: string,
  content: string,
  sectionValue: KnowledgeSection,
  overrides: Partial<EvidenceChunk> = {},
): EvidenceChunk {
  return {
    ref,
    conceptRef: `test@1/${ref}`,
    sourceRef: sectionValue.sourceRef,
    sectionRef: sectionValue.ref,
    sectionConceptRef: sectionValue.conceptRef,
    sectionPath: sectionValue.sectionPath,
    label: "Evidence",
    section: sectionValue.label,
    page: null,
    kind: "text",
    content,
    keywords: [],
    ...overrides,
  };
}

describe("fielded evidence ranking", () => {
  it("normalizes Unicode, number words, units, and conservative plurals", () => {
    expect(queryTerms("Five YEARS’ policies are not 13 hrs.")).toEqual([
      "5",
      "year",
      "policy",
      "not",
      "13",
      "hour",
    ]);
  });

  it("uses token boundaries instead of substring matches", () => {
    const sectionValue = section("section:tools", ["Tools"]);
    const ranked = rankEvidenceCatalog(
      [sectionValue],
      [chunk("chunk:cleaver", "A cleaver is stored safely.", sectionValue)],
      {
        sourceRef: sourceA,
        query: "leave",
        resultLimit: 5,
        fieldWeights: BM25F_BODY_ONLY_WEIGHTS,
        structuralBoost: false,
      },
    );

    expect(ranked.results).toEqual([]);
  });

  it("uses source-local rarity to rank the discriminating term first", () => {
    const sectionValue = section("section:research", ["Research"]);
    const chunks = [
      chunk("chunk:common-a", "common common common result", sectionValue),
      chunk("chunk:common-b", "common background result", sectionValue),
      chunk("chunk:rare", "common zephyr result", sectionValue),
    ];

    const ranked = rankEvidenceCatalog([sectionValue], chunks, {
      sourceRef: sourceA,
      query: "common zephyr",
      resultLimit: 3,
      fieldWeights: BM25F_BODY_ONLY_WEIGHTS,
      structuralBoost: false,
    });

    expect(ranked.results[0].chunk.ref).toBe("chunk:rare");
  });

  it("indexes table headers, row labels, and cells as separate fields", () => {
    const sectionValue = section("section:leave", ["4.2 Annual Leave"]);
    const table = chunk("chunk:leave-table", "Accrual schedule.", sectionValue, {
      kind: "table",
      table: {
        headers: ["Completed service", "Annual hours", "Days"],
        rows: [["5-9 years", "104 hours", "13 days"]],
      },
    });

    const ranked = rankEvidenceCatalog([sectionValue], [table], {
      sourceRef: sourceA,
      query: "104 hours after five years",
      resultLimit: 1,
    });

    expect(ranked.results[0].chunk.ref).toBe("chunk:leave-table");
    expect(ranked.diagnostics.normalizedTerms).toContain("hour");
  });

  it("uses heading concepts to route descendants without returning headings as evidence", () => {
    const root = section("section:benefits", ["Employee Benefits"]);
    const parent = section(
      "section:family-leave",
      ["Employee Benefits", "7 Family Leave"],
      sourceA,
      root.ref,
    );
    const child = section(
      "section:request-process",
      ["Employee Benefits", "7 Family Leave", "7.1 Request Process"],
      sourceA,
      parent.ref,
    );
    const evidence = chunk(
      "chunk:request-form",
      "Employees submit the request form to Human Resources.",
      child,
    );
    const index = buildEvidenceSearchIndex([root, parent, child], [evidence]);

    const ranked = rankEvidenceCatalog([root, parent, child], [evidence], {
      sourceRef: sourceA,
      query: "family leave",
      resultLimit: 1,
      searchIndex: index,
    });

    expect(ranked.matchedSections[0].section.ref).toBe(parent.ref);
    expect(ranked.results[0].chunk.ref).toBe(evidence.ref);
    expect(ranked.diagnostics.structuralRoutingUsed).toBe(true);
  });

  it("never returns candidates from another selected source", () => {
    const first = section("section:first", ["First"], sourceA);
    const second = section("section:second", ["Second"], sourceB);
    const ranked = rankEvidenceCatalog(
      [first, second],
      [
        chunk("chunk:first", "unique evidence", first),
        chunk("chunk:second", "unique evidence", second),
      ],
      { sourceRef: sourceA, query: "unique evidence", resultLimit: 5 },
    );

    expect(ranked.results.map(({ chunk: result }) => result.ref)).toEqual([
      "chunk:first",
    ]);
  });

  it("excludes documents before applying candidate and result limits", () => {
    const sectionValue = section("section:scope", ["Scope"]);
    const chunks = [
      chunk("chunk:excluded", "target evidence", sectionValue),
      chunk("chunk:eligible", "target evidence", sectionValue),
    ];
    const ranked = rankEvidenceCatalog([sectionValue], chunks, {
      sourceRef: sourceA,
      query: "target evidence",
      resultLimit: 1,
      candidateLimit: 1,
      fieldWeights: BM25F_BODY_ONLY_WEIGHTS,
      structuralBoost: false,
      excludedChunkRefs: new Set(["chunk:excluded"]),
    });

    expect(ranked.results.map(({ chunk: result }) => result.ref)).toEqual(["chunk:eligible"]);
    expect(ranked.diagnostics.positiveCandidateCount).toBe(1);
    expect(ranked.diagnostics.positiveChunkRefs).toEqual(["chunk:eligible"]);
  });
});
