import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, passwordMatches, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "correct horse";
  process.env.SESSION_SECRET = "s".repeat(40);
});
afterEach(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.SESSION_SECRET;
});

describe("auth", () => {
  it("checks the password", () => {
    expect(passwordMatches("correct horse")).toBe(true);
    expect(passwordMatches("wrong")).toBe(false);
  });

  it("verifies its own tokens and rejects tampering", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);
    expect(verifySessionToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(verifySessionToken(`${Date.now() + 1}.${token.split(".")[1]}`)).toBe(false);
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
  });

  it("expires tokens", () => {
    const issued = Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000;
    expect(verifySessionToken(createSessionToken(issued))).toBe(false);
  });

  it("logs everyone out when the password or secret changes", () => {
    const token = createSessionToken();
    process.env.APP_PASSWORD = "new password";
    expect(verifySessionToken(token)).toBe(false);
    process.env.APP_PASSWORD = "correct horse";
    process.env.SESSION_SECRET = "t".repeat(40);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("fails closed when not configured", () => {
    const token = createSessionToken();
    delete process.env.SESSION_SECRET;
    expect(verifySessionToken(token)).toBe(false);
    expect(() => passwordMatches("x")).toThrow(/not configured/);
  });
});
