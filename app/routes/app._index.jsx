import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const METAFIELD_NAMESPACE = "custom_discount_settings";
const METAFIELD_KEY = "shop_discount_rules";
const METAFIELD_TYPE = "json";

async function loadShopDiscountSettings(admin) {
  const response = await admin.graphql(
    `#graphql
    query ShopDiscountSettings {
      shop {
        id
        metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
          id
          value
          type
          jsonValue
        }
      }
    }`
  );

  const json = await response.json();
  const metafield = json?.data?.shop?.metafield;
  if (!metafield) {
    return null;
  }

  if (metafield.jsonValue != null) {
    return metafield.jsonValue;
  }

  try {
    return JSON.parse(metafield.value);
  } catch {
    return null;
  }
}

async function saveShopDiscountSettings(admin, settings) {
  const shopResponse = await admin.graphql(
    `#graphql
    query ShopIdForDiscountSettings {
      shop {
        id
      }
    }`
  );

  const shopJson = await shopResponse.json();
  const shopId = shopJson?.data?.shop?.id;
  if (!shopId) {
    throw new Error("Unable to resolve shop id before saving metafield.");
  }

  const mutation = await admin.graphql(
    `#graphql
    mutation UpsertShopDiscountSettings($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          type
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: METAFIELD_TYPE,
            value: JSON.stringify(settings),
          },
        ],
      },
    }
  );

  const mutationJson = await mutation.json();
  const userErrors = mutationJson?.data?.metafieldsSet?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }

  const savedMetafield = mutationJson?.data?.metafieldsSet?.metafields?.[0];
  if (!savedMetafield) {
    return settings;
  }

  try {
    return JSON.parse(savedMetafield.value);
  } catch {
    return settings;
  }
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const shopSettings = await loadShopDiscountSettings(admin);
  return { shopSettings };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "GET_METAFIELD") {
    const fetchedSettings = await loadShopDiscountSettings(admin);
    return { fetchedSettings };
  }

  if (actionType === "SAVE_DISCOUNT_SETTINGS") {
    const productDiscountType = formData.get("product_discount_type")?.toString() ?? "";
    const productDiscountValue = formData.get("product_discount_value")?.toString() ?? "";
    const orderDiscountType = formData.get("order_discount_type")?.toString() ?? "";
    const orderDiscountValue = formData.get("order_discount_value")?.toString() ?? "";

    const errors = [];
    if (!productDiscountType) {
      errors.push("Product discount type is required.");
    }
    if (!orderDiscountType) {
      errors.push("Order discount type is required.");
    }

    const parsedProductDiscountValue = Number(productDiscountValue);
    const parsedOrderDiscountValue = Number(orderDiscountValue);

    if (productDiscountType && Number.isNaN(parsedProductDiscountValue)) {
      errors.push("Product discount value must be a number.");
    }
    if (orderDiscountType && Number.isNaN(parsedOrderDiscountValue)) {
      errors.push("Order discount value must be a number.");
    }
    if (!Number.isNaN(parsedProductDiscountValue) && parsedProductDiscountValue < 0) {
      errors.push("Product discount value must be zero or greater.");
    }
    if (!Number.isNaN(parsedOrderDiscountValue) && parsedOrderDiscountValue < 0) {
      errors.push("Order discount value must be zero or greater.");
    }

    if (errors.length > 0) {
      return { errors };
    }

    const settings = {
      product_discount_type: productDiscountType,
      product_discount_value: parsedProductDiscountValue,
      order_discount_type: orderDiscountType,
      order_discount_value: parsedOrderDiscountValue,
      savedAt: new Date().toISOString(),
    };

    try {
      const savedSettings = await saveShopDiscountSettings(admin, settings);
      return { savedSettings, success: true };
    } catch (error) {
      return { errors: [error instanceof Error ? error.message : "Unable to save settings."] };
    }
  }

  return null;
};

export default function Index() {
  const fetcher = useFetcher();
  const loaderData = useLoaderData();
  const shopSettings = fetcher.data?.savedSettings ?? fetcher.data?.fetchedSettings ?? loaderData?.shopSettings;
  const isLoading = ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Shop discount settings saved successfully.");
    }

    if (fetcher.data?.errors?.length) {
      shopify.toast.show(fetcher.data.errors.join(" \n "));
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Shop Discount Settings">
      <s-section heading="Shop metafield settings">
        <fetcher.Form method="post">
          <input type="hidden" name="actionType" value="SAVE_DISCOUNT_SETTINGS" />
          <s-stack direction="block" gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <label>
                <s-heading size="small">Product discount type</s-heading>
                <select name="product_discount_type" defaultValue={shopSettings?.product_discount_type ?? "percentage"}>
                  <option value="percentage">Percentage</option>
                  <option value="fixed_amount">Fixed amount</option>
                  <option value="none">None</option>
                </select>
              </label>
            </s-box>

            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <label>
                <s-heading size="small">Product discount value</s-heading>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="product_discount_value"
                  defaultValue={shopSettings?.product_discount_value ?? 0}
                />
              </label>
            </s-box>

            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <label>
                <s-heading size="small">Order discount type</s-heading>
                <select name="order_discount_type" defaultValue={shopSettings?.order_discount_type ?? "percentage"}>
                  <option value="percentage">Percentage</option>
                  <option value="fixed_amount">Fixed amount</option>
                  <option value="none">None</option>
                </select>
              </label>
            </s-box>

            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <label>
                <s-heading size="small">Order discount value</s-heading>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="order_discount_value"
                  defaultValue={shopSettings?.order_discount_value ?? 0}
                />
              </label>
            </s-box>

            <s-stack direction="inline" gap="base">
              <s-button type="submit" variant="primary" {...(isLoading ? { loading: true } : {})}>
                Save settings
              </s-button>
              <s-button
                type="button"
                variant="secondary"
                onClick={() => fetcher.submit({ actionType: "GET_METAFIELD" }, { method: "post" })}
              >
                Refresh settings
              </s-button>
            </s-stack>

            {fetcher.data?.errors && (
              <s-banner tone="critical">{fetcher.data.errors.join(" \n ")}</s-banner>
            )}
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Current shop metafield value">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0 }}>
            {JSON.stringify(shopSettings ?? { message: "No settings saved yet." }, null, 2)}
          </pre>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};


// import { useEffect } from "react";
// import { useFetcher } from "react-router";
// import { useAppBridge } from "@shopify/app-bridge-react";
// import { boundary } from "@shopify/shopify-app-react-router/server";
// import { authenticate } from "../shopify.server";

// export const loader = async ({ request }) => {
//   await authenticate.admin(request);

//   return null;
// };

// export const action = async ({ request }) => {
//   const { admin } = await authenticate.admin(request);
//   const color = ["Red", "Orange", "Yellow", "Green"][
//     Math.floor(Math.random() * 4)
//   ];
//   const response = await admin.graphql(
//     `#graphql
//       mutation populateProduct($product: ProductCreateInput!) {
//         productCreate(product: $product) {
//           product {
//             id
//             title
//             handle
//             status
//             variants(first: 10) {
//               edges {
//                 node {
//                   id
//                   price
//                   barcode
//                   createdAt
//                 }
//               }
//             }
//             demoInfo: metafield(namespace: "$app", key: "demo_info") {
//               jsonValue
//             }
//           }
//         }
//       }`,
//     {
//       variables: {
//         product: {
//           title: `${color} Snowboard`,
//           metafields: [
//             {
//               namespace: "$app",
//               key: "demo_info",
//               value: "Created by React Router Template",
//             },
//           ],
//         },
//       },
//     },
//   );
//   const responseJson = await response.json();
//   const product = responseJson.data.productCreate.product;
//   const variantId = product.variants.edges[0].node.id;
//   const variantResponse = await admin.graphql(
//     `#graphql
//     mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
//       productVariantsBulkUpdate(productId: $productId, variants: $variants) {
//         productVariants {
//           id
//           price
//           barcode
//           createdAt
//         }
//       }
//     }`,
//     {
//       variables: {
//         productId: product.id,
//         variants: [{ id: variantId, price: "100.00" }],
//       },
//     },
//   );
//   const variantResponseJson = await variantResponse.json();
//   const metaobjectResponse = await admin.graphql(
//     `#graphql
//     mutation shopifyReactRouterTemplateUpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
//       metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
//         metaobject {
//           id
//           handle
//           title: field(key: "title") {
//             jsonValue
//           }
//           description: field(key: "description") {
//             jsonValue
//           }
//         }
//         userErrors {
//           field
//           message
//         }
//       }
//     }`,
//     {
//       variables: {
//         handle: {
//           type: "$app:example",
//           handle: "demo-entry",
//         },
//         metaobject: {
//           fields: [
//             { key: "title", value: "Demo Entry" },
//             {
//               key: "description",
//               value:
//                 "This metaobject was created by the Shopify app template to demonstrate the metaobject API.",
//             },
//           ],
//         },
//       },
//     },
//   );
//   const metaobjectResponseJson = await metaobjectResponse.json();

//   return {
//     product: responseJson.data.productCreate.product,
//     variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
//     metaobject: metaobjectResponseJson.data.metaobjectUpsert.metaobject,
//   };
// };

// export default function Index() {
//   const fetcher = useFetcher();
//   const shopify = useAppBridge();
//   const isLoading =
//     ["loading", "submitting"].includes(fetcher.state) &&
//     fetcher.formMethod === "POST";

//   useEffect(() => {
//     if (fetcher.data?.product?.id) {
//       shopify.toast.show("Product created");
//     }
//   }, [fetcher.data?.product?.id, shopify]);
//   const generateProduct = () => fetcher.submit({}, { method: "POST" });

//   return (
//     <s-page heading="Shopify app template">
//       <s-button slot="primary-action" onClick={generateProduct}>
//         Generate a product
//       </s-button>

//       <s-section heading="Congrats on creating a new Shopify app 🎉">
//         <s-paragraph>
//           This embedded app template uses{" "}
//           <s-link
//             href="https://shopify.dev/docs/apps/tools/app-bridge"
//             target="_blank"
//           >
//             App Bridge
//           </s-link>{" "}
//           interface examples like an{" "}
//           <s-link href="/app/additional">additional page in the app nav</s-link>
//           , as well as an{" "}
//           <s-link
//             href="https://shopify.dev/docs/api/admin-graphql"
//             target="_blank"
//           >
//             Admin GraphQL
//           </s-link>{" "}
//           mutation demo, to provide a starting point for app development.
//         </s-paragraph>
//       </s-section>
//       <s-section heading="Get started with products">
//         <s-paragraph>
//           Generate a product with GraphQL and get the JSON output for that
//           product. Learn more about the{" "}
//           <s-link
//             href="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
//             target="_blank"
//           >
//             productCreate
//           </s-link>{" "}
//           mutation in our API references. Includes a product{" "}
//           <s-link
//             href="https://shopify.dev/docs/apps/build/custom-data/metafields"
//             target="_blank"
//           >
//             metafield
//           </s-link>{" "}
//           and{" "}
//           <s-link
//             href="https://shopify.dev/docs/apps/build/custom-data/metaobjects"
//             target="_blank"
//           >
//             metaobject
//           </s-link>
//           .
//         </s-paragraph>
//         <s-stack direction="inline" gap="base">
//           <s-button
//             onClick={generateProduct}
//             {...(isLoading ? { loading: true } : {})}
//           >
//             Generate a product
//           </s-button>
//           {fetcher.data?.product && (
//             <s-button
//               onClick={() => {
//                 shopify.intents.invoke?.("edit:shopify/Product", {
//                   value: fetcher.data?.product?.id,
//                 });
//               }}
//               target="_blank"
//               variant="tertiary"
//             >
//               Edit product
//             </s-button>
//           )}
//         </s-stack>
//         {fetcher.data?.product && (
//           <s-section heading="productCreate mutation">
//             <s-stack direction="block" gap="base">
//               <s-box
//                 padding="base"
//                 borderWidth="base"
//                 borderRadius="base"
//                 background="subdued"
//               >
//                 <pre style={{ margin: 0 }}>
//                   <code>{JSON.stringify(fetcher.data.product, null, 2)}</code>
//                 </pre>
//               </s-box>

//               <s-heading>productVariantsBulkUpdate mutation</s-heading>
//               <s-box
//                 padding="base"
//                 borderWidth="base"
//                 borderRadius="base"
//                 background="subdued"
//               >
//                 <pre style={{ margin: 0 }}>
//                   <code>{JSON.stringify(fetcher.data.variant, null, 2)}</code>
//                 </pre>
//               </s-box>

//               <s-heading>metaobjectUpsert mutation</s-heading>
//               <s-box
//                 padding="base"
//                 borderWidth="base"
//                 borderRadius="base"
//                 background="subdued"
//               >
//                 <pre style={{ margin: 0 }}>
//                   <code>
//                     {JSON.stringify(fetcher.data.metaobject, null, 2)}
//                   </code>
//                 </pre>
//               </s-box>
//             </s-stack>
//           </s-section>
//         )}
//       </s-section>

//       <s-section slot="aside" heading="App template specs">
//         <s-paragraph>
//           <s-text>Framework: </s-text>
//           <s-link href="https://reactrouter.com/" target="_blank">
//             React Router
//           </s-link>
//         </s-paragraph>
//         <s-paragraph>
//           <s-text>Interface: </s-text>
//           <s-link
//             href="https://shopify.dev/docs/api/app-home/using-polaris-components"
//             target="_blank"
//           >
//             Polaris web components
//           </s-link>
//         </s-paragraph>
//         <s-paragraph>
//           <s-text>API: </s-text>
//           <s-link
//             href="https://shopify.dev/docs/api/admin-graphql"
//             target="_blank"
//           >
//             GraphQL
//           </s-link>
//         </s-paragraph>
//         <s-paragraph>
//           <s-text>Custom data: </s-text>
//           <s-link
//             href="https://shopify.dev/docs/apps/build/custom-data"
//             target="_blank"
//           >
//             Metafields &amp; metaobjects
//           </s-link>
//         </s-paragraph>
//         <s-paragraph>
//           <s-text>Database: </s-text>
//           <s-link href="https://www.prisma.io/" target="_blank">
//             Prisma
//           </s-link>
//         </s-paragraph>
//       </s-section>

//       <s-section slot="aside" heading="Next steps">
//         <s-unordered-list>
//           <s-list-item>
//             Build an{" "}
//             <s-link
//               href="https://shopify.dev/docs/apps/getting-started/build-app-example"
//               target="_blank"
//             >
//               example app
//             </s-link>
//           </s-list-item>
//           <s-list-item>
//             Explore Shopify&apos;s API with{" "}
//             <s-link
//               href="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
//               target="_blank"
//             >
//               GraphiQL
//             </s-link>
//           </s-list-item>
//         </s-unordered-list>
//       </s-section>
//     </s-page>
//   );
// }

// export const headers = (headersArgs) => {
//   return boundary.headers(headersArgs);
// };
