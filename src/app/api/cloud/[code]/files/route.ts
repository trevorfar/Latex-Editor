import { getFiles, save } from "@/server/cloud/service";
import { codeParam, handle, limit } from "@/server/cloud/http";
import type { SaveRequest } from "@/lib/cloud-types";

export const maxDuration = 30;

/** Fetch file contents: { paths } -> { files: { path: data | null } } */
export async function POST(request: Request, { params }: RouteContext<"/api/cloud/[code]/files">) {
  return handle(async () => {
    limit(request, "read", 120);
    const { paths } = (await request.json()) as { paths: string[] };
    return { files: await getFiles(codeParam((await params).code), Array.isArray(paths) ? paths.map(String) : []) };
  });
}

/** Save changes (lock holder only). */
export async function PUT(request: Request, { params }: RouteContext<"/api/cloud/[code]/files">) {
  return handle(async () => {
    limit(request, "save", 120);
    const body = (await request.json()) as SaveRequest;
    return { version: await save(codeParam((await params).code), body) };
  });
}
