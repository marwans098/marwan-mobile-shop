import { emptyDeviceRecognition } from "./device-recognition-provider.js";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const permissionList = (user) => Array.isArray(user?.permissions) ? user.permissions : [];
const canUseDeviceRecognition = (user) => user?.role === "مدير" || permissionList(user).includes("device_recognition") || permissionList(user).includes("compatibility");

function hasImageSignature(bytes, mimeType) {
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export function parseDeviceImage(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DATA_URL);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  const mimeType = match[1].toLowerCase();
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== match[2] || !hasImageSignature(bytes, mimeType)) return null;
  return { dataUrl: value, mimeType, byteLength: bytes.length };
}

export function createDeviceRecognitionHandler({ getUserByToken, getProvider }) {
  return async function deviceRecognitionHandler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "الطريقة غير مسموحة" });
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
    let user;
    try { user = await getUserByToken(token); }
    catch { return res.status(401).json({ error: "غير مصرح بالدخول" }); }
    if (!user) return res.status(401).json({ error: "غير مصرح بالدخول" });
    if (!canUseDeviceRecognition(user)) return res.status(403).json({ error: "ميزة تعرّف على الجهاز غير متاحة لحسابك" });

    const image = parseDeviceImage(req.body?.image);
    if (!image) return res.status(400).json({ error: "ارفع صورة JPG أو PNG أو WEBP واضحة وبحجم لا يتجاوز 3 ميغابايت" });

    try {
      const provider = getProvider();
      if (!provider?.isConfigured?.()) {
        return res.status(503).json({ error: "خدمة التعرّف غير مهيأة. أضف OPENAI_API_KEY إلى إعدادات الخادم لتفعيلها." });
      }
      const result = await provider.analyze(image.dataUrl);
      return res.status(200).json({ provider: "image-reading", observedAt: new Date().toISOString(), ...result });
    } catch {
      return res.status(502).json({ error: "تعذر تحليل الصورة. أعد المحاولة بصورة أوضح." });
    }
  };
}

export { emptyDeviceRecognition };