// #148（148-C）5-1 AC-4 の残り（S-16 の「最終更新」「未読」）・5-1 AC-2・C-191(4)：案件の一覧（EP-5-06）・概要（EP-5-07）の項目
// lastActivityAt・channelId を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの（計画 148-C のテストケース「最終更新」の行）：
//   lastActivityAt は、その案件の部屋の、削除されていない最新のメッセージ（返信を含む）の投稿の時刻（C-191(4)）。なければ null。
//   削除済みのメッセージ・ほかの案件の部屋・案件でない部屋のメッセージを数えない（相関の条件が常に真になっていないこと。#294）。
//   終了した案件でも、参加者には返す。
//   lastActivityAt・channelId は、有効な参加者だけに返す（C-191(4)「有効な参加者にだけ出す」・5-1 AC-2「チャンネル ID は参加者だけ」）。
//   非参加者・参加の行が残った無効の利用者・外された人・参加していない担当部署のオーナー・参加していない全体管理者には、どちらも null。
//   participantCount（参加者か管理の資格のある人に返す）の条件を写していないこと（同じ行で participantCount が入り、2項目が null）。
//   「すべての案件」の一覧・「自分が参加する案件」の一覧・概要（findSummary）の3つで確かめる。D1 の1文の値の上限（100）を超える件数でも読める。
// 応答の形（JSON・null の項目を省かない）は結合テスト（routes/cases.activity.test.ts）、実行計画は case-activity.explain.db.test.ts で確かめる。
// 契約（実装前の仮置き。計画 148-C の API。実装の担当へ）：CaseSummary に次の2項目を足す
//   lastActivityAt: string | null（ISO 8601。メッセージの created_at のまま）・channelId: string | null（案件専用チャンネルの部屋の ID）
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markMessageDeleted } from "../../test/case-attachment-fixtures";
import {
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { TEST_TAG } from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import { idAt, isoAt } from "../../test/thread-fixtures";
import { withCases } from "./case.repository";

type Item = {
  id: string;
  isParticipant: boolean;
  canManage: boolean;
  participantCount: number | null;
  lastActivityAt: string | null;
  channelId: string | null;
};

const BASE = 1530;

let cw: CaseRoomWorld;
/** 進行中・参加者 memberS1 だけ・メッセージなし */
let quiet: SeededCase;
/** 進行中・参加者 memberS1 だけ・削除済みのメッセージだけ */
let deletedOnly: SeededCase;

const list = (
  actorId: string,
  scope: "joined" | "all",
  status: "active" | "closed",
  limit = 100,
) =>
  withCases(env, (r) =>
    r.list({ actorId, scope, status, limit }),
  ) as unknown as Promise<{
    items: Item[];
    nextCursor: string | null;
  }>;

const summary = (actorId: string, caseId: string) =>
  withCases(env, (r) =>
    r.findSummary({ actorId, caseId }),
  ) as unknown as Promise<Item | null>;

function rowOf(items: Item[], id: string): Item {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`案件 ${id} が一覧にありません`);
  return found;
}

/**
 * メッセージ（n は idAt・isoAt の番号。大きいほど新しい）：
 *   open：10 トップ（memberS1）、12 その返信（memberD1）、14 トップ（削除済み）→ 最終更新は isoAt(12)
 *   closed：11 トップ → isoAt(11)
 *   other：20 トップ（memberS2）→ isoAt(20)（open より新しい。ほかの案件の時刻が混ざれば open が 20 になる）
 *   normal（案件でない通常のチャンネル）：30 → どの案件にも数えない
 *   deletedOnly：16 トップ（削除済み）→ null。quiet：なし → null
 */
