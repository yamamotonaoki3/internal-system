// #139 AC-1〜AC-3（1-8 AC-1〜AC-3、3-2 AC-1〜AC-3）：指名の候補・保存・通知を実アプリ入口と隔離 D1 で確認する。
// 同名はIDで区別する。公開チャンネルの未参加者と自分への通知は作らないが、指名は保存する。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  messageCount,
} from "../../test/message-fixtures";
import { cleanupNotificationTestData } from "../../test/notification-fixtures";

type User = { userId: string; token: string };
type Mention = { userId: string; start: number; end: number };

let department: SeededDepartment;
let sender: User;
let member: User;
let sameNameOther: User;
let publicNonmember: User;

const room = () => department.dedicatedChannelId;
const post = (body: string, mentions: Mention[], token = sender.token) =>
  apiRequest("POST", `/api/rooms/${room()}/messages`, {
    token,
    body: { body, mentions },
  });
const notificationsFor = async (userId: string) => {
  const { results } = await env.DB.prepare(
    "SELECT user_id, room_id, message_id FROM notifications WHERE user_id = ? ORDER BY id",
  )
    .bind(userId)
    .all<{
      user_id: string;
      room_id: string | null;
      message_id: string | null;
    }>();
  return results;
};

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  department = await insertDepartmentWithChannels("指名API");
  sender = await insertReadyUser("testuser_mentions_sender", department.id);
  member = await insertReadyUser("testuser_mentions_member", department.id);
  sameNameOther = await insertReadyUser(
    "testuser_mentions_same_other",
    department.id,
  );
  publicNonmember = await insertReadyUser(
    "testuser_mentions_public_nonmember",
    department.id,
  );
  await insertMember(room(), sender.userId);
  await insertMember(room(), member.userId);
  await insertMember(room(), sameNameOther.userId);
  await env.DB.prepare(
    "UPDATE users SET display_name = '同名' WHERE id IN (?, ?)",
  )
    .bind(member.userId, sameNameOther.userId)
    .run();
  await env.DB.prepare("UPDATE users SET display_name = '本人' WHERE id = ?")
    .bind(sender.userId)
    .run();
  await env.DB.prepare("UPDATE users SET display_name = '未参加' WHERE id = ?")
    .bind(publicNonmember.userId)
    .run();
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    const mentionTable = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE name = 'message_mentions'",
    ).first();
    if (mentionTable)
      await env.DB.prepare(
        "DELETE FROM message_mentions WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')",
      ).run();
    await cleanupNotificationTestData();
  } finally {
    await cleanupMessageScenario();
  }
});

describe("#139 AC-1（1-8 AC-1）指名候補", () => {
  it("#139 AC-1: 同名の有効社員を別IDと部署付きで返し、公開チャンネル未参加者も候補に含める", async () => {
    const response = await apiRequest(
      "GET",
      `/api/rooms/${room()}/mention-candidates`,
      { token: sender.token },
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      items: { id: string; displayName: string; departmentName: string }[];
    };
    expect(page.items).toEqual(
      expect.arrayContaining([
        {
          id: member.userId,
          displayName: "同名",
          departmentName: department.name,
        },
        {
          id: sameNameOther.userId,
          displayName: "同名",
          departmentName: department.name,
        },
        {
          id: publicNonmember.userId,
          displayName: "未参加",
          departmentName: department.name,
        },
      ]),
    );
  });

  it("#139 AC-1: 候補取得も投稿資格を要求し、未認証者と未参加者へ社員情報を返さない", async () => {
    const path = `/api/rooms/${room()}/mention-candidates`;
    const unauthenticated = await apiRequest("GET", path);
    expect(unauthenticated.status).toBe(401);
    const nonmember = await apiRequest("GET", path, {
      token: publicNonmember.token,
    });
    expect(nonmember.status).toBe(403);
  });
});

