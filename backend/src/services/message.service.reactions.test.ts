// #138 AC-1（1-7 AC-1〜AC-5）・AC-2（1-4 AC-6）: リアクションの Service（message.service.ts の addReaction・removeReaction）の判定の順・冪等・0行の後の競合を、
// 本物の Repository（隔離 D1）と偽の authorizer（dm-fixtures の fakeAuthorizer）で確かめる。書き込みの直前に割り込むため、本物の書き込みを包む（message.modify-race.test.ts と同じ方法）。
// 判定の順（計画「判定の順 requireReactable」。この順を変えない）：
//   ① メッセージがあり部屋が見えるか（DM は perm.dm.message.view、チャンネルは canViewChannel）。違えば 404
//   ② 参加していない公開チャンネルは 403 → ③ authorize(perm.reaction.manage.own)（拒否は 403）→ ④ 削除済みは 409
//   → ⑤ 部署が無効・DM の相手が無効は 409 → ⑥ 条件付きの書き込み（SQL の reactable で同じ条件をもう一度確かめる）。0行なら「0行のときの扱い」
// 0行のときの扱い：requireReactable をやり直す（拒否の理由があればその応答）→ 付ける：本人がすでに付けている＝成功（200・最新の集計）／20種類に達している＝409「リアクションは20種類までです」／
//   どちらでもない＝条件付きの INSERT を1回だけやり直す。取り消す：本人の行がない＝成功／本人の行がある＝条件付きの DELETE を1回だけやり直す。
//   やり直しても0行で、拒否の理由がなく、要求された状態にもなっていなければ 409「状態が変わりました。もう一度お試しください」。やり直しは1回だけ。
//
// 実装が前提とする約束（計画「API」「DB」）：
//   service.addReaction(actor, messageId, kind, value): Promise<{ messageId: string; reactions: Reaction[] }>
//   service.removeReaction(actor, messageId, kind, value): Promise<{ messageId: string; reactions: Reaction[] }>
//   repository.addReactionIfReactable / removeReactionIfReactable({ messageId, userId, kind, value }): Promise<{ changes: number; reactions: Reaction[] }>（message-reactions.db.test.ts が固定）
//   既存の findThreadParent（または findForModification）・findRoomForViewer・findDirectForParticipant・isDepartmentActive で部屋を読む（このテストは名前に依存しない）
// データは架空（testuser_rxsvc_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import {
  deactivateUser,
  fakeAuthorizer,
  insertDm,
} from "../../test/dm-fixtures";
import {
  archiveChannel,
  deactivateDepartment,
  leaveChannel,
  markDeleted,
  modifyTraceId,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  TWENTY_REACTIONS,
  cleanupReactionScenario,
  createThreadWorld,
  insertReactionRow,
  reactionIsoAt,
  reactionRows,
  seedTwentyTypes,
  type ThreadWorld,
} from "../../test/reaction-fixtures";
import { seedParent, seedReply } from "../../test/thread-fixtures";
import { withMessages } from "../db/message.repository";
import type { Permission } from "../lib/permissions";
import { createMessageService } from "./message.service";

let world: ThreadWorld;
let message: string;

const PERMISSION: Permission = "perm.reaction.manage.own";
const CONFLICT_MESSAGE = "状態が変わりました。もう一度お試しください";
const LIMIT_MESSAGE = "リアクションは20種類までです";

type Kind = "emoji" | "stamp";
type Op = "add" | "remove";
type WriteResult = { changes: number; reactions: unknown[] };
/** 書き込みの直前に呼ぶ。n は、その操作の何回目の書き込みか（1 から）。"zero" を返すと、本物を呼ばずに 0 行を返す */
type BeforeWrite = (n: number) => Promise<"real" | "zero" | undefined>;

type Outcome = {
  result?: { messageId: string; reactions: Record<string, unknown>[] };
  error?: { code?: string; status?: number; message?: string };
  writes: number;
  authorized: Permission[];
};

