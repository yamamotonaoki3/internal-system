// #171 AC-2: 共通の Alert。tone で見た目を選び、role は呼び出し側が渡したものだけを付ける。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "./Alert";

describe("#171 AC-2 Alert", () => {
  it("#171 AC-2: role=alert を渡すと alert として読み上げられる", () => {
    render(
      <Alert tone="error" role="alert">
        ログインできません
      </Alert>,
    );
    expect(screen.getByRole("alert").textContent).toBe("ログインできません");
  });

  it("#171 AC-2: role=status を渡すと status になる", () => {
    render(
      <Alert tone="info" role="status">
        保存しました
      </Alert>,
    );
    expect(screen.getByRole("status").textContent).toBe("保存しました");
  });

  it("#171 AC-2: role を渡さないと、alert にも status にもならない（勝手に読み上げさせない）", () => {
    render(<Alert tone="warning">注意してください</Alert>);
    expect(screen.getByText("注意してください")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("#171 AC-2: tone の3種類（error・info・warning）すべてで内容が描画される", () => {
    render(
      <>
        <Alert tone="error">エラー</Alert>
        <Alert tone="info">情報</Alert>
        <Alert tone="warning">警告</Alert>
      </>,
    );
    for (const text of ["エラー", "情報", "警告"])
      expect(screen.getByText(text)).toBeDefined();
  });

  it('#171 AC-2: as="p" のとき p 要素で描画される（role は渡したものが付く）', () => {
    render(
      <Alert tone="error" role="alert" as="p">
        入力エラー
      </Alert>,
    );
    const element = screen.getByRole("alert");
    expect(element.tagName).toBe("P");
    expect(element.textContent).toBe("入力エラー");
  });

  it("#171 AC-2: as を渡さないとき div 要素で描画される", () => {
    render(
      <Alert tone="info" role="status">
        お知らせ
      </Alert>,
    );
    expect(screen.getByRole("status").tagName).toBe("DIV");
  });

  it('#171 AC-2: as="p" でも role を渡さなければ alert にも status にもならず、p のまま描画される', () => {
    render(
      <Alert tone="warning" as="p">
        注意
      </Alert>,
    );
    expect(screen.getByText("注意").tagName).toBe("P");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
