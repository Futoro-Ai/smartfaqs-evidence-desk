# Demo Script

Target length: 2 minutes 30 seconds. Keep the final public video under the
challenge's three-minute limit.

## 0:00-0:20 - Product

Show the complete Evidence Desk. State:

> SmartFAQs Evidence Desk lets a person and an agent investigate the same
> synthetic source through one visible, bounded workflow.

Point out source selection, evidence workspace, and human review panel.

## 0:20-1:20 - WebMCP Workflow

Ask the agent:

```text
Select the Northstar Employee Handbook. Check readiness, then find the annual
leave allowance and accrual method for an employee with five completed years.
Stage an answer with the evidence you used and stop for my approval.
```

Show these visible transitions:

1. source selected;
2. readiness confirmed;
3. table and text evidence returned;
4. bounded chunks inspected;
5. answer staged with evidence labels.

## 1:20-1:45 - Human Control

Explain that the agent cannot approve its own answer. Approve the answer in the
UI, then export the sanitized packet. Show that the packet contains labels and
counts rather than raw evidence bodies.

## 1:45-2:10 - MCP Reuse

Show `/mcp` responding to initialization or `tools/list`. Explain that the
browser and remote MCP endpoint share the same schemas and capability
implementations.

## 2:10-2:30 - Boundaries and Close

Show the open-source repository and Apache-2.0 license. State:

> The application uses only repository-local synthetic data. It exposes no
> generic executor, credentials, production service, or private customer data.

End on the working application and live URL.
