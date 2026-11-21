// #270（270-A）AC-5・計画 4.4「再試行（定期の処理）」：削除済みの添付の後始末（attachmentPurgeJob）を、隔離 D1・手元の R2 で確かめる（結合）。
// 決まり（計画 4.4）：
//   - 既存の毎日の Cron（"17 18 * * *"。日本時間 03:17）に相乗りする（index.ts の createScheduledHandler に登録。wrangler.jsonc は変えない）
//   - 対象は deleted_at が入った行だけ。行ごとに R2 の delete → `DELETE … WHERE id = ? AND deleted_at IS NOT NULL`（印 → 実体 → 行の順）
//   - キー (deleted_at, id) の昇順に読む。1ページ 100 行。次のページは直前のページの最後のキーより後（同じ時刻の行は id で区切る）
//   - 1回の実行で試す行は 500 行まで（失敗した行も数える）。上限で止めたら、残りは次の回。失敗した行を同じ実行で2回試さない
//   - R2 の失敗は数えて error ログ（キー・名前を出さない）、次の行へ進む。D1 の失敗は投げる
//   - べき等：何度実行しても同じ結果。同時に2つ動いても壊れない（片方が0行になるだけ）
//   - 終わりに info ログで件数
// 契約（実装前の仮置き。実装の担当へ）：backend/src/services/attachment.service.ts
//   attachmentPurgeJob(): CronJob（cron: "17 18 * * *"）
//   info ログの attributes：readRows・purgedRows・failedObjects・reachedLimit（このテストが名前を決める）
// データは架空（testuser_attpurge_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  cleanupAttachmentDeleteScenario,
  deletionOf,
  failingStatementDb,
  jsonLogs,
  recordingBucket,
} from "../../test/attachment-delete-fixtures";
import {
  STORAGE_PREFIX,
  attachmentRow,
  bucket,
  createThreadWorld,
  insertAttachmentRow,
  putObject,
  storedKeys,
  type ThreadWorld,
} from "../../test/attachment-fixtures";
import { ulidAt } from "../../test/message-fixtures";
import { seedParent } from "../../test/thread-fixtures";
import worker from "../index";
import { attachmentPurgeJob } from "./attachment.service";

const CRON = "17 18 * * *";
const BASE_MS = 1_896_000_000_000;
const controller = () =>
  ({
    cron: CRON,
    scheduledTime: Date.now(),
    type: "scheduled",
  }) as unknown as ScheduledController;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

let world: ThreadWorld;
let messageId: string;
let logLines: string[];
let errorLines: string[];

const isoAt = (seconds: number) =>
  new Date(BASE_MS + seconds * 1_000).toISOString();

/**
 * 削除済みの行を直接入れる（ID は n の昇順。deletedAt は行ごとに指定）。withObjects が真なら R2 にも実体を入れる。
 * 入れた行の { id, key } を ID の昇順で返す。
 */
async function seedDeleted(
  count: number,
  deletedAtOf: (n: number) => string,
  options: { withObjects?: boolean; offset?: number } = {},
) {
  const rows: { id: string; key: string }[] = [];
  const offset = options.offset ?? 0;
  for (let start = 0; start < count; start += 50) {
    const statements: D1PreparedStatement[] = [];
    for (let i = start; i < Math.min(start + 50, count); i += 1) {
      const n = offset + i;
      const id = ulidAt(BASE_MS + 10_000_000 + n);
      const key = `${STORAGE_PREFIX}${id}`;
      rows.push({ id, key });
      statements.push(
        env.DB.prepare(
          `INSERT INTO message_attachments (id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at, deleted_at, deleted_by)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'document', 'text/plain; charset=utf-8', 10, ?, ?, ?)`,
        ).bind(
          id,
          world.channel,
          messageId,
          world.alice.userId,
          key,
          `[UNIT_TEST]消した添付${n}.txt`,
          isoAt(0),
          deletedAtOf(n),
          world.alice.userId,
        ),
      );
    }
    await env.DB.batch(statements);
  }
  if (options.withObjects === true)
    for (const row of rows) await putObject(row.key, TEXT_BYTES);
  return rows;
}

