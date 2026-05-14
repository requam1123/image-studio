// @vitest-environment node
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "@/lib/auth";

describe("JWT 认证", () => {
  it("signToken 签发合法 token", async () => {
    const token = await signToken("testuser");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifyToken 验证正确 token", async () => {
    const token = await signToken("testuser");
    const result = await verifyToken(token);
    expect(result).not.toBeNull();
    expect(result!.username).toBe("testuser");
  });

  it("verifyToken 对垃圾字符串返回 null", async () => {
    const result = await verifyToken("invalid.token.string");
    expect(result).toBeNull();
  });

  it("verifyToken 对空字符串返回 null", async () => {
    const result = await verifyToken("");
    expect(result).toBeNull();
  });

  it("两个用户签发不同的 token", async () => {
    const tokenA = await signToken("userA");
    const tokenB = await signToken("userB");
    expect(tokenA).not.toBe(tokenB);
    const resultA = await verifyToken(tokenA);
    const resultB = await verifyToken(tokenB);
    expect(resultA!.username).toBe("userA");
    expect(resultB!.username).toBe("userB");
  });
});
