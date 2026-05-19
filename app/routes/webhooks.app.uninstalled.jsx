// app/routes/webhooks.app.uninstalled.jsx
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  let shop, topic;

  try {
    const webhook = await authenticate.webhook(request);
    shop = webhook.shop;
    topic = webhook.topic;

    console.log(`Received ${topic} webhook for ${shop}`);

    // Find all sessions for this shop in MongoDB
    const sessions = await sessionStorage.findSessionsByShop(shop);
    console.log(`Found ${sessions?.length || 0} session(s) to delete for ${shop}`);

    if (sessions?.length > 0) {
      // Delete by session IDs (array) — NOT by shop string
      const sessionIds = sessions.map((s) => s.id);
      await sessionStorage.deleteSessions(sessionIds);
      console.log(`✅ Deleted sessions:`, sessionIds);
    }

    return new Response(); // 200 OK
  } catch (error) {
    // If authenticate.webhook threw a Response (likely 401), reuse it
    if (error instanceof Response) {
      console.error(`Webhook error (Response) for shop ${shop || "unknown"}:`, error.status);
      return error;
    }

    console.error(
      `❌ Error in app/uninstalled webhook for shop ${shop || "unknown"}:`,
      error?.message || error,
    );

    // Explicitly return 401 to signal failed verification / invalid HMAC
    return new Response(null, { status: 401 });
  }
};




// import { authenticate, sessionStorage } from "../shopify.server";

// export const action = async ({ request }) => {
//   const { shop, topic } = await authenticate.webhook(request);

//   console.log(`Received ${topic} webhook for ${shop}`);

//   try {
//     // Find all sessions for this shop in MongoDB
//     const sessions = await sessionStorage.findSessionsByShop(shop);
//     console.log(`Found ${sessions?.length || 0} session(s) to delete for ${shop}`);

//     if (sessions?.length > 0) {
//       // Delete by session IDs (array) — NOT by shop string
//       const sessionIds = sessions.map(s => s.id);
//       await sessionStorage.deleteSessions(sessionIds);
//       console.log(`✅ Deleted sessions:`, sessionIds);
//     }
//   } catch (err) {
//     console.error(`❌ Error deleting sessions for ${shop}:`, err.message);
//     // Don't throw — always return 200 to Shopify or it will retry
//   }

//   return new Response();
// };