// @ts-check
import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

/**
 * @typedef {import("../generated/api").Input} CartInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * @param {CartInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  console.log("=== cartLinesDiscountsGenerateRun START ===");

  if (!input.cart.lines?.length) {
    console.log("[DEBUG] No cart lines. Returning empty operations.");
    return { operations: [] };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product
  );
  console.log("[DEBUG] discountClasses:", input.discount.discountClasses);
  console.log("[DEBUG] hasProductDiscountClass:", hasProductDiscountClass);

  if (!hasProductDiscountClass) {
    console.log("[DEBUG] Product discount class not enabled. Returning empty.");
    return { operations: [] };
  }

  // 1. Parse configuration from shop.customDiscountSettings.value
  const settings = input.shop.customDiscountSettings;
  console.log("[DEBUG] shop.customDiscountSettings:", settings);

  if (!settings || !settings.value) {
    console.log("[DEBUG] No customDiscountSettings.value. Returning empty.");
    return { operations: [] };
  }

  let rawConfig;
  try {
    rawConfig = JSON.parse(settings.value);
  } catch (e) {
    console.log("[DEBUG] Error parsing customDiscountSettings.value:", e);
    return { operations: [] };
  }

  console.log("[DEBUG] Parsed config:", JSON.stringify(rawConfig, null, 2));

  const rules = Array.isArray(rawConfig.rules) ? rawConfig.rules : [];
  if (!rules.length) {
    console.log("[DEBUG] No rules in config. Returning empty.");
    return { operations: [] };
  }

  const rule = rules[0];
  console.log("[DEBUG] Using rule:", rule.id, rule.name);

  const triggers = rule.triggers || {};
  const allRequiredVariantIds = Array.isArray(triggers.allProductIdsRequired)
    ? triggers.allProductIdsRequired
    : [];
  const targets = Array.isArray(rule.targets) ? rule.targets : [];

  console.log("[DEBUG] allRequiredVariantIds (from config):", allRequiredVariantIds);
  console.log("[DEBUG] targets:", JSON.stringify(targets, null, 2));

  if (!allRequiredVariantIds.length || !targets.length) {
    console.log("[DEBUG] Missing triggers or targets. Returning empty.");
    return { operations: [] };
  }

  // 2. Collect variant IDs in the cart
  /** @type {Set<string>} */
  const variantsInCart = new Set();

  for (const line of input.cart.lines) {
    const merch = line.merchandise;
    console.log("[DEBUG] Line merchandise typename:", merch?.__typename);

    if (merch?.__typename === "ProductVariant") {
      const variantId = merch.id;
      console.log("[DEBUG] Found variantId on line:", line.id, variantId);
      if (variantId) {
        variantsInCart.add(variantId);
      }
    }
  }

  console.log("[DEBUG] variantsInCart:", Array.from(variantsInCart));

  // 3. Check if all required variant IDs are present
  const allRequiredPresent = allRequiredVariantIds.every((requiredId) =>
    variantsInCart.has(requiredId)
  );
  console.log("[DEBUG] allRequiredPresent:", allRequiredPresent);

  if (!allRequiredPresent) {
    console.log(
      "[DEBUG] Not all required variants are present in cart. Returning empty."
    );
    return { operations: [] };
  }

  // 4. Rule is active → build candidates
  const candidates = [];

  for (const line of input.cart.lines) {
    const merch = line.merchandise;
    if (!merch || merch.__typename !== "ProductVariant") continue;

    const variantId = merch.id;
    console.log("[DEBUG] Checking line for target, variantId:", variantId);
    if (!variantId) continue;

    // match target by variantId (stored in productId field in JSON)
    const target = targets.find((t) => t.productId === variantId);
    console.log("[DEBUG] Matched target for this line:", target);

    if (!target) continue;

    if (target.discountType !== "PERCENT") {
      console.log(
        "[DEBUG] Target discountType is not PERCENT, skipping:",
        target.discountType
      );
      continue;
    }

    let discountValue = target.discountValue;
    console.log("[DEBUG] Raw discountValue:", discountValue);

    if (typeof discountValue !== "number") {
      console.log("[DEBUG] discountValue is not a number, skipping.");
      continue;
    }
    if (discountValue <= 0) {
      console.log("[DEBUG] discountValue <= 0, skipping.");
      continue;
    }
    if (discountValue > 100) {
      discountValue = 100;
    }

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

  console.log("[DEBUG] Built candidates:", JSON.stringify(candidates, null, 2));

  if (!candidates.length) {
    console.log("[DEBUG] No candidates. Returning empty.");
    return { operations: [] };
  }

  const operations = [
    {
      productDiscountsAdd: {
        candidates,
        selectionStrategy: ProductDiscountSelectionStrategy.All,
      },
    },
  ];

  console.log(
    "[DEBUG] Returning operations:",
    JSON.stringify(operations, null, 2)
  );
  console.log("=== cartLinesDiscountsGenerateRun END ===");

  return { operations };
}















