/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const source = fs.readFileSync("src/server/cloud/presence.ts", "utf8");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: exportsObject,
  require: () => ({ IDLE_LIMIT_MS: 600000 }),
});
const { stepPresence, EMPTY_PRESENCE } = exportsObject;
const request = (tabId, mode = "queue") => ({ tabId, name: tabId, mode, active: true });
const a = stepPresence(EMPTY_PRESENCE, request("alice"), 1000, 1);
assert.equal(a.res.status, "editing");
const b = stepPresence(a.next, request("bob"), 2000, 1);
assert.equal(b.res.status, "waiting");
assert.equal(b.res.holder, "alice");
assert.equal(stepPresence(EMPTY_PRESENCE, request("bob"), 2000, 1).res.status, "editing");
const released = stepPresence(b.next, request("alice", "leave"), 3000, 1);
assert.equal(stepPresence(released.next, request("bob"), 4000, 1).res.status, "editing");
assert.equal(stepPresence(a.next, request("bob"), 72000, 1).res.status, "editing");
assert.equal(stepPresence(a.next, request("alice", "edit"), 72000, 1).res.status, "expired");
console.log("Presence: exclusive ownership, independent files, queue handoff, lease expiry passed.");
