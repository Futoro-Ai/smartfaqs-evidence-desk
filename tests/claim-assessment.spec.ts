import { expect, test } from "@playwright/test";
import { prepareAssessment, attachWorkspace, emptyPacket } from "../src/lib/assessment/core";
import { RUBRIC_HASH } from "../src/lib/assessment/jev";
import { evidenceChunks } from "../src/data/evidenceCatalog";

test("shows unavailable assessments without inventing judgments", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Assess claim", exact: true }).click();
  await expect(page.getByText("Assessment is not enabled on this server.")).toBeVisible();
  await expect(page.getByText("Assessment incomplete", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Independent evidence signals")).toHaveCount(0);
  await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible();
});

test("reviews advisory signals and exports corrections without approving the answer", async ({ page }) => {
  let suppliedRefs: string[] = [];
  await page.route("**/api/assessments", async (route) => {
    const request = route.request().postDataJSON();
    // The test packet must match every retrieved ref just like the real adapter.
    const context = prepareAssessment(request);
    suppliedRefs = context.input.evidenceRefs;
    const receipt = emptyPacket(context, RUBRIC_HASH);
    receipt.status = "assessed"; receipt.failureReason = null; receipt.comparisonStatus = "not_needed";
    receipt.comparisonFailureReason = null;
    receipt.passages.forEach((p, i) => { p.probabilities = { supports: i ? 0.2 : 0.9, contradicts: i ? 0.8 : 0.1, qualifies: 0.5, needs_context: 0.3 }; });
    await route.fulfill({ json: attachWorkspace(receipt) });
  });
  await page.goto("/");
  await page.getByLabel("Allow this claim and bounded passages to be sent to TypeSafe").check();
  await page.getByRole("button", { name: "Assess claim", exact: true }).click();
  await expect(page.getByText("Assessment ready for human review.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opposition", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Review Annual leave schedule", exact: true }).selectOption("qualifies");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download assessment receipt" }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("smartfaqs-claim-assessment.json");
  const stream = await downloaded.createReadStream();
  const contents: Buffer[] = [];
  for await (const chunk of stream!) contents.push(Buffer.from(chunk));
  const receipt = JSON.parse(Buffer.concat(contents).toString("utf8"));
  expect(receipt.answerApproval).toBe("pending");
  expect(receipt.humanReview).toContainEqual({ chunkRef: "chunk:leave-accrual-table", decision: "qualifies" });
  const exported = JSON.stringify([receipt, ...receipt.workspace.artifacts.map((artifact: { content: string }) => JSON.parse(artifact.content))]);
  expect(suppliedRefs.length).toBeGreaterThan(0);
  for (const ref of suppliedRefs) {
    const chunk = evidenceChunks.find((candidate) => candidate.ref === ref)!;
    expect(exported).not.toContain(JSON.stringify(chunk.content).slice(1, -1));
  }
  expect(exported).not.toContain("Full-time employees with 5-9 completed years receive 104 annual leave hours.");
  await page.getByRole("button", { name: "Use a diverse review set" }).click();
  await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/claim-review-" + test.info().project.name + ".png", fullPage: true });
  await page.getByRole("button", { name: /Distributed Work Standard/ }).click();
  await expect(page.getByLabel("Independent evidence signals")).toHaveCount(0);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});

test("cancels a delayed assessment when the source changes", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/api/assessments", async (route) => {
    await gate;
    const receipt = emptyPacket(prepareAssessment(route.request().postDataJSON()), RUBRIC_HASH);
    await route.fulfill({ json: attachWorkspace(receipt) });
    delivered();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Assess claim", exact: true }).click();
  await expect(page.getByRole("button", { name: "Assessing", exact: true })).toBeVisible();
  const cancelled = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/api/assessments"));
  await page.getByRole("button", { name: /Distributed Work Standard/ }).click();
  expect((await cancelled).failure()?.errorText).toContain("ABORTED");
  release();
  await delivery;
  await expect(page.getByText("Human review pending.", { exact: true })).toBeVisible();
  await expect(page.getByText("Assessment incomplete", { exact: true })).toHaveCount(0);
});

test("ignores obsolete agent results after source A-B-A and after a newer human correction", async ({ page }) => {
  await page.goto("/");
  const input = { sourceRef: "source:employee-handbook", claim: "The allowance is 104 annual leave hours.",
    evidenceRefs: ["chunk:leave-accrual-table"], allowExternalAssessment: false };
  const packet = emptyPacket(prepareAssessment(input), RUBRIC_HASH);
  packet.status = "assessed"; packet.failureReason = null; packet.comparisonStatus = "not_needed";
  packet.comparisonFailureReason = null; packet.passages[0].probabilities = {
    supports: 0.9, contradicts: 0.1, qualifies: 0.5, needs_context: 0.2 };
  const result = attachWorkspace(packet);
  const start = (requestId: string) => page.evaluate(({ requestId, input }) => {
    window.dispatchEvent(new CustomEvent("evidence-desk:assessment-started", { detail: { requestId, input } }));
  }, { requestId, input });
  const complete = (requestId: string) => page.evaluate(({ requestId, input, result }) => {
    window.dispatchEvent(new CustomEvent("evidence-desk:tool-result",
      { detail: { name: "assess_evidence_claim", requestId, input, result } }));
  }, { requestId, input, result });
  await start("old-request");
  await page.getByRole("button", { name: /Distributed Work Standard/ }).click();
  await page.getByRole("button", { name: /Northstar Employee Handbook/ }).click();
  await complete("old-request");
  await expect(page.getByLabel("Independent evidence signals")).toHaveCount(0);
  await start("new-request");
  await complete("new-request");
  await expect(page.getByLabel("Independent evidence signals")).toBeVisible();
  await page.getByRole("combobox", { name: "Review Annual leave schedule", exact: true }).selectOption("qualifies");
  await complete("old-request");
  await complete("new-request");
  await expect(page.getByRole("combobox", { name: "Review Annual leave schedule", exact: true })).toHaveValue("qualifies");
  await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible();
});
