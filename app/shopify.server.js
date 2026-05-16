import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { MongoDBSessionStorage } from '@shopify/shopify-app-session-storage-mongodb';
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(process.env.DATABASE_URL),
  distribution: AppDistribution.AppStore,
  future: {
    // expiringOfflineAccessTokens: true,
    unstable_newEmbeddedAuthStrategy: true, 
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;




// import "@shopify/shopify-app-react-router/adapters/node";
// import {
//   ApiVersion,
//   AppDistribution,
//   shopifyApp,
// } from "@shopify/shopify-app-react-router/server";
// import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
// import prisma from "./db.server";

// console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
// console.log("[shopify.server.js] MODULE LOADING");
// console.log("[shopify.server.js] SHOPIFY_API_KEY:", process.env.SHOPIFY_API_KEY ? "✅ SET" : "❌ MISSING");
// console.log("[shopify.server.js] SHOPIFY_API_SECRET:", process.env.SHOPIFY_API_SECRET ? "✅ SET" : "❌ MISSING");
// console.log("[shopify.server.js] SHOPIFY_APP_URL:", process.env.SHOPIFY_APP_URL || "❌ MISSING");
// console.log("[shopify.server.js] DATABASE_URL:", process.env.DATABASE_URL ? "✅ SET" : "❌ MISSING");
// console.log("[shopify.server.js] SCOPES:", process.env.SCOPES || "❌ MISSING");
// console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// // Wrap MongoDBSessionStorage with logging
// class LoggedMongoDBSessionStorage {
//   constructor(url) {
//     console.log("[SessionStorage] Initializing MongoDBSessionStorage...");
//     console.log("[SessionStorage] MongoDB URL present:", !!url);

//     // Extract just the host/db for safe logging (no credentials)
//     try {
//       const parsed = new URL(url);
//       console.log("[SessionStorage] MongoDB host:", parsed.host);
//       console.log("[SessionStorage] MongoDB database:", parsed.pathname);
//     } catch (e) {
//       console.log("[SessionStorage] Could not parse DATABASE_URL:", e.message);
//     }

//     this._inner = new MongoDBSessionStorage(url);
//   }

//   async storeSession(session) {
//     console.log("[SessionStorage] storeSession() called");
//     console.log("[SessionStorage] Session shop:", session?.shop);
//     console.log("[SessionStorage] Session id:", session?.id);
//     console.log("[SessionStorage] Session isOnline:", session?.isOnline);
//     console.log("[SessionStorage] accessToken present:", !!session?.accessToken);
//     try {
//       const result = await this._inner.storeSession(session);
//       console.log("[SessionStorage] storeSession() ✅ success:", result);
//       return result;
//     } catch (err) {
//       console.log("[SessionStorage] storeSession() ❌ ERROR:", err.message);
//       throw err;
//     }
//   }

//   async loadSession(id) {
//     console.log("[SessionStorage] loadSession() called with id:", id);
//     try {
//       const session = await this._inner.loadSession(id);
//       if (session) {
//         console.log("[SessionStorage] loadSession() ✅ found session for shop:", session.shop);
//         console.log("[SessionStorage] accessToken present:", !!session.accessToken);
//         console.log("[SessionStorage] session expires:", session.expires || "no expiry");
//       } else {
//         console.log("[SessionStorage] loadSession() ⚠️  NO SESSION FOUND for id:", id);
//       }
//       return session;
//     } catch (err) {
//       console.log("[SessionStorage] loadSession() ❌ ERROR:", err.message);
//       throw err;
//     }
//   }

//   async deleteSession(id) {
//     console.log("[SessionStorage] deleteSession() called with id:", id);
//     try {
//       const result = await this._inner.deleteSession(id);
//       console.log("[SessionStorage] deleteSession() ✅ result:", result);
//       return result;
//     } catch (err) {
//       console.log("[SessionStorage] deleteSession() ❌ ERROR:", err.message);
//       throw err;
//     }
//   }

//   async deleteSessions(ids) {
//     console.log("[SessionStorage] deleteSessions() called with ids:", ids);
//     try {
//       const result = await this._inner.deleteSessions(ids);
//       console.log("[SessionStorage] deleteSessions() ✅ result:", result);
//       return result;
//     } catch (err) {
//       console.log("[SessionStorage] deleteSessions() ❌ ERROR:", err.message);
//       throw err;
//     }
//   }

//   async findSessionsByShop(shop) {
//     console.log("[SessionStorage] findSessionsByShop() called for shop:", shop);
//     try {
//       const sessions = await this._inner.findSessionsByShop(shop);
//       console.log("[SessionStorage] findSessionsByShop() ✅ found", sessions?.length || 0, "session(s)");
//       return sessions;
//     } catch (err) {
//       console.log("[SessionStorage] findSessionsByShop() ❌ ERROR:", err.message);
//       throw err;
//     }
//   }
// }

// const shopify = shopifyApp({
//   apiKey: process.env.SHOPIFY_API_KEY,
//   apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
//   apiVersion: ApiVersion.October25,
//   scopes: process.env.SCOPES?.split(","),
//   appUrl: process.env.SHOPIFY_APP_URL || "",
//   authPathPrefix: "/auth",
//   sessionStorage: new LoggedMongoDBSessionStorage(process.env.DATABASE_URL),
//   distribution: AppDistribution.AppStore,
//   future: {
//     // expiringOfflineAccessTokens: true,
//     unstable_newEmbeddedAuthStrategy: true, // ← REQUIRED for client-side nav to work
//   },
//   ...(process.env.SHOP_CUSTOM_DOMAIN
//     ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
//     : {}),
// });

// console.log("[shopify.server.js] ✅ shopifyApp() initialized successfully");

// export default shopify;
// export const apiVersion = ApiVersion.October25;
// export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
// export const authenticate = shopify.authenticate;
// export const unauthenticated = shopify.unauthenticated;
// export const login = shopify.login;
// export const registerWebhooks = shopify.registerWebhooks;
// export const sessionStorage = shopify.sessionStorage;