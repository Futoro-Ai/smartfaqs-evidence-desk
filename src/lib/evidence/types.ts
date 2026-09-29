import catalog from "@/data/okfCatalog.generated.json";

export const SOURCE_REFS = catalog.sources.map(({ ref }) => ref) as [
  string,
  ...string[],
];

export type SourceRef = (typeof SOURCE_REFS)[number];
export type EvidenceKind = "text" | "table";

export type KnowledgeSource = {
  ref: SourceRef;
  label: string;
  summary: string;
  owner: string;
  version: string;
  updatedAt: string;
  accent: "green" | "coral" | "gold";
  chunkCount: number;
  sectionCount: number;
};

export type SectionRollup = {
  directSectionCount: number;
  directEvidenceCount: number;
  descendantEvidenceCount: number;
  textCount: number;
  tableCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  descendantDigest: string;
};

export type KnowledgeSection = {
  ref: string;
  conceptRef: string;
  sourceRef: SourceRef;
  label: string;
  description: string;
  sectionPath: string[];
  depth: number;
  sourceOrder: number;
  structuralOrigin:
    | "authored"
    | "explicit_heading"
    | "inferred_from_heading_path";
  headingRecordCount: number;
  page: number | null;
  aliases: string[];
  keywords: string[];
  parentRef: string | null;
  rollup: SectionRollup;
};

export type EvidenceTable = {
  headers: string[];
  rows: string[][];
};

export type EvidenceChunk = {
  ref: string;
  conceptRef: string;
  sourceRef: SourceRef;
  sectionRef: string;
  sectionConceptRef: string;
  sectionPath: string[];
  label: string;
  section: string;
  page: number | null;
  kind: EvidenceKind;
  content: string;
  table?: EvidenceTable;
  keywords: string[];
};

export type EvidenceSearchResult = {
  chunkRef: string;
  conceptRef: string;
  sectionRef: string;
  sectionConceptRef: string;
  sectionPath: string[];
  label: string;
  section: string;
  page: number | null;
  kind: EvidenceKind;
  excerpt: string;
  score: number;
};

export type EvidencePacket = {
  packetVersion: "evidence-packet.v1";
  sourceLabel: string;
  answerPresent: boolean;
  evidenceCount: number;
  evidenceLabels: string[];
  decision: "pending" | "approved" | "rejected";
  boundaryStatus: "synthetic_public_data_only";
};
