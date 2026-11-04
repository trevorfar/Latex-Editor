import "server-only";
import { getKv } from "./kv";
import { CloudError, getMeta, PROJECT_TTL_S, cleanName } from "./service";
import type { CloudComment, CommentRect, CommentRequest, CommentsDoc, CommentStatus } from "@/lib/cloud-types";

const MAX_COMMENTS = 500;
const MAX_REPLIES = 100;
const MAX_BODY = 2000;
const MAX_QUOTE = 1000;
const MAX_RECTS = 200;

export const commentsKey = (code: string) => `tb:${code}:comments`;

const EMPTY: CommentsDoc = { version: 0, comments: [] };

function kvOrThrow() {
  const kv = getKv();
  if (!kv) throw new CloudError(503, "Cloud saving isn't set up on this server (no Upstash Redis credentials).");
  return kv;
}

function text(value: unknown, max: number, what: string): string {
  const s = String(value ?? "").trim().slice(0, max);
  if (!s) throw new CloudError(400, `The ${what} is empty.`);
  return s;
}

function cleanRects(raw: unknown): CommentRect[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new CloudError(400, "Select some text in the PDF to comment on.");
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN);
  const rects = raw.slice(0, MAX_RECTS).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { page: Math.trunc(num(o.page)), x: num(o.x), y: num(o.y), w: num(o.w), h: num(o.h) };
  });
  if (rects.some((r) => !(r.page >= 1) || [r.x, r.y, r.w, r.h].some(Number.isNaN) || r.w < 0 || r.h < 0)) {
    throw new CloudError(400, "Bad highlight position.");
  }
  return rects;
}

const id = () => crypto.randomUUID().slice(0, 12);

export async function getComments(code: string): Promise<CommentsDoc> {
  const raw = await kvOrThrow().get(commentsKey(code));
  if (raw) return JSON.parse(raw) as CommentsDoc;
  await getMeta(code); // 404 for unknown projects.
  return EMPTY;
}

function apply(doc: CommentsDoc, req: CommentRequest, author: string, now: number): CommentsDoc {
  const find = (commentId: unknown): CloudComment => {
    const c = doc.comments.find((x) => x.id === commentId);
    if (!c) throw new CloudError(404, "That comment was deleted.");
    return c;
  };
  const replace = (c: CloudComment) => doc.comments.map((x) => (x.id === c.id ? c : x));
  switch (req.action) {
    case "add": {
      if (doc.comments.length >= MAX_COMMENTS) throw new CloudError(413, `Projects are limited to ${MAX_COMMENTS} comments. Delete some resolved ones first.`);
      const comment: CloudComment = {
        id: id(),
        author,
        createdAt: now,
        quote: text(req.quote, MAX_QUOTE, "highlighted text"),
        rects: cleanRects(req.rects),
        body: text(req.body, MAX_BODY, "comment"),
        replies: [],
        status: "open",
      };
      return { version: doc.version + 1, comments: [...doc.comments, comment] };
    }
    case "reply": {
      const c = find(req.id);
      if (c.replies.length >= MAX_REPLIES) throw new CloudError(413, "This thread has too many replies.");
      const reply = { id: id(), author, body: text(req.body, MAX_BODY, "reply"), createdAt: now };
      return { version: doc.version + 1, comments: replace({ ...c, replies: [...c.replies, reply] }) };
    }
    case "status": {
      const c = find(req.id);
      const status: CommentStatus = req.status === "accepted" || req.status === "rejected" ? req.status : "open";
      const next: CloudComment = status === "open" ? { ...c, status, resolvedBy: undefined, resolvedAt: undefined } : { ...c, status, resolvedBy: author, resolvedAt: now };
      return { version: doc.version + 1, comments: replace(next) };
    }
    case "delete":
      find(req.id);
      return { version: doc.version + 1, comments: doc.comments.filter((x) => x.id !== req.id) };
    default:
      throw new CloudError(400, "Unknown comment action.");
  }
}

/** Applies one change with compare-and-set, so simultaneous commenters never overwrite each other. */
export async function updateComments(code: string, req: CommentRequest): Promise<CommentsDoc> {
  const kv = kvOrThrow();
  await getMeta(code);
  const author = cleanName(req.name);
  for (let attempt = 0; attempt < 8; attempt++) {
    const raw = await kv.get(commentsKey(code));
    const doc = raw ? (JSON.parse(raw) as CommentsDoc) : EMPTY;
    const next = apply(doc, req, author, Date.now());
    if (await kv.cas(commentsKey(code), raw, JSON.stringify(next), PROJECT_TTL_S)) return next;
  }
  throw new CloudError(409, "Lots of people are commenting at once. Try again.");
}
