// import { authenticate } from "../shopify.server";
// import db from "../db.server";

// export const action = async ({ request }) => {
//   const { shop, session, topic } = await authenticate.webhook(request);

//   console.log(`Received ${topic} webhook for ${shop}`);

//   // Webhook requests can trigger multiple times and after an app has already been uninstalled.
//   // If this webhook already ran, the session may have been deleted previously.
//   if (session) {
//     await db.session.deleteMany({ where: { shop } });
//   }

//   return new Response();
// };


import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Find all sessions for this shop in MongoDB
    const sessions = await sessionStorage.findSessionsByShop(shop);
    console.log(`Found ${sessions?.length || 0} session(s) to delete for ${shop}`);

    if (sessions?.length > 0) {
      // Delete by session IDs (array) — NOT by shop string
      const sessionIds = sessions.map(s => s.id);
      await sessionStorage.deleteSessions(sessionIds);
      console.log(`✅ Deleted sessions:`, sessionIds);
    }
  } catch (err) {
    console.error(`❌ Error deleting sessions for ${shop}:`, err.message);
    // Don't throw — always return 200 to Shopify or it will retry
  }

  return new Response();
};