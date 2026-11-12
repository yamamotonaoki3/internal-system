// #131 AC-1・AC-6・AC-12・AC-13・AC-15（2-2 AC-1・AC-6・AC-12・AC-13、画面 S-10）：チャンネル作成の申請の画面。API は MSW で返す。データはすべて架空。
// 画面の契約（実装者へ。テストが決めたもの）：
//  - pages/ChannelRequestPage.tsx が ChannelRequestPage を名前付きで出す。見出し（h1）「チャンネル作成の申請」
//  - フォーム：選択欄（combobox）「作る場所」（選択肢「自部署のチャンネル」= department・「会社直属のチャンネル」= company。所属なしは「自部署のチャンネル」を選べない＝disabled）、
//    選択欄「公開範囲」（「公開」= public・「非公開」= private）、入力欄「チャンネル名」、複数行の入力欄「説明」、ボタン「申請する」（送信中は押せない）
//    所属の有無は GET /api/me/profile の department で決める（自部署名は出さない）
//  - AC-12 の案内：「非公開をおすすめします」と「案件の作成が承認されると自動でできる非公開の専用チャンネル」を含む文
//  - 送る本文：POST /api/channel-requests { scope, name, description, visibility }。名前は shared の規則（整形 → 1〜50 文字 → 文字種）、説明は 500 文字まで。違反は送らずに欄を aria-invalid にする
//  - サーバーの 422 の fields は該当の欄に出す（aria-invalid）。409 などはサーバーの message を role=alert に出す
//  - 「自分の申請」（見出し h2）：listitem ごとに名前と状態（承認待ち・承認済み・却下・取り下げ）。却下は理由を文字列として出す（HTML として解釈しない）
//    読み込み中は「読み込み中」、0 件は「申請はまだありません」、失敗は role=alert
//  - 承認待ちの行にだけ、名前に「取り下げ」を含むボタン。押すとダイアログ「申請の取り下げ」→「取り下げる」で POST /api/channel-requests/:id/withdraw、「キャンセル」で送らない
//    送信中は「取り下げる」を押せない。409 は「すでに処理されています」を出して一覧を取り直す。成功したら再読込なしで一覧が変わる
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { describe, expect, it } from "vitest";
import {
  DEPT_SALES,
  SERVER_MESSAGES,
  failPost,
  myRequest,
  renderChannelRequestScreen,
  respondMyRequests,
  respondProfileDepartment,
} from "../test/channel-request-handlers";
import { server } from "../test/server";
import { ChannelRequestPage } from "./ChannelRequestPage";

function renderPage() {
  return renderChannelRequestScreen(<ChannelRequestPage />, {
    at: "/channel-requests",
    path: "/channel-requests",
    permissions: [],
  });
}

const placeSelect = () => screen.findByRole("combobox", { name: "作る場所" });
const visibilitySelect = () =>
  screen.getByRole("combobox", { name: "公開範囲" });
const nameInput = () => screen.getByRole("textbox", { name: "チャンネル名" });
const descriptionInput = () => screen.getByRole("textbox", { name: "説明" });
const submitButton = () => screen.getByRole("button", { name: "申請する" });

async function findRow(name: string) {
  const items = await screen.findAllByRole("listitem");
  const found = items.find((item) => item.textContent?.includes(name));
  if (!found) throw new Error(`${name} の行がありません`);
  return found;
}

