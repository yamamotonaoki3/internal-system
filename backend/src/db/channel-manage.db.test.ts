// #143-a a-AC-1〜a-AC-5（2-6 AC-4・AC-5・AC-6、3-4 AC-5）: チャンネルの管理の Repository（channel.repository.ts の findForManage・listNotifyRecipients・
// update・archive・restore と channel-manage.sql.ts）を、マイグレーション済みの D1 で確かめる。
// SQL の条件・前提の確認（#196 の assertStatement）・原子性・宛先・版は DB の層でしか見られない（計画 #143-a「テストケース（a）」の DB の行）。
// 期待値は計画の「最初の判定と、書き込みの条件の突き合わせ」「同時の操作」の表と、1章の権限の表から決める：
//   管理できる人（channelManagerSql）：全体管理者（会社の範囲）か、チャンネルの部署のオーナー。会社直属は全体管理者だけ。操作者が有効であること
//   名前の変更は purpose = normal、説明だけなら purpose <> case。アーカイブ・復元は purpose = normal。版が送られた版と一致
//   アーカイブ・復元は、宛先（有効な参加者で操作者以外）が、渡した集合と同じであること
// 実装が前提とする約束（実装前。報告に明記。名前は計画の「変更するファイル（a）」に合わせた）：
//   repository.findForManage(roomId, actorId): Promise<ChannelManageRow | null>
//     ChannelManageRow = { roomId, name, description, visibility, departmentId, purpose, deletedAt, version,
//       isMember: boolean, openArchiveEventId: string | null（restored_at が NULL の最新のアーカイブの記録の ID） }
//   repository.listNotifyRecipients(roomId, actorId): Promise<string[]>（有効な参加者で操作者以外。ID の昇順）
//   repository.update({ roomId, actorId, version, name?（整形済み）, description?, traceId })
//     : Promise<{ id, name, description, version, updatedAt } | null>（行がなければ null）
//   repository.archive({ roomId, actorId, version, reason: string | null, eventId, recipientIds, traceId })
//     : Promise<{ id, version, deletedAt } | null>
//   repository.restore({ roomId, actorId, version, eventId（開いているアーカイブの記録の ID）, recipientIds, traceId })
//     : Promise<{ id, version, restoredAt } | null>
//   前提の確認が崩れたら ChannelManageConflictError（channel.repository.ts から公開）、名前の一意索引の違反は ChannelNameTakenError。
//   どちらの場合も batch 全体が取り消され、何も残らない。未知の DB エラーはそのまま投げる。
//   監査：channel.update（detail { fields: "name,description" } のように変えた項目の名前だけ）・channel.archive（detail { hasReason }）・channel.restore（detail なし）。
//   通知：channel.archived・channel.restored。room_id = チャンネル、target_id = その回の channel_archive_events.id、message_id は NULL。
// データは架空（testuser_chmandb_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVED_AT,
  TEST_TAG,
  archiveEvents,
  archiveNotifications,
  bumpChannelVersion,
  channelVersion,
  cleanupChannelManageScenario,
  insertManagedChannel,
  manageAudits,
  manageSnapshot,
  manageTraceId,
  managedChannelRow,
  markArchived,
} from "../../test/channel-manage-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser } from "../../test/dm-fixtures";
import { leaveChannel } from "../../test/message-modify-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import {
  ChannelManageConflictError,
  ChannelNameTakenError,
  withChannels,
} from "./channel.repository";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: string;
let ownerA: string;
let ownerB: string;
let member: string;
let member2: string;

const sorted = (ids: string[]) => [...ids].sort();

type UpdateExtra = { name?: string; description?: string; version?: number };

async function update(roomId: string, actorId: string, extra: UpdateExtra) {
  const version = extra.version ?? (await channelVersion(roomId));
  return withChannels(env, (r) =>
    r.update({
      roomId,
      actorId,
      version,
      ...(extra.name === undefined ? {} : { name: extra.name }),
      ...(extra.description === undefined
        ? {}
        : { description: extra.description }),
      traceId: manageTraceId(),
    }),
  );
}

type ArchiveExtra = {
  reason?: string | null;
  version?: number;
  recipientIds: string[];
  eventId?: string;
};

async function archive(roomId: string, actorId: string, extra: ArchiveExtra) {
  const version = extra.version ?? (await channelVersion(roomId));
  return withChannels(env, (r) =>
    r.archive({
      roomId,
      actorId,
      version,
      reason: extra.reason ?? null,
      eventId: extra.eventId ?? testId("ARCV"),
      recipientIds: extra.recipientIds,
      traceId: manageTraceId(),
    }),
  );
}

