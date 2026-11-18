// #297 AC-1：1つの要求の中で、本文（資格つきの最初の読み取り）の後・付随の情報や未読の数を読む前に資格を失う競合を検出する。
// C-182(10)：中身を読む SQL そのものに、閲覧者のその時点の資格を入れる。AC-2：有効な閲覧者の結果は変わらない。
// 挟み方（関数の名前に依存しない形）：
//   - D1（env.DB）を Proxy で包み、prepare() が返す文（bind() の戻りも）の実行（all・raw・first・run）と batch を数える
//   - k 回目の実行が返った直後に、閲覧者の資格を失わせ、失った後に付随の情報を変える（目印の行を直接入れる）
//   - Repository・Service は包んだ D1 から作る（本物の Service・Repository・隔離 D1）
//   - k は 1 から「割り込みなしで実行される文の数 − 1」まですべて試す。各 k の前に同じ初期の状態へ戻す
//   - 資格を失った「後に始まった」文の結果（行）に、目印・失う前からある付随の情報（リアクションの値・メンションの宛先・添付の ID と名前）が含まれず、
//     未読の数が 0 であること。資格を失う前に読んだもの（本文など）は、その時点で資格があったので対象にしない
// 割り込めたことの確認（空振りしない）：割り込みが動いた回数・目印の作成の成功・後段の対象の SQL を見た試行があること。
// DM は、当事者を無効にすると相手も書き込めない（既存の書き込みの条件）ので、目印は隔離 D1 への直接の INSERT で作る（失う前からある情報でも確かめる）。
// 権限の判定（authorizer）は、すべて許す偽物。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { fakeAuthorizer, insertDm } from "../../test/dm-fixtures";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
  insertAttachmentRow,
  insertMentionRow,
  insertMessageRow,
  insertReactionRow,
  reactionIsoAt,
} from "../../test/related-reads-fixtures";
import type { Database } from "../db/database";
import { createMessageRepository } from "../db/message.repository";
import { createReadPositionRepository } from "../db/read-position.repository";
import { createThreadRepository } from "../db/thread.repository";
import { createMessageService } from "./message.service";
import { createThreadService } from "./thread.service";
import { createUnreadService } from "./unread.service";

const id = (n: number) => fixedIdAt(1_867_000_000_000 + n * 1_000);

const DM_ROOM = id(1);
const ROOT = id(10); // 閲覧者 V が親の投稿者のスレッド
const REPLY = id(11);
const TOP2 = id(12);
const NEW_TOP = id(20); // 資格を失った後に、ほかの参加者が新しく投稿する
const NEW_REPLY = id(21);
const ATT_ROOT = id(30);
const ATT_REPLY = id(31);
const FILE_ROOT = "[UNIT_TEST]非公開の資料ROOT.txt";
const FILE_REPLY = "[UNIT_TEST]非公開の資料REPLY.txt";
const OLD_REACTION = "👏";
const NEW_REACTION = "🌟";
const AFTER = "2026-11-17T03:00:00.000Z";

let w: CaseWorld;
let V: string;
let O: string;
/** 失う前からあるメンションの宛先（部屋の外の有効な人） */
let D1: string;
/** 失った後に入れる新しいメンションの宛先 */
let D2: string;

type Ctx = {
  roomId: string;
  kind: "channel" | "direct";
};

type Scenario = {
  name: string;
  kind: Ctx["kind"];
  lose: (ctx: Ctx) => Promise<void>;
};

// 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
const SCENARIOS: Scenario[] = [
  {
    name: "非公開チャンネル：参加の行を残したまま無効化",
    kind: "channel",
    lose: () => setUserActive(V, false),
  },
  {
    name: "非公開チャンネル：参加の解除（channel_members の行を消す）",
    kind: "channel",
    lose: (ctx) => removeCaseMember(ctx.roomId, V),
  },
  {
    name: "DM：当事者の無効化",
    kind: "direct",
    lose: () => setUserActive(V, false),
  },
];

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

// ---- 準備と、各 k の前の復元 ----