beforeEach(async () => {
  cw = await setupCaseRoomWorld(BASE);
  const { w } = cw;
  quiet = await seedCase({
    n: BASE + 4,
    clientId: w.clientA.id,
    code: "QZA",
    title: `${TEST_TAG}148C投稿なし`,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  deletedOnly = await seedCase({
    n: BASE + 5,
    clientId: w.clientA.id,
    code: "QZA",
    title: `${TEST_TAG}148C削除済みだけ`,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  const top = await seedRoomMessage(cw.open.roomId, w.memberS1.id, 10);
  await seedRoomReply(cw.open.roomId, top, w.memberD1.id, 12);
  const deletedTop = await seedRoomMessage(cw.open.roomId, w.memberS1.id, 14);
  await markMessageDeleted(deletedTop, w.memberS1.id);
  await seedRoomMessage(cw.closed.roomId, w.memberS1.id, 11);
  await seedRoomMessage(cw.other.roomId, w.memberS2.id, 20);
  await seedRoomMessage(cw.normal, w.memberS1.id, 30);
  const onlyDeleted = await seedRoomMessage(
    deletedOnly.roomId,
    w.memberS1.id,
    16,
  );
  await markMessageDeleted(onlyDeleted, w.memberS1.id);
});

afterEach(async () => {
  await cleanupCaseRoomWorld();
});

describe("#148 148-C 5-1 AC-4・C-191(4) 最終更新（lastActivityAt）の値", () => {
  it("#148 148-C C-191(4): 参加者の行の最終更新は、削除されていない最新のメッセージ（返信を含む）の投稿の時刻で、channelId は案件の部屋の ID", async () => {
    const { items } = await list(cw.w.memberS1.id, "all", "active");
    expect(rowOf(items, cw.open.id)).toMatchObject({
      isParticipant: true,
      lastActivityAt: isoAt(12),
      channelId: cw.open.roomId,
    });
  });

  it("#148 148-C C-191(4): メッセージのない案件・削除済みのメッセージだけの案件は、最終更新が null（channelId は参加者に返す）", async () => {
    const { items } = await list(cw.w.memberS1.id, "all", "active");
    expect(rowOf(items, quiet.id)).toMatchObject({
      lastActivityAt: null,
      channelId: quiet.roomId,
    });
    expect(rowOf(items, deletedOnly.id)).toMatchObject({
      lastActivityAt: null,
      channelId: deletedOnly.roomId,
    });
  });

  it("#148 148-C #294: 各行の最終更新は、その案件の部屋のメッセージだけから決める（ほかの案件・案件でない部屋の新しいメッセージが混ざらない）", async () => {
    const s1 = await list(cw.w.memberS1.id, "all", "active");
    expect(rowOf(s1.items, cw.open.id).lastActivityAt).toBe(isoAt(12));
    const s2 = await list(cw.w.memberS2.id, "all", "active");
    expect(rowOf(s2.items, cw.other.id)).toMatchObject({
      lastActivityAt: isoAt(20),
      channelId: cw.other.roomId,
    });
  });

  it("#148 148-C C-191(4): 終了した案件でも、参加者には最終更新と channelId を返す", async () => {
    const { items } = await list(cw.w.memberS1.id, "joined", "closed");
    expect(rowOf(items, cw.closed.id)).toMatchObject({
      lastActivityAt: isoAt(11),
      channelId: cw.closed.roomId,
    });
  });

  it("#148 148-C 5-1 AC-4: 「自分が参加する案件」の一覧と概要にも、同じ値を返す", async () => {
    const { items } = await list(cw.w.memberS1.id, "joined", "active");
    expect(rowOf(items, cw.open.id)).toMatchObject({
      lastActivityAt: isoAt(12),
      channelId: cw.open.roomId,
    });
    expect(await summary(cw.w.memberD1.id, cw.open.id)).toMatchObject({
      lastActivityAt: isoAt(12),
      channelId: cw.open.roomId,
    });
  });

  it("#148 148-C C-191(4): 最新のメッセージを削除すると、その前の削除されていないメッセージの時刻になる", async () => {
    await markMessageDeleted(idAt(12), cw.w.memberD1.id);
    expect((await summary(cw.w.memberS1.id, cw.open.id))?.lastActivityAt).toBe(
      isoAt(10),
    );
  });

  it("#148 148-C C-191(4): 並びは ID の順で決める（新しい返信が親より後ろの ID なら、その返信の時刻）", async () => {
    await insertMessage({
      roomId: cw.open.roomId,
      senderId: cw.w.memberD1.id,
      id: idAt(18),
      body: `${TEST_TAG}148C追加の返信`,
      createdAt: isoAt(18),
      parentMessageId: idAt(10),
    });
    expect((await summary(cw.w.memberS1.id, cw.open.id))?.lastActivityAt).toBe(
      isoAt(18),
    );
  });
});

describe("#148 148-C 5-1 AC-2・C-191(4) 最終更新と channelId は、有効な参加者だけに返す", () => {
  it.each([
    ["参加していない一般の社員", "memberS2"],
    ["所属のない一般の社員", "noDept"],
    ["参加していない担当部署のオーナー", "ownerS"],
    ["参加していない全体管理者", "admin"],
  ] as const)(
    "#148 148-C 5-1 AC-2: %sには、「すべての案件」の一覧と概要で、lastActivityAt・channelId がどちらも null",
    async (_label, key) => {
      const actorId = cw.w[key].id;
      const { items } = await list(actorId, "all", "active");
      expect(rowOf(items, cw.open.id), "一覧").toMatchObject({
        isParticipant: false,
        lastActivityAt: null,
        channelId: null,
      });
      expect(await summary(actorId, cw.open.id), "概要").toMatchObject({
        isParticipant: false,
        lastActivityAt: null,
        channelId: null,
      });
      const closed = await list(actorId, "all", "closed");
      expect(rowOf(closed.items, cw.closed.id), "終了").toMatchObject({
        lastActivityAt: null,
        channelId: null,
      });
    },
  );

  it.each([
    ["参加していない担当部署のオーナー", "ownerS"],
    ["参加していない全体管理者", "admin"],
  ] as const)(
    "#148 148-C 計画の軽微2: %sは、同じ行で participantCount が入り canManage が真でも、lastActivityAt・channelId は null（participantCount の条件を写していない）",
    async (_label, key) => {
      const actorId = cw.w[key].id;
      const { items } = await list(actorId, "all", "active");
      const row = rowOf(items, cw.open.id);
      expect(row.canManage).toBe(true);
      expect(row.participantCount).toBe(3);
      expect(row.lastActivityAt).toBeNull();
      expect(row.channelId).toBeNull();
      const found = await summary(actorId, cw.open.id);
      expect(found?.canManage).toBe(true);
      expect(found?.participantCount).toBe(3);
      expect(found?.lastActivityAt).toBeNull();
      expect(found?.channelId).toBeNull();
    },
  );

  it("#148 148-C 有効な参加者: 参加の行が残った無効の利用者には、一覧・概要とも null", async () => {
    const actorId = cw.w.inactive.id;
    const { items } = await list(actorId, "all", "active");
    expect(rowOf(items, cw.open.id)).toMatchObject({
      isParticipant: false,
      lastActivityAt: null,
      channelId: null,
    });
    expect(await summary(actorId, cw.open.id)).toMatchObject({
      lastActivityAt: null,
      channelId: null,
    });
  });

  it("#148 148-C 有効な参加者: 参加から外された人には、外された後の読み取りで null（読み取りの時点の参加で決める）", async () => {
    expect((await summary(cw.w.memberD1.id, cw.open.id))?.channelId).toBe(
      cw.open.roomId,
    );
    await removeCaseMember(cw.open.roomId, cw.w.memberD1.id);
    expect(await summary(cw.w.memberD1.id, cw.open.id)).toMatchObject({
      isParticipant: false,
      lastActivityAt: null,
      channelId: null,
    });
    const { items } = await list(cw.w.memberD1.id, "all", "active");
    expect(rowOf(items, cw.open.id)).toMatchObject({
      lastActivityAt: null,
      channelId: null,
    });
  });

  it("#148 148-C 5-1 AC-2: ほかの案件の有効な参加者には、参加していない案件の行で null（相関が常に真になっていない）", async () => {
    const { items } = await list(cw.w.memberS2.id, "all", "active");
    expect(rowOf(items, cw.other.id).channelId).toBe(cw.other.roomId);
    for (const id of [cw.open.id, quiet.id, deletedOnly.id])
      expect(rowOf(items, id), id).toMatchObject({
        lastActivityAt: null,
        channelId: null,
      });
  });
});

describe("#148 148-C D1 の上限", () => {
  it("#148 148-C: 1文の値の上限（100）を超える件数の案件（101件）を1ページで読んでも、各行の最終更新と channelId がその案件のもの", async () => {
    const many: SeededCase[] = [];
    for (let i = 0; i < 101; i += 1) {
      const seeded = await seedCase({
        n: BASE + 100 + i,
        clientId: cw.w.clientB.id,
        code: "QZB",
        title: `${TEST_TAG}148C多数${i}`,
        createdBy: cw.w.memberD1.id,
        departmentIds: [cw.w.deptD.id],
        members: [{ userId: cw.w.memberD1.id, joinedAt: joinedAt(1) }],
      });
      many.push(seeded);
      await insertMessage({
        roomId: seeded.roomId,
        senderId: cw.w.memberD1.id,
        id: idAt(1000 + i),
        body: `${TEST_TAG}148C多数${i}`,
        createdAt: isoAt(1000 + i),
      });
    }
    const { items } = await list(cw.w.memberD1.id, "joined", "active", 120);
    for (const [i, seeded] of many.entries())
      expect(rowOf(items, seeded.id), seeded.id).toMatchObject({
        lastActivityAt: isoAt(1000 + i),
        channelId: seeded.roomId,
      });
  });
});
