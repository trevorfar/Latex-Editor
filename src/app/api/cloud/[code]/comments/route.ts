import { getComments, updateComments } from "@/server/cloud/comments";
import { codeParam, handle, limit } from "@/server/cloud/http";
import type { CommentRequest } from "@/lib/cloud-types";

/** All comments. `?since=N` returns only the version when nothing changed, to keep polling cheap. */
export async function GET(request: Request, { params }: RouteContext<"/api/cloud/[code]/comments">) {
  return handle(async () => {
    limit(request, "comments-read", 120);
    const doc = await getComments(codeParam((await params).code));
    const since = Number(new URL(request.url).searchParams.get("since"));
    return since === doc.version ? { version: doc.version } : doc;
  });
}

/** Add, reply, accept/reject/reopen, or delete. Anyone with the code can comment; no editing lock needed. */
export async function POST(request: Request, { params }: RouteContext<"/api/cloud/[code]/comments">) {
  return handle(async () => {
    limit(request, "comments-write", 60);
    const body = (await request.json()) as CommentRequest;
    return updateComments(codeParam((await params).code), body);
  });
}
