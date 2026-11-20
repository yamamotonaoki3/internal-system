// #150（150-C）5-1 AC-20、画面 S-17 の「内容を編集」のダイアログ（CaseEditDialog）。API は MSW で返す。データはすべて架空（testuser_150c_・[UNIT_TEST]）。
// この層で確かめるもの（計画 150-C 4.6・6章の「AC-1 画面」の行）：
//   - ボタンの出し分け：進行中で、有効な参加者か canManage のときだけ（表示の制御。認可はサーバー）。参加者は詳細が取れるまで押せない
//   - 参加者：初期値は詳細の件名・説明・取引先・担当部署。送る本文は「変えた項目だけ」と詳細の version
//   - 非参加の管理者：説明の欄がなく、送る本文は「変えた項目だけ」と、概要で見た件名・取引先・担当部署の expected（version を送らない）
//   - 「（無効）」：いまの取引先・部署が無効でも、印を付けて選ばれたまま残る。件名だけを直すときは取引先・部署を送らない（C-140(4)・Q1＝A）
//   - 何も変えていなければ「保存」を押せない。類似の警告（excludeCaseId に案件の ID）を出すが保存は止めない（C-122(6)）
//   - 結果：成功は閉じて外に「案件の内容を保存しました」（整形したら「表記を整えて保存しました」も）。422 は欄、409・403 は閉じて外
//   - 送信中は押せない（二重送信の防止）。入力を変えている間は離れる前の確認（beforeunload）。成功・失敗とも取り直す
// 開いた時点の固定は pages/CaseEdit.snapshot.test.tsx、外されたときは CaseEditAccessLoss.test.tsx、利用者の切り替えは CaseEditSessionSwitch.test.tsx。
// 判定の順・本文の検証はサーバー（backend の routes/cases.edit.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの。既存の「納期を変更」・再開のダイアログ・申請の画面〔S-18〕の型に合わせた）：
//   ボタン「内容を編集」（「納期を変更」と同じ並び）→ ダイアログ（role dialog、名前「案件の内容の編集」）。
//   欄：「件名」（TextField。hint に申請の画面と同じ注意の文）・類似の警告「似た案件があります」・「説明」（TextAreaField。参加者だけ）・
//     「取引先」（SelectField。有効な候補〔GET /api/clients/candidates〕と、いまの取引先が無効なら「{名前}（無効）」）・
//     「担当部署」（fieldset の legend。有効な部署〔GET /api/users/departments〕と、いまの無効な部署を「{名前}（無効）」の checkbox）・
//     案件番号（表示だけ）。ボタン「保存」「キャンセル」。
//   PATCH /api/cases/:caseId。成功の文言はダイアログの外（role status）。
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCaseEdit,
  type CaseDetail,
  type CaseEditWrite,
  type CaseSummary,
} from "../test/case-handlers";
import {
  CLIENT_A,
  CLIENT_B,
  DEPT_DEV,
  DEPT_SALES,
  TEXTS as REQUEST_TEXTS,
  renderCaseRequestScreen,
  respondChoices,
  respondSimilar,
} from "../test/case-request-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