// // @ts-check
// import {
//   DiscountClass,
//   ProductDiscountSelectionStrategy,
// } from "../generated/api";

// /**
//  * @typedef {import("../generated/api").Input} CartInput
//  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
//  */


// export function cartLinesDiscountsGenerateRun(input) {
//   if (!input.cart.lines?.length) {
//     return { operations: [] };
//   }

//   const hasProductDiscountClass = input.discount.discountClasses.includes(
//     DiscountClass.Product
//   );

//   if (!hasProductDiscountClass) {
//     return { operations: [] };
//   }

//   let configs = [];
//   try {
//     configs = JSON.parse(input.shop.customDiscountSettings?.value || "[]");
//   } catch {
//     return { operations: [] };
//   }

//   const candidates = [];

//   for (const line of input.cart.lines) {
//     const productId = line.merchandise?.product?.id;
//     const variantId = line.merchandise?.id;
//     const quantity = line.quantity;

//     if (!productId || !variantId || !quantity) continue;

//     const config = configs.find(c => c.productId === productId);
//     if (!config || !config.tiers) continue;

//     let bestTier = null;

//     for (const tier of config.tiers) {
//       if (tier.variantId && tier.variantId !== variantId) continue;

//       if (quantity >= tier.minQty) {
//         if (!bestTier || tier.minQty > bestTier.minQty) {
//           bestTier = tier;
//         }
//       }
//     }

//     if (!bestTier) continue;

//     // ✅ SAFE VALUE HANDLING (CRITICAL)
//     let discountValue = bestTier.discount;

//     if (typeof discountValue !== "number") continue;
//     if (discountValue <= 0) continue;
//     if (discountValue >= 100) discountValue = 100;

//     candidates.push({
//       message: bestTier.label || `${discountValue}% OFF`,
//       targets: [
//         {
//           cartLine: { id: line.id }
//         }
//       ],
//       value: {
//         percentage: {
//           value: discountValue
//         }
//       }
//     });
//   }

//   if (!candidates.length) {
//     return { operations: [] };
//   }

//   return {
//     operations: [
//       {
//         productDiscountsAdd: {
//           candidates,
//           selectionStrategy: ProductDiscountSelectionStrategy.First
//         }
//       }
//     ]
//   };
// }


// ########################################################################


// import {
//   DiscountClass,
//   OrderDiscountSelectionStrategy,
//   ProductDiscountSelectionStrategy,
// } from '../generated/api';


// /**
//   * @typedef {import("../generated/api").CartInput} RunInput
//   * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
//   */

// /**
//   * @param {RunInput} input
//   * @returns {CartLinesDiscountsGenerateRunResult}
//   */

// export function cartLinesDiscountsGenerateRun(input) {
//   if (!input.cart.lines.length) {
//     return {operations: []};
//   }
// console.log("inputinput", input);
//   const hasOrderDiscountClass = input.discount.discountClasses.includes(
//     DiscountClass.Order,
//   );
//   const hasProductDiscountClass = input.discount.discountClasses.includes(
//     DiscountClass.Product,
//   );

//   if (!hasOrderDiscountClass && !hasProductDiscountClass) {
//     return {operations: []};
//   }

//   const maxCartLine = input.cart.lines.reduce((maxLine, line) => {
//     if (line.cost.subtotalAmount.amount > maxLine.cost.subtotalAmount.amount) {
//       return line;
//     }
//     return maxLine;
//   }, input.cart.lines[0]);

//   const operations = [];

//   if (hasOrderDiscountClass) {
//     operations.push({
//       orderDiscountsAdd: {
//         candidates: [
//           {
//             message: '10% OFF ORDERss ytestt',
//             targets: [
//               {
//                 orderSubtotal: {
//                   excludedCartLineIds: [],
//                 },
//               },
//             ],
//             value: {
//               percentage: {
//                 value: 0,
//               },
//             },
//           },
//         ],
//         selectionStrategy: OrderDiscountSelectionStrategy.First,
//       },
//     });
//   }

//   if (hasProductDiscountClass) {
//     operations.push({
//       productDiscountsAdd: {
//         candidates: [
//           {
//             message: '20% OFF PRODUCTssss',
//             targets: [
//               {
//                 cartLine: {
//                   id: maxCartLine.id,
//                 },
//               },
//             ],
//             value: {
//               percentage: {
//                 value: 0,
//               },
//             },
//           },
//         ],
//         selectionStrategy: ProductDiscountSelectionStrategy.First,
//       },
//     });
//   }

//   return {
//     operations,
//   };
// }