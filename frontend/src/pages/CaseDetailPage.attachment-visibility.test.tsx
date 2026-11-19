// #148（148-B-2）5-2 AC-7・AC-9・D3、画面 S-17：「添付ファイル」の区画の公開範囲の表示と変更（EP-1-23）。API は MSW。データは架空（testuser_148b_・[UNIT_TEST]）。
// 部品（CaseAttachments・CaseAttachmentVisibilityDialog）のテストだが、区画はページの中で組み立てるため、ページを描画して確かめる（features/ の下に置かない）。
// この層で確かめるもの（計画 10章「AC-9 画面」）：各行に公開範囲の名前。「公開範囲を変更」は canChangeVisibility の行だけ。
//   ダイアログで変更 → 送信中は「変更」「キャンセル」とほかの行の「公開範囲を変更」が無効 → 成功で閉じて完了の文、一覧を取り直す。
//   409 はダイアログを閉じ、区画にサーバーの文（role=alert）を出して取り直す（ボタンが消える）。422 はダイアログの中のエラー。
//   失敗の文は次の成功で消え、完了の文は次の変更の開始で消える。キャンセルでは要求を送らない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   行の公開範囲の名前は選択肢と同じ「参加者限定」「全社員公開アーカイブで公開できる」。
//   button「{ファイル名} の公開範囲を変更」。ダイアログは role=dialog・名前「公開範囲を変更」。選択肢は radio（いまの値を選んだ状態）。
//   案内「全社員公開が承認されるまでは、参加者だけが見られます」。button「変更」「キャンセル」。
//   完了の文「公開範囲を変更しました」（role=status、区画の中）。失敗の文は区画の中の role=alert（サーバーの文言のまま）。
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReauthProvider } from "../features/auth/ReauthProvider";
import {
  CASE_ATTACHMENT_TEXTS,
  caseAttachment,
  caseAttachmentName,
  respondCaseAttachments,
} from "../test/case-attachment-handlers";
import {
  caseDetail,
  caseId,
  caseSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { CaseDetailPage } from "./CaseDetailPage";

const LIMITED = "参加者限定";
const PUBLIC = "全社員公開アーカイブで公開できる";
const HINT = "全社員公開が承認されるまでは、参加者だけが見られます";
const DONE = "公開範囲を変更しました";
const N = 62;

function renderPage() {
  const summary = caseSummary(N, { status: "active" });
  respondCases({
    summaries: [summary],
    details: [caseDetail(N, { ...summary })],
  });
  const api = respondCaseAttachments([
    caseAttachment(1, { canChangeVisibility: true }),
    caseAttachment(2, {
      canChangeVisibility: true,
      publicationVisibility: "public_archive",
    }),
    caseAttachment(3, { canChangeVisibility: false }),
  ]);
  const view = renderCaseRequestScreen(
    <ReauthProvider>
      <CaseDetailPage />
    </ReauthProvider>,
    { at: `/cases/${caseId(N)}`, path: "/cases/:caseId" },
  );
  return { ...view, api };
}

type User = ReturnType<typeof renderPage>["user"];

const section = () =>
  screen.findByRole("region", { name: CASE_ATTACHMENT_TEXTS.heading });
const rowOf = (region: HTMLElement, n: number) => {
  const row = within(region)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(caseAttachmentName(n)));
  if (row === undefined) throw new Error(`${n} の行がありません`);
  return row;
};
const changeButton = (region: HTMLElement, n: number) =>
  within(region).queryByRole<HTMLButtonElement>("button", {
    name: `${caseAttachmentName(n)} の公開範囲を変更`,
  });
const dialog = () => screen.findByRole("dialog", { name: "公開範囲を変更" });

async function openAndChoose(
  user: User,
  region: HTMLElement,
  n: number,
  label: string,
) {
  const button = changeButton(region, n);
  if (button === null) throw new Error(`${n} の変更のボタンがありません`);
  await user.click(button);
  const d = await dialog();
  await user.click(within(d).getByRole("radio", { name: label }));
  await user.click(within(d).getByRole("button", { name: "変更" }));
  return d;
}

async function ready() {
  const view = renderPage();
  const region = await section();
  await within(region).findByText(caseAttachmentName(1));
  return { ...view, region };
}