type RestoreExtra = {
  eventId: string;
  version?: number;
  recipientIds: string[];
};

async function restore(roomId: string, actorId: string, extra: RestoreExtra) {
  const version = extra.version ?? (await channelVersion(roomId));
  return withChannels(env, (r) =>
    r.restore({
      roomId,
      actorId,
      version,
      eventId: extra.eventId,
      recipientIds: extra.recipientIds,
      traceId: manageTraceId(),
    }),
  );
}

/** 部署 A の通常のチャンネル（既定：公開、参加者は ownerA・member・member2） */
const channelA = (label: string, members?: string[]) =>
  insertManagedChannel(`管理DB${label}`, {
    departmentId: deptA.id,
    members: members ?? [ownerA, member, member2],
  });

async function expectConflict(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ChannelManageConflictError);
}

beforeEach(async () => {
  deptA = await insertDepartmentWithChannels("管理DB_A");
  deptB = await insertDepartmentWithChannels("管理DB_B");
  admin = await insertUser("testuser_chmandb_admin", deptA.id);
  ownerA = await insertUser("testuser_chmandb_ownera", deptA.id);
  ownerB = await insertUser("testuser_chmandb_ownerb", deptB.id);
  member = await insertUser("testuser_chmandb_member", deptA.id);
  member2 = await insertUser("testuser_chmandb_member2", deptA.id);
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  await makeOwner(ownerB, deptB.id);
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_archive_notification");
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_archive_event");
  await cleanupChannelManageScenario();
});

describe("#143 a-AC-1・a-AC-4 管理できる人の条件（channelManagerSql。1章の表と全組で一致）", () => {
  // 説明の変更で確かめる（通知のない、いちばん小さい batch）。行の文字列は beforeEach の変数の名前
  it.each([
    ["全体管理者", "admin", "A", true],
    ["全体管理者", "admin", "B", true],
    ["全体管理者", "admin", "会社直属", true],
    ["部署 A のオーナー", "ownerA", "A", true],
    ["部署 A のオーナー", "ownerA", "B", false],
    ["部署 A のオーナー", "ownerA", "会社直属", false],
    ["部署 B のオーナー", "ownerB", "A", false],
    ["部署 B のオーナー", "ownerB", "B", true],
    ["一般の社員（参加者）", "member", "A", false],
    ["一般の社員（参加者）", "member", "会社直属", false],
  ] as const)(
    "#143 a-AC-1・a-AC-4: %s（%s）が、%s のチャンネルの説明を変える → 管理できる: %s",
    async (_label, actorKey, channelKey, expected) => {
      const actors = { admin, ownerA, ownerB, member } as const;
      const actorId = actors[actorKey];
      const departmentId =
        channelKey === "A" ? deptA.id : channelKey === "B" ? deptB.id : null;
      const room = await insertManagedChannel(`管理DB権限${channelKey}`, {
        departmentId,
        members: [member],
      });
      const before = await manageSnapshot(room);
      const result = update(room, actorId, {
        description: `${TEST_TAG}説明`,
      });
      if (expected) {
        expect(await result).toMatchObject({
          id: room,
          description: `${TEST_TAG}説明`,
        });
      } else {
        await expectConflict(result);
        expect(await manageSnapshot(room)).toEqual(before);
      }
    },
  );

  it("#143 a-AC-4（2-6 AC-4）: チャンネルの作成者でも、オーナー・全体管理者でなければ管理できない", async () => {
    const room = await channelA("作成者");
    await env.DB.prepare("UPDATE channels SET created_by = ? WHERE room_id = ?")
      .bind(member, room)
      .run();
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, member, { description: `${TEST_TAG}作成者の説明` }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-1: 無効にされた全体管理者は管理できない（操作者が有効であること）", async () => {
    const room = await channelA("無効な管理者");
    await deactivateUser(admin);
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, admin, { description: `${TEST_TAG}無効の説明` }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-1（D-3）: 部署が無効（読み取り専用）でも、オーナーは管理できる", async () => {
    const room = await channelA("無効な部署");
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(deptA.id)
      .run();
    expect(
      await update(room, ownerA, { description: `${TEST_TAG}無効の部署` }),
    ).toMatchObject({ description: `${TEST_TAG}無効の部署` });
  });

  it("#143 a-AC-4（2-6 AC-5⑥）: 参加していない非公開チャンネルでも、範囲内のオーナーは管理できる", async () => {
    const room = await insertManagedChannel("管理DB非公開未参加", {
      departmentId: deptA.id,
      visibility: "private",
      members: [member],
    });
    expect(
      await update(room, ownerA, { description: `${TEST_TAG}非公開` }),
    ).toMatchObject({ description: `${TEST_TAG}非公開` });
  });
});

