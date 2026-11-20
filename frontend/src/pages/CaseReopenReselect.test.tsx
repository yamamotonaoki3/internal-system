// #150（150-B）5-1 AC-16、画面 S-17 の「案件を再開」のダイアログ（参加者の選び直し）。API は MSW で返す。データはすべて架空（testuser_150b_・[UNIT_TEST]）。
// この層で確かめるもの（計画 150-B 10章の「画面」の行・6.6）：
//   - 候補はいまの有効な参加者だけ（退職者は出さない。Q1）。初期は全員チェック（残す）
//   - 再開する本人・担当部署のオーナー・全体管理者はチェックを外せず、理由（「再開する本人」「担当部署のオーナー」「全体管理者」）を添える（Q2）
//   - 社員の検索で追加し、取り消せる。検索の結果から、いまの参加者と追加の予定の人を除く
//   - 確かめる段階：「残る人」「追加する人」「外れる人」（0人は「なし」）と、共有の文言（Q5）。「戻る」で選んだ内容を保ったまま戻る
//   - 送信の本文 { participantIds（開いた時点の候補）, addUserIds, removeUserIds }。送信中はダイアログの操作を全部無効にし、二重に送らない
//   - 成功の文言はダイアログの外に残る。409・403 はダイアログを閉じて外に出す。422 の fields（addUserIds）はダイアログを閉じずに「社員の検索」の欄のエラー
//   - 409 participants_changed の後に開き直すと、取り直した詳細の新しい候補で選び直せる。失敗の表示は、後の成功で消える
// #316 AC-1（詳細の取得の失敗）：ダイアログは、取得中は role="status" の「読み込み中です」、失敗は role="alert" で API のメッセージ
//   （下の DETAIL_ERROR）と button「再試行」を出す（CaseTodoHistory・CaseEditDialog の出し方にそろえた）。失敗の間は、参加者の欄・「確認へ」を出さない。
//   「再試行」で詳細を取り直し、成功したら失敗の表示が消えて選ぶ段階になる。403・404（外された）は #308 の経路（CaseAccessLoss.test.tsx・CaseReopenRemovedViewer.test.tsx）が確かめる。
// 認可・判定の順はサーバー（backend の routes/cases.reopen-reselect.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの。既存の「参加者を管理」・終了と再開のダイアログの型に合わせた）：
//   ボタン「案件を再開」→ ダイアログ（role dialog、名前「案件の再開」）。
//   段階1：候補ごとに checkbox（名前は表示名）。外せない人は disabled で、同じ行（li）に理由の文。
//     入力欄「社員の検索」（結果は「{表示名}を追加」のボタン）。追加の予定は、名前「追加する社員」の list に行を出し、行ごとに「{表示名}の追加を取り消す」。
//     ボタン「確認へ」「キャンセル」。
//   段階2：region「残る人」「追加する人」「外れる人」（見出しで名前を付ける。中に表示名、0人なら「なし」）と共有の文言。ボタン「再開する」「戻る」「キャンセル」。
//   POST /api/cases/:caseId/reopen の本文は上のとおり（配列の順は問わない）。成功は既存の「案件を再開しました」（ダイアログの外）。
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { caseKeys } from "../features/cases";
import { TEST_USER } from "../test/auth-handlers";
import {
  caseDetail,
  caseId,
  caseSummary,
  respondCases,
  respondUserSearch,
  type CaseDetail,
  type CaseParticipant,
  type CaseSummary,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { apiErrorResponse } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const TEXTS = {
  reopen: "案件を再開",
  dialog: "案件の再開",
  next: "確認へ",
  back: "戻る",
  cancel: "キャンセル",
  confirm: "再開する",
  reopened: "案件を再開しました",
  share:
    "再開すると、追加した人にも、これまでのメッセージ・TODO・添付が共有されます。外れた人は、この案件の内容を見られなくなります。",
  stay: "残る人",
  add: "追加する人",
  leave: "外れる人",
  none: "なし",
  reasonSelf: "再開する本人",
  reasonOwner: "担当部署のオーナー",
  reasonAdmin: "全体管理者",
  participantsChanged:
    "参加者がほかの操作で変わりました。画面を確かめてから、もう一度操作してください",
  alreadyActive: "この案件はすでに進行中です",
  targetInvalid: "追加できる社員を選んでください",
} as const;
const SEARCH_LABEL = "社員の検索";
const ADDED_LIST = "追加する社員";

const person = (
  key: string,
  overrides: Partial<CaseParticipant> = {},
): CaseParticipant => ({
  userId: `01JTESTCASE150BPART00000${key}`,
  displayName: `testuser_150b_${key.toLowerCase()}`,
  departmentName: "[UNIT_TEST]営業150B",
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
  ...overrides,
});

const SELF: CaseParticipant = {
  ...person("0S"),
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
};
const OWNER = person("0W", { autoRole: "department_owner", removable: false });
const ADMIN = person("AD", { autoRole: "global_admin", removable: false });
const MEMBER_A = person("MA");
const MEMBER_B = person("MB");
const RETIRED = person("RT", { isActive: false });
const LATE_JOINER = person("NJ");
const NEWCOMER = {
  id: "01JTESTCASE150BSRCH000000N",
  displayName: "testuser_150b_new",
};
const NEWCOMER_2 = {
  id: "01JTESTCASE150BSRCH000000M",
  displayName: "testuser_150b_new2",
};

const N = 151;
const ACTIVE_IDS = [SELF, OWNER, ADMIN, MEMBER_A, MEMBER_B].map(
  (p) => p.userId,
);

type Write = { path: string; body: unknown };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * 終了中の案件の概要・詳細と、再開の架空の応答。respond を省くと、状態を進行中にして 200 を返す。
 * state.participants を変えると、取り直しの詳細に反映される
 */
function world(respond?: (write: Write) => Response | Promise<Response>) {
  const state = {
    status: "closed" as "active" | "closed",
    participants: [SELF, OWNER, ADMIN, MEMBER_A, MEMBER_B, RETIRED],
  };
  const summaryOf = (): CaseSummary =>
    caseSummary(N, {
      status: state.status,
      canEditDueDate: state.status === "active",
      participantCount: state.participants.length,
    });
  const detailOf = (): CaseDetail =>
    caseDetail(N, { ...summaryOf(), participants: state.participants });
  const calls = respondCases({ summaries: [summaryOf()] });
  const detailCalls: number[] = [];
  server.use(
    http.get("/api/cases/:caseId", () => HttpResponse.json(summaryOf())),
    http.get("/api/cases/:caseId/detail", () => {
      detailCalls.push(1);
      return HttpResponse.json(detailOf());
    }),
  );
  const writes: Write[] = [];
  server.use(
    http.post("/api/cases/:caseId/reopen", async ({ request }) => {
      const text = await request.text();
      const write: Write = {
        path: new URL(request.url).pathname,
        body: text === "" ? undefined : (JSON.parse(text) as unknown),
      };
      writes.push(write);
      if (respond !== undefined) return respond(write);
      state.status = "active";
      return HttpResponse.json({ caseId: caseId(N), status: "active" });
    }),
  );
  return { ...calls, state, writes, detailCalls };
}

function renderPage() {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(N)}`,
    path: "/cases/:caseId",
  });
}

type User = ReturnType<typeof renderPage>["user"];

async function openDialog(user: User) {
  await user.click(await screen.findByRole("button", { name: TEXTS.reopen }));
  return screen.findByRole("dialog", { name: TEXTS.dialog });
}

const checkbox = (dialog: HTMLElement, displayName: string) =>
  within(dialog).getByRole<HTMLInputElement>("checkbox", { name: displayName });

async function addBySearch(
  user: User,
  dialog: HTMLElement,
  displayName: string,
) {
  const search = within(dialog).getByRole("textbox", { name: SEARCH_LABEL });
  await user.clear(search);
  await user.type(search, "150b");
  await user.click(
    await within(dialog).findByRole("button", { name: `${displayName}を追加` }),
  );
}

const regionNames = (dialog: HTMLElement, name: string) => {
  const region = within(dialog).getByRole("region", { name });
  return region.textContent ?? "";
};

const insideDialog = (element: HTMLElement) =>
  element.closest("dialog") !== null;

const sortedBody = (body: unknown) => {
  const b = body as {
    participantIds: string[];
    addUserIds: string[];
    removeUserIds: string[];
  };
  return {
    participantIds: [...b.participantIds].sort(),
    addUserIds: [...b.addUserIds].sort(),
    removeUserIds: [...b.removeUserIds].sort(),
  };
};

/** 入力欄のエラー（aria-describedby で結び付いた文） */
function describedText(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("#150 150-B S-17 再開のダイアログ：参加者を選ぶ段階（5-1 AC-16）", () => {
  it("#150 AC-16・Q1: 候補はいまの有効な参加者だけで、初期は全員チェックされている（退職者は出さない）", async () => {
    world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    for (const p of [SELF, OWNER, ADMIN, MEMBER_A, MEMBER_B])
      expect(checkbox(dialog, p.displayName).checked, p.displayName).toBe(true);
    expect(
      within(dialog).queryByRole("checkbox", { name: RETIRED.displayName }),
    ).toBeNull();
    expect(within(dialog).queryByText(RETIRED.displayName)).toBeNull();
  });

  it.each([
    { name: "再開する本人", who: () => SELF, reason: TEXTS.reasonSelf },
    { name: "担当部署のオーナー", who: () => OWNER, reason: TEXTS.reasonOwner },
    { name: "全体管理者", who: () => ADMIN, reason: TEXTS.reasonAdmin },
  ])(
    "#150 AC-16・Q2: $name はチェックを外せず、同じ行に理由「$reason」を添える",
    async ({ who, reason }) => {
      world();
      const { user } = renderPage();
      const dialog = await openDialog(user);
      const box = checkbox(dialog, who().displayName);
      expect(box.disabled).toBe(true);
      expect(box.closest("li")?.textContent ?? "").toContain(reason);
      await user.click(box);
      expect(box.checked).toBe(true);
    },
  );

  it("#150 AC-16: 自動参加でないほかの参加者はチェックを外せ、理由の文を添えない", async () => {
    world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    const box = checkbox(dialog, MEMBER_A.displayName);
    expect(box.disabled).toBe(false);
    const row = box.closest("li")?.textContent ?? "";
    for (const reason of [
      TEXTS.reasonSelf,
      TEXTS.reasonOwner,
      TEXTS.reasonAdmin,
    ])
      expect(row).not.toContain(reason);
    await user.click(box);
    expect(box.checked).toBe(false);
  });

  it("#150 AC-16・Q3: 社員の検索で追加でき、結果からいまの参加者と追加の予定の人を除く。追加は取り消せる", async () => {
    world();
    respondUserSearch([
      [
        NEWCOMER,
        { id: MEMBER_A.userId, displayName: MEMBER_A.displayName },
        NEWCOMER_2,
      ],
    ]);
    const { user } = renderPage();
    const dialog = await openDialog(user);
    const search = within(dialog).getByRole("textbox", { name: SEARCH_LABEL });
    await user.type(search, "150b");
    expect(
      await within(dialog).findByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", {
        name: `${MEMBER_A.displayName}を追加`,
      }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    );
    const added = within(dialog).getByRole("list", { name: ADDED_LIST });
    expect(within(added).getByText(NEWCOMER.displayName)).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", {
        name: `${NEWCOMER.displayName}を追加`,
      }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", {
        name: `${NEWCOMER_2.displayName}を追加`,
      }),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", {
        name: `${NEWCOMER.displayName}の追加を取り消す`,
      }),
    );
    expect(
      within(dialog).queryByRole("list", { name: ADDED_LIST })?.textContent ??
        "",
    ).not.toContain(NEWCOMER.displayName);
    expect(
      within(dialog).queryByRole("button", {
        name: `${NEWCOMER.displayName}の追加を取り消す`,
      }),
    ).toBeNull();
  });

  it("#150 6.6: キャンセルでは送らず、ダイアログを閉じる", async () => {
    const { writes } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.cancel }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull(),
    );
    expect(writes).toEqual([]);
  });
});

describe("#150 150-B S-17 再開のダイアログ：確かめる段階と送信（5-1 AC-16、Q5）", () => {
  it("#150 AC-16・Q5: 1人を外し1人を足して「確認へ」→「残る人」「追加する人」「外れる人」と共有の文言を出し、「再開する」で本文を1回送り、成功の文言をダイアログの外に出す", async () => {
    const { writes } = world();
    respondUserSearch([[NEWCOMER]]);
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(checkbox(dialog, MEMBER_A.displayName));
    await addBySearch(user, dialog, NEWCOMER.displayName);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));

    const stay = regionNames(dialog, TEXTS.stay);
    for (const p of [SELF, OWNER, ADMIN, MEMBER_B])
      expect(stay).toContain(p.displayName);
    expect(stay).not.toContain(MEMBER_A.displayName);
    expect(regionNames(dialog, TEXTS.add)).toContain(NEWCOMER.displayName);
    expect(regionNames(dialog, TEXTS.leave)).toContain(MEMBER_A.displayName);
    expect(within(dialog).getByText(TEXTS.share)).toBeTruthy();

    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    const done = await screen.findByText(TEXTS.reopened);
    expect(insideDialog(done)).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull(),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(`/api/cases/${caseId(N)}/reopen`);
    expect(sortedBody(writes[0]?.body)).toEqual({
      participantIds: [...ACTIVE_IDS].sort(),
      addUserIds: [NEWCOMER.id],
      removeUserIds: [MEMBER_A.userId],
    });
    expect(
      await screen.findByRole("button", { name: "案件を終了" }),
    ).toBeTruthy();
  });

  it("#150 Q5・Q7: 選び直さずに「確認へ」→「追加する人」「外れる人」は「なし」、本文は空の追加・除外", async () => {
    const { writes } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    expect(regionNames(dialog, TEXTS.add)).toContain(TEXTS.none);
    expect(regionNames(dialog, TEXTS.leave)).toContain(TEXTS.none);
    expect(regionNames(dialog, TEXTS.stay)).not.toContain(TEXTS.none);
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
    expect(sortedBody(writes[0]?.body)).toEqual({
      participantIds: [...ACTIVE_IDS].sort(),
      addUserIds: [],
      removeUserIds: [],
    });
  });

  it("#150 6.6:「戻る」で選ぶ段階に戻り、外した人・追加の予定は保たれる", async () => {
    world();
    respondUserSearch([[NEWCOMER]]);
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(checkbox(dialog, MEMBER_B.displayName));
    await addBySearch(user, dialog, NEWCOMER.displayName);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    await user.click(within(dialog).getByRole("button", { name: TEXTS.back }));
    expect(checkbox(dialog, MEMBER_B.displayName).checked).toBe(false);
    expect(checkbox(dialog, MEMBER_A.displayName).checked).toBe(true);
    const added = within(dialog).getByRole("list", { name: ADDED_LIST });
    expect(within(added).getByText(NEWCOMER.displayName)).toBeTruthy();
  });

  it("#150 二重送信の防止: 応答を待つ間は、ダイアログのボタンを全部押せず、送るのは1回だけ", async () => {
    const gate = deferred();
    const w = world(async () => {
      await gate.promise;
      w.state.status = "active";
      return HttpResponse.json({ caseId: caseId(N), status: "active" });
    });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: TEXTS.confirm,
    });
    await user.click(confirm);
    await waitFor(() => expect(w.writes).toHaveLength(1));
    const buttons = within(dialog).getAllByRole<HTMLButtonElement>("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons)
      expect(button.disabled, button.textContent ?? "").toBe(true);
    await user.click(confirm);
    expect(w.writes).toHaveLength(1);
    gate.release();
    expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
    expect(w.writes).toHaveLength(1);
  });
});

describe("#150 150-B S-17 再開のダイアログ：失敗の表示（6.6）", () => {
  it("#150 Q8: 409 participants_changed なら、ダイアログを閉じて文言を外に出し、開き直すと取り直した詳細の新しい候補で選べる。次の送信の participantIds は新しい候補", async () => {
    let first = true;
    const w = world(() => {
      if (first) {
        first = false;
        w.state.participants = [...w.state.participants, LATE_JOINER];
        return HttpResponse.json(
          {
            code: "CONFLICT",
            message: TEXTS.participantsChanged,
            reason: "participants_changed",
          },
          { status: 409 },
        );
      }
      w.state.status = "active";
      return HttpResponse.json({ caseId: caseId(N), status: "active" });
    });
    const { user } = renderPage();
    let dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen
          .queryAllByText(TEXTS.participantsChanged)
          .some((element) => !insideDialog(element)),
      ).toBe(true),
    );
    await waitFor(() => expect(w.detailCalls.length).toBeGreaterThanOrEqual(2));

    dialog = await openDialog(user);
    await waitFor(() =>
      expect(checkbox(dialog, LATE_JOINER.displayName).checked).toBe(true),
    );
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
    // 先の失敗の表示は、後の成功で消える
    expect(screen.queryByText(TEXTS.participantsChanged)).toBeNull();
    expect(sortedBody(w.writes[1]?.body).participantIds).toEqual(
      [...ACTIVE_IDS, LATE_JOINER.userId].sort(),
    );
  });

  it("#150 6.6: 409 already_active（ほかの人が先に再開した）なら、ダイアログを閉じて文言を外に出す", async () => {
    const w = world(() => {
      w.state.status = "active";
      return HttpResponse.json(
        {
          code: "CONFLICT",
          message: TEXTS.alreadyActive,
          reason: "already_active",
        },
        { status: 409 },
      );
    });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        screen
          .queryAllByText(TEXTS.alreadyActive)
          .some((element) => !insideDialog(element)),
      ).toBe(true),
    );
    expect(screen.queryByText(TEXTS.reopened)).toBeNull();
  });

  it("#150 6.6: 422 fields [addUserIds] なら、ダイアログを閉じずに選ぶ段階へ戻り、「社員の検索」の欄のエラーにする（欄の外には出さない）", async () => {
    const w = world(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: TEXTS.targetInvalid,
          fields: ["addUserIds"],
        },
        { status: 422 },
      ),
    );
    respondUserSearch([[NEWCOMER]]);
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await addBySearch(user, dialog, NEWCOMER.displayName);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    await waitFor(() => expect(w.writes).toHaveLength(1));
    const search = await within(dialog).findByRole("textbox", {
      name: SEARCH_LABEL,
    });
    await waitFor(() =>
      expect(search.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(search)).toContain(TEXTS.targetInvalid);
    expect(screen.getByRole("dialog", { name: TEXTS.dialog })).toBeTruthy();
    expect(
      screen
        .queryAllByText(TEXTS.targetInvalid)
        .every((element) => insideDialog(element)),
    ).toBe(true);
  });

  it("#150 6.6: 422 の欄のエラーが出た後に「キャンセル」で閉じて開き直すと、前のエラーの表示（欄・ダイアログ全体）が残っていない", async () => {
    world(() =>
      HttpResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: TEXTS.targetInvalid,
          fields: ["addUserIds"],
        },
        { status: 422 },
      ),
    );
    respondUserSearch([[NEWCOMER]]);
    const { user } = renderPage();
    let dialog = await openDialog(user);
    await addBySearch(user, dialog, NEWCOMER.displayName);
    await user.click(within(dialog).getByRole("button", { name: TEXTS.next }));
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.confirm }),
    );
    const search = await within(dialog).findByRole("textbox", {
      name: SEARCH_LABEL,
    });
    await waitFor(() =>
      expect(search.getAttribute("aria-invalid")).toBe("true"),
    );
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.cancel }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull(),
    );

    dialog = await openDialog(user);
    const reopened = within(dialog).getByRole("textbox", {
      name: SEARCH_LABEL,
    });
    expect(reopened.getAttribute("aria-invalid")).not.toBe("true");
    expect(describedText(reopened)).not.toContain(TEXTS.targetInvalid);
    expect(screen.queryByText(TEXTS.targetInvalid)).toBeNull();
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

const DETAIL_ERROR = "案件の詳細を取得できませんでした";
const RETRY = "再試行";
const LOADING = "読み込み中です";

describe("#316 AC-1 再開のダイアログ：詳細の取得に失敗したとき", () => {
  it("#316 AC-1: 詳細の取得が失敗（500）したとき、読み込み中のままにせず、失敗の文言（role=alert）と「再試行」を出し、参加者の欄と「確認へ」は出さない", async () => {
    const state = world();
    server.use(
      http.get("/api/cases/:caseId/detail", () =>
        apiErrorResponse(500, "INTERNAL_ERROR", DETAIL_ERROR),
      ),
    );
    const { user } = renderPage();
    const dialog = await openDialog(user);
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(DETAIL_ERROR);
    expect(within(dialog).getByRole("button", { name: RETRY })).toBeTruthy();
    expect(within(dialog).queryByText(LOADING)).toBeNull();
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(
      within(dialog).queryByRole("textbox", { name: SEARCH_LABEL }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: TEXTS.next }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: TEXTS.cancel }),
    ).toBeTruthy();
    expect(state.writes).toEqual([]);
  });

  it("#316 AC-1: 「再試行」で詳細を取り直し、成功したら失敗の文言が消えて、参加者の選び直しの欄が出る", async () => {
    const state = world();
    let fail = true;
    server.use(
      http.get("/api/cases/:caseId/detail", () => {
        state.detailCalls.push(1);
        if (fail) return apiErrorResponse(500, "INTERNAL_ERROR", DETAIL_ERROR);
        return HttpResponse.json(
          caseDetail(N, {
            ...caseSummary(N, { status: "closed" }),
            participants: [SELF, OWNER, ADMIN, MEMBER_A, MEMBER_B, RETIRED],
          }),
        );
      }),
    );
    const { user } = renderPage();
    const dialog = await openDialog(user);
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      DETAIL_ERROR,
    );
    const before = state.detailCalls.length;
    fail = false;
    await user.click(within(dialog).getByRole("button", { name: RETRY }));
    expect(
      await within(dialog).findByRole("checkbox", {
        name: MEMBER_A.displayName,
      }),
    ).toBeTruthy();
    expect(state.detailCalls.length).toBeGreaterThan(before);
    expect(within(dialog).queryByText(DETAIL_ERROR)).toBeNull();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: RETRY })).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: TEXTS.next }),
    ).toBeTruthy();
  });

  it("#316 AC-1: 取得の途中（応答を止めた間）は、これまでどおり「読み込み中です」を出し、失敗の表示は出さない", async () => {
    world();
    const gate = deferred();
    server.use(
      http.get("/api/cases/:caseId/detail", async () => {
        await gate.promise;
        return apiErrorResponse(500, "INTERNAL_ERROR", DETAIL_ERROR);
      }),
    );
    const { user } = renderPage();
    const dialog = await openDialog(user);
    expect((await within(dialog).findByRole("status")).textContent).toContain(
      LOADING,
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: RETRY })).toBeNull();
    gate.release();
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      DETAIL_ERROR,
    );
    expect(within(dialog).queryByText(LOADING)).toBeNull();
  });

  describe("詳細が一度取れた後の取り直し（古い参加者で再開を送らせない）", () => {
    /** 詳細を一度取ってダイアログを開き、そのあとの取り直しの応答を mode で切り替える */
    async function openWithCachedDetail() {
      world();
      const mode: {
        value: "ok" | "fail" | "hold" | "fresh";
        gate: ReturnType<typeof deferred>;
      } = { value: "ok", gate: deferred() };
      server.use(
        http.get("/api/cases/:caseId/detail", async () => {
          if (mode.value === "hold") await mode.gate.promise;
          if (mode.value === "fail")
            return apiErrorResponse(500, "INTERNAL_ERROR", DETAIL_ERROR);
          const participants =
            mode.value === "fresh"
              ? [SELF, OWNER, ADMIN, MEMBER_B, LATE_JOINER]
              : [SELF, OWNER, ADMIN, MEMBER_A, MEMBER_B, RETIRED];
          return HttpResponse.json(
            caseDetail(N, {
              ...caseSummary(N, { status: "closed" }),
              participants,
            }),
          );
        }),
      );
      const { user, client } = renderPage();
      const dialog = await openDialog(user);
      expect(
        await within(dialog).findByRole("checkbox", {
          name: MEMBER_A.displayName,
        }),
      ).toBeTruthy();
      return { user, client, dialog, mode };
    }

    it("#316 AC-1: 詳細が取れた後の取り直しが失敗（500）したとき、失敗の文言（role=alert）と「再試行」を出し、古い参加者のまま「確認へ」を押せない", async () => {
      const { client, dialog, mode } = await openWithCachedDetail();
      mode.value = "fail";
      void client.invalidateQueries({ queryKey: caseKeys.all });
      expect((await within(dialog).findByRole("alert")).textContent).toContain(
        DETAIL_ERROR,
      );
      expect(within(dialog).getByRole("button", { name: RETRY })).toBeTruthy();
      expect(
        within(dialog).queryByRole("button", { name: TEXTS.next }),
      ).toBeNull();
      expect(within(dialog).queryByRole("checkbox")).toBeNull();
    });

    it("#316 AC-1: 取り直しの最中（応答を止めた間）は、読み込み中（role=status）になり、古い参加者のまま「確認へ」を押せない", async () => {
      const { client, dialog, mode } = await openWithCachedDetail();
      mode.value = "hold";
      void client.invalidateQueries({ queryKey: caseKeys.all });
      expect((await within(dialog).findByRole("status")).textContent).toContain(
        LOADING,
      );
      expect(
        within(dialog).queryByRole("button", { name: TEXTS.next }),
      ).toBeNull();
      expect(within(dialog).queryByRole("checkbox")).toBeNull();
      mode.gate.release();
    });

    it("#316 AC-1: 取り直しの失敗の後の「再試行」が成功したら、新しい参加者の一覧（古い一覧と違う中身）で選び直しの欄が出る", async () => {
      const { user, client, dialog, mode } = await openWithCachedDetail();
      mode.value = "fail";
      void client.invalidateQueries({ queryKey: caseKeys.all });
      await within(dialog).findByRole("alert");
      mode.value = "fresh";
      await user.click(within(dialog).getByRole("button", { name: RETRY }));
      expect(
        await within(dialog).findByRole("checkbox", {
          name: LATE_JOINER.displayName,
        }),
      ).toBeTruthy();
      expect(
        within(dialog).queryByRole("checkbox", {
          name: MEMBER_A.displayName,
        }),
      ).toBeNull();
      expect(within(dialog).queryByRole("alert")).toBeNull();
      expect(
        within(dialog).getByRole("button", { name: TEXTS.next }),
      ).toBeTruthy();
    });
  });

  describe("裏の取り直しで、選びかけた内容を消さず、見ていない一覧で送らせない", () => {
    const NEWCOMER_PERSON: CaseParticipant = {
      ...person("NC"),
      userId: NEWCOMER.id,
      displayName: NEWCOMER.displayName,
    };

    async function setup(
      respond?: Parameters<typeof world>[0],
      choose: "none" | "pick" = "pick",
    ) {
      const w = world(respond);
      respondUserSearch([[NEWCOMER]]);
      const { user, client } = renderPage();
      const dialog = await openDialog(user);
      if (choose === "pick") {
        await user.click(checkbox(dialog, MEMBER_A.displayName));
        await addBySearch(user, dialog, NEWCOMER.displayName);
      }
      return { w, user, client, dialog };
    }

    /** 取り直しを起こし、読み込み中を経て、選ぶ段階か確認の段階が戻るまで待つ */
    async function refetchDetail(
      w: ReturnType<typeof world>,
      client: ReturnType<typeof renderPage>["client"],
      dialog: HTMLElement,
    ) {
      const before = w.detailCalls.length;
      void client.invalidateQueries({ queryKey: caseKeys.all });
      await waitFor(() => expect(w.detailCalls.length).toBeGreaterThan(before));
      await waitFor(() =>
        expect(within(dialog).queryByRole("status")).toBeNull(),
      );
    }

    it("#316 AC-1: 一覧が変わらない取り直しの後も、外したチェック・検索語・追加に選んだ人が残り、送る本文は選んだとおり", async () => {
      const { w, user, client, dialog } = await setup();
      await refetchDetail(w, client, dialog);
      expect(checkbox(dialog, MEMBER_A.displayName).checked).toBe(false);
      expect(checkbox(dialog, MEMBER_B.displayName).checked).toBe(true);
      expect(
        within(
          within(dialog).getByRole("list", { name: ADDED_LIST }),
        ).getByText(NEWCOMER.displayName),
      ).toBeTruthy();
      expect(
        within(dialog).getByRole<HTMLInputElement>("textbox", {
          name: SEARCH_LABEL,
        }).value,
      ).toBe("150b");
      await user.click(
        within(dialog).getByRole("button", { name: TEXTS.next }),
      );
      await user.click(
        await within(dialog).findByRole("button", { name: TEXTS.confirm }),
      );
      await waitFor(() => expect(w.writes).toHaveLength(1));
      expect(sortedBody(w.writes[0]?.body)).toEqual({
        participantIds: [...ACTIVE_IDS].sort(),
        addUserIds: [NEWCOMER.id],
        removeUserIds: [MEMBER_A.userId],
      });
    });

    it("#316 AC-1: 確認の段階での取り直しで、一覧が変わらなければ確認の段階のまま戻る", async () => {
      const { w, user, client, dialog } = await setup();
      await user.click(
        within(dialog).getByRole("button", { name: TEXTS.next }),
      );
      expect(
        await within(dialog).findByRole("button", { name: TEXTS.confirm }),
      ).toBeTruthy();
      await refetchDetail(w, client, dialog);
      expect(
        within(dialog).getByRole("button", { name: TEXTS.confirm }),
      ).toBeTruthy();
      expect(regionNames(dialog, TEXTS.leave)).toContain(MEMBER_A.displayName);
      expect(within(dialog).queryByRole("checkbox")).toBeNull();
    });

    it.each([
      {
        name: "1人増えた",
        change: (w: ReturnType<typeof world>) => {
          w.state.participants = [...w.state.participants, LATE_JOINER];
        },
        present: LATE_JOINER.displayName,
        checked: true,
      },
      {
        name: "1人減った",
        change: (w: ReturnType<typeof world>) => {
          w.state.participants = w.state.participants.filter(
            (p) => p.userId !== MEMBER_B.userId,
          );
        },
        absent: MEMBER_B.displayName,
      },
    ])(
      "#316 AC-1: 確認の段階での取り直しで、一覧が変わった（$name）ら、選ぶ段階に戻り、新しい一覧を出す（古い一覧で送れない）",
      async ({ change, present, absent }) => {
        const { w, user, client, dialog } = await setup();
        await user.click(
          within(dialog).getByRole("button", { name: TEXTS.next }),
        );
        expect(
          await within(dialog).findByRole("button", { name: TEXTS.confirm }),
        ).toBeTruthy();
        change(w);
        await refetchDetail(w, client, dialog);
        await waitFor(() =>
          expect(
            within(dialog).queryByRole("button", { name: TEXTS.confirm }),
          ).toBeNull(),
        );
        expect(
          within(dialog).getByRole("button", { name: TEXTS.next }),
        ).toBeTruthy();
        if (present !== undefined)
          expect(checkbox(dialog, present).checked).toBe(true);
        if (absent !== undefined)
          expect(
            within(dialog).queryByRole("checkbox", { name: absent }),
          ).toBeNull();
        // 選びかけた内容は保たれる
        expect(checkbox(dialog, MEMBER_A.displayName).checked).toBe(false);
        expect(w.writes).toEqual([]);
      },
    );

    it("#316 AC-1: 追加に選んだ人が、取り直しですでに参加者になっていたら、送る本文の「足す人」に入らない", async () => {
      const { w, user, client, dialog } = await setup();
      w.state.participants = [...w.state.participants, NEWCOMER_PERSON];
      await refetchDetail(w, client, dialog);
      expect(
        await within(dialog).findByRole("checkbox", {
          name: NEWCOMER.displayName,
        }),
      ).toBeTruthy();
      expect(
        within(dialog).queryByRole("list", { name: ADDED_LIST })?.textContent ??
          "",
      ).not.toContain(NEWCOMER.displayName);
      await user.click(
        within(dialog).getByRole("button", { name: TEXTS.next }),
      );
      await user.click(
        await within(dialog).findByRole("button", { name: TEXTS.confirm }),
      );
      await waitFor(() => expect(w.writes).toHaveLength(1));
      const body = sortedBody(w.writes[0]?.body);
      expect(body.addUserIds).toEqual([]);
      expect(body.participantIds).toContain(NEWCOMER.id);
      expect(body.removeUserIds).toEqual([MEMBER_A.userId]);
    });

    it("#316 AC-1: 再開を送っている間に取り直しが起きても、送信は1回だけ", async () => {
      const gate = deferred();
      const { w, user, client, dialog } = await setup(async () => {
        await gate.promise;
        w.state.status = "active";
        return HttpResponse.json({ caseId: caseId(N), status: "active" });
      }, "none");
      await user.click(
        within(dialog).getByRole("button", { name: TEXTS.next }),
      );
      await user.click(
        await within(dialog).findByRole("button", { name: TEXTS.confirm }),
      );
      await waitFor(() => expect(w.writes).toHaveLength(1));
      const before = w.detailCalls.length;
      void client.invalidateQueries({
        queryKey: caseKeys.detail(TEST_USER.id, caseId(N)),
      });
      await waitFor(() => expect(w.detailCalls.length).toBeGreaterThan(before));
      await waitFor(() =>
        expect(within(dialog).queryByRole("status")).toBeNull(),
      );
      for (const button of within(dialog).queryAllByRole<HTMLButtonElement>(
        "button",
      ))
        expect(button.disabled, button.textContent ?? "").toBe(true);
      expect(w.writes).toHaveLength(1);
      gate.release();
      expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
      expect(w.writes).toHaveLength(1);
    });

    describe("送信中に詳細の取り直しが起きたとき（150-B の設計：送信中は操作を止める）", () => {
      async function sending() {
        const sendGate = deferred();
        const ctx = await setup(async () => {
          await sendGate.promise;
          ctx.w.state.status = "active";
          return HttpResponse.json({ caseId: caseId(N), status: "active" });
        }, "none");
        await ctx.user.click(
          within(ctx.dialog).getByRole("button", { name: TEXTS.next }),
        );
        await ctx.user.click(
          await within(ctx.dialog).findByRole("button", {
            name: TEXTS.confirm,
          }),
        );
        await waitFor(() => expect(ctx.w.writes).toHaveLength(1));
        return { ...ctx, sendGate };
      }

      const cancelButton = (dialog: HTMLElement) =>
        within(dialog).getByRole<HTMLButtonElement>("button", {
          name: TEXTS.cancel,
        });

      it("#316 AC-1: 送信中の取り直しの最中（応答を止めた間）は、「キャンセル」が無効で、押してもダイアログが閉じない", async () => {
        const { user, client, dialog, w, sendGate } = await sending();
        const detailGate = deferred();
        server.use(
          http.get("/api/cases/:caseId/detail", async () => {
            await detailGate.promise;
            return apiErrorResponse(500, "INTERNAL_ERROR", DETAIL_ERROR);
          }),
        );
        void client.invalidateQueries({
          queryKey: caseKeys.detail(TEST_USER.id, caseId(N)),
        });
        expect(
          (await within(dialog).findByRole("status")).textContent,
        ).toContain(LOADING);
        expect(cancelButton(dialog).disabled).toBe(true);
        await user.click(cancelButton(dialog));
        expect(screen.getByRole("dialog", { name: TEXTS.dialog })).toBeTruthy();
        detailGate.release();
        sendGate.release();
        expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
        expect(w.writes).toHaveLength(1);
      });

      it("#316 AC-1: 送信中の取り直しが失敗した後も、「キャンセル」と「再試行」が無効で、再開の応答を返すと書き込みは1回で成功の表示になる", async () => {
        const { user, client, dialog, w, sendGate } = await sending();
        server.use(
          http.get("/api/cases/:caseId/detail", () =>
            apiErrorResponse(500, "INTERNAL_ERROR", DETAIL_ERROR),
          ),
        );
        void client.invalidateQueries({
          queryKey: caseKeys.detail(TEST_USER.id, caseId(N)),
        });
        expect(
          (await within(dialog).findByRole("alert")).textContent,
        ).toContain(DETAIL_ERROR);
        expect(
          within(dialog).getByRole<HTMLButtonElement>("button", {
            name: RETRY,
          }).disabled,
        ).toBe(true);
        expect(cancelButton(dialog).disabled).toBe(true);
        await user.click(cancelButton(dialog));
        expect(screen.getByRole("dialog", { name: TEXTS.dialog })).toBeTruthy();
        sendGate.release();
        expect(await screen.findByText(TEXTS.reopened)).toBeTruthy();
        expect(w.writes).toHaveLength(1);
      });
    });
  });
});