describe("#131 AC-1・AC-12（S-10）申請のフォーム", () => {
  it("#131 AC-1（2-2 AC-1）: 自部署・非公開を選んで申請すると、決めた本文を 1 回送り、再読込なしで「自分の申請」に承認待ちで出る", async () => {
    respondProfileDepartment(DEPT_SALES);
    const { sent } = respondMyRequests();
    const { user } = renderPage();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "チャンネル作成の申請",
      }),
    ).toBeTruthy();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "非公開");
    await user.type(nameInput(), "UNIT_TEST_営業共有");
    await user.type(descriptionInput(), "テストの説明");
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      scope: "department",
      name: "UNIT_TEST_営業共有",
      description: "テストの説明",
      visibility: "private",
    });
    const row = await findRow("UNIT_TEST_営業共有");
    expect(row.textContent).toContain("承認待ち");
  });

  it("#131 AC-1（2-2 AC-1・AC-10）: 会社直属・公開を選ぶと scope: company・visibility: public を送る", async () => {
    respondProfileDepartment(DEPT_SALES);
    const { sent } = respondMyRequests();
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "会社直属のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_全社共有");
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({
      scope: "company",
      name: "UNIT_TEST_全社共有",
      visibility: "public",
    });
  });

  it("#131 AC-1（2-2 AC-1）: 所属のない社員は「自部署のチャンネル」を選べず、会社直属で申請する", async () => {
    respondProfileDepartment(null);
    const { sent } = respondMyRequests();
    const { user } = renderPage();
    const select = await placeSelect();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("option", {
            name: "自部署のチャンネル",
          }) as HTMLOptionElement
        ).disabled,
      ).toBe(true),
    );
    expect(
      (
        screen.getByRole("option", {
          name: "会社直属のチャンネル",
        }) as HTMLOptionElement
      ).disabled,
    ).toBe(false);
    await user.selectOptions(select, "会社直属のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_所属なし");
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ scope: "company" });
  });

  it("#131 AC-1（2-2 AC-1・C-105）: 他部署を選ぶ手段はない（作る場所の選択肢は 2 つだけ）", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests();
    renderPage();
    const select = await placeSelect();
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["自部署のチャンネル", "会社直属のチャンネル"]);
  });

  it("#131 AC-12（2-2 AC-12）: 案件の話題は非公開をおすすめする案内と、案件の専用チャンネルの案内を出す。公開も選べる", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests();
    renderPage();
    await placeSelect();
    expect(screen.getByText(/非公開をおすすめします/)).toBeTruthy();
    expect(
      screen.getByText(
        /案件の作成が承認されると自動でできる非公開の専用チャンネル/,
      ),
    ).toBeTruthy();
    const options = within(visibilitySelect())
      .getAllByRole("option")
      .map((o) => [o.textContent, (o as HTMLOptionElement).disabled]);
    expect(options).toEqual([
      ["公開", false],
      ["非公開", false],
    ]);
  });

  it.each([
    ["空", ""],
    ["途中に空白", "UNIT_TEST_営業 共有"],
    ["記号", "UNIT_TEST_営業!"],
    ["角かっこ", "[UNIT_TEST]営業"],
    ["51 文字", `UNIT_TEST_${"a".repeat(41)}`],
  ])(
    "#131 AC-13（2-2 AC-13）: 名前が%sなら送らずに、名前の欄を入力エラーにする",
    async (_label, name) => {
      respondProfileDepartment(DEPT_SALES);
      const { sent } = respondMyRequests();
      const { user } = renderPage();
      await user.selectOptions(await placeSelect(), "自部署のチャンネル");
      await user.selectOptions(visibilitySelect(), "公開");
      fireEvent.change(nameInput(), { target: { value: name } });
      await user.click(submitButton());
      await waitFor(() =>
        expect(nameInput().getAttribute("aria-invalid")).toBe("true"),
      );
      expect(sent).toEqual([]);
    },
  );

  it("#131 AC-13（2-2 AC-13）: 説明が 501 文字なら送らずに、説明の欄を入力エラーにする", async () => {
    respondProfileDepartment(DEPT_SALES);
    const { sent } = respondMyRequests();
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_説明");
    fireEvent.change(descriptionInput(), {
      target: { value: "あ".repeat(501) },
    });
    await user.click(submitButton());
    await waitFor(() =>
      expect(descriptionInput().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(sent).toEqual([]);
  });

  it("#131 AC-13（C-121）: 全角で入力した名前も送れる（サーバーと同じ規則で整える）", async () => {
    respondProfileDepartment(DEPT_SALES);
    const { sent } = respondMyRequests();
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    fireEvent.change(nameInput(), {
      target: { value: "ＵＮＩＴ＿ＴＥＳＴ＿ＥＩＧＹＯ－１" },
    });
    await user.click(submitButton());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ name: "UNIT_TEST_EIGYO-1" });
  });

  it("#131 AC-13: サーバーの 422 の fields（name）は名前の欄に出し、一覧に足さない", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests();
    failPost("/api/channel-requests", 422, {
      code: "VALIDATION_ERROR",
      message: "入力内容を確かめてください",
      fields: ["name"],
    });
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_サーバー検証");
    await user.click(submitButton());
    await waitFor(() =>
      expect(nameInput().getAttribute("aria-invalid")).toBe("true"),
    );
    expect(
      screen
        .queryAllByRole("listitem")
        .some((item) => item.textContent?.includes("UNIT_TEST_サーバー検証")),
    ).toBe(false);
  });

  it("#131 AC-13（コードレビューの指摘）: サーバーの 422 の fields.name のメッセージは、名前の欄（aria-describedby で結んだ場所）に表示する", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests();
    failPost("/api/channel-requests", 422, {
      code: "VALIDATION_ERROR",
      message: "テストのサーバー検証メッセージ",
      fields: ["name"],
    });
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_サーバー文言");
    await user.click(submitButton());
    await waitFor(() =>
      expect(nameInput().getAttribute("aria-invalid")).toBe("true"),
    );
    const describedBy = (nameInput().getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((id) => id !== "");
    const described = describedBy
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("テストのサーバー検証メッセージ");
    // 説明の欄はエラーにしない（fields にない欄）
    expect(descriptionInput().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("#131 AC-13: 名前の重複（409）はサーバーの文言を表示し、成功として扱わない", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests();
    failPost("/api/channel-requests", 409, {
      code: "CONFLICT",
      message: SERVER_MESSAGES.createConflict,
    });
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_重複");
    await user.click(submitButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      SERVER_MESSAGES.createConflict,
    );
    expect(await screen.findByText("申請はまだありません")).toBeTruthy();
  });

  it("#131 AC-1（frontend-state）: 送信中は「申請する」を押せない", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post("/api/channel-requests", async () => {
        calls += 1;
        await gate;
        return HttpResponse.json(myRequest("SLOW"), { status: 201 });
      }),
    );
    const { user } = renderPage();
    await user.selectOptions(await placeSelect(), "自部署のチャンネル");
    await user.selectOptions(visibilitySelect(), "公開");
    await user.type(nameInput(), "UNIT_TEST_送信中");
    await user.click(submitButton());
    await waitFor(() =>
      expect(submitButton().hasAttribute("disabled")).toBe(true),
    );
    await user.click(submitButton());
    expect(calls).toBe(1);
    release();
    await waitFor(() =>
      expect(submitButton().hasAttribute("disabled")).toBe(false),
    );
  });
});

