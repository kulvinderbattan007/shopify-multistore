import { authenticate } from "../shopify.server";
import db from "../db.server";

const METAFIELD_NAMESPACE = "volume_discount_settings";
const METAFIELD_KEY = "product_volume_rules";

export const action = async ({ request }) => {
  const { shop, session, topic, admin } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // 1. Get metafield ID
    const response = await admin.graphql(`
      #graphql
      query {
        shop {
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
            id
          }
        }
      }
    `);

    const json = await response.json();
    const metafieldId =
      json?.data?.shop?.metafield?.id;

    // 2. Delete metafield if exists
    if (metafieldId) {
      await admin.graphql(
        `
        #graphql
        mutation DeleteMetafield($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) {
            deletedId
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            input: { id: metafieldId },
          },
        }
      );

      console.log("Metafield deleted successfully");
    } else {
      console.log("No metafield found to delete");
    }
  } catch (error) {
    console.error("Error deleting metafield:", error);
  }

  // 3. Clean sessions (your existing logic)
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};





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
