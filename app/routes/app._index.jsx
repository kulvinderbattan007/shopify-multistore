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

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";

  if (searchQuery) {
    const response = await admin.graphql(
      `#graphql
      query SearchProducts($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              id
              title
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { query: searchQuery } }
    );

    const json = await response.json();
    return { products: json.data?.products?.edges || [] };
  }

  return { products: [] };
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "UPLOAD_IMAGE") {
    const productId = formData.get("productId");
    const imageFile = formData.get("image");

    if (!productId || !imageFile) {
      return { error: "Product ID and image are required" };
    }

    try {
      // First, create a staged upload
      const stagedUploadResponse = await admin.graphql(
        `#graphql
        mutation StagedUploadCreate($input: StagedUploadInput!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters {
                name
                value
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: {
              filename: imageFile.name,
              mimeType: imageFile.type,
              httpMethod: "POST",
              resource: "IMAGE",
            },
          },
        }
      );

      const stagedJson = await stagedUploadResponse.json();
      const stagedTarget = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!stagedTarget) {
        throw new Error("Failed to create staged upload");
      }

      // Upload the file to the staged URL
      const uploadFormData = new FormData();
      stagedTarget.parameters.forEach(({ name, value }) => {
        uploadFormData.append(name, value);
      });
      uploadFormData.append("file", imageFile);

      const uploadResponse = await fetch(stagedTarget.url, {
        method: "POST",
        body: uploadFormData,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file");
      }

      // Create file reference
      const fileCreateResponse = await admin.graphql(
        `#graphql
        mutation FileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              url
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            files: [
              {
                originalSource: stagedTarget.resourceUrl,
                contentType: "IMAGE",
              },
            ],
          },
        }
      );

      const fileJson = await fileCreateResponse.json();
      const file = fileJson.data?.fileCreate?.files?.[0];

      if (!file) {
        throw new Error("Failed to create file reference");
      }

      // Set metafield
      const metafieldResponse = await admin.graphql(
        `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                ownerId: productId,
                namespace: "custom_product_banner",
                key: "banner_image",
                type: "file_reference",
                value: file.id,
              },
            ],
          },
        }
      );

      const metafieldJson = await metafieldResponse.json();
      const errors = metafieldJson.data?.metafieldsSet?.userErrors || [];

      if (errors.length > 0) {
        throw new Error(errors.map((e) => e.message).join(", "));
      }

      return { success: true, imageUrl: file.url };
    } catch (error) {
      return { error: error.message };
    }
  }

  return { error: "Invalid action" };
}

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
