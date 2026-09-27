export const PART_TYPES = Object.freeze({
  cases: "أغطية / كفرات",
  screens: "شاشات",
  charging_flex_ic: "فلات / IC شحن",
  fingerprint: "بصمة",
  chargers_power: "شواحن وقدرة الشحن"
});

export const MATCH_STATUSES = Object.freeze({
  confirmed: "مطابق مؤكد",
  possible: "مطابقة محتملة",
  no_reliable_match: "لا يوجد تطابق موثوق"
});

export const CONFIDENCE_LEVELS = Object.freeze({
  high: "عالية",
  medium: "متوسطة",
  low: "منخفضة",
  none: "غير متاحة"
});

export const NO_RELIABLE_MATCH_MESSAGE = "لا توجد نتيجة موثوقة حاليًا";

export function normalizeModel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSku(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("en-US")
    .replace(/\s+/g, "")
    .trim();
}

export function normalizePartInput(input = {}) {
  const type = String(input.type ?? "").trim();
  const name = String(input.name ?? "").trim();
  const sku = String(input.sku ?? "").trim();
  const models = Array.isArray(input.models)
    ? input.models.map((value) => String(value ?? "").trim()).filter(Boolean)
    : String(input.models ?? "").split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
  const aliases = Array.isArray(input.aliases)
    ? input.aliases.map((value) => String(value ?? "").trim()).filter(Boolean)
    : String(input.aliases ?? "").split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
  const status = String(input.status ?? "possible").trim();
  const sourceName = String(input.sourceName ?? "").trim();
  const sourceUrl = String(input.sourceUrl ?? "").trim();
  const evidence = String(input.evidence ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  const imageUrl = String(input.imageUrl ?? "").trim();
  const deviceImageUrl = String(input.deviceImageUrl ?? "").trim();

  if (!Object.hasOwn(PART_TYPES, type)) throw new Error("نوع القطعة غير مدعوم");
  if (!name || name.length > 180) throw new Error("اسم القطعة مطلوب وبحد أقصى 180 حرفًا");
  if (sku.length > 80) throw new Error("SKU يتجاوز 80 حرفًا");
  if (!models.length) throw new Error("أدخل موديل هاتف واحدًا على الأقل");
  if (models.some((model) => model.length > 160)) throw new Error("اسم أحد الموديلات طويل جدًا");
  if (!["confirmed", "possible"].includes(status)) throw new Error("حالة المطابقة غير صالحة");
  if (sourceUrl) {
    let parsedSource;
    try { parsedSource = new URL(sourceUrl); } catch { throw new Error("رابط المصدر غير صالح"); }
    if (!["https:", "http:"].includes(parsedSource.protocol)) throw new Error("رابط المصدر غير صالح");
  }  if (status === "confirmed") {
    let parsedUrl;
    try { parsedUrl = new URL(sourceUrl); } catch { throw new Error("المطابق المؤكد يحتاج رابط مصدر موثوق"); }
    const trustedHosts = String(process.env.COMPATIBILITY_TRUSTED_HOSTS || "")
      .split(",").map((host) => host.trim().toLocaleLowerCase("en-US")).filter(Boolean);
    const sourceHost = parsedUrl.hostname.toLocaleLowerCase("en-US");
    if (parsedUrl.protocol !== "https:" || !sourceName || !evidence) {
      throw new Error("المطابق المؤكد يحتاج اسم المصدر ورابطه ودليل المراجعة");
    }
    if (!trustedHosts.includes(sourceHost)) {
      throw new Error("نطاق المصدر غير معتمد. أضفه بعد مراجعته إلى COMPATIBILITY_TRUSTED_HOSTS");
    }
  }
  if (imageUrl || deviceImageUrl) {
    for (const url of [imageUrl, deviceImageUrl].filter(Boolean)) {
      let parsedUrl;
      try { parsedUrl = new URL(url); } catch { throw new Error("رابط الصورة غير صالح"); }
      if (!["https:", "http:"].includes(parsedUrl.protocol)) throw new Error("رابط الصورة غير صالح");
    }
  }
  if (deviceImageUrl && models.length > 1) {
    throw new Error("أدخل صورة الهاتف مع موديل واحد فقط حتى لا تُنسب الصورة لموديلات أخرى");
  }

  const uniqueModels = [...new Map(models.map((model) => [normalizeModel(model), model])).values()];
  if (!uniqueModels.length || uniqueModels.some((model) => !normalizeModel(model))) {
    throw new Error("أدخل موديلات صالحة");
  }

  return {
    type, name, sku, models: uniqueModels, aliases,
    status, sourceName, sourceUrl, evidence, notes, imageUrl, deviceImageUrl
  };
}

export function overallMatchStatus(records) {
  if (records.some((record) => record.status === "confirmed")) return "confirmed";
  if (records.some((record) => record.status === "possible")) return "possible";
  return "no_reliable_match";
}

export function isTrustedCompatibilitySource(source = {}) {
  const trustedHosts = String(process.env.COMPATIBILITY_TRUSTED_HOSTS || "")
    .split(",").map((host) => host.trim().toLocaleLowerCase("en-US")).filter(Boolean);
  if (!source.name || !source.url || !source.updatedAt || !source.evidence) return false;
  if (!Number.isFinite(Date.parse(source.updatedAt))) return false;
  try {
    const parsed = new URL(source.url);
    return parsed.protocol === "https:" && trustedHosts.includes(parsed.hostname.toLocaleLowerCase("en-US"));
  } catch {
    return false;
  }
}

export function normalizeProviderSearchResult(result = {}) {
  const records = (Array.isArray(result.records) ? result.records : []).filter((record) => {
    if (!record || !["confirmed", "possible"].includes(record.status)) return false;
    if (!record.part?.name || !record.part?.type || !record.model?.name) return false;
    if (!isTrustedCompatibilitySource(record.source)) return false;
    const confidence = String(record.confidence?.level || "").toLowerCase();
    if (!Object.hasOwn(CONFIDENCE_LEVELS, confidence) || confidence === "none") return false;
    return record.status !== "confirmed" || confidence === "high";
  }).map((record) => {
    const level = String(record.confidence.level).toLowerCase();
    return { ...record, confidence: { level, label: CONFIDENCE_LEVELS[level] } };
  });

  return {
    contractVersion: "1",
    provider: String(result.provider || "unconfigured"),
    status: overallMatchStatus(records),
    message: records.length ? "" : NO_RELIABLE_MATCH_MESSAGE,
    records
  };
}
