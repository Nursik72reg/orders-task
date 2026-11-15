import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

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