async function remainingDeletedIds(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM message_attachments WHERE deleted_at IS NOT NULL ORDER BY id",
  ).all<{ id: string }>();
  return results.map((r) => r.id);
}

async function runJob(overrides: Record<string, unknown> = {}) {
  await attachmentPurgeJob().run({ ...env, ...overrides } as unknown as Env);
}

const purgeInfo = () =>
  jsonLogs(logLines).filter(
    (line) =>
      (line.body ?? "").includes("attachment-purge") &&
      line.attributes?.readRows !== undefined,
  );

beforeEach(async () => {
  logLines = [];
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errorLines.push(String(line));
  });
  world = await createThreadWorld("attpurge");
  messageId = await seedParent(world.channel, world.alice.userId, 1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentDeleteScenario();
});

describe("#270 AC-5 後始末のジョブの登録と対象", () => {
  it("#270 AC-5: 既存の毎日の Cron（17 18 * * *）で、削除済みの行の実体と行を消す。削除されていない行・未投稿の行は残す", async () => {
    expect(attachmentPurgeJob().cron).toBe(CRON);
    const [deleted] = await seedDeleted(1, () => isoAt(1), {
      withObjects: true,
    });
    const live = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId,
    });
    const pending = await insertAttachmentRow({
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId: null,
    });
    const liveKey = (await attachmentRow(live))?.storage_key ?? "";
    await putObject(liveKey, TEXT_BYTES);

    await worker.scheduled(controller(), env, ctx);

    expect(await attachmentRow(deleted?.id ?? "")).toBeNull();
    expect(await attachmentRow(live)).not.toBeNull();
    expect(await attachmentRow(pending)).not.toBeNull();
    expect(await storedKeys()).toEqual([liveKey]);
  });

  it("#270 AC-5: 対象が0行なら R2 を呼ばず、info ログに件数0を残す", async () => {
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toEqual([]);
    expect(purgeInfo()).toHaveLength(1);
    expect(purgeInfo()[0]?.attributes).toMatchObject({
      readRows: 0,
      purgedRows: 0,
      failedObjects: 0,
      reachedLimit: false,
    });
  });

  it("#270 AC-5: 終わりに info ログで、読んだ行数・消せた行数・R2 の失敗の数・上限で止めたかを残す", async () => {
    const rows = await seedDeleted(3, (n) => isoAt(n), { withObjects: true });
    const recorded = recordingBucket(bucket(), (key) => key === rows[1]?.key);
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(purgeInfo()[0]?.attributes).toMatchObject({
      readRows: 3,
      purgedRows: 2,
      failedObjects: 1,
      reachedLimit: false,
    });
  });
});

