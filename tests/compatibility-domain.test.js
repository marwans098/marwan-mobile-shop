import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_LEVELS,
  MATCH_STATUSES,
  NO_RELIABLE_MATCH_MESSAGE,
  PART_TYPES,
  normalizeModel,
  normalizePartInput,
  normalizeProviderSearchResult,
  normalizeSku,
  overallMatchStatus
} from "../api/_lib/compatibility-domain.js";

test("normalizes model identifiers without inferring relationships", () => {
  assert.equal(normalizeModel("  SM-A546E "), "sm a546e");
  assert.equal(normalizeModel("Galaxy S24 Ultra"), "galaxy s24 ultra");
  assert.equal(normalizeSku(" ab- 12 "), "AB-12");
});

test("accepts the five requested part categories and multiple explicit models", () => {
  assert.deepEqual(Object.keys(PART_TYPES), ["cases", "screens", "charging_flex_ic", "fingerprint", "chargers_power"]);
  const part = normalizePartInput({
    type: "screens", name: "Display assembly", sku: "LCD-1",
    models: "SM-A546E\nSM-A546B", status: "possible"
  });
  assert.deepEqual(part.models, ["SM-A546E", "SM-A546B"]);
  assert.equal(part.status, "possible");
});

test("rejects unsupported categories and confirmed claims without evidence", () => {
  assert.throws(() => normalizePartInput({ type: "battery", name: "Battery", models: ["SM-X"] }), /غير مدعوم/);
  assert.throws(() => normalizePartInput({ type: "screens", name: "Screen", models: ["SM-X"], status: "confirmed" }), /مصدر موثوق/);
});

test("confirmed claims require an allowlisted source host and review evidence", () => {
  const oldHosts = process.env.COMPATIBILITY_TRUSTED_HOSTS;
  try {
    delete process.env.COMPATIBILITY_TRUSTED_HOSTS;
    const input = { type: "screens", name: "Screen", models: ["SM-X"], status: "confirmed", sourceName: "Repair source", sourceUrl: "https://parts.example/item", evidence: "Fitment table lists SM-X" };
    assert.throws(() => normalizePartInput({ ...input, sourceUrl: "http://parts.example/item" }), /اسم المصدر ورابطه/);
    assert.throws(() => normalizePartInput(input), /COMPATIBILITY_TRUSTED_HOSTS/);
    process.env.COMPATIBILITY_TRUSTED_HOSTS = "parts.example, trusted.example";
    assert.equal(normalizePartInput(input).status, "confirmed");
    assert.throws(() => normalizePartInput({ ...input, models: ["SM-X", "SM-Y"], deviceImageUrl: "https://images.example/phone.jpg" }), /موديل واحد فقط/);
  } finally {
    if (oldHosts === undefined) delete process.env.COMPATIBILITY_TRUSTED_HOSTS;
    else process.env.COMPATIBILITY_TRUSTED_HOSTS = oldHosts;
  }
});

test("reports confirmed, possible, and no reliable match distinctly", () => {
  assert.equal(MATCH_STATUSES.confirmed, "مطابق مؤكد");
  assert.equal(overallMatchStatus([]), "no_reliable_match");
  assert.equal(overallMatchStatus([{ status: "possible" }]), "possible");
  assert.equal(overallMatchStatus([{ status: "possible" }, { status: "confirmed" }]), "confirmed");
});

