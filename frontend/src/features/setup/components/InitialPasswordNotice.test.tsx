// #119 AC-4：S-34 の成功直後の表示（InitialPasswordNotice）。社員IDと初期パスワードを一度だけ文字で示す。
// 公開形の仮定：props は { loginId, initialPassword, onProceed }。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InitialPasswordNotice } from "./InitialPasswordNotice";

// 架空の初期パスワード（テスト専用）
const TEST_INITIAL_PASSWORD = "Tq7#xZ9!mK2$pW4v";

function renderNotice(onProceed: () => void = () => {}) {
  return render(
    <InitialPasswordNotice
      loginId="e2euser_001"
      initialPassword={TEST_INITIAL_PASSWORD}
      onProceed={onProceed}
    />,
  );
}

describe("#119 AC-4 InitialPasswordNotice", () => {
  it("#119 AC-4: 社員IDと初期パスワードを文字で示し、入力欄には入れない", () => {
    renderNotice();
    expect(screen.getByText("e2euser_001")).toBeTruthy();
    const password = screen.getByText(TEST_INITIAL_PASSWORD);
    expect(password.closest("input, textarea")).toBeNull();
    expect(document.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("#119 AC-4: 一度だけの表示・初回ログインでの変更・失ったときの再発行を案内する", () => {
    renderNotice();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/一度だけ/);
    expect(text).toMatch(/初回ログイン/);
    expect(text).toMatch(/再発行/);
  });

  it("#119 AC-4: 「ログイン画面へ進む」で onProceed を1回呼ぶ（キーボードでも押せる）", async () => {
    const onProceed = vi.fn();
    const user = userEvent.setup();
    renderNotice(onProceed);
    const button = screen.getByRole("button", { name: "ログイン画面へ進む" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it("#119 AC-4: 初期パスワードを console に出さない", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    renderNotice();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(
        TEST_INITIAL_PASSWORD,
      );
      spy.mockRestore();
    }
  });
});
