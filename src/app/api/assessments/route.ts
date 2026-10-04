import { handleAssessmentPost } from "@/lib/assessment/http";
export const runtime = "nodejs";
export const maxDuration = 65;
export async function POST(request: Request): Promise<Response> {
  return handleAssessmentPost(request);
}
