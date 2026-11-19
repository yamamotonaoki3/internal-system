// #308 AC-1（利用者の切り替え。#284 の枠）：S-17 で、A が外されて非公開の表示に切り替わった後、同じ端末で B に替わっても、
// A の検出の状態（重ねない印・確かめられない状態）と A の内容を持ち越さない。B は参加者のままなので説明が出て、B が外されたときは B の画面も切り替わる。
// 偽の時計で2秒の自動の更新を進める。API は MSW。データはすべて架空（testuser_308_・[UNIT_TEST]）。
import { act, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../features/auth";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import {
  CASE_TEXTS,
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
} from "../test/case-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

const N = 308;
const POLL_MS = 2_000;
const USER_A = {
  id: "01JTESTCASE308VSERA0000001",
  displayName: "testuser_308_a",
  loginId: "testuser_308_a",
};
const USER_B = {
  id: "01JTESTCASE308VSERB0000001",
  displayName: "testuser_308_b",
  loginId: "testuser_308_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[UNIT_TEST]308A";
const B_MARK = "[UNIT_TEST]308B";
const markOf = (user: TestUser) => (user === USER_A ? A_MARK : B_MARK);
const PRIVATE_TEXT = CASE_TEXTS.participantsOnly;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function sessionOf(user: TestUser) {
  return {
    user,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

/** いまの利用者のデータを返す模擬。removed の利用者には、概要は非参加、詳細・部屋は 403 を返す */
function respondSwitchWorld() {
  const world = { user: USER_A as TestUser, removed: new Set<string>() };
  const denied = () => apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT);
  const empty = () => HttpResponse.json({ items: [], nextCursor: null });
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(world.user)),
    ),
    http.get("/api/cases", empty),
    http.get("/api/cases/:caseId/detail", () =>
      world.removed.has(world.user.id)
        ? denied()
        : HttpResponse.json(
            caseDetail(N, { description: `${markOf(world.user)}の説明` }),
          ),
    ),
    // TODO は通ったまま：部屋のメッセージの 403 だけを契機にして、この部品の動きを確かめる
    http.get("/api/cases/:caseId/todos", () =>
      HttpResponse.json({ items: [], nextCursor: null, progress: null }),
    ),
    http.get("/api/cases/:caseId", () =>
      HttpResponse.json(
        world.removed.has(world.user.id) ? outsiderSummary(N) : caseSummary(N),
      ),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      world.removed.has(world.user.id)
        ? denied()
        : HttpResponse.json({
            items: [
              message(1, {
                roomId: caseRoomId(N),
                body: `${markOf(world.user)}の本文`,
              }),
            ],
            nextCursor: null,
            hasMore: false,
          }),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get("/api/me/unread", empty),
    http.get("/api/me/notifications/unread-count", () =>
      HttpResponse.json({ count: 0 }),
    ),
    http.get("/api/me/notifications", empty),
    http.get("/api/channels", empty),
    http.get("/api/dms", empty),
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

describe("#308 AC-1 #284 S-17 を開いたまま利用者が替わる", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
    vi.useRealTimers();
  });

  it("#308 AC-1 #284: A が外されて非公開に切り替わった後に B に替わると、A の内容も検出の状態も持ち越さず、B の説明が出る。B が外されたら B の画面も切り替わる", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp(`/cases/${caseId(N)}`, {
      needles: [`${A_MARK}の説明`, `${A_MARK}の本文`],
    });
    await waitFor(() => expect(shows(`${A_MARK}の説明`)).toBe(true));

    world.removed.add(USER_A.id);
    await advance(POLL_MS);
    await waitFor(() => {
      expect(shows(`${A_MARK}の説明`)).toBe(false);
      expect(shows(PRIVATE_TEXT)).toBe(true);
    });

    // A から B へ。ここから先は、A の内容を一度も描画しない
    world.user = USER_B;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    await waitFor(() => expect(shows(`${B_MARK}の説明`)).toBe(true));
    expect(shows(PRIVATE_TEXT)).toBe(false);
    expect(app.watch.hits).toEqual([]);

    // B も外された：B の画面も、開き直さずに切り替わる
    world.removed.add(USER_B.id);
    await advance(POLL_MS);
    await waitFor(() => {
      expect(shows(`${B_MARK}の説明`)).toBe(false);
      expect(shows(PRIVATE_TEXT)).toBe(true);
    });
    expect(app.watch.hits).toEqual([]);
  });
});
