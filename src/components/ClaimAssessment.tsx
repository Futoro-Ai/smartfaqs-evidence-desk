"use client";

import { Download, FileSearch, Layers, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestClaimAssessment, validateAssessmentResponse } from "@/lib/assessment/client";
import { assessmentInputSchema, balancedReviewRefs, reviewedReceipt, REVIEW_DECISIONS, SIGNALS,
  signalOrder, type AssessmentPacket, type ReviewDecision } from "@/lib/assessment/contracts";
import type { EvidenceSearchResult, SourceRef } from "@/lib/evidence/types";
import { ASSESSMENT_STARTED_EVENT, ASSESSMENT_CANCEL_EVENT } from "@/lib/webmcp/adapter";
import styles from "./ClaimAssessment.module.css";

const labels = { supports: "Support", contradicts: "Opposition", qualifies: "Qualifications", needs_context: "More context" };
const reasons: Record<string, string> = {
  assessment_disabled: "Assessment is not enabled on this server.",
  external_assessment_consent_required: "Permission to send this claim and its bounded passages is required.",
  provider_key_unavailable: "Assessment credentials are unavailable.",
  assessment_budget_exceeded: "The assessment budget is exhausted or too small for this evidence.",
  assessment_busy: "Another assessment is in progress. Try again shortly.",
  assessment_rate_limited: "The assessment limit has been reached. Try again in a minute.",
  provider_timeout: "The assessment timed out.",
  provider_auth_failed: "The assessment provider rejected its credentials.",
  provider_unavailable: "The assessment provider is unavailable.",
  provider_response_invalid: "The provider returned an invalid assessment.",
  provider_response_over_limit: "The provider response exceeded its limit.",
  assessment_cancelled: "Assessment cancelled.",
};

