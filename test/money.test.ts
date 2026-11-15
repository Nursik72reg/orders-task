import { describe, expect, it } from "vitest";
import { applyDiscount, fromKop, parsePercent, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });

  it("отклоняет пустую строку и не десятичную запись", () => {
    // Number("") === 0 и Number("0x10") === 16 — такие строки не должны превращаться в суммы
    expect(() => parseRub("")).toThrow();
    expect(() => parseRub("   ")).toThrow();
    expect(() => parseRub("0x10")).toThrow();
    expect(() => parseRub("1e3")).toThrow();
    expect(() => parseRub("12,50")).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("не теряет копейку на суммах, не представимых точно в двоичном виде", () => {
    // 2305.47 * 100 === 230546.99999999997 — Math.floor давал 230546
    expect(toKop(2305.47)).toBe(230547);
    expect(toKop(1192.6)).toBe(119260);
    expect(toKop(4549.23)).toBe(454923);
    expect(toKop(0.29)).toBe(29);
    expect(toKop(parseRub("2284.99"))).toBe(228499);
  });

  it("ноль, копейки без рублей и очень малые суммы", () => {
    expect(toKop(0)).toBe(0);
    expect(toKop(0.05)).toBe(5);
    expect(toKop(0.001)).toBe(0);
    expect(toKop(1e-9)).toBe(0);
  });

  it("отклоняет суммы, которые нельзя точно выразить в копейках", () => {
    expect(() => toKop(1e21)).toThrow();
    expect(() => toKop(-1)).toThrow();
    expect(() => toKop(Number.NaN)).toThrow();
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});

describe("скидка", () => {
  it("parsePercent принимает число и строку от 0 до 100", () => {
    expect(parsePercent(0)).toBe(0);
    expect(parsePercent("7")).toBe(7);
    expect(parsePercent(16.5)).toBe(16.5);
    expect(parsePercent(100)).toBe(100);
  });

  it("parsePercent отклоняет мусор и значения вне диапазона", () => {
    expect(() => parsePercent("")).toThrow();
    expect(() => parsePercent("abc")).toThrow();
    expect(() => parsePercent(-1)).toThrow();
    expect(() => parsePercent(100.5)).toThrow();
  });

  it("applyDiscount считает сумму после скидки в копейках", () => {
    expect(applyDiscount(250000, 16.5)).toBe(208750);
    expect(applyDiscount(344100, 33)).toBe(230547);
    expect(applyDiscount(1000, 0)).toBe(1000);
    expect(applyDiscount(1000, 100)).toBe(0);
  });

  it("applyDiscount округляет до ближайшей копейки", () => {
    expect(applyDiscount(101, 33)).toBe(68); // 67.67
    expect(applyDiscount(100, 0.4)).toBe(100); // 99.6
  });

  it("applyDiscount округляет ровно полкопейки вверх", () => {
    // 750 * 0.866 = 649.5; в float это 649.4999999999999
    expect(applyDiscount(750, 13.4)).toBe(650);
    expect(applyDiscount(1, 50)).toBe(1); // 0.5
  });
});
