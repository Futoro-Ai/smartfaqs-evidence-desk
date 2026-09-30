import { expect, it } from "vitest";

import { evaluateBrightRobotics } from "./bright-robotics-lib.mts";

it("excludes ineligible documents before BRIGHT scoring", () => {
  const result = evaluateBrightRobotics(
    [{ id: "excluded", content: "robotic arm calibration" },
      { id: "gold", content: "robotic arm calibration procedure" }],
    [{ id: "q1", query: "robotic arm calibration", excluded_ids: ["excluded"], gold_ids: ["gold"] }],
  );
  expect(result.bodyOnly.ndcgAt10).toBe(1);
  expect(result.bodyOnly.queryResults[0].firstRelevantRank).toBe(1);
});

it("rejects missing gold and overlap with excluded documents", () => {
  const documents = [{ id: "only", content: "robotics" }];
  expect(() => evaluateBrightRobotics(documents, [
    { id: "q1", query: "robotics", excluded_ids: [], gold_ids: ["absent"] },
  ])).toThrow("invalid_bright_gold:q1");
  expect(() => evaluateBrightRobotics(documents, [
    { id: "q1", query: "robotics", excluded_ids: ["only"], gold_ids: ["only"] },
  ])).toThrow("invalid_bright_gold:q1");
});

it("retains eligible evidence beyond the result cutoff", () => {
  const excludedIds = Array.from({ length: 1000 }, (_, index) => `excluded-${index}`);
  const result = evaluateBrightRobotics(
    [
      ...excludedIds.map((id) => ({ id, content: "robotic arm calibration" })),
      { id: "gold", content: "robotic arm calibration" },
    ],
    [{ id: "q1", query: "robotic arm calibration", excluded_ids: excludedIds, gold_ids: ["gold"] }],
  );
  expect(result.bodyOnly.queryResults[0].firstRelevantRank).toBe(1);
  expect(result.bodyOnly.queryResults[0].candidateCount).toBe(1);
});
