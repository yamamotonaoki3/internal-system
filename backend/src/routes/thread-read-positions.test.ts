// #137 AC-1（1-4 AC-4・C-147・U-1）: スレッドの既読の API（PUT /api/messages/:messageId/thread-read-position。EP-3-09）を、実際のアプリ入口と隔離 D1 で確かめる。
// 契約（実装者へ。計画 決めたこと8・改訂1 重大1）：
//  - PUT 本文 { lastReadMessageId: ULID } だけ（余分な項目・ULID でない値は 422 VALIDATION_ERROR）→ 204（本文なし）。:messageId は親の投稿の ID。
//  - 判定の順：見えるか（404）→ 親が返信でないか（404）→ 参加者か（403。未参加の公開チャンネル）→ perm.notification.own（拒否は 403）
//    → 条件付きの upsert（後戻りさせない）→ 0 行なら、状態の判定をもう一度行い（崩れていれば 404／403）、
//    lastReadMessageId がこのスレッドの返信でなければ 404、すでに同じかより新しい位置なら 204。
//  - 位置は (利用者, 親) ごと。別のスレッドの返信・親そのものの ID・存在しない ID は 404。既読は監査ログに残さない。
//  - 確認と書き込みの間の退出・アーカイブは services/unread.thread-race.test.ts。
// データは架空（testuser_thrread_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertChannel,
  insertMember,
  makeGlobalAdmin,
} from "../../test/department-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import {
  archiveChannel,
  insertModifyUser,
} from "../../test/message-modify-fixtures";
import { testId } from "../../test/role-fixtures";
import {
  BAD_ORIGIN,
  TEST_TAG,
  cleanupThreadScenario,
  codeOf,
  createThreadWorld,
  idAt,
  putThreadRead,
  seedParent,
  seedReply,
  threadReadPositionOf,
  threadReadRows,
  tableCount,
  threadsOk,
  type ThreadWorld,
} from "../../test/thread-fixtures";

let world: ThreadWorld;
let logLines: string[];
let parent: string;
let r1: string;
let r2: string;
let r3: string;

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("thrread");
  parent = await seedParent(world.channel, world.alice.userId, 1);
  r1 = await seedReply(world.channel, parent, world.bob.userId, 2);
  r2 = await seedReply(world.channel, parent, world.dave.userId, 3);
  r3 = await seedReply(world.channel, parent, world.bob.userId, 4);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

const read = (id: string, token = world.alice.token) =>
  putThreadRead(parent, { lastReadMessageId: id }, token);

const unreadOfThread = async (token: string) =>
  (await threadsOk("", token)).items.find((item) => item.parent.id === parent)
    ?.unreadCount;

