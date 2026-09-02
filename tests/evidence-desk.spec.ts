import { expect, test } from "@playwright/test";

type TestWebMcpTool = {
  execute: (input: unknown) => Promise<unknown>;
};

declare global {
  interface Window {
    __evidenceDeskTools: Record<string, TestWebMcpTool>;
  }
}

test("registers fixed WebMCP tools and reflects an agent call in the page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    > = {};
    Object.defineProperty(window, "__evidenceDeskTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(
          tool: { name: string; execute: (input: unknown) => Promise<unknown> },
          { signal }: { signal: AbortSignal },
        ) {
          tools[tool.name] = tool;
          signal.addEventListener(
            "abort",
            () => {
              if (tools[tool.name] === tool) delete tools[tool.name];
            },
            { once: true },
          );
        },
      },
    });
  });

  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe(
    "frame-ancestors 'none'",
  );
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByText("7 agent tools ready")).toBeVisible();

  const toolNames = await page.evaluate(() =>
    Object.keys(window.__evidenceDeskTools),
  );
  expect(toolNames).toEqual([
    "list_knowledge_sources",
    "select_knowledge_source",
    "check_evidence_readiness",
    "search_evidence",
    "read_evidence_chunk",
    "stage_evidence_answer",
    "export_evidence_packet",
  ]);

  await page.evaluate(async () => {
    const tools = window.__evidenceDeskTools;
    await tools.search_evidence.execute({
      sourceRef: "source:employee-handbook",
      query: "biweekly accrual method",
      limit: 2,
    });
  });

  await expect(page.getByLabel("Search bounded evidence")).toHaveValue(
    "biweekly accrual method",
  );
  await expect(page.getByText("Workspace updated from search evidence.")).toBeVisible();
  await expect(page.getByText("How leave is recorded", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await page.evaluate(async () => {
    const tools = window.__evidenceDeskTools;
    await tools.export_evidence_packet.execute({
      sourceRef: "source:employee-handbook",
      answer: "A pending agent packet.",
      evidenceRefs: ["chunk:leave-accrual-table"],
    });
  });
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByText("1 reference · pending")).toBeVisible();

  await page.evaluate(async () => {
    await window.__evidenceDeskTools.search_evidence.execute({
      sourceRef: "source:benefits-guide",
      query: "retirement match",
      limit: 2,
    });
  });
  await expect(page.getByText("Awaiting review", { exact: true })).toBeVisible();
  await expect(page.getByText("Select citations from the evidence pane.")).toBeVisible();
  await expect(page.getByText("Not prepared", { exact: true })).toBeVisible();
});

test("completes the bounded human review workflow", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Evidence Desk" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic public demo data")).toBeVisible();

  await page.getByLabel("Search bounded evidence").fill(
    "annual leave after five years",
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page.getByText("4 bounded evidence matches found.")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  await page.getByRole("button", { name: "Stage for review" }).click();
  await expect(page.getByText("2 citations staged for human review.")).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Prepare" }).click();
  await expect(page.getByText("2 references · approved")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
});

test("keeps source selection and evidence scoped on a narrow viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Distributed Work Standard/ }).click();

  await expect(page.getByText("Distributed Work Standard selected.")).toBeVisible();
  await expect(page.getByText("Distributed Work Standard", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("3 indexed excerpts")).toBeVisible();

  const bodyWidth = await page.locator("body").evaluate((element) =>
    Math.max(element.scrollWidth, element.getBoundingClientRect().width),
  );
  expect(bodyWidth).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});
