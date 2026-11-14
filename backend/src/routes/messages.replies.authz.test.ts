// #137 AC-1・AC-2（1-4 AC-1・AC-2・C-59・C-94・U-6）: 返信の投稿（EP-1-08）・取得（EP-1-07）の認可と状態による拒否を、実際のアプリ入口と隔離 D1 で確かめる。
// 判定の順（計画 決めたこと4。この順を変えない）：
//   ① 親が存在して見えるか（404。存在しない・非公開で未参加・他人の DM・アーカイブ済みを区別しない。全体管理者も同じ）
//   → ② 親が返信でないか（404）→ ③ チャンネルで参加しているか（403）→ ④ perm.message.reply（403・監査。services/message.reply-service.test.ts）
//   → ⑤ 親が削除済みか（409 CONFLICT。C-59）→ ⑥ 部屋の状態（DM の相手が無効 409・部署が無効 409）→ ⑦ 条件付きの INSERT。
// 取得（GET）は ①②までで 200：未参加の公開チャンネルは 200 で replyBlockedReason: "not_joined"（投稿は 403）。
//   replyBlockedReason の値は shared/message-rules.ts の理由：deleted_parent（削除済みの親）・not_joined・read_only（部署が無効）・partner_inactive（DM の相手が無効）。できるなら null。
// データは架空（testuser_replyauth_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  insertChannel,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
} from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import {
  archiveChannel,
  deactivateDepartment,
  insertModifyUser,
  markDeleted,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { testId } from "../../test/role-fixtures";
import {
  BAD_ORIGIN,
  TEST_TAG,
  ZERO,
  cleanupThreadScenario,
  codeOf,
  createThreadWorld,
  getReplies,
  idAt,
  postReply,
  repliesOk,
  replyRows,
  roomRowCount,
  seedParent,
  seedReply,
  type ThreadWorld,
} from "../../test/thread-fixtures";

let world: ThreadWorld;
const BODY = { body: `${TEST_TAG}返信` };

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  world = await createThreadWorld("replyauth");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupThreadScenario();
});

/** 部屋・親の作り方ごとの「見えない」場合。alice が親の投稿者、bob は見えない側 */
async function hiddenParents() {
  const privateRoom = await insertChannel({
    name: `${TEST_TAG}非公開`,
    purpose: "normal",
    departmentId: world.dept.id,
    visibility: "private",
  });
  await insertMember(privateRoom, world.alice.userId);
  const archivedRoom = await insertChannel({
    name: `${TEST_TAG}アーカイブ`,
    purpose: "normal",
    departmentId: world.dept.id,
  });
  await insertMember(archivedRoom, world.alice.userId);
  await insertMember(archivedRoom, world.bob.userId);
  const othersDm = await insertDm(world.alice.userId, world.dave.userId);
  const cases: Record<string, string> = {};
  let n = 1;
  for (const [label, room] of [
    ["非公開で未参加", privateRoom],
    ["アーカイブ済み", archivedRoom],
    ["他人の DM", othersDm],
  ] as const) {
    cases[label] = await seedParent(room, world.alice.userId, n);
    n += 1;
  }
  await archiveChannel(archivedRoom);
  return cases;
}

