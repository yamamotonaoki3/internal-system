// #270（270-A）1-6 AC-4「画面上で非表示にする」・計画 4.6「見える範囲の7か所」・AC-1：削除済みの添付（deleted_at が入った行）は、
// どの経路からも出ないこと。同じメッセージのほかの添付は出ること（対照）。削除の前は出ること（対照）。
// 削除済みの状態は、削除の API を通さずに直接作る（見える範囲の条件だけを確かめるため。削除の流れは attachments.delete.test.ts）。
// 経路（計画 4.6 の番号）：
//   1 配信（attachmentVisible）  2 部屋の一覧（after なし・あり）・返信の取得の parent と返信（loadMessageAttachments）・スレッド一覧
//   3 案件の添付の一覧（EP-5-19）  4 案件の添付の公開範囲の変更（EP-1-23。削除済みは 404）
//   5 検索の索引の登録し直し（reindexMessages が削除済みを入れない）  6 検索の結果（索引が遅れても出さない。matchedAttachments に出ない）
//   7 後始末の SQL は db/cleanup-sql.attachment-delete.db.test.ts
// 層について：計画 7章は DB の層の1つの事例表としているが、ここでは API を通して確かめる（同じ SQL を通る。報告に記載）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { ascii } from "../../test/attachment-files";
import {
  attachmentDocumentCount,
  markAttachmentDeleted,
} from "../../test/attachment-delete-fixtures";
import {
  downloadAttachment,
  seedStoredAttachment,
} from "../../test/attachment-fixtures";
import { changeVisibilityRequest } from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";
import { ZERO, getReplies, getThreads } from "../../test/thread-fixtures";

const TEXT = ascii("[UNIT_TEST]270 deleted visibility");
const DELETED_NAME = "[UNIT_TEST]270消えた見積書.txt";
const KEPT_NAME = "[UNIT_TEST]270残った請求書.txt";
const SEARCH_DELETED = "270消えた見積書";
const SEARCH_KEPT = "270残った請求書";

let cw: CaseRoomWorld;
let parent: string;
let reply: string;
let deletedOnParent: string;
let keptOnParent: string;
let deletedOnReply: string;

type SearchPage = {
  items: { messageId: string; matchedAttachments: { id: string }[] }[];
};

const seedOn = (
  roomId: string,
  uploaderId: string,
  messageId: string,
  name: string,
  threadParentId?: string,
) =>
  seedStoredAttachment(
    {
      roomId,
      uploaderId,
      messageId,
      originalName: name,
      ...(threadParentId === undefined ? {} : { threadParentId }),
    },
    TEXT,
  );

/** 参加者 memberD1 から見た、読み取りの経路の応答の本体（2 と 3） */
async function readBodies(token: string) {
  const get = async (path: string) => {
    const response = await apiRequest("GET", path, { token });
    expect(response.status, path).toBe(200);
    return response.text();
  };
  return {
    room: await get(`/api/rooms/${cw.open.roomId}/messages`),
    roomAfter: await get(`/api/rooms/${cw.open.roomId}/messages?after=${ZERO}`),
    replies: await (await getReplies(parent, "", token)).text(),
    repliesAfter: await (
      await getReplies(parent, `?after=${ZERO}`, token)
    ).text(),
    threads: await (await getThreads("", token)).text(),
    caseList: await get(`/api/cases/${cw.open.id}/attachments`),
  };
}

async function search(q: string, token: string): Promise<SearchPage> {
  const response = await apiRequest(
    "GET",
    `/api/search/messages?${new URLSearchParams({ q }).toString()}`,
    { token },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as SearchPage;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1720);
  parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
  reply = await seedRoomReply(cw.open.roomId, parent, cw.w.memberD1.id, 2);
  deletedOnParent = await seedOn(
    cw.open.roomId,
    cw.w.memberS1.id,
    parent,
    DELETED_NAME,
  );
  keptOnParent = await seedOn(
    cw.open.roomId,
    cw.w.memberS1.id,
    parent,
    KEPT_NAME,
  );
  deletedOnReply = await seedOn(
    cw.open.roomId,
    cw.w.memberD1.id,
    reply,
    DELETED_NAME,
    parent,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupCaseRoomWorld();
  }
});

