// #148（148-B-2）5-2 AC-8・計画 6.2（D1・D8）：message_attachments に公開範囲の列 publication_visibility を足す migration（0030）の形を、
// マイグレーション済みの隔離 D1 で確かめる。
// この層で確かめるもの：列がある・NOT NULL・既定値が participants_only（値を指定しない INSERT は participants_only）・CHECK が2値以外
// （空文字・大文字違い・前後の空白・ほかの語）と NULL を拒否する・Drizzle のスキーマ（backend/db/schema.ts）の列と一致する・既存の列が変わらない。
// 既存の行がある状態からの更新の試験は attachment-publication.upgrade.db.test.ts で確かめる。
// 期待値は要件から直接書く（shared の定義から作らない）。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messageAttachments } from "../../db/schema";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
import { publicationVisibilityOf } from "../../test/case-attachment-fixtures";
import {
  cleanupCaseRoomWorld,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
};

let cw: CaseRoomWorld;

async function columns(): Promise<ColumnInfo[]> {
  const { results } = await env.DB.prepare(
    "PRAGMA table_info(message_attachments)",
  ).all<ColumnInfo>();
  return results;
}

/** 値を指定して1行入れる（成功なら ID を返す。CHECK の違反なら例外） */
async function insertWith(value: string | null): Promise<string> {
  const id = await insertAttachmentRow({
    roomId: cw.open.roomId,
    uploaderId: cw.w.memberS1.id,
  });
  await env.DB.prepare(
    "UPDATE message_attachments SET publication_visibility = ? WHERE id = ?",
  )
    .bind(value, id)
    .run();
  return id;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1630);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 AC-8 migration：message_attachments.publication_visibility", () => {
  it("#148 AC-8 D1: 列があり、TEXT・NOT NULL・既定値 'participants_only'", async () => {
    const column = (await columns()).find(
      (c) => c.name === "publication_visibility",
    );
    expect(column).toBeDefined();
    expect(column?.type.toLowerCase()).toBe("text");
    expect(column?.notnull).toBe(1);
    expect(column?.dflt_value).toBe("'participants_only'");
  });

  it("#148 AC-8 D2: 既存の列（#140 の11列）は変わらず、足したのは publication_visibility の1列だけ", async () => {
    // #270 計画 4.7（migration 0036）で deleted_at・deleted_by・purge_failed_at の3列が足された（purge_failed_at はコードレビューの指摘1の直し）。それ以外の増減はないこと
    expect((await columns()).map((c) => c.name).sort()).toEqual(
      [
        "deleted_at",
        "deleted_by",
        "purge_failed_at",
        "id",
        "room_id",
        "thread_parent_id",
        "message_id",
        "uploader_id",
        "storage_key",
        "original_name",
        "kind",
        "content_type",
        "size_bytes",
        "created_at",
        "publication_visibility",
      ].sort(),
    );
  });

  it("#148 AC-8 D2: 値を指定しない INSERT（既存の書き方）は participants_only になる", async () => {
    const id = await insertAttachmentRow({
      roomId: cw.normal,
      uploaderId: cw.w.memberS1.id,
    });
    expect(await publicationVisibilityOf(id)).toBe("participants_only");
  });

  it.each(["participants_only", "public_archive"])(
    "#148 AC-8 D1: CHECK は %s を受け付ける",
    async (value) => {
      const id = await insertWith(value);
      expect(await publicationVisibilityOf(id)).toBe(value);
    },
  );

  it.each([
    ["空文字", ""],
    ["大文字違い", "PUBLIC_ARCHIVE"],
    ["前後の空白", " participants_only"],
    ["ほかの語", "public"],
    ["NULL", null],
  ])("#148 AC-8 D1: CHECK・NOT NULL は %s を拒否する", async (_l, value) => {
    await expect(insertWith(value)).rejects.toThrow();
  });

  it("#148 AC-8 D1: Drizzle のスキーマにも列があり、名前・NOT NULL・既定値が migration と一致する", () => {
    const column = (
      getTableColumns(messageAttachments) as Record<
        string,
        { name: string; notNull: boolean; default: unknown } | undefined
      >
    ).publicationVisibility;
    expect(column).toBeDefined();
    expect(column?.name).toBe("publication_visibility");
    expect(column?.notNull).toBe(true);
    expect(column?.default).toBe("participants_only");
  });
});

describe("#270 指摘1 migration 0036：message_attachments.purge_failed_at", () => {
  it("#270 指摘1: 列があり、TEXT・NULL 可・既定値なし（実体の削除に最後に失敗した時刻。失敗していない行は NULL）", async () => {
    const column = (await columns()).find((c) => c.name === "purge_failed_at");
    expect(column).toBeDefined();
    expect(column?.type.toLowerCase()).toBe("text");
    expect(column?.notnull).toBe(0);
    expect(column?.dflt_value).toBeNull();
  });

  it("#270 指摘1: 値を指定しない INSERT（既存の書き方）は purge_failed_at が NULL になる", async () => {
    const id = await insertAttachmentRow({
      roomId: cw.normal,
      uploaderId: cw.w.memberS1.id,
    });
    const row = await env.DB.prepare(
      "SELECT purge_failed_at FROM message_attachments WHERE id = ?",
    )
      .bind(id)
      .first<{ purge_failed_at: string | null }>();
    expect(row).not.toBeNull();
    expect(row?.purge_failed_at).toBeNull();
  });

  it("#270 指摘1: Drizzle のスキーマにも列があり、名前・NULL 可が migration と一致する", () => {
    const column = (
      getTableColumns(messageAttachments) as Record<
        string,
        { name: string; notNull: boolean } | undefined
      >
    ).purgeFailedAt;
    expect(column).toBeDefined();
    expect(column?.name).toBe("purge_failed_at");
    expect(column?.notNull).toBe(false);
  });
});
