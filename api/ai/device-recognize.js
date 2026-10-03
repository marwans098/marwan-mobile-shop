import { getUserByToken } from "../_lib/db.js";

function canUseDeviceRecognition(user) {
  if (!user) return false;

  if (user.role === "مدير" || user.role === "admin") return true;

  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : [];

  return permissions.includes("all") ||
         permissions.includes("compatibility");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader =
      req.headers.authorization || req.headers.Authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    const user = await getUserByToken(token);

    if (!user) {
      return res.status(401).json({
        error: "تسجيل الدخول مطلوب."
      });
    }

    if (!canUseDeviceRecognition(user)) {
      return res.status(403).json({
        error: "ليس لديك صلاحية التعرّف على الجهاز."
      });
    }

    const key = process.env.OPENAI_API_KEY;

    if (!key) {
      return res.status(500).json({
        error: "OPENAI_API_KEY غير مضبوط على الخادم."
      });
    }

    const { image, type = "cases", query = "" } = req.body || {};

    if (
      typeof image !== "string" ||
      !image.startsWith("data:image/")
    ) {
      return res.status(400).json({
        error: "صورة الجهاز غير صالحة."
      });
    }

    if (image.length > 12000000) {
      return res.status(413).json({
        error: "الصورة كبيرة جداً."
      });
    }

    const prompt = `أنت مساعد فني لمحل موبايلات.
حلل صورة الجهاز فقط للتعرّف عليه.

نوع فحص المطابقة: ${type}
استعلام الموظف إن وجد: ${query}

أرجع JSON صالح فقط بهذه المفاتيح:
brand, model, model_number, confidence, confidence_label, notes.

- brand: الشركة مثل Apple أو Samsung.
- model: اسم الموديل الكامل إن أمكن.
- model_number: رقم الموديل أو رقم الطراز إن ظهر.
- confidence: رقم من 0 إلى 1.
- confidence_label: high أو medium أو low أو unknown.
- notes: ملاحظات قصيرة تذكر ما ظهر بالصورة وما يحتاج تأكيد.

إذا لا تكفي الصورة لتحديد الموديل،
لا تخمّن:
استخدم model=null
وmodel_number=null
وconfidence_label=unknown.`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_DEVICE_MODEL || "gpt-5.6-luna",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt
                },
                {
                  type: "input_image",
                  image_url: image,
                  detail: "high"
                }
              ]
            }
          ],
          max_output_tokens: 500
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "فشل الاتصال بخدمة OpenAI."
      });
    }

    const outputText = data.output_text || "";

    let result;

    try {
      result = JSON.parse(outputText);
    } catch {
      const match = outputText.match(/\{[\s\S]*\}/);

      if (!match) {
        return res.status(502).json({
          error: "OpenAI رجع نتيجة غير قابلة للقراءة."
        });
      }

      result = JSON.parse(match[0]);
    }

    result.confidence = Math.max(
      0,
      Math.min(1, Number(result.confidence) || 0)
    );

    return res.status(200).json({
      result
    });

  } catch (error) {
    console.error("device-recognize:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "تعذر الاتصال بخدمة OpenAI."
    });
  }
}