describe("#139 AC-2・AC-3（1-8、3-2）指名と通知", () => {
  it("#139 AC-2: 同名の別IDは指名せず、選んだ参加者だけへ1件通知する", async () => {
    const body = "@同名 にお願いします";
    const response = await post(body, [
      { userId: member.userId, start: 0, end: 3 },
    ]);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    expect(await notificationsFor(member.userId)).toEqual([
      { user_id: member.userId, room_id: room(), message_id: created.id },
    ]);
    expect(await notificationsFor(sameNameOther.userId)).toEqual([]);
    const list = await apiRequest("GET", `/api/rooms/${room()}/messages`, {
      token: sender.token,
    });
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      items: { id: string; mentions: Mention[] }[];
    };
    expect(page.items.find((item) => item.id === created.id)?.mentions).toEqual(
      [{ userId: member.userId, start: 0, end: 3 }],
    );
  });

  it("#139 AC-3: 未参加の公開チャンネル社員への指名は保存するが通知しない", async () => {
    const response = await post("@未参加", [
      { userId: publicNonmember.userId, start: 0, end: 4 },
    ]);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const list = await apiRequest("GET", `/api/rooms/${room()}/messages`, {
      token: sender.token,
    });
    const page = (await list.json()) as {
      items: { id: string; mentions: Mention[] }[];
    };
    expect(page.items.find((item) => item.id === created.id)?.mentions).toEqual(
      [{ userId: publicNonmember.userId, start: 0, end: 4 }],
    );
    expect(await notificationsFor(publicNonmember.userId)).toEqual([]);
  });

  it("#139 AC-2: 自分の指名は保存し、アプリ通知は作らない", async () => {
    const response = await post("@本人", [
      { userId: sender.userId, start: 0, end: 3 },
    ]);
    expect(response.status).toBe(201);
    expect(await notificationsFor(sender.userId)).toEqual([]);
  });

  it("#139 AC-1: 普通の@文字列は指名でも通知でもない", async () => {
    const response = await apiRequest("POST", `/api/rooms/${room()}/messages`, {
      token: sender.token,
      body: { body: "@同名 ただの文字列" },
    });
    expect(response.status).toBe(201);
    expect(await notificationsFor(member.userId)).toEqual([]);
    expect(await notificationsFor(sameNameOther.userId)).toEqual([]);
    expect(await messageCount(room())).toBe(1);
  });
});
describe("#139 AC-2（編集・返信・S-35）", () => {
  it("#139 AC-2: 編集では新規指名だけ通知し、除去後の再追加だけ再通知する", async () => {
    const first = await post("@同名", [
      { userId: member.userId, start: 0, end: 3 },
    ]);
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const edit = (body: string, mentions: Mention[]) =>
      apiRequest("PATCH", "/api/messages/" + id, {
        token: sender.token,
        body: { body, mentions },
      });
    const add = await edit("@同名 @同名", [
      { userId: member.userId, start: 0, end: 3 },
      { userId: sameNameOther.userId, start: 4, end: 7 },
    ]);
    expect(add.status).toBe(200);
    expect(((await add.json()) as { mentions: Mention[] }).mentions).toEqual([
      { userId: member.userId, start: 0, end: 3 },
      { userId: sameNameOther.userId, start: 4, end: 7 },
    ]);
    expect(await notificationsFor(member.userId)).toHaveLength(1);
    expect(await notificationsFor(sameNameOther.userId)).toHaveLength(1);
    const remove = await edit("指名なし", []);
    expect(remove.status).toBe(200);
    expect(((await remove.json()) as { mentions: Mention[] }).mentions).toEqual(
      [],
    );
    expect(await notificationsFor(member.userId)).toHaveLength(1);
    const readd = await edit("@同名", [
      { userId: member.userId, start: 0, end: 3 },
    ]);
    expect(readd.status).toBe(200);
    expect(await notificationsFor(member.userId)).toHaveLength(2);
    expect(await notificationsFor(sameNameOther.userId)).toHaveLength(1);
  });

  it("#139 AC-2・1-4 AC-4: 返信で指名された参加者には通知しS-35にそのスレッドを含める", async () => {
    const first = await apiRequest(
      "POST",
      "/api/rooms/" + room() + "/messages",
      {
        token: sender.token,
        body: { body: "親の投稿" },
      },
    );
    expect(first.status).toBe(201);
    const { id: parentId } = (await first.json()) as { id: string };
    const reply = await apiRequest(
      "POST",
      "/api/messages/" + parentId + "/replies",
      {
        token: sender.token,
        body: {
          body: "@同名 返信です",
          mentions: [{ userId: member.userId, start: 0, end: 3 }],
        },
      },
    );
    expect(reply.status).toBe(201);
    const { id: replyId } = (await reply.json()) as { id: string };
    expect(await notificationsFor(member.userId)).toEqual([
      { user_id: member.userId, room_id: room(), message_id: replyId },
    ]);
    const threads = await apiRequest("GET", "/api/me/threads", {
      token: member.token,
    });
    expect(threads.status).toBe(200);
    const page = (await threads.json()) as {
      items: { parent: { id: string } }[];
    };
    expect(page.items.map((item) => item.parent.id)).toContain(parentId);
  });
});

