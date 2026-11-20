import { createLocalJWKSet, jwtVerify } from "jose";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../config/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { findUserById } from "../utils/helpers.js";

let jwksCache = { set: null, at: 0 };

async function getJwkSet(force = false) {
  if (!force && jwksCache.set && Date.now() - jwksCache.at < 5 * 60 * 1000) return jwksCache.set;
  const jwks = await auth.api.getJwks();
  jwksCache = { set: createLocalJWKSet(jwks), at: Date.now() };
  return jwksCache.set;
}

async function verifyBearerToken(token) {
  try {
    const { payload } = await jwtVerify(token, await getJwkSet());
    return payload;
  } catch (err) {
    // Signing keys may have rotated: refresh the key set once and retry.
    if (err?.code === "ERR_JWKS_NO_MATCHING_KEY") {
      const { payload } = await jwtVerify(token, await getJwkSet(true));
      return payload;
    }
    throw err;
  }
}

/**
 * Verifies the JWT sent as `Authorization: Bearer <token>` (issued by Better Auth's JWT plugin),
 * then loads the user from MongoDB so the role / blocked flag are always read from the database,
 * never trusted from the token.  Falls back to the Better Auth session cookie.
 */
export const verifyJWT = asyncHandler(async (req, _res, next) => {
  let userId = null;
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    try {
      const payload = await verifyBearerToken(header.slice(7));
      userId = payload.sub || payload.id;
    } catch {
      throw new ApiError(401, "Your session has expired. Please sign in again.", "INVALID_TOKEN");
    }
  } else {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    userId = session?.user?.id;
  }

  if (!userId) throw new ApiError(401, "Authentication required. Please sign in.", "UNAUTHENTICATED");

  const user = await findUserById(userId);
  if (!user) throw new ApiError(401, "Account not found. Please sign in again.", "UNAUTHENTICATED");
  if (user.isBlocked) throw new ApiError(403, "Your account has been blocked. Contact the salon for help.", "BLOCKED");

  req.user = {
    _id: user._id,
    id: String(user._id),
    name: user.name,
    email: user.email,
    image: user.image || "",
    phone: user.phone || "",
    role: user.role || "customer",
  };
  next();
});

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "You do not have permission to perform this action.", "FORBIDDEN"));
    }
    next();
  };
