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
  markPurgeFailed,
  purgeStateOf,
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

// ---- コードレビューの指摘1：失敗し続ける行が、後ろの行に進むのを止めない ----
// 根拠：Issue #270 のコードレビューの指摘1と、決めた直し方。
//   - 列 purge_failed_at（text・NULL 可。実体の削除に最後に失敗した時刻）を足す（migration 0036 を作り直して3列にする）
//   - 失敗した行には purge_failed_at に、その時刻を書く（deleted_at・deleted_by は変えない）
//   - 定期の処理は「失敗したことのない行を (deleted_at, id) の順に先に。その後に、失敗したことのある行を purge_failed_at の古い順」に読む
//   - 失敗した行も、次の回以降に、もう一度試される
// 読む順の SQL の書き方は写さず、動き（どの行がいつ消えるか・R2 の delete の呼ばれた順）で確かめる。
// 1回の上限は 500 行（上の「1回の実行は500行まで」の既存のテストが、本番の値が 500 であることを確かめている。ここでは同じ値をテストの側で書く）。
const RUN_LIMIT = 500;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("#270 指摘1 失敗し続ける行が、後ろの行を永久に止めない", () => {
  it("#270 指摘1・AC-5: 先頭の500行（上限と同じ数）の実体の削除が必ず失敗しても、その後ろの消せる行は、2回目の実行で、R2 からも表からも消える。失敗する行は表に残る", async () => {
    const failing = await seedDeleted(RUN_LIMIT, (n) => isoAt(n));
    const failingKeys = new Set(failing.map((row) => row.key));
    const [healthy] = await seedDeleted(1, () => isoAt(RUN_LIMIT + 10), {
      withObjects: true,
      offset: RUN_LIMIT,
    });
    if (healthy === undefined) throw new Error("消せる行を作れませんでした");

    const first = recordingBucket(bucket(), (key) => failingKeys.has(key));
    await runJob({ ATTACHMENTS: first.bucket });
    // 1回目は上限を使い切っていてよい（消せる行が残っていてもよい）。何も壊れていないことだけを確かめる
    expect(first.deletes.length).toBeLessThanOrEqual(RUN_LIMIT);

    const second = recordingBucket(bucket(), (key) => failingKeys.has(key));
    await runJob({ ATTACHMENTS: second.bucket });
    expect(second.deletes).toContain(healthy.key);
    expect(await attachmentRow(healthy.id)).toBeNull();
    expect(await storedKeys()).not.toContain(healthy.key);
    // 失敗する行は、表に残り、印（deleted_at）も残る（見えないまま）
    const remaining = await remainingDeletedIds();
    expect(remaining).toHaveLength(RUN_LIMIT);
    expect([...remaining].sort()).toEqual(failing.map((row) => row.id).sort());
  });

  it("#270 指摘1・AC-5: 実体の削除に失敗したことのある行も、次の回に、もう一度試される（成功すれば、R2 からも表からも消える）", async () => {
    const [row] = await seedDeleted(1, () => isoAt(1), { withObjects: true });
    if (row === undefined) throw new Error("行を作れませんでした");
    await markPurgeFailed(row.id, "2026-01-01T00:00:00.000Z");
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toEqual([row.key]);
    expect(await attachmentRow(row.id)).toBeNull();
    expect(await storedKeys()).toEqual([]);
  });

  it("#270 指摘1・AC-5: 失敗した1回目の次の回で、行を試す順は『失敗したことのない行（deleted_at の順）→ 失敗したことのある行（失敗の時刻の古い順）』", async () => {
    // A：最も古い deleted_at。失敗した時刻は新しい／B：次に古い deleted_at。失敗した時刻は古い／C：最も新しい deleted_at。失敗したことがない
    const [a, b, c] = await seedDeleted(3, (n) => isoAt(n + 1));
    if (a === undefined || b === undefined || c === undefined)
      throw new Error("行を作れませんでした");
    await markPurgeFailed(a.id, "2026-02-02T00:00:00.000Z");
    await markPurgeFailed(b.id, "2026-01-01T00:00:00.000Z");
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toEqual([c.key, b.key, a.key]);
  });

  it("#270 指摘1・AC-5: 失敗したことのない行どうしは、これまでどおり (deleted_at, id) の昇順に試す", async () => {
    // ID の最も小さい行の deleted_at を最も新しくして、id ではなく deleted_at が先であることを確かめる
    const rows = await seedDeleted(3, (n) => (n === 0 ? isoAt(100) : isoAt(n)));
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    expect(recorded.deletes).toEqual([
      rows[1]?.key,
      rows[2]?.key,
      rows[0]?.key,
    ]);
  });
});

describe("#270 指摘1 失敗の記録（purge_failed_at）", () => {
  it("#270 指摘1・AC-5: 実体の削除に失敗した行には purge_failed_at が入り、deleted_at・deleted_by は変わらない。成功した行は表から消える", async () => {
    const rows = await seedDeleted(3, (n) => isoAt(n + 1), {
      withObjects: true,
    });
    const failed = rows[1];
    if (failed === undefined) throw new Error("行を作れませんでした");
    const before = await purgeStateOf(failed.id);
    expect(before?.purge_failed_at).toBeNull();
    const startedAt = Date.now();
    const recorded = recordingBucket(bucket(), (key) => key === failed.key);
    await runJob({ ATTACHMENTS: recorded.bucket });
    const finishedAt = Date.now();

    const after = await purgeStateOf(failed.id);
    expect(after?.deleted_at).toBe(before?.deleted_at);
    expect(after?.deleted_by).toBe(before?.deleted_by);
    expect(after?.purge_failed_at).toMatch(ISO);
    const failedMs = Date.parse(after?.purge_failed_at ?? "");
    expect(failedMs).toBeGreaterThanOrEqual(startedAt);
    expect(failedMs).toBeLessThanOrEqual(finishedAt);
    for (const row of [rows[0], rows[2]])
      expect(await attachmentRow(row?.id ?? "")).toBeNull();
  });

  it("#270 指摘1・AC-5: 前にも失敗した行が、また失敗すると、purge_failed_at は新しい時刻になる（deleted_at は変わらない）", async () => {
    const [row] = await seedDeleted(1, () => isoAt(1), { withObjects: true });
    if (row === undefined) throw new Error("行を作れませんでした");
    const old = "2026-01-01T00:00:00.000Z";
    await markPurgeFailed(row.id, old);
    const recorded = recordingBucket(bucket(), () => true);
    await runJob({ ATTACHMENTS: recorded.bucket });
    const after = await purgeStateOf(row.id);
    expect(after?.purge_failed_at).toMatch(ISO);
    expect(Date.parse(after?.purge_failed_at ?? "")).toBeGreaterThan(
      Date.parse(old),
    );
    expect(after?.deleted_at).toBe(isoAt(1));
  });

  it("#270 指摘1・AC-5: 失敗していない（成功した）実行では、まだ試していない行の purge_failed_at は NULL のまま", async () => {
    // 1回の上限で試されなかった行に、失敗の印を付けない
    const rows = await seedDeleted(RUN_LIMIT + 1, (n) => isoAt(n + 1));
    const recorded = recordingBucket(bucket());
    await runJob({ ATTACHMENTS: recorded.bucket });
    const left = rows.find((row) => !recorded.deletes.includes(row.key));
    if (left === undefined) throw new Error("試されなかった行がありません");
    expect((await purgeStateOf(left.id))?.purge_failed_at).toBeNull();
  });
});
