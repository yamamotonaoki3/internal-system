// #270（270-A）AC-8・計画 4.9「キャッシュの更新先」：添付の削除が成功した後、再読み込みなしで、関係する表示のすべてから消えること。
//   部屋の投稿（parentMessageId が null）：部屋の一覧 messageKeys.room(roomId) の該当の行と、スレッドのキャッシュ messageKeys.thread(messageId) の parent
//   返信：スレッドのキャッシュ messageKeys.thread(parentMessageId) の replies の該当の行（部屋の一覧は変えない）
//   案件の添付の一覧：features/cases の caseKeys.all を invalidate（既定の方針6）
// 同じ親の投稿を、部屋の一覧（RoomMessages）と開いたスレッド（S-07。ThreadPane）で同時に出して確かめる。API は MSW。データは架空。
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { respondAttachmentDeletes } from "../../test/attachment-delete-handlers";
import { uploadedId } from "../../test/attachment-handlers";
import {
  ROOM_ID,
  message,
  reply,
  respondMessages,
  respondReplies,
  type TestAttachment,
} from "../../test/message-handlers";
import {
  SELF,
  newClient,
  renderInApp,
  respondSelf,
} from "../../test/thread-harness";
import { caseKeys } from "../cases";
import { ThreadPane } from "../threads";
import { RoomMessages } from "./index";

const doc = (n: number, name: string): TestAttachment => ({
  id: uploadedId(n),
  name,
  kind: "document",
  contentType: "application/pdf",
  size: 10,
});
const ON_PARENT = doc(1, "[E2E_TEST]親の消す添付.pdf");
const KEPT_ON_PARENT = doc(2, "[E2E_TEST]親の残す添付.pdf");
const ON_REPLY = doc(3, "[E2E_TEST]返信の消す添付.pdf");

function build() {
  respondSelf();
  const parent = message(1, {
    body: "[E2E_TEST]添付つきの親",
    replyCount: 1,
    attachments: [ON_PARENT, KEPT_ON_PARENT],
  });
  const mine = reply(parent, 1, {
    author: { id: SELF.id, displayName: SELF.displayName },
    body: "[E2E_TEST]添付つきの返信",
    attachments: [ON_REPLY],
  });
  const room = respondMessages([parent]);
  const thread = respondReplies({
    parent,
    replies: [mine],
    joined: true,
    roomWritable: true,
    replyBlockedReason: null,
    caseRoom: false,
  });
  const api = respondAttachmentDeletes();
  const client = newClient();
  // 案件の添付の一覧のキャッシュ（invalidate されることを確かめる）
  const caseListKey = caseKeys.attachments(
    SELF.id,
    "01JTESTCASE000000000000001",
  );
  client.setQueryData(caseListKey, { items: [], nextCursor: null });
  const view = renderInApp(
    <>
      <RoomMessages roomId={ROOM_ID} canPost joined canModifyOwn />
      <ThreadPane parentMessageId={parent.id} />
    </>,
    { client, path: `/channels/room?thread=${parent.id}` },
  );
  return { ...view, api, room, thread, parent, caseListKey };
}

const pane = () => {
  const element = document.querySelector<HTMLElement>(
    '[aria-label="スレッド"]',
  );
  if (element === null) throw new Error("スレッドの枠がありません");
  return element;
};
const roomLog = () => {
  const log = screen.getAllByRole("log").find((el) => !pane().contains(el));
  if (log === undefined) throw new Error("部屋の一覧がありません");
  return log;
};

async function confirmDelete(
  user: ReturnType<typeof renderInApp>["user"],
  scope: HTMLElement,
  name: string,
) {
  await user.click(
    await within(scope).findByRole("button", { name: `${name}を削除` }),
  );
  const dialog = await screen.findByRole("dialog", { name: "添付の削除" });
  await user.click(within(dialog).getByRole("button", { name: "削除する" }));
}

/** 部屋の一覧とスレッドの両方が、親の添付を出し終えるまで待つ */
const loaded = () =>
  waitFor(() =>
    expect(screen.getAllByRole("link", { name: ON_PARENT.name })).toHaveLength(
      2,
    ),
  );

const afterless = (requests: URL[]) =>
  requests.filter((url) => !url.searchParams.has("after")).length;

describe("#270 AC-8 計画 4.9 キャッシュの更新先", () => {
  it("#270 AC-8: 部屋の側から親の添付を消すと、部屋の一覧とスレッドの親の両方から、再読み込みなしで消える。ほかの添付は残る", async () => {
    const { user, api, room, thread } = build();
    await loaded();
    expect(
      within(roomLog()).getByRole("link", { name: ON_PARENT.name }),
    ).toBeTruthy();
    expect(
      within(pane()).getByRole("link", { name: ON_PARENT.name }),
    ).toBeTruthy();
    const roomGets = afterless(room.requests);
    const threadGets = afterless(thread.requests);

    await confirmDelete(user, roomLog(), ON_PARENT.name);

    await waitFor(() => expect(api.deletes).toEqual([ON_PARENT.id]));
    await waitFor(() =>
      expect(screen.queryAllByRole("link", { name: ON_PARENT.name })).toEqual(
        [],
      ),
    );
    expect(
      within(roomLog()).getByRole("link", { name: KEPT_ON_PARENT.name }),
    ).toBeTruthy();
    expect(
      within(pane()).getByRole("link", { name: KEPT_ON_PARENT.name }),
    ).toBeTruthy();
    expect(afterless(room.requests)).toBe(roomGets);
    expect(afterless(thread.requests)).toBe(threadGets);
  });

  it("#270 AC-8: スレッドの返信の添付を消すと、返信から消え、部屋の一覧（親の添付）は変わらない", async () => {
    const { user, api } = build();
    await loaded();
    await within(pane()).findByRole("link", { name: ON_REPLY.name });
    await confirmDelete(user, pane(), ON_REPLY.name);
    await waitFor(() => expect(api.deletes).toEqual([ON_REPLY.id]));
    await waitFor(() =>
      expect(screen.queryAllByRole("link", { name: ON_REPLY.name })).toEqual(
        [],
      ),
    );
    expect(
      within(roomLog()).getByRole("link", { name: ON_PARENT.name }),
    ).toBeTruthy();
    expect(
      within(pane()).getByRole("link", { name: ON_PARENT.name }),
    ).toBeTruthy();
  });

  it("#270 AC-8（既定の方針6）: 削除が成功すると、案件の添付の一覧のキャッシュを無効にする", async () => {
    const { user, api, client, caseListKey } = build();
    expect(client.getQueryState(caseListKey)?.isInvalidated).toBe(false);
    await loaded();
    await confirmDelete(user, roomLog(), ON_PARENT.name);
    await waitFor(() => expect(api.deletes).toEqual([ON_PARENT.id]));
    await waitFor(() =>
      expect(client.getQueryState(caseListKey)?.isInvalidated).toBe(true),
    );
  });

  it("#270 AC-8: 削除が失敗したら、部屋の一覧にもスレッドにも、添付が残る", async () => {
    const { user, api } = build();
    api.failWith = {
      status: 409,
      code: "CONFLICT",
      message: "状態が変わりました（テスト）",
    };
    await loaded();
    await confirmDelete(user, roomLog(), ON_PARENT.name);
    const dialog = await screen.findByRole("dialog", { name: "添付の削除" });
    await within(dialog).findByRole("alert");
    expect(
      within(roomLog()).getByRole("link", { name: ON_PARENT.name }),
    ).toBeTruthy();
    expect(
      within(pane()).getByRole("link", { name: ON_PARENT.name }),
    ).toBeTruthy();
  });
});
