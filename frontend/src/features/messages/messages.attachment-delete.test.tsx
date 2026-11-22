// #270（270-A）AC-8（1-6 AC-4）：部屋のメッセージ（RoomMessages。S-05・S-06・S-17）での、自分の添付の削除。API は MSW。データは架空。
// 契約（計画 4.9。実装前の仮置き。名前・文言はこのテストが決める）：
//   canModifyOwn が真で、ログイン中の利用者が投稿者の、削除されていない投稿の各添付に、名前「〈ファイル名〉を削除」のボタンを出す。
//   他人の投稿・削除済みの投稿・canModifyOwn が偽のときは出さない。
//   押すと確認のダイアログ（role=dialog・名前「添付の削除」。ファイル名を含み、「削除する」「キャンセル」）を出す。
//   「削除する」で再認証（auth の useReauth().withReauth。理由「添付の削除」）を経て DELETE /api/attachments/:attachmentId を1回送る。
//   キャンセル（確認・再認証のどちらでも）では送らず、表示も変えない。送信中は「削除する」を押せない。
//   成功したら、再読み込みなしで、その添付だけが一覧から消え、同じ投稿のほかの添付と本文は残る。
//   失敗したら、ダイアログの中の role=alert にサーバーの文を出し、表示を変えない。
// 期待値は要件・計画から書く。データは架空（testuser_・[E2E_TEST]・example.com）。
import { screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD } from "../../test/auth-handlers";
import {
  respondAttachmentDeletes,
  respondReauthentication,
} from "../../test/attachment-delete-handlers";
import { uploadedId } from "../../test/attachment-handlers";
import {
  ROOM_ID,
  message,
  respondMessages,
  type TestAttachment,
} from "../../test/message-handlers";
import {
  SELF,
  newClient,
  renderInApp,
  respondSelf,
} from "../../test/thread-harness";
import { authKeys } from "../auth";
import { RoomMessages } from "./index";

const OTHER = { id: "01JTESTUSER000000000000002", displayName: "testuser_002" };
const doc = (n: number, name: string): TestAttachment => ({
  id: uploadedId(n),
  name,
  kind: "document",
  contentType: "application/pdf",
  size: 10,
});
const TARGET = doc(1, "[E2E_TEST]消す見積.pdf");
const KEPT = doc(2, "[E2E_TEST]残す資料.pdf");
const deleteButtonName = (name: string) => `${name}を削除`;

function render(
  options: { canModifyOwn?: boolean; reauthenticatedAt?: string | null } = {},
) {
  respondSelf();
  const client = newClient();
  if (options.reauthenticatedAt !== undefined)
    client.setQueryData(authKeys.session, {
      user: SELF,
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: options.reauthenticatedAt,
    });
  return renderInApp(
    <RoomMessages
      roomId={ROOM_ID}
      canPost
      joined
      canModifyOwn={options.canModifyOwn ?? true}
    />,
    { client },
  );
}

const mineWith = (attachments: TestAttachment[], n = 1) =>
  message(n, { body: `[E2E_TEST]添付つき${n}`, attachments });

async function openDialog(
  user: ReturnType<typeof renderInApp>["user"],
  name = TARGET.name,
) {
  await user.click(
    await screen.findByRole("button", { name: deleteButtonName(name) }),
  );
  return screen.findByRole("dialog", { name: "添付の削除" });
}

