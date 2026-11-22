// #270（270-B）AC-11・AC-4：添付だけの投稿の画面（部屋のメッセージ RoomMessages。S-05・S-06・S-17）。API は MSW。データは架空。
// 期待の根拠（実装から写さない）：
//   計画 AC-11：入力欄は、添付を1件以上選んでいれば、本文が空でも送れる（要求の body は空文字・attachmentIds は選んだ添付）。
//     本文も添付もないときは、送らずに入力欄の下に「メッセージを入力してください」を出す（いまの文）。アップロードの途中・送信中は押せない（いまのまま）。
//     編集欄は、添付のある投稿なら本文を消して保存できる（PATCH の body は空文字）。添付のない投稿は、これまでどおり空で保存できない
//   計画 AC-4・2.2 の9：本文のない投稿（API の body が空文字）の行は、本文の段を出さず、添付だけを出す（投稿者・日時は出す）
//   利用者の決定1：画面は目印を知らない（API は空文字で受け渡す）
// 「本文の段」の確かめ方：本文は MessageBody（読み込みの間は whitespace-pre-wrap の段、読み込んだ後は外枠 .markdown-body）で出るため、
//   本文のない行にそのどちらもないことを、本文のある行（対照）に .markdown-body が出た後で確かめる。
// データは架空（testuser_・[E2E_TEST]・example.com）。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  respondAttachments,
  sizedFile,
  uploadedId,
} from "../../test/attachment-handlers";
import {
  ROOM_ID,
  message,
  respondMessages,
  type TestAttachment,
  type TestMessage,
} from "../../test/message-handlers";
import { SELF, renderInApp, respondSelf } from "../../test/thread-harness";
import type { RoomMessage } from "./api/message-api";
import { MessageItem } from "./components/MessageItem";
import { RoomMessages } from "./index";

const BLANK_MESSAGE = "メッセージを入力してください";
const doc = (n: number, name: string): TestAttachment => ({
  id: uploadedId(n),
  name,
  kind: "document",
  contentType: "application/pdf",
  size: 10,
});

function render(initial: TestMessage[] = []) {
  respondSelf();
  const server = respondMessages(initial);
  const api = respondAttachments();
  const view = renderInApp(
    <RoomMessages roomId={ROOM_ID} canPost joined canModifyOwn />,
  );
  return { ...view, server, api };
}

const picker = () => screen.getByLabelText<HTMLInputElement>("ファイルを添付");
const box = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "メッセージ" });
const sendButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "送信" });
const log = () => screen.getByRole("log");
/** メッセージの行（本文の中の箇条書きの li を除く） */
const rows = () =>
  within(log())
    .getAllByRole("listitem")
    .filter((li) => li.parentElement?.closest("li") === null);
async function rowOf(attachmentName: string): Promise<HTMLElement> {
  await screen.findByRole("link", { name: attachmentName });
  const row = rows().find((li) =>
    within(li).queryByRole("link", { name: attachmentName }),
  );
  if (row === undefined)
    throw new Error(`「${attachmentName}」の行がありません`);
  return row;
}
const hasBodySection = (row: HTMLElement) =>
  row.querySelector(".markdown-body") !== null ||
  row.querySelector("p.whitespace-pre-wrap") !== null;

