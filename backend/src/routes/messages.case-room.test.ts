// #148（148-A）5-2 AC-1・AC-4・AC-6・5-1 AC-11：案件専用チャンネル（案件の部屋）のやり取りを、既存のメッセージの API（部屋の ID）で
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる（新しいメッセージの API は作らない。5-2 AC-4）。
// この層で確かめるもの（計画 148-A のテストケースの「結合」の行）：
//   参加者は進行中の案件の部屋に、投稿・返信・リアクション・メンションの候補・既読ができる（201／200／204）
//   終了中は、投稿・返信・編集・削除・リアクション・添付のアップロードが 409。一覧・返信の一覧・添付の取得・既読は 200／204
//   409 の拒否は logger.audit に reason case_closed で残す（本文を入れない）
//   存在の非開示：非参加者が案件の部屋の ID で各 EP を呼ぶと、存在しない部屋（メッセージ）と同じ 404・同じ本文
// 判定の順の細かい分岐は Service のテスト（services/message.case-room.test.ts）で確かめ、ここでは重ねない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  downloadAttachment,
  seedStoredAttachment,
  uploadFile,
} from "../../test/attachment-fixtures";
import { ascii } from "../../test/attachment-files";
import {
  CASE_CLOSED_MESSAGE,
  CASE_CLOSED_MESSAGES,
  cleanupCaseRoomWorld,
  messageCountIn,
  seedRoomMessage,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { MISSING_CASE_ID } from "../../test/case-fixtures";
import { deleteMessage, editMessage } from "../../test/message-modify-fixtures";
import { deleteReaction, postReaction } from "../../test/reaction-fixtures";
import { getReplies, postReply } from "../../test/thread-fixtures";

let cw: CaseRoomWorld;
let logLines: string[];

const messagesPath = (roomId: string) => `/api/rooms/${roomId}/messages`;
const candidatesPath = (roomId: string) =>
  `/api/rooms/${roomId}/mention-candidates`;
const readPath = (roomId: string) => `/api/rooms/${roomId}/read-position`;

const listOf = (roomId: string, token: string) =>
  apiRequest("GET", `${messagesPath(roomId)}?limit=50`, { token });
const postTo = (roomId: string, token: string, body = "[UNIT_TEST]148投稿") =>
  apiRequest("POST", messagesPath(roomId), { token, body: { body } });
const candidatesOf = (roomId: string, token: string) =>
  apiRequest("GET", `${candidatesPath(roomId)}?limit=20`, { token });
const markRead = (roomId: string, messageId: string, token: string) =>
  apiRequest("PUT", readPath(roomId), {
    token,
    body: { lastReadMessageId: messageId },
  });

async function errorOf(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** 本文の traceId など、要求ごとに違う値を除いて比べる */
function comparable(error: { status: number; body: Record<string, unknown> }) {
  const rest = Object.fromEntries(
    Object.entries(error.body).filter(
      ([key]) => key !== "traceId" && key !== "requestId",
    ),
  );
  return { status: error.status, body: rest };
}

beforeEach(async () => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  cw = await setupCaseRoomWorld(1540);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-2 AC-1・AC-4 参加者は進行中の案件の部屋でやり取りできる（既存の API）", () => {
  it("#148 5-2 AC-1: 参加者は投稿（201）・返信（201）・リアクション（200）・メンションの候補（200）・既読（204）ができる", async () => {
    const token = cw.w.memberS1.token;
    const posted = await postTo(cw.open.roomId, token);
    expect(posted.status).toBe(201);
    const { id } = (await posted.json()) as { id: string };
    expect(
      (await postReply(id, { body: "[UNIT_TEST]148返信" }, cw.w.memberD1.token))
        .status,
    ).toBe(201);
    expect(
      (await postReaction(id, { kind: "emoji", value: "👍" }, token)).status,
    ).toBe(200);
    expect((await candidatesOf(cw.open.roomId, token)).status).toBe(200);
    expect((await markRead(cw.open.roomId, id, token)).status).toBe(204);
  });

  it("#148 5-2 AC-1: 参加者の一覧に、ほかの参加者の投稿が出る（チャンネルと同じ形）", async () => {
    const id = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 1);
    const res = await listOf(cw.open.roomId, cw.w.memberS1.token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: { id: string }[] };
    expect(page.items.map((item) => item.id)).toEqual([id]);
  });
});

