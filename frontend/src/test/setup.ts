// フロントエンドのテスト（jsdom）の共通の準備。
// API の応答は MSW で返す。決めていない通信は失敗にして、本物の通信が出ないようにする。
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { FakeBroadcastChannel } from "./fake-broadcast-channel";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // #239：端末の下書き（localStorage）をテストの間で持ち越さない
  window.localStorage.clear();
  window.sessionStorage.clear();
  // #341：送った合図の記録だけを消す（closeAll にしない：モジュールの中で遅れて作ったチャンネルを、続くテストでも使うため）
  FakeBroadcastChannel.clearSent();
});
afterAll(() => server.close());

// #338：読み込み直しの入口を、すべての画面のテストで何もしない関数に差し替える（待機の状態・購読・タイマーをテストの間に残さない）。
// 入口そのものの単体テストは、このファイルの差し替えを使わず、本物（vi.importActual）で確かめる。
vi.mock(
  "../features/access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
    // #298（計画 2-8・10章）：利用者の切り替えの読み込み直しの入口も、同じ理由で差し替える。本物は reload-after-access-loss.user-switch.test.ts で確かめる
    requestUserSwitchReload: vi.fn(),
  }),
);

// #341：資格の喪失の合図のチャンネルを、テスト専用の差し替えにする（Node の本物のチャンネルは、閉じないままプロセスに残るため）。
// 送った合図は、差し替えの記録で数える（合図を送る関数そのものは差し替えない）
vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
// jsdom には reportError が無い。ブラウザと同じく、window の error イベントにする
if (typeof globalThis.reportError !== "function")
  vi.stubGlobal("reportError", (error: unknown) =>
    window.dispatchEvent(new ErrorEvent("error", { error })),
  );

// #121：jsdom に無いブラウザ機能の最小のスタブ（App を描画する全テストが共通で使う）。
// すでに定義されていれば上書きしない。個別のテストは app-shell-harness.tsx のスタブで上書きできる。
// 実ブラウザでの動き（フォーカスの閉じ込め・Esc・外側クリック・メディアクエリ）は E2E で確かめる。
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
}

const dialogProto = HTMLDialogElement.prototype;
if (typeof dialogProto.showModal !== "function") {
  Object.defineProperty(dialogProto, "showModal", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
}
if (typeof dialogProto.show !== "function") {
  Object.defineProperty(dialogProto, "show", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
}
if (typeof dialogProto.close !== "function") {
  Object.defineProperty(dialogProto, "close", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
}

for (const name of ["showPopover", "hidePopover", "togglePopover"] as const) {
  if (typeof HTMLElement.prototype[name] !== "function") {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
}

// jsdom は popover の表示状態（:popover-open）を再現せず、閉じた popover を非表示にする既定のスタイルだけが効く。そのためロールで探せるよう打ち消す（本番には影響しない）。
// 「閉じているときは中身が見えない」ことは単体テストでは確かめられないため、E2E（e2e/app-shell.spec.ts）の担当。
const popoverStyle = document.createElement("style");
popoverStyle.textContent =
  "[popover]:not(:popover-open):not(dialog[open]){display:block}";
document.head.appendChild(popoverStyle);
