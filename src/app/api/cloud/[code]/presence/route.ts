import { presence } from "@/server/cloud/service";
import { codeParam, handle, limit } from "@/server/cloud/http";
import type { PresenceRequest } from "@/lib/cloud-types";

export async function POST(request: Request, { params }: RouteContext<"/api/cloud/[code]/presence">) {
  return handle(async () => {
    limit(request, "presence", 60);
    // sendBeacon posts text/plain, so parse the body manually.
    const body = JSON.parse(await request.text()) as PresenceRequest;
    const mode = ["view", "queue", "edit", "leave"].includes(body.mode) ? body.mode : "view";
    return presence(codeParam((await params).code), { tabId: String(body.tabId), name: String(body.name), mode, active: Boolean(body.active) });
  });
}
