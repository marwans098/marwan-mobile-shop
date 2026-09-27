import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceRecognitionHandler, parseDeviceImage } from "../api/_lib/device-recognition-http.js";
import { emptyDeviceRecognition, OpenAIDeviceRecognitionProvider, sanitizeDeviceRecognition } from "../api/_lib/device-recognition-provider.js";

const onePixelPng = "data:image/png;base64,iVBORw0KGgo=";
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function sampleObservation(overrides = {}) {
  return {
    manufacturer: "SAMSUNG",
    deviceName: "Galaxy A54",
    model: "SM-A546E",
    modelNumber: "SM-A546E",
    identificationConfidence: "high",
    identificationEvidence: "SAMSUNG Galaxy A54 model SM-A546E",
    specifications: {
      memory: { value: "128 GB", evidence: "Storage 128 GB" },
      ram: { value: "8 GB", evidence: "RAM 8 GB" },
      processor: { value: "Exynos 1380", evidence: "Processor: Exynos 1380" },
      display: { value: "6.4 inch", evidence: "Display 6.4 inch" },
      cameras: { value: "50 MP", evidence: "Camera 50 MP" },
      battery: { value: "5000 mAh", evidence: "Battery 5000 mAh" },
      networks: { value: "5G", evidence: "5G" },
      supports5G: { value: true, evidence: "5G" },
      operatingSystem: { value: "Android", evidence: "Android" },
      additional: { value: "Dual SIM", evidence: "Dual SIM" }
    },
    ...overrides
  };
}

test("only accepts bounded PNG, JPEG, or WEBP data with a matching signature", () => {
  assert.equal(parseDeviceImage(onePixelPng)?.mimeType, "image/png");
  assert.equal(parseDeviceImage("data:image/png;base64,aGVsbG8="), null);
  assert.equal(parseDeviceImage("data:image/gif;base64,R0lGODlh"), null);
  assert.equal(parseDeviceImage(`data:image/png;base64,${"A".repeat(4_200_000)}`), null);
});

test("recognition API allows managers and permitted employees, and denies other employees", async () => {
  const handler = createDeviceRecognitionHandler({
    getUserByToken: async (token) => token === "staff" ? { role: "موظف", permissions: ["device_recognition"] } : token === "plain" ? { role: "موظف", permissions: [] } : token === "manager" ? { role: "مدير", permissions: [] } : null,
    getProvider: () => ({ isConfigured: () => true, analyze: async () => emptyDeviceRecognition() })
  });
  const denied = response();
  await handler({ method: "POST", headers: { authorization: "Bearer plain" }, body: { image: onePixelPng } }, denied);
  assert.equal(denied.statusCode, 403);
  for (const token of ["staff", "manager"]) {
    const allowed = response();
    await handler({ method: "POST", headers: { authorization: `Bearer ${token}` }, body: { image: onePixelPng } }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.identified, false);
    assert.equal(allowed.body.specifications.ram.value, null);
  }
});

test("recognition API rejects missing images and reports missing environment setup", async () => {
  const handler = createDeviceRecognitionHandler({ getUserByToken: async () => ({ role: "مدير" }), getProvider: () => ({ isConfigured: () => false }) });
  const missing = response();
  await handler({ method: "POST", headers: { authorization: "Bearer manager" }, body: {} }, missing);
  assert.equal(missing.statusCode, 400);
  const unconfigured = response();
  await handler({ method: "POST", headers: { authorization: "Bearer manager" }, body: { image: onePixelPng } }, unconfigured);
  assert.equal(unconfigured.statusCode, 503);
  assert.match(unconfigured.body.error, /OPENAI_API_KEY/);
});

test("only returns requested identity and specifications with literal image evidence", () => {
  const result = sanitizeDeviceRecognition(sampleObservation({
    identificationEvidence: "brand logo",
    specifications: { ...sampleObservation().specifications, ram: { value: "12 GB", evidence: "RAM unclear" } }
  }));
  assert.equal(result.identified, false);
  assert.equal(result.manufacturer, null);
  assert.equal(result.model, null);
  assert.equal(result.specifications.ram.value, null);
  assert.equal(result.specifications.processor.value, "Exynos 1380");
  assert.equal(result.specifications.supports5G.value, true);
  assert.equal(result.specifications.additional.value, "Dual SIM");
});

test("does not infer negative 5G support or accept identity outside visible evidence", () => {
  const result = sanitizeDeviceRecognition(sampleObservation({
    identificationEvidence: "Galaxy A54",
    specifications: { ...sampleObservation().specifications, supports5G: { value: false, evidence: "5G" } }
  }));
  assert.equal(result.manufacturer, null);
  assert.equal(result.modelNumber, null);
  assert.equal(result.specifications.supports5G.value, null);
});

test("OpenAI provider reads its key and model only from backend environment defaults", () => {
  const provider = new OpenAIDeviceRecognitionProvider({ apiKey: process.env.OPENAI_API_KEY || "", fetchImpl: async () => ({}) });
  assert.equal(provider.isConfigured(), Boolean(process.env.OPENAI_API_KEY));
  assert.equal(provider.model, process.env.DEVICE_RECOGNITION_MODEL || "gpt-5.6-luna");
  assert.equal(emptyDeviceRecognition().specifications.networks.value, null);
});