async function prepare(kind: Ctx["kind"]): Promise<Ctx> {
  let roomId: string;
  if (kind === "channel") {
    roomId = (
      await seedCase({
        n: 42,
        clientId: w.clientA.id,
        code: "QZA",
        title: "[UNIT_TEST]付随の読み取りの割り込み",
        createdBy: V,
        departmentIds: [w.deptS.id],
        members: [
          { userId: V, joinedAt: joinedAt(1) },
          { userId: O, joinedAt: joinedAt(2) },
        ],
      })
    ).roomId;
  } else {
    roomId = await insertDm(V, O, { roomId: DM_ROOM });
  }
  await insertMessageRow({ id: ROOT, roomId, senderId: V });
  await insertMessageRow({ id: REPLY, roomId, senderId: O, parentId: ROOT });
  await insertMessageRow({ id: TOP2, roomId, senderId: O });
  for (const messageId of [ROOT, REPLY]) {
    await insertMentionRow(messageId, D1, 0, 3);
    await insertReactionRow({
      messageId,
      userId: O,
      kind: "emoji",
      value: OLD_REACTION,
      createdAt: reactionIsoAt(1),
    });
  }
  await insertAttachmentRow({
    id: ATT_ROOT,
    roomId,
    uploaderId: O,
    messageId: ROOT,
    originalName: FILE_ROOT,
    createdAt: AFTER,
  });
  await insertAttachmentRow({
    id: ATT_REPLY,
    roomId,
    uploaderId: O,
    threadParentId: ROOT,
    messageId: REPLY,
    originalName: FILE_REPLY,
    createdAt: AFTER,
  });
  return { roomId, kind };
}

/** 各 k の前に、同じ初期の状態へ戻す（前の試行の失効や目印が残ると、本文と付随の間を調べずに通ってしまうため） */
async function reset(ctx: Ctx) {
  await setUserActive(V, true);
  if (ctx.kind === "channel")
    for (const userId of [V, O])
      await env.DB.prepare(
        "INSERT OR IGNORE INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
      )
        .bind(ctx.roomId, userId, joinedAt(1))
        .run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM message_reactions WHERE value = ?").bind(
      NEW_REACTION,
    ),
    env.DB.prepare("DELETE FROM message_mentions WHERE user_id = ?").bind(D2),
    env.DB.prepare("DELETE FROM messages WHERE id IN (?, ?)").bind(
      NEW_REPLY,
      NEW_TOP,
    ),
  ]);
}

/** 資格を失った後に、付随の情報を変える。目印がすべてできたか（行の数）を返す */
async function makeMarkers(ctx: Ctx): Promise<boolean> {
  for (const messageId of [ROOT, REPLY, TOP2]) {
    await insertReactionRow({
      messageId,
      userId: O,
      kind: "emoji",
      value: NEW_REACTION,
      createdAt: reactionIsoAt(20),
    });
    await insertMentionRow(messageId, D2, 10, 14);
  }
  await insertMessageRow({ id: NEW_TOP, roomId: ctx.roomId, senderId: O });
  await insertMessageRow({
    id: NEW_REPLY,
    roomId: ctx.roomId,
    senderId: O,
    parentId: ROOT,
  });
  const count = async (sql: string, ...binds: string[]) =>
    (
      await env.DB.prepare(sql)
        .bind(...binds)
        .first<{ n: number }>()
    )?.n ?? -1;
  return (
    (await count(
      "SELECT COUNT(*) AS n FROM message_reactions WHERE value = ?",
      NEW_REACTION,
    )) === 3 &&
    (await count(
      "SELECT COUNT(*) AS n FROM message_mentions WHERE user_id = ?",
      D2,
    )) === 3 &&
    (await count(
      "SELECT COUNT(*) AS n FROM messages WHERE id IN (?, ?)",
      NEW_TOP,
      NEW_REPLY,
    )) === 2
  );
}

// ---- D1 を包んで、k 回目の実行の直後に割り込む ----

type Entry = { sql: string; startedAfter: boolean; result: unknown };

const EXECUTE = new Set<string | symbol>(["all", "raw", "first", "run"]);

