// app/routes/webhooks.customers.data_request.jsx
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  let shop, topic;

  try {
    const { payload, topic: t, shop: s } = await authenticate.webhook(request);
    topic = t;
    shop = s;

    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("customers/data_request payload:", payload);

    // TODO: collect/export customer's data in production.

    return new Response(); // 200 OK
  } catch (error) {
    if (error instanceof Response) {
      console.error(`Webhook error (Response) for customers/data_request:`, error.status);
      return error; // e.g. 401 from authenticate.webhook
    }

    console.error(
      `❌ Error in customers/data_request webhook for shop ${shop || "unknown"}:`,
      error?.message || error,
    );

    return new Response(null, { status: 401 });
  }
};











// // app/routes/webhooks.customers.data_request.jsx
// import { authenticate } from "../shopify.server";
// import db from "../db.server";

// // customers/data_request
// // Docs: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance#compliance-webhook-topics
// export const action = async ({ request }) => {
//   const { payload, topic, shop } = await authenticate.webhook(request);

//   console.log(`Received ${topic} webhook for ${shop}`);
//   console.log("customers/data_request payload:", payload);

//   /**
//    * Typical payload shape (simplified, check logs to confirm):
//    * {
//    *   shop_id: 123456789,
//    *   shop_domain: "example.myshopify.com",
//    *   customer: {
//    *     id: 987654321,
//    *     email: "customer@example.com",
//    *     phone: null
//    *   }
//    * }
//    */

//   // TODO: implement your own logic to collect/export the customer's data.
//   // Example pseudocode:
//   //
//   // const customerId = payload.customer?.id;
//   // const shopDomain = payload.shop_domain;
//   //
//   // const records = await db.yourCustomerDataModel.findMany({
//   //   where: { shopDomain, shopCustomerId: customerId },
//   // });
//   //
//   // // Start your data export process (email it to merchant, store a file, etc.)
//   // await startCustomerDataExport({ shopDomain, customerId, records });

//   return new Response();
// };