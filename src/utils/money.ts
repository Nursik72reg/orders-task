/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Строка с десятичным числом → число. Number() для этого слишком добр: "" → 0, "0x10" → 16. */
function decimalToNumber(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  return DECIMAL.test(s) ? Number(s) : Number.NaN;
}

/** Сумма из внешнего API: число или строка с десятичным числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = decimalToNumber(raw);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 *
 * Считаем по десятичной записи числа, а не умножением: 2305.47 * 100 === 230546.99999999997,
 * и Math.floor терял копейку. String(number) даёт кратчайшую запись, которая читается обратно
 * в то же число, — то есть ровно то, что прислал внешний API.
 */
export function toKop(rub: number): number {
  if (!Number.isFinite(rub) || rub < 0) throw new Error(`invalid amount: ${rub}`);
  const m = DECIMAL.exec(String(rub));
  if (!m) {
    // Экспоненциальная запись: либо меньше копейки (1e-7), либо за пределами точности (1e21)
    if (rub < 0.01) return 0;
    throw new Error(`invalid amount: ${rub}`);
  }
  const kop = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(kop)) throw new Error(`invalid amount: ${rub}`);
  return kop;
}

/** Процент скидки из внешнего API: число или строка с числом, от 0 до 100. */
export function parsePercent(raw: unknown): number {
  const value = decimalToNumber(raw);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discount percent: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Сумма после скидки, в копейках. Округление — до ближайшей копейки, ровно половина — вверх.
 * Считаем в целых числах по десятичной записи процента: 750 * (100 - 13.4) / 100 во float даёт
 * 649.4999999999999 вместо 649.5.
 */
export function applyDiscount(amountKop: number, percent: number): number {
  const m = DECIMAL.exec(String(percent));
  if (!m) return Math.round((amountKop * (100 - percent)) / 100); // экспоненциальная запись: доля процента меньше 1e-6
  const scale = 10n ** BigInt(m[2]?.length ?? 0);
  const denominator = 100n * scale;
  const numerator = BigInt(amountKop) * (denominator - BigInt(m[1] + (m[2] ?? "")));
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
