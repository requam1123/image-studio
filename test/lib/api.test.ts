import { describe, it, expect } from "vitest";
import { dataUrlFromB64, getThumbSrc } from "@/lib/api";

describe("dataUrlFromB64", () => {
  it("给纯 base64 加上 data URL 前缀", () => {
    const result = dataUrlFromB64("abc123");
    expect(result).toBe("data:image/png;base64,abc123");
  });

  it("已包含前缀时不重复添加", () => {
    const result = dataUrlFromB64("data:image/png;base64,abc123");
    expect(result).toBe("data:image/png;base64,abc123");
  });

  it("支持自定义格式", () => {
    const result = dataUrlFromB64("xyz", "image/jpeg");
    expect(result).toBe("data:image/jpeg;base64,xyz");
  });

  it("空字符串处理", () => {
    const result = dataUrlFromB64("");
    expect(result).toBe("data:image/png;base64,");
  });
});

describe("getThumbSrc", () => {
  it("在扩展名前插入 _thumb", () => {
    const result = getThumbSrc("/uploads/history/abc_0.png");
    expect(result).toBe("/uploads/history/abc_0_thumb.png");
  });

  it("处理多级扩展名", () => {
    const result = getThumbSrc("/path/to/image.jpg");
    expect(result).toBe("/path/to/image_thumb.jpg");
  });

  it("处理无扩展名路径（返回原字符串）", () => {
    const result = getThumbSrc("/path/to/image");
    expect(result).toBe("/path/to/image");
  });
});
