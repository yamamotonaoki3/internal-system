// #147（147-B）Skill「frontend-state」「security」、先例 channel-admin.session-switch.test.tsx（#143-b レビュー1回目の重大1）：
// S-17 のページの中に持つ状態（「参加者を管理」のダイアログ・削除の確認・完了の表示・納期の変更のダイアログと入力）が、利用者の切り替えで残らないこと。
// 401 の処理はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）。方針：ページを利用者の ID を key にして作り直す（ID が確かめられる前は描画しない）。
// B の応答を保留している間も、A の参加者の名前・完了の表示・ダイアログを、画面のどこにも出さない（固定の時間の待ちは使わない）。
// データはすべて架空。
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  CASE_147B_TEXTS,
  caseDetail,
  caseId,
  caseSummary,
  respondCaseWrites,
  respondUserSearch,
  type CaseParticipant,
} from "../test/case-handlers";
import { server } from "../test/server";

const USER_A = {
  id: "01JTESTCASE147BVSERA00001A",
  displayName: "testuser_147b_a",
  loginId: "testuser_147b_a",
};
const USER_B = {
  id: "01JTESTCASE147BVSERB00001A",
  displayName: "testuser_147b_b",
  loginId: "testuser_147b_b",
};
/** A にだけ見える参加者（B の応答には含めない） */
const A_ONLY: CaseParticipant = {
  userId: "01JTESTCASE147BPARTA00001A",
  displayName: "testuser_147b_a_only",
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const SELF_OF = (user: typeof USER_A): CaseParticipant => ({
  userId: user.id,
  displayName: user.displayName,
  departmentName: null,
  isActive: true,
  isCreator: true,
  autoRole: null,
  removable: true,
});
const NEWCOMER = {
  id: "01JTESTCASE147BPARTN00001A",
  displayName: "testuser_147b_newcomer",
};
const N = 23;

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

/** A は参加者（A_ONLY を含む）。B の概要・詳細は gate が開くまで保留し、開いたら B を参加者とする（A_ONLY は含まない） */
function world() {
  const gate = deferred();
  const state = { user: USER_A };
  const summaryCalls: string[] = [];
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(state.user)),
    ),
    http.get("/api/cases", () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
    http.get("/api/cases/:caseId/detail", async () => {
      if (state.user === USER_A)
        return HttpResponse.json(
          caseDetail(N, { participants: [SELF_OF(USER_A), A_ONLY] }),
        );
      await gate.promise;
      return HttpResponse.json(
        caseDetail(N, { participants: [SELF_OF(USER_B)] }),
      );
    }),
    http.get("/api/cases/:caseId", async () => {
      summaryCalls.push(state.user.id);
      if (state.user === USER_A)
        return HttpResponse.json(caseSummary(N, { participantCount: 2 }));
      await gate.promise;
      return HttpResponse.json(caseSummary(N, { participantCount: 1 }));
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

const showsA = () =>
  document.body.textContent?.includes(A_ONLY.displayName) ?? false;

type User = ReturnType<typeof renderApp>["user"];

async function openManager(user: User) {
  await user.click(await screen.findByRole("button", { name: "参加者を管理" }));
  return screen.findByRole("dialog", { name: "参加者を管理" });
}

async function expectCleanAfterRelease(w: ReturnType<typeof world>) {
  w.gate.release();
  expect(
    await screen.findByRole("button", { name: "参加者を管理" }),
  ).toBeTruthy();
  expect(showsA()).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(CASE_147B_TEXTS.updated)).toBeNull();
}

describe("#147 147-B 利用者の切り替えとページの状態（S-17）", () => {
  it("#147 147-B: A が「参加者を管理」を開いたまま B に切り替えると、ダイアログが消え、B の応答を待つ間も A の参加者の名前が出ない", async () => {
    const w = world();
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    const manager = await openManager(user);
    expect(within(manager).getByText(A_ONLY.displayName)).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "参加者を管理" })).toBeNull(),
    );
    expect(showsA()).toBe(false);
    await expectCleanAfterRelease(w);
  });

  it("#147 147-B: A の削除の確認のダイアログを開いたまま B に切り替えると、確認のダイアログも消える", async () => {
    const w = world();
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    const manager = await openManager(user);
    await user.click(
      within(manager).getByRole("button", {
        name: `${A_ONLY.displayName}を削除`,
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "参加者の削除" }),
    ).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(showsA()).toBe(false);
    await expectCleanAfterRelease(w);
  });

  it("#147 147-B: A の「参加者を更新しました」が出ている状態で B に切り替えると、完了の表示が消える", async () => {
    const w = world();
    respondUserSearch([[NEWCOMER]]);
    respondCaseWrites();
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    const manager = await openManager(user);
    await user.type(
      within(manager).getByRole("textbox", { name: "社員の検索" }),
      "147b",
    );
    await user.click(
      await within(manager).findByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    );
    expect(await screen.findByText(CASE_147B_TEXTS.updated)).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() =>
      expect(screen.queryByText(CASE_147B_TEXTS.updated)).toBeNull(),
    );
    expect(showsA()).toBe(false);
    await expectCleanAfterRelease(w);
  });

  it("#147 147-B: A が納期の変更のダイアログで日付を入れたまま B に切り替えると、ダイアログと入力が残らない", async () => {
    const w = world();
    const { client, user } = renderApp(`/cases/${caseId(N)}`);
    await user.click(await screen.findByRole("button", { name: "納期を変更" }));
    const dialog = await screen.findByRole("dialog", { name: "納期の変更" });
    const input = within(dialog).getByLabelText<HTMLInputElement>("納期");
    fireEvent.change(input, { target: { value: "2027-03-03" } });
    expect(input.value).toBe("2027-03-03");
    await switchToB(client, w);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "納期の変更" })).toBeNull(),
    );
    w.gate.release();
    await user.click(await screen.findByRole("button", { name: "納期を変更" }));
    const reopened = await screen.findByRole("dialog", { name: "納期の変更" });
    expect(
      within(reopened).getByLabelText<HTMLInputElement>("納期").value,
    ).not.toBe("2027-03-03");
  });
});
