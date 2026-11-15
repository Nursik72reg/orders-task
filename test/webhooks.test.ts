import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("параллельные события по одному заказу: остаётся самая свежая версия", async () => {
    // Внешняя система шлёт вебхуки параллельно, с повторами и не по порядку
    const orders = Array.from({ length: 20 }, () => apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" }));
    await Promise.all(
      orders.flatMap((o) => {
        const refunded = { ...o, status: "refunded", updatedAt: "2026-02-12T12:00:00Z" };
        return [postWebhook(ctx.app, refunded), postWebhook(ctx.app, o), postWebhook(ctx.app, refunded), postWebhook(ctx.app, o)];
      }),
    );
    const { rows } = await ctx.db.query(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`);
    expect(rows).toEqual([{ status: "refunded", n: 20 }]);
  });

  it("параллельные повторы одного события: создаётся один раз", async () => {
    const o = apiOrder();
    const results = await Promise.all(Array.from({ length: 10 }, () => postWebhook(ctx.app, o)));
    const counts = results.map((r) => r.json().result).sort();
    expect(counts).toEqual(["created", ...Array(9).fill("stale")]);
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });
});
