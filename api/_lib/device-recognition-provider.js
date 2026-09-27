const SPEC_FIELDS = ["memory", "ram", "processor", "display", "cameras", "battery", "networks", "operatingSystem", "additional"];
const IDENTITY_FIELDS = ["manufacturer", "deviceName", "model", "modelNumber"];
const nullableString = { type: ["string", "null"] };
const evidenceField = () => ({
  type: "object",
  properties: { value: nullableString, evidence: nullableString },
  required: ["value", "evidence"],
  additionalProperties: false
});
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    manufacturer: nullableString,
    deviceName: nullableString,
    model: nullableString,
    modelNumber: nullableString,
    identificationConfidence: { type: "string", enum: ["high", "medium", "low", "none"] },
    identificationEvidence: nullableString,
    specifications: {
      type: "object",
      properties: Object.fromEntries([
        ...SPEC_FIELDS.map((field) => [field, evidenceField()]),
        ["supports5G", {
          type: "object",
          properties: {
            value: { type: ["boolean", "null"] },
            evidence: nullableString
          },
          required: ["value", "evidence"],
          additionalProperties: false
        }]
      ]),
      required: [...SPEC_FIELDS, "supports5G"],
      additionalProperties: false
    }
  },
  required: ["manufacturer", "deviceName", "model", "modelNumber", "identificationConfidence", "identificationEvidence", "specifications"],
  additionalProperties: false
};

const cleanText = (value, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalizedText = (value) => cleanText(value, 500).normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const emptySpec = () => ({ value: null, evidence: null });

export function emptyDeviceRecognition(message = "لم يمكن قراءة اسم أو موديل واضح من الصورة.") {
  return {
    identified: false,
    manufacturer: null,
    deviceName: null,
    model: null,
    modelNumber: null,
    identificationConfidence: "none",
    identificationEvidence: null,
    specifications: {
      ...Object.fromEntries(SPEC_FIELDS.map((field) => [field, emptySpec()])),
      supports5G: emptySpec()
    },
    message
  };
}

export function sanitizeDeviceRecognition(raw = {}) {
  const confidence = ["high", "medium", "low", "none"].includes(raw.identificationConfidence)
    ? raw.identificationConfidence
    : "none";
  const identityEvidence = cleanText(raw.identificationEvidence, 240);
  const identityIsReadable = confidence === "high" && identityEvidence.length > 0;
  const includesIdentityEvidence = (field) => {
    const value = cleanText(raw[field], 120);
    return identityIsReadable && value && normalizedText(identityEvidence).includes(normalizedText(value)) ? value : null;
  };
  const identity = Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, includesIdentityEvidence(field)]));
  const specifications = Object.fromEntries(SPEC_FIELDS.map((field) => {
    const item = raw.specifications?.[field] || {};
    const value = cleanText(item.value, 120);
    const evidence = cleanText(item.evidence, 240);
    const exactTextVisible = value && evidence && normalizedText(evidence).includes(normalizedText(value));
    return [field, exactTextVisible ? { value, evidence } : emptySpec()];
  }));
  const networkItem = raw.specifications?.supports5G || {};
  const networkEvidence = cleanText(networkItem.evidence, 240);
  const networkText = normalizedText(networkEvidence);
  let supports5G = emptySpec();
  if (networkItem.value === true && networkText.includes("5g")) {
    supports5G = { value: true, evidence: networkEvidence };
  } else if (networkItem.value === false && (networkText.includes("4gonly") || networkText.includes("no5g"))) {
    supports5G = { value: false, evidence: networkEvidence };
  }
  specifications.supports5G = supports5G;
  const identified = IDENTITY_FIELDS.some((field) => Boolean(identity[field]));
  const hasSpecifications = Object.values(specifications).some((item) => item.value !== null);
  return {
    identified,
    ...identity,
    identificationConfidence: identified ? confidence : "none",
    identificationEvidence: identified ? identityEvidence : null,
    specifications,
    message: identified || hasSpecifications
      ? "قراءة بصرية للنص الظاهر فقط؛ لم تُستنتج مواصفات غير مقروءة."
      : "لم تظهر بالصورة معلومات مقروءة تكفي للتعرّف على الجهاز أو مواصفاته."
  };
}

export class DeviceRecognitionProvider {
  isConfigured() { return false; }
  async analyze() { throw new Error("Implement analyze() in a device recognition provider"); }
}

export class OpenAIDeviceRecognitionProvider extends DeviceRecognitionProvider {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.DEVICE_RECOGNITION_MODEL || "gpt-5.6-luna", fetchImpl = globalThis.fetch } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  isConfigured() { return Boolean(this.apiKey && this.fetchImpl); }

  async analyze(imageDataUrl) {
    if (!this.isConfigured()) throw new Error("مزود التعرّف غير مهيأ");
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        store: false,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "اقرأ النص الظاهر في الصورة فقط. لا تستخدم معرفة سابقة أو بحثًا خارجيًا ولا تخمّن من الشكل أو اللون أو ترتيب الكاميرات. أعد الشركة واسم الجهاز والموديل ورقم الموديل فقط إذا كانت قيمتها مقروءة حرفيًا من كتابة ظاهرة؛ اجعل دليل الهوية اقتباسًا حرفيًا يتضمن القيمة، ولا يكفي الشعار وحده. لكل مواصفة، لا تُعد قيمة إلا إذا كانت القيمة نفسها مكتوبة بوضوح في الصورة، وضع اقتباسًا حرفيًا يحتويها في evidence، وإلا أعد null. يشمل ذلك الذاكرة/التخزين، RAM، المعالج، الشاشة، الكاميرات، البطارية، الشبكات و5G، نظام التشغيل وأي مواصفات أخرى. لا تستنتج أي مواصفة من موديل معروف. لا تقل إن 5G غير مدعوم إلا إذا ظهر بوضوح نص يذكر 4G فقط أو عدم وجود 5G. تجاهل IMEI والرقم التسلسلي ورموز QR والوجوه والبيانات الشخصية. أعد JSON المطابق للمخطط فقط." },
            { type: "input_image", image_url: imageDataUrl, detail: "high" }
          ]
        }],
        text: { format: { type: "json_schema", name: "device_photo_observation", strict: true, schema: OUTPUT_SCHEMA } }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("تعذر على مزود تحليل الصور معالجة الصورة");
    const outputText = payload.output_text || (payload.output || [])
      .flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;
    if (typeof outputText !== "string") return emptyDeviceRecognition();
    try { return sanitizeDeviceRecognition(JSON.parse(outputText)); }
    catch { return emptyDeviceRecognition(); }
  }
}

export function getDeviceRecognitionProvider() {
  return new OpenAIDeviceRecognitionProvider();
}