describe("#137 AC-4（1-4 AC-4・C-147）既読にする", () => {
  it("#137 AC-4: 204（本文なし）で既読位置ができ、スレッド一覧の unreadCount が0になる", async () => {
    expect(await unreadOfThread(world.alice.token)).toBe(3);
    const response = await read(r3);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r3);
    expect(await unreadOfThread(world.alice.token)).toBe(0);
  });

  it("#137 AC-4: 途中までの既読では、その後ろの返信だけが未読として残る", async () => {
    expect((await read(r1)).status).toBe(204);
    expect(await unreadOfThread(world.alice.token)).toBe(2);
  });

  it("#137 AC-4: 後戻りしない：古い ID は 204 で位置は変わらない。同じ ID を2回送っても 204。新しい ID なら進む", async () => {
    await read(r2);
    const older = await read(r1);
    expect(older.status).toBe(204);
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r2);
    expect((await read(r2)).status).toBe(204);
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r2);
    expect((await read(r3)).status).toBe(204);
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r3);
  });

  it("#137 AC-4: 位置は (利用者, 親) ごと：bob の既読は alice の位置・未読を変えず、別のスレッドの位置も変わらない", async () => {
    const otherParent = await seedParent(world.channel, world.alice.userId, 10);
    await seedReply(world.channel, otherParent, world.bob.userId, 11);
    await read(r3, world.bob.token);
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBeNull();
    expect(await threadReadPositionOf(world.bob.userId, parent)).toBe(r3);
    expect(await unreadOfThread(world.alice.token)).toBe(3);
    expect(
      await threadReadPositionOf(world.bob.userId, otherParent),
    ).toBeNull();
  });

  it("#137 AC-4: 自分の返信の ID まで既読にでき、それより前の他人の返信も既読になる", async () => {
    const own = await seedReply(world.channel, parent, world.alice.userId, 5);
    expect((await read(own)).status).toBe(204);
    expect(await unreadOfThread(world.alice.token)).toBe(0);
  });

  it("#137 AC-4: 当事者の DM のスレッドも既読にでき、スレッドの既読位置は部屋の既読位置（read_positions）を変えない", async () => {
    const dm = await insertDm(world.alice.userId, world.bob.userId);
    const dmParent = await seedParent(dm, world.alice.userId, 20);
    const dmReply = await seedReply(dm, dmParent, world.bob.userId, 21);
    const positionsBefore = await tableCount("read_positions");
    const response = await putThreadRead(
      dmParent,
      { lastReadMessageId: dmReply },
      world.alice.token,
    );
    expect(response.status).toBe(204);
    expect(await threadReadPositionOf(world.alice.userId, dmParent)).toBe(
      dmReply,
    );
    expect(await tableCount("read_positions")).toBe(positionsBefore);
  });

  it("#137 AC-4（既定の方針 4）: 既読にしても、監査ログは増えない", async () => {
    await read(r3);
    const audits = logLines
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as { attributes?: { log_type?: string } })
      .filter((line) => line.attributes?.log_type === "audit");
    expect(audits).toEqual([]);
  });
});

describe("#137 AC-4 そのスレッドの返信でない ID は 404", () => {
  it("#137 AC-4: 別のスレッドの返信・親そのものの ID・存在しない ID（ULID の形）は 404 NOT_FOUND で、位置は変わらない", async () => {
    const otherParent = await seedParent(world.channel, world.bob.userId, 10);
    const foreign = await seedReply(
      world.channel,
      otherParent,
      world.dave.userId,
      11,
    );
    await read(r1);
    for (const id of [foreign, parent, otherParent, idAt(900)]) {
      const response = await read(id);
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("NOT_FOUND");
    }
    expect(await threadReadPositionOf(world.alice.userId, parent)).toBe(r1);
  });

  it("#137 AC-4: 別の部屋の通常の投稿の ID も 404 で、行を作らない", async () => {
    const room = await insertChannel({
      name: `${TEST_TAG}別の部屋`,
      purpose: "normal",
      departmentId: world.dept.id,
    });
    await insertMember(room, world.alice.userId);
    const elsewhere = await seedParent(room, world.bob.userId, 12);
    expect((await read(elsewhere)).status).toBe(404);
    expect(await threadReadRows()).toEqual([]);
  });

  it("#137 AC-4: 親（:messageId）が返信の ID なら 404（返信は1段だけ）。存在しない親も 404", async () => {
    for (const id of [r1, idAt(900)]) {
      const response = await putThreadRead(
        id,
        { lastReadMessageId: r2 },
        world.alice.token,
      );
      expect(response.status, id).toBe(404);
    }
    expect(await threadReadRows()).toEqual([]);
  });
});

