// app/routes/webhooks.shop.redact.jsx
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  let shop, topic;

  try {
    const { payload, topic: t, shop: s } = await authenticate.webhook(request);
    topic = t;
    shop = s;

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("shop/redact payload:", payload);

    // TODO: delete all personal data for this shop from your system.
    // Example (pseudo):
    // const shopDomain = payload.shop_domain;
    // await db.yourCustomerDataModel.deleteMany({ where: { shopDomain } });

    return new Response(); // 200 OK
  } catch (error) {
    if (error instanceof Response) {
      console.error(`Webhook error (Response) for shop/redact:`, error.status);
      return error; // e.g. 401 from authenticate.webhook
    }

    console.error(
      `❌ Error in shop/redact webhook for shop ${shop || "unknown"}:`,
      error?.message || error,
    );

    return new Response(null, { status: 401 });
  }
};



// // app/routes/webhooks.shop.redact.jsx
// import { authenticate } from "../shopify.server";
// import db from "../db.server";

// // shop/redact
// // Docs: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance#compliance-webhook-topics
// export const action = async ({ request }) => {
//   const { payload, topic, shop } = await authenticate.webhook(request);

//   console.log(`Received ${topic} webhook for ${shop}`);
//   console.log("shop/redact payload:", payload);

//   /**
//    * Typical payload shape (simplified, check logs to confirm):
//    * {
//    *   shop_id: 123456789,
//    *   shop_domain: "example.myshopify.com"
//    * }
//    */

//   // TODO: implement your own logic to delete all customer data for this shop.
//   // Example pseudocode:
//   //
//   // const shopDomain = payload.shop_domain;
//   //
//   // await db.yourCustomerDataModel.deleteMany({
//   //   where: { shopDomain },
//   // });
//   //
//   // You might also clean up other shop-scoped personal data you store.

//   return new Response();
// };