describe("#137 AC-1（1-4 AC-1・C-94）見えない親は存在を区別しない 404", () => {
  it("#137 AC-1: 非公開で未参加・アーカイブ済み（参加中でも）・他人の DM は、GET・POST とも 404 NOT_FOUND で、存在しない ID と同じ応答。行は増えない", async () => {
    const cases = await hiddenParents();
    const missing = idAt(900);
    const missingPost = await postReply(missing, BODY, world.bob.token);
    const missingGet = await getReplies(missing, "", world.bob.token);
    for (const [label, parentId] of Object.entries(cases)) {
      const post = await postReply(parentId, BODY, world.bob.token);
      expect(post.status, `POST ${label}`).toBe(404);
      expect(await post.json()).toEqual(await missingPost.clone().json());
      const get = await getReplies(parentId, "", world.bob.token);
      expect(get.status, `GET ${label}`).toBe(404);
      expect(await get.json()).toEqual(await missingGet.clone().json());
      expect(await replyRows(parentId), label).toEqual([]);
    }
  });

  it("#137 AC-1: 全体管理者でも、非公開で未参加・他人の DM の親は 404（存在を区別しない）", async () => {
    const admin = await insertModifyUser(
      "testuser_replyauth_admin",
      world.dept.id,
    );
    await makeGlobalAdmin(admin.userId);
    const cases = await hiddenParents();
    for (const label of ["非公開で未参加", "他人の DM"]) {
      const parentId = cases[label] ?? "";
      expect((await postReply(parentId, BODY, admin.token)).status, label).toBe(
        404,
      );
      expect((await getReplies(parentId, "", admin.token)).status, label).toBe(
        404,
      );
    }
  });

  it("#137 AC-1（判定の順 ①→③）: 非公開で未参加なら、親が削除済みでも 409 ではなく 404", async () => {
    const cases = await hiddenParents();
    const parentId = cases["非公開で未参加"] ?? "";
    await markDeleted(parentId, world.alice.userId);
    expect((await postReply(parentId, BODY, world.bob.token)).status).toBe(404);
  });
});

describe("#137 AC-1（1-4 AC-1・C-94）未参加の公開チャンネル", () => {
  it("#137 AC-1: 未参加の公開チャンネルの親は、GET は 200（replyBlockedReason: not_joined。返信も読める）、POST は 403 FORBIDDEN で行は増えない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const reply = await seedReply(world.channel, parentId, world.bob.userId, 2);
    const get = await repliesOk(parentId, "", world.carol.token);
    expect(get.replyBlockedReason).toBe("not_joined");
    expect(get.items.map((item) => item.id)).toEqual([reply]);
    const post = await postReply(parentId, BODY, world.carol.token);
    expect(post.status).toBe(403);
    expect(await codeOf(post)).toBe("FORBIDDEN");
    expect(await replyRows(parentId)).toHaveLength(1);
  });

  it("#137 AC-1（判定の順 ③→⑤）: 未参加の公開チャンネルの親が削除済みなら、POST は 409 ではなく 403", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    expect((await postReply(parentId, BODY, world.carol.token)).status).toBe(
      403,
    );
  });

  it("#137 AC-1（判定の順 ②→③）: 未参加の公開チャンネルの返信への返信は、403 ではなく 404", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const reply = await seedReply(world.channel, parentId, world.bob.userId, 2);
    expect((await postReply(reply, BODY, world.carol.token)).status).toBe(404);
  });

  it("#137 AC-1: 参加した後は、返信できる（201）", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await insertMember(world.channel, world.carol.userId);
    expect((await postReply(parentId, BODY, world.carol.token)).status).toBe(
      201,
    );
  });
});

describe("#137 AC-1（U-6）お知らせ専用チャンネル", () => {
  it("#137 AC-1（U-6）: お知らせ専用の投稿権限のない参加者でも、返信できる（201）。GET の replyBlockedReason は null", async () => {
    await insertMember(world.dept.announcementChannelId, world.alice.userId);
    await insertMember(world.dept.announcementChannelId, world.bob.userId);
    const owner = await insertModifyUser(
      "testuser_replyauth_owner",
      world.dept.id,
    );
    await makeOwner(owner.userId, world.dept.id);
    await insertMember(world.dept.announcementChannelId, owner.userId);
    const parentId = await seedParent(
      world.dept.announcementChannelId,
      owner.userId,
      1,
    );
    const post = await postReply(parentId, BODY, world.bob.token);
    expect(post.status).toBe(201);
    expect(
      (await repliesOk(parentId, "", world.bob.token)).replyBlockedReason,
    ).toBeNull();
    // 親の投稿者（権限のあるオーナー）以外の参加者（alice）も同じ
    expect((await postReply(parentId, BODY, world.alice.token)).status).toBe(
      201,
    );
  });

  it("#137 AC-1（U-6）: お知らせ専用でも、未参加の参加者でない人は 403（公開）", async () => {
    const parentId = await seedParent(
      world.dept.announcementChannelId,
      world.alice.userId,
      1,
    );
    expect((await postReply(parentId, BODY, world.bob.token)).status).toBe(403);
  });
});

