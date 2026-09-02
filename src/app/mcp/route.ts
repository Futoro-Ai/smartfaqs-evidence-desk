import {
  handleMcpGet,
  handleMcpOptions,
  handleMcpPost,
} from "@/lib/mcp/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleMcpPost(request);
}

export function GET(request: Request): Response {
  return handleMcpGet(request);
}

export function OPTIONS(request: Request): Response {
  return handleMcpOptions(request);
}