describe("#148 AC-7・AC-9 S-17 公開範囲の表示", () => {
  it("#148 AC-7: 各行に公開範囲の名前を出す", async () => {
    const { region } = await ready();
    expect(rowOf(region, 1).textContent).toContain(LIMITED);
    expect(rowOf(region, 2).textContent).toContain(PUBLIC);
    expect(rowOf(region, 3).textContent).toContain(LIMITED);
  });

  it("#148 AC-9 R-85: 「公開範囲を変更」は、変更できる行（canChangeVisibility）だけに出る", async () => {
    const { region } = await ready();
    expect(changeButton(region, 1)).not.toBeNull();
    expect(changeButton(region, 2)).not.toBeNull();
    expect(changeButton(region, 3)).toBeNull();
  });

  it("#148 AC-9 D3: ダイアログは、いまの値を選んだ状態で、案内を出す。キャンセルでは要求を送らない", async () => {
    const { user, api, region } = await ready();
    await user.click(changeButton(region, 2) as HTMLButtonElement);
    const d = await dialog();
    expect(
      within(d).getByRole<HTMLInputElement>("radio", { name: PUBLIC }).checked,
    ).toBe(true);
    expect(
      within(d).getByRole<HTMLInputElement>("radio", { name: LIMITED }).checked,
    ).toBe(false);
    expect(within(d).getByText(HINT)).toBeTruthy();
    await user.click(within(d).getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.patches).toEqual([]);
  });
});

describe("#148 AC-9 S-17 公開範囲の変更", () => {
  it("#148 AC-9: 送信中は「変更」「キャンセル」とほかの行のボタンが無効。成功で閉じ、完了の文を出し、一覧を取り直して新しい値を出す", async () => {
    const { user, api, region } = await ready();
    api.holdPatch = true;
    const before = api.requests.length;
    const d = await openAndChoose(user, region, 1, PUBLIC);
    await waitFor(() => expect(api.patches).toHaveLength(1));
    expect(api.patches[0]).toEqual({
      attachmentId: caseAttachment(1).id,
      body: { publicationVisibility: "public_archive" },
    });
    expect(
      within(d).getByRole<HTMLButtonElement>("button", { name: "変更" })
        .disabled,
    ).toBe(true);
    expect(
      within(d).getByRole<HTMLButtonElement>("button", { name: "キャンセル" })
        .disabled,
    ).toBe(true);
    expect(changeButton(region, 2)?.disabled).toBe(true);
    api.releasePatch();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await within(region).findByRole("status")).textContent).toContain(
      DONE,
    );
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
    await waitFor(() => expect(rowOf(region, 1).textContent).toContain(PUBLIC));
  });

  it("#148 AC-9: 409 はダイアログを閉じ、区画にサーバーの文を出し、取り直した一覧ではボタンが消える", async () => {
    const { user, api, region } = await ready();
    const closedText = "終了した案件の添付の公開範囲は変更できません";
    api.patchFailWith = { status: 409, code: "CONFLICT", message: closedText };
    api.items = api.items.map((i) => ({ ...i, canChangeVisibility: false }));
    await openAndChoose(user, region, 1, PUBLIC);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await within(region).findByRole("alert")).textContent).toContain(
      closedText,
    );
    await waitFor(() => expect(changeButton(region, 1)).toBeNull());
  });

  it("#148 AC-9: 422 はダイアログの中にエラーを出し、ダイアログは開いたまま", async () => {
    const { user, api, region } = await ready();
    api.patchFailWith = {
      status: 422,
      code: "VALIDATION_ERROR",
      message: "入力内容を確認してください",
      fields: ["publicationVisibility"],
    };
    const d = await openAndChoose(user, region, 1, PUBLIC);
    expect(
      await within(d).findByText(/入力内容を確認してください/),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "公開範囲を変更" })).toBeTruthy();
  });

  it("#148 AC-9 frontend-state: 失敗の文は次の成功で消え、完了の文は次の変更の開始で消える", async () => {
    const { user, api, region } = await ready();
    const failText =
      "状態が変わったため、変更できませんでした。読み込み直してからお試しください";
    api.patchFailWith = { status: 409, code: "CONFLICT", message: failText };
    await openAndChoose(user, region, 1, PUBLIC);
    await within(region).findByText(failText);
    await openAndChoose(user, region, 1, PUBLIC);
    await within(region).findByText(DONE);
    expect(within(region).queryByText(failText)).toBeNull();
    api.holdPatch = true;
    await openAndChoose(user, region, 2, LIMITED);
    await waitFor(() => expect(api.patches).toHaveLength(3));
    expect(within(region).queryByText(DONE)).toBeNull();
    api.releasePatch();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
