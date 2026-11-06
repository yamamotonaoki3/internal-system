// #121：共通レイアウト（app-shell）のテストで使う共通の準備（架空のデータのみ）。
// jsdom は、メディアクエリ（matchMedia）を持たず、<dialog> の showModal / close と popover の showPopover / hidePopover / togglePopover を実装していない。
// そのため、ここで最小のスタブを差し込む。スタブで確かめるのは「属性と、イベントへの反応」まで。
// 実ブラウザでの動き（フォーカスの閉じ込め・Esc の既定処理・外側クリックで閉じる・最前面）は e2e/app-shell.spec.ts で確かめる。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { vi } from "vitest";
import { App } from "../App";
import { server } from "./server";

export const SHELL_USER = {
  id: "01JTESTUSER000000000000001",
  displayName: "testuser_001",
  loginId: "testuser_001",
} as const;

/** GET /api/auth/session：testuser_001 としてログイン済み */
export function respondShellUser(mustChangePassword = false) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SHELL_USER,
        mustChangePassword,
        reauthenticatedAt: null,
      }),
    ),
  );
}

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

export function renderApp(path = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user };
}

type ChangeListener = (event: MediaQueryListEvent) => void;

export type DomStubs = {
  /** 画面幅が 768px（md）以上かどうかを切り替え、change イベントを出す */
  setDesktop: (desktop: boolean) => void;
  /** true の間、dialog.close() は open 属性を外すだけで close イベントを出さない（flushCloseEvents で出す） */
  deferCloseEvents: (defer: boolean) => void;
  /** 遅らせていた close イベントを出す（close() の後に、利用者がフォーカスを動かした状況を再現するため） */
  flushCloseEvents: () => void;
  showPopover: ReturnType<typeof vi.fn>;
  hidePopover: ReturnType<typeof vi.fn>;
  togglePopover: ReturnType<typeof vi.fn>;
  restore: () => void;
};

/** matchMedia・dialog・popover のスタブを入れる。初期の画面幅は 768px 未満（スマホ） */
export function installDomStubs(): DomStubs {
  let desktop = false;
  const listeners = new Set<ChangeListener>();
  const originalMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );

  function isMdQuery(query: string): boolean {
    return /min-width:\s*768px/.test(query);
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const list = {
        media: query,
        onchange: null,
        get matches() {
          return isMdQuery(query) ? desktop : false;
        },
        addEventListener: (type: string, listener: ChangeListener) => {
          if (type === "change") listeners.add(listener);
        },
        removeEventListener: (type: string, listener: ChangeListener) => {
          if (type === "change") listeners.delete(listener);
        },
        addListener: (listener: ChangeListener) => listeners.add(listener),
        removeListener: (listener: ChangeListener) =>
          listeners.delete(listener),
        dispatchEvent: () => true,
      };
      return list;
    },
  });

  let deferCloseEvents = false;
  const pendingCloseEvents: HTMLDialogElement[] = [];
  const dialogProto = HTMLDialogElement.prototype;
  const originalDialog = {
    showModal: Object.getOwnPropertyDescriptor(dialogProto, "showModal"),
    show: Object.getOwnPropertyDescriptor(dialogProto, "show"),
    close: Object.getOwnPropertyDescriptor(dialogProto, "close"),
  };
  Object.defineProperty(dialogProto, "showModal", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(dialogProto, "show", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(dialogProto, "close", {
    configurable: true,
    writable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      // 実ブラウザの close イベントは、close() の少し後に届く。遅らせる指定のときは、flushCloseEvents で出す
      if (deferCloseEvents) pendingCloseEvents.push(this);
      else this.dispatchEvent(new Event("close"));
    },
  });

  const showPopover = vi.fn();
  const hidePopover = vi.fn();
  const togglePopover = vi.fn();
  const elementProto = HTMLElement.prototype;
  const originalPopover = {
    showPopover: Object.getOwnPropertyDescriptor(elementProto, "showPopover"),
    hidePopover: Object.getOwnPropertyDescriptor(elementProto, "hidePopover"),
    togglePopover: Object.getOwnPropertyDescriptor(
      elementProto,
      "togglePopover",
    ),
  };
  for (const [name, fn] of [
    ["showPopover", showPopover],
    ["hidePopover", hidePopover],
    ["togglePopover", togglePopover],
  ] as const) {
    Object.defineProperty(elementProto, name, {
      configurable: true,
      writable: true,
      value: fn,
    });
  }

  function restoreProperty(
    target: object,
    name: string,
    original: PropertyDescriptor | undefined,
  ) {
    if (original === undefined) Reflect.deleteProperty(target, name);
    else Object.defineProperty(target, name, original);
  }

  return {
    setDesktop: (next) => {
      desktop = next;
      act(() => {
        for (const listener of [...listeners])
          listener({
            matches: next,
            media: "(min-width: 768px)",
          } as MediaQueryListEvent);
      });
    },
    deferCloseEvents: (defer) => {
      deferCloseEvents = defer;
    },
    flushCloseEvents: () => {
      act(() => {
        for (const dialog of pendingCloseEvents.splice(0))
          dialog.dispatchEvent(new Event("close"));
      });
    },
    showPopover,
    hidePopover,
    togglePopover,
    restore: () => {
      restoreProperty(window, "matchMedia", originalMatchMedia);
      restoreProperty(dialogProto, "showModal", originalDialog.showModal);
      restoreProperty(dialogProto, "show", originalDialog.show);
      restoreProperty(dialogProto, "close", originalDialog.close);
      restoreProperty(elementProto, "showPopover", originalPopover.showPopover);
      restoreProperty(elementProto, "hidePopover", originalPopover.hidePopover);
      restoreProperty(
        elementProto,
        "togglePopover",
        originalPopover.togglePopover,
      );
    },
  };
}

/** ブラウザの Esc の既定処理を再現する：cancel を出し、止められなければ close する */
export function pressEscapeOn(dialog: HTMLDialogElement): void {
  act(() => {
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) dialog.close();
  });
}

/** popover の toggle イベント（newState を持つ ToggleEvent 相当）を出す */
export function fireToggle(
  element: HTMLElement,
  newState: "open" | "closed",
): void {
  const event = new Event("toggle");
  Object.defineProperty(event, "newState", { value: newState });
  Object.defineProperty(event, "oldState", {
    value: newState === "open" ? "closed" : "open",
  });
  act(() => {
    element.dispatchEvent(event);
  });
}

/** ログイン後のホームが出るまで待つ（確認中の枠にも main があるため、h1「ホーム」で待つ）。main を返す */
export async function findHome(): Promise<HTMLElement> {
  await screen.findByRole("heading", { level: 1, name: "ホーム" });
  return screen.getByRole("main");
}
