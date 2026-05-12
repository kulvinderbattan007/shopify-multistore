// src/logic/default-logic.js
// @ts-check

import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../../generated/api";

/**
 * @typedef {import("../../generated/api").Input} CartInput
 * @typedef {import("../../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * Volume discount logic using shop.volumeDiscountSettings.
 *
 * Expected metafield value (stringified JSON):
 * [
 *   {
 *     "productId": "gid://shopify/Product/...",
 *     "productTitle": "...",
 *     "tiers": [
 *       { "variantId": "gid://shopify/ProductVariant/...", "minQty": 1, "discount": 10, "label": "10%" },
 *       { "variantId": "gid://shopify/ProductVariant/...", "minQty": 2, "discount": 20, "label": "20%" },
 *       ...
 *     ],
 *     "updatedAt": "2026-05-12"
 *   }
 * ]
 *
 * @param {CartInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function runDefaultLogic(input) {
  // ---- 0. Basic guards ---------------------------------------------------

  // No lines -> no discounts
  if (!input?.cart?.lines?.length) {
    return { operations: [] };
  }

  // Only apply if PRODUCT discount class is active
  const hasProductDiscountClass =
    Array.isArray(input.discount?.discountClasses) &&
    input.discount.discountClasses.includes(DiscountClass.Product);

  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  // ---- 1. Parse shop.volumeDiscountSettings.value ------------------------

  const metafield = input.shop?.volumeDiscountSettings;

  if (!metafield || typeof metafield.value !== "string" || !metafield.value.trim()) {
    // No config -> no discounts
    return { operations: [] };
  }

  /** @type {any[]} */
  let rawRules = [];
  try {
    const parsed = JSON.parse(metafield.value);
    if (!Array.isArray(parsed)) {
      // We expect an array of product configs
      return { operations: [] };
    }
    rawRules = parsed;
  } catch (e) {
    // JSON.parse error – never let this crash the function
    console.log("Failed to parse shop.volumeDiscountSettings.value:", e);
    return { operations: [] };
  }

  if (!rawRules.length) {
    return { operations: [] };
  }

  /** @type {CartLinesDiscountsGenerateRunResult["operations"][number]["productDiscountsAdd"]["candidates"]} */
  const candidates = [];

  // ---- 2. Per-line volume discounts --------------------------------------

  for (const line of input.cart.lines) {
    if (!line) continue;

    const merch = line.merchandise;

    // Only handle ProductVariant lines
    if (!merch || merch.__typename !== "ProductVariant") continue;

    const productId = merch.product?.id;
    const variantId = merch.id;
    const quantity = line.quantity;

    if (!productId || !variantId || typeof quantity !== "number" || quantity <= 0) {
      continue;
    }

    // Find config for this product
    const productConfig = rawRules.find(
      (c) => c && c.productId === productId,
    );
    if (!productConfig || !Array.isArray(productConfig.tiers)) continue;

    let bestTier = null;

    // Choose the tier with the highest minQty that is <= this line's quantity
    for (const tier of productConfig.tiers) {
      if (!tier) continue;

      // If a tier specifies a variantId, it must match this line's variant
      if (tier.variantId && tier.variantId !== variantId) continue;

      if (typeof tier.minQty !== "number" || tier.minQty <= 0) continue;

      if (quantity >= tier.minQty) {
        if (!bestTier || tier.minQty > bestTier.minQty) {
          bestTier = tier;
        }
      }
    }

    if (!bestTier) continue;

    let discountValue = bestTier.discount;
    if (typeof discountValue !== "number") continue;
    if (discountValue <= 0) continue;
    if (discountValue > 100) discountValue = 100;

    candidates.push({
      message: bestTier.label || `${discountValue}% OFF`,
      targets: [
        {
          cartLine: { id: line.id },
        },
      ],
      value: {
        percentage: {
          value: discountValue,
        },
      },
    });
  }

  // No applicable tiers -> no operations
  if (!candidates.length) {
    return { operations: [] };
  }

  // ---- 3. Return discounts for all eligible lines ------------------------

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}