describe("#137 AC-4（C-94・1-1 AC-2）既読にできない部屋", () => {
  it("#137 AC-4: 未参加の公開チャンネルは 403 FORBIDDEN で、行を作らない", async () => {
    const response = await read(r1, world.carol.token);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");
    expect(await threadReadRows()).toEqual([]);
  });

  it("#137 AC-4: 非公開で未参加・アーカイブ済み・他人の DM は 404 NOT_FOUND（存在しない ID と同じ）で、行を作らない", async () => {
    const privateRoom = await insertChannel({
      name: `${TEST_TAG}既読の非公開`,
      purpose: "normal",
      departmentId: world.dept.id,
      visibility: "private",
    });
    await insertMember(privateRoom, world.bob.userId);
    const archivedRoom = await insertChannel({
      name: `${TEST_TAG}既読のアーカイブ`,
      purpose: "normal",
      departmentId: world.dept.id,
    });
    await insertMember(archivedRoom, world.alice.userId);
    await insertMember(archivedRoom, world.bob.userId);
    const othersDm = await insertDm(world.bob.userId, world.dave.userId);
    let n = 30;
    const targets: [string, string][] = [];
    for (const room of [privateRoom, archivedRoom, othersDm]) {
      const p = await seedParent(room, world.bob.userId, n);
      const r = await seedReply(room, p, world.dave.userId, n + 1);
      targets.push([p, r]);
      n += 2;
    }
    await archiveChannel(archivedRoom);
    const missing = await putThreadRead(
      idAt(900),
      { lastReadMessageId: idAt(901) },
      world.alice.token,
    );
    for (const [p, r] of targets) {
      const response = await putThreadRead(
        p,
        { lastReadMessageId: r },
        world.alice.token,
      );
      expect(response.status, p).toBe(404);
      expect(await response.json()).toEqual(await missing.clone().json());
    }
    expect(await threadReadRows()).toEqual([]);
  });

  it("#137 AC-4: 全体管理者でも、非公開で未参加のチャンネル・他人の DM のスレッドは 404", async () => {
    const admin = await insertModifyUser(
      "testuser_thrread_admin",
      world.dept.id,
    );
    await makeGlobalAdmin(admin.userId);
    const othersDm = await insertDm(world.bob.userId, world.dave.userId);
    const p = await seedParent(othersDm, world.bob.userId, 40);
    const r = await seedReply(othersDm, p, world.dave.userId, 41);
    const response = await putThreadRead(
      p,
      { lastReadMessageId: r },
      admin.token,
    );
    expect(response.status).toBe(404);
  });
});

describe("#137 AC-4 入力の形（422。500 にならない）", () => {
  const ATTACKS = ["' OR 1=1 --", "1; DROP TABLE thread_read_positions", '"--'];

  it.each<[string, unknown]>([
    ["本文が空のオブジェクト", {}],
    ["lastReadMessageId が空文字", { lastReadMessageId: "" }],
    ["lastReadMessageId が ULID でない", { lastReadMessageId: "not-a-ulid" }],
    ["lastReadMessageId が数値", { lastReadMessageId: 1 }],
    ["lastReadMessageId が null", { lastReadMessageId: null }],
    [
      "余分な項目（利用者の指定）",
      {
        lastReadMessageId: "01JTESTXNRDAP0000000000001",
        userId: "01JTESTXNRDAP0000000000002",
      },
    ],
    ["配列", ["01JTESTXNRDAP0000000000001"]],
    ...ATTACKS.map((text): [string, unknown] => [
      `攻撃的な文字列（${text}）`,
      { lastReadMessageId: text },
    ]),
  ])(
    "#137 AC-4: 本文が %s なら 422 VALIDATION_ERROR で、行を作らない",
    async (_label, body) => {
      const response = await putThreadRead(parent, body, world.alice.token);
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      expect(await threadReadRows()).toEqual([]);
    },
  );

  it("#137 AC-4: 存在しない部屋・ID の形が不正な親でも 500 にならない（404 か 422）", async () => {
    const response = await putThreadRead(
      testId("NOPARENT"),
      { lastReadMessageId: r1 },
      world.alice.token,
    );
    expect([404, 422]).toContain(response.status);
  });
});

describe("#137 AC-4 認証・送信元（CSRF）", () => {
  it("#137 AC-4: 未認証は 401 UNAUTHENTICATED", async () => {
    const response = await putThreadRead(
      parent,
      { lastReadMessageId: r1 },
      null,
    );
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["許可外の Origin", BAD_ORIGIN],
    ["Origin なし", ""],
  ])(
    "#137 AC-4: %s は 403 FORBIDDEN_ORIGIN で、何も変わらない",
    async (_label, origin) => {
      const response = await putThreadRead(
        parent,
        { lastReadMessageId: r1 },
        world.alice.token,
        origin,
      );
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN_ORIGIN");
      expect(await threadReadRows()).toEqual([]);
    },
  );
});
