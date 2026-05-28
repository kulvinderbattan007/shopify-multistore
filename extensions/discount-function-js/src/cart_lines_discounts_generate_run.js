// cart_lines_discounts_generate_run.js
// @ts-check

import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

export function cartLinesDiscountsGenerateRun(input) {
  console.log("=== cartLinesDiscountsGenerateRun ENTRY ===");

  if (!input?.cart?.lines?.length) {
    console.log("[DEBUG] No cart lines – skipping.");
    return { operations: [] };
  }

  const hasProductDiscountClass =
    Array.isArray(input.discount?.discountClasses) &&
    input.discount.discountClasses.includes(DiscountClass.Product);

  if (!hasProductDiscountClass) {
    console.log("[DEBUG] PRODUCT discount class not active – skipping.");
    return { operations: [] };
  }

  // ---- 1. Parse metafield ------------------------------------------------
  const metafield = input.shop?.volumeDiscountSettings;

  if (!metafield || typeof metafield.value !== "string" || !metafield.value.trim()) {
    console.log("[DEBUG] No volumeDiscountSettings.value – skipping.");
    return { operations: [] };
  }

  let config;
  try {
    config = JSON.parse(metafield.value);
    if (!config?.discount_tiers || !Array.isArray(config.discount_tiers)) {
      console.log("[DEBUG] discount_tiers missing or not an array.");
      return { operations: [] };
    }
  } catch (e) {
    console.log("[DEBUG] Failed to parse metafield value:", e);
    return { operations: [] };
  }

  // ---- 2. Route by discount_type in metafield ----------------------------
  const discountType = config.discount_type ?? "percentage";
  const storeDomain = config.store_domain ?? "unknown";

  console.log(`[DEBUG] store_domain=${storeDomain}, discount_type=${discountType}`);

  if (discountType === "fixed_bundle") {
    return runBundleDiscount(input, config);
  }

  return runVolumeDiscount(input, config);
}

// ============================================================
// BUNDLE LOGIC — fixed amount per product
// ============================================================
function runBundleDiscount(input, config) {
  console.log("[BUNDLE] Running bundle discount logic.");

  // Build cart map: numericId/GID → lineId
  const cartProductMap = new Map();
  for (const line of input.cart.lines) {
    if (!line) continue;
    const productId = line?.merchandise?.product?.id;
    if (!productId) continue;
    cartProductMap.set(productId, line.id);
    const numericId = productId.split("/").pop();
    if (numericId) cartProductMap.set(numericId, line.id);
  }

  console.log(`[BUNDLE] Cart products: ${[...cartProductMap.keys()].filter(k => !k.startsWith("gid")).join(", ")}`);

  // Find best tier by highest total_discount
  let bestTier = null;
  for (const tier of config.discount_tiers) {
    if (!Array.isArray(tier.required_product_ids) || !Array.isArray(tier.per_product_discounts)) {
      console.log("[BUNDLE] Skipping malformed tier.");
      continue;
    }
    const allPresent = tier.required_product_ids.every(
      (id) => cartProductMap.has(id) || cartProductMap.has(`gid://shopify/Product/${id}`)
    );
    console.log(`[BUNDLE] Tier total_discount=${tier.total_discount}, allPresent=${allPresent}`);
    if (allPresent && (!bestTier || tier.total_discount > bestTier.total_discount)) {
      bestTier = tier;
      console.log(`[BUNDLE] New best tier: total_discount=${tier.total_discount}`);
    }
  }

  if (!bestTier) {
    console.log("[BUNDLE] No qualifying tier – skipping.");
    return { operations: [] };
  }

  const candidates = [];
  for (const { product_id, discount_amount } of bestTier.per_product_discounts) {
    if (typeof discount_amount !== "number" || discount_amount <= 0) continue;

    const lineId =
      cartProductMap.get(product_id) ||
      cartProductMap.get(`gid://shopify/Product/${product_id}`);

    if (!lineId) {
      console.log(`[BUNDLE] Product ${product_id} not in cart – skipping.`);
      continue;
    }

    const label = `Bundle Save $${discount_amount % 1 === 0 ? discount_amount : discount_amount.toFixed(2)} OFF`;
    console.log(`[BUNDLE] Applying $${discount_amount} to lineId=${lineId}`);

    candidates.push({
      message: label,
      targets: [{ cartLine: { id: lineId } }],
      value: {
        fixedAmount: {
          amount: discount_amount,
          appliesToEachItem: false,
        },
      },
    });
  }

  if (!candidates.length) return { operations: [] };

  console.log(`[BUNDLE] Returning ${candidates.length} candidate(s).`);
  return {
    operations: [{
      productDiscountsAdd: {
        candidates,
        selectionStrategy: ProductDiscountSelectionStrategy.All,
      },
    }],
  };
}

// ============================================================
// DEFAULT VOLUME DISCOUNT LOGIC — percentage based
// ============================================================
function runVolumeDiscount(input, config) {
  console.log("[VOLUME] Running volume discount logic.");

  // Build cart product set
  const cartProductIds = new Set();
  const cartLineMap = new Map(); // numericId → line
  for (const line of input.cart.lines) {
    if (!line) continue;
    const productId = line?.merchandise?.product?.id;
    if (!productId) continue;
    cartProductIds.add(productId);
    const numericId = productId.split("/").pop();
    if (numericId) {
      cartProductIds.add(numericId);
      cartLineMap.set(numericId, line);
      cartLineMap.set(productId, line);
    }
  }

  console.log(`[VOLUME] Cart products: ${[...cartProductIds].filter(k => !k.startsWith("gid")).join(", ")}`);

  // Find best tier by highest discount_percentage
  let bestTier = null;
  for (const tier of config.discount_tiers) {
    if (!Array.isArray(tier.required_product_ids) || typeof tier.discount_percentage !== "number") {
      console.log("[VOLUME] Skipping malformed tier.");
      continue;
    }
    const allPresent = tier.required_product_ids.every(
      (id) => cartProductIds.has(id) || cartProductIds.has(`gid://shopify/Product/${id}`)
    );
    console.log(`[VOLUME] Tier qty=${tier.quantity}, discount=${tier.discount_percentage}%, allPresent=${allPresent}`);
    if (allPresent && (!bestTier || tier.discount_percentage > bestTier.discount_percentage)) {
      bestTier = tier;
      console.log(`[VOLUME] New best tier: discount_percentage=${tier.discount_percentage}%`);
    }
  }

  if (!bestTier) {
    console.log("[VOLUME] No qualifying tier – skipping.");
    return { operations: [] };
  }

  const label = `${bestTier.discount_percentage}% OFF`;
  const candidates = [];

  for (const line of input.cart.lines) {
    if (!line) continue;
    const productId = line?.merchandise?.product?.id;
    if (!productId) continue;
    const numericId = productId.split("/").pop();

    const isPartOfTier = bestTier.required_product_ids.some(
      (id) => id === productId || id === numericId
    );
    if (!isPartOfTier) continue;

    console.log(`[VOLUME] Line ${line.id}: applying ${bestTier.discount_percentage}%`);
    candidates.push({
      message: label,
      targets: [{ cartLine: { id: line.id } }],
      value: { percentage: { value: bestTier.discount_percentage } },
    });
  }

  if (!candidates.length) return { operations: [] };

  console.log(`[VOLUME] Returning ${candidates.length} candidate(s).`);
  return {
    operations: [{
      productDiscountsAdd: {
        candidates,
        selectionStrategy: ProductDiscountSelectionStrategy.All,
      },
    }],
  };
}