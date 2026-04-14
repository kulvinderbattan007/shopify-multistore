// // // @ts-check

// // /**
// //  * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
// //  * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
// //  */

// // /**
// //  * @type {CartTransformRunResult}
// //  */
// // const NO_CHANGES = {
// //   operations: [],
// // };

// // /**
// //  * @param {CartTransformRunInput} input
// //  * @returns {CartTransformRunResult}
// //  */
// // export function cartTransformRun(input) {
// //   return NO_CHANGES;
// // };

// // @ts-check

// /*
// A straightforward example of a function that applies a discount to cart items with quantity greater than 5.

// The function reads the cart and checks each line item's quantity. For any item with quantity
// greater than 5, it generates an update operation that reduces the price by $50.00 per unit.
// */

// /**
//  * @typedef {import("../generated/api").Input} Input
//  * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
//  * @typedef {import("../generated/api").Operation} Operation
//  */

// /**
//  * @type {CartTransformRunResult}
//  */
// const NO_CHANGES = {
//   operations: [],
// };

// /**
//  * @param {Input} input
//  * @returns {CartTransformRunResult}
//  */
// export function cartTransformRun(input) {
//   const operations = input.cart.lines.reduce(
//     /** @param {Operation[]} acc */
//     (acc, cartLine) => {
//       const updateOperation = optionallyBuildUpdateOperation(cartLine);

//       if (updateOperation) {
//         return [...acc, { lineUpdate: updateOperation }];
//       }

//       return acc;
//     },
//     []
//   );

//   return operations.length > 0 ? { operations } : NO_CHANGES;
// }

// /**
//  * @param {Input['cart']['lines'][number]} cartLine
//  */
// function optionallyBuildUpdateOperation(
//   { id: cartLineId, quantity, cost }
// ) {
//   if (quantity > 5) {
//     return {
//       cartLineId,
//       price: {
//         adjustment: {
//           fixedPricePerUnit: {
//             amount: cost.amountPerQuantity.amount - 8.00,
//           },
//         },
//       },
//     };
//   }

//   return null;
// }


// @ts-check

/**
 * @typedef {import("../generated/api").Input} Input
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 * @typedef {import("../generated/api").Operation} Operation
 */

import { new_check } from "./new_check";
import { checkou_extension } from "./checkou_extension";

/**
 * @type {CartTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * @param {Input} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {

   let config = null;

  try {
    config = JSON.parse(input.shop.customDiscountSettings?.value || "{}");
  } catch (e) {
    config = null;
  }

  const operations = input.cart.lines.reduce(
    /** @param {Operation[]} acc */
    (acc, cartLine) => {
      // Apply priority-based logic (IMPORTANT)
         // ✅ CONDITION BASED LOGIC
          let updateOperation = null;
      if (config?.shop === "checkou-extension") {
        updateOperation = new_check(cartLine);
      } else {
        updateOperation = checkou_extension(cartLine);
      }


      // const updateOperation =  new_check(cartLine) ||  checkou_extension(cartLine);
      

      if (updateOperation) {
        return [...acc, { lineUpdate: updateOperation }];
      }

      return acc;
    },
    []
  );

  return operations.length > 0 ? { operations } : NO_CHANGES;
}