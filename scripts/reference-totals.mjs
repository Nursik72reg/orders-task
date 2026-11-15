// Независимый эталон для daily-totals: считает суммы прямо из данных внешнего API,
// не используя код сервиса (ни src/, ни БД). Нужен, чтобы сверить result.json.
//
//   node scripts/reference-totals.mjs [customerId] [from] [to]
//
// 1. Забирает все заказы из ORDERS_API_URL и таймзону клиента.
// 2. Поднимает приёмник вебхуков на WEBHOOK_PORT (по умолчанию 3999) и ждёт их:
//      docker compose run --rm orders-api webhooks --target http://host.docker.internal:3999/webhooks/order
//    Приём заканчивается через 3 секунды тишины после первого вебхука.
// 3. Берёт последнюю версию каждого заказа по updatedAt, считает суммы и сравнивает с result.json.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";

const [customerId = "c_7", from = "2026-03-27", to = "2026-03-31"] = process.argv.slice(2);
const API = process.env.ORDERS_API_URL ?? "http://localhost:4000";
const PORT = Number(process.env.WEBHOOK_PORT ?? 3999);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET с повторами: API отвечает 429 или 200 { error: "rate_limited" } при превышении лимита. */
async function get(path) {
  for (;;) {
    await sleep(300);
    const res = await fetch(new URL(path, API));
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body && !("error" in body)) return body;
    if (res.status !== 200 && res.status !== 429 && res.status < 500) throw new Error(`${path}: HTTP ${res.status}`);
    await sleep(1000);
  }
}

async function fetchAllOrders() {
  const orders = [];
  for (let cursor = null; ; ) {
    const page = await get(`/orders?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    orders.push(...page.items);
    if (!page.nextCursor || page.items.length === 0) return orders;
    cursor = page.nextCursor;
  }
}

function receiveWebhooks() {
  return new Promise((resolve) => {
    const received = [];
    let idle;
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        received.push(JSON.parse(raw));
        res.writeHead(200, { "content-type": "application/json" }).end('{"result":"ok"}');
        clearTimeout(idle);
        idle = setTimeout(() => server.close(() => resolve(received)), 3000);
      });
    });
    server.listen(PORT, "0.0.0.0", () => console.error(`жду вебхуки на порту ${PORT}…`));
  });
}

// Время без указателя зоны — UTC
const time = (s) => Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
// Рубли → копейки по десятичной записи, без умножения float
const kop = (v) => {
  const [int, frac = ""] = String(v).trim().split(".");
  return Number(int) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
};

const { timezone } = await get(`/customers/${customerId}`);
const synced = await fetchAllOrders();
console.error(`заказов из /orders: ${synced.length}, таймзона ${customerId}: ${timezone}`);
const webhooks = await receiveWebhooks();
console.error(`вебхуков: ${webhooks.length}`);

const latest = new Map();
for (const o of [...synced, ...webhooks]) {
  const current = latest.get(o.id);
  if (!current || time(o.updatedAt) > time(current.updatedAt)) latest.set(o.id, o);
}

const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
const days = new Map();
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
  days.set(new Date(t).toISOString().slice(0, 10), { gross: 0, net: 0 });
}
for (const o of latest.values()) {
  if (o.customerId !== customerId || o.status !== "paid") continue;
  const day = days.get(localDate.format(new Date(time(o.createdAt))));
  if (!day) continue;
  day.gross += kop(o.amount);
  day.net += kop(o.amountPaid ?? o.amount);
}

const expected = [...days].map(([date, { gross, net }]) => ({
  date,
  total: gross / 100,
  gross: gross / 100,
  discount: (gross - net) / 100,
  net: net / 100,
}));
console.log(JSON.stringify(expected));

const resultPath = new URL("../result.json", import.meta.url);
if (existsSync(resultPath)) {
  const same = JSON.stringify(JSON.parse(readFileSync(resultPath, "utf8"))) === JSON.stringify(expected);
  console.error(same ? "result.json совпадает с эталоном" : "result.json НЕ совпадает с эталоном");
  process.exitCode = same ? 0 : 1;
}
