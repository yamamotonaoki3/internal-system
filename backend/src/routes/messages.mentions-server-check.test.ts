// #139 AC-1・AC-2（1-8、3-2）：サーバー側の指名の検査（社員ID・表示名との一致・コード内の@）と、読み取りで指名が返ることを、
// 実アプリ入口と隔離 D1 で確認する。期待値は仕様（docs/design/mentions.md「処理の流れ」3、C-171・C-173）から決める。
// 検査に落ちた要求は 422 VALIDATION_ERROR で、投稿・指名・通知の行を一切残さない。データは架空（testuser_）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import { insertModifyUser } from "../../test/message-modify-fixtures";
import { deactivateUser } from "../../test/dm-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { cleanupMessageScenario, ulidAt } from "../../test/message-fixtures";
import { cleanupNotificationTestData } from "../../test/notification-fixtures";

type User = { userId: string; token: string };
type Mention = { userId: string; start: number; end: number };
type Operation = "post" | "reply" | "edit";

let department: SeededDepartment;
let sender: User;
let target: User;
let other: User;
let retired: User;
let parentId: string;
let editableId: string;

const room = () => department.dedicatedChannelId;
const TARGET_NAME = "検査対象";
const OTHER_NAME = "別人名";

async function createMessage(body: string, path: string): Promise<string> {
  const response = await apiRequest("POST", path, {
    token: sender.token,
    body: { body },
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function submit(operation: Operation, body: string, mentions: Mention[]) {
  if (operation === "post")
    return apiRequest("POST", `/api/rooms/${room()}/messages`, {
      token: sender.token,
      body: { body, mentions },
    });
  if (operation === "reply")
    return apiRequest("POST", `/api/messages/${parentId}/replies`, {
      token: sender.token,
      body: { body, mentions },
    });
  return apiRequest("PATCH", `/api/messages/${editableId}`, {
    token: sender.token,
    body: { body, mentions },
  });
}

/** 検査に落ちたとき変わってはならないもの（メッセージ本文・指名行・通知行）をまとめて読む */
async function snapshot() {
  const messages = await env.DB.prepare(
    "SELECT id, body, edited_at FROM messages WHERE room_id = ? ORDER BY id",
  )
    .bind(room())
    .all();
  const mentions = await env.DB.prepare(
    "SELECT message_id, user_id, start, end FROM message_mentions WHERE user_id IN (?, ?, ?, ?) ORDER BY message_id, start",
  )
    .bind(sender.userId, target.userId, other.userId, retired.userId)
    .all();
  const notifications = await env.DB.prepare(
    "SELECT id FROM notifications WHERE user_id IN (?, ?, ?, ?) ORDER BY id",
  )
    .bind(sender.userId, target.userId, other.userId, retired.userId)
    .all();
  return {
    messages: messages.results,
    mentions: mentions.results,
    notifications: notifications.results,
  };
}

const mentionOf = (
  body: string,
  text: string,
  userId = target.userId,
): Mention => {
  const start = body.indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);
  return { userId, start, end: start + text.length };
};

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  department = await insertDepartmentWithChannels("指名検査");
  // 削除は直近の再認証が必要（#134）なため、投稿者だけ再認証済みにする
  sender = await insertModifyUser(
    "testuser_mcheck_sender",
    department.id,
    1000,
  );
  target = await insertReadyUser("testuser_mcheck_target", department.id);
  other = await insertReadyUser("testuser_mcheck_other", department.id);
  retired = await insertReadyUser("testuser_mcheck_retired", department.id);
  for (const user of [sender, target, other, retired])
    await insertMember(room(), user.userId);
  for (const [user, name] of [
    [sender, "検査投稿者"],
    [target, TARGET_NAME],
    [other, OTHER_NAME],
    [retired, "退職者名"],
  ] as const)
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind(name, user.userId)
      .run();
  parentId = await createMessage("親の投稿", `/api/rooms/${room()}/messages`);
  editableId = await createMessage(
    "編集前の本文",
    `/api/rooms/${room()}/messages`,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await env.DB.prepare(
      "DELETE FROM message_mentions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')",
    ).run();
    await cleanupNotificationTestData();
  } finally {
    await cleanupMessageScenario();
  }
});