describe("#143 a-AC-1 名前・説明の変更（update）", () => {
  it("#143 a-AC-1: 名前と説明を変えると、name・name_normalized・description・version + 1・updated_at が変わり、監査 channel.update が1件。通知は作らない", async () => {
    const room = await channelA("変更前");
    const before = await managedChannelRow(room);
    const name = `${TEST_TAG}管理DB変更後ABC`;
    const result = await update(room, ownerA, {
      name,
      description: `${TEST_TAG}新しい説明`,
    });
    expect(result).toMatchObject({
      id: room,
      name,
      description: `${TEST_TAG}新しい説明`,
      version: (before?.version ?? 0) + 1,
    });
    expect(typeof result?.updatedAt).toBe("string");
    const row = await managedChannelRow(room);
    expect(row).toMatchObject({
      name,
      name_normalized: name.toLowerCase(),
      description: `${TEST_TAG}新しい説明`,
      version: (before?.version ?? 0) + 1,
      updated_at: result?.updatedAt,
      deleted_at: null,
    });
    expect(row?.updated_at).not.toBe(before?.updated_at);
    const audits = await manageAudits(room);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: ownerA,
      action: "channel.update",
      target_type: "channel",
      target_id: room,
      result: "success",
    });
    // detail は変えた項目の名前だけ（値・チャンネル名を入れない）
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      fields: "name,description",
    });
    expect(audits[0]?.detail ?? "").not.toContain("変更後");
    expect(await archiveNotifications(room)).toEqual([]);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE room_id = ?",
    )
      .bind(room)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it("#143 a-AC-1: 説明だけを変えると、名前は変わらず、監査の detail は description だけ", async () => {
    const room = await channelA("説明だけ");
    const before = await managedChannelRow(room);
    await update(room, ownerA, { description: `${TEST_TAG}説明だけ` });
    const row = await managedChannelRow(room);
    expect(row?.name).toBe(before?.name);
    expect(row?.name_normalized).toBe(before?.name_normalized);
    const audits = await manageAudits(room, "channel.update");
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      fields: "description",
    });
  });

  it("#143 a-AC-1（2-2 AC-13）: 大小だけが違う、ほかのチャンネルの名前には変えられない（ChannelNameTakenError）。何も残らない", async () => {
    const taken = `${TEST_TAG}管理DB重複abc`;
    await insertManagedChannel("管理DB重複abc", { departmentId: deptA.id });
    const room = await channelA("重複させる側");
    const before = await manageSnapshot(room);
    const error = await update(room, ownerA, {
      name: taken.toUpperCase(),
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ChannelNameTakenError);
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-1（2-6 AC-6・C-124）: アーカイブ済みのチャンネルの名前とも重複させない（ChannelNameTakenError）", async () => {
    const archived = await insertManagedChannel("管理DBアーカイブ済みの名前", {
      departmentId: deptA.id,
    });
    await markArchived(archived, ownerA);
    const room = await channelA("アーカイブ済みと重複");
    const before = await manageSnapshot(room);
    const error = await update(room, ownerA, {
      name: `${TEST_TAG}管理DBアーカイブ済みの名前`,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ChannelNameTakenError);
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-1（2-6 AC-5②・D-2）: 部署の専用・お知らせ専用の名前は変えられない（前提の確認で取り消し）が、説明は変えられる", async () => {
    for (const room of [
      deptA.dedicatedChannelId,
      deptA.announcementChannelId,
    ]) {
      const before = await manageSnapshot(room);
      await expectConflict(
        update(room, ownerA, { name: `${TEST_TAG}管理DB専用の改名` }),
      );
      await expectConflict(
        update(room, ownerA, {
          name: `${TEST_TAG}管理DB専用の改名2`,
          description: `${TEST_TAG}説明も一緒`,
        }),
      );
      expect(await manageSnapshot(room)).toEqual(before);
      expect(
        await update(room, ownerA, { description: `${TEST_TAG}専用の説明` }),
      ).toMatchObject({ description: `${TEST_TAG}専用の説明` });
    }
  });

  it("#143 a-AC-4（2-6 AC-7・D-2）: 案件専用チャンネルは、全体管理者でも名前・説明を変えられない", async () => {
    const room = await insertManagedChannel("管理DB案件", {
      departmentId: deptA.id,
      purpose: "case",
      visibility: "private",
      members: [admin],
    });
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, admin, { description: `${TEST_TAG}案件の説明` }),
    );
    await expectConflict(
      update(room, admin, { name: `${TEST_TAG}管理DB案件の改名` }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-1（EP-2-36）: アーカイブ済みのチャンネルは変えられない", async () => {
    const room = await channelA("アーカイブ済みの変更");
    await markArchived(room, ownerA);
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, ownerA, { description: `${TEST_TAG}アーカイブ後` }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 版（重大2）: 送られた版が今の版と違えば取り消し、先の変更が残る", async () => {
    const room = await channelA("版の不一致");
    const read = await channelVersion(room);
    await update(room, ownerA, {
      description: `${TEST_TAG}先の変更`,
      version: read,
    });
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, admin, {
        description: `${TEST_TAG}後の変更`,
        version: read,
      }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
    expect((await managedChannelRow(room))?.description).toBe(
      `${TEST_TAG}先の変更`,
    );
  });

  it("#143 a-AC-1: 存在しないチャンネルは null で、監査を残さない", async () => {
    const missing = testId("NOROOM");
    expect(
      await withChannels(env, (r) =>
        r.update({
          roomId: missing,
          actorId: admin,
          version: 1,
          description: `${TEST_TAG}なし`,
          traceId: manageTraceId(),
        }),
      ),
    ).toBeNull();
    expect(await manageAudits(missing)).toEqual([]);
  });
});