describe("#148 5-1 AC-11 終了した案件の部屋（読み取り専用）", () => {
  it("#148 5-1 AC-11: 投稿は 409「終了した案件には投稿できません」で、行は増えず、拒否が audit に reason case_closed で残る（本文を入れない）", async () => {
    const res = await postTo(
      cw.closed.roomId,
      cw.w.memberS1.token,
      "[UNIT_TEST]148秘密の本文",
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: CASE_CLOSED_MESSAGE,
    });
    expect(await messageCountIn(cw.closed.roomId)).toBe(0);
    const audits = logLines.filter((line) => line.includes("case_closed"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.join("\n")).not.toContain("148秘密の本文");
  });

  it("#148 5-1 AC-11: 返信・編集・削除・リアクションの追加と取り消し・添付のアップロード（部屋・返信）は 409", async () => {
    const own = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 2);
    const token = cw.w.memberS1.token;
    const text = ascii("[UNIT_TEST]148");
    const responses = [
      await postReply(own, { body: "[UNIT_TEST]148返信" }, token),
      await editMessage(own, { body: "[UNIT_TEST]148編集" }, token),
      await deleteMessage(own, token),
      await postReaction(own, { kind: "emoji", value: "👍" }, token),
      await deleteReaction(own, "emoji", "👍", token),
      await uploadFile(
        { kind: "room", roomId: cw.closed.roomId },
        "memo148.txt",
        text,
        token,
      ),
      await uploadFile(
        { kind: "reply", parentId: own },
        "memo148.txt",
        text,
        token,
      ),
    ];
    const M = CASE_CLOSED_MESSAGES;
    const bodies = await Promise.all(
      responses.map(async (r) => ({ status: r.status, body: await r.json() })),
    );
    expect(bodies).toEqual(
      [
        M.post,
        M.modify,
        M.modify,
        M.reaction,
        M.reaction,
        M.upload,
        M.upload,
      ].map((message) => ({
        status: 409,
        body: expect.objectContaining({ code: "CONFLICT", message }),
      })),
    );
    const audits = logLines.filter((line) => line.includes("case_closed"));
    expect(audits.length).toBeGreaterThanOrEqual(responses.length);
    expect(audits.join(" ")).not.toContain("148返信");
    expect(audits.join(" ")).not.toContain("148編集");
  });

  it("#148 5-1 AC-11: 一覧・返信の一覧・添付の取得は 200、既読は 204（終了中も読める）", async () => {
    const parent = await seedRoomMessage(cw.closed.roomId, cw.w.memberD1.id, 3);
    const attachmentId = await seedStoredAttachment(
      {
        roomId: cw.closed.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: parent,
        originalName: "memo148.txt",
        contentType: "text/plain; charset=utf-8",
      },
      ascii("[UNIT_TEST]148"),
    );
    const token = cw.w.memberS1.token;
    expect((await listOf(cw.closed.roomId, token)).status).toBe(200);
    expect((await getReplies(parent, "?limit=50", token)).status).toBe(200);
    expect((await downloadAttachment(attachmentId, token)).status).toBe(200);
    expect((await markRead(cw.closed.roomId, parent, token)).status).toBe(204);
  });
});

