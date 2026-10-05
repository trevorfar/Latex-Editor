import { createProject } from "@/server/cloud/service";
import { handle, limit } from "@/server/cloud/http";

export async function POST(request: Request) {
  return handle(async () => {
    limit(request, "create", 10);
    const body = await request.json();
    return { code: await createProject(String(body.tabId), String(body.name), body.meta) };
  });
}
