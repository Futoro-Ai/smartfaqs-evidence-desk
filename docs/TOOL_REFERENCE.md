# Tool Reference

The tool registry is closed: only the tools in this document are available.
All object schemas reject extra fields.

## `list_knowledge_sources`

Lists the three fictional source summaries compiled from the OKF bundle.

Input: empty object.

Output includes source reference, label, owner, version, summary, section count,
and chunk count.

## `select_knowledge_source`

Selects one source for the shared visible workflow.

Input:

```json
{ "sourceRef": "source:employee-handbook" }
```

This is a page-state action only. It does not grant access to another system.

## `check_evidence_readiness`

Reports structural-section and bounded text/table counts, whether structural
navigation is available, and whether citation labels are available for one
source.

Input:

```json
{ "sourceRef": "source:employee-handbook" }
```

## `search_evidence`

Searches one source using deterministic term scoring.

Input:

```json
{
  "sourceRef": "source:employee-handbook",
  "query": "annual leave after five years",
  "limit": 4
}
```

`query` is 2-160 characters. `limit` is 1-5.
The response includes up to three matching section concepts for navigation.
Each evidence result includes its stable `chunkRef`, revision-qualified OKF
`conceptRef`, section concept reference, and complete bounded heading path.

## `read_evidence_chunk`

Reads one bounded chunk after checking it belongs to the selected source. The
result includes both the stable `chunkRef` request key and a
revision-qualified, path-based `conceptRef` such as:

```text
northstar-demo@2026.3/employee-handbook/04-time-away/04-02-annual-leave/annual-leave-schedule
```

Input:

```json
{
  "sourceRef": "source:employee-handbook",
  "chunkRef": "chunk:leave-accrual-table"
}
```

A cross-source reference fails closed.

The result also carries the evidence concept's section reference and heading
ancestry. Section context helps explain where the chunk sits in the source, but
does not replace the chunk as factual evidence.

## `stage_evidence_answer`

Stages a draft answer for human review with one to five unique, source-scoped
evidence references.

Input:

```json
{
  "sourceRef": "source:employee-handbook",
  "answer": "Employees with 5-9 completed years receive 104 hours, or 13 days, of annual leave.",
  "evidenceRefs": ["chunk:leave-accrual-table"]
}
```

The output always states that human approval is required. Staged citation
metadata includes the OKF `conceptRef` for inspectability.

## `export_evidence_packet`

Returns a sanitized pending packet containing source/evidence labels, counts,
answer presence, and the synthetic-data boundary marker. Agent tools cannot
attach an approval or rejection decision.

Input:

```json
{
  "sourceRef": "source:employee-handbook",
  "answer": "Employees with 5-9 completed years receive 104 hours, or 13 days, of annual leave.",
  "evidenceRefs": ["chunk:leave-accrual-table"]
}
```

The packet does not contain raw chunk content. After a person records a review
decision, the interface's **Prepare** action can create a packet containing that
visible human decision. This compact demo packet is an illustrative summary,
not a signed attestation or a cryptographic binding to the answer text.
