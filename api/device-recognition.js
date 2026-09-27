import { getUserByToken } from "./_lib/db.js";
import { createDeviceRecognitionHandler } from "./_lib/device-recognition-http.js";
import { getDeviceRecognitionProvider } from "./_lib/device-recognition-provider.js";

export default createDeviceRecognitionHandler({ getUserByToken, getProvider: getDeviceRecognitionProvider });