describe("#137 AC-2（1-4 AC-2・C-59）削除された親", () => {
  it("#137 AC-2: 親が削除されても、GET は 200 で parent は deleted: true・body: null、既存の返信は見え、replyBlockedReason は deleted_parent", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const reply = await seedReply(world.channel, parentId, world.bob.userId, 2);
    await markDeleted(parentId, world.alice.userId);
    for (const query of ["", `?after=${ZERO}`]) {
      const page = await repliesOk(parentId, query, world.bob.token);
      expect(page.parent).toMatchObject({
        id: parentId,
        deleted: true,
        body: null,
        replyCount: 1,
      });
      expect(JSON.stringify(page.parent)).not.toContain(`${TEST_TAG}親1`);
      expect(page.replyBlockedReason).toBe("deleted_parent");
      expect(page.items.map((item) => item.id)).toEqual([reply]);
    }
  });

  it("#137 AC-2: 親が削除済みなら、POST は 409 CONFLICT で、行は増えない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    const before = await roomRowCount(world.channel);
    const post = await postReply(parentId, BODY, world.bob.token);
    expect(post.status).toBe(409);
    expect(await codeOf(post)).toBe("CONFLICT");
    expect(await roomRowCount(world.channel)).toBe(before);
  });

  it("#137 AC-2: 親の投稿者本人でも、削除した親への返信は 409", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    expect((await postReply(parentId, BODY, world.alice.token)).status).toBe(
      409,
    );
  });
});

describe("#137 AC-1（C-138(4)・C-171 U-9）部屋の状態", () => {
  it("#137 AC-1: DM の相手が無効なら、GET は 200（partner_inactive・既存の返信は読める）、POST は 409 CONFLICT で、行は増えない", async () => {
    const roomId = await insertDm(world.alice.userId, world.bob.userId);
    const parentId = await seedParent(roomId, world.alice.userId, 1);
    const reply = await seedReply(roomId, parentId, world.bob.userId, 2);
    await deactivateUser(world.bob.userId);
    const page = await repliesOk(parentId, "", world.alice.token);
    expect(page.replyBlockedReason).toBe("partner_inactive");
    expect(page.items.map((item) => item.id)).toEqual([reply]);
    const post = await postReply(parentId, BODY, world.alice.token);
    expect(post.status).toBe(409);
    expect(await codeOf(post)).toBe("CONFLICT");
    expect(await replyRows(parentId)).toHaveLength(1);
  });

  it("#137 AC-1: DM の当事者は返信できる（201）。当事者でない利用者は 404", async () => {
    const roomId = await insertDm(world.alice.userId, world.bob.userId);
    const parentId = await seedParent(roomId, world.alice.userId, 1);
    expect((await postReply(parentId, BODY, world.bob.token)).status).toBe(201);
    expect((await postReply(parentId, BODY, world.dave.token)).status).toBe(
      404,
    );
    expect(
      (await repliesOk(parentId, "", world.bob.token)).replyBlockedReason,
    ).toBeNull();
  });

  it("#137 AC-1: 部署が無効のチャンネルでは、GET は 200（read_only）、POST は 409 CONFLICT で、行は増えない", async () => {
    const parentId = await seedParent(
      world.dept.dedicatedChannelId,
      world.alice.userId,
      1,
    );
    await insertMember(world.dept.dedicatedChannelId, world.alice.userId);
    await insertMember(world.dept.dedicatedChannelId, world.bob.userId);
    await deactivateDepartment(world.dept.id);
    const page = await repliesOk(parentId, "", world.bob.token);
    expect(page.replyBlockedReason).toBe("read_only");
    const post = await postReply(parentId, BODY, world.bob.token);
    expect(post.status).toBe(409);
    expect(await codeOf(post)).toBe("CONFLICT");
    expect(await replyRows(parentId)).toEqual([]);
  });
});

