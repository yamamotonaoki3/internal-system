// #150（150-B）計画 6.6「状態は CaseDetailPage の key で作り直され、利用者・案件の切り替えで持ち越さない」・#284（ADR-0030）：
// A が再開のダイアログで参加者を選んでいる途中（チェックを外し、検索の欄に入力した状態）で B に替わると、
// A の候補・選んだ内容・検索の入力・ダイアログが、一度も描画されないこと。
// 枠（App）と描画の見張り（render-watch）は test/user-switch-harness の部品を使う（先例：CaseTodos.session-switch.test.tsx）。
// API は MSW。データはすべて架空（testuser_150b_・[E2E_TEST]）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import {
  caseDetail,
  caseId,
  caseSummary,
  type CaseParticipant,
} from "../test/case-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const USER_A = {
  id: "01JTESTCASE150BVSERA00000A",
  displayName: "testuser_150b_a",
  loginId: "testuser_150b_a",
};
const USER_B = {
  id: "01JTESTCASE150BVSERB00000B",
  displayName: "testuser_150b_b",
  loginId: "testuser_150b_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[E2E_TEST]150BA";
const B_MARK = "[E2E_TEST]150BB";
const A_QUERY = "150ba_q";
const N = 153;

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

const participantOf = (
  user: TestUser,
  id: string,
  displayName: string,
): CaseParticipant[] => [
  {
    userId: user.id,
    displayName: user.displayName,
    departmentName: null,
    isActive: true,
    isCreator: false,
    autoRole: null,
    removable: true,
  },
  {
    userId: id,
    displayName,
    departmentName: null,
    isActive: true,
    isCreator: false,
    autoRole: null,
    removable: true,
  },
];

const A_MEMBER = `${A_MARK}の参加者`;
const B_MEMBER = `${B_MARK}の参加者`;

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
  const summary = () =>
    caseSummary(N, { status: "closed", canEditDueDate: false });
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
      serve(() => ({ items: [], nextCursor: null, progress: null })),
    ),
    http.get(
      "/api/cases/:caseId/detail",
      serve((user) =>
        caseDetail(N, {
          ...summary(),
          participants:
            user === USER_A
              ? participantOf(USER_A, "01JTESTCASE150BVSERA0000MA", A_MEMBER)
              : participantOf(USER_B, "01JTESTCASE150BVSERB0000MB", B_MEMBER),
        }),
      ),
    ),
    http.get("/api/cases/:caseId", serve(summary)),
    http.get(
      "/api/users",
      serve(() => ({ items: [], nextCursor: null })),
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

describe("#150 150-B #284 再開のダイアログで選んでいる途中に利用者が替わる", () => {
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
  });

  it("#150 6.6・#284: A の候補・外したチェック・検索の入力・ダイアログが、B に替わった後に一度も描画されず、B の画面にダイアログは出ない", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp(`/cases/${caseId(N)}`, {
      needles: [A_MARK, A_QUERY, "案件の再開"],
    });
    await app.user.click(
      await screen.findByRole("button", { name: "案件を再開" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "案件の再開" });
    await app.user.click(
      within(dialog).getByRole("checkbox", { name: A_MEMBER }),
    );
    await app.user.type(
      within(dialog).getByRole("textbox", { name: "社員の検索" }),
      A_QUERY,
    );
    expect(shows(A_MEMBER)).toBe(true);

    const gate = deferred();
    world.user = USER_B;
    world.hold = gate.promise;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    expect(
      await screen.findByRole("button", { name: "案件を再開" }),
    ).toBeTruthy();
    await waitFor(() => expect(app.watch.commits()).toBeGreaterThan(0));
    expect(app.watch.hits).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