async function perform(
  op: Op,
  userId: string,
  options: {
    messageId?: string;
    kind?: Kind;
    value?: string;
    denied?: Permission[];
    beforeWrite?: BeforeWrite;
    /** 0行の後の再判定の集計の読み取り（repository.loadReactions）の直前に呼ぶ（1回だけ）。replaceWith に null を返すと、読み取りが「条件が成り立っていない」を返したことにする */
    beforeLoad?: () => Promise<"real" | "unreactable" | undefined>;
  } = {},
): Promise<Outcome> {
  const authorizer = fakeAuthorizer(options.denied ?? []);
  const outcome: Outcome = { writes: 0, authorized: [] };
  await withMessages(env, async (repository) => {
    const intercept =
      (real: (input: never) => Promise<WriteResult>) =>
      async (input: never): Promise<WriteResult> => {
        outcome.writes += 1;
        const decision = await options.beforeWrite?.(outcome.writes);
        if (decision === "zero") return { changes: 0, reactions: [] };
        return real(input);
      };
    const wrapped = {
      ...repository,
      addReactionIfReactable: intercept(repository.addReactionIfReactable),
      removeReactionIfReactable: intercept(
        repository.removeReactionIfReactable,
      ),
      loadReactions: async (
        ...args: Parameters<typeof repository.loadReactions>
      ) => {
        const hook = options.beforeLoad;
        options.beforeLoad = undefined;
        const decision = await hook?.();
        if (decision === "unreactable") return null;
        return repository.loadReactions(...args);
      },
    } as unknown as typeof repository;
    const service = createMessageService(wrapped, { authorizer });
    const actor = { userId, traceId: modifyTraceId() };
    const messageId = options.messageId ?? message;
    const kind = options.kind ?? "emoji";
    const value = options.value ?? "👍";
    try {
      outcome.result = (await (op === "add"
        ? service.addReaction(actor, messageId, kind, value)
        : service.removeReaction(
            actor,
            messageId,
            kind,
            value,
          ))) as Outcome["result"];
    } catch (error) {
      outcome.error = error as Outcome["error"];
    }
  });
  outcome.authorized = authorizer.calls.map((call) => call.permission);
  return outcome;
}

const rowsOf = async (id = message) =>
  (await reactionRows(id)).map(
    (row) => `${row.user_id}:${row.kind}:${row.value}`,
  );

const notificationTotal = async () =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications").first<{
      n: number;
    }>()
  )?.n;

const seedRow = (userId: string, value = "👍", kind: Kind = "emoji", n = 1) =>
  insertReactionRow({
    messageId: message,
    userId,
    kind,
    value,
    createdAt: reactionIsoAt(n),
  });

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("rxsvc");
  message = await seedParent(world.channel, world.alice.userId, 1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupReactionScenario();
});

describe("#138 AC-1（1-7 AC-1〜AC-3）成功と応答", () => {
  it("#138 AC-1（1-7 AC-1）: 付けると { messageId, reactions } を返し、reactions は最新の集計（件数1・reactedByMe・付けた人）。権限は perm.reaction.manage.own だけを確かめる", async () => {
    const outcome = await perform("add", world.bob.userId);
    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toEqual({
      messageId: message,
      reactions: [
        {
          kind: "emoji",
          value: "👍",
          count: 1,
          reactedByMe: true,
          users: [
            { id: world.bob.userId, displayName: "テスト太郎", isActive: true },
          ],
        },
      ],
    });
    expect(outcome.authorized).toEqual([PERMISSION]);
    expect(await rowsOf()).toEqual([`${world.bob.userId}:emoji:👍`]);
  });

  it("#138 AC-1（1-7 AC-3）: 2人目が付けると件数2。取り消すと、本人の行だけが消えて件数1・reactedByMe は false", async () => {
    await seedRow(world.dave.userId);
    const added = await perform("add", world.bob.userId);
    expect(added.result?.reactions[0]).toMatchObject({
      count: 2,
      reactedByMe: true,
    });
    const removed = await perform("remove", world.bob.userId);
    expect(removed.result?.reactions[0]).toMatchObject({
      count: 1,
      reactedByMe: false,
    });
    expect(await rowsOf()).toEqual([`${world.dave.userId}:emoji:👍`]);
  });

  it("#138 AC-1（1-7 AC-2）: スタンプを付けられる", async () => {
    const outcome = await perform("add", world.bob.userId, {
      kind: "stamp",
      value: "ok",
    });
    expect(outcome.result?.reactions[0]).toMatchObject({
      kind: "stamp",
      value: "ok",
      count: 1,
    });
  });

  it("#138 AC-1（U-9・U-11）: 付ける・取り消すで、通知の行は増えない", async () => {
    const before = await notificationTotal();
    await perform("add", world.bob.userId);
    await perform("remove", world.bob.userId);
    expect(await notificationTotal()).toBe(before);
  });
});

