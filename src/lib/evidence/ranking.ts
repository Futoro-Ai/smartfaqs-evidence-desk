import type {
  EvidenceChunk,
  KnowledgeSection,
  SourceRef,
} from "@/lib/evidence/types";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "does", "for", "how", "in", "is", "it",
  "of", "the", "to", "what",
]);

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20",
};

export type SearchField =
  | "body"
  | "title"
  | "keywords"
  | "answerQuestions"
  | "localHeading"
  | "ancestorHeadings"
  | "sectionAliases"
  | "sectionIdentifiers"
  | "tableHeaders"
  | "tableRowLabels"
  | "tableCells";

export type SearchFieldWeights = Record<SearchField, number>;

export const BM25F_BODY_ONLY_WEIGHTS: SearchFieldWeights = {
  body: 1,
  title: 0,
  keywords: 0,
  answerQuestions: 0,
  localHeading: 0,
  ancestorHeadings: 0,
  sectionAliases: 0,
  sectionIdentifiers: 0,
  tableHeaders: 0,
  tableRowLabels: 0,
  tableCells: 0,
};

export const BM25F_FIELD_WEIGHTS: SearchFieldWeights = {
  body: 1,
  title: 0.35,
  keywords: 1.75,
  answerQuestions: 0.75,
  localHeading: 0.45,
  ancestorHeadings: 0.1,
  sectionAliases: 2.5,
  sectionIdentifiers: 3.5,
  tableHeaders: 1.75,
  tableRowLabels: 1.25,
  tableCells: 0.9,
};

const SECTION_FIELD_WEIGHTS: SearchFieldWeights = {
  body: 0.7,
  title: 1.2,
  keywords: 1.75,
  answerQuestions: 0,
  localHeading: 1.2,
  ancestorHeadings: 0,
  sectionAliases: 2.5,
  sectionIdentifiers: 3.5,
  tableHeaders: 0,
  tableRowLabels: 0,
  tableCells: 0,
};

const FIELD_B: SearchFieldWeights = {
  body: 0.75,
  title: 0.35,
  keywords: 0.2,
  answerQuestions: 0,
  localHeading: 0.3,
  ancestorHeadings: 0.3,
  sectionAliases: 0.2,
  sectionIdentifiers: 0,
  tableHeaders: 0.3,
  tableRowLabels: 0.5,
  tableCells: 0.75,
};

const SEARCH_FIELDS = Object.keys(BM25F_FIELD_WEIGHTS) as SearchField[];
const BM25_K1 = 1.2;

type FieldTokens = Record<SearchField, string[]>;
type IndexedItem<Item> = {
  item: Item;
  sourceOrder: number;
  lengths: Record<SearchField, number>;
};
type Posting = Map<number, Partial<Record<SearchField, number>>>;
type ScopedSearchIndex = {
  chunks: IndexedItem<EvidenceChunk>[];
  sections: IndexedItem<KnowledgeSection>[];
  chunkPostings: Map<string, Posting>;
  sectionPostings: Map<string, Posting>;
  chunkAverageLengths: Record<SearchField, number>;
  sectionAverageLengths: Record<SearchField, number>;
  descendantChunkIndexes: Map<string, number[]>;
};

export type EvidenceSearchIndex = {
  bySource: Map<string, ScopedSearchIndex>;
};

export type RankEvidenceOptions = {
  sourceRef: SourceRef;
  query: string;
  resultLimit: number;
  sectionLimit?: number;
  candidateLimit?: number;
  structuralBoost?: boolean;
  fieldWeights?: SearchFieldWeights;
  hierarchyWeight?: number;
  searchIndex?: EvidenceSearchIndex;
  excludedChunkRefs?: ReadonlySet<string>;
};