function intercept(
  real: D1Database,
  interruptAfter: number,
  interrupt: () => Promise<boolean>,
) {
  const state = {
    executed: 0,
    interrupted: false,
    interruptions: 0,
    markersOk: false,
    log: [] as Entry[],
  };
  const originals = new WeakMap<object, D1PreparedStatement>();
  const finish = async (
    sql: string,
    startedAfter: boolean,
    result: unknown,
  ) => {
    state.executed += 1;
    state.log.push({ sql, startedAfter, result });
    if (state.executed === interruptAfter && !state.interrupted) {
      state.markersOk = await interrupt();
      state.interrupted = true;
      state.interruptions += 1;
    }
  };
  const wrapStatement = (
    target: D1PreparedStatement,
    query: string,
  ): D1PreparedStatement => {
    const proxy = new Proxy(target, {
      get(t, property) {
        const value = Reflect.get(t, property, t) as unknown;
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        if (property === "bind")
          return (...args: unknown[]) =>
            wrapStatement(fn.apply(t, args) as D1PreparedStatement, query);
        if (EXECUTE.has(property))
          return async (...args: unknown[]) => {
            const startedAfter = state.interrupted;
            const result = await fn.apply(t, args);
            await finish(query, startedAfter, result);
            return result;
          };
        return fn.bind(t);
      },
    });
    originals.set(proxy, target);
    queries.set(proxy, query);
    return proxy;
  };
  const queries = new WeakMap<object, string>();
  const db = new Proxy(real, {
    get(t, property) {
      if (property === "prepare")
        return (query: string) => wrapStatement(t.prepare(query), query);
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          const startedAfter = state.interrupted;
          const result = await t.batch(
            statements.map(
              (statement) => originals.get(statement) ?? statement,
            ),
          );
          await finish(
            statements
              .map((statement) => queries.get(statement) ?? "")
              .join(" ; "),
            startedAfter,
            result,
          );
          return result;
        };
      const value: unknown = Reflect.get(t, property, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  return { state, db };
}

// ---- 要求（Service を、包んだ D1 から作る） ----

type Operation = {
  name: string;
  /** 未読の数を返す要求か（その列が 0 であることを確かめる） */
  unread: boolean;
  /** 有効な V への割り込みなしの応答に必ず含まれる文字列（対：データが返っていること） */
  baselineHas: (ctx: Ctx) => string;
  run: (db: Database, ctx: Ctx) => Promise<unknown>;
};

const messageService = (db: Database) =>
  createMessageService(createMessageRepository(db), {
    authorizer: fakeAuthorizer([]),
  });

const OPERATIONS: Operation[] = [
  {
    name: "メッセージの一覧（最新）",
    unread: false,
    baselineHas: () => OLD_REACTION,
    run: (db, ctx) =>
      messageService(db).list(actorOf(V), ctx.roomId, { limit: 50 }),
  },
  {
    name: "メッセージの一覧（続き）",
    unread: false,
    baselineHas: () => OLD_REACTION,
    run: (db, ctx) =>
      messageService(db).list(actorOf(V), ctx.roomId, {
        after: id(0),
        limit: 50,
      }),
  },
  {
    name: "返信の取得（最新。親の findItem を含む）",
    unread: false,
    baselineHas: () => OLD_REACTION,
    run: (db) =>
      messageService(db).listReplies(actorOf(V), ROOT, { limit: 50 }),
  },
  {
    name: "返信の取得（続き）",
    unread: false,
    baselineHas: () => OLD_REACTION,
    run: (db) =>
      messageService(db).listReplies(actorOf(V), ROOT, {
        after: id(0),
        limit: 50,
      }),
  },
  {
    name: "スレッドの一覧（付随の3つとスレッドの未読）",
    unread: true,
    baselineHas: () => OLD_REACTION,
    run: (db) =>
      createThreadService(createThreadRepository(db), {
        authorizer: fakeAuthorizer([]),
      }).list(actorOf(V), { limit: 50 }),
  },
  {
    name: "未読の一覧（部屋）",
    unread: true,
    baselineHas: (ctx) => ctx.roomId,
    run: (db) =>
      createUnreadService(
        createReadPositionRepository(db),
        createMessageRepository(db),
        { authorizer: fakeAuthorizer([]) },
      ).list(actorOf(V), { limit: 50 }),
  },
];

async function settle(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return error;
  }
}

async function execute(
  operation: Operation,
  ctx: Ctx,
  interruptAfter: number,
  interrupt: () => Promise<boolean>,
) {
  const { state, db } = intercept(env.DB, interruptAfter, interrupt);
  const value = await settle(() => operation.run(drizzle(db, { schema }), ctx));
  return { ...state, value };
}

/** 失った後に始まった文の結果の文字列に含まれてはいけないもの（失う前からある付随の情報と、目印） */
function forbiddenTexts(): string[] {
  return [
    OLD_REACTION,
    NEW_REACTION,
    D1,
    D2,
    ATT_ROOT,
    ATT_REPLY,
    FILE_ROOT,
    FILE_REPLY,
  ];
}

const TARGET_SQL =
  /message_mentions|message_reactions|message_attachments|unread_count/;

/** 未読の数の列：失った部屋・スレッドの行が見えるなら、0 であること */
function unreadLeaks(entry: Entry, lostKeys: ReadonlySet<string>) {
  const out = { observed: 0, leaks: [] as string[] };
  if (!/unread_count/.test(entry.sql)) return out;
  const rows = (entry.result as { results?: unknown }).results;
  if (!Array.isArray(rows))
    throw new Error("未読の文の結果の形が想定と違います（results がない）");
  for (const row of rows as Record<string, unknown>[]) {
    const key = row["room_id"] ?? row["parent_id"];
    if (typeof key !== "string" || !lostKeys.has(key)) continue;
    out.observed += 1;
    if (row["unread_count"] !== 0)
      out.leaks.push(`未読の数が ${String(row["unread_count"])}（${key}）`);
  }
  return out;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  V = w.memberS1.id;
  O = w.memberS2.id;
  D1 = w.memberD1.id;
  D2 = w.ownerD.id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRelatedReadsRooms([DM_ROOM]);
  await cleanupCaseTestData();
});

describe("#297 AC-1 T-7〜T-9：本文の読み取りの後に資格を失っても、その後に始まった文は付随の情報・未読の数を返さない", () => {
  const CASES = SCENARIOS.flatMap((scenario) =>
    OPERATIONS.map((operation) => ({
      name: `${operation.name} / ${scenario.name}`,
      scenario,
      operation,
    })),
  );

  it.each(CASES)(
    "#297 AC-1: $name で、どの文の直後に資格を失っても、その後の文は目印・失う前の付随の情報・未読の数を返さない",
    async ({ scenario, operation }) => {
      const ctx = await prepare(scenario.kind);
      const lostKeys = new Set<string>([ctx.roomId, ROOT]);
      const none = async () => false;
      // 割り込みなしで実行される文の数を数える（対：有効な V には付随の情報が返る）
      const baseline = await execute(operation, ctx, 0, none);
      expect(baseline.value).not.toBeInstanceOf(Error);
      expect(baseline.executed).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(baseline.value)).toContain(
        operation.baselineHas(ctx),
      );
      const interrupt = async () => {
        await scenario.lose(ctx);
        return makeMarkers(ctx);
      };
      const leaks: string[] = [];
      let trials = 0;
      let interruptions = 0;
      let markersMade = 0;
      let targetSeen = 0;
      let observedUnreadRows = 0;
      for (let k = 1; k < baseline.executed; k += 1) {
        await reset(ctx);
        const trial = await execute(operation, ctx, k, interrupt);
        trials += 1;
        interruptions += trial.interruptions;
        if (trial.markersOk) markersMade += 1;
        const after = trial.log.filter((entry) => entry.startedAfter);
        if (after.some((entry) => TARGET_SQL.test(entry.sql))) targetSeen += 1;
        for (const entry of after) {
          const text = JSON.stringify(entry.result);
          for (const forbidden of forbiddenTexts())
            if (text.includes(forbidden))
              leaks.push(`${k}回目の後の文に ${forbidden} が含まれる`);
          if (operation.unread) {
            const found = unreadLeaks(entry, lostKeys);
            observedUnreadRows += found.observed;
            leaks.push(...found.leaks.map((leak) => `${k}回目の後: ${leak}`));
          }
        }
        // 最終の応答にも、資格を失った後に付いた目印が含まれない
        if (!(trial.value instanceof Error)) {
          const text = JSON.stringify(trial.value);
          for (const marker of [NEW_REACTION, D2])
            if (text.includes(marker))
              leaks.push(`${k}回目の応答に ${marker} が含まれる`);
        }
      }
      // 空振りしていないこと
      expect(trials).toBe(baseline.executed - 1);
      expect(interruptions).toBe(trials);
      expect(markersMade).toBe(trials);
      expect(targetSeen).toBeGreaterThan(0);
      if (operation.unread) expect(observedUnreadRows).toBeGreaterThan(0);
      expect(leaks).toEqual([]);
    },
  );
});

