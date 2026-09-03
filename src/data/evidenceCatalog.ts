import catalog from "@/data/okfCatalog.generated.json";
import type { EvidenceChunk, KnowledgeSource } from "@/lib/evidence/types";

// The checked-in catalog is generated from knowledge/northstar by npm run okf:compile.
export const knowledgeSources = catalog.sources as KnowledgeSource[];
export const evidenceChunks = catalog.chunks as EvidenceChunk[];
