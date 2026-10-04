// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ClaimAssessment from "@/components/ClaimAssessment";
import { validateAssessmentResponse } from "./client";
import { attachWorkspace, emptyPacket, prepareAssessment } from "./core";
import { RUBRIC_HASH } from "./jev";
import type { AssessmentPacket } from "./contracts";

vi.mock("./client", () => ({ validateAssessmentResponse: vi.fn(), requestClaimAssessment: vi.fn() }));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.resetAllMocks(); vi.unstubAllGlobals();
});

it.each(["resolve", "reject"])("preserves a human correction after a concurrent duplicate %s", async (completion) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const input = { sourceRef: "source:employee-handbook", claim: "The allowance is 104 hours.",
    evidenceRefs: ["chunk:leave-accrual-table"], allowExternalAssessment: false };
  const packet = attachWorkspace(emptyPacket(prepareAssessment(input), RUBRIC_HASH));
  const pending: { resolve: (p: AssessmentPacket) => void; reject: (error: Error) => void }[] = [];
  vi.mocked(validateAssessmentResponse).mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ClaimAssessment, {
    sourceRef: "source:employee-handbook", results: [], onOpen: vi.fn(), onSelect: vi.fn(),
  })));
  await act(async () => {
    window.dispatchEvent(new CustomEvent("evidence-desk:assessment-started", { detail: { input, requestId: "same-request" } }));
    for (let i = 0; i < 2; i++) window.dispatchEvent(new CustomEvent("evidence-desk:tool-result", {
      detail: { input, requestId: "same-request", name: "assess_evidence_claim", result: packet },
    }));
  });
  expect(pending).toHaveLength(2);
  await act(async () => pending[0].resolve(packet));
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "qualifies"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => {
    if (completion === "resolve") pending[1].resolve(packet);
    else pending[1].reject(new Error("delayed invalid packet"));
  });
  expect(select.value).toBe("qualifies");
  expect(container.textContent).toContain("Agent assessment received. Human review is pending.");
});
