// #143-a a-AC-2・a-AC-3（2-6 AC-6）: アーカイブの効果（計画 #143「2. アーカイブの効果」の表）を、実際のアプリ入口と隔離 D1 で代表の経路ごとに確かめる。
// アーカイブは本物の API（POST /api/channels/:channelId/delete）で行い、その後の既存の経路の応答を見る。各経路の SQL の条件そのものは、既存の DB テストが持つ
// （計画「テストケース（a）」の「a-AC-2 の効果：結合（代表の確認）」）。
// 期待値（計画 2章）：アーカイブ中は、一覧から消え、詳細・メッセージの一覧・投稿・返信・編集・削除・リアクション・参加・招待・添付のアップロードと取得が 404。
//   メッセージ・添付の行は残る。復元すると、元の参加者・メッセージ・添付がそのまま見え、投稿できる。アーカイブしていないチャンネルは今までどおり。
// データは架空（testuser_chfx_、[UNIT_TEST]、@example.com）。R2 は手元の Miniflare の保存先だけ。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  attachmentRow,
  downloadAttachment,
  seedStoredAttachment,
  uploadFile,
} from "../../test/attachment-fixtures";
import {
  TEST_TAG,
  channelVersion,
  cleanupChannelManageScenario,
  insertManagedChannel,
} from "../../test/channel-manage-fixtures";
import {
  insertDepartmentWithChannels,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { messageCount } from "../../test/message-fixtures";
import {
  deleteMessage,
  editMessage,
  insertModifyUser,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { postReaction } from "../../test/reaction-fixtures";
import { postReply, seedParent, seedReply } from "../../test/thread-fixtures";

let dept: SeededDepartment;
let owner: ModifyUser;
let member: ModifyUser;
let outsider: ModifyUser;
let room: string;
let other: string;
let parent: string;
let own: string;
let attachment: string;

const BYTES = new TextEncoder().encode("[UNIT_TEST]添付");

async function archive() {
  const response = await apiRequest("POST", `/api/channels/${room}/delete`, {
    token: owner.token,
    body: { version: await channelVersion(room) },
  });
  expect(response.status).toBe(200);
}

async function restore() {
  const response = await apiRequest("POST", `/api/channels/${room}/restore`, {
    token: owner.token,
    body: { version: await channelVersion(room) },
  });
  expect(response.status).toBe(200);
}

const post = (roomId: string, token: string) =>
  apiRequest("POST", `/api/rooms/${roomId}/messages`, {
    token,
    body: { body: `${TEST_TAG}投稿` },
  });

async function listedIds(token: string) {
  const response = await apiRequest("GET", "/api/channels?limit=100", {
    token,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: { id: string }[] }).items.map(
    (item) => item.id,
  );
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  dept = await insertDepartmentWithChannels("管理効果");
  owner = await insertModifyUser("testuser_chfx_owner", dept.id, 0);
  member = await insertModifyUser("testuser_chfx_member", dept.id, 0);
  outsider = await insertModifyUser("testuser_chfx_outsider", dept.id, 0);
  await makeOwner(owner.userId, dept.id);
  room = await insertManagedChannel("管理効果の部屋", {
    departmentId: dept.id,
    members: [owner.userId, member.userId],
  });
  other = await insertManagedChannel("管理効果の別の部屋", {
    departmentId: dept.id,
    members: [owner.userId, member.userId],
  });
  parent = await seedParent(room, owner.userId, 1);
  await seedReply(room, parent, owner.userId, 2);
  own = await seedParent(room, member.userId, 3);
  attachment = await seedStoredAttachment(
    {
      roomId: room,
      uploaderId: member.userId,
      messageId: own,
    },
    BYTES,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChannelManageScenario();
});

describe("#143 a-AC-2（2-6 AC-6・計画 2章）アーカイブ中の各経路", () => {
  it("#143 a-AC-2: アーカイブの前は見えている（以下の 404 が空振りでないことの確認）", async () => {
    expect(await listedIds(member.token)).toContain(room);
    expect(
      (
        await apiRequest("GET", `/api/channels/${room}`, {
          token: member.token,
        })
      ).status,
    ).toBe(200);
    expect((await downloadAttachment(attachment, member.token)).status).toBe(
      200,
    );
  });

  it("#143 a-AC-2: 一覧から消え、詳細・メッセージの一覧は参加者にも 404", async () => {
    await archive();
    expect(await listedIds(member.token)).not.toContain(room);
    expect(await listedIds(member.token)).toContain(other);
    for (const target of [
      `/api/channels/${room}`,
      `/api/rooms/${room}/messages`,
    ]) {
      const response = await apiRequest("GET", target, { token: member.token });
      expect(response.status, target).toBe(404);
    }
  });

  it.each([
    ["投稿", () => post(room, member.token)],
    [
      "返信",
      () => postReply(parent, { body: `${TEST_TAG}返信` }, member.token),
    ],
    ["編集", () => editMessage(own, { body: `${TEST_TAG}編集` }, member.token)],
    ["本人の削除", () => deleteMessage(own, member.token)],
    [
      "リアクション",
      () => postReaction(parent, { kind: "emoji", value: "👍" }, member.token),
    ],
    [
      "参加（公開）",
      () =>
        apiRequest("POST", `/api/channels/${room}/join`, {
          token: outsider.token,
        }),
    ],
    [
      "招待",
      () =>
        apiRequest("POST", `/api/channels/${room}/invitations`, {
          token: member.token,
          body: { userId: outsider.userId },
        }),
    ],
    [
      "添付のアップロード",
      () =>
        uploadFile(
          { kind: "room", roomId: room },
          "a.txt",
          BYTES,
          member.token,
        ),
    ],
    ["添付の取得", () => downloadAttachment(attachment, member.token)],
  ])("#143 a-AC-2（計画 2章）: アーカイブ中の%sは 404", async (_label, run) => {
    await archive();
    const response = await run();
    expect(response.status).toBe(404);
  });

  it("#143 a-AC-2（2-6 AC-6）: メッセージ・返信・添付の行と実体は残る", async () => {
    const before = await messageCount(room);
    await archive();
    expect(await messageCount(room)).toBe(before);
    expect(await attachmentRow(attachment)).not.toBeNull();
    const deleted = await env.DB.prepare(
      "SELECT deleted_at FROM messages WHERE id = ?",
    )
      .bind(own)
      .first<{ deleted_at: string | null }>();
    expect(deleted?.deleted_at).toBeNull();
  });

  it("#143 a-AC-2（退行）: アーカイブしていない別のチャンネルには、今までどおり投稿できる", async () => {
    await archive();
    expect((await post(other, member.token)).status).toBe(201);
  });
});

describe("#143 a-AC-3（2-6 AC-6）復元で元に戻る", () => {
  it("#143 a-AC-3: 復元すると、一覧・詳細（元の参加者）・メッセージ・添付がそのまま見え、投稿できる", async () => {
    await archive();
    await restore();
    expect(await listedIds(member.token)).toContain(room);
    const shown = await apiRequest("GET", `/api/channels/${room}`, {
      token: member.token,
    });
    expect(shown.status).toBe(200);
    const body = (await shown.json()) as {
      joined: boolean;
      members: { id: string }[];
    };
    expect(body.joined).toBe(true);
    expect(body.members.map((m) => m.id).sort()).toEqual(
      [owner.userId, member.userId].sort(),
    );
    const messages = await apiRequest("GET", `/api/rooms/${room}/messages`, {
      token: member.token,
    });
    expect(messages.status).toBe(200);
    const ids = (
      (await messages.json()) as { items: { id: string }[] }
    ).items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([parent, own]));
    expect((await downloadAttachment(attachment, member.token)).status).toBe(
      200,
    );
    expect((await post(room, member.token)).status).toBe(201);
  });
});
