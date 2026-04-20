import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const METAFIELD_NAMESPACE = "volume_discount_settings";
const METAFIELD_KEY = "product_volume_rules";
const METAFIELD_TYPE = "json";

// ─── Server: Loader ───────────────────────────────────────────────────────────

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const metafieldResponse = await admin.graphql(
    `#graphql
    query GetVolumeDiscountMetafield {
      shop {
        id
        metafield(namespace: "volume_discount_settings", key: "product_volume_rules") {
          id
          value
          jsonValue
        }
      }
    }`
  );

  const metafieldJson = await metafieldResponse.json();
  const metafield = metafieldJson?.data?.shop?.metafield;
  let savedRules = [];

  if (metafield) {
    try {
      savedRules = metafield.jsonValue ?? JSON.parse(metafield.value) ?? [];
    } catch {
      savedRules = [];
    }
  }

  // Fetch full product + variant details for saved rules
  let savedProducts = [];
  if (Array.isArray(savedRules) && savedRules.length > 0) {
    const productIds = savedRules.map((r) => r.productId).filter(Boolean);
    if (productIds.length > 0) {
      const aliases = productIds
        .map(
          (id, i) => `
          p${i}: product(id: "${id}") {
            id
            title
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
            }
            images(first: 1) {
              edges { node { url } }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  image { url }
                }
              }
            }
          }`
        )
        .join("\n");

      const productsResponse = await admin.graphql(
        `#graphql
        query GetSavedProducts {
          ${aliases}
        }`
      );

      const productsJson = await productsResponse.json();
      if (productsJson?.data) {
        savedProducts = Object.values(productsJson.data).filter(Boolean);
      }
    }
  }

  return { savedRules, savedProducts };
}

// ─── Server: Action ───────────────────────────────────────────────────────────

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  // ── Search / Browse products ──
  if (actionType === "SEARCH_PRODUCTS") {
    console.log("ffff");
    const raw = formData.get("query");
    const searchTerm = typeof raw === "string" ? raw.trim() : "";
    const variables = searchTerm.length > 0 ? { query: `title:${searchTerm}` } : {};

    const response = await admin.graphql(
      `#graphql
      query SearchProducts($query: String) {
        products(first: 250, query: $query) {
          edges {
            node {
              id
              title
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
              }
              images(first: 1) {
                edges { node { url } }
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    price
                    image { url }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables }
    );

    const json = await response.json();
    if (json.errors) console.error("Shopify GraphQL errors:", JSON.stringify(json.errors));
    const products = json?.data?.products?.edges?.map((e) => e.node) || [];
    return { actionType: "SEARCH_PRODUCTS", products };
  }

  // ── Save volume discount rules ──
  if (actionType === "SAVE_VOLUME_RULES") {
    const rulesRaw = formData.get("rules");
    let rules;
    try {
      rules = JSON.parse(rulesRaw);
    } catch {
      return { actionType: "SAVE_VOLUME_RULES", errors: ["Invalid rules data."] };
    }

    const shopResponse = await admin.graphql(
  `#graphql
  query GetShopId {
    shop {
      id
    }
  }`
);
    const shopJson = await shopResponse.json();
    const shopId = shopJson?.data?.shop?.id;

    if (!shopId)
      return { actionType: "SAVE_VOLUME_RULES", errors: ["Unable to resolve shop ID."] };

    const mutation = await admin.graphql(
      `#graphql
      mutation SaveVolumeDiscountRules($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key value }
          userErrors { field message code }
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
              value: JSON.stringify(rules),
            },
          ],
        },
      }
    );

    const mutationJson = await mutation.json();
    const userErrors = mutationJson?.data?.metafieldsSet?.userErrors || [];
    if (userErrors.length) {
      return { actionType: "SAVE_VOLUME_RULES", errors: userErrors.map((e) => e.message) };
    }

    const saved = mutationJson?.data?.metafieldsSet?.metafields?.[0];
    try {
      return { actionType: "SAVE_VOLUME_RULES", success: true, savedRules: JSON.parse(saved.value) };
    } catch {
      return { actionType: "SAVE_VOLUME_RULES", success: true, savedRules: rules };
    }
  }

  return { errors: ["Unknown action."] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProductImage(product) {
  return product?.images?.edges?.[0]?.node?.url || null;
}

function getProductPrice(product) {
  const price = product?.priceRangeV2?.minVariantPrice;
  if (!price) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currencyCode || "USD",
  }).format(Number(price.amount));
}

function getVariants(product) {
  return product?.variants?.edges?.map((e) => e.node) || [];
}

// ─── Portal Dropdown ──────────────────────────────────────────────────────────

function PortalDropdown({ anchorRef, portalRef, children }) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    function updateRect() {
      if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [anchorRef]);

  if (!rect) return null;

  return createPortal(
    <div
      ref={portalRef}
      style={{
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        background: "#fff",
        border: "1px solid #c9cccf",
        borderRadius: "10px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
        zIndex: 99999,
        overflow: "hidden",
        maxHeight: "320px",
        overflowY: "auto",
      }}
    >
      {children}
    </div>,
    document.body
  );
}

// ─── Tier Modal (variant-based) ───────────────────────────────────────────────