describe("#270 AC-11 入力欄：添付があれば、本文が空でも送れる", () => {
  it("#270 AC-11: 添付を1件選び、本文を空のまま送ると、要求の body は空文字で attachmentIds が1件", async () => {
    const { user, api } = render();
    await user.upload(picker(), sizedFile("[E2E_TEST]添付だけ.pdf", 10));
    await user.click(sendButton());
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.messagePosts[0]?.body).toMatchObject({
      body: "",
      attachmentIds: [uploadedId(1)],
    });
    expect(screen.queryByText(BLANK_MESSAGE)).toBeNull();
  });

  it("#270 AC-11: 添付を選び、本文が空白と改行だけでも送れる（本文の空白は画面が削らずに送り、サーバーが本文なしとして扱う）", async () => {
    const { user, api } = render();
    await user.upload(picker(), sizedFile("[E2E_TEST]空白だけ.pdf", 10));
    fireEvent.change(box(), { target: { value: "  \n " } });
    await user.click(sendButton());
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.messagePosts[0]?.body).toMatchObject({
      attachmentIds: [uploadedId(1)],
    });
  });

  it("#270 AC-11（いまの動き）: 本文も添付もないときは送らず、入力欄の下に「メッセージを入力してください」を出す", async () => {
    const { user, api, server } = render();
    await user.click(sendButton());
    expect(await screen.findByText(BLANK_MESSAGE)).toBeTruthy();
    expect(api.messagePosts).toEqual([]);
    expect(server.posts).toEqual([]);
  });

  it("#270 AC-11: 添付を選んだ後に取り消して、本文も添付もなくなったら、送らずに「メッセージを入力してください」を出す", async () => {
    const { user, api } = render();
    await user.upload(picker(), sizedFile("[E2E_TEST]取り消す.pdf", 10));
    await user.click(
      screen.getByRole("button", { name: "[E2E_TEST]取り消す.pdf を取り消す" }),
    );
    await user.click(sendButton());
    expect(await screen.findByText(BLANK_MESSAGE)).toBeTruthy();
    expect(api.messagePosts).toEqual([]);
  });

  it("#270 AC-11（いまの動き）: 本文が空で添付のアップロードの途中は「送信」を押せない", async () => {
    const { user, api } = render();
    api.holdNames.add("[E2E_TEST]遅い.pdf");
    await user.upload(picker(), sizedFile("[E2E_TEST]遅い.pdf", 10));
    await user.click(sendButton());
    await waitFor(() => expect(api.uploads).toHaveLength(1));
    await waitFor(() => expect(sendButton().disabled).toBe(true));
    expect(api.messagePosts).toEqual([]);
    api.release();
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.messagePosts[0]?.body).toMatchObject({ body: "" });
  });
});

describe("#270 AC-4 本文のない投稿の行は、本文の段を出さず、添付だけを出す", () => {
  it("#270 AC-4: body が空文字の行には本文の段がなく、添付の名前と投稿者が出る（本文のある行には本文の段が出る）", async () => {
    render([
      message(1, {
        body: "[E2E_TEST]本文のある行",
        attachments: [doc(1, "[E2E_TEST]本文あり.pdf")],
      }),
      message(2, {
        body: "",
        attachments: [doc(2, "[E2E_TEST]本文なし.pdf")],
      }),
    ]);
    const withBody = await rowOf("[E2E_TEST]本文あり.pdf");
    await waitFor(() =>
      expect(withBody.querySelector(".markdown-body")).not.toBeNull(),
    );
    const bodyless = await rowOf("[E2E_TEST]本文なし.pdf");
    expect(hasBodySection(bodyless)).toBe(false);
    expect(bodyless.textContent).toContain("テスト太郎");
  });
});

describe("#270 AC-11 編集欄：添付のある投稿は、本文を消して保存できる", () => {
  const mineWith = (body: string, attachments: TestAttachment[]) =>
    message(1, {
      author: { id: SELF.id, displayName: SELF.displayName },
      body,
      attachments,
    });

  async function openEdit(
    user: ReturnType<typeof render>["user"],
    attachmentName: string,
  ) {
    const row = await rowOf(attachmentName);
    await user.click(within(row).getByRole("button", { name: "編集" }));
    return screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージの編集",
    });
  }

  it("#270 AC-11（決定3）: 添付のある自分の投稿で本文を消して保存すると、PATCH の body は空文字で、成功の後の行に本文の段がない", async () => {
    const { user, server } = render([
      mineWith("[E2E_TEST]消す本文", [doc(1, "[E2E_TEST]編集の添付.pdf")]),
    ]);
    const edit = await openEdit(user, "[E2E_TEST]編集の添付.pdf");
    await user.clear(edit);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(server.edits).toEqual([{ messageId: message(1).id, body: "" }]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "メッセージの編集" }),
      ).toBeNull(),
    );
    const row = await rowOf("[E2E_TEST]編集の添付.pdf");
    expect(hasBodySection(row)).toBe(false);
    expect(row.textContent).not.toContain("[E2E_TEST]消す本文");
  });

  it("#270 AC-11（いまの動き）: 添付のない自分の投稿は、本文を消しても保存の要求を送らず、編集欄にエラーを出す", async () => {
    const { user, server } = render([
      message(1, {
        author: { id: SELF.id, displayName: SELF.displayName },
        body: "[E2E_TEST]添付のない本文",
      }),
    ]);
    await screen.findByText("[E2E_TEST]添付のない本文");
    const row = rows().find((li) =>
      (li.textContent ?? "").includes("[E2E_TEST]添付のない本文"),
    );
    if (row === undefined) throw new Error("行がありません");
    await user.click(within(row).getByRole("button", { name: "編集" }));
    const edit = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージの編集",
    });
    await user.clear(edit);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(edit.getAttribute("aria-invalid")).toBe("true"));
    expect(server.edits).toEqual([]);
  });

  it("#270 AC-11: 本文のない自分の投稿（添付1件）の編集欄は空で開き、本文を足して保存できる", async () => {
    const { user, server } = render([
      mineWith("", [doc(1, "[E2E_TEST]本文を足す添付.pdf")]),
    ]);
    const edit = await openEdit(user, "[E2E_TEST]本文を足す添付.pdf");
    expect(edit.value).toBe("");
    await user.type(edit, "[[E2E_TEST]足した本文");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(server.edits).toEqual([
        { messageId: message(1).id, body: "[E2E_TEST]足した本文" },
      ]),
    );
    expect(await screen.findByText("[E2E_TEST]足した本文")).toBeTruthy();
  });
});