describe("#143 a-AC-2・a-AC-5 アーカイブ（archive）", () => {
  it("#143 a-AC-2・a-AC-5: 成功すると deleted_at・deleted_by・version + 1、アーカイブの記録1行、監査 channel.archive（detail は hasReason だけ）、宛先ごとの通知を1つの batch で残す", async () => {
    const room = await channelA("成功");
    const before = await channelVersion(room);
    const eventId = testId("ARCV");
    const recipients = sorted([member, member2]);
    const result = await archive(room, ownerA, {
      reason: `${TEST_TAG}理由`,
      recipientIds: recipients,
      eventId,
    });
    expect(result).toMatchObject({ id: room, version: before + 1 });
    expect(typeof result?.deletedAt).toBe("string");
    expect(await managedChannelRow(room)).toMatchObject({
      version: before + 1,
      deleted_at: result?.deletedAt,
      deleted_by: ownerA,
    });
    const events = await archiveEvents(room);
    expect(events).toEqual([
      {
        id: eventId,
        channel_id: room,
        archived_by: ownerA,
        archived_at: expect.any(String),
        reason: `${TEST_TAG}理由`,
        restored_by: null,
        restored_at: null,
      },
    ]);
    const audits = await manageAudits(room, "channel.archive");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: ownerA,
      target_type: "channel",
      target_id: room,
      result: "success",
    });
    // 理由の文は監査に入れない
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      hasReason: true,
    });
    expect(await archiveNotifications(room)).toEqual(
      recipients.map((userId) => ({
        user_id: userId,
        kind: "channel.archived",
        room_id: room,
        message_id: null,
        target_id: eventId,
      })),
    );
  });

  it("#143 a-AC-2: 理由なしなら、記録の reason は NULL、監査の detail は hasReason: false", async () => {
    const room = await channelA("理由なし");
    await archive(room, ownerA, {
      reason: null,
      recipientIds: sorted([member, member2]),
    });
    expect((await archiveEvents(room))[0]?.reason).toBeNull();
    expect(
      JSON.parse(
        (await manageAudits(room, "channel.archive"))[0]?.detail ?? "null",
      ),
    ).toEqual({ hasReason: false });
  });

  it("#143 a-AC-5（D-5）: 参加者が操作した本人だけなら、通知は0件で成功する", async () => {
    const room = await channelA("本人だけ", [ownerA]);
    expect(await archive(room, ownerA, { recipientIds: [] })).not.toBeNull();
    expect(await archiveNotifications(room)).toEqual([]);
    expect(await manageAudits(room, "channel.archive")).toHaveLength(1);
  });

  it.each([
    ["すでにアーカイブ済み", "archived"],
    ["部署の専用チャンネル", "dedicated"],
    ["お知らせ専用チャンネル", "announcement"],
    ["案件専用チャンネル", "case"],
    ["操作者が無効になった", "actorInactive"],
    ["操作者がオーナーでなくなった", "ownerRemoved"],
    ["版が進んだ", "versionBumped"],
    ["宛先：参加者が増えた", "memberJoined"],
    ["宛先：参加者が抜けた", "memberLeft"],
    ["宛先：参加者が無効になった", "memberDeactivated"],
  ] as const)(
    "#143 a-AC-2（前提の確認）: %s場合は ChannelManageConflictError で、チャンネル・記録・監査・通知のどれも変わらない",
    async (_label, change) => {
      let room = await channelA(`崩れ${change}`);
      const recipients = sorted([member, member2]);
      const version = await channelVersion(room);
      let versionToSend = version;
      if (change === "dedicated") room = deptA.dedicatedChannelId;
      if (change === "announcement") room = deptA.announcementChannelId;
      if (change === "case")
        room = await insertManagedChannel("管理DB崩れ案件", {
          departmentId: deptA.id,
          purpose: "case",
          visibility: "private",
          members: [ownerA, member, member2],
        });
      if (change === "dedicated" || change === "announcement") {
        await insertMember(room, member);
        await insertMember(room, member2);
      }
      if (change !== "versionBumped")
        versionToSend = await channelVersion(room);
      if (change === "archived") {
        await markArchived(room, admin);
        versionToSend = await channelVersion(room);
      }
      if (change === "actorInactive") await deactivateUser(ownerA);
      if (change === "ownerRemoved")
        await env.DB.prepare(
          "DELETE FROM user_role_assignments WHERE user_id = ?",
        )
          .bind(ownerA)
          .run();
      if (change === "versionBumped") await bumpChannelVersion(room);
      if (change === "memberJoined") {
        const late = await insertUser("testuser_chmandb_late", deptA.id);
        await insertMember(room, late);
      }
      if (change === "memberLeft") await leaveChannel(room, member2);
      if (change === "memberDeactivated") await deactivateUser(member2);
      const before = await manageSnapshot(room);
      await expectConflict(
        archive(room, ownerA, {
          recipientIds: recipients,
          version: versionToSend,
        }),
      );
      expect(await manageSnapshot(room)).toEqual(before);
    },
  );

  it("#143 a-AC-2: 存在しないチャンネルは null で、記録・監査・通知を残さない", async () => {
    const missing = testId("NOROOM");
    expect(
      await withChannels(env, (r) =>
        r.archive({
          roomId: missing,
          actorId: admin,
          version: 1,
          reason: null,
          eventId: testId("ARCV"),
          recipientIds: [],
          traceId: manageTraceId(),
        }),
      ),
    ).toBeNull();
    expect(await manageAudits(missing)).toEqual([]);
    expect(await archiveNotifications(missing)).toEqual([]);
  });

  it("#143 a-AC-2（原子性）: 通知の書き込みが失敗すると例外になり、チャンネル・記録・監査のどれも残らない", async () => {
    const room = await channelA("通知の失敗");
    const before = await manageSnapshot(room);
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_archive_notification BEFORE INSERT ON notifications WHEN NEW.kind = 'channel.archived' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END",
    );
    const error = await archive(room, ownerA, {
      recipientIds: sorted([member, member2]),
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-2（原子性）: アーカイブの記録の書き込みが失敗すると例外になり、チャンネル・監査・通知のどれも残らない", async () => {
    const room = await channelA("記録の失敗");
    const before = await manageSnapshot(room);
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_archive_event BEFORE INSERT ON channel_archive_events BEGIN SELECT RAISE(ABORT, 'unit test failure'); END",
    );
    await expect(
      archive(room, ownerA, { recipientIds: sorted([member, member2]) }),
    ).rejects.toThrow();
    expect(await manageSnapshot(room)).toEqual(before);
  });
});

