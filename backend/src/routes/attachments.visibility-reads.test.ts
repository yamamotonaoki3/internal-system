// #148（148-B-2）5-2 AC-8・計画 D7・C-64：公開範囲の値（public_archive＝全社員公開アーカイブで公開できる）は、即時公開を意味せず、
// いまはどの読み取りの資格にも使わないこと。「案件アーカイブの全社員公開が承認されるまでは参加者だけが閲覧できる」（5-2 AC-8）。
// public_archive にした投稿済みの添付（部屋と返信）を、非参加者（一般・参加していない担当部署のオーナー・参加していない全体管理者）に、
// 6つの経路（①配信 ②EP-5-19 ③部屋のメッセージ ④返信 ⑤単体のメッセージ（返信の取得の parent）と after つきの取得 ⑥スレッド一覧）で返さない。参加者には全経路で出る（対照）。
// 状態コードは既存の非開示の規則に従う（設計書「非参加者には部屋があることを明かさず 404」、EP-5-19 は 403）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  downloadAttachment,
  seedStoredAttachment,
} from "../../test/attachment-fixtures";
import { ascii } from "../../test/attachment-files";
import { setPublicationVisibility } from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { ZERO, getReplies, getThreads } from "../../test/thread-fixtures";

const TEXT = ascii("[UNIT_TEST]148b2 read");
let cw: CaseRoomWorld;
let parent: string;
let reply: string;
let onParent: string;
let onReply: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1680);
  parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 1);
  reply = await seedRoomReply(cw.open.roomId, parent, cw.w.memberD1.id, 2);
  onParent = await seedStoredAttachment(
    { roomId: cw.open.roomId, uploaderId: cw.w.memberS1.id, messageId: parent },
    TEXT,
  );
  onReply = await seedStoredAttachment(
    {
      roomId: cw.open.roomId,
      uploaderId: cw.w.memberD1.id,
      messageId: reply,
      threadParentId: parent,
    },
    TEXT,
  );
  await setPublicationVisibility(onParent, "public_archive");
  await setPublicationVisibility(onReply, "public_archive");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

const NON_PARTICIPANTS: [string, () => { token: string }][] = [
  ["非参加の一般社員", () => cw.w.memberS2],
  ["参加していない担当部署のオーナー", () => cw.w.ownerS],
  ["参加していない全体管理者", () => cw.w.admin],
];

describe("#148 AC-8 D7 public_archive でも、非参加者には返さない", () => {
  it.each(NON_PARTICIPANTS)(
    "#148 AC-8 C-64: %s には、6つの経路のどれでも添付を返さない",
    async (_l, who) => {
      const token = who().token;
      // ① 配信
      expect((await downloadAttachment(onParent, token)).status).toBe(404);
      expect((await downloadAttachment(onReply, token)).status).toBe(404);
      // ② 案件の添付の一覧
      const list = await apiRequest(
        "GET",
        `/api/cases/${cw.open.id}/attachments`,
        { token },
      );
      expect(list.status).toBe(403);
      // ③ 部屋のメッセージ
      const room = await apiRequest(
        "GET",
        `/api/rooms/${cw.open.roomId}/messages`,
        { token },
      );
      expect(room.status).toBe(404);
      // ④ 返信
      expect((await getReplies(parent, "", token)).status).toBe(404);
      // ⑤ 単体のメッセージ（GET /api/messages/:id はない。1件の読み取り findItem は返信の取得の parent で使う）と、
      //    after つきの取得（listAfter・listRepliesAfter。最新の取得と別の読み取り）
      expect((await getReplies(parent, `?after=${ZERO}`, token)).status).toBe(
        404,
      );
      const roomAfter = await apiRequest(
        "GET",
        `/api/rooms/${cw.open.roomId}/messages?after=${ZERO}`,
        { token },
      );
      expect(roomAfter.status).toBe(404);
      // ⑥ スレッド一覧
      const threads = await getThreads("", token);
      expect(threads.status).toBe(200);
      const text = await threads.text();
      expect(text).not.toContain(onParent);
      expect(text).not.toContain(onReply);
      for (const res of [list, room, roomAfter]) {
        const body = await res.text();
        expect(body).not.toContain(onParent);
        expect(body).not.toContain(onReply);
      }
    },
  );

  it("#148 AC-8 対照: 参加者には、6つの経路のどれでも添付が出る", async () => {
    const token = cw.w.memberD1.token;
    expect((await downloadAttachment(onParent, token)).status).toBe(200);
    expect((await downloadAttachment(onReply, token)).status).toBe(200);
    const texts = [
      await (
        await apiRequest("GET", `/api/cases/${cw.open.id}/attachments`, {
          token,
        })
      ).text(),
      await (
        await apiRequest("GET", `/api/rooms/${cw.open.roomId}/messages`, {
          token,
        })
      ).text(),
      await (await getReplies(parent, "", token)).text(),
      await (await getReplies(parent, `?after=${ZERO}`, token)).text(),
      await (await getThreads("", token)).text(),
      await (
        await apiRequest(
          "GET",
          `/api/rooms/${cw.open.roomId}/messages?after=${ZERO}`,
          { token },
        )
      ).text(),
    ];
    expect(texts[0]).toContain(onParent);
    expect(texts[0]).toContain(onReply);
    expect(texts[1]).toContain(onParent);
    expect(texts[2]).toContain(onReply);
    // 返信の取得の parent（findItem）に、親の添付が出る
    expect(texts[2]).toContain(onParent);
    expect(texts[3]).toContain(onParent);
    expect(texts[3]).toContain(onReply);
    expect(texts[4]).toContain(onParent);
    expect(texts[5]).toContain(onParent);
  });
});
