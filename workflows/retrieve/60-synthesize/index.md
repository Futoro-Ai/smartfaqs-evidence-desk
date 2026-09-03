# 60 Synthesize

## Input

A caller-provided concise answer and one to five verified evidence references.

## Action

Stage the answer and citation metadata for review. Evidence Desk does not invoke
an LLM or silently generate an answer. An external agent may propose text, but
its proposal remains unapproved.

## Output

`staged_for_human_review` with source-scoped citation labels and concept
references.
