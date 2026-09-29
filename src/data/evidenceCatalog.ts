import catalog from "@/data/okfCatalog.generated.json";
import type {
  EvidenceChunk,
  KnowledgeSection,
  KnowledgeSource,
} from "@/lib/evidence/types";

// The checked-in catalog is generated from knowledge/northstar by npm run okf:compile.
export const knowledgeSources = catalog.sources as KnowledgeSource[];
export const knowledgeSections = catalog.sections as KnowledgeSection[];
export const evidenceChunks = catalog.chunks as EvidenceChunk[];