/** user-event の type は「[」「{」をキーの指定として読むため、文字として入力するときは重ねる（既存のテストと同じ書き方） */
const typed = (text: string) => text.replace(/[[{]/g, (c) => c + c);
const TEXTS = {
  open: "内容を編集",
  dialog: "案件の内容の編集",
  save: "保存",
  cancel: "キャンセル",
  saved: "案件の内容を保存しました",
  formatted: "表記を整えて保存しました",
  similar: "似た案件があります",
  inactive: "（無効）",
  stale:
    "ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください",
  descriptionOnly: "説明を変更できるのは参加者だけです",
} as const;

const N = 161;
const TITLE = "[UNIT_TEST]150C画面の件名";
const DESCRIPTION = "[UNIT_TEST]150C画面の説明";
const OLD_CLIENT = {
  id: "01JTESTCASE150CFCL000000FF",
  code: "QZY",
  name: "テスト商事無効150C [UNIT_TEST]",
};
const OLD_DEPT = {
  id: "01JTESTCASE150CFDP000000FF",
  name: "[UNIT_TEST]無効部署150C",
};

type View = "participant" | "manager" | "outsider";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * 進行中の案件の概要・詳細・候補と、再編集の架空の応答。state を変えると取り直しに反映される。
 * respond を省くと、送った項目を state に反映して版を進め、200 を返す
 */
function world(
  options: {
    view?: View;
    status?: "active" | "closed";
    summary?: Partial<CaseSummary>;
    detail?: Partial<CaseDetail>;
    respond?: (write: CaseEditWrite) => Response | Promise<Response>;
    holdDetail?: Promise<void>;
  } = {},
) {
  const view = options.view ?? "participant";
  const state = {
    title: TITLE,
    description: DESCRIPTION,
    version: 1,
    client: { id: CLIENT_A.id, name: CLIENT_A.name, isActive: true },
    departments: [{ id: DEPT_SALES.id, name: DEPT_SALES.name, isActive: true }],
  };
  const summaryOf = (): CaseSummary => {
    const status = options.status ?? "active";
    const base = {
      status,
      canEditDueDate: view !== "outsider" && status === "active",
      title: state.title,
      client: state.client,
      departments: state.departments,
      ...options.summary,
    };
    if (view === "participant") return caseSummary(N, base);
    if (view === "manager")
      return outsiderSummary(N, {
        ...base,
        canManage: true,
        participantCount: 3,
      });
    return outsiderSummary(N, base);
  };
  const detailCalls: number[] = [];
  const summaryCalls: number[] = [];
  server.use(
    http.get("/api/cases/:caseId/detail", async () => {
      detailCalls.push(1);
      if (options.holdDetail !== undefined) await options.holdDetail;
      if (view !== "participant")
        return HttpResponse.json(
          { code: "FORBIDDEN", message: "参加者だけが見られます（非公開）" },
          { status: 403 },
        );
      return HttpResponse.json(
        caseDetail(N, {
          ...summaryOf(),
          description: state.description,
          version: state.version,
          ...options.detail,
        }),
      );
    }),
    http.get("/api/cases/:caseId", () => {
      summaryCalls.push(1);
      return HttpResponse.json(summaryOf());
    }),
  );
  respondChoices();
  const similar = respondSimilar(false);
  const { writes } = respondCaseEdit(async (write) => {
    if (options.respond !== undefined) return options.respond(write);
    const body = write.body as { title?: string; description?: string };
    if (body.title !== undefined) state.title = body.title;
    if (body.description !== undefined) state.description = body.description;
    state.version += 1;
    return HttpResponse.json({ caseId: caseId(N), titleFormatted: false });
  });
  return { state, writes, detailCalls, summaryCalls, similar };
}

function renderPage() {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(N)}`,
    path: "/cases/:caseId",
  });
}

type User = ReturnType<typeof renderPage>["user"];

async function openDialog(user: User) {
  const button = await screen.findByRole("button", { name: TEXTS.open });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(button);
  return screen.findByRole("dialog", { name: TEXTS.dialog });
}

const titleBox = (dialog: HTMLElement) =>
  within(dialog).getByRole<HTMLInputElement>("textbox", { name: /件名/ });
const descriptionBox = (dialog: HTMLElement) =>
  within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: /説明/ });
const clientSelect = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", { name: /取引先/ }) as HTMLElement & {
    value: string;
  };
const departmentBox = (dialog: HTMLElement, name: string) =>
  within(
    within(dialog).getByRole("group", { name: "担当部署" }),
  ).getByRole<HTMLInputElement>("checkbox", { name });
const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole<HTMLButtonElement>("button", { name: TEXTS.save });

/** 入力欄のエラー（aria-describedby で結び付いた文） */
function describedText(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

const insideDialog = (element: HTMLElement) =>
  element.closest("dialog") !== null;

async function replaceTitle(user: User, dialog: HTMLElement, value: string) {
  const box = titleBox(dialog);
  await user.clear(box);
  await user.type(box, typed(value));
}

describe("#150 150-C S-17「内容を編集」の出し分け（計画 4.6・Q2＝A）", () => {
  it("#150 AC-20: 有効な参加者には、進行中の案件で「納期を変更」と並んで出る", async () => {
    world();
    renderPage();
    const button = await screen.findByRole("button", { name: TEXTS.open });
    const dues = screen.getByRole("button", { name: "納期を変更" });
    expect(button.parentElement).toBe(dues.parentElement);
  });

  it("#150 C-122(3): 参加していない管理者（canManage）にも出る", async () => {
    world({ view: "manager" });
    renderPage();
    expect(
      await screen.findByRole("button", { name: TEXTS.open }),
    ).toBeTruthy();
  });

  it("#150 C-122(3): 参加者でも管理者でもない社員には出ない", async () => {
    world({ view: "outsider" });
    renderPage();
    await screen.findByText("参加者だけが見られます（非公開）");
    expect(screen.queryByRole("button", { name: TEXTS.open })).toBeNull();
  });

  it("#150 C-122(4): 終了中の案件では、参加者にも出ない", async () => {
    world({ status: "closed" });
    renderPage();
    await screen.findByRole("button", { name: "案件を再開" });
    expect(screen.queryByRole("button", { name: TEXTS.open })).toBeNull();
  });

  it("#150 4.6・重大3: 参加者は、詳細が取れるまで「内容を編集」を押せない（基準を詳細の応答から作るため）", async () => {
    const hold = deferred();
    world({ holdDetail: hold.promise });
    renderPage();
    const button = await screen.findByRole<HTMLButtonElement>("button", {
      name: TEXTS.open,
    });
    expect(button.disabled).toBe(true);
    hold.release();
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});

describe("#150 150-C 参加者のダイアログ（版の方式）", () => {
  it("#150 AC-20: 初期値は詳細の件名・説明・取引先・担当部署で、案件番号を表示だけで出し、件名に注意の文を添える", async () => {
    world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    expect(titleBox(dialog).value).toBe(TITLE);
    expect(describedText(titleBox(dialog))).toContain(REQUEST_TEXTS.caution);
    expect(descriptionBox(dialog).value).toBe(DESCRIPTION);
    expect(clientSelect(dialog).value).toBe(CLIENT_A.id);
    expect(departmentBox(dialog, DEPT_SALES.name).checked).toBe(true);
    expect(departmentBox(dialog, DEPT_DEV.name).checked).toBe(false);
    expect(within(dialog).getByText(caseSummary(N).caseNumber)).toBeTruthy();
    expect(
      within(dialog).queryByRole("textbox", { name: /案件番号/ }),
    ).toBeNull();
  });

  it("#150 4.6: 何も変えていなければ「保存」を押せない。変えると押せ、元に戻すとまた押せない", async () => {
    world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    expect(saveButton(dialog).disabled).toBe(true);
    await user.type(titleBox(dialog), "追記");
    expect(saveButton(dialog).disabled).toBe(false);
    await replaceTitle(user, dialog, TITLE);
    expect(saveButton(dialog).disabled).toBe(true);
  });

  it("#150 4.6: 件名だけを変えると、本文は { version, title } だけ（説明・取引先・担当部署を送らない）", async () => {
    const { writes } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await replaceTitle(user, dialog, "[UNIT_TEST]150C新しい件名");
    await user.click(saveButton(dialog));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      path: `/api/cases/${caseId(N)}`,
      body: { version: 1, title: "[UNIT_TEST]150C新しい件名" },
    });
  });

  it("#150 4.6: 説明・取引先・担当部署を変えると、その項目だけを送る（説明は空にもできる）", async () => {
    const { writes } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.clear(descriptionBox(dialog));
    await user.selectOptions(clientSelect(dialog), CLIENT_B.id);
    await user.click(departmentBox(dialog, DEPT_DEV.name));
    await user.click(saveButton(dialog));
    await waitFor(() => expect(writes).toHaveLength(1));
    const body = writes[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["clientId", "departmentIds", "description", "version"].sort(),
    );
    expect(body).toMatchObject({
      version: 1,
      description: "",
      clientId: CLIENT_B.id,
    });
    expect([...(body.departmentIds as string[])].sort()).toEqual(
      [DEPT_SALES.id, DEPT_DEV.id].sort(),
    );
  });

  it("#150 C-130(1): 担当部署を0にすると保存できず、欄にエラーを出す（送らない）", async () => {
    const { writes } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(departmentBox(dialog, DEPT_SALES.name));
    await user.click(saveButton(dialog));
    const group = within(dialog).getByRole("group", { name: "担当部署" });
    await waitFor(() =>
      expect(group.getAttribute("aria-invalid")).toBe("true"),
    );
    expect(writes).toEqual([]);
  });

  it("#150 C-140(4)・Q1＝A: いまの取引先・部署が無効でも「（無効）」を付けて選ばれたまま残り、件名だけを直すと取引先・部署を送らない", async () => {
    const { writes } = world({
      summary: {
        client: { id: OLD_CLIENT.id, name: OLD_CLIENT.name, isActive: false },
        departments: [
          { id: OLD_DEPT.id, name: OLD_DEPT.name, isActive: false },
        ],
      },
    });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    const select = clientSelect(dialog);
    expect(select.value).toBe(OLD_CLIENT.id);
    expect(
      within(select).getByRole("option", {
        name: `${OLD_CLIENT.name}${TEXTS.inactive}`,
      }),
    ).toBeTruthy();
    expect(
      departmentBox(dialog, `${OLD_DEPT.name}${TEXTS.inactive}`).checked,
    ).toBe(true);
    await replaceTitle(user, dialog, "[UNIT_TEST]150C直した件名");
    await user.click(saveButton(dialog));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      version: 1,
      title: "[UNIT_TEST]150C直した件名",
    });
  });

  it("#150 C-122(6): 件名を変えると類似件名を確かめ（excludeCaseId に案件の ID）、警告を出すが保存は止めない", async () => {
    const { writes } = world();
    const similar = respondSimilar(true);
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await replaceTitle(user, dialog, "[UNIT_TEST]150C似た件名");
    expect(await within(dialog).findByText(TEXTS.similar)).toBeTruthy();
    const last = similar.queries.at(-1);
    expect(last?.get("excludeCaseId")).toBe(caseId(N));
    expect(last?.get("clientId")).toBe(CLIENT_A.id);
    expect(saveButton(dialog).disabled).toBe(false);
    await user.click(saveButton(dialog));
    await waitFor(() => expect(writes).toHaveLength(1));
  });

  it("#150 C-122(6): 件名も取引先も変えていなければ、類似件名を確かめない", async () => {
    const { similar } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.type(descriptionBox(dialog), "追記");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(similar.queries).toEqual([]);
  });
});

describe("#150 150-C 非参加の管理者のダイアログ（expected の方式。Q3＝C）", () => {
  it("#150 重大7: 説明の欄がない", async () => {
    world({ view: "manager" });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    expect(within(dialog).queryByRole("textbox", { name: /説明/ })).toBeNull();
    expect(titleBox(dialog).value).toBe(TITLE);
  });

  it("#150 Q3＝C・重大4: 件名を変えると、本文は { expected（概要で見た件名・取引先・担当部署）, title } で、version を送らない", async () => {
    const { writes } = world({ view: "manager" });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await replaceTitle(user, dialog, "[UNIT_TEST]150C管理者の件名");
    await user.click(saveButton(dialog));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      expected: {
        title: TITLE,
        clientId: CLIENT_A.id,
        departmentIds: [DEPT_SALES.id],
      },
      title: "[UNIT_TEST]150C管理者の件名",
    });
  });
});

describe("#150 150-C 結果の出し方（計画 4.6）", () => {
  it("#150 4.6: 成功するとダイアログを閉じ、外に「案件の内容を保存しました」。概要・詳細を取り直し、新しい件名が出る", async () => {
    const calls = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    const summaries = calls.summaryCalls.length;
    const details = calls.detailCalls.length;
    await replaceTitle(user, dialog, "[UNIT_TEST]150C保存した件名");
    await user.click(saveButton(dialog));
    const done = await screen.findByText(TEXTS.saved);
    expect(insideDialog(done)).toBe(false);
    expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull();
    await waitFor(() => {
      expect(calls.summaryCalls.length).toBeGreaterThan(summaries);
      expect(calls.detailCalls.length).toBeGreaterThan(details);
    });
    expect(
      await screen.findByRole("heading", { name: /150C保存した件名/ }),
    ).toBeTruthy();
    expect(screen.queryByText(TEXTS.formatted)).toBeNull();
  });

  it("#150 C-122(6): サーバーが整形したら（titleFormatted が真）、「表記を整えて保存しました」も出す", async () => {
    world({
      respond: () =>
        HttpResponse.json({ caseId: caseId(N), titleFormatted: true }),
    });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await replaceTitle(user, dialog, "[UNIT_TEST]１５０Ｃ");
    await user.click(saveButton(dialog));
    expect(await screen.findByText(TEXTS.saved)).toBeTruthy();
    expect(await screen.findByText(TEXTS.formatted)).toBeTruthy();
  });

  it("#150 4.6: 422 の fields（title）は、ダイアログを閉じずに件名の欄に出す", async () => {
    const message = "件名は1〜100文字で入力してください";
    world({
      respond: () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message, fields: ["title"] },
          { status: 422 },
        ),
    });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await replaceTitle(user, dialog, "[UNIT_TEST]150Cサーバーが拒む件名");
    await user.click(saveButton(dialog));
    await waitFor(() =>
      expect(titleBox(dialog).getAttribute("aria-invalid")).toBe("true"),
    );
    expect(describedText(titleBox(dialog))).toContain(message);
    expect(screen.getByRole("dialog", { name: TEXTS.dialog })).toBeTruthy();
  });

  it.each([
    {
      name: "409 stale",
      status: 409,
      body: { code: "CONFLICT", message: TEXTS.stale, reason: "stale" },
    },
    {
      name: "403",
      status: 403,
      body: { code: "FORBIDDEN", message: TEXTS.descriptionOnly },
    },
  ])(
    "#150 4.6: $name はダイアログを閉じ、外に文言を出し、取り直す",
    async ({ status, body }) => {
      const calls = world({
        respond: () => HttpResponse.json(body, { status }),
      });
      const { user } = renderPage();
      const dialog = await openDialog(user);
      const details = calls.detailCalls.length;
      await replaceTitle(user, dialog, "[UNIT_TEST]150C失敗する件名");
      await user.click(saveButton(dialog));
      const alert = await screen.findByText(body.message);
      expect(insideDialog(alert)).toBe(false);
      expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull();
      await waitFor(() =>
        expect(calls.detailCalls.length).toBeGreaterThan(details),
      );
    },
  );

  it("#150 4.6（二重送信の防止）: 送信中は「保存」を押せず、2回押しても1回だけ送る", async () => {
    const hold = deferred();
    const { writes } = world({
      respond: async () => {
        await hold.promise;
        return HttpResponse.json({ caseId: caseId(N), titleFormatted: false });
      },
    });
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await replaceTitle(user, dialog, "[UNIT_TEST]150C一度だけ");
    await user.click(saveButton(dialog));
    await waitFor(() => expect(saveButton(dialog).disabled).toBe(true));
    await user.click(saveButton(dialog));
    hold.release();
    expect(await screen.findByText(TEXTS.saved)).toBeTruthy();
    expect(writes).toHaveLength(1);
  });

  it("#150 4.6（離れる前の確認）: 入力を変えている間は beforeunload を止め、変えていなければ止めない", async () => {
    world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await user.type(titleBox(dialog), "変更");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("#150 4.6: 「キャンセル」で閉じ、何も送らない", async () => {
    const { writes } = world();
    const { user } = renderPage();
    const dialog = await openDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: TEXTS.cancel }),
    );
    expect(screen.queryByRole("dialog", { name: TEXTS.dialog })).toBeNull();
    expect(writes).toEqual([]);
  });
});