// ---- ミューテーションの見逃しの埋め合わせ（MessageItem.tsx の本文の段の「deleted か body が null なら、削除の表示」）----
// 根拠：#134 の契約（deleted が真の項目、削除済みで body が null の項目は、本文の代わりに「このメッセージは削除されました」）・C-205（決定1：本文のない投稿は
//   API の body が空文字。null〔削除済み〕と取り違えない）・計画 AC-4（本文のない投稿の行は、本文の段を出さず添付だけを出す）。
// 既存のテスト（messages.edit-delete.test.tsx の削除済みの行）が変異を見逃した理由：deleted: true と body: null を同時に与えていたため、
//   片方の条件だけでも、両方（&&）でも、同じ表示になっていた。ここでは、2つの条件を1つずつ与え、空文字（添付だけ）とも区別する。
// 片方だけの組み合わせは、API の応答の検証（message-api.ts の refine）が一覧の取得では通さないため、部品（MessageItem）を直接描画して確かめる
//   （部品の守りとして。API の契約は変えない）。
describe("#270 AC-4 削除の表示は、deleted か body が null のときだけ（空文字と取り違えない）", () => {
  const DELETED_TEXT = "このメッセージは削除されました";
  const mine = { id: SELF.id, displayName: SELF.displayName };
  const show = (item: TestMessage) => {
    respondSelf();
    return renderInApp(
      <ul>
        <MessageItem
          message={item as unknown as RoomMessage}
          retired={false}
          canModify
        />
      </ul>,
    );
  };

  it("#270 AC-4: deleted が真なら（body が残っていても）削除の表示を出し、本文も「編集」も出さない", () => {
    const { container } = show(
      message(1, {
        author: mine,
        deleted: true,
        body: "[E2E_TEST]消えたはずの本文",
      }),
    );
    expect(container.textContent).toContain(DELETED_TEXT);
    expect(container.textContent).not.toContain("[E2E_TEST]消えたはずの本文");
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
  });

  it("#270 AC-4: deleted が偽でも、body が null なら削除の表示を出す", () => {
    const { container } = show(
      message(1, { author: mine, deleted: false, body: null }),
    );
    expect(container.textContent).toContain(DELETED_TEXT);
  });

  it("#270 AC-4（C-205）: body が空文字（添付だけの投稿）なら、削除の表示を出さず、添付と「編集」を出す", () => {
    const { container } = show(
      message(1, {
        author: mine,
        body: "",
        attachments: [doc(1, "[E2E_TEST]空文字の添付.pdf")],
      }),
    );
    expect(container.textContent).not.toContain(DELETED_TEXT);
    expect(
      screen.getByRole("link", { name: "[E2E_TEST]空文字の添付.pdf" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "編集" })).toBeTruthy();
  });
});