test("compatibility API validates search requests and returns explicit no-match labels", async () => {
  const { createCompatibilityHandler } = await import("../api/_lib/compatibility-http.js");
  let searchArgs;
  const provider = {
    initialize: async () => {},
    search: async (args) => { searchArgs = args; return { provider: "manager-curated", status: "no_reliable_match", records: [] }; },
    listAll: async () => [],
    upsert: async () => ({ partId: "p1", relations: [] }),
    remove: async () => true
  };
  const handler = createCompatibilityHandler({ getProvider: () => provider, getUserByToken: async () => null });
  const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const missing = response();
  await handler({ method: "GET", headers: {}, query: {} }, missing);
  assert.equal(missing.statusCode, 400);
  const invalid = response();
  await handler({ method: "GET", headers: {}, query: { type: "batteries", model: "SM-X" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const search = response();
  await handler({ method: "GET", headers: {}, query: { type: "screens", model: "SM-X", q: "LCD-1" } }, search);
  assert.equal(search.statusCode, 200);
  assert.deepEqual(searchArgs, { type: "screens", model: "SM-X", q: "LCD-1" });
  assert.equal(search.body.status, "no_reliable_match");
  assert.equal(search.body.labels.no_reliable_match, "لا يوجد تطابق موثوق");
});

test("compatibility API denies employees access to management operations", async () => {
  const { createCompatibilityHandler } = await import("../api/_lib/compatibility-http.js");
  let mutationCalled = false;
  const provider = { initialize: async () => {}, search: async () => ({}), listAll: async () => [], upsert: async () => { mutationCalled = true; }, remove: async () => false };
  const handler = createCompatibilityHandler({ getProvider: () => provider, getUserByToken: async () => ({ role: "موظف", username: "staff" }) });
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "POST", headers: { authorization: "Bearer staff-token" }, body: {} }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(mutationCalled, false);
});
test("compatibility API allows manager-managed upserts and records reviewer identity", async () => {
  const { createCompatibilityHandler } = await import("../api/_lib/compatibility-http.js");
  let receivedReviewer = "";
  const provider = {
    initialize: async () => {}, search: async () => ({}), listAll: async () => [], remove: async () => false,
    upsert: async (_input, reviewer) => { receivedReviewer = reviewer; return { partId: "part-1", relations: [{ id: "rel-1", model: "SM-X" }] }; }
  };
  const handler = createCompatibilityHandler({ getProvider: () => provider, getUserByToken: async (token) => token === "manager-token" ? ({ role: "مدير", username: "admin" }) : null });
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "POST", headers: { authorization: "Bearer manager-token" }, body: { type: "screens", name: "Screen", models: ["SM-X"] } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(receivedReviewer, "admin");
});
test("provider results without an approved source stay untrusted and say no reliable result", () => {
  const oldHosts = process.env.COMPATIBILITY_TRUSTED_HOSTS;
  try {
    delete process.env.COMPATIBILITY_TRUSTED_HOSTS;
    const normalized = normalizeProviderSearchResult({
      provider: "future-provider",
      records: [{
        part: { name: "Screen", type: "screens" },
        model: { name: "SM-X" },
        status: "confirmed",
        source: { name: "Unknown source", url: "https://unknown.example/item", updatedAt: "2026-01-01T00:00:00Z", evidence: "Claim" },
        confidence: { level: "high" }
      }]
    });
    assert.equal(normalized.status, "no_reliable_match");
    assert.equal(normalized.message, NO_RELIABLE_MATCH_MESSAGE);
    assert.deepEqual(normalized.records, []);
  } finally {
    if (oldHosts === undefined) delete process.env.COMPATIBILITY_TRUSTED_HOSTS;
    else process.env.COMPATIBILITY_TRUSTED_HOSTS = oldHosts;
  }
});

test("provider results require trusted provenance, update date, and confidence", () => {
  const oldHosts = process.env.COMPATIBILITY_TRUSTED_HOSTS;
  try {
    process.env.COMPATIBILITY_TRUSTED_HOSTS = "catalog.example";
    const record = {
      part: { name: "Screen", type: "screens", sku: "LCD-1" },
      model: { name: "SM-X" },
      status: "confirmed",
      source: { name: "Official catalog", url: "https://catalog.example/fitment/1", updatedAt: "2026-09-27T00:00:00Z", evidence: "Exact model and part mapping" },
      confidence: { level: "high" }
    };
    const accepted = normalizeProviderSearchResult({ provider: "official-api", records: [record] });
    assert.equal(accepted.status, "confirmed");
    assert.equal(accepted.records[0].confidence.label, CONFIDENCE_LEVELS.high);
    assert.equal(accepted.records[0].source.updatedAt, record.source.updatedAt);

    const untrustedUrl = normalizeProviderSearchResult({ provider: "official-api", records: [{ ...record, source: { ...record.source, url: "http://catalog.example/fitment/1" } }] });
    const missingDate = normalizeProviderSearchResult({ provider: "official-api", records: [{ ...record, source: { ...record.source, updatedAt: "" } }] });
    const lowConfidenceConfirmed = normalizeProviderSearchResult({ provider: "official-api", records: [{ ...record, confidence: { level: "medium" } }] });
    assert.equal(untrustedUrl.status, "no_reliable_match");
    assert.equal(missingDate.status, "no_reliable_match");
    assert.equal(lowConfidenceConfirmed.status, "no_reliable_match");
  } finally {
    if (oldHosts === undefined) delete process.env.COMPATIBILITY_TRUSTED_HOSTS;
    else process.env.COMPATIBILITY_TRUSTED_HOSTS = oldHosts;
  }
});

test("compatibility API publishes the stable no-source contract", async () => {
  const { createCompatibilityHandler } = await import("../api/_lib/compatibility-http.js");
  const provider = {
    initialize: async () => {},
    search: async () => ({ provider: "unconfigured", records: [{ part: { name: "Screen", type: "screens" }, model: { name: "SM-X" }, status: "confirmed", source: { name: "Unknown", url: "https://unknown.example/fitment", updatedAt: "2026-09-27T00:00:00Z", evidence: "Unsupported claim" }, confidence: { level: "high" } }] })
  };
  const handler = createCompatibilityHandler({ getProvider: () => provider, getUserByToken: async () => null });
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: "GET", headers: {}, query: { model: "SM-X" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.contractVersion, "1");
  assert.equal(response.body.message, "لا توجد نتيجة موثوقة حاليًا");
  assert.equal(response.body.status, "no_reliable_match");
  assert.deepEqual(response.body.records, []);
});