// #134 AC-1（1-3 AC-4）: メッセージの削除の確認のダイアログ（DeleteMessageDialog）の開閉と Esc。API は MSW。データは架空。
// 契約（計画 plan-134 の「8. 画面」：確認ダイアログは WithdrawDialog と同じ形・送信中は押せない）：
//   <DeleteMessageDialog roomId messageId onClose />。表示されたらネイティブの <dialog> を showModal() で開き、外れる（アンマウント）ときに close() する。
//   Esc（dialog の cancel イベント）は、ブラウザの既定の閉じる動きを止め（preventDefault）、送信中でなければ onClose を呼ぶ。
//   送信中は onClose を呼ばず、ダイアログを開いたままにする（送信の結果・失敗の文を出す場所を残す）。
// jsdom には showModal がないため、テストの共通処理（test/setup.ts）のスタブ（open 属性を付け外しする）の範囲で確かめる。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROOM_ID,
  apiErrorResponse,
  message,
} from "../../../test/message-handlers";
import { server } from "../../../test/server";
import { authKeys } from "../../auth";
import { ReauthProvider } from "../../auth/ReauthProvider";
import { DeleteMessageDialog } from "./DeleteMessageDialog";

const MESSAGE_ID = message(1).id;

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // 5分以内に再認証済み：再認証のダイアログを出さずに DELETE を送る
  client.setQueryData(authKeys.session, {
    user: {
      id: "01JTESTUSER000000000000001",
      displayName: "testuser_001",
      loginId: "testuser_001",
    },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const onClose = vi.fn();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReauthProvider>
          <DeleteMessageDialog
            roomId={ROOM_ID}
            messageId={MESSAGE_ID}
            onClose={onClose}
          />
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
    name: "メッセージの削除",
  });
  return { ...rendered, dialog, onClose, user: userEvent.setup() };
}

/** Esc を押したときと同じく、止められる cancel イベントを出す。止められたか（defaultPrevented）を返す */
function pressEscape(dialog: HTMLDialogElement): boolean {
  const cancel = new Event("cancel", { cancelable: true });
  act(() => {
    dialog.dispatchEvent(cancel);
    // ブラウザは、止められなかった cancel のあとに dialog を閉じる
    if (!cancel.defaultPrevented) dialog.close();
  });
  return cancel.defaultPrevented;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#134 AC-1（1-3 AC-4）削除の確認のダイアログの開閉", () => {
  it("#134 AC-1（1-3 AC-4）: 表示されたら、ダイアログを showModal で（モーダルとして）開く", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { dialog } = renderDialog();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.contexts[0]).toBe(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("#134 AC-1（1-3 AC-4）: 外れる（アンマウントされる）ときに、ダイアログを close で閉じる", () => {
    const { dialog, unmount } = renderDialog();
    const close = vi.spyOn(dialog, "close");
    unmount();
    expect(close).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("#134 AC-1（1-3 AC-4）: 送信していないときに Esc を押すと、既定の閉じる動きを止めて onClose を1回呼ぶ", () => {
    const { dialog, onClose } = renderDialog();
    const prevented = pressEscape(dialog);
    expect(prevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#134 AC-1（1-3 AC-4）: 削除の送信中に Esc を押しても、onClose を呼ばず、ダイアログを開いたままにする", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deletes: string[] = [];
    server.use(
      http.delete("/api/messages/:messageId", async ({ params }) => {
        deletes.push(String(params.messageId));
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { dialog, onClose, user } = renderDialog();
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "削除する",
    });
    await user.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect(deletes).toEqual([MESSAGE_ID]);

    const prevented = pressEscape(dialog);
    expect(prevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(true);

    release();
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it("#134 AC-1（1-3 AC-4）: 削除が失敗した後（送信中でない）に Esc を押すと、onClose を呼ぶ", async () => {
    server.use(
      http.delete("/api/messages/:messageId", () =>
        apiErrorResponse(
          500,
          "INTERNAL",
          "一時的に削除できませんでした（テスト）",
        ),
      ),
    );
    const { dialog, onClose, user } = renderDialog();
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    await within(dialog).findByRole("alert");
    expect(pressEscape(dialog)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