describe("#138 AC-1（U-12）冪等", () => {
  it("#138 AC-1（U-12）: すでに付けているものを付けると、エラーにせず成功し、最新の集計を返す。行は1つで、書き込みの要求は1回（やり直さない）", async () => {
    await perform("add", world.bob.userId);
    const again = await perform("add", world.bob.userId);
    expect(again.error).toBeUndefined();
    expect(again.result?.reactions).toHaveLength(1);
    expect(again.result?.reactions[0]).toMatchObject({
      count: 1,
      reactedByMe: true,
    });
    expect(again.writes).toBe(1);
    expect(await rowsOf()).toHaveLength(1);
  });

  it("#138 AC-1（U-12）: 付けていないものを取り消しても、エラーにせず成功し、最新の集計を返す（要求は1回）", async () => {
    await seedRow(world.dave.userId, "👏");
    const outcome = await perform("remove", world.bob.userId);
    expect(outcome.error).toBeUndefined();
    expect(outcome.result?.reactions).toHaveLength(1);
    expect(outcome.result?.reactions[0]).toMatchObject({
      value: "👏",
      count: 1,
      reactedByMe: false,
    });
    expect(outcome.writes).toBe(1);
  });

  it("#138 AC-1（R-36・U-12）: 他人が付けた種類を指定して取り消しても、成功し（200 相当）、他人の行は残る", async () => {
    await seedRow(world.dave.userId);
    const outcome = await perform("remove", world.bob.userId);
    expect(outcome.error).toBeUndefined();
    expect(outcome.result?.reactions[0]).toMatchObject({
      count: 1,
      reactedByMe: false,
    });
    expect(await rowsOf()).toEqual([`${world.dave.userId}:emoji:👍`]);
  });

  it("#138 AC-1（U-12）: すべて取り消した後は、集計は空", async () => {
    await perform("add", world.bob.userId);
    const outcome = await perform("remove", world.bob.userId);
    expect(outcome.result).toEqual({ messageId: message, reactions: [] });
  });
});