describe("#270 AC-8 削除のボタンは、自分の投稿の添付にだけ出す", () => {
  it("#270 AC-8: 自分の投稿の各添付に「〈名前〉を削除」を出し、他人の投稿の添付には出さない", async () => {
    respondMessages([
      mineWith([TARGET, KEPT], 1),
      message(2, {
        author: OTHER,
        body: "[E2E_TEST]他人の投稿",
        attachments: [doc(3, "[E2E_TEST]他人の添付.pdf")],
      }),
    ]);
    render();
    expect(
      await screen.findByRole("button", {
        name: deleteButtonName(TARGET.name),
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: deleteButtonName(KEPT.name) }),
    ).toBeTruthy();
    await screen.findByRole("link", { name: "[E2E_TEST]他人の添付.pdf" });
    expect(
      screen.queryByRole("button", {
        name: deleteButtonName("[E2E_TEST]他人の添付.pdf"),
      }),
    ).toBeNull();
  });

  it("#270 AC-8: canModifyOwn が偽なら、自分の投稿の添付にも出さない", async () => {
    respondMessages([mineWith([TARGET])]);
    render({ canModifyOwn: false });
    await screen.findByRole("link", { name: TARGET.name });
    expect(
      screen.queryByRole("button", { name: deleteButtonName(TARGET.name) }),
    ).toBeNull();
  });
});

describe("#270 AC-8 確認 → 再認証 → 送信", () => {
  it("#270 AC-8: 確認のダイアログにファイル名を出し、キャンセルでは送らず、表示も変えない", async () => {
    respondMessages([mineWith([TARGET])]);
    const api = respondAttachmentDeletes();
    const { user } = render();
    const dialog = await openDialog(user);
    expect(dialog.textContent).toContain(TARGET.name);
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "添付の削除" })).toBeNull(),
    );
    expect(api.deletes).toEqual([]);
    expect(screen.getByRole("link", { name: TARGET.name })).toBeTruthy();
  });

  it("#270 AC-8・AC-3: 再認証していなければ再認証を求め、パスワードを入れると DELETE を1回送り、再読み込みなしで、その添付だけが消える", async () => {
    const server = respondMessages([mineWith([TARGET, KEPT])]);
    const api = respondAttachmentDeletes();
    const passwords = respondReauthentication();
    const { user } = render({ reauthenticatedAt: null });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    expect(api.deletes).toEqual([]);
    await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));
    await waitFor(() => expect(api.deletes).toEqual([TARGET.id]));
    expect(passwords).toEqual([TEST_PASSWORD]);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: TARGET.name })).toBeNull(),
    );
    expect(screen.getByRole("link", { name: KEPT.name })).toBeTruthy();
    expect(screen.getByText("[E2E_TEST]添付つき1")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "添付の削除" })).toBeNull(),
    );
    // 一覧の取り直し（after なし）を2回目に送っていない＝その場で反映した
    expect(
      server.requests.filter((url) => !url.searchParams.has("after")),
    ).toHaveLength(1);
  });

  it("#270 AC-3: 再認証をキャンセルすると、DELETE を送らず、表示も変えない", async () => {
    respondMessages([mineWith([TARGET])]);
    const api = respondAttachmentDeletes();
    respondReauthentication();
    const { user } = render({ reauthenticatedAt: null });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    expect(api.deletes).toEqual([]);
    expect(screen.getByRole("link", { name: TARGET.name })).toBeTruthy();
  });

  it("#270 AC-8: 5分以内に再認証していれば、再認証を出さずに送る", async () => {
    respondMessages([mineWith([TARGET])]);
    const api = respondAttachmentDeletes();
    const passwords = respondReauthentication();
    const { user } = render();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(api.deletes).toEqual([TARGET.id]));
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    expect(passwords).toEqual([]);
  });

  it("#270 AC-8: 送信中は「削除する」を押せず、続けて押しても二重に送らない", async () => {
    respondMessages([mineWith([TARGET])]);
    const api = respondAttachmentDeletes();
    api.hold = true;
    const { user } = render();
    const dialog = await openDialog(user);
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "削除する",
    });
    await user.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    api.release();
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: TARGET.name })).toBeNull(),
    );
    expect(api.deletes).toEqual([TARGET.id]);
  });

  it.each([
    [404, "NOT_FOUND", "添付が見つかりません（テスト）"],
    [409, "CONFLICT", "状態が変わりました（テスト）"],
    [403, "FORBIDDEN", "この添付は削除できません（テスト）"],
    [500, "INTERNAL", "一時的に削除できませんでした（テスト）"],
  ])(
    "#270 AC-8: 削除が %i で失敗したら、ダイアログの中の role=alert にサーバーの文を出し、添付の表示を変えない",
    async (status, code, text) => {
      respondMessages([mineWith([TARGET])]);
      const api = respondAttachmentDeletes();
      api.failWith = { status, code, message: text };
      const { user } = render();
      const dialog = await openDialog(user);
      await user.click(
        within(dialog).getByRole("button", { name: "削除する" }),
      );
      const alert = await within(dialog).findByRole("alert");
      expect(alert.textContent).toContain(text);
      expect(screen.getByRole("link", { name: TARGET.name })).toBeTruthy();
    },
  );
});

