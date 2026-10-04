import { ZodError } from "zod";
import { assessEvidenceClaim } from "./server";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function handleAssessmentPost(request: Request, assess = assessEvidenceClaim): Promise<Response> {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  let sameOrigin = false;
  try {
    const originUrl = new URL(origin ?? "");
    // Next may rewrite the URL hostname; the incoming Host remains the browser's destination.
    sameOrigin = origin === originUrl.origin && ["http:", "https:"].includes(originUrl.protocol) &&
      originUrl.protocol === requestUrl.protocol &&
      originUrl.host === (request.headers.get("host") ?? requestUrl.host);
  } catch {}
  if (!sameOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "forbidden_origin" }, { status: 403, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "json_required" }, { status: 415, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "invalid_input" }, { status: 400, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => {
    void reader.cancel().catch(() => {}); reject(new Error("body_timeout"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    while (true) {
      if (signal.aborted) throw new Error("body_timeout");
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new Error("body_timeout");
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return Response.json({ error: "input_over_limit" }, { status: 413, headers });
      chunks.push(value);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return Response.json(await assess(input, request.signal), { headers });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof ZodError;
    const outsideScope = error instanceof Error && error.message === "evidence_chunk_outside_selected_source";
    return Response.json({ error: outsideScope ? "evidence_chunk_outside_selected_source" : invalid ? "invalid_input" : "assessment_request_failed" },
      { status: invalid || outsideScope ? 400 : 503, headers });
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
}