describe("#297 AC-1（利用者の決定）T-7b：スレッドの一覧で、権限の確認の後・一覧の SQL の前に閲覧者の無効化が確定しても、DM の親を返さない", () => {
  const TIMINGS = ["authorize", "can"] as const;

  /** authorize・can が返った直後に（1回だけ）閲覧者を無効にする authorizer */
  function disablingAuthorizer(after: (typeof TIMINGS)[number]) {
    const base = fakeAuthorizer([]);
    let fired = false;
    const fire = async () => {
      if (fired) return;
      fired = true;
      await setUserActive(V, false);
    };
    return {
      ...base,
      authorize: async (
        ...args: Parameters<typeof base.authorize>
      ): Promise<void> => {
        await base.authorize(...args);
        if (after === "authorize") await fire();
      },
      can: async (...args: Parameters<typeof base.can>): Promise<boolean> => {
        const result = await base.can(...args);
        await fire();
        return result;
      },
    };
  }

  it.each(TIMINGS)(
    "#297 AC-1: %s が返った直後に V を無効にすると、DM のスレッドの親の ID・本文が応答に含まれない（対：割り込みなしでは返る）",
    async (after) => {
      await prepare("direct");
      const run = (authorizer: ReturnType<typeof fakeAuthorizer>) =>
        withDb((db) =>
          createThreadService(createThreadRepository(db), {
            authorizer,
          }).list(actorOf(V), { limit: 50 }),
        );
      const before = JSON.stringify(await run(fakeAuthorizer([])));
      expect(before).toContain(ROOT);
      const text = JSON.stringify(await run(disablingAuthorizer(after)));
      expect(text).not.toContain(ROOT);
      expect(text).not.toContain(`[UNIT_TEST]本文${ROOT}`);
    },
  );
});