describe("#143 a-AC-3・a-AC-5 復元（restore）", () => {
  it("#143 a-AC-3（C-132）: 別の人がアーカイブしたものを全体管理者が復元すると、deleted_at・deleted_by が NULL、version + 1、記録が閉じ、監査 channel.restore、宛先ごとの通知（target_id は同じ記録）", async () => {
    const room = await channelA("復元の成功", [ownerA, member, member2, admin]);
    const eventId = await markArchived(room, ownerA, `${TEST_TAG}元の理由`);
    const before = await channelVersion(room);
    const recipients = sorted([ownerA, member, member2]);
    const result = await restore(room, admin, {
      eventId,
      recipientIds: recipients,
    });
    expect(result).toMatchObject({ id: room, version: before + 1 });
    expect(typeof result?.restoredAt).toBe("string");
    expect(await managedChannelRow(room)).toMatchObject({
      version: before + 1,
      deleted_at: null,
      deleted_by: null,
    });
    // 記録は消さずに閉じる（その回の理由は、古い通知のために残す）
    expect(await archiveEvents(room)).toEqual([
      {
        id: eventId,
        channel_id: room,
        archived_by: ownerA,
        archived_at: ARCHIVED_AT,
        reason: `${TEST_TAG}元の理由`,
        restored_by: admin,
        restored_at: result?.restoredAt,
      },
    ]);
    const audits = await manageAudits(room, "channel.restore");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: admin,
      target_type: "channel",
      target_id: room,
      result: "success",
    });
    expect(await archiveNotifications(room, "channel.restored")).toEqual(
      recipients.map((userId) => ({
        user_id: userId,
        kind: "channel.restored",
        room_id: room,
        message_id: null,
        target_id: eventId,
      })),
    );
  });

  it.each([
    ["アーカイブされていない", "notArchived"],
    ["記録の ID が開いている行でない（別の ID）", "wrongEvent"],
    ["版が進んだ", "versionBumped"],
    ["操作者が範囲外のオーナー", "otherOwner"],
    ["宛先：参加者が増えた", "memberJoined"],
  ] as const)(
    "#143 a-AC-3（前提の確認）: %s場合は ChannelManageConflictError で、何も変わらない",
    async (_label, change) => {
      const room = await channelA(`復元の崩れ${change}`);
      const recipients = sorted([member, member2]);
      let eventId = testId("ARCV");
      if (change !== "notArchived") eventId = await markArchived(room, ownerA);
      const version = await channelVersion(room);
      if (change === "wrongEvent") eventId = testId("ARCV");
      if (change === "versionBumped") await bumpChannelVersion(room);
      if (change === "memberJoined") {
        const late = await insertUser("testuser_chmandb_late2", deptA.id);
        await insertMember(room, late);
      }
      const actor = change === "otherOwner" ? ownerB : ownerA;
      const before = await manageSnapshot(room);
      await expectConflict(
        restore(room, actor, { eventId, recipientIds: recipients, version }),
      );
      expect(await manageSnapshot(room)).toEqual(before);
    },
  );
});

