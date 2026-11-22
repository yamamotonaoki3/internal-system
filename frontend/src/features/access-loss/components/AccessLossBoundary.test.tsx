// #338 AC-2（計画 plan-338 の 5-5・7-2 の U-12）：境界 AccessLossBoundary。入口の状態が idle 以外（waiting・reloading）の間、
// 子（本番ではルーター全体）を hidden・inert の包みで描画から外し、包みの外の全画面の覆い（dialog・showModal）を出す。
// 覆いの cancel（Esc）を止め、close されたら開き直す。idle に戻れば外れる。
// jsdom は showModal・最上位の層・display:none を再現しないため、ここでは属性とイベントへの反応だけを確かめる（実ブラウザは E2E の E-2）。
// 入口の状態はファイルの中で持ち越すため、テストは idle → waiting → idle（取りやめ）→ reloading の順に並べる（reloading は idle に戻らない）。
// 前提にした口（実装の担当へ）：AccessLossBoundary（children を包む）、覆いの見出し「画面を読み込み直しています」、
//   包みは子の親要素（hidden 属性と inert 属性を持つ）、入口の requestAccessLossReload・getAccessLossReloadState。
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authKeys } from "../../auth";
import {
  AccessLossBoundary,
  getAccessLossReloadState,
  requestAccessLossReload,
} from "..";

// #338：test/setup.ts の入口の差し替えを外し、本物の入口を使う
vi.unmock("../reload-after-access-loss");
vi.mock("../browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const USER_A = "01JTESTUSER338A00000000001";
const USER_B = "01JTESTUSER338B00000000001";
const OVERLAY_TITLE = "画面を読み込み直しています";
const CHILD_TEXT = "[UNIT_TEST]338ルーターの下の画面";

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_338_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function renderBoundary() {
  render(
    <AccessLossBoundary>
      <p>{CHILD_TEXT}</p>
      <dialog open aria-label="[UNIT_TEST]338子のダイアログ" />
    </AccessLossBoundary>,
  );
}

function wrapperOfChild(): HTMLElement {
  const child = screen.getByText(CHILD_TEXT);
  const wrapper = child.parentElement;
  if (wrapper === null) throw new Error("子の包みがありません");
  return wrapper;
}

function overlay(): HTMLDialogElement {
  const heading = screen.getByRole("heading", { name: OVERLAY_TITLE });
  const dialog = heading.closest("dialog");
  if (dialog === null) throw new Error("覆いの dialog がありません");
  return dialog;
}

const client = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
});
let release: () => void = () => undefined;

beforeAll(() => {
  vi.useFakeTimers();
  client.setQueryData(authKeys.session, sessionOf(USER_A));
});
afterAll(() => {
  release();
  vi.useRealTimers();
});

describe("#338 AC-2 U-12 境界は、waiting と reloading の間、子を隠して覆いを出す", () => {
  it("#338 AC-2 U-12: idle の間は、子を隠さず（hidden・inert なし）、覆いを出さない", () => {
    expect(getAccessLossReloadState()).toBe("idle");
    renderBoundary();
    const wrapper = wrapperOfChild();
    expect(wrapper.hasAttribute("hidden")).toBe(false);
    expect(wrapper.hasAttribute("inert")).toBe(false);
    expect(
      screen.queryByRole("heading", { name: OVERLAY_TITLE, hidden: true }),
    ).toBeNull();
  });

  it("#338 AC-2 U-12: waiting になると、子の包みに hidden と inert が付き、包みの外に覆い（open の dialog）が出る。cancel は止まり、close されても開き直す。別の利用者に替わって idle に戻ると外れる", async () => {
    renderBoundary();
    // 終わらない操作を1つ置いて、waiting に留める
    const observer = new MutationObserver(client, {
      mutationFn: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    void observer.mutate();
    await vi.advanceTimersByTimeAsync(0);
    act(() => {
      void requestAccessLossReload(client, { ownerId: USER_A, reason: "lost" });
    });
    expect(getAccessLossReloadState()).toBe("waiting");

    const wrapper = wrapperOfChild();
    expect(wrapper.hasAttribute("hidden")).toBe(true);
    expect(wrapper.hasAttribute("inert")).toBe(true);
    const cover = overlay();
    expect(cover.hasAttribute("open")).toBe(true);
    // 覆いは包みの外（包みの hidden・inert の影響を受けない）
    expect(wrapper.contains(cover)).toBe(false);
    // 子のダイアログは、包みの中に残る（描画から外れるだけ）
    expect(
      within(wrapper).getByRole("dialog", {
        name: "[UNIT_TEST]338子のダイアログ",
        hidden: true,
      }),
    ).toBeTruthy();

    // Esc（cancel）は止める
    const cancel = new Event("cancel", { cancelable: true });
    act(() => {
      cover.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(cover.hasAttribute("open")).toBe(true);
    // close されたら、開き直す
    act(() => {
      cover.close();
    });
    expect(overlay().hasAttribute("open")).toBe(true);

    // 別の利用者に替わると、取りやめて外れる（AC-3）
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(getAccessLossReloadState()).toBe("idle");
    expect(wrapperOfChild().hasAttribute("hidden")).toBe(false);
    expect(wrapperOfChild().hasAttribute("inert")).toBe(false);
    expect(
      screen.queryByRole("heading", { name: OVERLAY_TITLE, hidden: true }),
    ).toBeNull();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("#338 AC-2 U-12: reloading（読み込み直しを呼んだ後）でも、子を隠し、覆いを出したまま", async () => {
    renderBoundary();
    act(() => {
      void requestAccessLossReload(client, { ownerId: USER_B, reason: "lost" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getAccessLossReloadState()).toBe("reloading");
    const wrapper = wrapperOfChild();
    expect(wrapper.hasAttribute("hidden")).toBe(true);
    expect(wrapper.hasAttribute("inert")).toBe(true);
    expect(overlay().hasAttribute("open")).toBe(true);
  });
});