function withDb<T>(run: (db: Database) => Promise<T>): Promise<T> {
  return run(drizzle(env.DB, { schema }));
}

describe("#297 AC-2 T-10：有効な閲覧者の結果は変わらない", () => {
  const FOR_CHANNEL = SCENARIOS.filter((s) => s.kind === "channel").slice(0, 1);

  it.each(SCENARIOS)(
    "#297 AC-2: $name の準備で、割り込みなしの一覧は準備のデータから書いた期待値と同じ（メッセージの一覧・スレッドの一覧・未読の一覧）",
    async ({ kind }) => {
      const ctx = await prepare(kind);
      const none = async () => false;
      const run = (operation: Operation | undefined) => {
        if (operation === undefined)
          throw new Error("要求の表が想定と違います");
        return execute(operation, ctx, 0, none);
      };
      const list = await run(OPERATIONS[0]);
      const threads = await run(OPERATIONS[4]);
      const unread = await run(OPERATIONS[5]);
      const listed = list.value as { items: Record<string, unknown>[] };
      const root = listed.items.find((item) => item["id"] === ROOT);
      expect(root).toMatchObject({
        mentions: [{ userId: D1, start: 0, end: 3 }],
        reactions: [
          {
            kind: "emoji",
            value: OLD_REACTION,
            count: 1,
            reactedByMe: false,
            users: [{ id: O, isActive: true }],
          },
        ],
        attachments: [{ id: ATT_ROOT, name: FILE_ROOT }],
      });
      const threadItems = (
        threads.value as {
          items: { parent: { id: string }; unreadCount: number }[];
        }
      ).items;
      expect(
        threadItems.map((item) => [item.parent.id, item.unreadCount]),
      ).toEqual([[ROOT, 1]]);
      expect(unread.value).toEqual({
        items: [{ roomId: ctx.roomId, count: 1 }],
        nextCursor: null,
      });
    },
  );

  it.each(FOR_CHANNEL)(
    "#297 AC-2: 割り込みの対象が閲覧者でない（別の参加者 O が外れる）とき、どの文の直後でも V の結果は割り込みなしと同じ",
    async () => {
      const ctx = await prepare("channel");
      const none = async () => false;
      for (const operation of [OPERATIONS[0], OPERATIONS[4], OPERATIONS[5]]) {
        if (operation === undefined)
          throw new Error("要求の表が想定と違います");
        const baseline = await execute(operation, ctx, 0, none);
        const expected = JSON.stringify(baseline.value);
        expect(baseline.value).not.toBeInstanceOf(Error);
        const different: number[] = [];
        for (let k = 1; k < baseline.executed; k += 1) {
          await reset(ctx);
          const trial = await execute(operation, ctx, k, async () => {
            await removeCaseMember(ctx.roomId, O);
            return true;
          });
          expect(trial.interruptions).toBe(1);
          if (JSON.stringify(trial.value) !== expected) different.push(k);
        }
        expect({ operation: operation.name, different }).toEqual({
          operation: operation.name,
          different: [],
        });
      }
    },
  );
});
