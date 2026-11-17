// #147（147-C-1）コードレビュー1回目の重大への対応：資格の確認の「後」、中身の取得の「前」に無効化が確定する順を検出する。
// C-182(10)：中身を読む SQL そのものに、閲覧者のその時点の資格を入れる（または、資格の確認と中身の取得を同じ db.batch で行う）。
// 挟み方（関数の名前に依存しない形。message.modify-race.test.ts の「本物の Repository を包む」先例に合わせる）：
//   - 本物の Repository（隔離 D1）のすべての関数を Proxy で包み、呼ばれた順に数える
//   - k 回目の呼び出しが返った直後に、閲覧者を無効にする（参加の行は残す。147-C-2 の後の状態）
//   - k は 1 から「割り込みなしで呼ばれる回数 − 1」まで、すべて試す（どの読み取りが資格の確認でも、その直後を必ず含む）
//   - 無効化の「後に始まった」呼び出しの戻り値に、非公開の本文・添付の ID と名前・参加者の ID と表示名が含まれないこと
//     （無効化より前に読んだものは、その時点で資格があったので対象にしない。直し方が「同じ batch」でも「SQL の条件」でも同じ観測で確かめられる）
// 権限の判定（authorizer）は、すべて許す偽物（無効化より前に通ったものとして扱う）。
// スレッドの一覧（Repository の読み取りが1回だけ）と添付の配信（Repository を Service の中で作る）は、挟む場所がないため、
// channel-member.active-reads.db.test.ts の SQL の層で確かめている。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { withChannels, type ChannelRepository } from "../db/channel.repository";
import { withMessages, type MessageRepository } from "../db/message.repository";
import { withRoleAssignments } from "../db/role-assignment.repository";
import { createUlidFactory } from "../lib/ulid";
import { createChannelService } from "./channel.service";
import { createMessageService } from "./message.service";

/** 同じ ms には必ず同じ ID を返す（乱数の部分を 0 に固定する） */
function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

const AT = "2026-11-17T03:00:00.000Z";
const BEFORE_ALL_ID = fixedIdAt(1_863_000_000_000);
const ROOT_ID = fixedIdAt(1_863_000_001_000);
const REPLY_ID = fixedIdAt(1_863_000_002_000);
const ATTACHMENT_ID = fixedIdAt(1_863_000_003_000);
const SECRET_BODY = "[UNIT_TEST]非公開の本文";
const SECRET_FILE = "[UNIT_TEST]非公開の資料.txt";
const OTHER_NAME = "テスト参加者B";

let w: CaseWorld;
let room: SeededCase;

type Actor = {
  userId: string;
  traceId: string;
  reauthenticatedAt: string | null;
};
const actorOf = (userId: string): Actor => ({
  userId,
  traceId: casereqTraceId(),
  reauthenticatedAt: new Date().toISOString(),
});

/** 非公開の中身（本文・添付の ID と名前・ほかの参加者の ID と表示名）を含むか */
function leaks(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = JSON.stringify(value);
  return [
    SECRET_BODY,
    ATTACHMENT_ID,
    SECRET_FILE,
    w.memberS2.id,
    OTHER_NAME,
  ].some((secret) => text.includes(secret));
}

type Recorder = {
  /** 呼ばれた回数 */
  calls: number;
  /** 無効化の後に始まった呼び出しの、関数の名前と戻り値 */
  after: { name: string; value: unknown }[];
};

/**
 * Repository のすべての関数を包む。interruptAfter 回目の呼び出しが返った直後に、閲覧者を無効にする（参加の行は残す）。
 * 名前で選ばないので、資格の確認に使う関数が変わっても、その直後に挟める。
 */
function interleave<R extends object>(
  repository: R,
  interruptAfter: number,
  recorder: Recorder,
): R {
  let interrupted = false;
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const startedAfter = interrupted;
        const result: unknown = await (
          value as (...a: unknown[]) => unknown
        ).apply(target, args);
        recorder.calls += 1;
        if (startedAfter)
          recorder.after.push({ name: String(property), value: result });
        if (recorder.calls === interruptAfter && !interrupted) {
          await setUserActive(w.memberS1.id, false);
          interrupted = true;
        }
        return result;
      };
    },
  });
}

