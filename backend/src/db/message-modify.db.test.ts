// #134 AC-1（1-3 AC-1・AC-4・AC-6、計画「計画で決めた点」3・4、改訂1 重大1）: メッセージの編集・削除の DB 側を、隔離 D1 で確かめる。
// - migration 0019：messages に edited_at・deleted_at・deleted_by（users.id を参照）を、すべて NULL 可で足す
// - Repository の条件付きの書き込み（updateBodyIfModifiable・deleteIfModifiable）は、本人・未削除・部屋の条件（参加中・未アーカイブ・部署が有効、
//   DM は当事者で相手が有効）を WHERE に持ち、満たさなければ 0 行を返して何も変えない
// - 削除は条件付きの UPDATE と監査 message.delete の batch。監査は削除した行が1行のときだけ1行（onlyWhen）。detail は { roomId } だけで本文を入れない
// - 削除しても本文は DB に残る（EP-1-04「実体は消さない」）
// - 列を足した後も、チャンネル・DM の新しい投稿（insertIfOrdered）が通り、新しい列は NULL（改訂1 重大1）
//
// 実装が前提とする約束（計画「変更するファイル」）：
//   repository.updateBodyIfModifiable({ messageId, userId, body, editedAt }): Promise<number>
//   repository.deleteIfModifiable({ messageId, userId, roomId, deletedAt, traceId }): Promise<number>
// データは架空（testuser_mmdb_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  TEST_TAG,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  archiveChannel,
  cleanupMessageModifyScenario,
  deactivateDepartment,
  deleteAuditRows,
  insertModifyUser,
  leaveChannel,
  markDeleted,
  messageRow,
  modifyTraceId,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { withMessages } from "./message.repository";

let dept: SeededDepartment;
let author: ModifyUser;
let other: ModifyUser;

const ORIGINAL = `${TEST_TAG}DBの本文`;
const EDITED = `${TEST_TAG}DBで直した本文`;
const EDITED_AT = "2026-11-14T01:00:00.000Z";
const DELETED_AT = "2026-11-14T02:00:00.000Z";

const update = (messageId: string, userId = author.userId, body = EDITED) =>
  withMessages(env, (r) =>
    r.updateBodyIfModifiable({ messageId, userId, body, editedAt: EDITED_AT }),
  );

const remove = (messageId: string, roomId: string, userId = author.userId) =>
  withMessages(env, (r) =>
    r.deleteIfModifiable({
      messageId,
      userId,
      roomId,
      deletedAt: DELETED_AT,
      traceId: modifyTraceId(),
    }),
  );

const seed = (roomId: string, senderId = author.userId) =>
  insertMessage({ roomId, senderId, body: ORIGINAL });

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("編集削除DB");
  author = await insertModifyUser("testuser_mmdb_author", dept.id);
  other = await insertModifyUser("testuser_mmdb_other", dept.id);
  await insertMember(dept.dedicatedChannelId, author.userId);
  await insertMember(dept.dedicatedChannelId, other.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageModifyScenario();
});

describe("#134 migration 0019 の列", () => {
  it("#134 AC-1（1-3 AC-1・AC-3・AC-4）: messages に edited_at・deleted_at・deleted_by があり、どれも NULL を許す", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, \"notnull\" AS not_null FROM pragma_table_info('messages')",
    ).all<{ name: string; not_null: number }>();
    const columns = new Map(results.map((r) => [r.name, r.not_null]));
    for (const name of ["edited_at", "deleted_at", "deleted_by"]) {
      expect(columns.has(name), name).toBe(true);
      expect(columns.get(name), name).toBe(0);
    }
  });

  it("#134 AC-1: deleted_by は users.id を外部キーで参照する（存在しない利用者は入れられない）", async () => {
    const { results } = await env.DB.prepare(
      'SELECT "from" AS from_column, "table" AS to_table, "to" AS to_column FROM pragma_foreign_key_list(\'messages\')',
    ).all<{ from_column: string; to_table: string; to_column: string }>();
    expect(results).toContainEqual({
      from_column: "deleted_by",
      to_table: "users",
      to_column: "id",
    });
    const id = await seed(dept.dedicatedChannelId);
    await expect(
      env.DB.prepare("UPDATE messages SET deleted_by = ? WHERE id = ?")
        .bind("01JNOUSER00000000000000000", id)
        .run(),
    ).rejects.toThrow();
  });

  it("#134 AC-1: 既存の行（列を足す前の形で入れた行）は、3つの列が NULL のまま読める", async () => {
    const id = await seed(dept.dedicatedChannelId);
    expect(await messageRow(id)).toMatchObject({
      body: ORIGINAL,
      edited_at: null,
      deleted_at: null,
      deleted_by: null,
    });
  });
});

