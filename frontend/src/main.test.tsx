// #341 AC-1（計画 plan-341 の 6・11、利用者の決定 Q5）：画面の入口（main.tsx）は、起動のときに、別のタブの合図の中継を1回だけ登録する。
// 登録が想定外の例外を投げても、アプリの描画は続け、例外はブラウザの標準の報告（reportError）に渡す（もみ消さない）。
// main.tsx は読み込むとすぐ描画するため、テストごとに #root を用意し、vi.resetModules で読み込み直す。画面の中身（App）は軽い代わりにする。
// 実ブラウザで、登録された中継が合図を受けることは、E2E（e2e/case-access-loss-cross-tab.spec.ts の T-E1）で確かめる。
import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./App", () => ({ App: () => <p>[UNIT_TEST]341アプリの代わり</p> }));
vi.mock("./features/cases", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  installCaseAccessLossRelay: vi.fn(() => () => undefined),
}));

let reportError: ReturnType<typeof vi.fn>;

async function start() {
  vi.resetModules();
  const cases = await import("./features/cases");
  const install = vi.mocked(cases.installCaseAccessLossRelay);
  install.mockClear();
  return install;
}

async function importMain() {
  await act(async () => {
    await import("./main");
  });
}

beforeEach(() => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
});
afterEach(() => {
  document.getElementById("root")?.remove();
  vi.unstubAllGlobals();
});

describe("#341 AC-1 起動のときに、別のタブの合図の中継を登録する", () => {
  it("#341 AC-1: 起動のときに installCaseAccessLossRelay を、アプリの QueryClient で1回呼ぶ", async () => {
    const install = await start();
    await importMain();
    expect(install).toHaveBeenCalledTimes(1);
    const [client] = install.mock.calls[0] ?? [];
    expect(typeof client?.getQueryCache).toBe("function");
    expect(
      await screen.findByText("[UNIT_TEST]341アプリの代わり"),
    ).toBeTruthy();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("#341 Q5: 登録が想定外の例外を投げても、描画は続き、例外は reportError に1回渡す", async () => {
    const install = await start();
    const failure = new Error("[UNIT_TEST]341登録の失敗");
    install.mockImplementation(() => {
      throw failure;
    });
    await importMain();
    expect(install).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(failure);
    expect(
      await screen.findByText("[UNIT_TEST]341アプリの代わり"),
    ).toBeTruthy();
  });
});