describe("#270 AC-5 べき等・失敗・同時の実行", () => {
  it("#270 AC-5: 2回実行しても同じ結果で、2回目は R2 を呼ばない", async () => {
    await seedDeleted(3, (n) => isoAt(n), { withObjects: true });
    await runJob();
    expect(await remainingDeletedIds()).toEqual([]);
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toEqual([]);
    expect(await storedKeys()).toEqual([]);
  });

  it("#270 AC-5: R2 の削除が失敗した行は、印つきで残り（ほかの行は消える）、error ログにキー・名前を出さない。次の回に消える", async () => {
    const rows = await seedDeleted(3, (n) => isoAt(n), { withObjects: true });
    const failing = rows[1];
    const recorded = recordingBucket(bucket(), (key) => key === failing?.key);
    await expect(
      runJob({ ATTACHMENTS: recorded.bucket }),
    ).resolves.toBeUndefined();
    expect(await remainingDeletedIds()).toEqual([failing?.id]);
    expect((await deletionOf(failing?.id ?? ""))?.deleted_at).not.toBeNull();
    expect(errorLines.length).toBeGreaterThanOrEqual(1);
    const logs = [...logLines, ...errorLines].join("\n");
    expect(logs).not.toContain(failing?.key ?? "");
    expect(logs).not.toContain("[UNIT_TEST]消した添付1.txt");
    await runJob();
    expect(await remainingDeletedIds()).toEqual([]);
    expect(await storedKeys()).toEqual([]);
  });

  it("#270 AC-5: 実体の削除の後に、行の削除（D1）が失敗すると、ジョブは失敗を投げる。行は残り、次の回に消える（ないキーの削除も成功する）", async () => {
    const [row] = await seedDeleted(1, () => isoAt(1), { withObjects: true });
    const failing = failingStatementDb(
      env.DB,
      /delete\s+from\s+["`]?message_attachments/i,
    );
    await expect(runJob({ DB: failing.db })).rejects.toBeDefined();
    expect(await storedKeys()).toEqual([]);
    expect(await remainingDeletedIds()).toEqual([row?.id]);
    await runJob();
    expect(await remainingDeletedIds()).toEqual([]);
  });

  it("#270 AC-5: 同時に2つ実行しても、どちらも成功し、すべての行と実体が消える", async () => {
    await seedDeleted(30, (n) => isoAt(n), { withObjects: true });
    await expect(Promise.all([runJob(), runJob()])).resolves.toBeDefined();
    expect(await remainingDeletedIds()).toEqual([]);
    expect(await storedKeys()).toEqual([]);
  });

  it("#270 AC-5（Miniflare）: ないキーの R2 の delete は例外にならない", async () => {
    await expect(
      bucket().delete(`${STORAGE_PREFIX}[UNIT_TEST]no-such-key`),
    ).resolves.toBeUndefined();
  });
});

describe("#270 AC-5 計画 4.4 進め方（(deleted_at, id) の順・1ページ100行・1回500行）", () => {
  it("#270 AC-5: 同じ deleted_at の行が2ページにまたがっても（150行）、漏れも重複もなく、1行1回だけ試す", async () => {
    const rows = await seedDeleted(150, () => isoAt(5));
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toHaveLength(150);
    expect(new Set(recorded.deletes).size).toBe(150);
    expect(await remainingDeletedIds()).toEqual([]);
    expect([...recorded.deletes].sort()).toEqual(rows.map((r) => r.key).sort());
  });

  it("#270 AC-5: 失敗した行を、同じ実行の中で2回試さない（150行すべて失敗しても、delete は150回）", async () => {
    await seedDeleted(150, () => isoAt(5));
    const recorded = recordingBucket(bucket(), () => true);
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toHaveLength(150);
    expect(new Set(recorded.deletes).size).toBe(150);
    expect(await remainingDeletedIds()).toHaveLength(150);
  });

  it("#270 AC-5: 1回の実行は500行まで。(deleted_at, id) の順で、最後の1行（deleted_at が最も新しい行）は次の回に消える", async () => {
    // ID の最も小さい行の deleted_at を最も新しくする（id ではなく deleted_at が先の順であることを確かめる）
    const rows = await seedDeleted(501, (n) =>
      n === 0 ? isoAt(10_000) : isoAt(n),
    );
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toHaveLength(500);
    expect(await remainingDeletedIds()).toEqual([rows[0]?.id]);
    expect(purgeInfo()[0]?.attributes).toMatchObject({
      readRows: 500,
      reachedLimit: true,
    });
    await runJob();
    expect(await remainingDeletedIds()).toEqual([]);
  });

  it("#270 AC-5: 失敗した行も上限に数える（501行すべて失敗すると、delete は500回で止まる）", async () => {
    await seedDeleted(501, (n) => isoAt(n));
    const recorded = recordingBucket(bucket(), () => true);
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toHaveLength(500);
    expect(await remainingDeletedIds()).toHaveLength(501);
  });

  it("#270 AC-5: ちょうど500行なら、1回で全部消え、上限で止めていない", async () => {
    await seedDeleted(500, (n) => isoAt(n));
    await runJob();
    expect(await remainingDeletedIds()).toEqual([]);
    expect(purgeInfo()[0]?.attributes).toMatchObject({ readRows: 500 });
  });
});
