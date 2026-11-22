// #270（270-A）AC-8・AC-3（1-6 AC-4）：添付の削除の確認のダイアログ（DeleteAttachmentDialog）と、添付の表示（MessageAttachments）の部品のテスト。
// ミューテーションで見つかった見逃しを埋める。API は MSW。データは架空（testuser_・[E2E_TEST]）。
// 根拠：設計 docs/design/attachments.md の表（DeleteAttachmentDialog.tsx「作りは DeleteMessageDialog.tsx と同じ。送信中は押せず、閉じない。
//   失敗はダイアログの中に出す」、useDeleteAttachment.ts「再認証が完了しなければ要求を送らず NotSentError にする」、
//   MessageAttachments.tsx「押すと DeleteAttachmentDialog を出す」）、docs/design/channels.md の文言「再認証が完了しなかったため、操作は実行していません」。
// Esc は、前例（DeleteMessageDialog.test.tsx）と同じく、止められる cancel のイベントで再現する（jsdom の showModal は test/setup.ts のスタブ）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  respondAttachmentDeletes,
  respondReauthentication,
} from "../../../test/attachment-delete-handlers";
import { uploadedId } from "../../../test/attachment-handlers";
import { ROOM_ID, message } from "../../../test/message-handlers";
import {
  SELF,
  newClient,
  renderInApp,
  respondSelf,
} from "../../../test/thread-harness";
import { authKeys } from "../../auth";
import type { Attachment } from "../api/message-api";
import { DeleteAttachmentDialog } from "./DeleteAttachmentDialog";
import { MessageAttachments } from "./MessageAttachments";

const ATTACHMENT: Attachment = {
  id: uploadedId(1),
  name: "[E2E_TEST]消す見積.pdf",
  kind: "document",
  contentType: "application/pdf",
  size: 10,
};
const OWNER = {
  roomId: ROOM_ID,
  parentMessageId: null,
  messageId: message(1).id,
};
const NOT_SENT_TEXT = "再認証が完了しなかったため、操作は実行していません";

function renderDialog(options: { reauthenticatedAt?: string | null } = {}) {
  respondSelf();
  const client = newClient();
  if (options.reauthenticatedAt !== undefined)
    client.setQueryData(authKeys.session, {
      user: SELF,
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: options.reauthenticatedAt,
    });
  const onClose = vi.fn();
  const rendered = renderInApp(
    <DeleteAttachmentDialog
      owner={OWNER}
      attachment={ATTACHMENT}
      onClose={onClose}
    />,
    { client },
  );
  const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
    name: "添付の削除",
  });
  return { ...rendered, dialog, onClose };
}

/** Esc を押したときと同じく、止められる cancel イベントを出す。止められたか（defaultPrevented）を返す */
function pressEscape(dialog: HTMLDialogElement): boolean {
  const cancel = new Event("cancel", { cancelable: true });
  act(() => {
    dialog.dispatchEvent(cancel);
    if (!cancel.defaultPrevented) dialog.close();
  });
  return cancel.defaultPrevented;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#270 AC-8 確認のダイアログの Esc", () => {
  it("#270 AC-8: 送信していないときに Esc を押すと、既定の閉じる動きを止めて onClose を1回呼ぶ", () => {
    const { dialog, onClose } = renderDialog();
    expect(pressEscape(dialog)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#270 AC-8: 削除の送信中に Esc を押しても、onClose を呼ばず、ダイアログを開いたままにする", async () => {
    const api = respondAttachmentDeletes();
    api.hold = true;
    const { dialog, onClose, user } = renderDialog();
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "削除する",
    });
    await user.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect(api.deletes).toEqual([ATTACHMENT.id]);

    expect(pressEscape(dialog)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(true);

    api.release();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("#270 AC-3・AC-8 送信の前の失敗と、送信の後の失敗の表示", () => {
  it("#270 AC-3: 再認証を取りやめると、要求を送らず、ダイアログの中に「操作は実行していません」の文を出す", async () => {
    const api = respondAttachmentDeletes();
    respondReauthentication();
    const { dialog, user, onClose } = renderDialog({
      reauthenticatedAt: null,
    });
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(NOT_SENT_TEXT);
    expect(api.deletes).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("#270 AC-8: 送信した後にサーバーが失敗を返すと、サーバーの文を出し、「操作は実行していません」とは出さない", async () => {
    const api = respondAttachmentDeletes();
    api.failWith = {
      status: 500,
      code: "INTERNAL",
      message: "一時的に削除できませんでした（テスト）",
    };
    const { dialog, user, onClose } = renderDialog();
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(
      "一時的に削除できませんでした（テスト）",
    );
    expect(alert.textContent).not.toContain(NOT_SENT_TEXT);
    expect(api.deletes).toEqual([ATTACHMENT.id]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("#270 AC-8 添付の表示（MessageAttachments）", () => {
  it("#270 AC-8: 確認のダイアログは、「〈名前〉を削除」を押すまで出さず、押すと出す", async () => {
    respondSelf();
    const { user } = renderInApp(
      <MessageAttachments attachments={[ATTACHMENT]} owner={OWNER} />,
    );
    expect(screen.getByRole("link", { name: ATTACHMENT.name })).toBeTruthy();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: `${ATTACHMENT.name}を削除` }),
    );
    const dialog = await screen.findByRole("dialog", { name: "添付の削除" });
    expect(dialog.textContent).toContain(ATTACHMENT.name);
  });

  it("#270 AC-8: owner を渡さないとき（削除できないとき）は、削除のボタンも確認のダイアログも出さない", () => {
    renderInApp(<MessageAttachments attachments={[ATTACHMENT]} />);
    expect(screen.getByRole("link", { name: ATTACHMENT.name })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: `${ATTACHMENT.name}を削除` }),
    ).toBeNull();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });
});