describe("#138 AC-1 判定の順（付ける・取り消すとも同じ）", () => {
  const OPERATIONS: readonly Op[] = ["add", "remove"];

  it.each(OPERATIONS)(
    "#138 AC-1（①）: %s：存在しない投稿は 404 NOT_FOUND で、権限の確認も書き込みもしない",
    async (op) => {
      const outcome = await perform(op, world.bob.userId, {
        messageId: "01JNOMESSAGE0000000000000",
      });
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(outcome.authorized).toEqual([]);
      expect(outcome.writes).toBe(0);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（①）: %s：非公開チャンネルに参加していない人は 404（存在を隠す）で、権限の確認も書き込みもしない",
    async (op) => {
      const room = await insertChannel({
        name: `${TEST_TAG}非公開rxsvc`,
        purpose: "normal",
        departmentId: world.dept.id,
        visibility: "private",
      });
      await insertMember(room, world.alice.userId);
      const target = await seedParent(room, world.alice.userId, 2);
      const outcome = await perform(op, world.bob.userId, {
        messageId: target,
      });
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(outcome.authorized).toEqual([]);
      expect(outcome.writes).toBe(0);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（①）: %s：アーカイブ済みのチャンネルは 404",
    async (op) => {
      await archiveChannel(world.channel);
      const outcome = await perform(op, world.bob.userId);
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(outcome.writes).toBe(0);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（①）: %s：他人の DM（当事者でない）は 404 で、権限の確認も書き込みもしない",
    async (op) => {
      const dm = await insertDm(world.alice.userId, world.bob.userId);
      const target = await seedParent(dm, world.alice.userId, 2);
      const outcome = await perform(op, world.dave.userId, {
        messageId: target,
      });
      expect(outcome.error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(outcome.authorized).toEqual([]);
      expect(outcome.writes).toBe(0);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（②・U-8）: %s：参加していない公開チャンネルは 403 FORBIDDEN（読めるが付けられない）。権限の確認も書き込みもしない",
    async (op) => {
      const outcome = await perform(op, world.carol.userId);
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(outcome.authorized).toEqual([]);
      expect(outcome.writes).toBe(0);
      expect(await rowsOf()).toEqual([]);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（③）: %s：perm.reaction.manage.own が拒否されると 403。削除済みの投稿でも、権限の拒否（403）が 409 より先",
    async (op) => {
      await markDeleted(message, world.alice.userId);
      const outcome = await perform(op, world.bob.userId, {
        denied: [PERMISSION],
      });
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(outcome.authorized).toEqual([PERMISSION]);
      expect(outcome.writes).toBe(0);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（④・U-7）: %s：削除済みの投稿は 409 CONFLICT で、行は変わらない",
    async (op) => {
      await seedRow(world.bob.userId);
      await markDeleted(message, world.alice.userId);
      const outcome = await perform(op, world.bob.userId);
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(outcome.writes).toBe(0);
      expect(await rowsOf()).toEqual([`${world.bob.userId}:emoji:👍`]);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（⑤・U-8）: %s：部署が無効（読み取り専用）のチャンネルは 409。付けるのも取り消すのも不可",
    async (op) => {
      await seedRow(world.bob.userId);
      await deactivateDepartment(world.dept.id);
      const outcome = await perform(op, world.bob.userId);
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(outcome.writes).toBe(0);
      expect(await rowsOf()).toEqual([`${world.bob.userId}:emoji:👍`]);
    },
  );

  it.each(OPERATIONS)(
    "#138 AC-1（⑤・U-8）: %s：DM の相手が無効なら 409。付けるのも取り消すのも不可",
    async (op) => {
      const dm = await insertDm(world.alice.userId, world.bob.userId);
      const target = await seedParent(dm, world.alice.userId, 2);
      await insertReactionRow({
        messageId: target,
        userId: world.bob.userId,
        kind: "emoji",
        value: "👍",
        createdAt: reactionIsoAt(1),
      });
      await deactivateUser(world.alice.userId);
      const outcome = await perform(op, world.bob.userId, {
        messageId: target,
      });
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(outcome.writes).toBe(0);
      expect(await rowsOf(target)).toEqual([`${world.bob.userId}:emoji:👍`]);
    },
  );

  it("#138 AC-1（①）: DM では、先に perm.dm.message.view、次に perm.reaction.manage.own の順に確かめる", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const target = await seedParent(dm, world.alice.userId, 2);
    const outcome = await perform("add", world.bob.userId, {
      messageId: target,
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.authorized).toEqual(["perm.dm.message.view", PERMISSION]);
  });

  it("#138 AC-1（①）: DM の閲覧権限が拒否されると 403 で、リアクションの権限・書き込みには進まない", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const target = await seedParent(dm, world.alice.userId, 2);
    const outcome = await perform("add", world.bob.userId, {
      messageId: target,
      denied: ["perm.dm.message.view"],
    });
    expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(outcome.authorized).toEqual(["perm.dm.message.view"]);
    expect(outcome.writes).toBe(0);
  });

  it("#138 AC-1（⑥・1-7 AC-4）: 20種類に達していて、新しい種類を付けると 409「リアクションは20種類までです」。要求は1回で、行は増えない", async () => {
    await seedTwentyTypes(message, world.dave.userId);
    const outcome = await perform("add", world.bob.userId, { value: "😀" });
    expect(outcome.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: LIMIT_MESSAGE,
    });
    expect(outcome.writes).toBe(1);
    expect(await reactionRows(message)).toHaveLength(20);
  });

  it("#138 AC-1（1-7 AC-4）: 20種類に達していても、すでにある種類には付けられる。自分の分は取り消せる", async () => {
    await seedTwentyTypes(message, world.dave.userId);
    const added = await perform("add", world.bob.userId, { value: "👍" });
    expect(added.error).toBeUndefined();
    expect(added.result?.reactions).toHaveLength(20);
    const removed = await perform("remove", world.bob.userId, { value: "👍" });
    expect(removed.error).toBeUndefined();
    expect(await reactionRows(message)).toHaveLength(20);
  });

  it("#138 AC-1（1-7 AC-4）: 取り消しは、20種類に達していても拒否されない（上限に触れない）", async () => {
    await seedTwentyTypes(message, world.dave.userId);
    const removed = await perform("remove", world.dave.userId, {
      kind: TWENTY_REACTIONS[0]?.kind ?? "emoji",
      value: TWENTY_REACTIONS[0]?.value ?? "👍",
    });
    expect(removed.error).toBeUndefined();
    expect(removed.result?.reactions).toHaveLength(19);
  });
});

describe("#138 AC-1（1-7 AC-5）・AC-2（1-4 AC-6）返信・お知らせ専用", () => {
  it("#138 AC-2（1-4 AC-6）: 返信にも付けられ、取り消せる。上限は返信ごとに数える", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    await seedTwentyTypes(message, world.dave.userId);
    const added = await perform("add", world.bob.userId, {
      messageId: reply,
      value: "😀",
    });
    expect(added.error).toBeUndefined();
    expect(added.result?.messageId).toBe(reply);
    const removed = await perform("remove", world.bob.userId, {
      messageId: reply,
      value: "😀",
    });
    expect(removed.error).toBeUndefined();
    expect(await reactionRows(reply)).toEqual([]);
  });

  it("#138 AC-2（C-59）: 親が削除済みでも、未削除の返信には付けられる。削除済みの返信には付けられない（409）", async () => {
    const reply = await seedReply(world.channel, message, world.dave.userId, 2);
    const deletedReply = await seedReply(
      world.channel,
      message,
      world.dave.userId,
      3,
    );
    await markDeleted(message, world.alice.userId);
    await markDeleted(deletedReply, world.dave.userId);
    const ok = await perform("add", world.bob.userId, { messageId: reply });
    expect(ok.error).toBeUndefined();
    const rejected = await perform("add", world.bob.userId, {
      messageId: deletedReply,
    });
    expect(rejected.error).toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("#138 AC-1（お知らせ専用）: お知らせ専用チャンネルで、投稿権限のない参加者も付けられる（perm.announcement.post は確かめない）", async () => {
    await insertMember(world.dept.announcementChannelId, world.alice.userId);
    await insertMember(world.dept.announcementChannelId, world.bob.userId);
    const announcement = await seedParent(
      world.dept.announcementChannelId,
      world.alice.userId,
      3,
    );
    const outcome = await perform("add", world.bob.userId, {
      messageId: announcement,
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.authorized).toEqual([PERMISSION]);
  });

  it("#138 AC-1（自分の投稿）: 自分の投稿にも付けられる", async () => {
    const outcome = await perform("add", world.alice.userId);
    expect(outcome.error).toBeUndefined();
  });
});

describe("#138 AC-1（指摘1）確認と書き込みの間に状態が変わる場合", () => {
  type Change = {
    label: string;
    apply: (target: string) => Promise<void>;
    expected: { code: string; status: number };
    dm?: boolean;
  };
  const changes: Change[] = [
    {
      label: "公開チャンネルの参加を外す",
      apply: async () => leaveChannel(world.channel, world.bob.userId),
      expected: { code: "FORBIDDEN", status: 403 },
    },
    {
      label: "チャンネルをアーカイブする",
      apply: async () => archiveChannel(world.channel),
      expected: { code: "NOT_FOUND", status: 404 },
    },
    {
      label: "部署を無効にする",
      apply: async () => deactivateDepartment(world.dept.id),
      expected: { code: "CONFLICT", status: 409 },
    },
    {
      label: "投稿を削除する",
      apply: async (target) => markDeleted(target, world.alice.userId),
      expected: { code: "CONFLICT", status: 409 },
    },
  ];

  it.each(
    changes.flatMap((c) =>
      (["add", "remove"] as const).map((op) => [op, c] as const),
    ),
  )(
    "#138 AC-1（指摘1）: %s：確認の後に変わると、0行になり、再判定の結果（403・404・409）を返す。成功にしない・集計を返さない",
    async (op, change) => {
      if (op === "remove") await seedRow(world.bob.userId);
      const before = await rowsOf();
      const outcome = await perform(op, world.bob.userId, {
        beforeWrite: async () => {
          await change.apply(message);
          return "real";
        },
      });
      expect(outcome.error, change.label).toMatchObject(change.expected);
      expect(outcome.result).toBeUndefined();
      expect(outcome.writes).toBe(1);
      expect(await rowsOf()).toEqual(before);
    },
  );

  it.each(["add", "remove"] as const)(
    "#138 AC-1（指摘1）: %s：DM の相手が確認の後に無効になると、409 で行は変わらない",
    async (op) => {
      const dm = await insertDm(world.alice.userId, world.bob.userId);
      const target = await seedParent(dm, world.alice.userId, 2);
      if (op === "remove")
        await insertReactionRow({
          messageId: target,
          userId: world.bob.userId,
          kind: "emoji",
          value: "👍",
          createdAt: reactionIsoAt(1),
        });
      const before = await rowsOf(target);
      const outcome = await perform(op, world.bob.userId, {
        messageId: target,
        beforeWrite: async () => {
          await deactivateUser(world.alice.userId);
          return "real";
        },
      });
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(outcome.result).toBeUndefined();
      expect(await rowsOf(target)).toEqual(before);
    },
  );
});

describe("#138 AC-1（4回目の指摘2）0行の後の競合：やり直しは1回だけ", () => {
  it("#138 AC-1: 取り消し：1回目の DELETE が0行で、再判定の前に同じ本人の行が入り直されると、DELETE を1回だけやり直して成功する（要求は2回）", async () => {
    const outcome = await perform("remove", world.bob.userId, {
      beforeWrite: async (n) => {
        if (n !== 1) return "real";
        await seedRow(world.bob.userId);
        return "zero";
      },
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.writes).toBe(2);
    expect(outcome.result?.reactions).toEqual([]);
    expect(await rowsOf()).toEqual([]);
  });

  it("#138 AC-1: 取り消し：やり直しも0行になると 409「状態が変わりました。もう一度お試しください」。要求は2回だけで、繰り返さない。本人の行は残る", async () => {
    const outcome = await perform("remove", world.bob.userId, {
      beforeWrite: async (n) => {
        if (n === 1) await seedRow(world.bob.userId);
        return "zero";
      },
    });
    expect(outcome.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: CONFLICT_MESSAGE,
    });
    expect(outcome.writes).toBe(2);
    expect(await rowsOf()).toEqual([`${world.bob.userId}:emoji:👍`]);
  });

  it("#138 AC-1: 取り消し：1回目が0行で、本人の行もない（すでに外れている）なら、やり直さず成功する（要求は1回）", async () => {
    const outcome = await perform("remove", world.bob.userId, {
      beforeWrite: async () => "zero",
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.writes).toBe(1);
  });

  it("#138 AC-1: 付ける：1回目の INSERT が0行で、再判定の時点で本人の行がなく上限でもないなら、INSERT を1回だけやり直して成功する（要求は2回）", async () => {
    const outcome = await perform("add", world.bob.userId, {
      beforeWrite: async (n) => (n === 1 ? "zero" : "real"),
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.writes).toBe(2);
    expect(outcome.result?.reactions[0]).toMatchObject({
      count: 1,
      reactedByMe: true,
    });
    expect(await rowsOf()).toEqual([`${world.bob.userId}:emoji:👍`]);
  });

  it("#138 AC-1: 付ける：やり直しも0行になると 409「状態が変わりました。もう一度お試しください」。要求は2回だけで、行は増えない", async () => {
    const outcome = await perform("add", world.bob.userId, {
      beforeWrite: async () => "zero",
    });
    expect(outcome.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: CONFLICT_MESSAGE,
    });
    expect(outcome.writes).toBe(2);
    expect(await rowsOf()).toEqual([]);
  });

  it("#138 AC-1: 付ける：1回目が0行で、再判定の時点で本人がすでに付けているなら、やり直さず成功する（要求は1回）", async () => {
    const outcome = await perform("add", world.bob.userId, {
      beforeWrite: async () => {
        await seedRow(world.bob.userId);
        return "zero";
      },
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.writes).toBe(1);
    expect(outcome.result?.reactions[0]).toMatchObject({
      count: 1,
      reactedByMe: true,
    });
  });

  it("#138 AC-1: 付ける：1回目が0行で、再判定の時点で20種類に達していたら、やり直さず 409「リアクションは20種類までです」（要求は1回）", async () => {
    const outcome = await perform("add", world.bob.userId, {
      value: "😀",
      beforeWrite: async () => {
        await seedTwentyTypes(message, world.dave.userId);
        return "zero";
      },
    });
    expect(outcome.error).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: LIMIT_MESSAGE,
    });
    expect(outcome.writes).toBe(1);
  });

  it("#138 AC-1: 0行の後に、拒否の理由（削除された）が見つかったら、やり直さず 409 を返す（要求は1回）", async () => {
    const outcome = await perform("add", world.bob.userId, {
      beforeWrite: async () => {
        await markDeleted(message, world.alice.userId);
        return "zero";
      },
    });
    expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(outcome.error?.message).not.toBe(CONFLICT_MESSAGE);
    expect(outcome.writes).toBe(1);
  });
});

describe("#138 コードレビュー1回目 重大（情報漏えい）：0行の後の再判定の直後に、条件が崩れる", () => {
  // 契約（実装の役割が合わせる）：repository.loadReactions(messageId, viewerId) は reactable の条件付きで読み、
  //   条件が成り立っていなければ null（空の集計 [] とは区別できる）を返す。Service は null を成功にせず、
  //   requireReactable をもう一度行って、拒否の理由があればその応答（403・404・409）にする。理由がなければ 409「状態が変わりました。もう一度お試しください」。
  const SECRET = "テスト秘密名レビュー";
  const OPERATIONS = ["add", "remove"] as const;

  /** 0行になる状態（add：本人がすでに付けている／remove：本人は付けていない）を作る。dave の別の種類の付与があり、集計に dave の名前が出る */
  async function prepare(
    op: (typeof OPERATIONS)[number],
    room = world.channel,
  ) {
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind(SECRET, world.dave.userId)
      .run();
    const target =
      room === world.channel
        ? message
        : await seedParent(room, world.alice.userId, 40);
    await insertReactionRow({
      messageId: target,
      userId: world.dave.userId,
      kind: "emoji",
      value: "👏",
      createdAt: reactionIsoAt(1),
    });
    if (op === "add")
      await insertReactionRow({
        messageId: target,
        userId: world.bob.userId,
        kind: "emoji",
        value: "👍",
        createdAt: reactionIsoAt(2),
      });
    return target;
  }

  const changes: {
    label: string;
    apply: (target: string) => Promise<void>;
    expected: { code: string; status: number };
    private?: boolean;
  }[] = [
    {
      label: "公開チャンネルの参加を外す",
      apply: async () => leaveChannel(world.channel, world.bob.userId),
      expected: { code: "FORBIDDEN", status: 403 },
    },
    {
      label: "非公開チャンネルの参加を外す（存在を隠す）",
      apply: async (target) => {
        const row = await env.DB.prepare(
          "SELECT room_id FROM messages WHERE id = ?",
        )
          .bind(target)
          .first<{ room_id: string }>();
        await leaveChannel(row?.room_id ?? "", world.bob.userId);
      },
      expected: { code: "NOT_FOUND", status: 404 },
      private: true,
    },
    {
      label: "チャンネルをアーカイブする",
      apply: async () => archiveChannel(world.channel),
      expected: { code: "NOT_FOUND", status: 404 },
    },
    {
      label: "部署を無効にする",
      apply: async () => deactivateDepartment(world.dept.id),
      expected: { code: "CONFLICT", status: 409 },
    },
    {
      label: "投稿を削除する",
      apply: async (target) => markDeleted(target, world.alice.userId),
      expected: { code: "CONFLICT", status: 409 },
    },
  ];

  it.each(changes.flatMap((c) => OPERATIONS.map((op) => [op, c] as const)))(
    "#138 コードレビュー1回目（重大）: %s：再判定は通り、集計を読む直前に変わると、集計・付けた人の名前を返さず、成功（200 相当）にもならない。requireReactable の拒否に従う",
    async (op, change) => {
      let room = world.channel;
      if (change.private === true)
        room = await insertChannel({
          name: `${TEST_TAG}非公開レビュー`,
          purpose: "normal",
          departmentId: world.dept.id,
          visibility: "private",
        });
      if (change.private === true) {
        await insertMember(room, world.alice.userId);
        await insertMember(room, world.bob.userId);
        await insertMember(room, world.dave.userId);
      }
      const target = await prepare(op, room);
      const outcome = await perform(op, world.bob.userId, {
        messageId: target,
        beforeLoad: async () => {
          await change.apply(target);
          return "real";
        },
      });
      expect(outcome.error, change.label).toMatchObject(change.expected);
      expect(outcome.result).toBeUndefined();
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    },
  );

  it.each(OPERATIONS)(
    "#138 コードレビュー1回目（重大）: %s：DM の相手が集計を読む直前に無効になると、409 で、集計・名前を返さない",
    async (op) => {
      const dm = await insertDm(world.alice.userId, world.bob.userId);
      const target = await seedParent(dm, world.alice.userId, 41);
      await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
        .bind(SECRET, world.alice.userId)
        .run();
      await insertReactionRow({
        messageId: target,
        userId: world.alice.userId,
        kind: "emoji",
        value: "👏",
        createdAt: reactionIsoAt(1),
      });
      if (op === "add")
        await insertReactionRow({
          messageId: target,
          userId: world.bob.userId,
          kind: "emoji",
          value: "👍",
          createdAt: reactionIsoAt(2),
        });
      const outcome = await perform(op, world.bob.userId, {
        messageId: target,
        beforeLoad: async () => {
          await deactivateUser(world.alice.userId);
          return "real";
        },
      });
      expect(outcome.error).toMatchObject({ code: "CONFLICT", status: 409 });
      expect(outcome.result).toBeUndefined();
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    },
  );

  it.each(OPERATIONS)(
    "#138 コードレビュー1回目（重大）: %s：読み取りが「条件が成り立っていない」（null）を返し、再判定にも拒否の理由がないときは、成功にせず 409「状態が変わりました。もう一度お試しください」",
    async (op) => {
      await prepare(op);
      const outcome = await perform(op, world.bob.userId, {
        beforeLoad: async () => "unreactable",
      });
      expect(outcome.result).toBeUndefined();
      expect(outcome.error).toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: CONFLICT_MESSAGE,
      });
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    },
  );
});
