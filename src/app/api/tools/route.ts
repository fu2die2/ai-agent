import { listTools } from "@/lib/tools/registry";

export async function GET() {
  return Response.json({ tools: listTools() });
}
