// #171 AC-2: 共通の PageLayout。main の中に h1 がちょうど1つあり、子要素を表示する。
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLayout } from "./PageLayout";

describe("#171 AC-2 PageLayout", () => {
  it("#171 AC-2: main が1つあり、その中に title の h1 がちょうど1つある", () => {
    render(
      <PageLayout title="ログイン">
        <p>本文</p>
      </PageLayout>,
    );
    const main = screen.getByRole("main");
    const headings = within(main).getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("ログイン");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("#171 AC-2: 子要素が main の中に表示される", () => {
    render(
      <PageLayout title="画面">
        <p>子の本文</p>
      </PageLayout>,
    );
    expect(
      within(screen.getByRole("main")).getByText("子の本文"),
    ).toBeDefined();
  });

  it("#171 AC-2: width（narrow・default）のどちらでも、同じ構造で描画される", () => {
    const { unmount } = render(
      <PageLayout title="狭い" width="narrow">
        <p>中身</p>
      </PageLayout>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    unmount();
    render(
      <PageLayout title="標準" width="default">
        <p>中身</p>
      </PageLayout>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("標準");
  });
});
