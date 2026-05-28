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

        {/* Hero */}
        <div className="vd-hero">
          <div className="vd-hero-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            
            {/* <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 1200 1200" fill="none">
              <defs>
                <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="1200" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#4959BD " />
                  <stop offset="1" stop-color="#06070a " />
                </linearGradient>
              </defs>
              <rect x="40" y="40" width="1120" height="1120" rx="120" fill="url(#bg)" />
              <g fill="white">
                <path d="M250 290C250 272 264 258 282 258H370C385 258 398 268 402 283L430 390H700C718 390 732 404 732 422C732 440 718 454 700 454H445L470 540H760C778 540 792 554 792 572C792 590 778 604 760 604H450C435 604 422 594 418 580L350 320H282C264 320 250 306 250 290Z" />
                <circle cx="470" cy="720" r="42" />
                <circle cx="720" cy="720" r="42" />
                <circle cx="760" cy="360" r="120" />
                <text x="760" y="390" font-size="120" text-anchor="middle" fill="#4F46FF" font-family="Arial" font-weight="bold">%</text>
                <text x="600" y="920" font-size="190" text-anchor="middle" font-family="Arial" font-weight="bold">Rulex</text>
                <text x="600" y="1030" font-size="72" text-anchor="middle" font-family="Arial" letter-spacing="18">DISCOUNTS</text>
              </g>
            </svg> */}
            {/* Volume Discount App */}
            Rulex Discount App

          </div>
          <h1>Boost sales with<br />smart quantity discounts...</h1>
          <p>Reward customers for buying more. Set flexible quantity tiers and watch your average order value climb — automatically, no coupon codes needed.</p>
          <div className="vd-hero-actions">
            <s-link href="/app/volumediscount">
              <span className="btn-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create discount rule
              </span>
            </s-link>
            <s-link href="/app/volumediscount">
              <span className="btn-outline-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                View all rules
              </span>
            </s-link>
          </div>
        </div>

        {/* Stats */}
        {/* <div className="vd-stats">
          <div className="vd-stat-card">
            <div className="vd-stat-label">Active rules</div>
            <div className="vd-stat-value">0</div>
            <div className="vd-stat-sub">No rules yet</div>
          </div>
          <div className="vd-stat-card">
            <div className="vd-stat-label">Discounts applied</div>
            <div className="vd-stat-value">0</div>
            <div className="vd-stat-sub">This month</div>
          </div>
          <div className="vd-stat-card">
            <div className="vd-stat-label">Total savings given</div>
            <div className="vd-stat-value">₹0</div>
            <div className="vd-stat-sub">Across all orders</div>
          </div>
          <div className="vd-stat-card">
            <div className="vd-stat-label">Avg. order boost</div>
            <div className="vd-stat-value">—</div>
            <div className="vd-stat-sub">Needs data</div>
          </div>
        </div> */}

        {/* How it works */}
        <div className="vd-steps">
          <div className="vd-section-label">How it works</div>
          <div className="vd-steps-grid">
            <div className="vd-step">
              <div className="vd-step-num">1</div>
              <div>
                <h3>Create a discount rule</h3>
                <p>Pick a product or entire collection, then define quantity tiers with their discount values.</p>
              </div>
            </div>
            <div className="vd-step">
              <div className="vd-step-num">2</div>
              <div>
                <h3>Customer adds to cart</h3>
                <p>When a shopper reaches a qualifying quantity, the discount is applied to their cart instantly.</p>
              </div>
            </div>
            <div className="vd-step">
              <div className="vd-step-num">3</div>
              <div>
                <h3>Automatic discounts</h3>
                <p>Discounts are applied instantly when customers meet the quantity requirements — no codes needed.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tier example */}
        <div className="vd-example">
          <div className="vd-section-label">Example discount tiers</div>
          <p style={{ fontSize: "13px", color: "#6B6F8A", marginBottom: "1.25rem", lineHeight: 1.6 }}>
            Here's what a typical volume discount rule looks like. You can set as many tiers as you need.
          </p>
          <div className="vd-tier-row">
            <div className="vd-tier-qty">1+ items</div>
            <div className="vd-tier-label">Initial buy</div>
            <div className="vd-tier-discount">2% off</div>
            {/* <div className="vd-tier-label">Regular price</div>
            <div style={{ fontSize: "14px", color: "#8B8FA8" }}>No discount</div> */}
          </div>
          <div className="vd-tier-row">
            <div className="vd-tier-qty">5+ items</div>
            <div className="vd-tier-label">Small bulk buy</div>
            <div className="vd-tier-discount">5% off</div>
          </div>
          <div className="vd-tier-row">
            <div className="vd-tier-qty">10+ items</div>
            <div className="vd-tier-label">Medium bulk buy</div>
            <div className="vd-tier-discount">10% off</div>
          </div>
          <div className="vd-tier-row">
            <div className="vd-tier-qty">20+ items</div>
            <div className="vd-tier-label">Large bulk buy</div>
            <div className="vd-tier-discount">20% off</div>
          </div>
        </div>

        {/* Features */}
        <div className="vd-section-label">Features</div>
        <div className="vd-features">
          <div className="vd-feature-card">
            <div className="vd-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            </div>
            <h3>Unlimited tiers</h3>
            <p>Define as many quantity-price tiers as your business needs — no artificial limits.</p>
          </div>
          <div className="vd-feature-card">
            <div className="vd-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
            </div>
            <h3>% amount</h3>
            <p>Offer percentage-based discounts per tier, whichever fits your pricing.</p>
          </div>
          <div className="vd-feature-card">
            <div className="vd-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </div>
            <h3>Auto-applied</h3>
            <p>No coupon codes required. Discounts trigger automatically the moment cart quantities qualify.</p>
          </div>
          {/* <div className="vd-feature-card">
            <div className="vd-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </div>
            <h3>Analytics</h3>
            <p>Track how each rule impacts revenue and average order value over time.</p>
          </div> */}
          <div className="vd-feature-card">
            <div className="vd-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </div>
            <h3>Product rules</h3>
            <p>Apply discount rules to individual products and variants</p>
          </div>
          <div className="vd-feature-card">
            <div className="vd-feature-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
            </div>
            <h3>One click live</h3>
            <p>Rules activate instantly across your storefront on one click.</p>
          </div>
        </div>

        

        {/* CTA strip */}
        <div className="vd-cta">
          <div>
            <h2>Ready to grow your sales? </h2>
            <p>Create your first volume discount rule in under 2 minutes.</p>
          </div>
          <s-link href="/app/volumediscount">
            <span className="btn-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create discount rule
            </span>
          </s-link>
        </div>

      </div>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

