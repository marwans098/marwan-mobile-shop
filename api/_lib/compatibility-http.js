import { CONFIDENCE_LEVELS, MATCH_STATUSES, NO_RELIABLE_MATCH_MESSAGE, PART_TYPES, normalizeProviderSearchResult } from "./compatibility-domain.js";

function bearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

export function createCompatibilityHandler({ getUserByToken, getProvider }) {
  return async function compatibilityHandler(req, res) {
    const provider = getProvider();
    try {
      await provider.initialize();
      if (req.method === "GET") {
        if (req.query?.admin === "1") {
          const user = await getUserByToken(bearerToken(req));
          if (!user || user.role !== "مدير") return res.status(403).json({ error: "إدارة التوافق متاحة للمدير فقط" });
          return res.status(200).json({ contractVersion: "1", provider: "manager-curated", types: PART_TYPES, confidenceLevels: CONFIDENCE_LEVELS, statuses: MATCH_STATUSES, records: await provider.listAll() });
        }
        const type = String(req.query?.type || "").trim();
        const model = String(req.query?.model || "").trim();
        const q = String(req.query?.q || "").trim();
        if (type && !Object.hasOwn(PART_TYPES, type)) return res.status(400).json({ error: "نوع القطعة غير مدعوم" });
        if (!model && !q) return res.status(400).json({ error: "أدخل موديل الهاتف أو SKU / اسم القطعة" });
        const result = normalizeProviderSearchResult(await provider.search({ type, model, q }));
        return res.status(200).json({ ...result, message: result.message || NO_RELIABLE_MATCH_MESSAGE, labels: MATCH_STATUSES, confidenceLevels: CONFIDENCE_LEVELS });
      }

      const user = await getUserByToken(bearerToken(req));
      if (!user || user.role !== "مدير") return res.status(403).json({ error: "إدارة التوافق متاحة للمدير فقط" });

      if (req.method === "POST" || req.method === "PUT") {
        const result = await provider.upsert(req.body || {}, user.username);
        return res.status(200).json({ success: true, ...result });
      }
      if (req.method === "DELETE") {
        const id = String(req.query?.id || req.body?.id || "").trim();
        if (!id) return res.status(400).json({ error: "معرّف علاقة التوافق مطلوب" });
        const removed = await provider.remove(id);
        return res.status(200).json({ success: removed });
      }
      return res.status(405).json({ error: "الطريقة غير مسموحة" });
    } catch (error) {
      console.error("Compatibility API error:", error);
      const status = error instanceof Error && /مطلوب|غير صالح|غير مدعوم|غير معتمد|يتجاوز|أدخل|يحتاج|موديل|موثوق/.test(error.message) ? 400 : 500;
      return res.status(status).json({ error: status === 400 ? error.message : "تعذر تنفيذ طلب التوافق" });
    }
  };
}
