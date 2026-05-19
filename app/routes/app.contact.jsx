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

export default function Contact() {
    return (
        <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#F5F6FF", padding: "0" }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .vd-page { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }

       .vd-support-card,
.vd-disclaimer-card,
.vd-faq-box {
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 14px;
  padding: 1.5rem;
  margin-bottom: 1rem;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
}

.vd-support-card h3,
.vd-disclaimer-card h3,
.vd-faq-box h2 {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 12px;
}

.vd-support-card p,
.vd-disclaimer-card p {
  font-size: 14px;
  line-height: 1.7;
  color: #4B5563;
  margin-bottom: 18px;
}

.vd-support-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #F9FAFB;
  border: 1px solid #D1D5DB;
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  text-decoration: none;
  transition: all 0.2s ease;
}

.vd-support-btn:hover {
  background: #EEF2FF;
  border-color: #C7D2FE;
}

.vd-faq-box h2 {
  margin-bottom: 1rem;
}

.vd-faq-item {
  border-bottom: 1px solid #F3F4F6;
  padding: 14px 0;
}

.vd-faq-item:last-child {
  border-bottom: none;
}

.vd-faq-item summary {
  list-style: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  display: flex;
  align-items: center;
  gap: 10px;
}

.vd-faq-item summary::-webkit-details-marker {
  display: none;
}

.vd-faq-item summary::before {
  content: "➜";
  font-size: 12px;
  color: #6B7280;
}

.vd-faq-answer {
  margin-top: 10px;
  margin-left: 22px;
  font-size: 14px;
  color: #6B7280;
  line-height: 1.7;
}

.vd-support-footer {
  text-align: center;
  margin-top: 1.8rem;
  font-size: 14px;
  color: #4B5563;
}

.vd-support-footer a {
  color: #4F46E5;
  text-decoration: none;
  font-weight: 500;
}

.vd-support-footer a:hover {
  text-decoration: underline;
}


      `}</style>

            <div className="vd-page">


                {/* Contact / Support Section */}
                <div className="vd-faq">
                    <div className="vd-section-label">Support</div>

                    <p
                        style={{
                            fontSize: "14px",
                            color: "#6B6F8A",
                            marginBottom: "1.5rem",
                            lineHeight: "1.6",
                        }}
                    >
                        If you have questions or issues, we will help you get up and
                        running in no time.
                    </p>

                    {/* Support Card */}
                    <div className="vd-support-card">
                        <div>
                            <h3>Something is not working? 🧑‍💻</h3>

                            <p>
                                If you have questions, custom requests or anything that
                                needs fixing, contact us! We reply very fast.
                            </p>

                            <a
                                href="mailto:primedev026@gmail.com"
                                className="vd-support-btn"
                            >
                                Contact support
                            </a>
                        </div>
                    </div>

                    {/* Disclaimer */}
                    {/* <div className="vd-disclaimer-card">
                        <h3>Products availability disclaimer 📦</h3>

                        <p>
                            Please remember that the auto-added products must always
                            be in Active or Unlisted status, have available inventory,
                            be present in the necessary markets and in the online store
                            sales channel. If these conditions are not met, the product
                            will not be added to cart.
                        </p>
                    </div> */}

                    {/* FAQ */}
                    <div className="vd-faq-box">
                        <h2>Frequently asked questions</h2>

                       {/* FAQ Section */}
            <div className="vd-faq">
              {/* <div className="vd-section-label">Frequently asked questions</div> */}

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

                    {/* Footer */}
                    <div className="vd-support-footer">
                        Having issues?{" "}
                        <a href="mailto:primedev026@gmail.com">
                            Click here
                        </a>{" "}
                        to open the support bubble or contact us at{" "}
                        <strong>primedev026@gmail.com</strong>
                    </div>
                </div>


            </div>
        </div>
    );
}

export const headers = (headersArgs) => {
    return boundary.headers(headersArgs);
};

