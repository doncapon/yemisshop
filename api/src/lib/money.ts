/** Convert major currency (e.g., 12.34) to minor units (e.g., 1234). */
export const toMinor = (major: number): number => Math.round(major * 100);

/** Convert minor units (e.g., 1234) to major currency string with 2dp (e.g., "12.34"). */
export const toMajor = (minor: number): string => (minor / 100).toFixed(2);

/** Integer-safe percentage of a minor-unit amount (e.g., 1234 @ 30% -> 370). */
export function pctOf(amountMinor: number, pctInt: number): number {
  return Math.floor((amountMinor * pctInt) / 100);
}