function TierModal({ product, existingTiers, onClose, onSave, isSaving }) {
  const variants = getVariants(product);

  // variantTiers: { [variantId]: [{ _id, minQty, discount, label }] }
  const [variantTiers, setVariantTiers] = useState(() => {
    const init = {};
    variants.forEach((v) => {
      const saved = existingTiers?.filter((t) => t.variantId === v.id) || [];
      init[v.id] = saved.length
        ? saved.map((t, i) => ({ ...t, _id: i + 1 }))
        : [];
    });
    return init;
  });

  const [counters, setCounters] = useState(() => {
    const init = {};
    variants.forEach((v) => {
      const saved = existingTiers?.filter((t) => t.variantId === v.id) || [];
      init[v.id] = saved.length;
    });
    return init;
  });

  // Track which variant sections are expanded
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    // Auto-expand variants that already have tiers
    variants.forEach((v) => {
      const saved = existingTiers?.filter((t) => t.variantId === v.id) || [];
      init[v.id] = saved.length > 0;
    });
    // If none expanded, expand first
    if (variants.length > 0 && !Object.values(init).some(Boolean)) {
      init[variants[0].id] = true;
    }
    return init;
  });

  function toggleExpand(variantId) {
    setExpanded((prev) => ({ ...prev, [variantId]: !prev[variantId] }));
  }

  function addTier(variantId) {
    const newId = (counters[variantId] || 0) + 1;
    setCounters((prev) => ({ ...prev, [variantId]: newId }));
    setVariantTiers((prev) => ({
      ...prev,
      [variantId]: [...(prev[variantId] || []), { _id: newId, minQty: "", discount: "", label: "" }],
    }));
  }

  function removeTier(variantId, _id) {
    setVariantTiers((prev) => ({
      ...prev,
      [variantId]: prev[variantId].filter((t) => t._id !== _id),
    }));
  }

  function updateTier(variantId, _id, field, value) {
    setVariantTiers((prev) => ({
      ...prev,
      [variantId]: prev[variantId].map((t) => (t._id === _id ? { ...t, [field]: value } : t)),
    }));
  }

  function handleSave() {
    // Flatten all variant tiers into a single array with variantId attached
    const allTiers = [];
    variants.forEach((v) => {
      const tiers = variantTiers[v.id] || [];
      const valid = tiers
        .filter((t) => t.minQty !== "" && t.discount !== "")
        .map(({ _id, ...t }) => ({
          variantId: v.id,
          variantTitle: v.title,
          minQty: Number(t.minQty),
          discount: Number(t.discount),
          label: t.label || "",
        }))
        .sort((a, b) => a.minQty - b.minQty);
      allTiers.push(...valid);
    });

    if (!allTiers.length) return;
    onSave(product, allTiers);
  }

  // canSave: at least one variant has at least one valid tier
  const canSave = variants.some((v) =>
    (variantTiers[v.id] || []).some((t) => t.minQty !== "" && t.discount !== "")
  );

  // Count saved tiers per variant
  function variantTierCount(variantId) {
    return (variantTiers[variantId] || []).filter((t) => t.minQty !== "" && t.discount !== "").length;
  }

  const imgUrl = getProductImage(product);
  const price = getProductPrice(product);
  const isDefault = variants.length === 1 && variants[0].title === "Default Title";

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000 }}
      />
      <div
        style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#fff", borderRadius: "12px",
          width: "min(700px, 95vw)", maxHeight: "88vh",
          overflowY: "auto", zIndex: 10001,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "20px 24px", borderBottom: "1px solid #e1e3e5", position: "sticky", top: 0, background: "#fff", zIndex: 1, borderRadius: "12px 12px 0 0" }}>
          {imgUrl ? (
            <img src={imgUrl} alt={product.title} style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e1e3e5", flexShrink: 0 }} />
          ) : (
            <div style={{ width: "48px", height: "48px", borderRadius: "8px", background: "#f1f2f3", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="#8c9196"><path d="M2 3a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm0 6a1 1 0 011-1h14a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V9z" /></svg>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {product.title}
            </div>
            <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
              {isDefault ? "1 variant (default)" : `${variants.length} variant${variants.length !== 1 ? "s" : ""}`}
              {price && ` · Starting at ${price}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "6px", borderRadius: "6px", color: "#6d7175", display: "flex" }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" /></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px", flex: 1 }}>

          {/* Info banner */}
          <div style={{ background: "#f0f4ff", border: "1px solid #c4cff5", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#3c4fe0", display: "flex", gap: "8px", alignItems: "flex-start" }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0, marginTop: "1px" }}><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
            <span>Tiers are configured per variant. The Variant ID is saved to the metafield for use in your discount function.</span>
          </div>

          {/* Variant sections */}
          {variants.map((variant, vIndex) => {
            const tiers = variantTiers[variant.id] || [];
            const isExpanded = expanded[variant.id];
            const tierCount = variantTierCount(variant.id);
            const variantImg = variant.image?.url || imgUrl;
            const shortId = variant.id.split("/").pop();

            return (
              <div
                key={variant.id}
                style={{ border: "1px solid #e1e3e5", borderRadius: "10px", marginBottom: "10px", overflow: "hidden" }}
              >
                {/* Variant header row */}
                <div
                  onClick={() => toggleExpand(variant.id)}
                  style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", background: isExpanded ? "#f4f5fa" : "#fafafa", cursor: "pointer", userSelect: "none" }}
                >
                  {variantImg && !isDefault && (
                    <img src={variantImg} alt={variant.title} style={{ width: "32px", height: "32px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e1e3e5", flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#202223" }}>
                      {isDefault ? "Default Variant" : variant.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6d7175", marginTop: "2px", fontFamily: "monospace" }}>
                      ID: {shortId}
                      {variant.price && ` · $${variant.price}`}
                    </div>
                  </div>
                  {tierCount > 0 && (
                    <span style={{ fontSize: "11px", fontWeight: 500, background: "#e3f1df", color: "#108043", borderRadius: "20px", padding: "2px 10px", flexShrink: 0 }}>
                      {tierCount} tier{tierCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  <svg
                    width="16" height="16" viewBox="0 0 20 20" fill="#6d7175"
                    style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}
                  >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>

                {/* Expanded tier table */}
                {isExpanded && (
                  <div style={{ padding: "14px 16px", background: "#fff", borderTop: "1px solid #e1e3e5" }}>

                    {/* Add tier button */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <div style={{ fontSize: "12px", color: "#6d7175" }}>
                        Set quantity thresholds and discounts for this variant
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); addTier(variant.id); }}
                        style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 12px", background: "#5c6ac4", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}
                      >
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
                          <path d="M7 1a1 1 0 011 1v4h4a1 1 0 110 2H8v4a1 1 0 11-2 0V8H2a1 1 0 110-2h4V2a1 1 0 011-1z" />
                        </svg>
                        Add Tier
                      </button>
                    </div>

                    {tiers.length === 0 && (
                      <div style={{ textAlign: "center", padding: "20px", color: "#8c9196", background: "#f6f6f7", borderRadius: "7px", border: "1px dashed #c9cccf", fontSize: "12px" }}>
                        No tiers yet for this variant. Click "Add Tier" above.
                      </div>
                    )}

                    {tiers.length > 0 && (
                      <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
                        {/* Table header */}
                        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 1.3fr 32px", gap: "8px", padding: "8px 12px", background: "#f1f2f3", borderBottom: "1px solid #e1e3e5" }}>
                          {["#", "Min Qty", "Discount %", "Label (optional)", ""].map((h, i) => (
                            <div key={i} style={{ fontSize: "10px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                          ))}
                        </div>

                        {tiers.map((tier, tIndex) => (
                          <div
                            key={tier._id}
                            style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 1.3fr 32px", gap: "8px", padding: "8px 12px", alignItems: "center", borderBottom: tIndex < tiers.length - 1 ? "1px solid #f1f2f3" : "none", background: "#fff" }}
                          >
                            <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#5c6ac4", color: "#fff", fontSize: "10px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {tIndex + 1}
                            </div>
                            <input
                              type="number" min="1" placeholder="e.g. 10"
                              value={tier.minQty}
                              onChange={(e) => updateTier(variant.id, tier._id, "minQty", e.target.value)}
                              style={{ border: "1px solid #c9cccf", borderRadius: "6px", padding: "5px 8px", fontSize: "12px", width: "100%", outline: "none", boxSizing: "border-box" }}
                              onFocus={(e) => (e.target.style.borderColor = "#5c6ac4")}
                              onBlur={(e) => (e.target.style.borderColor = "#c9cccf")}
                            />
                            <div style={{ position: "relative" }}>
                              <input
                                type="number" min="0" max="100" step="0.5" placeholder="e.g. 15"
                                value={tier.discount}
                                onChange={(e) => updateTier(variant.id, tier._id, "discount", e.target.value)}
                                style={{ border: "1px solid #c9cccf", borderRadius: "6px", padding: "5px 22px 5px 8px", fontSize: "12px", width: "100%", outline: "none", boxSizing: "border-box" }}
                                onFocus={(e) => (e.target.style.borderColor = "#5c6ac4")}
                                onBlur={(e) => (e.target.style.borderColor = "#c9cccf")}
                              />
                              <span style={{ position: "absolute", right: "7px", top: "50%", transform: "translateY(-50%)", fontSize: "11px", color: "#6d7175", pointerEvents: "none" }}>%</span>
                            </div>
                            <input
                              type="text" placeholder="e.g. Bulk deal"
                              value={tier.label}
                              onChange={(e) => updateTier(variant.id, tier._id, "label", e.target.value)}
                              style={{ border: "1px solid #c9cccf", borderRadius: "6px", padding: "5px 8px", fontSize: "12px", width: "100%", outline: "none", boxSizing: "border-box" }}
                              onFocus={(e) => (e.target.style.borderColor = "#5c6ac4")}
                              onBlur={(e) => (e.target.style.borderColor = "#c9cccf")}
                            />
                            <button
                              onClick={() => removeTier(variant.id, tier._id)}
                              style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", borderRadius: "4px", color: "#6d7175", display: "flex", alignItems: "center", justifyContent: "center" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "#fff4f4"; e.currentTarget.style.color = "#d82c0d"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#6d7175"; }}
                            >
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M6 2a1 1 0 00-1 1v.5H2.5a.5.5 0 000 1H3v8a1 1 0 001 1h8a1 1 0 001-1v-8h.5a.5.5 0 000-1H11V3a1 1 0 00-1-1H6zm0 1h4v.5H6V3zm-2 2h8v8H4V5zm2 2a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4A.5.5 0 006 7zm2 0a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4A.5.5 0 008 7zm2 0a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4A.5.5 0 0010 7z" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Preview */}
                    {tiers.some((t) => t.minQty && t.discount) && (
                      <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "3px" }}>
                        {tiers
                          .filter((t) => t.minQty && t.discount)
                          .sort((a, b) => Number(a.minQty) - Number(b.minQty))
                          .map((t, i) => (
                            <div key={i} style={{ fontSize: "11px", color: "#202223", background: "#f0f4ff", border: "1px solid #c4cff5", borderRadius: "5px", padding: "4px 10px" }}>
                              Buy <strong>{t.minQty}+</strong> → <strong>{t.discount}% off</strong>
                              {t.label ? ` — ${t.label}` : ""}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "16px 24px", borderTop: "1px solid #e1e3e5", background: "#f6f6f7", borderRadius: "0 0 12px 12px", position: "sticky", bottom: 0 }}>
          <div style={{ fontSize: "12px", color: "#6d7175" }}>
            {variants.reduce((acc, v) => acc + variantTierCount(v.id), 0)} tier{variants.reduce((acc, v) => acc + variantTierCount(v.id), 0) !== 1 ? "s" : ""} configured across {variants.filter(v => variantTierCount(v.id) > 0).length} variant{variants.filter(v => variantTierCount(v.id) > 0).length !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={onClose}
              style={{ padding: "8px 18px", border: "1px solid #c9cccf", borderRadius: "8px", background: "#fff", fontSize: "14px", fontWeight: 500, cursor: "pointer", color: "#202223" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || isSaving}
              style={{ padding: "8px 18px", border: "none", borderRadius: "8px", background: canSave && !isSaving ? "#5c6ac4" : "#c9cccf", color: "#fff", fontSize: "14px", fontWeight: 500, cursor: canSave && !isSaving ? "pointer" : "not-allowed" }}
            >
              {isSaving ? "Saving..." : "Save Tiers"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VolumeDiscount() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addedProducts, setAddedProducts] = useState(loaderData?.savedProducts || []);
  const [modalProduct, setModalProduct] = useState(null);
  const [allRules, setAllRules] = useState(loaderData?.savedRules || []);

  const searchBarRef = useRef(null);
  const dropdownPortalRef = useRef(null);
  const searchDebounceRef = useRef(null);

  const isSearching = fetcher.state !== "idle" && fetcher.formData?.get("actionType") === "SEARCH_PRODUCTS";
  const isSaving = fetcher.state !== "idle" && fetcher.formData?.get("actionType") === "SAVE_VOLUME_RULES";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.actionType === "SEARCH_PRODUCTS") {
      setSuggestions(fetcher.data.products || []);
      setShowSuggestions(true);
    }
    if (fetcher.data.actionType === "SAVE_VOLUME_RULES") {
      if (fetcher.data.success) {
        shopify.toast.show("Volume discount rules saved!");
        setAllRules(fetcher.data.savedRules || allRules);
        setModalProduct(null);
      }
      if (fetcher.data.errors?.length) {
        shopify.toast.show(fetcher.data.errors.join(", "), { isError: true });
      }
    }
  }, [fetcher.data]);

  useEffect(() => {
    function handleClickOutside(e) {
      const inSearchBar = searchBarRef.current && searchBarRef.current.contains(e.target);
      const inPortal = dropdownPortalRef.current && dropdownPortalRef.current.contains(e.target);
      if (!inSearchBar && !inPortal) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSearchInput(value) {
    setSearchQuery(value);
    clearTimeout(searchDebounceRef.current);
    if (value.trim().length === 0) { setSuggestions([]); setShowSuggestions(false); return; }
    searchDebounceRef.current = setTimeout(() => {
      fetcher.submit({ actionType: "SEARCH_PRODUCTS", query: value }, { method: "post" });
    }, 350);
  }

  function handleBrowse() {
    fetcher.submit({ actionType: "SEARCH_PRODUCTS", query: "" }, { method: "post" });
    setShowSuggestions(true);
  }

  function handleSelectSuggestion(product) {
    setShowSuggestions(false);
    setSearchQuery("");
    if (addedProducts.find((p) => p.id === product.id)) return;
    setAddedProducts((prev) => [...prev, product]);
  }

  function handleRemoveProduct(productId) {
    setAddedProducts((prev) => prev.filter((p) => p.id !== productId));
  }

  function handleSaveTiers(product, tiers) {
    const updatedRules = Array.isArray(allRules)
      ? allRules.filter((r) => r.productId !== product.id)
      : [];
    updatedRules.push({
      productId: product.id,
      productTitle: product.title,
      tiers, // each tier now has variantId + variantTitle
      updatedAt: new Date().toISOString().slice(0, 10),
    });
    fetcher.submit(
      { actionType: "SAVE_VOLUME_RULES", rules: JSON.stringify(updatedRules) },
      { method: "post" }
    );
  }

  function getExistingTiers(productId) {
    const rule = Array.isArray(allRules) ? allRules.find((r) => r.productId === productId) : null;
    return rule?.tiers || [];
  }

  return (
    <s-page heading="Volume Discounts">

      {/* Search */}
      <s-section heading="Add Products">
        <div ref={searchBarRef} style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", border: `1px solid ${showSuggestions ? "#5c6ac4" : "#c9cccf"}`, borderRadius: "10px", padding: "0 12px", background: "#fff", boxShadow: showSuggestions ? "0 0 0 3px rgba(92,106,196,0.15)" : "none", transition: "border-color 0.15s, box-shadow 0.15s" }}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="#8c9196" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              type="text" placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", padding: "10px 0", background: "transparent", color: "#202223" }}
            />
            {isSearching && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: "vd-spin 0.8s linear infinite", flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" stroke="#e1e3e5" strokeWidth="3" />
                <path d="M12 2a10 10 0 0110 10" stroke="#5c6ac4" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            <div style={{ width: "1px", height: "20px", background: "#e1e3e5", margin: "0 4px", flexShrink: 0 }} />
            <button
              onClick={handleBrowse}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#f1f2f3", border: "1px solid #c9cccf", borderRadius: "7px", fontSize: "13px", fontWeight: 500, color: "#202223", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#e4e5e7")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#f1f2f3")}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-.553.894l-4 2A1 1 0 017 19v-8.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              Browse
            </button>
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <PortalDropdown anchorRef={searchBarRef} portalRef={dropdownPortalRef}>
              <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f1f2f3", background: "#fafafa" }}>
                {suggestions.length} product{suggestions.length !== 1 ? "s" : ""} found
              </div>
              {suggestions.map((product) => {
                const img = getProductImage(product);
                const price = getProductPrice(product);
                const variants = getVariants(product);
                const alreadyAdded = addedProducts.some((p) => p.id === product.id);
                const isDefault = variants.length === 1 && variants[0].title === "Default Title";
                return (
                  <div
                    key={product.id}
                    onClick={() => !alreadyAdded && handleSelectSuggestion(product)}
                    style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", cursor: alreadyAdded ? "default" : "pointer", borderBottom: "1px solid #f1f2f3", background: alreadyAdded ? "#f6f6f7" : "#fff", opacity: alreadyAdded ? 0.6 : 1 }}
                    onMouseEnter={(e) => { if (!alreadyAdded) e.currentTarget.style.background = "#f4f5fa"; }}
                    onMouseLeave={(e) => { if (!alreadyAdded) e.currentTarget.style.background = "#fff"; }}
                  >
                    {img ? (
                      <img src={img} alt={product.title} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e1e3e5", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: "36px", height: "36px", borderRadius: "6px", background: "#f1f2f3", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 500, color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.title}</div>
                      <div style={{ fontSize: "11px", color: "#6d7175" }}>
                        {price}{!isDefault && ` · ${variants.length} variants`}
                      </div>
                    </div>
                    {alreadyAdded ? (
                      <span style={{ fontSize: "11px", color: "#6d7175", background: "#f1f2f3", border: "1px solid #e1e3e5", borderRadius: "20px", padding: "2px 10px" }}>Added</span>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="#5c6ac4"><path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" /></svg>
                    )}
                  </div>
                );
              })}
            </PortalDropdown>
          )}

          {showSuggestions && suggestions.length === 0 && !isSearching && searchQuery && (
            <PortalDropdown anchorRef={searchBarRef} portalRef={dropdownPortalRef}>
              <div style={{ padding: "20px", textAlign: "center", color: "#6d7175", fontSize: "13px" }}>
                No products found for "{searchQuery}"
              </div>
            </PortalDropdown>
          )}
        </div>
      </s-section>

      {/* Product list */}
      <s-section heading="Selected Products">
        {addedProducts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#8c9196", background: "#f6f6f7", borderRadius: "10px", border: "1px dashed #c9cccf" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c9cccf" strokeWidth="1.5" style={{ marginBottom: "10px" }}>
              <path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
              <path d="M16 3H8a2 2 0 00-2 2v2h12V5a2 2 0 00-2-2z" />
            </svg>
            <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "4px" }}>No products added yet</div>
            <div style={{ fontSize: "13px" }}>Search or browse products above to configure volume discounts</div>
          </div>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "10px", overflow: "hidden" }}>
            {addedProducts.map((product, index) => {
              const img = getProductImage(product);
              const price = getProductPrice(product);
              const existingTiers = getExistingTiers(product.id);
              const hasTiers = existingTiers.length > 0;
              const variants = getVariants(product);
              const isDefault = variants.length === 1 && variants[0].title === "Default Title";
              // Count how many variants have tiers
              const variantsWithTiers = new Set(existingTiers.map((t) => t.variantId)).size;

              return (
                <div key={product.id} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", background: "#fff", borderBottom: index < addedProducts.length - 1 ? "1px solid #e1e3e5" : "none" }}>
                  {img ? (
                    <img src={img} alt={product.title} style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e1e3e5", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: "48px", height: "48px", borderRadius: "8px", background: "#f1f2f3", border: "1px solid #e1e3e5", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="#c9cccf"><path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6l1.5 3H5.5L7 5z" /></svg>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px", flexWrap: "wrap" }}>
                      {price && <span style={{ fontSize: "12px", color: "#6d7175" }}>{price}</span>}
                      {!isDefault && <span style={{ fontSize: "11px", color: "#6d7175" }}>{variants.length} variants</span>}
                      {hasTiers && (
                        <span style={{ fontSize: "11px", fontWeight: 500, background: "#e3f1df", color: "#108043", borderRadius: "20px", padding: "1px 8px" }}>
                          {existingTiers.length} tier{existingTiers.length !== 1 ? "s" : ""} · {variantsWithTiers} variant{variantsWithTiers !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <button
                      onClick={() => handleRemoveProduct(product.id)}
                      title="Remove"
                      style={{ background: "none", border: "1px solid #e1e3e5", borderRadius: "7px", padding: "6px 8px", cursor: "pointer", color: "#6d7175", display: "flex", alignItems: "center" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#fff4f4"; e.currentTarget.style.borderColor = "#f9a89c"; e.currentTarget.style.color = "#d82c0d"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "#e1e3e5"; e.currentTarget.style.color = "#6d7175"; }}
                    >
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </button>
                    <button
                      onClick={() => setModalProduct(product)}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", background: hasTiers ? "#f0f4ff" : "#5c6ac4", color: hasTiers ? "#5c6ac4" : "#fff", border: hasTiers ? "1px solid #c4cff5" : "none", borderRadius: "8px", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}
                    >
                      {hasTiers ? "Edit Tiers" : "Add Tiers"}
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style={{ transform: "rotate(-90deg)" }}>
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </s-section>

      {/* Metafield preview */}
      {allRules?.length > 0 && (
        <s-section heading="Saved Metafield">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <pre style={{ margin: 0, fontSize: "12px", overflowX: "auto" }}>
              {JSON.stringify(allRules, null, 2)}
            </pre>
          </s-box>
        </s-section>
      )}

      {modalProduct && (
        <TierModal
          product={modalProduct}
          existingTiers={getExistingTiers(modalProduct.id)}
          onClose={() => setModalProduct(null)}
          onSave={handleSaveTiers}
          isSaving={isSaving}
        />
      )}

      <style>{`
        @keyframes vd-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
















//     import { useEffect, useState } from "react";
// import { useFetcher, useLoaderData } from "react-router";
// import { useAppBridge } from "@shopify/app-bridge-react";
// import { boundary } from "@shopify/shopify-app-react-router/server";
// import { authenticate } from "../shopify.server";

// const METAFIELD_NAMESPACE = "volume_discount_settings";
// const METAFIELD_KEY = "product_volume_rules";
// const METAFIELD_TYPE = "json";

// // ─── Server: Load products + existing metafield ───────────────────────────────

// export async function loader({ request }) {
//   const { admin } = await authenticate.admin(request);
//   const url = new URL(request.url);
//   const searchQuery = url.searchParams.get("q") || "";

//   // Fetch products (search or first 10)
//   const productsResponse = await admin.graphql(
//     `#graphql
//     query GetProducts($query: String!) {
//       products(first: 10, query: $query) {
//         edges {
//           node {
//             id
//             title
//             images(first: 1) {
//               edges {
//                 node {
//                   url
//                 }
//               }
//             }
//           }
//         }
//       }
//     }`,
//     { variables: { query: searchQuery } }
//   );

//   const productsJson = await productsResponse.json();
//   const products = productsJson?.data?.products?.edges?.map((e) => e.node) || [];

//   // Fetch existing volume discount metafield
//   const metafieldResponse = await admin.graphql(
//     `#graphql
//     query GetVolumeDiscountMetafield {
//       shop {
//         id
//         metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
//           id
//           value
//           jsonValue
//         }
//       }
//     }`
//   );

//   const metafieldJson = await metafieldResponse.json();
//   const metafield = metafieldJson?.data?.shop?.metafield;
//   let savedRules = null;

//   if (metafield) {
//     try {
//       savedRules = metafield.jsonValue ?? JSON.parse(metafield.value);
//     } catch {
//       savedRules = null;
//     }
//   }

//   return { products, savedRules, searchQuery };
// }

// // ─── Server: Save metafield ───────────────────────────────────────────────────

// export async function action({ request }) {
//   const { admin } = await authenticate.admin(request);
//   const formData = await request.formData();
//   const actionType = formData.get("actionType");

//   // ── Search products ──
//   if (actionType === "SEARCH_PRODUCTS") {
//     const query = formData.get("query") || "";
//     const response = await admin.graphql(
//       `#graphql
//       query SearchProducts($query: String!) {
//         products(first: 10, query: $query) {
//           edges {
//             node {
//               id
//               title
//               images(first: 1) {
//                 edges {
//                   node {
//                     url
//                   }
//                 }
//               }
//             }
//           }
//         }
//       }`,
//       { variables: { query } }
//     );
//     const json = await response.json();
//     const products = json?.data?.products?.edges?.map((e) => e.node) || [];
//     return { products };
//   }

//   // ── Save volume discount rules to shop metafield ──
//   if (actionType === "SAVE_VOLUME_RULES") {
//     const rulesRaw = formData.get("rules");
//     let rules;
//     try {
//       rules = JSON.parse(rulesRaw);
//     } catch {
//       return { errors: ["Invalid rules data."] };
//     }

//     // Get shop ID
//     const shopResponse = await admin.graphql(
//       `#graphql
//       query GetShopId {
//         shop { id }
//       }`
//     );
//     const shopJson = await shopResponse.json();
//     const shopId = shopJson?.data?.shop?.id;

//     if (!shopId) return { errors: ["Unable to resolve shop ID."] };

//     // Upsert metafield
//     const mutation = await admin.graphql(
//       `#graphql
//       mutation SaveVolumeDiscountRules($metafields: [MetafieldsSetInput!]!) {
//         metafieldsSet(metafields: $metafields) {
//           metafields {
//             id
//             namespace
//             key
//             value
//           }
//           userErrors {
//             field
//             message
//             code
//           }
//         }
//       }`,
//       {
//         variables: {
//           metafields: [
//             {
//               ownerId: shopId,
//               namespace: METAFIELD_NAMESPACE,
//               key: METAFIELD_KEY,
//               type: METAFIELD_TYPE,
//               value: JSON.stringify(rules),
//             },
//           ],
//         },
//       }
//     );

//     const mutationJson = await mutation.json();
//     const userErrors = mutationJson?.data?.metafieldsSet?.userErrors || [];

//     if (userErrors.length) {
//       return { errors: userErrors.map((e) => e.message) };
//     }

//     const saved = mutationJson?.data?.metafieldsSet?.metafields?.[0];
//     try {
//       return { success: true, savedRules: JSON.parse(saved.value) };
//     } catch {
//       return { success: true, savedRules: rules };
//     }
//   }

//   return { errors: ["Unknown action."] };
// }

// // ─── Client: Volume Discount UI ───────────────────────────────────────────────

// export default function VolumeDiscount() {
//   const loaderData = useLoaderData();
//   const fetcher = useFetcher();
//   const shopify = useAppBridge();

//   const [products, setProducts] = useState(loaderData?.products || []);
//   const [searchQuery, setSearchQuery] = useState("");
//   const [selectedProduct, setSelectedProduct] = useState(null);

//   // tiers: [{ id, minQty, discount, label }]
//   const [tiers, setTiers] = useState([]);
//   const [tierCounter, setTierCounter] = useState(0);

//   // Saved rules from metafield (all products combined)
//   const [allRules, setAllRules] = useState(loaderData?.savedRules || []);

//   const isSearching =
//     fetcher.state !== "idle" && fetcher.formData?.get("actionType") === "SEARCH_PRODUCTS";
//   const isSaving =
//     fetcher.state !== "idle" && fetcher.formData?.get("actionType") === "SAVE_VOLUME_RULES";

//   // ── Handle fetcher responses ──
//   useEffect(() => {
//     if (!fetcher.data) return;

//     if (fetcher.data.products) {
//       setProducts(fetcher.data.products);
//     }

//     if (fetcher.data.success) {
//       shopify.toast.show("Volume discount rules saved successfully!");
//       setAllRules(fetcher.data.savedRules || allRules);
//     }

//     if (fetcher.data.errors?.length) {
//       shopify.toast.show(fetcher.data.errors.join(", "), { isError: true });
//     }
//   }, [fetcher.data]);

//   // ── When a product is selected, load its existing tiers if any ──
//   function handleSelectProduct(product) {
//     setSelectedProduct(product);
//     const existing = Array.isArray(allRules)
//       ? allRules.find((r) => r.productId === product.id)
//       : null;

//     if (existing?.tiers?.length) {
//       const loaded = existing.tiers.map((t, i) => ({
//         id: i + 1,
//         minQty: t.minQty,
//         discount: t.discount,
//         label: t.label || "",
//       }));
//       setTiers(loaded);
//       setTierCounter(loaded.length);
//     } else {
//       setTiers([]);
//       setTierCounter(0);
//     }
//   }

//   // ── Tier helpers ──
//   function addTier() {
//     const newId = tierCounter + 1;
//     setTierCounter(newId);
//     setTiers((prev) => [...prev, { id: newId, minQty: "", discount: "", label: "" }]);
//   }

//   function removeTier(id) {
//     setTiers((prev) => prev.filter((t) => t.id !== id));
//   }

//   function updateTier(id, field, value) {
//     setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
//   }

//   // ── Search ──
//   function handleSearch() {
//     fetcher.submit(
//       { actionType: "SEARCH_PRODUCTS", query: searchQuery },
//       { method: "post" }
//     );
//   }

//   // ── Save ──
//   function handleSave() {
//     if (!selectedProduct) return;

//     const validTiers = tiers
//       .filter((t) => t.minQty !== "" && t.discount !== "")
//       .map((t) => ({
//         minQty: Number(t.minQty),
//         discount: Number(t.discount),
//         label: t.label,
//       }))
//       .sort((a, b) => a.minQty - b.minQty);

//     if (!validTiers.length) {
//       shopify.toast.show("Please add at least one valid tier.", { isError: true });
//       return;
//     }

//     // Merge with existing rules (replace if product already exists)
//     const updatedRules = Array.isArray(allRules)
//       ? allRules.filter((r) => r.productId !== selectedProduct.id)
//       : [];

//     updatedRules.push({
//       productId: selectedProduct.id,
//       productTitle: selectedProduct.title,
//       tiers: validTiers,
//       updatedAt: new Date().toISOString().slice(0, 10),
//     });

//     fetcher.submit(
//       { actionType: "SAVE_VOLUME_RULES", rules: JSON.stringify(updatedRules) },
//       { method: "post" }
//     );
//   }

//   const canSave =
//     selectedProduct &&
//     tiers.length > 0 &&
//     tiers.every((t) => t.minQty !== "" && t.discount !== "");

//   const productImage = (product) =>
//     product?.images?.edges?.[0]?.node?.url || null;

//   return (
//     <s-page heading="Volume Discounts">
//       {/* ── Product Search ── */}
//       <s-section heading="Search & Select Product">
//         <s-stack direction="inline" gap="base" align="end">
//           <s-text-field
//             label="Search products"
//             placeholder="e.g. T-shirt, Shoes..."
//             value={searchQuery}
//             onInput={(e) => setSearchQuery(e.target.value)}
//             onKeyDown={(e) => e.key === "Enter" && handleSearch()}
//           />
//           <s-button
//             onClick={handleSearch}
//             {...(isSearching ? { loading: true } : {})}
//           >
//             Search
//           </s-button>
//         </s-stack>

//         {/* Product list */}
//         {products.length > 0 && (
//           <s-stack direction="block" gap="tight" style={{ marginTop: "12px" }}>
//             {products.map((product) => {
//               const isSelected = selectedProduct?.id === product.id;
//               return (
//                 <s-box
//                   key={product.id}
//                   padding="base"
//                   borderWidth="base"
//                   borderRadius="base"
//                   background={isSelected ? "highlight" : "default"}
//                   onClick={() => handleSelectProduct(product)}
//                   style={{ cursor: "pointer" }}
//                 >
//                   <s-stack direction="inline" gap="base" align="center">
//                     {productImage(product) && (
//                       <img
//                         src={productImage(product)}
//                         alt={product.title}
//                         style={{
//                           width: "40px",
//                           height: "40px",
//                           objectFit: "cover",
//                           borderRadius: "6px",
//                         }}
//                       />
//                     )}
//                     <s-stack direction="block" gap="none">
//                       <s-text fontWeight="semibold">{product.title}</s-text>
//                       <s-text tone="subdued" size="small">
//                         {product.id.replace("gid://shopify/Product/", "ID: ")}
//                       </s-text>
//                     </s-stack>
//                     {isSelected && (
//                       <s-badge tone="success" style={{ marginLeft: "auto" }}>
//                         Selected
//                       </s-badge>
//                     )}
//                   </s-stack>
//                 </s-box>
//               );
//             })}
//           </s-stack>
//         )}

//         {products.length === 0 && (
//           <s-box padding="base" style={{ marginTop: "12px" }}>
//             <s-text tone="subdued">
//               Search for products above to get started.
//             </s-text>
//           </s-box>
//         )}
//       </s-section>

//       {/* ── Discount Tiers ── */}
//       <s-section
//         heading={
//           selectedProduct
//             ? `Discount Tiers — ${selectedProduct.title}`
//             : "Discount Tiers"
//         }
//       >
//         {!selectedProduct && (
//           <s-banner tone="info">
//             Select a product above to configure its volume discount tiers.
//           </s-banner>
//         )}

//         {selectedProduct && (
//           <s-stack direction="block" gap="base">
//             {tiers.length === 0 && (
//               <s-text tone="subdued">
//                 No tiers yet. Click "Add Tier" to create your first discount rule.
//               </s-text>
//             )}

//             {/* Tier rows */}
//             {tiers.map((tier, index) => (
//               <s-box
//                 key={tier.id}
//                 padding="base"
//                 borderWidth="base"
//                 borderRadius="base"
//                 background="subdued"
//               >
//                 <s-stack direction="inline" gap="base" align="end">
//                   {/* Tier number */}
//                   <s-stack direction="block" gap="none">
//                     <s-text size="small" tone="subdued">Tier</s-text>
//                     <s-text fontWeight="bold">#{index + 1}</s-text>
//                   </s-stack>

//                   {/* Min Quantity */}
//                   <s-text-field
//                     label="Min quantity"
//                     type="number"
//                     min="1"
//                     placeholder="e.g. 10"
//                     value={tier.minQty}
//                     onInput={(e) => updateTier(tier.id, "minQty", e.target.value)}
//                     style={{ width: "120px" }}
//                   />

//                   {/* Discount % */}
//                   <s-text-field
//                     label="Discount %"
//                     type="number"
//                     min="0"
//                     max="100"
//                     step="0.5"
//                     placeholder="e.g. 15"
//                     value={tier.discount}
//                     onInput={(e) => updateTier(tier.id, "discount", e.target.value)}
//                     style={{ width: "120px" }}
//                   />

//                   {/* Label */}
//                   <s-text-field
//                     label="Label (optional)"
//                     placeholder="e.g. Bulk deal"
//                     value={tier.label}
//                     onInput={(e) => updateTier(tier.id, "label", e.target.value)}
//                     style={{ width: "160px" }}
//                   />

//                   {/* Remove */}
//                   <s-button
//                     tone="critical"
//                     variant="plain"
//                     onClick={() => removeTier(tier.id)}
//                     style={{ marginBottom: "2px" }}
//                   >
//                     Remove
//                   </s-button>
//                 </s-stack>

//                 {/* Helper text */}
//                 {tier.minQty && tier.discount && (
//                   <s-text tone="subdued" size="small" style={{ marginTop: "6px" }}>
//                     → Buy {tier.minQty}+ units and get {tier.discount}% off
//                     {tier.label ? ` (${tier.label})` : ""}
//                   </s-text>
//                 )}
//               </s-box>
//             ))}

//             {/* Add tier button */}
//             <s-button variant="secondary" onClick={addTier}>
//               + Add Tier
//             </s-button>
//           </s-stack>
//         )}
//       </s-section>

//       {/* ── Save Button ── */}
//       {selectedProduct && (
//         <s-section>
//           <s-stack direction="inline" gap="base">
//             <s-button
//               variant="primary"
//               onClick={handleSave}
//               disabled={!canSave}
//               {...(isSaving ? { loading: true } : {})}
//             >
//               Save to Metafield
//             </s-button>
//             <s-button
//               variant="secondary"
//               onClick={() => {
//                 setSelectedProduct(null);
//                 setTiers([]);
//               }}
//             >
//               Cancel
//             </s-button>
//           </s-stack>

//           {fetcher.data?.errors && (
//             <s-banner tone="critical" style={{ marginTop: "12px" }}>
//               {fetcher.data.errors.join(" ")}
//             </s-banner>
//           )}
//         </s-section>
//       )}

//       {/* ── Saved Rules Preview ── */}
//       <s-section heading="Saved Volume Discount Rules">
//         <s-box
//           padding="base"
//           borderWidth="base"
//           borderRadius="base"
//           background="subdued"
//         >
//           <pre style={{ margin: 0, fontSize: "12px", overflowX: "auto" }}>
//             {JSON.stringify(
//               allRules?.length ? allRules : { message: "No rules saved yet." },
//               null,
//               2
//             )}
//           </pre>
//         </s-box>
//       </s-section>
//     </s-page>
//   );
// }

// export const headers = (headersArgs) => {
//   return boundary.headers(headersArgs);
// };