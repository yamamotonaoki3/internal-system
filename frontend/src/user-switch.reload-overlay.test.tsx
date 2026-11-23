// #298 AC-4（計画 plan-298 改訂3 の 8-1 の「AC-4 画面（leave-guard を含む harness）」の行。2-8）：
// 入力が変更ありのまま、セッションが別の利用者 B に替わると、本物の切り替えの入口（requestUserSwitchReload）が待機に入り、
//   - 離脱の確認（beforeunload）を止めない（切り替えの前は止める：対照）
//   - 覆い（「画面を読み込み直しています」）が出て、ルーターの下（入力欄）は hidden・inert の包みの中に入り、読み上げ・Tab の対象にならない
//   - 読み込み直し（browser-location の reloadPage）は1回
// 状態 × 出来事の表（1回目）のます：入口 idle・入力が変更あり × 見張りが別の利用者を見る。
// 本物の入口は文書ごとに1つの状態（以後 idle に戻らない）を持つため、このファイルは1件だけにする（CaseAccessLossCrossTab.limit.test.tsx と同じ）。
// jsdom は inert を実装しないため、クリックで届かないことは「包みに hidden と inert が付く」で確かめ、実際のクリック・Tab は E2E（e2e/session-user-mismatch.spec.ts）で確かめる。
// データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPage } from "./features/access-loss/browser-location";
import { authKeys } from "./features/auth";
import { installDomStubs, type DomStubs } from "./test/app-shell-harness";
import {
  MISMATCH_CHANNEL_ID,
  MISMATCH_USER_B,
  MISMATCH_USER_A,
  respondMismatchWorld,
} from "./test/session-mismatch-world";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "./test/user-switch-harness";

// test/setup.ts の入口の差し替えを外し、本物の入口を使う（project-rules の #338 の項目）
vi.unmock("./features/access-loss/reload-after-access-loss");
vi.mock("./features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const OVERLAY = "画面を読み込み直しています";

function beforeUnloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  disposeUserSwitchApps();
  stubs.restore();
});

describe("#298 AC-4 切り替えの読み込み直しの画面", () => {
  it("#298 AC-4: 入力が変更ありのまま B に替わると、beforeunload を止めず、覆いが出て、入力欄は hidden・inert の包みの中で読み上げ・Tab の対象にならず、読み込み直しは1回", async () => {
    const world = respondMismatchWorld(MISMATCH_USER_A);
    const app = renderUserSwitchApp(`/channels/${MISMATCH_CHANNEL_ID}`, {
      needles: [],
      boundary: true,
    });
    const main = await screen.findByRole("main");
    const box = await within(main).findByRole("textbox", {
      name: "メッセージ",
    });
    await app.user.type(box, "298書きかけ");
    // 対照：切り替えの前は、変更ありの見張りが beforeunload を止める
    expect(beforeUnloadPrevented()).toBe(true);

    world.serverUser = MISMATCH_USER_B;
    act(() => {
      app.client.setQueryData(authKeys.session, {
        user: MISMATCH_USER_B,
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      });
    });

    // 覆いが出る（包みの外の dialog）
    expect(
      await screen.findByRole("dialog", { name: OVERLAY }),
    ).toBeTruthy();
    expect(beforeUnloadPrevented()).toBe(false);
    // ルーターの下は、hidden と inert の付いた包みの中（覆いは包みの外）。
    // A の入力欄は、二重の守り（ADR-0030 の作り直し）で外れていることもあるので、包みそのものと、読み上げの対象にならないことで確かめる
    const wrapper = document.querySelector("[hidden][inert]");
    expect(wrapper).not.toBeNull();
    expect(
      wrapper?.contains(screen.getByRole("dialog", { name: OVERLAY })),
    ).toBe(false);
    expect(box.isConnected ? wrapper?.contains(box) : true).toBe(true);
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
    // Tab を押しても、包みの中に焦点が入らない
    for (let n = 0; n < 5; n += 1) {
      await app.user.tab();
      expect(wrapper?.contains(document.activeElement)).toBe(false);
    }
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    // 読み込み直しの直前まで、離脱の確認は止めないまま
    expect(beforeUnloadPrevented()).toBe(false);
    // 知らせは書かない（Q7）
    expect(Object.keys(window.sessionStorage)).toEqual([]);
  });
});