type Operation = {
  name: string;
  run: (interruptAfter: number, recorder: Recorder) => Promise<unknown>;
};

const viaMessages =
  (
    call: (
      service: ReturnType<typeof createMessageService>,
      actor: Actor,
    ) => Promise<unknown>,
  ) =>
  (interruptAfter: number, recorder: Recorder) =>
    withMessages(env, (repository: MessageRepository) =>
      call(
        createMessageService(interleave(repository, interruptAfter, recorder), {
          authorizer: fakeAuthorizer([]),
        }),
        actorOf(w.memberS1.id),
      ),
    );

// 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
const OPERATIONS: Operation[] = [
  {
    name: "メッセージの一覧（最新。listLatest）",
    run: viaMessages((s, a) => s.list(a, room.roomId, { limit: 50 })),
  },
  {
    name: "メッセージの一覧（続き。listAfter）",
    run: viaMessages((s, a) =>
      s.list(a, room.roomId, { after: BEFORE_ALL_ID, limit: 50 }),
    ),
  },
  {
    name: "返信の取得（親の1件の取得 findItem と、返信の最新）",
    run: viaMessages((s, a) => s.listReplies(a, ROOT_ID, { limit: 50 })),
  },
  {
    name: "返信の取得（続き）",
    run: viaMessages((s, a) =>
      s.listReplies(a, ROOT_ID, { after: BEFORE_ALL_ID, limit: 50 }),
    ),
  },
  {
    name: "メンションの候補",
    run: viaMessages((s, a) =>
      s.mentionCandidates(a, room.roomId, { limit: 100 }),
    ),
  },
  {
    name: "チャンネルの詳細（参加者数・参加者の一覧）",
    run: (interruptAfter, recorder) =>
      withChannels(env, (repository: ChannelRepository) =>
        withRoleAssignments(env, (roles) =>
          createChannelService(
            interleave(repository, interruptAfter, recorder),
            roles,
            { authorizer: fakeAuthorizer([]) },
          ).get(actorOf(w.memberS1.id), room.roomId),
        ),
      ),
  },
];

async function settle(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return error;
  }
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  await setDisplayName(w.memberS2.id, OTHER_NAME);
  room = await seedCase({
    n: 34,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]資格の確認の後の無効化",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  const insert = (id: string, parentId: string | null) =>
    env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        room.roomId,
        w.memberS2.id,
        OTHER_NAME,
        SECRET_BODY,
        AT,
        parentId,
      )
      .run();
  await insert(ROOT_ID, null);
  await insert(REPLY_ID, ROOT_ID);
  await insertAttachmentRow({
    id: ATTACHMENT_ID,
    roomId: room.roomId,
    uploaderId: w.memberS2.id,
    messageId: REPLY_ID,
    originalName: SECRET_FILE,
    createdAt: AT,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#147 147-C-1 レビュー1回目：資格の確認の後・中身の取得の前に無効化（参加の行は残す）が確定しても、非公開の中身を読まない", () => {
  it.each(OPERATIONS)(
    "#147 147-C-1 有効な参加者（対）: $name は、割り込みなしなら非公開の中身を返す（空振りしないこと）",
    async ({ run }) => {
      const recorder: Recorder = { calls: 0, after: [] };
      const result = await settle(() => run(0, recorder));
      expect(leaks(result)).toBe(true);
      expect(recorder.calls).toBeGreaterThan(0);
    },
  );

  it.each(OPERATIONS)(
    "#147 147-C-1 C-182(10): $name で、どの読み取りの直後に無効化しても、その後の読み取りは非公開の中身を返さない",
    async ({ run }) => {
      // 割り込みなしで呼ばれる回数を数える
      const baseline: Recorder = { calls: 0, after: [] };
      await settle(() => run(0, baseline));
      const leaked: string[] = [];
      for (let k = 1; k < baseline.calls; k += 1) {
        await setUserActive(w.memberS1.id, true);
        const recorder: Recorder = { calls: 0, after: [] };
        await settle(() => run(k, recorder));
        for (const call of recorder.after)
          if (leaks(call.value)) leaked.push(`${k}回目の後: ${call.name}`);
      }
      expect(leaked).toEqual([]);
    },
  );
});