const OPERATIONS: Operation[] = ["post", "reply", "edit"];

describe("#139 AC-1 サーバーの指名の検査（拒否と副作用なし）", () => {
  describe.each(OPERATIONS)("%s", (operation) => {
    async function expectRejected(body: string, mentions: Mention[]) {
      const before = await snapshot();
      const response = await submit(operation, body, mentions);
      expect(response.status).toBe(422);
      const error = (await response.json()) as {
        code: string;
        fields?: unknown;
      };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.fields).toEqual(expect.arrayContaining(["mentions"]));
      expect(await snapshot()).toEqual(before);
    }

    it(`#139 AC-1: 範囲の文字が「@＋今の表示名」と一致しない（別の人の名前）指名は422で何も残さない [${operation}]`, async () => {
      const body = `@${OTHER_NAME} お願いします`;
      await expectRejected(body, [
        mentionOf(body, `@${OTHER_NAME}`, target.userId),
      ]);
    });

    it(`#139 AC-1: 表示名の一部だけ・表示名より長い範囲の指名は422 [${operation}]`, async () => {
      const shortBody = `@${TARGET_NAME} です`;
      await expectRejected(shortBody, [
        { userId: target.userId, start: 0, end: 3 },
      ]);
      const longBody = `@${TARGET_NAME} です`;
      await expectRejected(longBody, [
        { userId: target.userId, start: 0, end: TARGET_NAME.length + 2 },
      ]);
    });

    it(`#139 AC-1: 表示名が変わった後に古い表示名で指名すると422 [${operation}]`, async () => {
      await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
        .bind("改名後", target.userId)
        .run();
      const body = `@${TARGET_NAME} です`;
      await expectRejected(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: 存在しない社員IDの指名は422 [${operation}]`, async () => {
      const body = `@${TARGET_NAME} です`;
      await expectRejected(body, [
        mentionOf(body, `@${TARGET_NAME}`, ulidAt(1_800_000_000_000)),
      ]);
    });

    it(`#139 AC-1: 無効（退職）の社員IDの指名は422 [${operation}]`, async () => {
      await deactivateUser(retired.userId);
      const body = "@退職者名 です";
      await expectRejected(body, [
        mentionOf(body, "@退職者名", retired.userId),
      ]);
    });

    it.each([
      ["インラインのコードの中", `\`@${TARGET_NAME}\` です`],
      ["フェンスのコードの中", `\`\`\`\n@${TARGET_NAME}\n\`\`\``],
      // 閉じていない単一のバッククォートの後ろは仕様が未決定のため固定しない（Issue #264 AC-6 で決める）
      ["長さの違うバッククォートでは閉じない", `\`\`a\` @${TARGET_NAME}\`\``],
    ])(
      `#139 AC-1: コードの中の@（%s）は指名にできず422 [${operation}]`,
      async (_label, body) => {
        await expectRejected(body, [mentionOf(body, `@${TARGET_NAME}`)]);
      },
    );
  });

  describe.each(OPERATIONS)("%s（受け付ける境界）", (operation) => {
    async function expectAccepted(body: string, mentions: Mention[]) {
      const response = await submit(operation, body, mentions);
      expect([200, 201]).toContain(response.status);
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM message_mentions WHERE user_id = ?",
      )
        .bind(target.userId)
        .first<{ count: number }>();
      expect(row?.count).toBe(mentions.length);
    }

    it(`#139 AC-1: コードの範囲が閉じた後ろの指名は受け付ける [${operation}]`, async () => {
      const body = `\`code\` @${TARGET_NAME}`;
      await expectAccepted(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: フェンスが閉じた後ろの指名は受け付ける [${operation}]`, async () => {
      const body = `\`\`\`\nx\n\`\`\`\n@${TARGET_NAME}`;
      await expectAccepted(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: 同じ長さのバッククォートで閉じた（内側に別の長さを含む）後ろの指名は受け付ける [${operation}]`, async () => {
      const body = `\`\`a\`b\`\` @${TARGET_NAME}`;
      await expectAccepted(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: エスケープしたバッククォートはコードを開かず、その後ろの指名は受け付ける [${operation}]`, async () => {
      const body = `\\\`@${TARGET_NAME}`;
      await expectAccepted(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: @より後ろに閉じていないバッククォートがあっても、@はコードの外なので受け付ける [${operation}]`, async () => {
      const body = `@${TARGET_NAME} のあとに \`コード`;
      await expectAccepted(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: @より後ろでフェンスが開いたままでも、@はコードの外なので受け付ける [${operation}]`, async () => {
      const body = `@${TARGET_NAME}\n\`\`\`\nコード`;
      await expectAccepted(body, [mentionOf(body, `@${TARGET_NAME}`)]);
    });

    it(`#139 AC-1: 指名が0件なら、コードを含む本文でも検査を通る [${operation}]`, async () => {
      const response = await submit(operation, `\`@${TARGET_NAME}`, []);
      expect([200, 201]).toContain(response.status);
    });
  });
});

describe("#139 AC-1 すでに指名と通知がある投稿への不正な編集", () => {
  it("#139 AC-1: 検査に落ちた編集は、本文・編集日時・既存の指名・既存の通知の保存内容を変えない", async () => {
    const body = `@${TARGET_NAME} 最初`;
    const first = await submit("edit", body, [
      mentionOf(body, `@${TARGET_NAME}`),
    ]);
    expect(first.status).toBe(200);
    const read = async () => ({
      message: await env.DB.prepare(
        "SELECT body, edited_at FROM messages WHERE id = ?",
      )
        .bind(editableId)
        .first(),
      mentions: (
        await env.DB.prepare(
          "SELECT message_id, user_id, start, end FROM message_mentions WHERE message_id = ?",
        )
          .bind(editableId)
          .all()
      ).results,
      notifications: (
        await env.DB.prepare(
          "SELECT id, user_id, kind, room_id, message_id, target_id, created_at, read_at FROM notifications WHERE user_id IN (?, ?, ?)",
        )
          .bind(target.userId, other.userId, sender.userId)
          .all()
      ).results,
    });
    const before = await read();
    expect(before.mentions).toHaveLength(1);
    expect(before.notifications).toHaveLength(1);
    expect(before.message?.edited_at).not.toBeNull();

    const badBody = `@${OTHER_NAME} 不正`;
    const rejected = await submit("edit", badBody, [
      mentionOf(badBody, `@${OTHER_NAME}`, target.userId),
    ]);
    expect(rejected.status).toBe(422);
    expect(await read()).toEqual(before);
  });
});

describe("#139 AC-2（編集）返信の編集で指名を足したときの通知先", () => {
  it("#139 AC-2: 返信を編集して新たに指名すると、通知の対象（target_id）はスレッドの親IDで、message_id は返信自身", async () => {
    const replyId = await createMessage(
      "返信です",
      `/api/messages/${parentId}/replies`,
    );
    const body = `@${TARGET_NAME} 返信です`;
    const response = await apiRequest("PATCH", `/api/messages/${replyId}`, {
      token: sender.token,
      body: { body, mentions: [mentionOf(body, `@${TARGET_NAME}`)] },
    });
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(
      "SELECT kind, room_id, message_id, target_id FROM notifications WHERE user_id = ?",
    )
      .bind(target.userId)
      .all();
    expect(results).toEqual([
      {
        kind: "message.mentioned",
        room_id: room(),
        message_id: replyId,
        target_id: parentId,
      },
    ]);
  });

  it("#139 AC-2: 通常投稿の編集で指名を足すと、通知の対象（target_id）は投稿自身のID", async () => {
    const body = `@${TARGET_NAME}`;
    const response = await submit("edit", body, [
      mentionOf(body, `@${TARGET_NAME}`),
    ]);
    expect(response.status).toBe(200);
    const { results } = await env.DB.prepare(
      "SELECT message_id, target_id FROM notifications WHERE user_id = ?",
    )
      .bind(target.userId)
      .all();
    expect(results).toEqual([
      { message_id: editableId, target_id: editableId },
    ]);
  });
});

describe("#139 AC-1（読み取り）指名が各一覧で返る", () => {
  type Item = { id: string; mentions: Mention[]; deleted?: boolean };

  async function createMentioned(path: string) {
    const body = `@${TARGET_NAME} 確認`;
    const mention = mentionOf(body, `@${TARGET_NAME}`);
    const response = await apiRequest("POST", path, {
      token: sender.token,
      body: { body, mentions: [mention] },
    });
    expect(response.status).toBe(201);
    return {
      id: ((await response.json()) as { id: string }).id,
      mention,
    };
  }

  it("#139 AC-1: 部屋の一覧（after）で、指名のある投稿が範囲と社員IDつきで返り、指名のない投稿は空配列", async () => {
    const { id, mention } = await createMentioned(
      `/api/rooms/${room()}/messages`,
    );
    const response = await apiRequest(
      "GET",
      `/api/rooms/${room()}/messages?after=${editableId}`,
      { token: sender.token },
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: Item[] };
    expect(page.items.find((item) => item.id === id)?.mentions).toEqual([
      mention,
    ]);
    const plain = await apiRequest(
      "GET",
      `/api/rooms/${room()}/messages?after=${ulidAt(1_000_000_000_000)}`,
      { token: sender.token },
    );
    const all = ((await plain.json()) as { items: Item[] }).items;
    expect(all.find((item) => item.id === parentId)?.mentions).toEqual([]);
  });

  it("#139 AC-1: スレッドの返信の一覧で、返信の指名が範囲と社員IDつきで返る", async () => {
    const { id, mention } = await createMentioned(
      `/api/messages/${parentId}/replies`,
    );
    const response = await apiRequest(
      "GET",
      `/api/messages/${parentId}/replies`,
      { token: sender.token },
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      parent: Item;
      items: Item[];
    };
    expect(page.items.find((item) => item.id === id)?.mentions).toEqual([
      mention,
    ]);
    expect(page.parent.mentions).toEqual([]);
  });

  it("#139 AC-1: スレッド一覧の親が、親自身の指名を範囲と社員IDつきで返す", async () => {
    const { id, mention } = await createMentioned(
      `/api/rooms/${room()}/messages`,
    );
    await createMessage("返信です", `/api/messages/${id}/replies`);
    const response = await apiRequest("GET", "/api/me/threads", {
      token: target.token,
    });
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: { parent: Item }[] };
    expect(
      page.items.find((item) => item.parent.id === id)?.parent.mentions,
    ).toEqual([mention]);
  });

  it("#139 AC-1: 削除した投稿の指名は、一覧で空配列になる", async () => {
    const { id } = await createMentioned(`/api/rooms/${room()}/messages`);
    const removed = await apiRequest("DELETE", `/api/messages/${id}`, {
      token: sender.token,
    });
    expect(removed.status).toBe(204);
    const response = await apiRequest("GET", `/api/rooms/${room()}/messages`, {
      token: sender.token,
    });
    const page = (await response.json()) as { items: Item[] };
    const item = page.items.find((entry) => entry.id === id);
    expect(item?.deleted).toBe(true);
    expect(item?.mentions).toEqual([]);
  });
});