// ---- #270（270-B）AC-11・利用者の決定2：本文のない投稿の最後の添付の「削除」は、再認証へ進まずに案内だけを出す ----
// 根拠：決定2（断って「投稿ごと削除してください」と案内する）・計画 AC-6・AC-11・2.10（本文のない投稿で見える添付が1件なら、ダイアログは確認・再認証の代わりに
//   AC-6 の案内の文と「閉じる」だけを出す。画面の判定は表示の補助で、正はサーバーの 409。すれ違いで 409 が返れば、その文をダイアログの中に出す）。
// ダイアログの名前は、いまの「添付の削除」のまま（計画は新しい名前を決めていない）。
describe("#270 AC-11 本文のない投稿の最後の添付", () => {
  const LAST_ATTACHMENT_MESSAGE =
    "本文のない投稿の、最後の添付は削除できません。投稿ごと削除してください。";
  const bodylessWith = (attachments: TestAttachment[]) =>
    message(1, { body: "", attachments });

  it("#270 AC-11（決定2）: 本文なし＋添付1件の「削除」は、案内の文と「閉じる」だけを出し、「削除する」・再認証を出さず、DELETE を送らない", async () => {
    respondMessages([bodylessWith([TARGET])]);
    const api = respondAttachmentDeletes();
    const passwords = respondReauthentication();
    const { user } = render({ reauthenticatedAt: null });
    const dialog = await openDialog(user);
    expect(dialog.textContent).toContain(LAST_ATTACHMENT_MESSAGE);
    expect(within(dialog).getByRole("button", { name: "閉じる" })).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: "削除する" }),
    ).toBeNull();
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "添付の削除" })).toBeNull(),
    );
    expect(api.deletes).toEqual([]);
    expect(passwords).toEqual([]);
    expect(screen.getByRole("link", { name: TARGET.name })).toBeTruthy();
  });

  it("#270 AC-11: 本文なし＋添付2件なら、これまでどおり確認（「削除する」）を出し、送れる", async () => {
    respondMessages([bodylessWith([TARGET, KEPT])]);
    const api = respondAttachmentDeletes();
    const { user } = render();
    const dialog = await openDialog(user);
    expect(dialog.textContent).not.toContain(LAST_ATTACHMENT_MESSAGE);
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(api.deletes).toEqual([TARGET.id]));
  });

  it("#270 AC-11（正はサーバー）: 画面では2件に見えても、サーバーが AC-6 の 409 を返したら、その文をダイアログの中の role=alert に出し、表示を変えない", async () => {
    respondMessages([bodylessWith([TARGET, KEPT])]);
    const api = respondAttachmentDeletes();
    api.failWith = {
      status: 409,
      code: "CONFLICT",
      message: LAST_ATTACHMENT_MESSAGE,
    };
    const { user } = render();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(LAST_ATTACHMENT_MESSAGE);
    expect(screen.getByRole("link", { name: TARGET.name })).toBeTruthy();
  });

  it("#270 AC-11（対照）: 本文のある投稿の最後の1件は、これまでどおり確認（「削除する」）を出す", async () => {
    respondMessages([mineWith([TARGET])]);
    respondAttachmentDeletes();
    const { user } = render();
    const dialog = await openDialog(user);
    expect(
      within(dialog).getByRole("button", { name: "削除する" }),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain(LAST_ATTACHMENT_MESSAGE);
  });
});
