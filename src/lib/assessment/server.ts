import { prepareAssessment } from "./core";
import { createJevAssessor } from "./jev";

let assessor: ReturnType<typeof createJevAssessor> | undefined;
export async function assessEvidenceClaim(input: unknown, signal?: AbortSignal) {
  const context = prepareAssessment(input);
  assessor ??= createJevAssessor({
    enabled: process.env.JEV_CLAIM_ASSESSMENT_ENABLED === "true",
    apiKey: process.env.JEV_API_KEY,
    maxReservedInputTokens: Number(process.env.JEV_ASSESSMENT_MAX_INPUT_TOKENS ?? 64_000),
    processReservedInputTokens: Number(process.env.JEV_ASSESSMENT_PROCESS_INPUT_TOKENS ?? 256_000),
  });
  return assessor(context, signal);
}
