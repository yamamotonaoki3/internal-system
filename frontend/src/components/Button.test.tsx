// #171 AC-2: 共通の Button。種類（variant）を選べ、type の既定は "button"（フォームを意図せず送信しない）。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("#171 AC-2 Button", () => {
  it("#171 AC-2: type を渡さないと type=button になる", () => {
    render(<Button>保存</Button>);
    expect(
      screen.getByRole("button", { name: "保存" }).getAttribute("type"),
    ).toBe("button");
  });

  it("#171 AC-2: type=submit を渡すとその値になる", () => {
    render(<Button type="submit">送信</Button>);
    expect(
      screen.getByRole("button", { name: "送信" }).getAttribute("type"),
    ).toBe("submit");
  });

  it("#171 AC-2: variant の3種類（primary・secondary・danger）でも、名前つきのボタンとして描画される", () => {
    render(
      <>
        <Button variant="primary">主</Button>
        <Button variant="secondary">副</Button>
        <Button variant="danger">削除</Button>
      </>,
    );
    for (const name of ["主", "副", "削除"])
      expect(screen.getByRole("button", { name })).toBeDefined();
  });

  it("#171 AC-2: クリックで onClick が呼ばれる", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>実行</Button>);
    await user.click(screen.getByRole("button", { name: "実行" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("#171 AC-2: disabled のときはクリックしても onClick が呼ばれない", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        実行
      </Button>,
    );
    const button = screen.getByRole("button", { name: "実行" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("#171 AC-2: aria-pressed などの属性を受け渡す", () => {
    render(
      <Button aria-pressed={true} aria-label="表示を切り替える">
        表示
      </Button>,
    );
    const button = screen.getByRole("button", { name: "表示を切り替える" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("#171 AC-2: className は型として受け取らない（呼び出し側で見た目を上書きさせない）", () => {
    // @ts-expect-error className は Props から除いてある
    render(<Button className="x">型</Button>);
    expect(screen.getByRole("button", { name: "型" })).toBeDefined();
  });
});
