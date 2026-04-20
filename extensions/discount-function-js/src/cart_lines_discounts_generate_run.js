
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
  if (!input.cart.lines?.length) {
    return { operations: [] };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product
  );

  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  let configs = [];
  try {
    configs = JSON.parse(input.shop.customDiscountSettings?.value || "[]");
  } catch {
    return { operations: [] };
  }

  const candidates = [];

  for (const line of input.cart.lines) {
    const productId = line.merchandise?.product?.id;
    const variantId = line.merchandise?.id;
    const quantity = line.quantity;

    if (!productId || !variantId || !quantity) continue;

    const config = configs.find(c => c.productId === productId);
    if (!config || !config.tiers) continue;

    let bestTier = null;

    for (const tier of config.tiers) {
      if (tier.variantId && tier.variantId !== variantId) continue;

      if (quantity >= tier.minQty) {
        if (!bestTier || tier.minQty > bestTier.minQty) {
          bestTier = tier;
        }
      }
    }

    if (!bestTier) continue;

    // ✅ SAFE VALUE HANDLING (CRITICAL)
    let discountValue = bestTier.discount;

    if (typeof discountValue !== "number") continue;
    if (discountValue <= 0) continue;
    if (discountValue >= 100) discountValue = 100;

    candidates.push({
      message: bestTier.label || `${discountValue}% OFF`,
      targets: [
        {
          cartLine: { id: line.id }
        }
      ],
      value: {
        percentage: {
          value: discountValue
        }
      }
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
          selectionStrategy: ProductDiscountSelectionStrategy.First
        }
      }
    ]
  };
}





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