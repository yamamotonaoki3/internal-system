// #140 AC-1（1-6 AC-9）・AC-2（1-4 AC-5）: スレッド（S-07。ThreadReplies）の返信欄の添付。API は MSW。データは架空。
// 契約（計画「画面」。部品の形は messages.attachments.test.tsx と同じ）：
//   返信欄にも「ファイルを添付」があり、返信用の入口（POST /api/messages/:親ID/replies/attachments）に1件ずつアップロードし、
//   全部成功してから POST /api/messages/:親ID/replies に attachmentIds を付けて返信する。返信の添付も表示する。
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  recordReplyPosts,
  respondAttachments,
  sizedFile,
  uploadedId,
} from "../../test/attachment-handlers";
import { message, reply, respondReplies } from "../../test/message-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { ThreadReplies } from "./index";

function build() {
  const parent = message(1, { body: "[E2E_TEST]スレッドの親", replyCount: 1 });
  const first = reply(parent, 1, {
    body: "[E2E_TEST]添付つきの返信",
    attachments: [
      {
        id: uploadedId(9),
        name: "返信の資料.pdf",
        kind: "document",
        contentType: "application/pdf",
        size: 10,
      },
    ],
  });
  respondSelf();
  respondReplies({
    parent,
    replies: [first],
    joined: true,
    roomWritable: true,
    replyBlockedReason: null,
  });
  const api = respondAttachments();
  recordReplyPosts(api, parent.id);
  const view = renderInApp(<ThreadReplies parentMessageId={parent.id} />);
  return { ...view, api, parent };
}

describe("#140 AC-2（1-4 AC-5）S-07 の返信の添付", () => {
  it("#140 AC-2（1-4 AC-5）: 返信欄で選んだファイルは返信用の入口にアップロードされ、attachmentIds を付けて返信する", async () => {
    const { user, api, parent } = build();
    await screen.findByText("[E2E_TEST]スレッドの親");
    await user.upload(
      screen.getByLabelText("ファイルを添付"),
      sizedFile("memo.txt", 10),
    );
    await user.type(
      screen.getByRole("textbox", { name: "返信" }),
      "[[E2E_TEST]返信",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.uploads.map((u) => [u.entry, u.targetId, u.name])).toEqual([
      ["reply", parent.id, "memo.txt"],
    ]);
    expect(api.messagePosts[0]).toMatchObject({
      entry: "reply",
      body: { body: "[E2E_TEST]返信", attachmentIds: [uploadedId(1)] },
    });
  });

  it("#140 AC-1（1-6 AC-9）: 返信欄でも上限を超えるファイル（画像10,000,001バイト）は一覧に入れない", async () => {
    const { user } = build();
    await screen.findByText("[E2E_TEST]スレッドの親");
    await user.upload(
      screen.getByLabelText("ファイルを添付"),
      sizedFile("big.png", 10_000_001),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("big.png");
    expect(screen.queryByRole("list", { name: "送信前の添付" })).toBeNull();
  });

  it("#140 AC-2（1-4 AC-5）: 返信の添付をダウンロードのリンクで表示する", async () => {
    build();
    const link = await screen.findByRole("link", { name: /返信の資料\.pdf/ });
    expect(link.getAttribute("href")).toBe(`/api/attachments/${uploadedId(9)}`);
  });
});
