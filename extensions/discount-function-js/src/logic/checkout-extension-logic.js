// src/logic/checkout-extension-logic.js
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
 * Logic for storeName === "checkou-extension"
 *
 * @param {CartInput} input
 * @param {any} config Parsed cartDiscountSettings JSON
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function runCheckoutExtensionLogic(input, config) {
  console.log("=== runCheckoutExtensionLogic START ===");

  if (!input.cart.lines?.length) {
    return { operations: [] };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product
  );

  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (!rules.length) {
    return { operations: [] };
  }

  const rule = rules[0];
  const triggers = rule.triggers || {};
  const allRequiredVariantIds = Array.isArray(triggers.allProductIdsRequired)
    ? triggers.allProductIdsRequired
    : [];
  const targets = Array.isArray(rule.targets) ? rule.targets : [];

  if (!allRequiredVariantIds.length || !targets.length) {
    return { operations: [] };
  }

  /** @type {Set<string>} */
  const variantsInCart = new Set();

  for (const line of input.cart.lines) {
    const merch = line.merchandise;
    if (merch?.__typename === "ProductVariant" && merch.id) {
      variantsInCart.add(merch.id);
    }
  }

  const allRequiredPresent = allRequiredVariantIds.every((requiredId) =>
    variantsInCart.has(requiredId),
  );

  if (!allRequiredPresent) {
    return { operations: [] };
  }

  const candidates = [];

  for (const line of input.cart.lines) {
    const merch = line.merchandise;
    if (!merch || merch.__typename !== "ProductVariant" || !merch.id) continue;

    const variantId = merch.id;

    const target = targets.find((t) => t.productId === variantId);
    if (!target) continue;

    if (target.discountType !== "PERCENT") {
      continue;
    }

    let discountValue = target.discountValue;
    if (typeof discountValue !== "number") continue;
    if (discountValue <= 0) continue;
    if (discountValue > 100) discountValue = 100;

    candidates.push({
      message:
        typeof target.label === "string" && target.label.length > 0
          ? target.label
          : `${discountValue}% off on combo rule ${rule.name}`,
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
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}