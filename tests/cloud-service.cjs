/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const data = new Map();
let collide = false;
const kv = {
  get: async k => data.get(k) ?? null,
  cas: async (k, expected, value) => {
    if ((data.get(k) ?? null) !== expected) return false;
    data.set(k, value);
    return true;
  },
  save: async o => {
    if (collide) { collide = false; return false; }
    if (data.get(o.metaKey) !== o.expectedMeta || data.get(o.presenceKey) !== o.expectedPresence) return false;
    const files = { ...(data.get(o.filesKey) ?? {}), ...o.put };
    for (const p of o.del) delete files[p];
    data.set(o.filesKey, files);
    data.set(o.metaKey, o.meta);
    return true;
  },
};
function load(file, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: id => { if (!(id in imports)) throw Error(id); return imports[id]; }, process, Date });
  return exports;
}
const types = { IDLE_LIMIT_MS: 600000, randomCode: () => "ABCDEFGH" };
const presence = load("src/server/cloud/presence.ts", { "@/lib/cloud-types": types });
const service = load("src/server/cloud/service.ts", {
  "server-only": {}, "./kv": { getKv: () => kv }, "./presence": presence,
  "@/lib/paths": { normalizePath: p => typeof p === "string" && p && !p.includes("..") ? p : null },
  "@/lib/types": { COMPILERS: [{ id: "pdflatex" }] }, "@/lib/cloud-types": types,
});
const meta = { name: "test", mainFile: "a.tex", compiler: "pdflatex", folders: [] };
const file = d => ({ k: "t", d, h: d, s: d.length });
const request = (tabId, path, mode = "queue") => ({ tabId, name: tabId, path, mode, active: true });
const save = (tabId, put) => service.save("ABCDEFGH", { tabId, name: tabId, meta, baseMeta: JSON.stringify(meta), put, del: [] });
(async () => {
  await service.createProject("alice", "Alice", meta);
  await save("alice", { "a.tex": file("a"), "b.tex": file("b") });
  assert.equal((await service.presence("ABCDEFGH", request("alice", "a.tex"))).status, "editing");
  assert.equal((await service.presence("ABCDEFGH", request("bob", "b.tex"))).status, "editing");
  assert.equal((await service.presence("ABCDEFGH", request("bob", "a.tex"))).status, "waiting");
  await save("alice", { "a.tex": file("A") });
  await save("bob", { "b.tex": file("B") });
  assert.equal((await service.getMeta("ABCDEFGH")).files["a.tex"].h, "A");
  assert.equal((await service.getMeta("ABCDEFGH")).files["b.tex"].h, "B");
  await assert.rejects(save("bob", { "a.tex": file("overwrite") }), e => e.status === 423);
  collide = true;
  await assert.rejects(save("alice", { "a.tex": file("collision") }), e => e.status === 409);
  assert.equal((await service.getMeta("ABCDEFGH")).files["a.tex"].h, "A");
  await service.presence("ABCDEFGH", request("alice", undefined, "leave"));
  assert.equal((await service.presence("ABCDEFGH", request("bob", "b.tex", "edit"))).status, "editing");
  assert.equal((await service.presence("ABCDEFGH", request("bob", "a.tex"))).status, "editing");
  console.log("Cloud service: parallel file editing, denied overwrite, atomic conflict, and independent release passed.");
})().catch(e => { console.error(e); process.exitCode = 1; });
