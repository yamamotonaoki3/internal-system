// #150（150-C）計画 4.6「利用者・案件の切り替えは CaseDetailPage の key で作り直す」・#284（ADR-0030）：
// A が「内容を編集」のダイアログで件名・説明を入力している途中で B に替わると、A の説明・入力・ダイアログが、一度も描画されないこと。
// 枠（App）と描画の見張り（render-watch）は test/user-switch-harness の部品を使う（先例：CaseReopenSessionSwitch.test.tsx）。
// API は MSW。データはすべて架空（testuser_150c_・[E2E_TEST]）。画面の契約は pages/CaseEdit.test.tsx の冒頭を参照。
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
import { CLIENT_A, DEPT_SALES } from "../test/case-request-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const USER_A = {
  id: "01JTESTCASE150CVSERA00000A",
  displayName: "testuser_150c_a",
  loginId: "testuser_150c_a",
};
const USER_B = {
  id: "01JTESTCASE150CVSERB00000B",
  displayName: "testuser_150c_b",
  loginId: "testuser_150c_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[E2E_TEST]150CA";
const B_MARK = "[E2E_TEST]150CB";
const A_TYPED = "150ca_typed";
const N = 164;

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

const selfOf = (user: TestUser): CaseParticipant => ({
  userId: user.id,
  displayName: user.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
});

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
    caseSummary(N, {
      client: { id: CLIENT_A.id, name: CLIENT_A.name, isActive: true },
      departments: [
        { id: DEPT_SALES.id, name: DEPT_SALES.name, isActive: true },
      ],
    });
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
          description: user === USER_A ? `${A_MARK}の説明` : `${B_MARK}の説明`,
          participants: [selfOf(user)],
        }),
      ),
    ),
    http.get("/api/cases/:caseId", serve(summary)),
    http.get(
      "/api/clients/candidates",
      serve(() => ({ items: [CLIENT_A], nextCursor: null })),
    ),
    http.get(
      "/api/users/departments",
      serve(() => ({ items: [DEPT_SALES] })),
    ),
    http.get(
      "/api/case-requests/similar-title",
      serve(() => ({ hasSimilar: false, formattedTitle: "" })),
    ),
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
  if (
    [...document.querySelectorAll("input, textarea")].some((element) =>
      (element as HTMLInputElement).value.includes(text),
    )
  )
    return true;
  return [...document.querySelectorAll("[aria-label]")].some((element) =>
    element.getAttribute("aria-label")?.includes(text),
  );
}

let stubs: DomStubs;

describe("#150 150-C #284 内容の編集のダイアログで入力している途中に利用者が替わる", () => {
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
  });

  it("#150 4.6・#284: A の説明・入力・ダイアログが、B に替わった後に一度も描画されず、B の画面にダイアログは出ない", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp(`/cases/${caseId(N)}`, {
      needles: [A_MARK, A_TYPED, "案件の内容の編集"],
    });
    const button = await screen.findByRole<HTMLButtonElement>("button", {
      name: "内容を編集",
    });
    await waitFor(() => expect(button.disabled).toBe(false));
    await app.user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: "案件の内容の編集",
    });
    await app.user.type(
      within(dialog).getByRole("textbox", { name: /説明/ }),
      A_TYPED,
    );
    expect(shows(A_TYPED)).toBe(true);
    expect(shows(A_MARK)).toBe(true);

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
      await screen.findByRole("button", { name: "内容を編集" }),
    ).toBeTruthy();
    await waitFor(() => expect(app.watch.commits()).toBeGreaterThan(0));
    expect(app.watch.hits).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