describe("#131 AC-6（2-2 AC-5・AC-6・S-10）自分の申請", () => {
  it("#131 AC-6: 状態ごとの表記（承認待ち・承認済み・却下・取り下げ）と、却下の理由を出す", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests([
      myRequest("1", { name: "UNIT_TEST_待ち" }),
      myRequest("2", {
        name: "UNIT_TEST_済み",
        status: "approved",
        channelId: "01JTESTCHREQROOM00000001",
      }),
      myRequest("3", {
        name: "UNIT_TEST_却下",
        status: "rejected",
        rejectReason: "名前を見直してください",
      }),
      myRequest("4", { name: "UNIT_TEST_取下", status: "withdrawn" }),
    ]);
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 2, name: "自分の申請" }),
    ).toBeTruthy();
    expect((await findRow("UNIT_TEST_待ち")).textContent).toContain("承認待ち");
    expect((await findRow("UNIT_TEST_済み")).textContent).toContain("承認済み");
    const rejected = await findRow("UNIT_TEST_却下");
    expect(rejected.textContent).toContain("却下");
    expect(rejected.textContent).toContain("名前を見直してください");
    expect((await findRow("UNIT_TEST_取下")).textContent).toContain("取り下げ");
  });

  it("#131 AC-6（2-2 AC-6）: 却下の理由のスクリプトは実行されず、文字列のまま出る", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests([
      myRequest("1", {
        name: "UNIT_TEST_XSS",
        status: "rejected",
        rejectReason: '<script>alert(1)</script><img src=x onerror="alert(2)">',
      }),
    ]);
    const { container } = renderPage();
    const row = await findRow("UNIT_TEST_XSS");
    expect(row.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("#131 AC-6（frontend-state）: 読み込み中を出し、0 件なら「申請はまだありません」", async () => {
    respondProfileDepartment(DEPT_SALES);
    server.use(
      http.get("/api/channel-requests/mine", async () => {
        await delay(50);
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    renderPage();
    expect(await screen.findByText(/読み込み中/)).toBeTruthy();
    expect(await screen.findByText("申請はまだありません")).toBeTruthy();
  });

  it("#131 AC-6（frontend-state）: 一覧の取得に失敗したら role=alert を出し、空の一覧として表示しない", async () => {
    respondProfileDepartment(DEPT_SALES);
    server.use(
      http.get("/api/channel-requests/mine", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "取得できません" },
          { status: 500 },
        ),
      ),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("申請はまだありません")).toBeNull();
  });
});

describe("#131 AC-15（取り下げ・S-10）", () => {
  const withdrawButtonIn = (row: HTMLElement) =>
    within(row).queryByRole("button", { name: /取り下げ/ });

  it("#131 AC-15: 取り下げのボタンは承認待ちの行にだけ出る", async () => {
    respondProfileDepartment(DEPT_SALES);
    respondMyRequests([
      myRequest("1", { name: "UNIT_TEST_待ち" }),
      myRequest("2", { name: "UNIT_TEST_済み", status: "approved" }),
      myRequest("3", {
        name: "UNIT_TEST_却下",
        status: "rejected",
        rejectReason: "理由",
      }),
      myRequest("4", { name: "UNIT_TEST_取下", status: "withdrawn" }),
    ]);
    renderPage();
    expect(withdrawButtonIn(await findRow("UNIT_TEST_待ち"))).not.toBeNull();
    for (const name of ["UNIT_TEST_済み", "UNIT_TEST_却下", "UNIT_TEST_取下"])
      expect(withdrawButtonIn(await findRow(name)), name).toBeNull();
  });

  it("#131 AC-15: 確認のダイアログで「取り下げる」を押すと 1 回だけ送り、再読込なしで「取り下げ」に変わる", async () => {
    respondProfileDepartment(DEPT_SALES);
    const pending = myRequest("1", { name: "UNIT_TEST_待ち" });
    const { sent } = respondMyRequests([pending]);
    const { user } = renderPage();
    const row = await findRow("UNIT_TEST_待ち");
    await user.click(withdrawButtonIn(row) as HTMLElement);
    const dialog = await screen.findByRole("dialog", {
      name: "申請の取り下げ",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "取り下げる" }),
    );
    await waitFor(async () =>
      expect((await findRow("UNIT_TEST_待ち")).textContent).toContain(
        "取り下げ",
      ),
    );
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/api/channel-requests/${pending.id}/withdraw`,
        body: null,
      },
    ]);
    expect(withdrawButtonIn(await findRow("UNIT_TEST_待ち"))).toBeNull();
  });

  it("#131 AC-15: ダイアログで「キャンセル」を押すと送らない", async () => {
    respondProfileDepartment(DEPT_SALES);
    const { sent } = respondMyRequests([
      myRequest("1", { name: "UNIT_TEST_待ち" }),
    ]);
    const { user } = renderPage();
    await user.click(
      withdrawButtonIn(await findRow("UNIT_TEST_待ち")) as HTMLElement,
    );
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
    expect((await findRow("UNIT_TEST_待ち")).textContent).toContain("承認待ち");
  });

  it("#131 AC-15（frontend-state）: 送信中は「取り下げる」を押せない", async () => {
    respondProfileDepartment(DEPT_SALES);
    const pending = myRequest("1", { name: "UNIT_TEST_待ち" });
    respondMyRequests([pending]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post("/api/channel-requests/:requestId/withdraw", async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({
          requestId: pending.id,
          status: "withdrawn",
        });
      }),
    );
    const { user } = renderPage();
    await user.click(
      withdrawButtonIn(await findRow("UNIT_TEST_待ち")) as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "申請の取り下げ",
    });
    const confirm = within(dialog).getByRole("button", { name: "取り下げる" });
    await user.click(confirm);
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(true));
    await user.click(confirm);
    expect(calls).toBe(1);
    release();
  });

  it("#131 AC-15: すでに処理された申請（409）は「すでに処理されています」を出し、一覧を取り直す", async () => {
    respondProfileDepartment(DEPT_SALES);
    const { listCalls } = respondMyRequests([
      myRequest("1", { name: "UNIT_TEST_待ち" }),
    ]);
    failPost("/api/channel-requests/:requestId/withdraw", 409, {
      code: "CONFLICT",
      message: SERVER_MESSAGES.decided,
    });
    const { user } = renderPage();
    await user.click(
      withdrawButtonIn(await findRow("UNIT_TEST_待ち")) as HTMLElement,
    );
    const before = listCalls();
    const dialog = await screen.findByRole("dialog", {
      name: "申請の取り下げ",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "取り下げる" }),
    );
    expect(await screen.findByText(/すでに処理されています/)).toBeTruthy();
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });
});
