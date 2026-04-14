export function new_check(cartLine) {
  const { id, quantity, cost } = cartLine;

  if (quantity > 5) {
    return {
      cartLineId: id,
      price: {
        adjustment: {
          fixedPricePerUnit: {
            amount: cost.amountPerQuantity.amount - 5.0,
          },
        },
      },
    };
  }

  return null;
}