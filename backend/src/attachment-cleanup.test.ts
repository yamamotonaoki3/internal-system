// #140 AC-1（1-6 AC-3・計画「方式」6・「同時の操作」）: 未投稿の添付の掃除を、Workers の入口（index.ts の default.scheduled）から、隔離 D1・手元の R2 に対して確かめる。
// 契約（このテストが固定する）：
//   既存の毎日の Cron（"17 18 * * *"。auth-cleanup と同じ式。wrangler.jsonc の triggers を増やさない）で動く。
//   24時間を過ぎた未投稿の行（message_id IS NULL AND created_at < 境界）を条件付きの DELETE で先に消し、消せた行のキーだけ R2 から消す。
//   24時間以内の未投稿・投稿に結び付いた行（古くても）は消さない（投稿と掃除が重なっても、結び付いた行を消さない）。
//   R2 の削除の失敗は error ログに残す（ログにファイル名・キーを出さない）。行の削除は取り消さない。
// データは架空（testuser_attcron_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../test/attachment-files";
import {
  attachmentRow,
  bucket,
  cleanupAttachmentScenario,
  createThreadWorld,
  failingDeleteBucket,
  seedStoredAttachment,
  storedKeys,
  type ThreadWorld,
} from "../test/attachment-fixtures";
import { seedParent } from "../test/thread-fixtures";
import worker from "./index";

const CRON = "17 18 * * *";
const HOUR = 60 * 60 * 1000;
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
let errorLines: string[];
let logLines: string[];

const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();

const seed = (
  createdAgoMs: number,
  messageId: string | null = null,
  name = "memo.txt",
) =>
  seedStoredAttachment(
    {
      roomId: world.channel,
      uploaderId: world.alice.userId,
      messageId,
      originalName: name,
      createdAt: agoIso(createdAgoMs),
    },
    TEXT_BYTES,
  );

const keyOf = async (id: string) => (await attachmentRow(id))?.storage_key;

beforeEach(async () => {
  errorLines = [];
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errorLines.push(String(line));
  });
  world = await createThreadWorld("attcron");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentScenario();
});

describe("#140 AC-1 未投稿の添付の掃除（Cron）", () => {
  it("#140 AC-1: 24時間を過ぎた未投稿の行と実体を消し、24時間以内の未投稿と、投稿に結び付いた古い行は残す", async () => {
    const message = await seedParent(world.channel, world.alice.userId, 1);
    const old = await seed(24 * HOUR + 60_000);
    const fresh = await seed(24 * HOUR - 60_000);
    const bound = await seed(48 * HOUR, message);
    const freshKey = await keyOf(fresh);
    const boundKey = await keyOf(bound);

    await worker.scheduled(controller(), env, ctx);

    expect(await attachmentRow(old)).toBeNull();
    expect(await attachmentRow(fresh)).not.toBeNull();
    expect(await attachmentRow(bound)).not.toBeNull();
    expect(await storedKeys()).toEqual([freshKey, boundKey].sort());
  });

  it("#140 AC-1: R2 の削除が失敗しても定期実行は成功し（例外を投げない）、行は消え、error ログに残す。ログにファイル名・キーを出さない", async () => {
    const name = "秘密の下書き.txt";
    const old = await seed(25 * HOUR, null, name);
    const key = await keyOf(old);
    // 決定（Issue #140 の実装中の決定）：R2 の削除の失敗は error ログに残し、定期実行の全体は成功させる（例外を投げない）
    await expect(
      Promise.resolve().then(() =>
        worker.scheduled(
          controller(),
          {
            ...env,
            ATTACHMENTS: failingDeleteBucket(bucket()),
          } as unknown as Env,
          ctx,
        ),
      ),
    ).resolves.toBeUndefined();
    expect(await attachmentRow(old)).toBeNull();
    expect(errorLines.length).toBeGreaterThanOrEqual(1);
    const allLogs = [...logLines, ...errorLines].join("\n");
    expect(allLogs).not.toContain(name);
    expect(allLogs).not.toContain(String(key));
  });
});
