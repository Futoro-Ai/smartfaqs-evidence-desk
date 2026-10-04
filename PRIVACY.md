# Privacy

SmartFAQs Evidence Desk is a public synthetic-data demonstration.

The application itself does not require an account, use a database, submit
content to SmartFAQs services, or intentionally collect personal information.
All displayed sources and evidence are fictional and committed in this
repository.

The hosting provider may process standard request metadata such as IP address,
user agent, request path, and timestamp under its own terms and privacy policy.
Do not enter personal, confidential, regulated, or customer information into
the demo.

Most remote MCP tool arguments are processed in memory for the request. Optional
claim assessment, if the backend is enabled and the caller explicitly consents,
sends the claim plus source-scoped passages (at most twenty, 1800 characters each)
to TypeSafe's JEV API. Its fixed rubrics are also transmitted. The provider's
processing/retention terms apply; do not put private information in a claim.
No provider key or gold label is sent as evidence or returned to the browser.

Complete assessment receipts may be cached in backend memory for up to five
minutes, with at most 128 entries per process. Receipts contain hashes, public
labels/references, probabilities, and timings, not raw claim or passage bodies.
Human corrections remain in browser state until downloaded. Downloaded receipts
and optional local ICM folders are controlled by the person, not persisted by
the hosted app. There is no application-level database, analytics, or durable
argument storage. See [Claim Assessment](docs/CLAIM_ASSESSMENT.md).
