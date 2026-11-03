// #119 AC-4：S-34 のトークン欄（SecretField）。入力を伏せ、ボタンで表示・非表示を切り替える。
// 公開形の仮定：SecretField は label と入力欄の属性（React Hook Form の register の戻り値を含む）を受け取り、ref を input に渡す。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SecretField } from "./SecretField";

const LABEL = "初回セットアップ用のトークン";

describe("#119 AC-4 SecretField", () => {
  it("#119 AC-4: 初めは伏せ字（type=password）で、自動補完に残さない", () => {
    render(<SecretField label={LABEL} name="setupToken" />);
    const input = screen.getByLabelText(LABEL) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("#119 AC-4: 切替ボタンで表示・非表示を切り替え、状態を aria-pressed で伝える", async () => {
    const user = userEvent.setup();
    render(<SecretField label={LABEL} name="setupToken" />);
    const input = screen.getByLabelText(LABEL) as HTMLInputElement;
    const show = screen.getByRole("button", { name: /トークンを表示/ });
    expect(show.getAttribute("type")).toBe("button"); // フォームを送信しない
    expect(show.getAttribute("aria-pressed")).toBe("false");
    await user.click(show);
    expect(input.type).toBe("text");
    const hide = screen.getByRole("button", { name: /トークンを隠す/ });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    await user.click(hide);
    expect(input.type).toBe("password");
  });

  it("#119 AC-4: 切替ボタンはキーボード（Tab と Enter）で操作できる", async () => {
    const user = userEvent.setup();
    render(<SecretField label={LABEL} name="setupToken" />);
    const input = screen.getByLabelText(LABEL) as HTMLInputElement;
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(input.type).toBe("text");
  });
});
