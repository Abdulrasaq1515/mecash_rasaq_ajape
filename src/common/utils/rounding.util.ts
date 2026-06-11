import { Decimal } from '@prisma/client/runtime/library';

/** Banker's rounding (ROUND_HALF_EVEN) to 2 decimal places — standard in financial systems */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}
