// All money is handled internally as integer satang (1 THB = 100 satang)
// to avoid floating-point drift. Convert only at the input/output boundary.

export function toSatang(thb) {
  return Math.round(thb * 100);
}

export function toBaht(satang) {
  return satang / 100;
}

// Percentage of an amount, rounded half-up to the nearest satang.
export function percentOf(satang, percent) {
  return Math.round((satang * percent) / 100);
}

// "1,040" for whole amounts, "246.91" otherwise.
export function formatAmount(satang) {
  const digits = satang % 100 === 0 ? 0 : 2;
  return toBaht(satang).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