describe("#137 AC-1 認証・送信元（CSRF）", () => {
  it("#137 AC-1: 未認証は GET・POST とも 401 UNAUTHENTICATED", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const post = await postReply(parentId, BODY, null);
    expect(post.status).toBe(401);
    expect(await codeOf(post)).toBe("UNAUTHENTICATED");
    expect((await getReplies(parentId, "", null)).status).toBe(401);
    expect(await replyRows(parentId)).toEqual([]);
  });

  it.each([
    ["許可外の Origin", BAD_ORIGIN],
    ["Origin なし", ""],
  ])(
    "#137 AC-1: POST は %s なら 403 FORBIDDEN_ORIGIN で、行は増えない",
    async (_label, origin) => {
      const parentId = await seedParent(world.channel, world.alice.userId, 1);
      const response = await postReply(parentId, BODY, world.bob.token, origin);
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN_ORIGIN");
      expect(await replyRows(parentId)).toEqual([]);
    },
  );

  it("#137 AC-1: 無効にされた利用者（セッションが残っていても）は返信できない", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    const retired: ModifyUser = await insertModifyUser(
      "testuser_replyauth_retired",
      world.dept.id,
    );
    await insertMember(world.channel, retired.userId);
    await deactivateUser(retired.userId);
    const response = await postReply(parentId, BODY, retired.token);
    expect([401, 403]).toContain(response.status);
    expect(await replyRows(parentId)).toEqual([]);
  });

  it("#137 AC-1: 存在しない部屋・ID の形が不正でも 500 にならない（404 か 422）", async () => {
    const response = await postReply(testId("NOPARENT"), BODY, world.bob.token);
    expect([404, 422]).toContain(response.status);
  });
});

describe("#137 AC-1（1-4 AC-1・コードレビュー）EP-1-07 の応答の joined", () => {
  // 契約：応答に joined: boolean を足す（チャンネルは今参加しているか、DM は当事者なら true）。after あり・なしの両方。replyBlockedReason の優先順は変えない
  const QUERIES = ["", `?after=${ZERO}`];

  it("#137 AC-1: 参加中のチャンネルでは joined: true。応答のキーは parent・replyBlockedReason・joined・roomWritable・items と、最新は nextCursor／after は hasMore", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await seedReply(world.channel, parentId, world.bob.userId, 2);
    for (const query of QUERIES) {
      const page = await repliesOk(parentId, query, world.bob.token);
      expect(page.joined, query).toBe(true);
      expect(Object.keys(page).sort(), query).toEqual(
        query === ""
          ? [
              "items",
              "joined",
              "nextCursor",
              "parent",
              "replyBlockedReason",
              "roomWritable",
            ]
          : [
              "hasMore",
              "items",
              "joined",
              "parent",
              "replyBlockedReason",
              "roomWritable",
            ],
      );
    }
  });

  it("#137 AC-1: 未参加の公開チャンネルでは joined: false（replyBlockedReason は not_joined）", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    for (const query of QUERIES) {
      const page = await repliesOk(parentId, query, world.carol.token);
      expect(page.joined, query).toBe(false);
      expect(page.replyBlockedReason, query).toBe("not_joined");
    }
  });

  it("#137 AC-1: 未参加の公開チャンネル×削除済みの親では、replyBlockedReason は deleted_parent（優先順は変えない）で、joined は false。参加中は true", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    for (const query of QUERIES) {
      const outsider = await repliesOk(parentId, query, world.carol.token);
      expect(outsider.replyBlockedReason, query).toBe("deleted_parent");
      expect(outsider.joined, query).toBe(false);
      const member = await repliesOk(parentId, query, world.bob.token);
      expect(member.replyBlockedReason, query).toBe("deleted_parent");
      expect(member.joined, query).toBe(true);
    }
  });

  it("#137 AC-1: DM の当事者は joined: true（相手が無効で返信できない場合も true）", async () => {
    const roomId = await insertDm(world.alice.userId, world.bob.userId);
    const parentId = await seedParent(roomId, world.alice.userId, 1);
    for (const query of QUERIES)
      expect((await repliesOk(parentId, query, world.bob.token)).joined).toBe(
        true,
      );
    await deactivateUser(world.alice.userId);
    for (const query of QUERIES) {
      const page = await repliesOk(parentId, query, world.bob.token);
      expect(page.replyBlockedReason, query).toBe("partner_inactive");
      expect(page.joined, query).toBe(true);
    }
  });
});