describe("#134 改訂1 重大1：列を足した後の新しい投稿（insertIfOrdered）", () => {
  it("#134 AC-1（改訂1 重大1）: チャンネルへの新しい投稿（API）は 201 で、新しい列は NULL", async () => {
    const response = await apiRequest(
      "POST",
      `/api/rooms/${dept.dedicatedChannelId}/messages`,
      { token: author.token, body: { body: `${TEST_TAG}列の追加の後` } },
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await messageRow(id)).toMatchObject({
      body: `${TEST_TAG}列の追加の後`,
      sender_id: author.userId,
      edited_at: null,
      deleted_at: null,
      deleted_by: null,
    });
  });

  it("#134 AC-1（改訂1 重大1）: DM への新しい投稿（API）は 201 で、新しい列は NULL", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const response = await apiRequest("POST", `/api/rooms/${roomId}/messages`, {
      token: author.token,
      body: { body: `${TEST_TAG}DMの列の追加の後` },
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await messageRow(id)).toMatchObject({
      room_id: roomId,
      edited_at: null,
      deleted_at: null,
      deleted_by: null,
    });
  });

  it("#134 AC-1（改訂1 重大1）: insertIfOrdered を直接呼んでも 1 行入り、順序の保証（ID が部屋の最大以下なら 0 行）は変わらない", async () => {
    const first = ulidAt(1_900_000_000_000);
    const inserted = await withMessages(env, (r) =>
      r.insertIfOrdered({
        id: first,
        roomId: dept.dedicatedChannelId,
        senderId: author.userId,
        senderDisplayName: "テスト太郎",
        body: `${TEST_TAG}直接`,
      }),
    );
    expect(inserted).toBe(1);
    const older = await withMessages(env, (r) =>
      r.insertIfOrdered({
        id: ulidAt(1_800_000_000_000),
        roomId: dept.dedicatedChannelId,
        senderId: author.userId,
        senderDisplayName: "テスト太郎",
        body: `${TEST_TAG}古いID`,
      }),
    );
    expect(older).toBe(0);
    expect(await messageRow(first)).toMatchObject({
      edited_at: null,
      deleted_at: null,
      deleted_by: null,
    });
  });
});

describe("#134 AC-1 条件付きの編集（updateBodyIfModifiable）", () => {
  it("#134 AC-1（1-3 AC-1）: 本人・未削除・参加中・部署が有効なら 1 行を更新し、本文と edited_at が変わる", async () => {
    const id = await seed(dept.dedicatedChannelId);
    expect(await update(id)).toBe(1);
    expect(await messageRow(id)).toMatchObject({
      body: EDITED,
      edited_at: EDITED_AT,
      deleted_at: null,
    });
  });

  it.each([
    ["他人の投稿（本人でない）", "other"],
    ["削除済み", "deleted"],
    ["公開チャンネルを抜けた", "left"],
    ["アーカイブ済み", "archived"],
    ["部署が無効", "inactive"],
    ["存在しないメッセージ", "missing"],
  ] as const)(
    "#134 AC-1（計画 3）: %s なら 0 行で、本文・edited_at は変わらない",
    async (_label, kind) => {
      const id = await seed(dept.dedicatedChannelId);
      if (kind === "deleted") await markDeleted(id, author.userId);
      if (kind === "left")
        await leaveChannel(dept.dedicatedChannelId, author.userId);
      if (kind === "archived") await archiveChannel(dept.dedicatedChannelId);
      if (kind === "inactive") await deactivateDepartment(dept.id);
      const target = kind === "missing" ? "01JNOMSG000000000000000000" : id;
      const userId = kind === "other" ? other.userId : author.userId;
      expect(await update(target, userId)).toBe(0);
      expect(await messageRow(id)).toMatchObject({
        body: ORIGINAL,
        edited_at: null,
      });
    },
  );

  it("#134 AC-1（U-3・C-168(2)）: DM では、当事者の本人なら 1 行、相手が無効なら 0 行", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const ok = await seed(roomId);
    expect(await update(ok)).toBe(1);
    const blocked = await seed(roomId);
    await deactivateUser(other.userId);
    expect(await update(blocked)).toBe(0);
    expect((await messageRow(blocked))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1: SQL の特殊文字を含む本文も、値として保存される（SQL の一部にならない）", async () => {
    const id = await seed(dept.dedicatedChannelId);
    const text = "'); DELETE FROM messages; --";
    expect(await update(id, author.userId, text)).toBe(1);
    expect((await messageRow(id))?.body).toBe(text);
  });
});