describe("#143 同時の操作（計画の「同時の操作」の表）", () => {
  it("#143 同時の操作: 同じ版からのアーカイブ2つは、後のほうが取り消され、記録・監査・通知は1回分だけ", async () => {
    const room = await channelA("二重のアーカイブ");
    const version = await channelVersion(room);
    const recipients = sorted([member, member2]);
    expect(
      await archive(room, ownerA, { recipientIds: recipients, version }),
    ).not.toBeNull();
    await expectConflict(
      archive(room, admin, { recipientIds: recipients, version }),
    );
    expect(await archiveEvents(room)).toHaveLength(1);
    expect(await manageAudits(room, "channel.archive")).toHaveLength(1);
    expect(await archiveNotifications(room, "channel.archived")).toHaveLength(
      2,
    );
  });

  it("#143 版（重大2）: アーカイブ → 復元で状態が戻っても、最初に読んだ古い版の名前の変更は取り消される", async () => {
    const room = await channelA("戻った状態");
    const old = await channelVersion(room);
    const recipients = sorted([member, member2]);
    await archive(room, ownerA, { recipientIds: recipients });
    const [event] = await archiveEvents(room);
    await restore(room, ownerA, {
      eventId: event?.id ?? "",
      recipientIds: recipients,
    });
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, admin, { description: `${TEST_TAG}古い版`, version: old }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 同時の操作: アーカイブの後の説明の変更は取り消される（deleted_at IS NULL の条件）", async () => {
    const room = await channelA("アーカイブと変更");
    const version = await channelVersion(room);
    await archive(room, ownerA, {
      recipientIds: sorted([member, member2]),
      version,
    });
    const before = await manageSnapshot(room);
    await expectConflict(
      update(room, admin, {
        description: `${TEST_TAG}後から`,
        version: version + 1,
      }),
    );
    expect(await manageSnapshot(room)).toEqual(before);
  });

  it("#143 a-AC-5（重大1）: 再アーカイブで別の理由にすると、記録は2行になり、古い通知は古い記録を指したまま", async () => {
    const room = await channelA("再アーカイブ");
    const recipients = sorted([member, member2]);
    const first = testId("ARCV");
    await archive(room, ownerA, {
      reason: `${TEST_TAG}1回目`,
      recipientIds: recipients,
      eventId: first,
    });
    await restore(room, ownerA, { eventId: first, recipientIds: recipients });
    const second = testId("ARCV");
    await archive(room, ownerA, {
      reason: `${TEST_TAG}2回目`,
      recipientIds: recipients,
      eventId: second,
    });
    const events = await archiveEvents(room);
    expect(events.map((e) => [e.id, e.reason])).toEqual([
      [first, `${TEST_TAG}1回目`],
      [second, `${TEST_TAG}2回目`],
    ]);
    const archived = await archiveNotifications(room, "channel.archived");
    expect(archived).toHaveLength(4);
    expect(
      archived.filter((row) => row.target_id === first).map((r) => r.user_id),
    ).toEqual(recipients);
    expect(
      archived.filter((row) => row.target_id === second).map((r) => r.user_id),
    ).toEqual(recipients);
  });
});

