// src/logic/default-logic.js
// @ts-check
import {
  DiscountClass,
} from "../../generated/api";

/**
 * @typedef {import("../../generated/api").Input} CartInput
 * @typedef {import("../../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

/**
 * Fallback logic for other stores
 *
 * @param {CartInput} input
 * @param {any} config Parsed cartDiscountSettings JSON
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function runDefaultLogic(input, config) {
  // Simple default: no discount
  return { operations: [] };
} 