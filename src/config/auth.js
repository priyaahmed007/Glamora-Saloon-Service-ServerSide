import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { db } from "./db.js";

const isProd = process.env.NODE_ENV === "production";
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
const cookieDomain = process.env.COOKIE_DOMAIN;

const googleConfigured = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: mongodbAdapter(db),
  trustedOrigins: [clientUrl],

  // Better Auth stores people in the "users" collection (see project database design).
  user: {
    modelName: "users",
    additionalFields: {
      // input:false => can never be set from a public sign-up / profile request.
      role: { type: "string", required: false, defaultValue: "customer", input: false },
      isBlocked: { type: "boolean", required: false, defaultValue: false, input: false },
      phone: { type: "string", required: false, input: true },
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    autoSignIn: true,
  },

  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {},

  advanced: {
    useSecureCookies: isProd,
    defaultCookieAttributes: isProd ? { sameSite: "none", secure: true, httpOnly: true } : undefined,
    crossSubDomainCookies: cookieDomain ? { enabled: true, domain: cookieDomain } : undefined,
  },

  // Server-side password policy: min 6 chars, one uppercase and one lowercase letter.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const password = ctx.body?.password || "";
        if (password.length < 6 || !/[A-Z]/.test(password) || !/[a-z]/.test(password)) {
          throw new APIError("BAD_REQUEST", {
            message: "Password must be at least 6 characters with one uppercase and one lowercase letter.",
          });
        }
      }
    }),
  },

  // JWT plugin: the client exchanges its session for a short-lived signed JWT
  // that the Express middleware verifies on every protected API call.
  plugins: [jwt({ jwt: { expirationTime: "15m" } })],
});