describe("#139 AC-1〜AC-3（入力境界と通知資格）", () => {
  it("#139 AC-2: 同じ社員の2か所の指名を両方保存し通知は1件にする", async () => {
    const response = await post("@同名 と @同名", [
      { userId: member.userId, start: 0, end: 3 },
      { userId: member.userId, start: 6, end: 9 },
    ]);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await notificationsFor(member.userId)).toEqual([
      { user_id: member.userId, room_id: room(), message_id: id },
    ]);
    const list = await apiRequest("GET", "/api/rooms/" + room() + "/messages", {
      token: sender.token,
    });
    const page = (await list.json()) as {
      items: { id: string; mentions: Mention[] }[];
    };
    expect(page.items.find((item) => item.id === id)?.mentions).toEqual([
      { userId: member.userId, start: 0, end: 3 },
      { userId: member.userId, start: 6, end: 9 },
    ]);
  });

  it.each([
    ["負の開始位置", "@同名", [{ userId: "TARGET", start: -1, end: 3 }]],
    ["整数でない開始位置", "@同名", [{ userId: "TARGET", start: 0.5, end: 3 }]],
    ["本文を超える終了位置", "@同名", [{ userId: "TARGET", start: 0, end: 4 }]],
    ["@のない区間", "同名です", [{ userId: "TARGET", start: 0, end: 2 }]],
    [
      "重なる指名",
      "@同名",
      [
        { userId: "TARGET", start: 0, end: 3 },
        { userId: "TARGET", start: 0, end: 3 },
      ],
    ],
    ["サロゲートの途中", "😀@同名", [{ userId: "TARGET", start: 1, end: 5 }]],
  ] as const)(
    "#139 AC-1: %s は422で本文・通知を保存しない",
    async (_label, body, mentions) => {
      const actual = mentions.map((mention) => ({
        ...mention,
        userId: member.userId,
      }));
      const response = await post(body, actual);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await messageCount(room())).toBe(0);
      expect(await notificationsFor(member.userId)).toEqual([]);
    },
  );

  it("#139 AC-3・3-2 AC-2: 非公開chの閲覧権限を失うと通知の保存行は残り一覧と未読から除かれる", async () => {
    const privateRoom = await insertChannel({
      name: "[UNIT_TEST]指名非公開",
      purpose: "normal",
      departmentId: department.id,
      visibility: "private",
    });
    await insertMember(privateRoom, sender.userId);
    await insertMember(privateRoom, member.userId);
    const response = await apiRequest(
      "POST",
      "/api/rooms/" + privateRoom + "/messages",
      {
        token: sender.token,
        body: {
          body: "@同名",
          mentions: [{ userId: member.userId, start: 0, end: 3 }],
        },
      },
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await notificationsFor(member.userId)).toHaveLength(1);
    await env.DB.prepare(
      "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(privateRoom, member.userId)
      .run();
    const list = await apiRequest("GET", "/api/me/notifications", {
      token: member.token,
    });
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      items: { messageId: string | null }[];
    };
    expect(page.items.map((item) => item.messageId)).not.toContain(id);
    const unread = await apiRequest(
      "GET",
      "/api/me/notifications/unread-count",
      {
        token: member.token,
      },
    );
    expect(unread.status).toBe(200);
    expect(await unread.json()).toMatchObject({ count: 0 });
    expect(await notificationsFor(member.userId)).toHaveLength(1);
  });
});

