// #201 AC-1・AC-3・AC-5: メッセージの Repository の条件付き INSERT（insertIfOrdered）を、マイグレーション済みの D1 で確かめる。
// 1文の中で「部屋の最大IDより大きい」「公開または参加中で未アーカイブ」「投稿者が今も参加者」「お知らせ専用なら権限あり」をすべて確かめ、
// 満たさなければ何も書かずに 0 を返す（確認から書き込みまでの間に状態が変わっても、条件を破る行を残さない）。
// 契約（実装前の仮置き）：insertIfOrdered({ id, roomId, senderId, senderDisplayName, body }) は挿入した行数（1 か 0）を返す。withMessages(env, run) で使う。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  insertMessage,
  messageIds,
  ulidAt,
} from "../../test/message-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { withMessages } from "./message.repository";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let member: string;

beforeEach(async () => {
  deptA = await insertDepartmentWithChannels("メッセージRepoA");
  deptB = await insertDepartmentWithChannels("メッセージRepoB");
  member = await insertUser("testuser_msgrepo_member", deptA.id);
  await insertMember(deptA.dedicatedChannelId, member);
});
afterEach(async () => {
  await cleanupMessageScenario();
});

const NEW_ID = ulidAt(1_800_000_001_000);

function tryInsert(roomId: string, senderId: string, id = NEW_ID) {
  return withMessages(env, (repository) =>
    repository.insertIfOrdered({
      id,
      roomId,
      senderId,
      senderDisplayName: "テスト太郎",
      body: "[UNIT_TEST]本文",
    }),
  );
}

describe("#201 AC-1 条件付き INSERT：投稿できる状態", () => {
  it("#201 AC-1: 参加者が公開チャンネルに書くと、1行入る", async () => {
    expect(await tryInsert(deptA.dedicatedChannelId, member)).toBe(1);
    expect(await messageIds(deptA.dedicatedChannelId)).toEqual([NEW_ID]);
  });

  it("#201 AC-1: 確認の後にチャンネルがアーカイブされた状態では、書かない", async () => {
    await env.DB.prepare(
      "UPDATE channels SET deleted_at = '2026-11-09T00:00:00.000Z' WHERE room_id = ?",
    )
      .bind(deptA.dedicatedChannelId)
      .run();
    expect(await tryInsert(deptA.dedicatedChannelId, member)).toBe(0);
    expect(await messageIds(deptA.dedicatedChannelId)).toEqual([]);
  });

  it("#201 AC-1: 投稿者が参加者でない（退出した後の）状態では、書かない", async () => {
    await env.DB.prepare("DELETE FROM channel_members WHERE channel_id = ?")
      .bind(deptA.dedicatedChannelId)
      .run();
    expect(await tryInsert(deptA.dedicatedChannelId, member)).toBe(0);
    expect(await messageIds(deptA.dedicatedChannelId)).toEqual([]);
  });

  it("#201 AC-1: 参加していない公開チャンネルには書かない", async () => {
    expect(await tryInsert(deptB.dedicatedChannelId, member)).toBe(0);
  });
});

const EXISTING_ID = ulidAt(1_800_000_000_500);

describe("#201 AC-3 条件付き INSERT：部屋の中でIDが必ず増える", () => {
  it.each([
    ["部屋の最大より小さいID", ulidAt(1_700_000_000_000)],
    ["部屋の最大と同じID（重複）", EXISTING_ID],
  ])("#201 AC-3: %s では書かない", async (_label, id) => {
    const existing = EXISTING_ID;
    await insertMessage({
      roomId: deptA.dedicatedChannelId,
      senderId: member,
      id: existing,
    });
    expect(await tryInsert(deptA.dedicatedChannelId, member, id)).toBe(0);
    expect(await messageIds(deptA.dedicatedChannelId)).toEqual([existing]);
  });

  it("#201 AC-3: 部屋の最大より大きいIDなら書く。別の部屋の大きいIDは邪魔にならない", async () => {
    const other = await insertChannel({
      name: "[UNIT_TEST]別の部屋",
      purpose: "normal",
      departmentId: deptA.id,
    });
    await insertMember(other, member);
    await insertMessage({
      roomId: other,
      senderId: member,
      id: ulidAt(1_900_000_000_000),
    });
    await insertMessage({
      roomId: deptA.dedicatedChannelId,
      senderId: member,
      id: ulidAt(1_700_000_000_000),
    });
    expect(await tryInsert(deptA.dedicatedChannelId, member)).toBe(1);
  });
});

describe("#201 AC-5 条件付き INSERT：お知らせ専用の権限", () => {
  let owner: string;
  let ownerOfB: string;
  let admin: string;

  beforeEach(async () => {
    owner = await insertUser("testuser_msgrepo_owner", deptA.id);
    ownerOfB = await insertUser("testuser_msgrepo_ownerb", deptB.id);
    admin = await insertUser("testuser_msgrepo_admin", deptA.id);
    await makeOwner(owner, deptA.id);
    await makeOwner(ownerOfB, deptB.id);
    await makeGlobalAdmin(admin);
    for (const id of [member, owner, ownerOfB, admin])
      await insertMember(deptA.announcementChannelId, id);
  });

  it.each([
    ["自部署のオーナー", 1, () => owner],
    ["全体管理者", 1, () => admin],
    ["一般の参加者", 0, () => member],
    ["他部署のオーナー", 0, () => ownerOfB],
  ])(
    "#201 AC-5: お知らせ専用に、%s が書こうとすると、書けた行数は %i",
    async (_label, expected, sender) => {
      expect(await tryInsert(deptA.announcementChannelId, sender())).toBe(
        expected,
      );
      expect(await messageIds(deptA.announcementChannelId)).toHaveLength(
        expected,
      );
    },
  );

  it("#201 AC-5（U-14）: 全社連絡（部署なし）には、権限のない一般の参加者も書ける", async () => {
    const general = await companyGeneralRoomId();
    expect(general).not.toBeNull();
    await insertMember(general ?? "", member);
    expect(await tryInsert(general ?? "", member)).toBe(1);
  });
});
