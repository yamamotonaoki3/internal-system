// #149（149-A）#284（ADR-0030）・計画 6.6：S-17 の TODO の区画を開いたまま利用者が A → B に替わると、A の TODO（題名・担当・進捗）が一度も描画されないこと。
// 枠（App）と描画の見張り（render-watch）は test/user-switch-harness の部品を使う（先例：CaseDetailPage.conversation.test.tsx の #148 #284）。
// API は MSW。データはすべて架空（testuser_case149_・[E2E_TEST]）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import { caseDetail, caseId, caseSummary } from "../test/case-handlers";
import { todoItem } from "../test/case-todo-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const USER_A = {
  id: "01JTESTCASE149VSERA0000001",
  displayName: "testuser_case149_a",
  loginId: "testuser_case149_a",
};
const USER_B = {
  id: "01JTESTCASE149VSERB0000001",
  displayName: "testuser_case149_b",
  loginId: "testuser_case149_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[E2E_TEST]149A";
const B_MARK = "[E2E_TEST]149B";
const markOf = (user: TestUser) => (user === USER_A ? A_MARK : B_MARK);
const N = 49;

function sessionOf(user: TestUser) {
  return {
    user,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** いまの利用者のデータを返す模擬。hold がある間は、セッション以外の応答を保留する */
function respondSwitchWorld() {
  const world = {
    user: USER_A as TestUser,
    hold: null as Promise<void> | null,
  };
  const serve =
    (make: (user: TestUser) => unknown): HttpResponseResolver =>
    async () => {
      if (world.hold !== null) await world.hold;
      const body = make(world.user);
      if (body === null) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(body);
    };
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(world.user)),
    ),
    http.get(
      "/api/cases",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/cases/:caseId/todos",
      serve((user) =>
        user === USER_A
          ? {
              items: [
                todoItem(1, { title: `${A_MARK}のTODO`, completed: true }),
                todoItem(2, { title: `${A_MARK}の未完了` }),
              ],
              nextCursor: null,
              progress: { done: 1, total: 2 },
            }
          : {
              items: [todoItem(3, { title: `${B_MARK}のTODO` })],
              nextCursor: null,
              progress: { done: 0, total: 1 },
            },
      ),
    ),
    http.get(
      "/api/cases/:caseId/detail",
      serve((user) => caseDetail(N, { description: `${markOf(user)}の説明` })),
    ),
    http.get(
      "/api/cases/:caseId",
      serve(() => caseSummary(N)),
    ),
    http.get(
      "/api/rooms/:roomId/messages",
      serve(() => ({ items: [], nextCursor: null, hasMore: false })),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      serve(() => null),
    ),
    http.get(
      "/api/me/unread",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/me/notifications/unread-count",
      serve(() => ({ count: 0 })),
    ),
    http.get(
      "/api/me/notifications",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/channels",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/dms",
      serve(() => ({ items: [], nextCursor: null })),
    ),
  );
  return world;
}

function shows(text: string): boolean {
  if (document.body.textContent?.includes(text)) return true;
  return [...document.querySelectorAll("[aria-label]")].some((element) =>
    element.getAttribute("aria-label")?.includes(text),
  );
}

let stubs: DomStubs;

describe("#149 #284 S-17 の TODO を開いたまま利用者が替わる", () => {
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
  });

  it("#149 AC-1 #284: A の TODO と進捗を表示したまま B に替わると、A の TODO・進捗が一度も描画されず、B の TODO が出る", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp(`/cases/${caseId(N)}`, {
      needles: [A_MARK, "2項目中1項目が完了"],
    });
    await waitFor(() => expect(shows(`${A_MARK}のTODO`)).toBe(true));
    await waitFor(() => expect(shows("2項目中1項目が完了")).toBe(true));

    const gate = deferred();
    world.user = USER_B;
    world.hold = gate.promise;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}のTODO`)).toBe(true));
    expect(app.watch.hits).toEqual([]);
    expect(shows(`${A_MARK}の未完了`)).toBe(false);
  });

  // #149（149-B）計画 10節（利用者の切り替え）：編集のダイアログ（dialog「TODOの編集」。画面の契約は CaseTodos.edit.test.tsx の冒頭）を
  // 開いて入力したまま B に替わると、A の TODO の題名・A の入力がどの確定にも出ない
  it("#149 AC-1 149-B #284: A が TODO の編集のダイアログを開いて入力したまま B に替わると、A の TODO と入力が一度も描画されず、B の TODO が出る", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp(`/cases/${caseId(N)}`, {
      needles: [A_MARK],
    });
    await waitFor(() => expect(shows(`${A_MARK}の未完了`)).toBe(true));
    await app.user.click(
      await screen.findByRole("button", { name: `${A_MARK}の未完了を編集` }),
    );
    const dialog = await screen.findByRole("dialog", { name: "TODOの編集" });
    const title = within(dialog).getByRole("textbox", { name: "題名" });
    await app.user.clear(title);
    await app.user.type(title, `${A_MARK}の入力中`);

    const gate = deferred();
    world.user = USER_B;
    world.hold = gate.promise;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}のTODO`)).toBe(true));
    expect(app.watch.hits).toEqual([]);
    expect(shows(`${A_MARK}の入力中`)).toBe(false);
    expect(screen.queryByRole("dialog", { name: "TODOの編集" })).toBeNull();
  });
});