describe("#139 AC-2（同時編集の原子性）", () => {
  it("#139 AC-2: 同時編集で最終本文と指名位置を一致させ、通知を二重に作らない", async () => {
    const first = await apiRequest(
      "POST",
      "/api/rooms/" + room() + "/messages",
      {
        token: sender.token,
        body: { body: "元の本文" },
      },
    );
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const edit = (body: string, userId: string) =>
      apiRequest("PATCH", "/api/messages/" + id, {
        token: sender.token,
        body: { body, mentions: [{ userId, start: 0, end: 3 }] },
      });
    const [a, b] = await Promise.all([
      edit("@同名 A", member.userId),
      edit("@同名 B", sameNameOther.userId),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const list = await apiRequest("GET", "/api/rooms/" + room() + "/messages", {
      token: sender.token,
    });
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      items: { id: string; body: string; mentions: Mention[] }[];
    };
    const item = page.items.find((entry) => entry.id === id);
    expect(item?.body === "@同名 A" || item?.body === "@同名 B").toBe(true);
    expect(item?.mentions).toEqual([
      {
        userId: item?.body === "@同名 A" ? member.userId : sameNameOther.userId,
        start: 0,
        end: 3,
      },
    ]);
    expect(await notificationsFor(member.userId)).toHaveLength(1);
    expect(await notificationsFor(sameNameOther.userId)).toHaveLength(1);
  });

  it("#139 AC-2: 同じ社員への同時編集2回は通知を1件だけ作る", async () => {
    const first = await apiRequest(
      "POST",
      "/api/rooms/" + room() + "/messages",
      {
        token: sender.token,
        body: { body: "元の本文" },
      },
    );
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const edit = (body: string) =>
      apiRequest("PATCH", "/api/messages/" + id, {
        token: sender.token,
        body: {
          body,
          mentions: [{ userId: member.userId, start: 0, end: 3 }],
        },
      });
    const [a, b] = await Promise.all([edit("@同名 A"), edit("@同名 B")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await notificationsFor(member.userId)).toHaveLength(1);
    const list = await apiRequest("GET", "/api/rooms/" + room() + "/messages", {
      token: sender.token,
    });
    const page = (await list.json()) as {
      items: { id: string; mentions: Mention[] }[];
    };
    expect(page.items.find((item) => item.id === id)?.mentions).toEqual([
      { userId: member.userId, start: 0, end: 3 },
    ]);
  });
});

describe("#139 AC-1（1-8 AC-1、1-4 AC-1）お知らせ専用チャンネルの候補", () => {
  it("#139 AC-1: 新規投稿できない参加者も返信用の指名候補を取得できる", async () => {
    const announcementRoom = department.announcementChannelId;
    await insertMember(announcementRoom, sender.userId);
    const postResponse = await apiRequest(
      "POST",
      `/api/rooms/${announcementRoom}/messages`,
      {
        token: sender.token,
        body: { body: "投稿できない" },
      },
    );
    expect(postResponse.status).toBe(403);
    const response = await apiRequest(
      "GET",
      `/api/rooms/${announcementRoom}/mention-candidates`,
      {
        token: sender.token,
      },
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: { id: string }[] };
    expect(page.items.map((item) => item.id)).toContain(member.userId);
  });
});
