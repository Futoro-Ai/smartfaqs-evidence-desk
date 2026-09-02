"use client";

import {
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  FileSearch,
  FileText,
  Search,
  ShieldCheck,
  TableProperties,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { evidenceChunks, knowledgeSources } from "@/data/syntheticEvidence";
import {
  exportEvidencePacket,
  readEvidenceChunk,
  searchEvidence,
  selectKnowledgeSource,
  stageEvidenceAnswer,
} from "@/lib/capabilities/evidence";
import type { ToolName } from "@/lib/capabilities/contracts";
import { registerEvidenceDeskWebMcpTools } from "@/lib/webmcp/adapter";
import type {
  EvidenceChunk,
  EvidencePacket,
  EvidenceSearchResult,
  SourceRef,
} from "@/lib/evidence/types";
import styles from "./page.module.css";

type Decision = "pending" | "approved" | "rejected";

type ToolResultEvent = CustomEvent<{
  name: ToolName;
  input: Record<string, unknown>;
  result: unknown;
}>;

const INITIAL_SOURCE: SourceRef = "source:employee-handbook";
const INITIAL_QUERY = "annual leave";
const INITIAL_ANSWER =
  "Employees with 5-9 completed years of service receive 104 annual leave hours, equivalent to 13 days. Leave is credited in equal biweekly increments.";

function isSourceRef(value: unknown): value is SourceRef {
  return knowledgeSources.some((source) => source.ref === value);
}

function sourceFor(ref: SourceRef) {
  return knowledgeSources.find((source) => source.ref === ref) ?? knowledgeSources[0];
}

function chunkFor(ref: string, sourceRef: SourceRef) {
  return evidenceChunks.find(
    (chunk) => chunk.ref === ref && chunk.sourceRef === sourceRef,
  );
}

function demoSearch(sourceRef: SourceRef, query: string) {
  return searchEvidence({ sourceRef, query, limit: 4 }).results;
}

function decisionLabel(decision: Decision) {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  return "Awaiting review";
}

function decisionClass(decision: Decision) {
  if (decision === "approved") return styles.approved;
  if (decision === "rejected") return styles.rejected;
  return styles.pending;
}

export default function Home() {
  const [selectedSource, setSelectedSource] = useState<SourceRef>(INITIAL_SOURCE);
  const [query, setQuery] = useState(INITIAL_QUERY);
  const [results, setResults] = useState<EvidenceSearchResult[]>(() =>
    demoSearch(INITIAL_SOURCE, INITIAL_QUERY),
  );
  const [activeChunkRef, setActiveChunkRef] = useState("chunk:leave-accrual-table");
  const [citationRefs, setCitationRefs] = useState<string[]>([
    "chunk:leave-accrual-table",
    "chunk:leave-accrual-method",
  ]);
  const [answer, setAnswer] = useState(INITIAL_ANSWER);
  const [decision, setDecision] = useState<Decision>("pending");
  const [packet, setPacket] = useState<EvidencePacket | null>(null);
  const [notice, setNotice] = useState("Demo workspace ready for review.");
  const [webMcpStatus, setWebMcpStatus] = useState("Checking agent tools");

  const source = sourceFor(selectedSource);
  const activeChunk = useMemo(
    () =>
      chunkFor(activeChunkRef, selectedSource) ??
      evidenceChunks.find((chunk) => chunk.sourceRef === selectedSource),
    [activeChunkRef, selectedSource],
  );
  const citations = citationRefs
    .map((ref) => chunkFor(ref, selectedSource))
    .filter((chunk): chunk is EvidenceChunk => Boolean(chunk));

  function selectSource(sourceRef: SourceRef) {
    const selection = selectKnowledgeSource({ sourceRef });
    const nextResults = demoSearch(sourceRef, query);
    const firstChunk =
      nextResults[0]?.chunkRef ??
      evidenceChunks.find((chunk) => chunk.sourceRef === sourceRef)?.ref;
    setSelectedSource(selection.sourceRef);
    setResults(nextResults);
    setActiveChunkRef(firstChunk ?? "");
    setCitationRefs([]);
    setPacket(null);
    setDecision("pending");
    setNotice(`${selection.label} selected. Evidence scope reset.`);
  }

  function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      setNotice("Enter at least two characters to search the selected source.");
      return;
    }
    const search = searchEvidence({
      sourceRef: selectedSource,
      query: trimmedQuery,
      limit: 4,
    });
    setResults(search.results);
    setActiveChunkRef(search.results[0]?.chunkRef ?? "");
    setNotice(
      search.resultCount
        ? `${search.resultCount} bounded evidence ${search.resultCount === 1 ? "match" : "matches"} found.`
        : "No bounded evidence matches that query.",
    );
  }

  function openChunk(chunkRef: string) {
    const chunk = readEvidenceChunk({ sourceRef: selectedSource, chunkRef });
    setActiveChunkRef(chunk.chunkRef);
    setNotice(`${chunk.label} opened from the selected source.`);
  }

  function toggleCitation(chunkRef: string) {
    setCitationRefs((current) => {
      if (current.includes(chunkRef)) {
        setNotice("Citation removed from the staged answer.");
        return current.filter((ref) => ref !== chunkRef);
      }
      if (current.length >= 5) {
        setNotice("A staged answer can include up to five unique citations.");
        return current;
      }
      setNotice("Citation added to the staged answer.");
      return [...current, chunkRef];
    });
    setPacket(null);
    setDecision("pending");
  }

  function stageAnswer() {
    if (!answer.trim()) {
      setNotice("Write a concise answer before staging it for review.");
      return;
    }
    if (citationRefs.length === 0) {
      setNotice("Select at least one bounded evidence citation before staging.");
      return;
    }
    const staged = stageEvidenceAnswer({
      sourceRef: selectedSource,
      answer: answer.trim(),
      evidenceRefs: citationRefs,
    });
    setAnswer(staged.answer);
    setDecision("pending");
    setPacket(null);
    setNotice(
      `${staged.evidence.length} citation${staged.evidence.length === 1 ? "" : "s"} staged for human review.`,
    );
  }

  function setReviewDecision(nextDecision: Exclude<Decision, "pending">) {
    if (!answer.trim() || citationRefs.length === 0) {
      setNotice("Stage an answer with at least one citation before recording a decision.");
      return;
    }
    setDecision(nextDecision);
    setPacket(null);
    setNotice(`Human review marked this answer ${nextDecision}.`);
  }

  function createPacket() {
    if (!answer.trim() || citationRefs.length === 0) {
      setNotice("An answer and at least one citation are required to create a packet.");
      return;
    }
    const nextPacket = exportEvidencePacket({
      sourceRef: selectedSource,
      answer: answer.trim(),
      evidenceRefs: citationRefs,
      decision,
    });
    setPacket(nextPacket);
    setNotice("Evidence packet prepared from synthetic public demo data.");
  }

  async function copyPacket() {
    if (!packet) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
      setNotice("Evidence packet copied to the clipboard.");
    } catch {
      setNotice("Clipboard access was unavailable. Use Download instead.");
    }
  }

  function downloadPacket() {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "smartfaqs-evidence-packet.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Evidence packet download started.");
  }

  useEffect(() => {
    let unregister: () => void = () => undefined;
    let disposed = false;

    void registerEvidenceDeskWebMcpTools().then((registration) => {
      if (disposed) {
        registration.unregister();
        return;
      }

      unregister = registration.unregister;
      setWebMcpStatus(
        registration.status === "registered"
          ? `${registration.toolCount} agent tools ready`
          : "Agent tools unavailable",
      );
    });

    return () => {
      disposed = true;
      unregister();
    };
  }, []);

  useEffect(() => {
    function receiveToolResult(event: Event) {
      const toolEvent = event as ToolResultEvent;
      const { name, input, result } = toolEvent.detail ?? {};
      if (!name || !input || !result) return;
      const selectedRef = input.sourceRef ?? (result as { sourceRef?: unknown }).sourceRef;
      const sourceChanged =
        isSourceRef(selectedRef) && selectedRef !== selectedSource;

      if (
        sourceChanged &&
        (name === "select_knowledge_source" ||
          name === "search_evidence" ||
          name === "read_evidence_chunk" ||
          name === "stage_evidence_answer")
      ) {
        setCitationRefs([]);
        setPacket(null);
        setDecision("pending");
      }

      if (name === "select_knowledge_source" && isSourceRef(selectedRef)) {
        setSelectedSource(selectedRef);
        setResults(demoSearch(selectedRef, query));
      }
      if (name === "search_evidence") {
        const response = result as { results?: EvidenceSearchResult[]; query?: string };
        if (isSourceRef(selectedRef)) setSelectedSource(selectedRef);
        if (typeof response.query === "string") setQuery(response.query);
        if (Array.isArray(response.results)) {
          setResults(response.results);
          setActiveChunkRef(response.results[0]?.chunkRef ?? "");
        }
      }
      if (name === "read_evidence_chunk") {
        const response = result as { chunkRef?: unknown };
        if (isSourceRef(selectedRef)) setSelectedSource(selectedRef);
        if (typeof response.chunkRef === "string") setActiveChunkRef(response.chunkRef);
      }
      if (name === "stage_evidence_answer") {
        const response = result as {
          answer?: unknown;
          evidence?: Array<{ chunkRef?: unknown }>;
        };
        if (isSourceRef(selectedRef)) setSelectedSource(selectedRef);
        if (typeof response.answer === "string") setAnswer(response.answer);
        if (Array.isArray(response.evidence)) {
          setCitationRefs(
            response.evidence
              .map((item) => item.chunkRef)
              .filter((ref): ref is string => typeof ref === "string"),
          );
        }
        setDecision("pending");
        setPacket(null);
      }
      if (name === "export_evidence_packet") {
        const response = result as EvidencePacket;
        if (response.packetVersion === "evidence-packet.v1") {
          setPacket(response);
        }
      }
      setNotice(`Workspace updated from ${name.replaceAll("_", " ")}.`);
    }
    window.addEventListener("evidence-desk:tool-result", receiveToolResult);
    return () => window.removeEventListener("evidence-desk:tool-result", receiveToolResult);
  }, [query, selectedSource]);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true"><FileSearch size={19} strokeWidth={2.25} /></div>
          <div><p className={styles.eyebrow}>SmartFAQs</p><h1>Evidence Desk</h1></div>
        </div>
        <div className={styles.topbarStatus}>
          <div className={styles.agentStatus}><Bot size={16} aria-hidden="true" /><span>{webMcpStatus}</span></div>
          <div className={styles.boundary}><ShieldCheck size={16} aria-hidden="true" /><span>Synthetic public demo data</span></div>
        </div>
      </header>

      <p className={styles.liveNotice} role="status" aria-live="polite">{notice}</p>

      <section className={styles.workspace} aria-label="Evidence review workspace">
        <aside className={styles.sourcesPanel} aria-labelledby="sources-heading">
          <div className={styles.panelHeader}>
            <div><p className={styles.sectionKicker}>01 / Scope</p><h2 id="sources-heading">Knowledge sources</h2></div>
            <span className={styles.count}>{knowledgeSources.length}</span>
          </div>
          <div className={styles.sourceList} role="list">
            {knowledgeSources.map((item) => {
              const selected = item.ref === selectedSource;
              return <button className={`${styles.sourceItem} ${selected ? styles.sourceSelected : ""}`} key={item.ref} onClick={() => selectSource(item.ref)} type="button" aria-pressed={selected}>
                <span className={`${styles.sourceAccent} ${styles[item.accent]}`} aria-hidden="true" />
                <span className={styles.sourceInfo}>
                  <span className={styles.sourceTitle}>{item.label}</span>
                  <span className={styles.sourceSummary}>{item.summary}</span>
                  <span className={styles.sourceMeta}>{item.owner} · v{item.version}</span>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>;
            })}
          </div>
          <div className={styles.scopeNote}><BookOpen size={17} aria-hidden="true" /><div><strong>Bounded source scope</strong><span>{source.chunkCount} indexed excerpts from {source.updatedAt}</span></div></div>
        </aside>

        <section className={styles.evidencePanel} aria-labelledby="evidence-heading">
          <div className={styles.panelHeader}>
            <div><p className={styles.sectionKicker}>02 / Inspect</p><h2 id="evidence-heading">Evidence workspace</h2></div>
            <span className={styles.sourceBadge}>{source.label}</span>
          </div>
          <form className={styles.searchBar} onSubmit={runSearch} role="search">
            <label className={styles.srOnly} htmlFor="evidence-search">Search bounded evidence</label>
            <Search size={18} aria-hidden="true" />
            <input id="evidence-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this source" minLength={2} maxLength={160} />
            <button className={styles.searchButton} type="submit">Search</button>
          </form>
          <div className={styles.evidenceGrid}>
            <div className={styles.resultPane} aria-label="Search results">
              <div className={styles.subheader}><span>{results.length} result{results.length === 1 ? "" : "s"}</span><span>Max 4 shown</span></div>
              <div className={styles.resultList}>
                {results.length > 0 ? results.map((result) => <button className={`${styles.resultItem} ${result.chunkRef === activeChunk?.ref ? styles.resultActive : ""}`} key={result.chunkRef} onClick={() => openChunk(result.chunkRef)} type="button" aria-pressed={result.chunkRef === activeChunk?.ref}>
                  <span className={styles.resultIcon} aria-hidden="true">{result.kind === "table" ? <TableProperties size={16} /> : <FileText size={16} />}</span>
                  <span className={styles.resultContent}><span className={styles.resultTitle}>{result.label}</span><span className={styles.resultExcerpt}>{result.excerpt}</span><span className={styles.resultMeta}>{result.section} · p. {result.page}</span></span>
                </button>) : <p className={styles.emptyState}>No matching evidence in this source. Try a more specific policy term.</p>}
              </div>
            </div>
            <article className={styles.documentPane} aria-label="Selected bounded evidence">
              {activeChunk ? <>
                <div className={styles.documentHeader}>
                  <div><div className={styles.documentKind}>{activeChunk.kind === "table" ? <TableProperties size={15} /> : <FileText size={15} />}{activeChunk.kind === "table" ? "Table evidence" : "Text evidence"}</div><h3>{activeChunk.label}</h3></div>
                  <button className={`${styles.citationToggle} ${citationRefs.includes(activeChunk.ref) ? styles.citationSelected : ""}`} onClick={() => toggleCitation(activeChunk.ref)} type="button" aria-pressed={citationRefs.includes(activeChunk.ref)}>{citationRefs.includes(activeChunk.ref) ? <Check size={15} aria-hidden="true" /> : <ClipboardCheck size={15} aria-hidden="true" />}{citationRefs.includes(activeChunk.ref) ? "Cited" : "Add citation"}</button>
                </div>
                <p className={styles.documentMeta}>{activeChunk.section} · page {activeChunk.page}</p>
                <p className={styles.documentText}>{activeChunk.content}</p>
                {activeChunk.table && <div className={styles.tableWrap}><table><caption className={styles.srOnly}>{activeChunk.label}</caption><thead><tr>{activeChunk.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{activeChunk.table.rows.map((row) => <tr key={row.join("-")}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>}
                <div className={styles.documentFooter}><span>Reference: {activeChunk.ref}</span><span>Source-bounded</span></div>
              </> : <p className={styles.emptyState}>Choose a result to inspect its bounded evidence.</p>}
            </article>
          </div>
        </section>

        <aside className={styles.reviewPanel} aria-labelledby="review-heading">
          <div className={styles.panelHeader}><div><p className={styles.sectionKicker}>03 / Review</p><h2 id="review-heading">Staged answer</h2></div><span className={`${styles.decisionBadge} ${decisionClass(decision)}`}>{decisionLabel(decision)}</span></div>
          <label className={styles.answerLabel} htmlFor="staged-answer">Answer for review</label>
          <textarea id="staged-answer" className={styles.answerInput} value={answer} onChange={(event) => { setAnswer(event.target.value); setDecision("pending"); setPacket(null); }} maxLength={700} />
          <div className={styles.answerMeta}><span>{answer.length}/700</span><span>Human approval required</span></div>
          <div className={styles.citationArea}>
            <div className={styles.subheader}><span>Selected evidence</span><span>{citations.length}/5</span></div>
            {citations.length > 0 ? <ul className={styles.citationList}>{citations.map((chunk) => <li key={chunk.ref}><button type="button" onClick={() => openChunk(chunk.ref)}>{chunk.label} <span>p. {chunk.page}</span></button><button type="button" className={styles.removeCitation} onClick={() => toggleCitation(chunk.ref)} aria-label={`Remove ${chunk.label} citation`} title="Remove citation"><X size={15} aria-hidden="true" /></button></li>)}</ul> : <p className={styles.noCitations}>Select citations from the evidence pane.</p>}
          </div>
          <button className={styles.stageButton} type="button" onClick={stageAnswer}><ClipboardCheck size={17} aria-hidden="true" />Stage for review</button>
          <div className={styles.reviewActions} aria-label="Human review decision"><button className={styles.approveButton} type="button" onClick={() => setReviewDecision("approved")}><CheckCircle2 size={17} aria-hidden="true" />Approve</button><button className={styles.rejectButton} type="button" onClick={() => setReviewDecision("rejected")}><X size={17} aria-hidden="true" />Reject</button></div>
          <div className={styles.packetArea}>
            <div className={styles.packetHeader}><div><span>Evidence packet</span><small>{packet ? `${packet.evidenceCount} ${packet.evidenceCount === 1 ? "reference" : "references"} · ${packet.decision}` : "Not prepared"}</small></div><button className={styles.prepareButton} type="button" onClick={createPacket}>Prepare</button></div>
            <div className={styles.packetActions}><button type="button" onClick={copyPacket} disabled={!packet} title="Copy evidence packet"><Copy size={16} aria-hidden="true" />Copy</button><button type="button" onClick={downloadPacket} disabled={!packet} title="Download evidence packet"><Download size={16} aria-hidden="true" />Download</button></div>
          </div>
        </aside>
      </section>
      <footer className={styles.footer}><span>All sources and evidence shown here are synthetic public demonstration data.</span><span>Answers remain staged until a human reviewer records a decision.</span></footer>
    </main>
  );
}
