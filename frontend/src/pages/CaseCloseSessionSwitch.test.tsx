// #150（150-A）計画 6.6・10章「利用者の切り替え」（#284 の枠・ADR-0030、先例 CaseParticipantSessionSwitch.test.tsx）：
// S-17 のページの中に持つ状態（終了・再開の確認のダイアログ、完了の表示、失敗の文言）が、利用者の切り替えで残らないこと。
// 方針（既存）：ページを利用者の ID・案件の ID を key にして作り直す。B の応答を保留している間も、A のダイアログ・完了の表示を出さない（固定の時間の待ちは使わない）。
// データはすべて架空。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../test/app-shell-harness";
import { caseDetail, caseId, caseSummary } from "../test/case-handlers";
import { server } from "../test/server";

const USER_A = {
  id: "01JTESTCASE150VSERA000001A",
  displayName: "testuser_150_a",
  loginId: "testuser_150_a",
};
const USER_B = {
  id: "01JTESTCASE150VSERB000001A",
  displayName: "testuser_150_b",
  loginId: "testuser_150_b",
};
const N = 41;
const TEXTS = {
  close: "案件を終了",
  closeDialog: "案件の終了",
  closeConfirm: "終了する",
  closed: "案件を終了しました",
  alreadyClosed: "この案件はすでに終了しています",
} as const;

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

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

/**
 * A・B とも進行中の案件の参加者。B の概要・詳細は gate が開くまで保留する。
 * 終了の応答は closeStatus で選ぶ（200 なら A の側だけ状態を終了にする）
 */
function world(closeStatus: 200 | 409 = 200) {
  const gate = deferred();
  const state = { user: USER_A, aClosed: false };
  const summaryCalls: string[] = [];
  const summaryFor = () =>
    caseSummary(N, {
      status: state.user === USER_A && state.aClosed ? "closed" : "active",
    });
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(state.user)),
    ),
    http.get("/api/cases", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/cases/:caseId/detail", async () => {
      if (state.user !== USER_A) await gate.promise;
      return HttpResponse.json(caseDetail(N, summaryFor()));
    }),
    http.get("/api/cases/:caseId", async () => {
      summaryCalls.push(state.user.id);
      if (state.user !== USER_A) await gate.promise;
      return HttpResponse.json(summaryFor());
    }),
    http.post("/api/cases/:caseId/close", () => {
      if (closeStatus === 409)
        return HttpResponse.json(
          {
            code: "CONFLICT",
            message: TEXTS.alreadyClosed,
            reason: "already_closed",
          },
          { status: 409 },
        );
      state.aClosed = true;
      return HttpResponse.json({ caseId: caseId(N), status: "closed" });
    }),
  );
  return { gate, state, summaryCalls };
}

async function switchToB(
  client: ReturnType<typeof renderApp>["client"],
  w: ReturnType<typeof world>,
) {
  const before = w.summaryCalls.length;
  w.state.user = USER_B;
  act(() => {
    client.removeQueries({ queryKey: authKeys.session });
    client.setQueryData(authKeys.session, sessionOf(USER_B));
  });
  await waitFor(() => expect(w.summaryCalls.length).toBeGreaterThan(before));
}

type User = ReturnType<typeof renderApp>["user"];

async function openCloseDialog(user: User) {
  await user.click(await screen.findByRole("button", { name: TEXTS.close }));
  return screen.findByRole("dialog", { name: TEXTS.closeDialog });
}

describe("#150 150-A 利用者の切り替えと、終了・再開のページの状態（S-17）", () => {
  it("#150 #284: A が終了の確認のダイアログを開いたまま B に切り替えると、ダイアログが消え、B の応答を待つ間も出ない", async () => {
    const w = world();
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    await openCloseDialog(user);
    await switchToB(client, w);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    w.gate.release();
    expect(
      await screen.findByRole("button", { name: TEXTS.close }),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("#150 #284: A の「案件を終了しました」が出ている状態で B に切り替えると、完了の表示が消える", async () => {
    const w = world();
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    const dialog = await openCloseDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    );
    expect(await screen.findByText(TEXTS.closed)).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() => expect(screen.queryByText(TEXTS.closed)).toBeNull());
    w.gate.release();
    expect(
      await screen.findByRole("button", { name: TEXTS.close }),
    ).toBeTruthy();
    expect(screen.queryByText(TEXTS.closed)).toBeNull();
  });

  it("#150 #284: A の終了が 409 で失敗の文言が出ている状態で B に切り替えると、文言が消える", async () => {
    const w = world(409);
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    const dialog = await openCloseDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    );
    expect(
      (await screen.findAllByText(TEXTS.alreadyClosed)).length,
    ).toBeGreaterThan(0);
    await switchToB(client, w);
    await waitFor(() =>
      expect(screen.queryByText(TEXTS.alreadyClosed)).toBeNull(),
    );
    w.gate.release();
    expect(
      await screen.findByRole("button", { name: TEXTS.close }),
    ).toBeTruthy();
    expect(screen.queryByText(TEXTS.alreadyClosed)).toBeNull();
  });
});