describe("#143 a-AC-1〜a-AC-5 読み込み（findForManage・listNotifyRecipients）", () => {
  it("#143 a-AC-4（2-6 AC-5⑥）: 参加していない非公開も行を返し、中身（メッセージ）は持たない。isMember は偽", async () => {
    const room = await insertManagedChannel("管理DB読み込み", {
      departmentId: deptA.id,
      visibility: "private",
      members: [member],
    });
    const row = await withChannels(env, (r) => r.findForManage(room, ownerA));
    expect(row).toMatchObject({
      roomId: room,
      name: `${TEST_TAG}管理DB読み込み`,
      visibility: "private",
      departmentId: deptA.id,
      purpose: "normal",
      deletedAt: null,
      version: await channelVersion(room),
      isMember: false,
      openArchiveEventId: null,
    });
    expect(
      (await withChannels(env, (r) => r.findForManage(room, member)))?.isMember,
    ).toBe(true);
  });

  it("#143 a-AC-3: アーカイブ済みなら deletedAt と、開いている記録の ID を返す", async () => {
    const room = await channelA("読み込みアーカイブ");
    const eventId = await markArchived(room, ownerA);
    expect(
      await withChannels(env, (r) => r.findForManage(room, admin)),
    ).toMatchObject({ deletedAt: ARCHIVED_AT, openArchiveEventId: eventId });
  });

  it("#143 a-AC-1: 存在しないチャンネルは null", async () => {
    expect(
      await withChannels(env, (r) => r.findForManage(testId("NOROOM"), admin)),
    ).toBeNull();
  });

  it("#143 a-AC-5（D-5）: 宛先は、有効な参加者で操作した本人以外。無効な社員・参加していない社員を除き、ID の昇順", async () => {
    const inactive = await insertUser("testuser_chmandb_inactive", deptA.id);
    const outsider = await insertUser("testuser_chmandb_outsider", deptA.id);
    const room = await channelA("宛先", [member2, ownerA, inactive, member]);
    await deactivateUser(inactive);
    const recipients = await withChannels(env, (r) =>
      r.listNotifyRecipients(room, ownerA),
    );
    expect(recipients).toEqual(sorted([member, member2]));
    expect(recipients).not.toContain(outsider);
  });
});

