// #146（146-A）5-3 AC-1・AC-5〜AC-7・AC-10〜AC-14、5-1 AC-17・AC-19、画面 S-18：案件の作成の申請の画面と、自分の申請の一覧。API は MSW で返す。データはすべて架空。
// 期待値は screens.md の S-18（状態・操作・取引先の選択・件名の整形と警告・件名の注意書き）と計画 A-7 から決める。下書きは case-request-drafts.test.tsx で確かめる。
// 画面の契約（実装者へ。テストが決めたもの）：
//  - pages/CaseRequestPage.tsx が CaseRequestPage を名前付きで出す。見出し（h1）「案件の作成の申請」
//  - 選択欄（combobox）「取引先」：GET /api/clients/candidates の取引先（option の value は取引先の ID）。未選択なら送らず aria-invalid
//  - 入力欄「件名」と、その近くに注意書き（5-3 AC-10 の文言）。空なら送らず aria-invalid
//  - 複数行の入力欄「説明」、日付の入力欄「納期」（ラベルで取る。min は日本時間の今日。今日より前なら送らず aria-invalid。空に戻せる）
//  - 担当部署：group「担当部署」の中に、GET /api/users/departments の部署ごとの checkbox（名前は部署名）。未選択なら送らず group を aria-invalid
//  - 追加の候補：入力欄「候補の検索」に入れると GET /api/users?q= で探し、ボタン「{表示名}を追加」で足す。足した人はボタン「{表示名}を外す」で外す
//  - ボタン「申請する」（送信中は押せない）。送る本文：POST /api/case-requests { clientId, title, description, dueDate?, departmentIds, candidateIds }
//  - 件名と取引先が入って入力が止まったら GET /api/case-requests/similar-title で確かめ、真なら「似た案件があります」。送信は止めない
//  - 成功：「案件の作成を申請しました。承認されると案件が作られます」（role=status）。titleFormatted が真なら「表記を整えて保存しました」も出す
//  - 所属がなく全体管理者でない（permissions に perm.account.create がない）なら「所属部署がないため申請できません」を出し、「申請する」を押せない
//  - 422 の fields は該当の欄を aria-invalid にする。409・403 はサーバーの message を role=alert に出す
//  - 「自分の申請」（見出し h2）：listitem ごとに件名・状態（承認待ち・承認済み・却下・取り下げ・自動取消）・取引先名（無効なら「（無効）」）・担当部署名・納期・却下理由（文字列として）
//    読み込み中は「読み込み中」、0 件は「申請はまだありません」、失敗は role=alert。次のページがあればボタン「次のページ」
//  - 承認待ちの行にだけ「取り下げ」を含むボタン → dialog「申請の取り下げ」→「取り下げる」で POST …/withdraw、「キャンセル」で送らない
//  - 却下・取り下げ・自動取消の行に「修正して再申請」：フォームに元の値を入れ、送るときに resubmitOf を付ける。納期が過去なら納期の欄を aria-invalid にする
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_PERMISSIONS,
  CANDIDATE,
  CLIENT_A,
  CLIENT_B,
  DEPT_DEV,
  DEPT_SALES,
  TEXTS,
  caseRequestItem,
  failPost,
  renderCaseRequestScreen,
  respondChoices,
  respondMyCaseRequestPages,
  respondMyCaseRequests,
  respondProfileDepartment,
  respondSimilar,
} from "../test/case-request-handlers";
import { server } from "../test/server";
import { CaseRequestPage } from "./CaseRequestPage";

const clientSelect = () => screen.findByRole("combobox", { name: "取引先" });
const titleInput = () => screen.getByRole("textbox", { name: "件名" });
const descriptionInput = () => screen.getByRole("textbox", { name: "説明" });
const dueInput = () => screen.getByLabelText<HTMLInputElement>("納期");
const departmentGroup = () => screen.getByRole("group", { name: "担当部署" });
const departmentBox = (name: string) =>
  within(departmentGroup()).findByRole("checkbox", { name });
const submitButton = () => screen.getByRole("button", { name: "申請する" });

function setup(
  options: {
    department?: { id: string; name: string } | null;
    permissions?: string[];
    hasSimilar?: boolean;
    titleFormatted?: boolean;
  } = {},
) {
  respondProfileDepartment(
    options.department === undefined ? DEPT_SALES : options.department,
  );
  respondChoices();
  const similar = respondSimilar(options.hasSimilar ?? false);
  const mine = respondMyCaseRequests([], {
    titleFormatted: options.titleFormatted ?? false,
  });
  const rendered = renderCaseRequestScreen(<CaseRequestPage />, {
    permissions: options.permissions ?? [],
  });
  return { ...rendered, ...mine, similar };
}

