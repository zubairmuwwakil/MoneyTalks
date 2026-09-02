import { handleMetadata, metadataOptions } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { handleMetadata as GET, metadataOptions as OPTIONS };