describe("#143 重大2（コードレビュー1回目）宛先が多いチャンネル（D1 の1文 100 パラメータの上限）", () => {
  const MANY = 120;

  /** 有効な参加者 MANY 人（操作者 ownerA を除く）を持つチャンネルと、その宛先（ID の昇順） */
  async function crowdedChannel(label: string) {
    const ids: string[] = [];
    for (let i = 0; i < MANY; i += 1)
      ids.push(
        await insertUser(
          `testuser_chmandb_many${String(i).padStart(3, "0")}`,
          deptA.id,
        ),
      );
    const room = await channelA(label, [ownerA, ...ids]);
    return { room, recipients: sorted(ids) };
  }

  it("#143 重大2: 宛先が 120 人でも、アーカイブと復元が成功し、通知が宛先の人数分できる", async () => {
    const { room, recipients } = await crowdedChannel("多数");
    expect(recipients.length).toBeGreaterThan(100);
    expect(
      await withChannels(env, (r) => r.listNotifyRecipients(room, ownerA)),
    ).toEqual(recipients);
    const eventId = testId("ARCV");
    expect(
      await archive(room, ownerA, { recipientIds: recipients, eventId }),
    ).not.toBeNull();
    expect(await archiveNotifications(room, "channel.archived")).toHaveLength(
      MANY,
    );
    expect(
      await restore(room, ownerA, { eventId, recipientIds: recipients }),
    ).not.toBeNull();
    expect(await archiveNotifications(room, "channel.restored")).toHaveLength(
      MANY,
    );
  });

  it("#143 重大2: 宛先が 120 人でも、読んだ後に1人が無効になれば前提の確認で取り消し、何も変わらない", async () => {
    const { room, recipients } = await crowdedChannel("多数の崩れ");
    await deactivateUser(recipients[MANY - 1] ?? "");
    const before = await manageSnapshot(room);
    await expectConflict(archive(room, ownerA, { recipientIds: recipients }));
    expect(await manageSnapshot(room)).toEqual(before);
  });
});

describe("#143 ミューテーションの生き残り（未指定の項目・宛先0人・エラーの変換）", () => {
  afterEach(async () => {
    await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_channel_update");
  });

  it("#143 a-AC-1: 名前だけを変えると、説明は変わらず、監査の detail は name だけ", async () => {
    const room = await channelA("名前だけ");
    await env.DB.prepare(
      "UPDATE channels SET description = ? WHERE room_id = ?",
    )
      .bind(`${TEST_TAG}元の説明`, room)
      .run();
    await update(room, ownerA, { name: `${TEST_TAG}管理DB名前だけ後` });
    expect(await managedChannelRow(room)).toMatchObject({
      name: `${TEST_TAG}管理DB名前だけ後`,
      description: `${TEST_TAG}元の説明`,
    });
    expect(
      JSON.parse(
        (await manageAudits(room, "channel.update"))[0]?.detail ?? "null",
      ),
    ).toEqual({ fields: "name" });
  });

  it("#143 a-AC-5（D-5）: 参加者が操作した本人だけなら、復元も通知0件で成功する", async () => {
    const room = await channelA("復元の本人だけ", [ownerA]);
    const eventId = await markArchived(room, ownerA);
    expect(
      await restore(room, ownerA, { eventId, recipientIds: [] }),
    ).not.toBeNull();
    expect(await archiveNotifications(room)).toEqual([]);
    expect((await managedChannelRow(room))?.deleted_at).toBeNull();
  });

  it("#143 a-AC-3: 存在しないチャンネルの復元は null で、記録・監査・通知を残さない", async () => {
    const missing = testId("NOROOM");
    expect(
      await withChannels(env, (r) =>
        r.restore({
          roomId: missing,
          actorId: admin,
          version: 1,
          eventId: testId("ARCV"),
          recipientIds: [],
          traceId: manageTraceId(),
        }),
      ),
    ).toBeNull();
    expect(await manageAudits(missing)).toEqual([]);
    expect(await archiveNotifications(missing)).toEqual([]);
  });

  it.each(["update", "archive", "restore"] as const)(
    "#143 error-api: %s で、一意索引・前提の確認以外の DB のエラーは変換せずにそのまま伝わり、何も残らない",
    async (operation) => {
      const room = await channelA(`未知のエラー${operation}`);
      const eventId =
        operation === "restore" ? await markArchived(room, ownerA) : "";
      const before = await manageSnapshot(room);
      await env.DB.exec(
        "CREATE TRIGGER unit_fail_channel_update BEFORE UPDATE OF deleted_at, description ON channels BEGIN SELECT RAISE(ABORT, 'unit test failure'); END",
      );
      const recipients = sorted([member, member2]);
      const run =
        operation === "update"
          ? update(room, ownerA, { description: `${TEST_TAG}未知` })
          : operation === "archive"
            ? archive(room, ownerA, { recipientIds: recipients })
            : restore(room, ownerA, { eventId, recipientIds: recipients });
      const error = await run.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ChannelManageConflictError);
      expect(error).not.toBeInstanceOf(ChannelNameTakenError);
      expect(String((error as Error).message)).toContain("unit test failure");
      await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_channel_update");
      expect(await manageSnapshot(room)).toEqual(before);
    },
  );
});
