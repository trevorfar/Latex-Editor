/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: (id) => {
      if (!(id in imports)) throw Error(id);
      return imports[id];
    },
    crypto,
    Date,
  });
  return exports;
}

// ----- service: add, reply, accept/reject/reopen, delete, concurrent writers -----
const data = new Map([["tb:ABCDEFGH:meta", "{}"]]);
let race = 0;
const kv = {
  get: async (k) => data.get(k) ?? null,
  cas: async (k, expected, value) => {
    // Simulate another commenter writing first.
    if (race > 0) {
      race--;
      const other = JSON.parse(data.get(k) ?? '{"version":0,"comments":[]}');
      data.set(k, JSON.stringify({ version: other.version + 1, comments: other.comments }));
      return false;
    }
    if ((data.get(k) ?? null) !== expected) return false;
    data.set(k, value);
    return true;
  },
};
class CloudError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const comments = load("src/server/cloud/comments.ts", {
  "server-only": {},
  "./kv": { getKv: () => kv },
  "./service": {
    CloudError,
    PROJECT_TTL_S: 1,
    cleanName: (n) => String(n ?? "").trim() || "Someone",
    getMeta: async (code) => {
      if (!data.has(`tb:${code}:meta`)) throw new CloudError(404, "missing");
      return {};
    },
  },
});

const rects = [{ page: 1, x: 10, y: 20, w: 100, h: 12 }];
(async () => {
  assert.equal(JSON.stringify(await comments.getComments("ABCDEFGH")), JSON.stringify({ version: 0, comments: [] }));
  await assert.rejects(comments.getComments("ZZZZZZZZ"), (e) => e.status === 404);

  let doc = await comments.updateComments("ABCDEFGH", { action: "add", name: "Alice", quote: "a sentence", rects, body: "Reword this?" });
  const id = doc.comments[0].id;
  assert.equal(doc.comments[0].author, "Alice");
  assert.equal(doc.comments[0].status, "open");

  race = 2;
  doc = await comments.updateComments("ABCDEFGH", { action: "reply", name: "Bob", id, body: "Agreed" });
  assert.equal(doc.comments[0].replies[0].author, "Bob");

  doc = await comments.updateComments("ABCDEFGH", { action: "status", name: "Bob", id, status: "accepted" });
  assert.equal(doc.comments[0].status, "accepted");
  assert.equal(doc.comments[0].resolvedBy, "Bob");
  doc = await comments.updateComments("ABCDEFGH", { action: "status", name: "Alice", id, status: "open" });
  assert.equal(doc.comments[0].resolvedBy, undefined);
  doc = await comments.updateComments("ABCDEFGH", { action: "status", name: "Alice", id, status: "rejected" });
  assert.equal(doc.comments[0].status, "rejected");

  await assert.rejects(comments.updateComments("ABCDEFGH", { action: "add", name: "A", quote: "x", rects, body: "  " }), (e) => e.status === 400);
  await assert.rejects(comments.updateComments("ABCDEFGH", { action: "add", name: "A", quote: "x", rects: [{ page: 0, x: 1, y: 1, w: 1, h: 1 }], body: "b" }), (e) => e.status === 400);
  await assert.rejects(comments.updateComments("ZZZZZZZZ", { action: "add", name: "A", quote: "x", rects, body: "b" }), (e) => e.status === 404);

  doc = await comments.updateComments("ABCDEFGH", { action: "delete", name: "Alice", id });
  assert.equal(doc.comments.length, 0);
  await assert.rejects(comments.updateComments("ABCDEFGH", { action: "reply", name: "Bob", id, body: "late" }), (e) => e.status === 404);

  // ----- anchoring: the quote is found again after the text moves -----
  const { locateQuote } = load("src/lib/comment-anchor.ts", {});
  const box = [0, 0, 612, 792];
  const page = (items) => ({ items: items.map(([str, x, y]) => ({ str, x, y, w: str.length * 5, h: 10 })) });
  const quote = "quick brown fox";
  const before = [page([["The quick brown fox jumps.", 72, 700]])];
  const hint = locateQuote(before, [box], quote, rects);
  assert.equal(hint.length, 1);
  assert.equal(hint[0].page, 1);
  assert.equal(Math.round(hint[0].x), 72 + 4 * 5);

  // After a recompile the sentence moved to page 2 and wraps across two lines.
  const after = [page([["Intro text.", 72, 700]]), page([["Then the quick", 72, 500], ["brown fox jumps.", 72, 486]])];
  const moved = locateQuote(after, [box, box], quote, hint);
  assert.equal(moved.length, 2);
  assert.ok(moved.every((r) => r.page === 2));
  assert.ok(moved[0].y < moved[1].y);

  // Two occurrences: pick the one nearest the original spot.
  const twice = [page([["quick brown fox", 72, 700], ["quick brown fox", 72, 300]])];
  const near = locateQuote(twice, [box], quote, [{ page: 1, x: 72, y: 792 - 300 - 8, w: 75, h: 11 }]);
  assert.ok(Math.abs(near[0].y - (792 - 300 - 8.2)) < 1);

  assert.equal(locateQuote(after, [box, box], "deleted sentence", hint), null);
  console.log("Comments: add, reply, accept/reject/reopen, delete, concurrent writes, validation and re-anchoring passed.");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
