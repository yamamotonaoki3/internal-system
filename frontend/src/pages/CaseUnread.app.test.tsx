// #148（148-C）5-1 AC-4 の残り・C-184(1)：枠（App）を通して、案件の未読の印の動きを確かめる。API は MSW。データはすべて架空（testuser_・[E2E_TEST]）。
// この層で確かめるもの（計画 148-C のテストケースと、統括の指示の画面の行）：
//   (1) S-16 の行とサイドバーの項目に未読の数が出て、案件を開くと（S-17 のやり取りの既読。既存の useMarkRoomRead）、再読み込みなしで両方から消える。
//   (2) 利用者の切り替え（#284 の枠・見張り）で、前の利用者の未読の数・最終更新が、次の利用者の画面に一瞬も出ない。
// 既読の送り方・未読の数の取得の網羅は features/unread のテストで確かめ、ここでは重ねない。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  caseDetail,
  caseRoomId,
  caseSummary,
  caseTitle,
  respondCases,
} from "../test/case-handlers";
import { message } from "../test/message-handlers";
import { server } from "../test/server";
import { respondUnread } from "../test/unread-handlers";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const linkName = (name: string, spoken: string) =>
  new RegExp(`^${escape(name)}\\s+${escape(spoken)}$`);

const USER_A = {
  id: "01JTESTCASE148CVSERA00001A",
  displayName: "testuser_148c_a",
  loginId: "testuser_148c_a",
};
const USER_B = {
  id: "01JTESTCASE148CVSERB00001A",
  displayName: "testuser_148c_b",
  loginId: "testuser_148c_b",
};
const A_AT = "2026-11-19T01:05:00.000Z";
const B_AT = "2026-11-18T08:30:00.000Z";

function sessionOf(user: typeof USER_A) {
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

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

const menu = () => screen.findByRole("navigation", { name: "メインメニュー" });

async function cardIn(main: HTMLElement, title: string) {
  const link = await within(main).findByRole("link", {
    name: title,
  });
  const card = link.closest("li");
  if (card === null) throw new Error(`${title} のカードがありません`);
  return card;
}

describe("#148 148-C 案件を開くと未読の印が消える", () => {
  it("#148 148-C C-184(1)・3-1 AC-2: S-16 とサイドバーに出ていた未読の数が、案件を開いて既読になると、再読み込みなしで両方から消える", async () => {
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(sessionOf(USER_A))),
      http.get("/api/rooms/:roomId/messages", ({ params }) =>
        HttpResponse.json({
          items:
            String(params.roomId) === caseRoomId(1)
              ? [
                  message(1, {
                    roomId: caseRoomId(1),
                    body: "[E2E_TEST]148C未読の投稿",
                  }),
                ]
              : [],
          nextCursor: null,
          hasMore: false,
        }),
      ),
    );
    respondCases({
      lists: { "joined:active": [caseSummary(1, { lastActivityAt: A_AT })] },
      summaries: [caseSummary(1, { lastActivityAt: A_AT })],
      details: [caseDetail(1)],
    });
    const world = respondUnread({ counts: { [caseRoomId(1)]: 2 } });
    const { user } = renderApp("/cases");
    const nav = await menu();
    await within(nav).findByRole("link", {
      name: linkName(caseTitle(1), "未読 2件"),
    });
    const main = screen.getByRole("main");
    const card = await cardIn(main, caseTitle(1));
    await waitFor(() =>
      expect(within(card).getByText("未読 2件")).toBeTruthy(),
    );

    await user.click(within(card).getByRole("link", { name: caseTitle(1) }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "やり取り" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(world.puts.some((p) => p.roomId === caseRoomId(1))).toBe(true),
    );
    await waitFor(() =>
      expect(
        within(nav).getByRole("link", { name: caseTitle(1) }).textContent,
      ).toBe(caseTitle(1)),
    );
    expect(within(nav).queryByText(/未読 \d+件/)).toBeNull();

    // 一覧に戻っても、消えたまま（既読の後の未読の数を引く）
    await user.click(within(nav).getByRole("link", { name: "案件" }));
    const back = await cardIn(screen.getByRole("main"), caseTitle(1));
    expect(back.textContent).not.toContain("未読");
  });
});

describe("#148 148-C #284 利用者の切り替え", () => {
  it("#148 148-C #284: S-16 で A から B に切り替えると、B の未読の応答を待つ間に、A の未読の数（一覧・サイドバー）と A の最終更新を出さない", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser)),
      ),
      http.get("/api/cases", () =>
        HttpResponse.json({
          items: [
            caseSummary(1, {
              lastActivityAt: sessionUser === USER_A ? A_AT : B_AT,
            }),
          ],
          nextCursor: null,
        }),
      ),
      http.get("/api/me/unread", async () => {
        if (sessionUser === USER_A)
          return HttpResponse.json({
            items: [{ roomId: caseRoomId(1), count: 7 }],
            nextCursor: null,
          });
        await gate.promise;
        return HttpResponse.json({
          items: [{ roomId: caseRoomId(1), count: 1 }],
          nextCursor: null,
        });
      }),
    );
    const { client } = renderApp("/cases");
    const nav = await menu();
    await within(nav).findByRole("link", {
      name: linkName(caseTitle(1), "未読 7件"),
    });
    const main = screen.getByRole("main");
    const aCard = await cardIn(main, caseTitle(1));
    await waitFor(() =>
      expect(aCard.querySelector("time")?.getAttribute("datetime")).toBe(A_AT),
    );

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });

    // B の一覧が出た後も、B の未読の応答までは、A の数（7）を出さない
    await waitFor(() =>
      expect(
        screen.getByRole("main").querySelector(`time[datetime="${B_AT}"]`),
      ).not.toBeNull(),
    );
    expect(screen.queryByText("未読 7件")).toBeNull();
    expect(document.querySelector(`time[datetime="${A_AT}"]`)).toBeNull();

    gate.release();
    expect(
      await within(nav).findByRole("link", {
        name: linkName(caseTitle(1), "未読 1件"),
      }),
    ).toBeTruthy();
    expect(screen.queryByText("未読 7件")).toBeNull();
  });
});
