// #120 AC-1（0-2 AC-1・D-7）：共通の SecretField。表示切替の名前と autocomplete を props で変えられる。
// 既定（props を渡さない）はトークン用の動き（#119 のテストは features/setup/components/SecretField.test.tsx）。
// 公開形の仮定：toggleLabels={{ show, hide }} と autoComplete を受け取る。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SecretField } from "./SecretField";

const PASSWORD_LABELS = { show: "パスワードを表示", hide: "パスワードを隠す" };

describe("#120 AC-1 共通の SecretField", () => {
  it("#120 AC-1: 既定では、切替の名前は「トークンを表示」で autocomplete=off（トークン用の今の動き）", () => {
    render(<SecretField label="トークン" name="token" />);
    const input = screen.getByLabelText("トークン") as HTMLInputElement;
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(
      screen.getByRole("button", { name: "トークンを表示" }),
    ).toBeDefined();
  });

  it("#120 AC-1: toggleLabels と autoComplete を渡すと、パスワード用の名前・current-password になる", async () => {
    const user = userEvent.setup();
    render(
      <SecretField
        label="パスワード"
        name="password"
        toggleLabels={PASSWORD_LABELS}
        autoComplete="current-password"
      />,
    );
    const input = screen.getByLabelText("パスワード") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("current-password");
    const show = screen.getByRole("button", { name: "パスワードを表示" });
    expect(show.getAttribute("type")).toBe("button");
    expect(show.getAttribute("aria-pressed")).toBe("false");
    await user.click(show);
    expect(input.type).toBe("text");
    const hide = screen.getByRole("button", { name: "パスワードを隠す" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    await user.click(hide);
    expect(input.type).toBe("password");
    expect(screen.queryByRole("button", { name: /トークン/ })).toBeNull();
  });

  it("#120 AC-1: error を渡すと aria-invalid と aria-describedby で伝える", () => {
    render(
      <SecretField
        label="パスワード"
        name="password"
        toggleLabels={PASSWORD_LABELS}
        error="入力してください"
      />,
    );
    const input = screen.getByLabelText("パスワード");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const message = screen.getByText("入力してください");
    expect(describedBy.split(" ")).toContain(message.id);
  });
});