export default function ClaimAssessment({ sourceRef, results, onOpen, onSelect }: {
  sourceRef: SourceRef; results: EvidenceSearchResult[]; onOpen: (ref: string) => void;
  onSelect: (refs: string[]) => void;
}) {
  const [claim, setClaim] = useState("Full-time employees with 5-9 completed years receive 104 annual leave hours.");
  const [consent, setConsent] = useState(false);
  const [packet, setPacket] = useState<AssessmentPacket | null>(null);
  const [review, setReview] = useState<Record<string, ReviewDecision>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const agentRequest = useRef<{ requestId: string; version: number } | null>(null);
  const cancel = useCallback(() => {
    pending.current?.abort();
    const requestId = agentRequest.current?.requestId;
    agentRequest.current = null;
    if (requestId) window.dispatchEvent(new CustomEvent(ASSESSMENT_CANCEL_EVENT, { detail: { requestId } }));
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; cancel(); };
  }, [cancel]);

  useEffect(() => {
    function started(event: Event) {
      const detail = (event as CustomEvent).detail;
      const input = assessmentInputSchema.safeParse(detail?.input);
      if (!input.success || input.data.sourceRef !== sourceRef || typeof detail.requestId !== "string") return;
      cancel();
      const version = ++generation.current;
      agentRequest.current = { requestId: detail.requestId, version };
      setClaim(input.data.claim); setPacket(null); setReview({}); setBusy(true);
      setNotice("Agent assessment in progress.");
    }
    async function receive(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.name !== "assess_evidence_claim" || detail.input?.sourceRef !== sourceRef) return;
      const parsed = assessmentInputSchema.safeParse(detail.input);
      const active = agentRequest.current;
      if (!parsed.success || !active || active.requestId !== detail.requestId || active.version !== generation.current) return;
      const version = active.version;
      try {
        const result = await validateAssessmentResponse(parsed.data, detail.result);
        if (!alive.current || generation.current !== version || agentRequest.current !== active) return;
        agentRequest.current = null;
        setClaim(parsed.data.claim); setPacket(result); setReview({}); setBusy(false);
        setNotice("Agent assessment received. Human review is pending.");
      } catch {
        if (alive.current && generation.current === version && agentRequest.current === active) {
          agentRequest.current = null; setBusy(false);
          setNotice("Agent assessment could not be loaded.");
        }
      }
    }
    window.addEventListener(ASSESSMENT_STARTED_EVENT, started);
    window.addEventListener("evidence-desk:tool-result", receive);
    return () => {
      window.removeEventListener(ASSESSMENT_STARTED_EVENT, started);
      window.removeEventListener("evidence-desk:tool-result", receive);
    };
  }, [sourceRef, cancel]);

  async function assess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !claim.trim() || !results.length) return;
    cancel();
    pending.current = new AbortController();
    const version = ++generation.current;
    setBusy(true); setPacket(null); setReview({}); setNotice("");
    try {
      const next = await requestClaimAssessment({ sourceRef, claim,
        evidenceRefs: results.map((r) => r.chunkRef), allowExternalAssessment: consent }, pending.current.signal);
      if (alive.current && generation.current === version) {
        setPacket(next);
        setNotice(next.status === "assessed" ? "Assessment ready for human review." : reasons[next.failureReason ?? ""] ?? "Assessment unavailable.");
      }
    } catch {
      if (alive.current && generation.current === version) setNotice("Assessment could not be loaded. Try again.");
    } finally {
      if (alive.current && generation.current === version) setBusy(false);
    }
  }

  function download() {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(reviewedReceipt(packet, review), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "smartfaqs-claim-assessment.json"; link.click(); URL.revokeObjectURL(url);
  }

  return <section className={styles.section} aria-labelledby="claim-heading">
    <div className={styles.header}><div><h2 id="claim-heading">Claim review</h2><span>{results.length} retrieved passages in the selected source</span></div>
      {packet && <button type="button" title="Download assessment receipt" aria-label="Download assessment receipt" onClick={download}><Download size={17} /></button>}
    </div>
    <form className={styles.form} onSubmit={assess}>
      <label htmlFor="claim-input">Claim to check</label>
      <textarea id="claim-input" minLength={3} maxLength={500} value={claim} onChange={(event) => {
        cancel();
        generation.current++; setClaim(event.target.value); setPacket(null); setReview({}); setBusy(false); setNotice("");
      }} required />
      <div className={styles.controls}>
        <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Allow this claim and bounded passages to be sent to TypeSafe</label>
        <button type="submit" disabled={busy || claim.trim().length < 3 || results.length === 0}>
          {busy ? <LoaderCircle className={styles.spinner} size={16} /> : <FileSearch size={16} />}
          {busy ? "Assessing" : "Assess claim"}
        </button>
      </div>
    </form>
    <p className={styles.notice} role="status" aria-live="polite">{notice || "Human review pending."}</p>
    {packet && <>
      <div className={styles.receipt}>
        <span>{packet.passages.length} passages · advisory model signals · {packet.elapsedMs} ms{packet.cacheHit ? " · cached" : ""}</span>
        <span>{packet.workspace.complete ? "Assessment complete" : "Assessment incomplete"}</span>
      </div>
      {packet.status === "assessed" && <div className={styles.signals} aria-label="Independent evidence signals">
        {SIGNALS.map((signal) => <div key={signal} className={styles[signal]}>
          <h3>{labels[signal]}</h3>
          <ol>{signalOrder(packet.passages, signal).map((p) => <li key={p.chunkRef}>
            <button type="button" onClick={() => onOpen(p.chunkRef)}>{p.label}</button>
            <span>{Math.round(p.probabilities![signal] * 100)}%</span>
          </li>)}</ol>
        </div>)}
      </div>}
      <div className={styles.reviewList}>
        {packet.passages.map((p) => <div key={p.chunkRef}>
          <div><button type="button" onClick={() => onOpen(p.chunkRef)}>{p.label}</button>
            <span>{p.sectionPath.join(" > ")}{p.page ? ` · page ${p.page}` : ""}{p.truncated ? " · excerpt truncated" : ""}</span></div>
          <label><span className={styles.srOnly}>Review {p.label}</span><select value={review[p.chunkRef] ?? "unreviewed"}
            onChange={(event) => setReview({ ...review, [p.chunkRef]: event.target.value as ReviewDecision })}>
            {REVIEW_DECISIONS.map((decision) => <option key={decision} value={decision}>{decision === "unreviewed" ? "Not reviewed" : decision.replaceAll("_", " ")}</option>)}
          </select></label>
        </div>)}
      </div>
      {packet.status === "assessed" && <button type="button" className={styles.selection} onClick={() => onSelect(balancedReviewRefs(packet.passages))}>
        <Layers size={16} />Use a diverse review set
      </button>}
      {packet.comparisons.length > 0 && <div className={styles.comparisons}>
        <h3>Apparent disagreement checks</h3>
        {packet.comparisons.map((pair) => <p key={pair.rightRef}>{packet.passages.find((p) => p.chunkRef === pair.leftRef)?.label}
          {" / "}{packet.passages.find((p) => p.chunkRef === pair.rightRef)?.label}: <strong>{pair.relation.replaceAll("_", " ")}</strong></p>)}
      </div>}
      {packet.comparisonFailureReason && packet.status === "assessed" && <p className={styles.notice}>
        Comparison unavailable: {reasons[packet.comparisonFailureReason] ?? "additional context is required"}.
      </p>}
      <details className={styles.artifacts}><summary>Assessment receipt and handoffs</summary>
        {packet.workspace.artifacts.map((artifact) => <details key={artifact.name}><summary>{artifact.name}</summary><pre>{artifact.content}</pre></details>)}
      </details>
    </>}
  </section>;
}
