// src/cart_lines_discounts_generate_run.js
// @ts-check

import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

/**
 * @typedef {import("../generated/api").Input} CartInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

export function cartLinesDiscountsGenerateRun(input) {
  console.log("=== cartLinesDiscountsGenerateRun ENTRY ===");

  // ---- 0. Basic guards ---------------------------------------------------
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

  // ---- 1. Parse volumeDiscountSettings -----------------------------------
  const metafield = input.shop?.volumeDiscountSettings;

  if (!metafield || typeof metafield.value !== "string" || !metafield.value.trim()) {
    console.log("[DEBUG] No volumeDiscountSettings.value – skipping.");
    return { operations: [] };
  }

  /** @type {any[]} */
  let rawRules = [];
  try {
    const parsed = JSON.parse(metafield.value);
    if (!Array.isArray(parsed)) {
      console.log("[DEBUG] volumeDiscountSettings.value is not an array.");
      return { operations: [] };
    }
    rawRules = parsed;
  } catch (e) {
    console.log("[DEBUG] Failed to parse volumeDiscountSettings.value:", e);
    return { operations: [] };
  }

  if (!rawRules.length) {
    console.log("[DEBUG] volumeDiscountSettings array is empty.");
    return { operations: [] };
  }

  console.log(`[DEBUG] Loaded ${rawRules.length} product rule(s).`);

  /** @type {CartLinesDiscountsGenerateRunResult["operations"][number]["productDiscountsAdd"]["candidates"]} */
  const candidates = [];

  // ---- 2. Per-line volume discounts --------------------------------------
  for (const line of input.cart.lines) {
    if (!line) continue;

    const merch = line.merchandise;
    if (!merch || merch.__typename !== "ProductVariant") continue;

    const productId = merch.product?.id;
    const variantId = merch.id;
    const quantity = line.quantity;

    if (!productId || !variantId || typeof quantity !== "number" || quantity <= 0) {
      console.log(`[DEBUG] Line ${line.id} skipped – missing productId/variantId/quantity.`);
      continue;
    }

    console.log(`[DEBUG] Line ${line.id}: productId=${productId}, variantId=${variantId}, qty=${quantity}`);

    // Find the product config in our rules
    const productConfig = rawRules.find((c) => c && c.productId === productId);
    if (!productConfig || !Array.isArray(productConfig.tiers)) {
      console.log(`[DEBUG] Line ${line.id}: No rule found for productId=${productId}.`);
      continue;
    }

    console.log(`[DEBUG] Line ${line.id}: Found product config with ${productConfig.tiers.length} tier(s).`);

    // Find the best matching tier:
    // - If tier has variantId, it must match this line's variant
    // - Pick the tier with the highest minQty that is still <= line quantity
    let bestTier = null;

    for (const tier of productConfig.tiers) {
      if (!tier) continue;

      // Variant-scoped tier: skip if it's for a different variant
      if (tier.variantId && tier.variantId !== variantId) {
        console.log(`[DEBUG]   Tier minQty=${tier.minQty} skipped – variantId mismatch (${tier.variantId} vs ${variantId}).`);
        continue;
      }

      if (typeof tier.minQty !== "number" || tier.minQty <= 0) {
        console.log(`[DEBUG]   Tier skipped – invalid minQty.`);
        continue;
      }

      if (quantity >= tier.minQty) {
        if (!bestTier || tier.minQty > bestTier.minQty) {
          bestTier = tier;
          console.log(`[DEBUG]   New best tier: minQty=${tier.minQty}, discount=${tier.discount}%`);
        }
      } else {
        console.log(`[DEBUG]   Tier minQty=${tier.minQty} not met (qty=${quantity}).`);
      }
    }

    if (!bestTier) {
      console.log(`[DEBUG] Line ${line.id}: No qualifying tier found.`);
      continue;
    }

    let discountValue = bestTier.discount;
    if (typeof discountValue !== "number" || discountValue <= 0) {
      console.log(`[DEBUG] Line ${line.id}: Invalid discount value – skipping.`);
      continue;
    }
    if (discountValue > 100) discountValue = 100;

    // Normalize label: ensure it includes "%" suffix
    const rawLabel = bestTier.label ?? String(discountValue);
    const label = rawLabel.toString().trim().endsWith("%")
      ? rawLabel.toString().trim()
      : `${rawLabel.toString().trim()}% OFF`;

    console.log(`[DEBUG] Line ${line.id}: Applying ${discountValue}% discount with label "${label}".`);

    candidates.push({
      message: label,
      targets: [{ cartLine: { id: line.id } }],
      value: {
        percentage: {
          value: discountValue,
        },
      },
    });
  }

  // ---- 3. Return result --------------------------------------------------
  if (!candidates.length) {
    console.log("[DEBUG] No matching tiers for any line – returning empty operations.");
    return { operations: [] };
  }

  console.log(`[DEBUG] Returning ${candidates.length} candidate(s).`);

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}