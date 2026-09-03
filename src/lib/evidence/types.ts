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
};

export type EvidenceTable = {
  headers: string[];
  rows: string[][];
};

export type EvidenceChunk = {
  ref: string;
  conceptRef: string;
  sourceRef: SourceRef;
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
