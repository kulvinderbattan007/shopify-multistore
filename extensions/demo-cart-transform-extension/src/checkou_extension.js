/**
 * @param {import("../generated/api").Input['cart']['lines'][number]} cartLine
 */
export function checkou_extension(cartLine) {
  const { id, quantity, cost } = cartLine;

  if (quantity > 5) {
    return {
      cartLineId: id,
      price: {
        adjustment: {
          fixedPricePerUnit: {
            amount: cost.amountPerQuantity.amount - 8.0,
          },
        },
      },
    };
  }

  return null;
}