import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository, SaveResult } from "../repositories/orders.js";
import { applyDiscount, parsePercent, parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  // Скидки появились в API позже: у старых заказов этих полей нет, а discountPercent бывает строкой
  discountPercent: z.union([z.number(), z.string()]).nullish(),
  amountPaid: z.union([z.number(), z.string()]).nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = SaveResult;

/**
 * Фактически оплаченная сумма. Источник истины — amountPaid; если его нет, считаем по discountPercent;
 * если нет обоих (заказ в старом формате) — сумма неизвестна (null).
 */
function paidKop(amountKop: number, amountPaid: unknown, discountPercent: unknown): number | null {
  // Процент проверяем всегда, даже когда он не нужен для расчёта: мусор в поле — признак битого заказа
  const percent = discountPercent == null ? null : parsePercent(discountPercent);
  if (amountPaid != null) {
    const paid = toKop(parseRub(amountPaid));
    if (paid > amountKop) throw new Error(`amountPaid ${JSON.stringify(amountPaid)} is greater than amount`);
    return paid;
  }
  return percent === null ? null : applyDiscount(amountKop, percent);
}

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        amountPaidKop: paidKop(amountKop, o.amountPaid, o.discountPercent),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt). Сравнение и запись атомарны — см. saveIfNewer.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.saveIfNewer(this.normalize(raw));
  }
}
