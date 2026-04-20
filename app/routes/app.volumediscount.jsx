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

  // 1. Fetch saved metafield
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

  // 2. Fetch full product details for each saved rule (to hydrate the list on load)
  let savedProducts = [];
  if (Array.isArray(savedRules) && savedRules.length > 0) {
    const productIds = savedRules.map((r) => r.productId).filter(Boolean);
    if (productIds.length > 0) {
      // Use aliases to fetch multiple products in one query
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
    const raw = formData.get("query");
    const searchTerm = typeof raw === "string" ? raw.trim() : "";

    // Empty → browse all (omit variable); non-empty → filter by title
    const variables =
      searchTerm.length > 0 ? { query: `title:${searchTerm}` } : {};

    const response = await admin.graphql(
      `#graphql
      query SearchProducts($query: String) {
        products(first: 10, query: $query) {
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
            }
          }
        }
      }`,
      { variables }
    );

    const json = await response.json();
    if (json.errors) {
      console.error("Shopify GraphQL errors:", JSON.stringify(json.errors));
    }

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
      query GetShopId { shop { id } }`
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

// ─── Portal Dropdown ──────────────────────────────────────────────────────────
// Renders the dropdown at document.body level so it escapes s-section stacking context

function PortalDropdown({ anchorRef, portalRef, children }) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    function updateRect() {
      if (anchorRef.current) {
        setRect(anchorRef.current.getBoundingClientRect());
      }
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

// ─── Tier Modal ───────────────────────────────────────────────────────────────

function TierModal({ product, existingTiers, onClose, onSave, isSaving }) {
  const [tiers, setTiers] = useState(
    existingTiers?.length
      ? existingTiers.map((t, i) => ({ ...t, _id: i + 1 }))
      : []
  );
  const [counter, setCounter] = useState(existingTiers?.length || 0);

  function addTier() {
    const newId = counter + 1;
    setCounter(newId);
    setTiers((prev) => [...prev, { _id: newId, minQty: "", discount: "", label: "" }]);
  }

  function removeTier(id) {
    setTiers((prev) => prev.filter((t) => t._id !== id));
  }

  function updateTier(id, field, value) {
    setTiers((prev) => prev.map((t) => (t._id === id ? { ...t, [field]: value } : t)));
  }

  function handleSave() {
    const validTiers = tiers
      .filter((t) => t.minQty !== "" && t.discount !== "")
      .map(({ _id, ...t }) => ({
        minQty: Number(t.minQty),
        discount: Number(t.discount),
        label: t.label || "",
      }))
      .sort((a, b) => a.minQty - b.minQty);
    if (!validTiers.length) return;
    onSave(product, validTiers);
  }

  const canSave = tiers.length > 0 && tiers.every((t) => t.minQty !== "" && t.discount !== "");
  const imgUrl = getProductImage(product);
  const price = getProductPrice(product);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000 }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#fff",
          borderRadius: "12px",
          width: "min(640px, 95vw)",
          maxHeight: "85vh",
          overflowY: "auto",
          zIndex: 10001,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "20px 24px",
            borderBottom: "1px solid #e1e3e5",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
            borderRadius: "12px 12px 0 0",
          }}
        >
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={product.title}
              style={{
                width: "48px", height: "48px", objectFit: "cover",
                borderRadius: "8px", border: "1px solid #e1e3e5", flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: "48px", height: "48px", borderRadius: "8px",
                background: "#f1f2f3", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="#8c9196">
                <path d="M2 3a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm0 6a1 1 0 011-1h14a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V9z" />
              </svg>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {product.title}
            </div>
            {price && (
              <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "2px" }}>
                Starting at {price}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "6px", borderRadius: "6px", color: "#6d7175", display: "flex", alignItems: "center" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#202223" }}>Discount Tiers</div>
              <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px" }}>
                Customers buying above the minimum quantity will get the discount
              </div>
            </div>
            <button
              onClick={addTier}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 14px", background: "#5c6ac4", color: "#fff",
                border: "none", borderRadius: "8px", fontSize: "13px",
                fontWeight: 500, cursor: "pointer",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 1a1 1 0 011 1v4h4a1 1 0 110 2H8v4a1 1 0 11-2 0V8H2a1 1 0 110-2h4V2a1 1 0 011-1z" />
              </svg>
              Add Tier
            </button>
          </div>

          {tiers.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#8c9196", background: "#f6f6f7", borderRadius: "8px", border: "1px dashed #c9cccf", fontSize: "13px" }}>
              No tiers yet. Click "Add Tier" to create your first discount rule.
            </div>
          )}

          {tiers.length > 0 && (
            <div style={{ background: "#f6f6f7", borderRadius: "8px", overflow: "hidden", border: "1px solid #e1e3e5" }}>
              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 1fr 1.4fr 36px", gap: "8px", padding: "10px 14px", background: "#f1f2f3", borderBottom: "1px solid #e1e3e5" }}>
                {["#", "Min Qty", "Discount %", "Label (optional)", ""].map((h, i) => (
                  <div key={i} style={{ fontSize: "11px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {h}
                  </div>
                ))}
              </div>

              {tiers.map((tier, index) => (
                <div
                  key={tier._id}
                  style={{
                    display: "grid", gridTemplateColumns: "32px 1fr 1fr 1.4fr 36px",
                    gap: "8px", padding: "10px 14px", alignItems: "center",
                    borderBottom: index < tiers.length - 1 ? "1px solid #e1e3e5" : "none",
                    background: "#fff",
                  }}
                >
                  <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "#5c6ac4", color: "#fff", fontSize: "11px", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {index + 1}
                  </div>

                  <input
                    type="number" min="1" placeholder="e.g. 10"
                    value={tier.minQty}
                    onChange={(e) => updateTier(tier._id, "minQty", e.target.value)}
                    style={{ border: "1px solid #c9cccf", borderRadius: "6px", padding: "6px 10px", fontSize: "13px", width: "100%", outline: "none", boxSizing: "border-box" }}
                    onFocus={(e) => (e.target.style.borderColor = "#5c6ac4")}
                    onBlur={(e) => (e.target.style.borderColor = "#c9cccf")}
                  />

                  <div style={{ position: "relative" }}>
                    <input
                      type="number" min="0" max="100" step="0.5" placeholder="e.g. 15"
                      value={tier.discount}
                      onChange={(e) => updateTier(tier._id, "discount", e.target.value)}
                      style={{ border: "1px solid #c9cccf", borderRadius: "6px", padding: "6px 26px 6px 10px", fontSize: "13px", width: "100%", outline: "none", boxSizing: "border-box" }}
                      onFocus={(e) => (e.target.style.borderColor = "#5c6ac4")}
                      onBlur={(e) => (e.target.style.borderColor = "#c9cccf")}
                    />
                    <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", fontSize: "12px", color: "#6d7175", pointerEvents: "none" }}>%</span>
                  </div>

                  <input
                    type="text" placeholder="e.g. Bulk deal"
                    value={tier.label}
                    onChange={(e) => updateTier(tier._id, "label", e.target.value)}
                    style={{ border: "1px solid #c9cccf", borderRadius: "6px", padding: "6px 10px", fontSize: "13px", width: "100%", outline: "none", boxSizing: "border-box" }}
                    onFocus={(e) => (e.target.style.borderColor = "#5c6ac4")}
                    onBlur={(e) => (e.target.style.borderColor = "#c9cccf")}
                  />

                  <button
                    onClick={() => removeTier(tier._id)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", color: "#6d7175", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#fff4f4"; e.currentTarget.style.color = "#d82c0d"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#6d7175"; }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M6 2a1 1 0 00-1 1v.5H2.5a.5.5 0 000 1H3v8a1 1 0 001 1h8a1 1 0 001-1v-8h.5a.5.5 0 000-1H11V3a1 1 0 00-1-1H6zm0 1h4v.5H6V3zm-2 2h8v8H4V5zm2 2a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4A.5.5 0 006 7zm2 0a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4A.5.5 0 008 7zm2 0a.5.5 0 00-.5.5v4a.5.5 0 001 0v-4A.5.5 0 0010 7z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Preview hints */}
          {tiers.some((t) => t.minQty && t.discount) && (
            <div style={{ marginTop: "14px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#6d7175", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Preview
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {tiers
                  .filter((t) => t.minQty && t.discount)
                  .sort((a, b) => Number(a.minQty) - Number(b.minQty))
                  .map((t, i) => (
                    <div key={i} style={{ fontSize: "12px", color: "#202223", background: "#f0f4ff", border: "1px solid #c4cff5", borderRadius: "6px", padding: "5px 10px" }}>
                      Buy <strong>{t.minQty}+</strong> units → get <strong>{t.discount}% off</strong>
                      {t.label ? ` — ${t.label}` : ""}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "16px 24px", borderTop: "1px solid #e1e3e5", background: "#f6f6f7", borderRadius: "0 0 12px 12px", position: "sticky", bottom: 0 }}>
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

  // Initialize addedProducts from loaderData.savedProducts on first load
  const [addedProducts, setAddedProducts] = useState(loaderData?.savedProducts || []);
  const [modalProduct, setModalProduct] = useState(null);
  const [allRules, setAllRules] = useState(loaderData?.savedRules || []);

  const searchBarRef = useRef(null);
  const dropdownPortalRef = useRef(null);
  const searchDebounceRef = useRef(null);

  const isSearching =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("actionType") === "SEARCH_PRODUCTS";

  const isSaving =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("actionType") === "SAVE_VOLUME_RULES";

  // ── Handle fetcher responses ──
  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.actionType === "SEARCH_PRODUCTS") {
      setSuggestions(fetcher.data.products || []);
      setShowSuggestions(true);
    }

    if (fetcher.data.actionType === "SAVE_VOLUME_RULES") {
      if (fetcher.data.success) {
        shopify.toast.show("Volume discount rules saved!");
        const newRules = fetcher.data.savedRules || allRules;
        setAllRules(newRules);
        setModalProduct(null);

        // Re-sync addedProducts: add any products from newRules that aren't listed yet
        // (in case a product was added via another session)
        setAddedProducts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          // Keep current list intact — tiers badge will update via allRules
          return prev;
        });
      }
      if (fetcher.data.errors?.length) {
        shopify.toast.show(fetcher.data.errors.join(", "), { isError: true });
      }
    }
  }, [fetcher.data]);

  // ── Close dropdown on outside click ──
  // Use mousedown but skip if click is inside the portal dropdown itself
  useEffect(() => {
    function handleClickOutside(e) {
      const inSearchBar = searchBarRef.current && searchBarRef.current.contains(e.target);
      const inPortal = dropdownPortalRef.current && dropdownPortalRef.current.contains(e.target);
      if (!inSearchBar && !inPortal) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ── Debounced search on type ──
  function handleSearchInput(value) {
    setSearchQuery(value);
    clearTimeout(searchDebounceRef.current);
    if (value.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      fetcher.submit(
        { actionType: "SEARCH_PRODUCTS", query: value },
        { method: "post" }
      );
    }, 350);
  }

  // ── Browse button ──
  function handleBrowse() {
    fetcher.submit({ actionType: "SEARCH_PRODUCTS", query: "" }, { method: "post" });
    setShowSuggestions(true);
  }

  // ── Select product from suggestions ──
  function handleSelectSuggestion(product) {
    setShowSuggestions(false);
    setSearchQuery("");
    if (addedProducts.find((p) => p.id === product.id)) return;
    setAddedProducts((prev) => [...prev, product]);
  }

  // ── Remove product from list ──
  function handleRemoveProduct(productId) {
    setAddedProducts((prev) => prev.filter((p) => p.id !== productId));
  }

  // ── Save tiers ──
  function handleSaveTiers(product, tiers) {
    const updatedRules = Array.isArray(allRules)
      ? allRules.filter((r) => r.productId !== product.id)
      : [];

    updatedRules.push({
      productId: product.id,
      productTitle: product.title,
      tiers,
      updatedAt: new Date().toISOString().slice(0, 10),
    });

    fetcher.submit(
      { actionType: "SAVE_VOLUME_RULES", rules: JSON.stringify(updatedRules) },
      { method: "post" }
    );
  }

  // ── Get existing tiers for a product ──
  function getExistingTiers(productId) {
    const rule = Array.isArray(allRules)
      ? allRules.find((r) => r.productId === productId)
      : null;
    return rule?.tiers || [];
  }

  return (
    <s-page heading="Volume Discounts">

      {/* ── Search Section ── */}
      <s-section heading="Add Products">
        <div ref={searchBarRef} style={{ position: "relative" }}>

          {/* Search bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: `1px solid ${showSuggestions ? "#5c6ac4" : "#c9cccf"}`,
              borderRadius: "10px",
              padding: "0 12px",
              background: "#fff",
              boxShadow: showSuggestions ? "0 0 0 3px rgba(92,106,196,0.15)" : "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          >
            {/* Search icon */}
            <svg width="16" height="16" viewBox="0 0 20 20" fill="#8c9196" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>

            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              style={{ flex: 1, border: "none", outline: "none", fontSize: "14px", padding: "10px 0", background: "transparent", color: "#202223" }}
            />

            {/* Spinner */}
            {isSearching && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ animation: "vd-spin 0.8s linear infinite", flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" stroke="#e1e3e5" strokeWidth="3" />
                <path d="M12 2a10 10 0 0110 10" stroke="#5c6ac4" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}

            {/* Divider */}
            <div style={{ width: "1px", height: "20px", background: "#e1e3e5", margin: "0 4px", flexShrink: 0 }} />

            {/* Browse button */}
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

          {/* Dropdown — rendered as portal so it escapes s-section stacking context */}
          {showSuggestions && suggestions.length > 0 && (
            <PortalDropdown anchorRef={searchBarRef} portalRef={dropdownPortalRef}>
              <div style={{ padding: "8px 14px", fontSize: "11px", fontWeight: 600, color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f1f2f3", background: "#fafafa" }}>
                {suggestions.length} product{suggestions.length !== 1 ? "s" : ""} found
              </div>

              {suggestions.map((product) => {
                const img = getProductImage(product);
                const price = getProductPrice(product);
                const alreadyAdded = addedProducts.some((p) => p.id === product.id);
                return (
                  <div
                    key={product.id}
                    onClick={() => !alreadyAdded && handleSelectSuggestion(product)}
                    style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", cursor: alreadyAdded ? "default" : "pointer", borderBottom: "1px solid #f1f2f3", background: alreadyAdded ? "#f6f6f7" : "#fff", opacity: alreadyAdded ? 0.6 : 1, transition: "background 0.1s" }}
                    onMouseEnter={(e) => { if (!alreadyAdded) e.currentTarget.style.background = "#f4f5fa"; }}
                    onMouseLeave={(e) => { if (!alreadyAdded) e.currentTarget.style.background = alreadyAdded ? "#f6f6f7" : "#fff"; }}
                  >
                    {img ? (
                      <img src={img} alt={product.title} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e1e3e5", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: "36px", height: "36px", borderRadius: "6px", background: "#f1f2f3", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 500, color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {product.title}
                      </div>
                      {price && <div style={{ fontSize: "12px", color: "#6d7175" }}>{price}</div>}
                    </div>
                    {alreadyAdded ? (
                      <span style={{ fontSize: "11px", color: "#6d7175", background: "#f1f2f3", border: "1px solid #e1e3e5", borderRadius: "20px", padding: "2px 10px" }}>
                        Added
                      </span>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="#5c6ac4">
                        <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
                      </svg>
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

      {/* ── Selected Products List ── */}
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

              return (
                <div
                  key={product.id}
                  style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 16px", background: "#fff", borderBottom: index < addedProducts.length - 1 ? "1px solid #e1e3e5" : "none" }}
                >
                  {/* Image */}
                  {img ? (
                    <img src={img} alt={product.title} style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e1e3e5", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: "48px", height: "48px", borderRadius: "8px", background: "#f1f2f3", border: "1px solid #e1e3e5", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="#c9cccf">
                        <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6l1.5 3H5.5L7 5z" />
                      </svg>
                    </div>
                  )}

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#202223", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {product.title}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
                      {price && <span style={{ fontSize: "12px", color: "#6d7175" }}>{price}</span>}
                      {hasTiers && (
                        <span style={{ fontSize: "11px", fontWeight: 500, background: "#e3f1df", color: "#108043", borderRadius: "20px", padding: "1px 8px" }}>
                          {existingTiers.length} tier{existingTiers.length !== 1 ? "s" : ""} saved
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <button
                      onClick={() => handleRemoveProduct(product.id)}
                      title="Remove product"
                      style={{ background: "none", border: "1px solid #e1e3e5", borderRadius: "7px", padding: "6px 8px", cursor: "pointer", color: "#6d7175", display: "flex", alignItems: "center" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#fff4f4"; e.currentTarget.style.borderColor = "#f9a89c"; e.currentTarget.style.color = "#d82c0d"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "#e1e3e5"; e.currentTarget.style.color = "#6d7175"; }}
                    >
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
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

      {/* ── Raw metafield preview ── */}
      {allRules?.length > 0 && (
        <s-section heading="Saved Metafield">
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <pre style={{ margin: 0, fontSize: "12px", overflowX: "auto" }}>
              {JSON.stringify(allRules, null, 2)}
            </pre>
          </s-box>
        </s-section>
      )}

      {/* ── Tier Modal (portal) ── */}
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