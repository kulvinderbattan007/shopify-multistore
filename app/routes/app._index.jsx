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
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#F5F6FF", padding: "0" }}>
      <h1>hello</h1>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

