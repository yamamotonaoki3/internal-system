// #148（148-B-2）5-2 AC-8・計画 6.7・6.8：S-35（スレッドの一覧）から開いた案件のスレッドへの返信でも、添付ごとに公開範囲を選べる。
// 返信の取得の応答の caseRoom が真のスレッドだけに出す。通常のチャンネル・DM のスレッド（caseRoom: false）には出さない。
// API は MSW。データは架空（testuser_・[E2E_TEST]）。
// 画面の契約（実装の担当へ。テストが決めたもの）：pages/ThreadsPage.tsx が features/cases の設定を ThreadPane に渡す。
//   選択欄は combobox「{ファイル名} の公開範囲」、案内「全社員公開が承認されるまでは、参加者だけが見られます」。
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  recordReplyPosts,
  respondAttachments,
  sizedFile,
} from "../test/attachment-handlers";
import { message, respondReplies } from "../test/message-handlers";
import { respondMyThreads } from "../test/thread-handlers";
import { renderInApp, respondSelf } from "../test/thread-harness";
import { ThreadsPage } from "./ThreadsPage";

const HINT = "全社員公開が承認されるまでは、参加者だけが見られます";
const PUBLIC = "全社員公開アーカイブで公開できる";

function build(caseRoom: boolean) {
  const parent = message(1, { body: "[E2E_TEST]148b2スレッドの親" });
  respondSelf();
  respondMyThreads([]);
  respondReplies({
    parent,
    replies: [],
    joined: true,
    roomWritable: true,
    replyBlockedReason: null,
    caseRoom,
  });
  const api = respondAttachments();
  recordReplyPosts(api, parent.id);
  const view = renderInApp(<ThreadsPage />, {
    path: `/threads?thread=${parent.id}`,
  });
  return { ...view, api, parent };
}

describe("#148 AC-8 S-35 から案件のスレッドへの返信", () => {
  it("#148 AC-8: 案件のスレッド（caseRoom: true）では、返信の入力欄に選択と案内が出て、選んだ値がクエリに乗る", async () => {
    const { user, api, parent } = build(true);
    await screen.findByText("[E2E_TEST]148b2スレッドの親");
    await user.upload(
      screen.getByLabelText("ファイルを添付"),
      sizedFile("r148.txt", 10),
    );
    const select = await screen.findByRole("combobox", {
      name: "r148.txt の公開範囲",
    });
    expect(valueOf(select)).toBe("participants_only");
    expect(screen.getByText(HINT)).toBeTruthy();
    await user.selectOptions(select, PUBLIC);
    await user.type(
      screen.getByRole("textbox", { name: "返信" }),
      "[[E2E_TEST]148b2",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(
      api.uploads.map((u) => [u.entry, u.targetId, u.publicationVisibility]),
    ).toEqual([["reply", parent.id, "public_archive"]]);
  });

  it("#148 AC-8: 通常のチャンネル・DM のスレッド（caseRoom: false）では、選択も案内も出ず、クエリも付かない", async () => {
    const { user, api } = build(false);
    await screen.findByText("[E2E_TEST]148b2スレッドの親");
    await user.upload(
      screen.getByLabelText("ファイルを添付"),
      sizedFile("r148.txt", 10),
    );
    await screen.findByRole("list", { name: "送信前の添付" });
    expect(
      screen.queryByRole("combobox", { name: "r148.txt の公開範囲" }),
    ).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    await user.type(
      screen.getByRole("textbox", { name: "返信" }),
      "[[E2E_TEST]148b2",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.uploads.map((u) => u.publicationVisibility)).toEqual([null]);
  });
});

/** 選択欄のいまの値 */
function valueOf(element: HTMLElement): string {
  return (element as unknown as { value: string }).value;
}
