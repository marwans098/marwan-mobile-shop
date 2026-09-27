import { getUserByToken } from "./_lib/db.js";
import { getCompatibilityProvider } from "./_lib/compatibility-provider.js";
import { createCompatibilityHandler } from "./_lib/compatibility-http.js";

export default createCompatibilityHandler({ getUserByToken, getProvider: getCompatibilityProvider });