describe("#134 AC-1（1-3 AC-4）条件付きの削除と監査（deleteIfModifiable）", () => {
  it("#134 AC-1（計画 4）: 削除できれば 1 行を返し、deleted_at・deleted_by が入り、本文は DB に残る", async () => {
    const id = await seed(dept.dedicatedChannelId);
    expect(await remove(id, dept.dedicatedChannelId)).toBe(1);
    expect(await messageRow(id)).toMatchObject({
      body: ORIGINAL,
      deleted_at: DELETED_AT,
      deleted_by: author.userId,
    });
  });

  it("#134 AC-1（計画 4・project-rules）: 削除と同じ batch で監査 message.delete が1行でき、detail は { roomId } だけで本文を含まない", async () => {
    const id = await seed(dept.dedicatedChannelId);
    await remove(id, dept.dedicatedChannelId);
    const audits = await deleteAuditRows(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: author.userId,
      action: "message.delete",
      target_type: "message",
      target_id: id,
      result: "success",
    });
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      roomId: dept.dedicatedChannelId,
    });
    expect(audits[0]?.detail ?? "").not.toContain(ORIGINAL);
  });

  it("#134 AC-1（計画 4）: 2回目の削除は 0 行で、deleted_at は最初のまま、監査は増えない（0 行の更新では監査を残さない）", async () => {
    const id = await seed(dept.dedicatedChannelId);
    expect(await remove(id, dept.dedicatedChannelId)).toBe(1);
    const before = await messageRow(id);
    expect(await remove(id, dept.dedicatedChannelId)).toBe(0);
    expect(await messageRow(id)).toEqual(before);
    expect(await deleteAuditRows(id)).toHaveLength(1);
  });

  it.each([
    ["他人の投稿（本人でない）", "other"],
    ["公開チャンネルを抜けた", "left"],
    ["アーカイブ済み", "archived"],
    ["部署が無効", "inactive"],
  ] as const)(
    "#134 AC-1（計画 3・4）: %s なら 0 行で、削除の列は NULL のまま、監査も残らない",
    async (_label, kind) => {
      const id = await seed(dept.dedicatedChannelId);
      if (kind === "left")
        await leaveChannel(dept.dedicatedChannelId, author.userId);
      if (kind === "archived") await archiveChannel(dept.dedicatedChannelId);
      if (kind === "inactive") await deactivateDepartment(dept.id);
      const userId = kind === "other" ? other.userId : author.userId;
      expect(await remove(id, dept.dedicatedChannelId, userId)).toBe(0);
      expect(await messageRow(id)).toMatchObject({
        body: ORIGINAL,
        deleted_at: null,
        deleted_by: null,
      });
      expect(await deleteAuditRows(id)).toEqual([]);
    },
  );

  it("#134 AC-1（U-3・C-168(2)）: DM では、当事者の本人なら 1 行と監査1行、相手が無効なら 0 行で監査なし", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const ok = await seed(roomId);
    expect(await remove(ok, roomId)).toBe(1);
    expect(await deleteAuditRows(ok)).toHaveLength(1);
    const blocked = await seed(roomId);
    await deactivateUser(other.userId);
    expect(await remove(blocked, roomId)).toBe(0);
    expect(await deleteAuditRows(blocked)).toEqual([]);
  });

  it("#134 AC-1（計画 5）: 削除済みの行への編集は 0 行で、本文は削除の前のまま（削除済みの本文が書き換わらない）", async () => {
    const id = await seed(dept.dedicatedChannelId);
    await remove(id, dept.dedicatedChannelId);
    expect(await update(id)).toBe(0);
    expect(await messageRow(id)).toMatchObject({
      body: ORIGINAL,
      edited_at: null,
    });
  });

  it("#134 AC-1（壊すテスト）: 同じ削除を同時に3回実行しても、1 行だけが削除になり、監査は1行", async () => {
    const id = await seed(dept.dedicatedChannelId);
    const results = await Promise.all(
      [0, 1, 2].map(() => remove(id, dept.dedicatedChannelId)),
    );
    expect(results.sort()).toEqual([0, 0, 1]);
    expect(await deleteAuditRows(id)).toHaveLength(1);
  });
});
