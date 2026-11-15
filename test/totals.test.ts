import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("относит заказ ко дню по смещению таймзоны на момент заказа (переход на летнее время)", async () => {
    // Europe/Berlin: до 29.03.2026 — UTC+1, после — UTC+2.
    // Заказы стоят по обе стороны перехода: с любым одним смещением на весь период один из них уедет в чужой день.
    ctx.api.customers.set("c_7", "Europe/Berlin");
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 100, createdAt: "2026-03-27T22:30:00Z" })); // 23:30 27-го
    await postWebhook(ctx.app, apiOrder({ customerId: "c_7", amount: 200, createdAt: "2026-03-30T22:30:00Z" })); // 00:30 31-го

    const res = await dailyTotals(ctx.app, "c_7", "2026-03-27", "2026-03-31");
    expect(res.json().map((d: { date: string; total: number }) => [d.date, d.total])).toEqual([
      ["2026-03-27", 100],
      ["2026-03-28", 0],
      ["2026-03-29", 0],
      ["2026-03-30", 0],
      ["2026-03-31", 200],
    ]);
  });

  it("осенний переход в таймзоне к западу от UTC", async () => {
    // America/New_York: до 01.11.2026 — UTC-4, после — UTC-5
    ctx.api.customers.set("c_ny", "America/New_York");
    await postWebhook(ctx.app, apiOrder({ customerId: "c_ny", amount: 100, createdAt: "2026-10-31T03:30:00Z" })); // 23:30 30-го
    await postWebhook(ctx.app, apiOrder({ customerId: "c_ny", amount: 200, createdAt: "2026-11-02T04:30:00Z" })); // 23:30 1-го

    const res = await dailyTotals(ctx.app, "c_ny", "2026-10-30", "2026-11-02");
    expect(res.json().map((d: { date: string; total: number }) => [d.date, d.total])).toEqual([
      ["2026-10-30", 100],
      ["2026-10-31", 0],
      ["2026-11-01", 200],
      ["2026-11-02", 0],
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 }]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([{ date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 }]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });

  describe("скидки", () => {
    const day = (res: { json(): unknown }) => (res.json() as unknown[])[0];
    const totalsFor10th = async () => day(await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10"));

    it("отдаёт gross, discount и net; total равен gross", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5 }));
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 2500, gross: 2500, discount: 412.5, net: 2087.5 });
    });

    it("суммирует оплаченное с точностью до копейки", async () => {
      // 2305.47 и 1192.6 не представимы точно в двоичном виде
      await postWebhook(ctx.app, apiOrder({ amount: 3441, discountPercent: 33, amountPaid: 2305.47 }));
      await postWebhook(ctx.app, apiOrder({ amount: 1780, discountPercent: 33, amountPaid: 1192.6 }));
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 5221, gross: 5221, discount: 1722.93, net: 3498.07 });
    });

    it("заказ без полей скидки (старый формат) считается оплаченным полностью", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: 700 }));
      await postWebhook(ctx.app, apiOrder({ amount: 300, discountPercent: 10, amountPaid: 270 }));
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 1000, gross: 1000, discount: 30, net: 970 });
    });

    it("принимает скидку и оплаченную сумму строками", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: "6090.00", discountPercent: "7", amountPaid: "5663.70" }));
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 6090, gross: 6090, discount: 426.3, net: 5663.7 });
    });

    it("без amountPaid считает оплаченное по discountPercent", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: "16.5" }));
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 2500, gross: 2500, discount: 412.5, net: 2087.5 });
    });

    it("новая версия заказа меняет скидку", async () => {
      const o = apiOrder({ amount: 1000, discountPercent: 0, amountPaid: 1000 });
      await postWebhook(ctx.app, o);
      await postWebhook(ctx.app, { ...o, discountPercent: 10, amountPaid: 900, updatedAt: "2026-02-10T13:00:00Z" });
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 1000, gross: 1000, discount: 100, net: 900 });
    });

    it("новая версия без полей скидки сбрасывает оплаченную сумму", async () => {
      // Побеждает самая свежая версия целиком: если скидки в ней нет, прежнюю не достраиваем
      const o = apiOrder({ amount: 1000 });
      await postWebhook(ctx.app, { ...o, discountPercent: 10, amountPaid: 900 });
      await postWebhook(ctx.app, { ...o, updatedAt: "2026-02-10T13:00:00Z" });
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 });
    });

    it("refunded и pending со скидкой не учитываются", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: 500, discountPercent: 10, amountPaid: 450 }));
      await postWebhook(ctx.app, apiOrder({ amount: 900, discountPercent: 10, amountPaid: 810, status: "refunded" }));
      await postWebhook(ctx.app, apiOrder({ amount: 700, discountPercent: 10, amountPaid: 630, status: "pending" }));
      expect(await totalsFor10th()).toEqual({ date: "2026-02-10", total: 500, gross: 500, discount: 50, net: 450 });
    });
  });
});