describe("#270 AC-1 削除済みの添付は、読み取りの経路のどこにも出ない（計画 4.6 の1〜3）", () => {
  it("#270 AC-1 対照: 削除の前は、配信・部屋の一覧・返信・スレッド一覧・案件の添付の一覧のどれにも出る", async () => {
    const token = cw.w.memberD1.token;
    expect((await downloadAttachment(deletedOnParent, token)).status).toBe(200);
    expect((await downloadAttachment(deletedOnReply, token)).status).toBe(200);
    const bodies = await readBodies(token);
    expect(bodies.room).toContain(deletedOnParent);
    expect(bodies.roomAfter).toContain(deletedOnParent);
    expect(bodies.replies).toContain(deletedOnParent);
    expect(bodies.replies).toContain(deletedOnReply);
    expect(bodies.repliesAfter).toContain(deletedOnReply);
    expect(bodies.threads).toContain(deletedOnParent);
    expect(bodies.caseList).toContain(deletedOnParent);
    expect(bodies.caseList).toContain(deletedOnReply);
  });

  it("#270 AC-1: 削除の後は、配信が 404 で、どの一覧にも出ない。同じメッセージのほかの添付は出る", async () => {
    await markAttachmentDeleted(deletedOnParent, cw.w.memberS1.id);
    await markAttachmentDeleted(deletedOnReply, cw.w.memberD1.id);
    for (const token of [cw.w.memberD1.token, cw.w.memberS1.token]) {
      expect((await downloadAttachment(deletedOnParent, token)).status).toBe(
        404,
      );
      expect((await downloadAttachment(deletedOnReply, token)).status).toBe(
        404,
      );
      expect((await downloadAttachment(keptOnParent, token)).status).toBe(200);
      const bodies = await readBodies(token);
      for (const [label, body] of Object.entries(bodies)) {
        expect(body, label).not.toContain(deletedOnParent);
        expect(body, label).not.toContain(deletedOnReply);
        expect(body, label).not.toContain(DELETED_NAME);
      }
      expect(bodies.room).toContain(keptOnParent);
      expect(bodies.roomAfter).toContain(keptOnParent);
      expect(bodies.replies).toContain(keptOnParent);
      expect(bodies.threads).toContain(keptOnParent);
      expect(bodies.caseList).toContain(keptOnParent);
    }
  });
});

describe("#270 AC-1 案件の添付の公開範囲の変更（計画 4.6 の4）", () => {
  it("#270 AC-1: 削除済みの添付の公開範囲の変更は 404。削除されていない添付は変えられる（対照）", async () => {
    await markAttachmentDeleted(deletedOnParent, cw.w.memberS1.id);
    const body = { publicationVisibility: "public_archive" };
    const kept = await changeVisibilityRequest(
      keptOnParent,
      body,
      cw.w.memberS1.token,
    );
    expect(kept.status).toBe(200);
    const deleted = await changeVisibilityRequest(
      deletedOnParent,
      body,
      cw.w.memberS1.token,
    );
    expect(deleted.status).toBe(404);
  });
});

describe("#270 AC-1 検索（計画 4.6 の5・6）", () => {
  let searchMessage: string;
  let deletedInNormal: string;
  let keptInNormal: string;

  beforeEach(async () => {
    searchMessage = await seedRoomMessage(cw.normal, cw.w.memberS1.id, 3);
    deletedInNormal = await seedOn(
      cw.normal,
      cw.w.memberS1.id,
      searchMessage,
      DELETED_NAME,
    );
    keptInNormal = await seedOn(
      cw.normal,
      cw.w.memberS1.id,
      searchMessage,
      KEPT_NAME,
    );
  });

  it("#270 AC-1 対照: 削除の前は、ファイル名で一致し、matchedAttachments に出る", async () => {
    await buildSearchIndex();
    const page = await search(SEARCH_DELETED, cw.w.memberD1.token);
    const item = page.items.find((i) => i.messageId === searchMessage);
    expect(item?.matchedAttachments.map((a) => a.id)).toEqual([
      deletedInNormal,
    ]);
  });

  it("#270 AC-1（6）: 索引に写しが残っていても（索引の遅れ）、削除済みの添付の名前では一致せず、matchedAttachments に出ない", async () => {
    await buildSearchIndex();
    await markAttachmentDeleted(deletedInNormal, cw.w.memberS1.id);
    // 写しは残ったまま（削除の API を通していないので、索引を更新していない）
    expect(await attachmentDocumentCount(deletedInNormal)).toBe(1);
    const page = await search(SEARCH_DELETED, cw.w.memberD1.token);
    expect(page.items.map((i) => i.messageId)).not.toContain(searchMessage);
    expect(JSON.stringify(page)).not.toContain(deletedInNormal);
    // 対照：同じメッセージの残った添付は一致する
    const kept = await search(SEARCH_KEPT, cw.w.memberD1.token);
    expect(
      kept.items.find((i) => i.messageId === searchMessage)?.matchedAttachments,
    ).toEqual([expect.objectContaining({ id: keptInNormal })]);
  });

  it("#270 AC-1（5）: 索引を登録し直すと、削除済みの添付の写しは消え、入れ直されない。残った添付の写しは1つ", async () => {
    await buildSearchIndex();
    await markAttachmentDeleted(deletedInNormal, cw.w.memberS1.id);
    await buildSearchIndex();
    expect(await attachmentDocumentCount(deletedInNormal)).toBe(0);
    expect(await attachmentDocumentCount(keptInNormal)).toBe(1);
  });

  it("#270 AC-1（5）: 削除済みにした後に初めて索引を作っても、削除済みの添付の写しは入らない", async () => {
    await markAttachmentDeleted(deletedInNormal, cw.w.memberS1.id);
    await buildSearchIndex();
    expect(await attachmentDocumentCount(deletedInNormal)).toBe(0);
    expect(await attachmentDocumentCount(keptInNormal)).toBe(1);
  });
});
