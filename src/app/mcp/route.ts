import { handleMcp } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export { handleMcp as POST, handleMcp as GET, handleMcp as OPTIONS };