describe("#148 5-2 AC-6・存在の非開示 非参加者には、存在しない部屋と同じ 404", () => {
  it("#148 5-2 AC-6: 非参加者（ほかの案件の参加者）が、部屋の ID で一覧・投稿・メンションの候補・既読を呼ぶと、存在しない部屋の ID と同じ応答", async () => {
    const message = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 4);
    const token = cw.w.memberS2.token;
    const pairs: [Response, Response][] = [
      [
        await listOf(cw.open.roomId, token),
        await listOf(MISSING_CASE_ID, token),
      ],
      [
        await postTo(cw.open.roomId, token),
        await postTo(MISSING_CASE_ID, token),
      ],
      [
        await candidatesOf(cw.open.roomId, token),
        await candidatesOf(MISSING_CASE_ID, token),
      ],
      [
        await markRead(cw.open.roomId, message, token),
        await markRead(MISSING_CASE_ID, message, token),
      ],
    ];
    for (const [actual, missing] of pairs) {
      const a = comparable(await errorOf(actual));
      expect(a.status).toBe(404);
      expect(a).toEqual(comparable(await errorOf(missing)));
    }
  });

  it("#148 5-2 AC-6: 非参加者が、案件の部屋のメッセージの ID で返信・返信の一覧・リアクション・添付の取得を呼ぶと、存在しない ID と同じ 404", async () => {
    const message = await seedRoomMessage(cw.open.roomId, cw.w.memberD1.id, 5);
    const attachmentId = await seedStoredAttachment(
      {
        roomId: cw.open.roomId,
        uploaderId: cw.w.memberD1.id,
        messageId: message,
      },
      ascii("[UNIT_TEST]148"),
    );
    const token = cw.w.memberS2.token;
    const pairs: [Response, Response][] = [
      [
        await postReply(message, { body: "[UNIT_TEST]148" }, token),
        await postReply(MISSING_CASE_ID, { body: "[UNIT_TEST]148" }, token),
      ],
      [
        await getReplies(message, "?limit=50", token),
        await getReplies(MISSING_CASE_ID, "?limit=50", token),
      ],
      [
        await postReaction(message, { kind: "emoji", value: "👍" }, token),
        await postReaction(
          MISSING_CASE_ID,
          { kind: "emoji", value: "👍" },
          token,
        ),
      ],
      [
        await downloadAttachment(attachmentId, token),
        await downloadAttachment(MISSING_CASE_ID, token),
      ],
    ];
    for (const [actual, missing] of pairs) {
      const a = comparable(await errorOf(actual));
      expect(a.status).toBe(404);
      expect(a).toEqual(comparable(await errorOf(missing)));
    }
  });

  it("#148 存在の非開示: 終了の案件の部屋でも、非参加者の投稿は 409 でなく 404（案件の状態を漏らさない）", async () => {
    const res = await postTo(cw.closed.roomId, cw.w.memberS2.token);
    expect(res.status).toBe(404);
  });
});

// #148 ミューテーションの生き残りへの対応：案件の終了による拒否の監査（logger.audit）の操作（body）と対象（target）を、経路ごとに完全一致で確かめる。
// 操作の名前は message.service.ts の監査の操作（投稿 message.post・返信 message.reply・編集 message.edit・削除 message.delete・
// リアクション message.reaction・添付のアップロード attachment.upload）。対象は、部屋への操作は部屋の ID、メッセージへの操作はメッセージの ID、返信は親の ID。
describe("#148 5-1 AC-11 案件の終了による拒否の監査の操作と対象", () => {
  type AuditLine = {
    body: string;
    attributes: {
      log_type?: string;
      target?: string;
      result?: string;
      reason?: string;
    };
  };
  const caseClosedAudits = (): { action: string; target: string }[] =>
    logLines
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditLine];
        } catch {
          return [];
        }
      })
      .filter(
        (line) =>
          line.attributes?.log_type === "audit" &&
          line.attributes.reason === "case_closed",
      )
      .map((line) => {
        expect(line.attributes.result).toBe("failure");
        return { action: line.body, target: line.attributes.target ?? "" };
      });

  it("#148 5-1 AC-11: 投稿・返信・編集・削除・リアクションの付け外し・添付のアップロード（部屋・返信）の拒否が、それぞれの操作と対象で1件ずつ残る", async () => {
    const own = await seedRoomMessage(cw.closed.roomId, cw.w.memberS1.id, 7);
    const token = cw.w.memberS1.token;
    const text = ascii("[UNIT_TEST]148");
    const steps: [
      () => Response | Promise<Response>,
      { action: string; target: string },
    ][] = [
      [
        () => postTo(cw.closed.roomId, token),
        { action: "message.post", target: cw.closed.roomId },
      ],
      [
        () => postReply(own, { body: "[UNIT_TEST]148" }, token),
        { action: "message.reply", target: own },
      ],
      [
        () => editMessage(own, { body: "[UNIT_TEST]148編集" }, token),
        { action: "message.edit", target: own },
      ],
      [
        () => deleteMessage(own, token),
        { action: "message.delete", target: own },
      ],
      [
        () => postReaction(own, { kind: "emoji", value: "👍" }, token),
        { action: "message.reaction", target: own },
      ],
      [
        () => deleteReaction(own, "emoji", "👍", token),
        { action: "message.reaction", target: own },
      ],
      [
        () =>
          uploadFile(
            { kind: "room", roomId: cw.closed.roomId },
            "memo148.txt",
            text,
            token,
          ),
        { action: "attachment.upload", target: cw.closed.roomId },
      ],
      [
        () =>
          uploadFile(
            { kind: "reply", parentId: own },
            "memo148.txt",
            text,
            token,
          ),
        { action: "attachment.upload", target: own },
      ],
    ];
    for (const [step, expected] of steps) {
      logLines.length = 0;
      expect((await step()).status).toBe(409);
      expect(caseClosedAudits()).toEqual([expected]);
    }
  });
});