function singularize(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(sses|ches|shes|xes|zes)$/.test(token)) {
    return token.slice(0, -2);
  }
  if (
    token.length > 3 && token.endsWith("s") && !token.endsWith("ss") &&
    !token.endsWith("us") && !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeToken(token: string): string {
  const numbered = NUMBER_WORDS[token] ?? token;
  const units: Record<string, string> = {
    hr: "hour", hrs: "hour", hours: "hour", days: "day",
    yrs: "year", years: "year",
  };
  return units[numbered] ?? singularize(numbered);
}

function tokenize(value: string): string[] {
  const matches = value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[’']/g, "")
    .match(/[\p{L}\p{N}]+/gu);
  if (!matches) return [];
  return matches.map(normalizeToken).filter(
    (term) => (term.length > 1 || /^\d$/.test(term)) && !STOP_WORDS.has(term),
  );
}

export function queryTerms(value: string): string[] {
  return [...new Set(tokenize(value))];
}

function emptyFields(): FieldTokens {
  return {
    body: [], title: [], keywords: [], answerQuestions: [], localHeading: [], ancestorHeadings: [],
    sectionAliases: [], sectionIdentifiers: [], tableHeaders: [],
    tableRowLabels: [], tableCells: [],
  };
}

function sectionIdentifierText(path: string[]): string {
  return path
    .map((heading) => heading.match(/^\s*([\p{N}]+(?:[.-][\p{N}]+)*)/u)?.[1] ?? "")
    .filter(Boolean)
    .join(" ");
}

function sectionFields(section: KnowledgeSection): FieldTokens {
  const fields = emptyFields();
  fields.body = tokenize(section.description);
  fields.title = tokenize(section.label);
  fields.keywords = tokenize(section.keywords.join(" "));
  fields.localHeading = tokenize(section.sectionPath.at(-1) ?? "");
  fields.ancestorHeadings = tokenize(section.sectionPath.slice(0, -1).join(" "));
  fields.sectionAliases = tokenize(section.aliases.join(" "));
  fields.sectionIdentifiers = tokenize(sectionIdentifierText(section.sectionPath));
  return fields;
}

function chunkFields(
  chunk: EvidenceChunk,
  section: KnowledgeSection | undefined,
): FieldTokens {
  const fields = emptyFields();
  fields.body = tokenize(chunk.content);
  fields.title = tokenize(chunk.label);
  fields.keywords = tokenize(chunk.keywords.join(" "));
  fields.answerQuestions = tokenize(chunk.answerQuestions?.join(" ") ?? "");
  fields.localHeading = tokenize(chunk.sectionPath.at(-1) ?? chunk.section);
  fields.ancestorHeadings = tokenize(chunk.sectionPath.slice(0, -1).join(" "));
  fields.sectionAliases = tokenize(section?.aliases.join(" ") ?? "");
  fields.sectionIdentifiers = tokenize(sectionIdentifierText(chunk.sectionPath));
  if (chunk.table) {
    fields.tableHeaders = tokenize(chunk.table.headers.join(" "));
    fields.tableRowLabels = tokenize(
      chunk.table.rows.map((row) => row[0] ?? "").join(" "),
    );
    fields.tableCells = tokenize(
      chunk.table.rows.map((row) => row.slice(1).join(" ")).join(" "),
    );
  }
  return fields;
}

function addIndexedItem<Item>(
  items: IndexedItem<Item>[],
  postings: Map<string, Posting>,
  item: Item,
  sourceOrder: number,
  fields: FieldTokens,
) {
  const itemIndex = items.length;
  const lengths = Object.fromEntries(
    SEARCH_FIELDS.map((field) => [field, fields[field].length]),
  ) as Record<SearchField, number>;
  items.push({ item, sourceOrder, lengths });

  for (const field of SEARCH_FIELDS) {
    const frequencies = new Map<string, number>();
    for (const term of fields[field]) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
    for (const [term, frequency] of frequencies) {
      const posting = postings.get(term) ?? new Map();
      const documentFields = posting.get(itemIndex) ?? {};
      documentFields[field] = frequency;
      posting.set(itemIndex, documentFields);
      postings.set(term, posting);
    }
  }
}

function averageLengths<Item>(items: IndexedItem<Item>[]) {
  return Object.fromEntries(
    SEARCH_FIELDS.map((field) => [
      field,
      items.length === 0
        ? 1
        : items.reduce((total, item) => total + item.lengths[field], 0) /
            items.length || 1,
    ]),
  ) as Record<SearchField, number>;
}

export function buildEvidenceSearchIndex(
  sections: KnowledgeSection[],
  chunks: EvidenceChunk[],
): EvidenceSearchIndex {
  const sourceRefs = new Set([
    ...sections.map(({ sourceRef }) => sourceRef),
    ...chunks.map(({ sourceRef }) => sourceRef),
  ]);
  const bySource = new Map<string, ScopedSearchIndex>();

  for (const sourceRef of sourceRefs) {
    const scopedSections = sections.filter((section) => section.sourceRef === sourceRef);
    const scopedChunks = chunks.filter((chunk) => chunk.sourceRef === sourceRef);
    const sectionByRef = new Map(scopedSections.map((section) => [section.ref, section]));
    const indexedSections: IndexedItem<KnowledgeSection>[] = [];
    const indexedChunks: IndexedItem<EvidenceChunk>[] = [];
    const sectionPostings = new Map<string, Posting>();
    const chunkPostings = new Map<string, Posting>();

    scopedSections.forEach((section) =>
      addIndexedItem(indexedSections, sectionPostings, section, section.sourceOrder, sectionFields(section)),
    );
    scopedChunks.forEach((chunk, sourceOrder) =>
      addIndexedItem(
        indexedChunks,
        chunkPostings,
        chunk,
        sourceOrder,
        chunkFields(chunk, sectionByRef.get(chunk.sectionRef)),
      ),
    );

    const descendantChunkIndexes = new Map(
      scopedSections.map((section) => [section.ref, [] as number[]]),
    );
    const sectionRefsByPath = new Map<string, string[]>();
    for (const section of scopedSections) {
      const pathKey = JSON.stringify(section.sectionPath);
      sectionRefsByPath.set(pathKey, [
        ...(sectionRefsByPath.get(pathKey) ?? []),
        section.ref,
      ]);
    }
    indexedChunks.forEach(({ item }, chunkIndex) => {
      for (let depth = 1; depth <= item.sectionPath.length; depth += 1) {
        const refs = sectionRefsByPath.get(
          JSON.stringify(item.sectionPath.slice(0, depth)),
        );
        refs?.forEach((ref) => descendantChunkIndexes.get(ref)?.push(chunkIndex));
      }
    });

    bySource.set(sourceRef, {
      chunks: indexedChunks,
      sections: indexedSections,
      chunkPostings,
      sectionPostings,
      chunkAverageLengths: averageLengths(indexedChunks),
      sectionAverageLengths: averageLengths(indexedSections),
      descendantChunkIndexes,
    });
  }
  return { bySource };
}

function scorePostings<Item>(
  terms: string[],
  items: IndexedItem<Item>[],
  postings: Map<string, Posting>,
  averageFieldLengths: Record<SearchField, number>,
  weights: SearchFieldWeights,
): Map<number, number> {
  const scores = new Map<number, number>();
  for (const term of terms) {
    const posting = postings.get(term);
    if (!posting) continue;
    const eligibleDocuments = [...posting.entries()].filter(([, fields]) =>
      SEARCH_FIELDS.some((field) => weights[field] > 0 && (fields[field] ?? 0) > 0),
    );
    if (eligibleDocuments.length === 0) continue;
    const idf = Math.log(
      1 + (items.length - eligibleDocuments.length + 0.5) /
        (eligibleDocuments.length + 0.5),
    );

    for (const [itemIndex, frequencies] of eligibleDocuments) {
      let weightedFrequency = 0;
      for (const field of SEARCH_FIELDS) {
        const frequency = frequencies[field] ?? 0;
        if (frequency === 0 || weights[field] === 0) continue;
        const normalizedLength =
          1 - FIELD_B[field] +
          FIELD_B[field] *
            (items[itemIndex].lengths[field] / averageFieldLengths[field]);
        weightedFrequency += (weights[field] * frequency) / normalizedLength;
      }
      const termScore =
        idf * ((BM25_K1 + 1) * weightedFrequency) /
        (BM25_K1 + weightedFrequency);
      scores.set(itemIndex, (scores.get(itemIndex) ?? 0) + termScore);
    }
  }
  return scores;
}

function roundedScore(value: number): number {
  return Number(value.toFixed(6));
}

export function rankEvidenceCatalog(
  sections: KnowledgeSection[],
  chunks: EvidenceChunk[],
  {
    sourceRef,
    query,
    resultLimit,
    sectionLimit = 3,
    candidateLimit = Math.max(100, resultLimit * 20),
    structuralBoost = true,
    fieldWeights = BM25F_FIELD_WEIGHTS,
    hierarchyWeight = 0.15,
    searchIndex,
    excludedChunkRefs,
  }: RankEvidenceOptions,
) {
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > 1_000) {
    throw new Error("invalid_result_limit");
  }
  if (!Number.isInteger(sectionLimit) || sectionLimit < 1 || sectionLimit > 100) {
    throw new Error("invalid_section_limit");
  }
  if (!Number.isInteger(candidateLimit) || candidateLimit < resultLimit || candidateLimit > 10_000) {
    throw new Error("invalid_candidate_limit");
  }
  if (!Number.isFinite(hierarchyWeight) || hierarchyWeight < 0 || hierarchyWeight > 1) {
    throw new Error("invalid_hierarchy_weight");
  }

  const index = searchIndex ?? buildEvidenceSearchIndex(sections, chunks);
  const scoped = index.bySource.get(sourceRef);
  const terms = queryTerms(query);
  if (!scoped || terms.length === 0) {
    return {
      matchedSections: [],
      results: [],
      diagnostics: {
        normalizedTerms: terms,
        positiveCandidateCount: 0,
        candidatePoolCount: 0,
        structuralRoutingUsed: false,
        positiveChunkRefs: [] as string[],
      },
    };
  }

  const effectiveWeights = {
    ...fieldWeights,
    ancestorHeadings: structuralBoost ? fieldWeights.ancestorHeadings : 0,
  };
  const chunkScores = scorePostings(
    terms,
    scoped.chunks,
    scoped.chunkPostings,
    scoped.chunkAverageLengths,
    effectiveWeights,
  );
  const sectionScores = scorePostings(
    terms,
    scoped.sections,
    scoped.sectionPostings,
    scoped.sectionAverageLengths,
    structuralBoost
      ? SECTION_FIELD_WEIGHTS
      : { ...SECTION_FIELD_WEIGHTS, ancestorHeadings: 0 },
  );
  const sortedSections = [...sectionScores.entries()].sort(
    ([leftIndex, leftScore], [rightIndex, rightScore]) =>
      rightScore - leftScore ||
      scoped.sections[leftIndex].sourceOrder - scoped.sections[rightIndex].sourceOrder,
  );
  const matchedSections = sortedSections.slice(0, sectionLimit).map(([indexValue, score]) => ({
    section: scoped.sections[indexValue].item,
    score: roundedScore(score),
  }));

  const positiveChunkRefs = [...chunkScores.keys()]
    .map((indexValue) => scoped.chunks[indexValue].item.ref)
    .filter((ref) => !excludedChunkRefs?.has(ref));
  const candidateScores = new Map(chunkScores);
  let structuralRoutingUsed = false;
  if (structuralBoost && hierarchyWeight > 0) {
    for (const [sectionIndex, sectionScore] of sortedSections.slice(0, sectionLimit)) {
      const section = scoped.sections[sectionIndex].item;
      if (section.depth <= 1) continue;
      const descendants = scoped.descendantChunkIndexes.get(section.ref) ?? [];
      for (const chunkIndex of descendants.slice(0, 20)) {
        const chunk = scoped.chunks[chunkIndex].item;
        const depthDistance = Math.max(0, chunk.sectionPath.length - section.depth);
        const boost = (sectionScore * hierarchyWeight) / (depthDistance + 1);
        candidateScores.set(chunkIndex, (candidateScores.get(chunkIndex) ?? 0) + boost);
        structuralRoutingUsed = true;
      }
    }
  }

  const candidates = [...candidateScores.entries()]
    .filter(([indexValue, score]) =>
      score > 0 && !excludedChunkRefs?.has(scoped.chunks[indexValue].item.ref))
    .sort(
      ([leftIndex, leftScore], [rightIndex, rightScore]) =>
        rightScore - leftScore ||
        (scoped.chunks[leftIndex].item.page ?? Number.MAX_SAFE_INTEGER) -
          (scoped.chunks[rightIndex].item.page ?? Number.MAX_SAFE_INTEGER) ||
        scoped.chunks[leftIndex].sourceOrder - scoped.chunks[rightIndex].sourceOrder,
    )
    .slice(0, candidateLimit);
  const results = candidates.slice(0, resultLimit).map(([indexValue, score]) => ({
    chunk: scoped.chunks[indexValue].item,
    score: roundedScore(score),
  }));

  return {
    matchedSections,
    results,
    diagnostics: {
      normalizedTerms: terms,
      positiveCandidateCount: positiveChunkRefs.length,
      candidatePoolCount: candidates.length,
      structuralRoutingUsed,
      positiveChunkRefs,
    },
  };
}
