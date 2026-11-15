import type { OrdersRepository } from "../repositories/orders.js";
import { fromKop } from "../utils/money.js";
import { datesBetween, localDate } from "../utils/time.js";
import type { CustomersService } from "./customers.js";

/** Суммы оплаченных заказов за день, в рублях. */
export interface DailyTotal {
  date: string;
  /** То же, что gross. Оставлено для обратной совместимости. */
  total: number;
  /** Сумма до скидки. */
  gross: number;
  /** gross - net. */
  discount: number;
  /** Сколько клиенты фактически заплатили. */
  net: number;
}

const DAY = 86_400_000;

export class TotalsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly customers: CustomersService,
  ) {}

  /**
   * Суммы оплаченных заказов клиента по дням в его таймзоне, from..to включительно.
   * Дни без оплат — с нулями. Заказ относится ко дню своего создания.
   */
  async daily(customerId: string, from: string, to: string): Promise<DailyTotal[]> {
    const timezone = await this.customers.timezone(customerId);

    // Смещения таймзон в пределах ±14 ч: берём с запасом в сутки с каждой стороны
    const rows = await this.orders.paidCreatedBetween(
      customerId,
      new Date(Date.parse(`${from}T00:00:00Z`) - DAY),
      new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY),
    );

    const sums = new Map(datesBetween(from, to).map((d) => [d, { gross: 0, net: 0 }]));
    for (const o of rows) {
      // Смещение — на момент заказа, а не запроса: иначе после перехода на летнее/зимнее время
      // заказы около полуночи попадают в соседний день.
      const date = localDate(o.createdAt, timezone);
      const day = sums.get(date);
      if (!day) continue;
      day.gross += o.amountKop;
      // Оплаченная сумма неизвестна только у заказов без полей скидки — считаем их оплаченными полностью
      day.net += o.amountPaidKop ?? o.amountKop;
    }
    // Складываем и вычитаем в копейках, в рубли переводим только готовый результат
    return [...sums].map(([date, { gross, net }]) => ({
      date,
      total: fromKop(gross),
      gross: fromKop(gross),
      discount: fromKop(gross - net),
      net: fromKop(net),
    }));
  }
}