describe("#137 AC-1（1-4 AC-1・コードレビュー2回目）EP-1-07 の応答の roomWritable", () => {
  // 契約：roomWritable: boolean＝部屋に今書き込めるか（チャンネルは参加中・未アーカイブ・部署が有効（会社直属は可）、DM は当事者で相手が有効）。
  // replyBlockedReason の優先順で read_only・partner_inactive・not_joined が deleted_parent に隠れても、正しい値になる。after あり・なしの両方。
  const QUERIES = ["", `?after=${ZERO}`];

  it("#137 AC-1: 参加中×親が削除済み×部署が無効では、replyBlockedReason は deleted_parent・joined は true・roomWritable は false", async () => {
    const parentId = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    await deactivateDepartment(world.dept.id);
    for (const query of QUERIES) {
      const page = await repliesOk(parentId, query, world.bob.token);
      expect(page.replyBlockedReason, query).toBe("deleted_parent");
      expect(page.joined, query).toBe(true);
      expect(page.roomWritable, query).toBe(false);
    }
  });

  it("#137 AC-1: DM×親が削除済み×相手が無効では、deleted_parent・joined は true・roomWritable は false", async () => {
    const roomId = await insertDm(world.alice.userId, world.bob.userId);
    const parentId = await seedParent(roomId, world.alice.userId, 1);
    await markDeleted(parentId, world.alice.userId);
    await deactivateUser(world.alice.userId);
    for (const query of QUERIES) {
      const page = await repliesOk(parentId, query, world.bob.token);
      expect(page.replyBlockedReason, query).toBe("deleted_parent");
      expect(page.joined, query).toBe(true);
      expect(page.roomWritable, query).toBe(false);
    }
  });

  it("#137 AC-1: 参加中×親が削除済み（部署は有効）では、deleted_parent でも roomWritable は true。通常の参加中も true", async () => {
    const deleted = await seedParent(world.channel, world.alice.userId, 1);
    await markDeleted(deleted, world.alice.userId);
    const live = await seedParent(world.channel, world.alice.userId, 2);
    for (const query of QUERIES) {
      const page = await repliesOk(deleted, query, world.bob.token);
      expect(page.replyBlockedReason, query).toBe("deleted_parent");
      expect(page.roomWritable, query).toBe(true);
      expect(
        (await repliesOk(live, query, world.bob.token)).roomWritable,
        query,
      ).toBe(true);
    }
  });

  it("#137 AC-1: 未参加の公開チャンネルでは roomWritable は false（親が削除済みでも false）。DM の相手が無効な通常の親も false", async () => {
    const live = await seedParent(world.channel, world.alice.userId, 1);
    const deleted = await seedParent(world.channel, world.alice.userId, 2);
    await markDeleted(deleted, world.alice.userId);
    for (const query of QUERIES)
      for (const id of [live, deleted])
        expect(
          (await repliesOk(id, query, world.carol.token)).roomWritable,
          `${id} ${query}`,
        ).toBe(false);
    const roomId = await insertDm(world.alice.userId, world.bob.userId);
    const dmParent = await seedParent(roomId, world.alice.userId, 3);
    await deactivateUser(world.alice.userId);
    for (const query of QUERIES)
      expect(
        (await repliesOk(dmParent, query, world.bob.token)).roomWritable,
      ).toBe(false);
  });
});
