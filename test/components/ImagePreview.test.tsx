import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImagePreview from "@/components/ImagePreview";

vi.mock("@/lib/api", () => ({
  canSaveToAlbum: vi.fn(() => false),
}));

describe("ImagePreview 组件", () => {
  const baseProps = {
    src: "data:image/png;base64,test123",
    alt: "测试图片",
    onClose: vi.fn(),
  };

  it("渲染图片", () => {
    render(<ImagePreview {...baseProps} />);
    const img = screen.getByAltText("测试图片");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", baseProps.src);
  });

  it("点击遮罩触发 onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImagePreview {...baseProps} onClose={onClose} />);
    // 点击 fixed 遮罩的角落（内层容器在 max-w-[90vw] 内，角落是遮罩本身）
    const overlay = document.querySelector('.fixed')!;
    await user.click(overlay, { clientX: 5, clientY: 5 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击 X 按钮触发 onClose", async () => {
    const user = userEvent.setup();
    render(<ImagePreview {...baseProps} />);
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[buttons.length - 1]);
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("onDownload 存在时显示下载按钮", () => {
    render(<ImagePreview {...baseProps} onDownload={vi.fn()} />);
    expect(screen.getByText("下载")).toBeInTheDocument();
  });

  it("onUseAsRef 存在时显示作为参考按钮", () => {
    render(<ImagePreview {...baseProps} onUseAsRef={vi.fn()} />);
    expect(screen.getByText("作为参考")).toBeInTheDocument();
  });

  it("不传下载和参考图时只有复制和关闭", () => {
    render(<ImagePreview {...baseProps} />);
    expect(screen.getByText("复制")).toBeInTheDocument();
    expect(screen.queryByText("下载")).not.toBeInTheDocument();
    expect(screen.queryByText("作为参考")).not.toBeInTheDocument();
  });
});
