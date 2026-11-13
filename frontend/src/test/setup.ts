// フロントエンドのテスト（jsdom）の共通の準備。
// API の応答は MSW で返す。決めていない通信は失敗にして、本物の通信が出ないようにする。
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // #239：端末の下書き（localStorage）をテストの間で持ち越さない
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

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
