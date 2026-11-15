/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

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
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid discount percent: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Сумма после скидки, в копейках. Округление — до ближайшей копейки. */
export function applyDiscount(amountKop: number, percent: number): number {
  return Math.round((amountKop * (100 - percent)) / 100);
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
