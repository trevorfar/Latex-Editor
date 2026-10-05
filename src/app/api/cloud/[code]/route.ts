import { getMeta } from "@/server/cloud/service";
import { codeParam, handle, limit } from "@/server/cloud/http";

export async function GET(request: Request, { params }: RouteContext<"/api/cloud/[code]">) {
  return handle(async () => {
    limit(request, "meta", 60);
    return getMeta(codeParam((await params).code));
  });
}
