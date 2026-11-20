// #155（155-A）F-7：検索の結果（S-15）を開いたまま、同じタブで利用者が A から B に替わっても、A の抜粋をどの描画の確定にも出さない（ADR-0030・#284）。
// 枠：test/user-switch-harness.tsx（main.tsx と同じ組み立て。実際の切り替えの見張り installUserSwitchGuard を通す）。
// 描画の確かめ方：App 全体を Profiler で包み、確定ごとに A の識別の文字列がないかを記録する（test/render-watch.tsx）。
// 切り替えの経路は、セッションを B で上書きする（user-switch.session-switch.test.tsx の (i) と同じ）。B の検索の応答は手で解決する Promise で保留する。
// 画面の契約は SearchPage.test.tsx の冒頭と同じ。データはすべて架空。A・B の識別の文字列は互いに部分一致しない。
import { act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import { respondPublicStatus } from "../test/auth-handlers";
import { deferred, searchItem } from "../test/search-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const USER_A = {
  id: "01JTEST155SESSA00000000001",
  displayName: "testuser_155_a",
  loginId: "testuser_155_a",
};
const USER_B = {
  id: "01JTEST155SESSB00000000001",
  displayName: "testuser_155_b",
  loginId: "testuser_155_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[E2E_TEST]155A抜粋";
const B_MARK = "[E2E_TEST]155B抜粋";

/** 画面全体の文字（抜粋の強調 <mark> で要素が分かれても、文字としてつながった形で確かめる） */
const bodyText = () => document.body.textContent ?? "";

const sessionOf = (user: TestUser) => ({
  user,
  permissions: [],
  mustChangePassword: false,
  reauthenticatedAt: null,
});

type World = { user: TestUser; hold: Promise<void> | null; queries: string[] };

function respondWorld(): World {
  const world: World = { user: USER_A, hold: null, queries: [] };
  respondPublicStatus();
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(world.user)),
    ),
    http.get("/api/search/messages", async ({ request }) => {
      world.queries.push(new URL(request.url).searchParams.get("q") ?? "");
      const user = world.user;
      const hold = world.hold;
      if (hold !== null) await hold;
      return HttpResponse.json({
        items: [
          searchItem(1, {
            excerpt: `${user === USER_A ? A_MARK : B_MARK}の共通語`,
          }),
        ],
        nextCursor: null,
      });
    }),
  );
  return world;
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  disposeUserSwitchApps();
  stubs.restore();
});

describe("#155 AC-4 F-7 利用者の切り替え（S-15）", () => {
  it("#155 AC-4 F-7: A の検索の結果を出したまま B に替わると、B の取り直しの保留中も含め、A の抜粋をどの確定にも出さない", async () => {
    const world = respondWorld();
    const app = renderUserSwitchApp("/search?q=共通語", {
      needles: [A_MARK],
    });
    await waitFor(() => expect(bodyText()).toContain(A_MARK));

    const gate = deferred();
    world.hold = gate.promise;
    world.user = USER_B;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    await waitFor(() => expect(bodyText()).toContain(B_MARK));
    expect(app.watch.hits).toEqual([]);
    expect(bodyText()).not.toContain(A_MARK);
  });

  it("#155 AC-4 F-7: 切り替えの後、A の検索の結果のキャッシュが残らない", async () => {
    const world = respondWorld();
    const app = renderUserSwitchApp("/search?q=共通語", {
      needles: [A_MARK],
    });
    await waitFor(() => expect(bodyText()).toContain(A_MARK));
    world.user = USER_B;
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    await waitFor(() =>
      expect(
        app.client.getQueryCache().findAll({ queryKey: ["search", USER_A.id] }),
      ).toEqual([]),
    );
  });
});