/** 必須の欄（取引先・件名・担当部署）を入れる */
async function fillRequired(
  user: ReturnType<typeof setup>["user"],
  title = "[UNIT_TEST]保守契約",
) {
  await user.selectOptions(await clientSelect(), CLIENT_A.id);
  // user.type は「[」を特別な記号として読むため、「[[」にして文字として入れる
  await user.type(titleInput(), title.replaceAll("[", "[["));
  await user.click(await departmentBox(DEPT_SALES.name));
}

async function findRow(title: string) {
  const list = await screen.findByRole("heading", {
    level: 2,
    name: "自分の申請",
  });
  const section = list.closest("section") ?? document.body;
  const items = await within(section as HTMLElement).findAllByRole("listitem");
  const found = items.find((item) => item.textContent?.includes(title));
  if (!found) throw new Error(`${title} の行がありません`);
  return found;
}

// 納期の「今日」を固定する（日本時間 2026-11-17）。境界を確かめるテストは、その中で時刻を変える
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("#146 S-18 申請のフォーム", () => {
  it("#146 5-3 AC-1・AC-5・AC-11: 取引先・件名・説明・納期・担当部署（複数）・候補を入れて申請すると、決めた本文を1回送り、完了のメッセージを出し、再読込なしで自分の申請に出る", async () => {
    const { user, sent } = setup();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "案件の作成の申請",
      }),
    ).toBeTruthy();
    await user.selectOptions(await clientSelect(), CLIENT_A.id);
    await user.type(titleInput(), "[[UNIT_TEST]保守契約");
    await user.type(descriptionInput(), "テストの説明");
    fireEvent.change(dueInput(), { target: { value: "2026-12-01" } });
    await user.click(await departmentBox(DEPT_SALES.name));
    await user.click(await departmentBox(DEPT_DEV.name));
    await user.type(
      screen.getByRole("textbox", { name: "候補の検索" }),
      "casereq",
    );
    await user.click(
      await screen.findByRole("button", {
        name: `${CANDIDATE.displayName}を追加`,
      }),
    );
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      clientId: CLIENT_A.id,
      title: "[UNIT_TEST]保守契約",
      description: "テストの説明",
      dueDate: "2026-12-01",
      departmentIds: [DEPT_SALES.id, DEPT_DEV.id],
      candidateIds: [CANDIDATE.id],
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      TEXTS.submitted,
    );
    expect((await findRow("[UNIT_TEST]保守契約")).textContent).toContain(
      "承認待ち",
    );
  });

  it("#146 5-3 AC-10: 件名の欄の近くに注意書きを出す", async () => {
    setup();
    await clientSelect();
    expect(screen.getByText(TEXTS.caution)).toBeTruthy();
  });

  it("#146 5-3 AC-11・C-117: 取引先の選択肢は候補の API の取引先だけ（無効な取引先は API が返さない）", async () => {
    setup();
    const select = await clientSelect();
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => (o as HTMLOptionElement).value)
          .filter((v) => v !== ""),
      ).toEqual([CLIENT_A.id, CLIENT_B.id]),
    );
  });

  it("#146 5-3 AC-14: 件名と取引先を入れると類似件名を確かめ、似ていれば「似た案件があります」を出す。それでも申請できる", async () => {
    const { user, sent, similar } = setup({ hasSimilar: true });
    await fillRequired(user);
    expect(await screen.findByText(TEXTS.similar)).toBeTruthy();
    const last = similar.queries.at(-1);
    expect(last?.get("clientId")).toBe(CLIENT_A.id);
    expect(last?.get("title")).toBe("[UNIT_TEST]保守契約");
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("#146 5-3 AC-14: 似ていなければ警告を出さない", async () => {
    const { user, similar } = setup({ hasSimilar: false });
    await fillRequired(user);
    await waitFor(() => expect(similar.queries.length).toBeGreaterThan(0));
    expect(screen.queryByText(TEXTS.similar)).toBeNull();
  });

  it("#146 5-3 AC-13: 送信の後、titleFormatted が真なら「表記を整えて保存しました」を出す", async () => {
    const { user } = setup({ titleFormatted: true });
    await fillRequired(user, "　ＡＢＣ　保守");
    await user.click(submitButton());
    expect(await screen.findByText(TEXTS.formatted)).toBeTruthy();
  });

  it("#146 5-3 AC-13: titleFormatted が偽なら「表記を整えて保存しました」を出さない", async () => {
    const { user } = setup({ titleFormatted: false });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByText(TEXTS.submitted);
    expect(screen.queryByText(TEXTS.formatted)).toBeNull();
  });

  it("#146 S-18: 取引先が未選択なら送らず、取引先の欄を入力エラーにする", async () => {
    const { user, sent } = setup();
    await clientSelect();
    await user.type(titleInput(), "[[UNIT_TEST]件名");
    await user.click(await departmentBox(DEPT_SALES.name));
    await user.click(submitButton());
    await waitFor(async () =>
      expect((await clientSelect()).getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#146 S-18・5-3 AC-12: 件名が空なら送らず、件名の欄を入力エラーにする", async () => {
    const { user, sent } = setup();
    await user.selectOptions(await clientSelect(), CLIENT_A.id);
    await user.click(await departmentBox(DEPT_SALES.name));
    fireEvent.change(titleInput(), { target: { value: "　 " } });
    await user.click(submitButton());
    await waitFor(() =>
      expect(titleInput().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#146 5-3 AC-12: 件名が整形の後に101文字なら送らず、件名の欄を入力エラーにする", async () => {
    const { user, sent } = setup();
    await user.selectOptions(await clientSelect(), CLIENT_A.id);
    await user.click(await departmentBox(DEPT_SALES.name));
    fireEvent.change(titleInput(), {
      target: { value: `${"Ａ".repeat(50)} ${"Ｂ".repeat(50)}` },
    });
    await user.click(submitButton());
    await waitFor(() =>
      expect(titleInput().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#146 5-3 AC-12: 説明が2001文字なら送らず、説明の欄を入力エラーにする", async () => {
    const { user, sent } = setup();
    await fillRequired(user);
    fireEvent.change(descriptionInput(), {
      target: { value: "あ".repeat(2001) },
    });
    await user.click(submitButton());
    await waitFor(() =>
      expect(descriptionInput().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#146 S-18・5-3 AC-1: 担当部署が未選択なら送らず、担当部署を入力エラーにする", async () => {
    const { user, sent } = setup();
    await user.selectOptions(await clientSelect(), CLIENT_A.id);
    await user.type(titleInput(), "[[UNIT_TEST]件名");
    await departmentBox(DEPT_SALES.name);
    await user.click(submitButton());
    await waitFor(() =>
      expect(departmentGroup().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#146 5-1 AC-17・C-125: 納期の欄の下限は日本時間の今日（UTC ではまだ前日の時刻でも）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T15:30:00.000Z"));
    setup();
    await clientSelect();
    expect(dueInput().min).toBe("2026-11-17");
  });

  it("#146 5-1 AC-17: 納期が今日より前なら送らず、納期の欄を入力エラーにする。空に戻せば送れる（納期なし）", async () => {
    const { user, sent } = setup();
    await fillRequired(user);
    fireEvent.change(dueInput(), { target: { value: "2026-11-16" } });
    await user.click(submitButton());
    await waitFor(() =>
      expect(dueInput().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
    fireEvent.change(dueInput(), { target: { value: "" } });
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).not.toHaveProperty("dueDate");
  });

  it("#146 5-3 AC-5: 足した候補は「{表示名}を外す」で外せ、外した人は送らない", async () => {
    const { user, sent } = setup();
    await fillRequired(user);
    await user.type(
      screen.getByRole("textbox", { name: "候補の検索" }),
      "casereq",
    );
    await user.click(
      await screen.findByRole("button", {
        name: `${CANDIDATE.displayName}を追加`,
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: `${CANDIDATE.displayName}を外す`,
      }),
    );
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ candidateIds: [] });
  });

  it("#146 frontend-state: 送信中は「申請する」を押せない", async () => {
    const { user } = setup();
    server.use(
      http.post("/api/case-requests", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    await fillRequired(user);
    await user.click(submitButton());
    await waitFor(() =>
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it("#146 5-3 AC-1: 所属がなく全体管理者でなければ「所属部署がないため申請できません」を出し、申請できない", async () => {
    const { user, sent } = setup({ department: null, permissions: [] });
    expect(await screen.findByText(TEXTS.noDepartment)).toBeTruthy();
    await waitFor(() =>
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true),
    );
    await user.click(submitButton());
    expect(sent).toEqual([]);
  });

  it("#146 5-3 AC-1: 所属のない全体管理者は申請できる（所属なしの案内を出さない）", async () => {
    const { user, sent } = setup({
      department: null,
      permissions: ADMIN_PERMISSIONS,
    });
    await fillRequired(user);
    expect(screen.queryByText(TEXTS.noDepartment)).toBeNull();
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it.each([
    ["clientId", () => clientSelect()],
    ["title", async () => titleInput()],
    ["dueDate", async () => dueInput()],
    [
      "candidateIds",
      async () => screen.getByRole("textbox", { name: "候補の検索" }),
    ],
  ] as const)(
    "#146 error-api: サーバーの 422 の fields（%s）は、該当の欄を入力エラーにする",
    async (field, element) => {
      const { user } = setup();
      failPost("/api/case-requests", 422, {
        code: "VALIDATION_ERROR",
        message: "入力内容を確かめてください",
        fields: [field],
      });
      await fillRequired(user);
      await user.click(submitButton());
      await waitFor(async () =>
        expect((await element()).getAttribute("aria-invalid")).toBe("true"),
      );
    },
  );

  it("#146 error-api: サーバーの 422 の fields（departmentIds）は、担当部署を入力エラーにする", async () => {
    const { user } = setup();
    failPost("/api/case-requests", 422, {
      code: "VALIDATION_ERROR",
      message: "入力内容を確かめてください",
      fields: ["departmentIds"],
    });
    await fillRequired(user);
    await user.click(submitButton());
    await waitFor(() =>
      expect(departmentGroup().getAttribute("aria-invalid")).toBe("true"),
    );
  });

  it.each([
    [409, "CONFLICT", "審査する人が変わりました。もう一度申請してください"],
    [403, "FORBIDDEN", "申請できません"],
  ])(
    "#146 error-api: サーバーの %s はサーバーの message を欄の外（role=alert）に出し、完了のメッセージを出さない",
    async (status, code, message) => {
      const { user } = setup();
      failPost("/api/case-requests", status, { code, message });
      await fillRequired(user);
      await user.click(submitButton());
      expect((await screen.findByRole("alert")).textContent).toContain(message);
      expect(screen.queryByText(TEXTS.submitted)).toBeNull();
    },
  );
});

describe("#146 S-18 自分の申請", () => {
  it("#146 frontend-state: 読み込みが終わるまでは「読み込み中」を出す", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    server.use(
      http.get("/api/case-requests/mine", async () => {
        await delay("infinite");
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderCaseRequestScreen(<CaseRequestPage />);
    expect(await screen.findByText(/読み込み中/)).toBeTruthy();
  });

  it("#146 frontend-state: 0件なら「申請はまだありません」", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondMyCaseRequests([]);
    renderCaseRequestScreen(<CaseRequestPage />);
    expect(await screen.findByText("申請はまだありません")).toBeTruthy();
  });

  it("#146 frontend-state: 一覧の取得に失敗したら role=alert を出す", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    server.use(
      http.get("/api/case-requests/mine", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderCaseRequestScreen(<CaseRequestPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("申請はまだありません")).toBeNull();
  });

  it("#146 5-3 AC-6・AC-7・5-1 AC-19: 状態の表記・取引先名・無効の印「（無効）」・担当部署名・納期・却下理由を出す", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondMyCaseRequests([
      caseRequestItem("P1", {
        title: "[UNIT_TEST]審査中",
        dueDate: "2026-12-01",
        departments: [
          { ...DEPT_SALES, isActive: true },
          { ...DEPT_DEV, isActive: true },
        ],
      }),
      caseRequestItem("R1", {
        title: "[UNIT_TEST]却下",
        status: "rejected",
        rejectReason: "テストの却下理由",
        decidedAt: "2026-11-17T04:00:00.000Z",
      }),
      caseRequestItem("W1", {
        title: "[UNIT_TEST]取下",
        status: "withdrawn",
        decidedAt: "2026-11-17T04:00:00.000Z",
      }),
      caseRequestItem("A1", {
        title: "[UNIT_TEST]承認",
        status: "approved",
        caseId: "01JTESTCASEREQCASE0000001",
      }),
      caseRequestItem("I1", {
        title: "[UNIT_TEST]無効な取引先",
        client: { ...CLIENT_A, isActive: false },
      }),
    ]);
    renderCaseRequestScreen(<CaseRequestPage />);
    const pending = await findRow("[UNIT_TEST]審査中");
    expect(pending.textContent).toContain("承認待ち");
    expect(pending.textContent).toContain(CLIENT_A.name);
    expect(pending.textContent).not.toContain("（無効）");
    expect(pending.textContent).toContain(DEPT_SALES.name);
    expect(pending.textContent).toContain(DEPT_DEV.name);
    expect(pending.textContent).toContain("2026-12-01");
    const rejected = await findRow("[UNIT_TEST]却下");
    expect(rejected.textContent).toContain("却下");
    expect(rejected.textContent).toContain("テストの却下理由");
    expect((await findRow("[UNIT_TEST]取下")).textContent).toContain(
      "取り下げ",
    );
    expect((await findRow("[UNIT_TEST]承認")).textContent).toContain(
      "承認済み",
    );
    expect((await findRow("[UNIT_TEST]無効な取引先")).textContent).toContain(
      `${CLIENT_A.name}（無効）`,
    );
  });

  it("#146 5-3 AC-8・AC-6（統括の決定）: 自動取消（auto_cancelled）の行は「自動取消」と表記し、「修正して再申請」を出し、「取り下げ」のボタンは出さない", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondMyCaseRequests([
      caseRequestItem("C1", {
        title: "[UNIT_TEST]自動取消",
        status: "auto_cancelled",
        decidedAt: "2026-11-17T04:00:00.000Z",
      }),
    ]);
    renderCaseRequestScreen(<CaseRequestPage />);
    const row = await findRow("[UNIT_TEST]自動取消");
    expect(row.textContent).toContain("自動取消");
    expect(
      within(row).queryByRole("button", { name: /^取り下げ|取り下げる/ }),
    ).toBeNull();
    expect(
      within(row).getByRole("button", { name: "修正して再申請" }),
    ).toBeTruthy();
  });

  it("#146 security: 却下理由は HTML として解釈せず、文字列として出す", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondMyCaseRequests([
      caseRequestItem("R2", {
        title: "[UNIT_TEST]HTML",
        status: "rejected",
        rejectReason: "<img src=x onerror=alert(1)><b>太字</b>",
        decidedAt: "2026-11-17T04:00:00.000Z",
      }),
    ]);
    renderCaseRequestScreen(<CaseRequestPage />);
    const row = await findRow("[UNIT_TEST]HTML");
    expect(row.textContent).toContain(
      "<img src=x onerror=alert(1)><b>太字</b>",
    );
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("b")).toBeNull();
  });

  it("#146 frontend-state: 次のページがあれば「次のページ」で続きを読み込む", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    const { cursors } = respondMyCaseRequestPages([
      [caseRequestItem("PG2", { title: "[UNIT_TEST]1ページ目" })],
      [caseRequestItem("PG1", { title: "[UNIT_TEST]2ページ目" })],
    ]);
    const { user } = renderCaseRequestScreen(<CaseRequestPage />);
    await findRow("[UNIT_TEST]1ページ目");
    await user.click(await screen.findByRole("button", { name: "次のページ" }));
    await findRow("[UNIT_TEST]2ページ目");
    expect(cursors).toEqual([null, "page-1"]);
  });
});

describe("#146 5-3 AC-7 取り下げ", () => {
  const withdrawButton = (row: HTMLElement) =>
    within(row).queryByRole("button", { name: /取り下げ/ });

  function setupList() {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    const mine = respondMyCaseRequests([
      caseRequestItem("P1", { title: "[UNIT_TEST]審査中" }),
      caseRequestItem("R1", {
        title: "[UNIT_TEST]却下",
        status: "rejected",
        rejectReason: "理由",
        decidedAt: "2026-11-17T04:00:00.000Z",
      }),
    ]);
    const rendered = renderCaseRequestScreen(<CaseRequestPage />);
    return { ...rendered, ...mine };
  }

  it("#146 5-3 AC-7: 取り下げのボタンは承認待ちの行にだけ出る", async () => {
    setupList();
    expect(withdrawButton(await findRow("[UNIT_TEST]審査中"))).not.toBeNull();
    expect(withdrawButton(await findRow("[UNIT_TEST]却下"))).toBeNull();
  });

  it("#146 5-3 AC-7: 確認のダイアログで「取り下げる」を押すと1回だけ送り、再読込なしで「取り下げ」に変わる", async () => {
    const { user, sent } = setupList();
    const row = await findRow("[UNIT_TEST]審査中");
    const button = withdrawButton(row);
    if (button === null) throw new Error("取り下げのボタンがありません");
    await user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: "申請の取り下げ",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "取り下げる" }),
    );
    await waitFor(async () =>
      expect((await findRow("[UNIT_TEST]審査中")).textContent).toContain(
        "取り下げ",
      ),
    );
    await waitFor(async () =>
      expect(withdrawButton(await findRow("[UNIT_TEST]審査中"))).toBeNull(),
    );
    expect(sent.filter((s) => s.path.endsWith("/withdraw"))).toHaveLength(1);
  });

  it("#146 5-3 AC-7: 「キャンセル」なら送らずにダイアログを閉じる", async () => {
    const { user, sent } = setupList();
    const button = withdrawButton(await findRow("[UNIT_TEST]審査中"));
    if (button === null) throw new Error("取り下げのボタンがありません");
    await user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: "申請の取り下げ",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "申請の取り下げ" }),
      ).toBeNull(),
    );
    expect(sent).toEqual([]);
  });

  it("#146 5-3 AC-7: 409 はサーバーの文言を出し、一覧を取り直す", async () => {
    const { user, listCalls } = setupList();
    failPost("/api/case-requests/:requestId/withdraw", 409, {
      code: "CONFLICT",
      message: TEXTS.decided,
    });
    const button = withdrawButton(await findRow("[UNIT_TEST]審査中"));
    if (button === null) throw new Error("取り下げのボタンがありません");
    const before = listCalls();
    await user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: "申請の取り下げ",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "取り下げる" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      TEXTS.decided,
    );
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });
});

describe("#146 5-3 AC-6 修正して再申請", () => {
  it("#146 5-3 AC-6: 却下の行の「修正して再申請」でフォームに元の値が入り、送ると resubmitOf を付ける", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondSimilar(false);
    const original = caseRequestItem("R1", {
      title: "[UNIT_TEST]元の件名",
      description: "元の説明",
      dueDate: "2026-12-01",
      status: "rejected",
      rejectReason: "理由",
      departments: [{ ...DEPT_DEV, isActive: true }],
      decidedAt: "2026-11-17T04:00:00.000Z",
    });
    const { sent } = respondMyCaseRequests([original]);
    const { user } = renderCaseRequestScreen(<CaseRequestPage />);
    const row = await findRow("[UNIT_TEST]元の件名");
    await user.click(
      within(row).getByRole("button", { name: "修正して再申請" }),
    );
    await waitFor(() =>
      expect((titleInput() as HTMLInputElement).value).toBe(
        "[UNIT_TEST]元の件名",
      ),
    );
    expect((descriptionInput() as HTMLTextAreaElement).value).toBe("元の説明");
    expect(dueInput().value).toBe("2026-12-01");
    expect(await clientSelect()).toHaveProperty("value", CLIENT_A.id);
    expect(
      ((await departmentBox(DEPT_DEV.name)) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      ((await departmentBox(DEPT_SALES.name)) as HTMLInputElement).checked,
    ).toBe(false);
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({
      resubmitOf: original.id,
      title: "[UNIT_TEST]元の件名",
      departmentIds: [DEPT_DEV.id],
    });
  });

  it("#146 C-141(2): 元の納期が過去なら、再申請のフォームで納期の欄を入力エラーにし、送らない", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondSimilar(false);
    const { sent } = respondMyCaseRequests([
      caseRequestItem("W1", {
        title: "[UNIT_TEST]過去の納期",
        dueDate: "2026-11-01",
        status: "withdrawn",
        decidedAt: "2026-11-10T00:00:00.000Z",
      }),
    ]);
    const { user } = renderCaseRequestScreen(<CaseRequestPage />);
    const row = await findRow("[UNIT_TEST]過去の納期");
    await user.click(
      within(row).getByRole("button", { name: "修正して再申請" }),
    );
    await waitFor(() =>
      expect(dueInput().getAttribute("aria-invalid")).toBe("true"),
    );
    await user.click(submitButton());
    expect(sent).toEqual([]);
  });

  it("#146 5-3 AC-6: 承認待ち・承認済みの行には「修正して再申請」を出さない", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondChoices();
    respondMyCaseRequests([
      caseRequestItem("P1", { title: "[UNIT_TEST]審査中" }),
      caseRequestItem("A1", {
        title: "[UNIT_TEST]承認",
        status: "approved",
        caseId: "01JTESTCASEREQCASE0000001",
      }),
    ]);
    renderCaseRequestScreen(<CaseRequestPage />);
    for (const title of ["[UNIT_TEST]審査中", "[UNIT_TEST]承認"])
      expect(
        within(await findRow(title)).queryByRole("button", {
          name: "修正して再申請",
        }),
      ).toBeNull();
  });
});
