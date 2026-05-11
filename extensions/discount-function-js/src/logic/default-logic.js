// // src/logic/default-logic.js
// // @ts-check
// import {
//   DiscountClass,
// } from "../../generated/api";

// /**
//  * @typedef {import("../../generated/api").Input} CartInput
//  * @typedef {import("../../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
//  */

// /**
//  * Fallback logic for other stores
//  *
//  * @param {CartInput} input
//  * @param {any} config Parsed cartDiscountSettings JSON
//  * @returns {CartLinesDiscountsGenerateRunResult}
//  */
// export function runDefaultLogic(input, config) {
//   // Simple default: no discount
//   return { operations: [] };
// } 












// src/logic/app-test-volume-logic.js
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
 * Logic for storeName === "app-test-zwydcupy"
 * Uses shop.volumeDiscountSettings metafield for per-product / per-variant
 * quantity-based volume discounts.
 *
 * @param {CartInput} input
 * @param {any} config Parsed volumeDiscountSettings JSON
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
// export function runAppTestVolumeLogic(input, config) {
export function runDefaultLogic(input, config) {

  
  console.log("=== RUNNING app-test-volume-logic (storeName: app-test-zwydcupy) ===");

  // No lines – no discounts
  if (!input.cart.lines?.length) {
    return { operations: [] };
  }

  // Only apply if PRODUCT discount class is active
  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  // For volumeDiscountSettings we expect an *array* of product configs
  // like: [{ productId, productTitle, tiers: [...], updatedAt }]
  /** @type {any[]} */
  const rawRules = Array.isArray(config) ? config : [];

  if (!rawRules.length) {
    return { operations: [] };
  }

  /** @type {CartLinesDiscountsGenerateRunResult["operations"][number]["productDiscountsAdd"]["candidates"]} */
  const candidates = [];

  for (const line of input.cart.lines) {
    const merch = line.merchandise;

    // Only handle ProductVariant lines
    if (!merch || merch.__typename !== "ProductVariant") continue;

    const productId = merch.product?.id;
    const variantId = merch.id;
    const quantity = line.quantity;

    if (!productId || !variantId || !quantity) continue;

    // Find config for this product
    const productConfig = rawRules.find(
      (c) => c && c.productId === productId,
    );
    if (!productConfig || !Array.isArray(productConfig.tiers)) continue;

    let bestTier = null;

    // Choose the tier with the highest minQty that is <= quantity
    for (const tier of productConfig.tiers) {
      if (!tier) continue;

      // If a tier specifies a variantId, it must match this line's variant
      if (tier.variantId && tier.variantId !== variantId) continue;

      if (typeof tier.minQty !== "number") continue;
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

  if (!candidates.length) {
    return { operations: [] };
  }

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