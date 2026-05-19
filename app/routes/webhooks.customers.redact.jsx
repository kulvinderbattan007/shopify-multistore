// app/routes/webhooks.customers.redact.jsx
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  let shop, topic;

  try {
    const { payload, topic: t, shop: s } = await authenticate.webhook(request);
    topic = t;
    shop = s;

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("customers/redact payload:", payload);

    // TODO: delete/anonymize customer's personal data for this shop.
    // Example (pseudo):
    // const customerId = payload.customer?.id;
    // const shopDomain = payload.shop_domain;
    // await db.yourCustomerDataModel.deleteMany({ where: { shopDomain, shopCustomerId: customerId } });

    return new Response(); // 200 OK
  } catch (error) {
    if (error instanceof Response) {
      console.error(`Webhook error (Response) for customers/redact:`, error.status);
      return error; // e.g. 401 from authenticate.webhook
    }

    console.error(
      `❌ Error in customers/redact webhook for shop ${shop || "unknown"}:`,
      error?.message || error,
    );

    // Explicitly fail as unauthorized when verification fails
    return new Response(null, { status: 401 });
  }
};



// // app/routes/webhooks.customers.redact.jsx
// import { authenticate } from "../shopify.server";
// import db from "../db.server";

// // customers/redact
// // Docs: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance#compliance-webhook-topics
// export const action = async ({ request }) => {
//   const { payload, topic, shop } = await authenticate.webhook(request);

//   console.log(`Received ${topic} webhook for ${shop}`);
//   console.log("customers/redact payload:", payload);

//   /**
//    * Typical payload shape (simplified, check logs to confirm):
//    * {
//    *   shop_id: 123456789,
//    *   shop_domain: "example.myshopify.com",
//    *   customer: {
//    *     id: 987654321,
//    *     email: "customer@example.com"
//    *   },
//    *   orders_to_redact: [111111111, 222222222],
//    *   orders_to_keep: [333333333]
//    * }
//    */

//   // TODO: implement your own logic to delete/anonymize the customer's data.
//   // Example pseudocode:
//   //
//   // const customerId = payload.customer?.id;
//   // const shopDomain = payload.shop_domain;
//   //
//   // await db.yourCustomerDataModel.deleteMany({
//   //   where: { shopDomain, shopCustomerId: customerId },
//   // });
//   //
//   // Or anonymize instead of hard delete:
//   // await db.yourCustomerDataModel.updateMany({
//   //   where: { shopDomain, shopCustomerId: customerId },
//   //   data: { email: null, name: null, phone: null, ... },
//   // });

//   return new Response();
// };