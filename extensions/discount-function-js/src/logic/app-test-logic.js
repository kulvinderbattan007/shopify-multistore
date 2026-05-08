// src/logic/app-test-logic.js
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
 *
 * @param {CartInput} input
 * @param {any} config Parsed cartDiscountSettings JSON
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function runAppTestLogic(input, config) {
     console.log("=== RUNNING app-test-logic (storeName: app-test-zwydcupy) ===");
  if (!input.cart.lines?.length) {
    return { operations: [] };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product
  );

  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  // Support both: old array format and new { rules: [...] } format
  /** @type {any[]} */
  const rawRules = Array.isArray(config)
    ? config
    : Array.isArray(config.rules)
      ? config.rules
      : [];

  if (!rawRules.length) {
    return { operations: [] };
  }

  const candidates = [];

  for (const line of input.cart.lines) {
    const merch = line.merchandise;

    if (!merch || merch.__typename !== "ProductVariant") continue;

    const productId = merch.product?.id;
    const variantId = merch.id;
    const quantity = line.quantity;

    if (!productId || !variantId || !quantity) continue;

    const productConfig = rawRules.find((c) => c.productId === productId);
    if (!productConfig || !Array.isArray(productConfig.tiers)) continue;

    let bestTier = null;

    for (const tier of productConfig.tiers) {
      if (tier.variantId && tier.variantId !== variantId) continue;

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