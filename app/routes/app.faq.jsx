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

export default function Faq() {
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#F5F6FF", padding: "0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .vd-page { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }

        /* Hero */
        .vd-hero {
          background: linear-gradient(135deg, #5C6AC4 0%, #4959BD 60%, #3b4aab 100%);
          border-radius: 20px;
          padding: 3rem 2.5rem;
          margin-bottom: 2rem;
          position: relative;
          overflow: hidden;
        }
        .vd-hero::before {
          content: '';
          position: absolute;
          top: -60px; right: -60px;
          width: 260px; height: 260px;
          border-radius: 50%;
          background: rgba(255,255,255,0.06);
        }
        .vd-hero::after {
          content: '';
          position: absolute;
          bottom: -80px; right: 80px;
          width: 180px; height: 180px;
          border-radius: 50%;
          background: rgba(255,255,255,0.05);
        }
        .vd-hero-badge {
          display: inline-flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.15);
          color: #fff;
          font-size: 12px; font-weight: 500;
          padding: 5px 12px;
          border-radius: 999px;
          margin-bottom: 1.25rem;
          letter-spacing: 0.03em;
        }
        .vd-hero h1 {
          font-family: 'DM Serif Display', serif;
          font-size: 2.4rem; font-weight: 400;
          color: #fff;
          line-height: 1.2;
          margin-bottom: 1rem;
          max-width: 520px;
        }
        .vd-hero p {
          color: rgba(255,255,255,0.82);
          font-size: 15px; line-height: 1.7;
          max-width: 480px;
          margin-bottom: 2rem;
        }
        .vd-hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }

        .btn-white {
          display: inline-flex; align-items: center; gap: 8px;
          background: #fff; color: #5C6AC4;
          border: none; border-radius: 10px;
          padding: 12px 22px; font-size: 14px; font-weight: 600;
          cursor: pointer; text-decoration: none;
          transition: transform 0.15s, box-shadow 0.15s;
          font-family: 'DM Sans', sans-serif;
        }
        .btn-white:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.12); }

        .btn-outline-white {
          display: inline-flex; align-items: center; gap: 8px;
          background: transparent; color: #fff;
          border: 1.5px solid rgba(255,255,255,0.5);
          border-radius: 10px;
          padding: 11px 22px; font-size: 14px; font-weight: 500;
          cursor: pointer; text-decoration: none;
          transition: background 0.15s, border-color 0.15s;
          font-family: 'DM Sans', sans-serif;
        }
        .btn-outline-white:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.8); }

        /* Stats */
        .vd-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 2rem;
        }
        .vd-stat-card {
          background: #fff;
          border-radius: 14px;
          border: 1px solid #E8E9F5;
          padding: 1.25rem 1.5rem;
        }
        .vd-stat-label {
          font-size: 12px; font-weight: 500;
          color: #8B8FA8;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .vd-stat-value {
          font-size: 28px; font-weight: 600;
          color: #2B2D42;
          line-height: 1;
        }
        .vd-stat-sub {
          font-size: 12px; color: #8B8FA8; margin-top: 4px;
        }

        /* Section label */
        .vd-section-label {
          font-size: 11px; font-weight: 600;
          color: #5C6AC4;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 1rem;
        }

        /* How it works */
        .vd-steps {
          background: #fff;
          border-radius: 16px;
          border: 1px solid #E8E9F5;
          padding: 1.75rem 2rem;
          margin-bottom: 2rem;
        }
        .vd-steps-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1.5rem;
          margin-top: 1.25rem;
        }
        .vd-step {
          display: flex; flex-direction: column; gap: 10px;
        }
        .vd-step-num {
          width: 36px; height: 36px;
          border-radius: 10px;
          background: #ECEEFF;
          color: #5C6AC4;
          font-size: 16px; font-weight: 600;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .vd-step h3 {
          font-size: 14px; font-weight: 600;
          color: #2B2D42;
          margin-bottom: 4px;
        }
        .vd-step p {
          font-size: 13px; color: #6B6F8A; line-height: 1.6;
        }
        .vd-step-divider {
          width: 1px; background: #E8E9F5; display: none;
        }

        /* Example tiers */
        .vd-example {
          background: #fff;
          border-radius: 16px;
          border: 1px solid #E8E9F5;
          padding: 1.75rem 2rem;
          margin-bottom: 2rem;
        }
        .vd-tier-row {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid #F0F1FA;
        }
        .vd-tier-row:last-child { border-bottom: none; }
        .vd-tier-qty {
          background: #ECEEFF;
          color: #5C6AC4;
          font-size: 12px; font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          min-width: 80px;
          text-align: center;
        }
        .vd-tier-label { font-size: 14px; color: #2B2D42; flex: 1; }
        .vd-tier-discount {
          font-size: 14px; font-weight: 600;
          color: #3CA55C;
          background: #EDFBF2;
          padding: 4px 10px; border-radius: 6px;
        }

        /* Features */
        .vd-features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
          margin-bottom: 2rem;
        }
        .vd-feature-card {
          background: #fff;
          border-radius: 14px;
          border: 1px solid #E8E9F5;
          padding: 1.4rem 1.25rem;
        }
        .vd-feature-icon {
          width: 40px; height: 40px;
          background: #ECEEFF;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 12px;
          font-size: 20px; color: #5C6AC4;
        }
        .vd-feature-card h3 {
          font-size: 14px; font-weight: 600;
          color: #2B2D42; margin-bottom: 6px;
        }
        .vd-feature-card p {
          font-size: 13px; color: #6B6F8A; line-height: 1.6;
        }

        /* CTA strip */
        .vd-cta {
          background: linear-gradient(135deg, #5C6AC4 0%, #3b4aab 100%);
          border-radius: 16px;
          padding: 2rem 2.5rem;
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 1.25rem;
        }
        .vd-cta h2 {
          font-family: 'DM Serif Display', serif;
          font-weight: 400;
          font-size: 1.4rem; color: #fff; margin-bottom: 4px;
        }
        .vd-cta p { font-size: 13px; color: rgba(255,255,255,0.78); }
        /* FAQ */
.vd-faq {
  background: #fff;
  border-radius: 16px;
  border: 1px solid #E8E9F5;
  padding: 1.75rem 2rem;
  margin-bottom: 2rem;
}
.vd-faq-item {
  border-bottom: 1px solid #F0F1FA;
  padding: 14px 0;
}
.vd-faq-item:last-child {
  border-bottom: none;
}
.vd-faq-question {
  font-size: 14px;
  font-weight: 600;
  color: #2B2D42;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.vd-faq-answer {
  font-size: 13px;
  color: #6B6F8A;
  margin-top: 8px;
  line-height: 1.6;
}
      `}</style>

      <div className="vd-page">

        
{/* FAQ Section */}
            <div className="vd-faq">
              <div className="vd-section-label">Frequently asked questions</div>

              <div className="vd-faq-item">
                <div className="vd-faq-question">
                  How do discount rules work?
                </div>
                <div className="vd-faq-answer">
                  You can create quantity-based rules for products or variants. When a customer adds items and meets the required quantity, the discount is applied automatically in the cart.
                </div>
              </div>

              <div className="vd-faq-item">
                <div className="vd-faq-question">
                  Do I need discount codes?
                </div>
                <div className="vd-faq-answer">
                  No. Discounts are applied automatically when the quantity conditions are met — no coupon codes required.
                </div>
              </div>

              <div className="vd-faq-item">
                <div className="vd-faq-question">
                  Can I create multiple tiers?
                </div>
                <div className="vd-faq-answer">
                  Yes, you can define unlimited tiers like 5+, 10+, 20+ quantities with different discount percentages.
                </div>
              </div>

              <div className="vd-faq-item">
                <div className="vd-faq-question">
                  Can I apply rules to specific variants?
                </div>
                <div className="vd-faq-answer">
                  Yes, rules can be applied to specific products or even individual variants depending on your setup.
                </div>
              </div>

              <div className="vd-faq-item">
                <div className="vd-faq-question">
                  Why is my discount not applying?
                </div>
                <div className="vd-faq-answer">
                  Make sure the cart meets the minimum quantity defined in your rule and that the rule is active.
                </div>
              </div>

            </div>


      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

