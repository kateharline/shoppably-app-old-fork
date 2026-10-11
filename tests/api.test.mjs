import assert from "node:assert/strict";
import { requestJson } from "../static/api.mjs";
import { createRequestId } from "../static/request-id.mjs";

assert.equal(createRequestId({ randomUUID: () => "native-id" }), "native-id");
const httpCrypto = { getRandomValues: bytes => globalThis.crypto.getRandomValues(bytes) };
const ids = Array.from({ length: 100 }, () => createRequestId(httpCrypto));
assert.ok(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
assert.equal(new Set(ids).size, ids.length);
console.log("Request IDs: native and HTTP fallback checks passed");

let signal;
globalThis.fetch = async (_path, options) => {
  signal = options.signal;
  return new Promise(() => {});
};
await assert.rejects(requestJson("/api/create", {}, 10), /Submission timed out/);
assert.equal(signal.aborted, true);
await assert.rejects(requestJson("/api/creation/job", {}, 10), /Check again/);

globalThis.fetch = async () => ({ ok: true, json: () => new Promise(() => {}) });
await assert.rejects(requestJson("/api/creation/job", {}, 10), /timed out/);
globalThis.fetch = async () => ({ ok: false, json: async () => ({ detail: "Arcade unavailable" }) });
await assert.rejects(requestJson("/api/create"), /Arcade unavailable/);
globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error("HTML"); } });
await assert.rejects(requestJson("/api/create"), /unreadable response/);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: "job-1" }) });
assert.deepEqual(await requestJson("/api/create"), { id: "job-1" });
console.log("6 API request regression checks passed");
