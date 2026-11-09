// #196 AC-1・AC-2・AC-3・AC-5: 部署の Repository（作成・改名・オーナー交代・候補）を、実際のマイグレーション済み D1 で確かめる。
// 1操作＝1 db.batch で、部署・チャンネル2つ・ロール・所属・参加・監査が一体で確定し、途中で崩れたら全体が取り消されること。
// Repository は Service の事前確認を通らない入力（無効な後任など）も受け取るため、batch の中の前提確認（S-3）だけで守れることも確かめる。
// 契約（実装前の前提）：backend/src/db/department.repository.ts の withDepartments(env, run)、DuplicateDepartmentError（reason）、DepartmentConflictError。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupAuthTestData } from "../../test/auth-fixtures";
import {
  TEST_TAG,
  autoChannelsOf,
  cleanupDepartmentTestData,
  departmentAudits,
  departmentInvariantViolations,
  departmentOf,
  departmentRow,
  departmentSnapshot,
  deptTraceId,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  joinDepartmentChannels,
  makeGlobalAdmin,
  makeOwner,
  membersOf,
  ownersOf,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { insertUser } from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import {
  DepartmentConflictError,
  DuplicateDepartmentError,
  withDepartments,
} from "./department.repository";

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let deptC: SeededDepartment;
let admin: string;
let memberA1: string;
let ownerB: string;
let memberB1: string;
let memberB2: string;
let inactiveB: string;
let ownerC: string;
let memberC1: string;
let chatB: string;

const write = () => ({ actorId: admin, traceId: deptTraceId() });

function create(
  input: Partial<{
    name: string;
    description: string;
    ownerUserId: string;
    previousDepartmentSuccessorUserId: string | null;
    previousDepartmentVersion: number | null;
  }> = {},
) {
  return withDepartments(env, (repository) =>
    repository.create(
      {
        name: `${TEST_TAG}新部署`,
        description: "",
        ownerUserId: admin,
        previousDepartmentSuccessorUserId: null,
        previousDepartmentVersion: null,
        ...input,
      },
      write(),
    ),
  );
}

function rename(id: string, version: number, name: string) {
  return withDepartments(env, (repository) =>
    repository.rename({ id, version, name }, write()),
  );
}

function changeOwner(input: {
  departmentId: string;
  version: number;
  ownerUserId: string;
  previousDepartmentSuccessorUserId?: string | null;
  previousDepartmentVersion?: number | null;
}) {
  return withDepartments(env, (repository) =>
    repository.changeOwner(
      {
        previousDepartmentSuccessorUserId: null,
        previousDepartmentVersion: null,
        ...input,
      },
      write(),
    ),
  );
}

beforeEach(async () => {
  deptA = await insertDepartmentWithChannels("既存A");
  deptB = await insertDepartmentWithChannels("既存B");
  deptC = await insertDepartmentWithChannels("既存C");
  admin = await insertUser("testuser_dept_admin", deptA.id);
  memberA1 = await insertUser("testuser_dept_a1", deptA.id);
  ownerB = await insertUser("testuser_dept_owner_b", deptB.id);
  memberB1 = await insertUser("testuser_dept_b1", deptB.id);
  memberB2 = await insertUser("testuser_dept_b2", deptB.id);
  inactiveB = await insertUser("testuser_dept_b_inactive", deptB.id, {
    isActive: false,
  });
  ownerC = await insertUser("testuser_dept_owner_c", deptC.id);
  memberC1 = await insertUser("testuser_dept_c1", deptC.id);
  await makeGlobalAdmin(admin);
  await makeOwner(admin, deptA.id);
  await makeOwner(ownerB, deptB.id);
  await makeOwner(ownerC, deptC.id);
  for (const user of [admin, memberA1])
    await joinDepartmentChannels(deptA, user);
  for (const user of [ownerB, memberB1, memberB2])
    await joinDepartmentChannels(deptB, user);
  for (const user of [ownerC, memberC1])
    await joinDepartmentChannels(deptC, user);
  // 自動専用チャンネル以外の、部署Bの通常のチャンネル（異動しても触れない）
  chatB = await insertChannel({
    name: `${TEST_TAG}B雑談`,
    purpose: "normal",
    departmentId: deptB.id,
  });
  await insertMember(chatB, memberB1);
  expect(await departmentInvariantViolations()).toEqual([]);
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_department_audit");
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_channel_member");
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
});

describe("#196 部署の作成（Repository・D1）", () => {
  it("#196 AC-1・AC-3（2-1 AC-2・7-1 AC-1）: 全体管理者がオーナーの作成で、部署・公開の通常とお知らせのチャンネル・オーナー・監査が1件ずつできる", async () => {
    const created = await create({ name: `${TEST_TAG}営業` });
    expect(created).toMatchObject({
      name: `${TEST_TAG}営業`,
      description: "",
      ownerUserId: admin,
      version: 1,
    });
    expect(created.dedicatedChannelId).not.toBe(created.announcementChannelId);
    const row = await departmentRow(created.id);
    expect(row).toMatchObject({
      name: `${TEST_TAG}営業`,
      name_normalized: `${TEST_TAG}営業`.toLowerCase(),
      description: "",
      version: 1,
      is_active: 1,
    });
    expect(await autoChannelsOf(created.id)).toEqual([
      {
        room_id: created.announcementChannelId,
        department_id: created.id,
        name: `${TEST_TAG}営業のお知らせ`,
        name_normalized: `${TEST_TAG}営業のお知らせ`.toLowerCase(),
        description: "",
        visibility: "public",
        purpose: "announcement",
        deleted_at: null,
      },
      {
        room_id: created.dedicatedChannelId,
        department_id: created.id,
        name: `${TEST_TAG}営業`,
        name_normalized: `${TEST_TAG}営業`.toLowerCase(),
        description: "",
        visibility: "public",
        purpose: "department",
        deleted_at: null,
      },
    ]);
    const rooms = await env.DB.prepare(
      "SELECT id, kind FROM rooms WHERE id IN (?, ?) ORDER BY id",
    )
      .bind(created.dedicatedChannelId, created.announcementChannelId)
      .all<{ id: string; kind: string }>();
    expect(rooms.results.map((r) => r.kind)).toEqual(["channel", "channel"]);
    expect(await ownersOf(created.id)).toEqual([admin]);
    // 全体管理者は所属を動かさず、所属する社員だけが自動参加する（S-8）。新しい部署の社員はまだいない
    expect(await departmentOf(admin)).toBe(deptA.id);
    expect(await ownersOf(deptA.id)).toEqual([admin]);
    expect(await membersOf(created.dedicatedChannelId)).toEqual([]);
    expect(await membersOf(created.announcementChannelId)).toEqual([]);
    const audits = await departmentAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: admin,
      action: "department.create",
      target_type: "department",
      target_id: created.id,
      result: "success",
    });
    // 監査の詳細は識別子だけ。部署名は書かない
    expect(audits[0]?.detail ?? "").not.toContain("営業");
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-1（2-1 AC-12）: 説明を保存する", async () => {
    const created = await create({ description: "テスト用の説明" });
    expect((await departmentRow(created.id))?.description).toBe(
      "テスト用の説明",
    );
    // チャンネルの初期説明は部署の説明に関係なく空欄（7-1 AC-1）
    for (const channel of await autoChannelsOf(created.id))
      expect(channel.description).toBe("");
  });

  it("#196 AC-3（7-1 2026-11-08承認）: 50文字の部署名で、お知らせ名は55文字のまま保存される", async () => {
    const name = `${TEST_TAG}${"長".repeat(50 - TEST_TAG.length)}`;
    expect(name).toHaveLength(50);
    const created = await create({ name });
    const channels = await autoChannelsOf(created.id);
    expect(channels.map((c) => c.name.length).sort()).toEqual([50, 55]);
    expect(channels.find((c) => c.purpose === "announcement")?.name).toBe(
      `${name}のお知らせ`,
    );
  });

  it("#196 AC-2・AC-3（0-8 AC-7・7-1 AC-2）: 一般社員を指名すると所属が移り、旧部署の自動チャンネルから外れて新部署の2つに参加する。他のチャンネルには触れない", async () => {
    const created = await create({ ownerUserId: memberB1 });
    expect(await ownersOf(created.id)).toEqual([memberB1]);
    expect(await departmentOf(memberB1)).toBe(created.id);
    expect(await membersOf(created.dedicatedChannelId)).toEqual([memberB1]);
    expect(await membersOf(created.announcementChannelId)).toEqual([memberB1]);
    expect(await membersOf(deptB.dedicatedChannelId)).not.toContain(memberB1);
    expect(await membersOf(deptB.announcementChannelId)).not.toContain(
      memberB1,
    );
    expect(await membersOf(chatB)).toEqual([memberB1]);
    // 元の部署Bのオーナーは変わらない
    expect(await ownersOf(deptB.id)).toEqual([ownerB]);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2（0-8 AC-10・2-1 AC-18）: 別部署の現オーナーを指名すると、後任ありで作成・元部署の交代・所属・参加が一括で反映される", async () => {
    const created = await create({
      ownerUserId: ownerB,
      previousDepartmentSuccessorUserId: memberB1,
      previousDepartmentVersion: 1,
    });
    expect(await ownersOf(created.id)).toEqual([ownerB]);
    expect(await ownersOf(deptB.id)).toEqual([memberB1]);
    expect(await departmentOf(ownerB)).toBe(created.id);
    // 後任は元部署の社員のまま
    expect(await departmentOf(memberB1)).toBe(deptB.id);
    expect(await membersOf(created.dedicatedChannelId)).toEqual([ownerB]);
    expect(await membersOf(deptB.dedicatedChannelId)).not.toContain(ownerB);
    expect(await membersOf(deptB.dedicatedChannelId)).toContain(memberB1);
    // 元部署にも変更が入るため、元部署の版も進む
    expect((await departmentRow(deptB.id))?.version).toBe(2);
    expect(await departmentInvariantViolations()).toEqual([]);
    const audits = await departmentAudits();
    expect(audits.map((a) => a.action)).toContain("department.create");
    expect(audits.every((a) => a.result === "success")).toBe(true);
  });

  it.each([
    ["後任なし", () => null],
    ["後任が無効な社員", () => inactiveB],
    ["後任が他部署の社員", () => memberC1],
    ["後任が全体管理者", () => admin],
    ["後任が本人", () => ownerB],
  ])(
    "#196 AC-2（0-8 AC-10）: 別部署の現オーナーの指名で%sなら、batch の前提確認で全体が取り消される",
    async (_label, successor) => {
      const before = await departmentSnapshot();
      await expect(
        create({
          ownerUserId: ownerB,
          previousDepartmentSuccessorUserId: successor(),
          previousDepartmentVersion: 1,
        }),
      ).rejects.toBeInstanceOf(DepartmentConflictError);
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-2（0-8 AC-10）: 元部署のオーナーでない一般社員の指名に後任を付けると取り消される（不要な後任）", async () => {
    const before = await departmentSnapshot();
    await expect(
      create({
        ownerUserId: memberB1,
        previousDepartmentSuccessorUserId: memberB2,
        previousDepartmentVersion: 1,
      }),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-2（0-8 AC-7）: 無効な社員を指名すると、batch の前提確認で全体が取り消される", async () => {
    const before = await departmentSnapshot();
    await expect(create({ ownerUserId: inactiveB })).rejects.toBeInstanceOf(
      DepartmentConflictError,
    );
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-2・AC-5（計画レビュー 2(a)）: 元部署の版が読んだ時から変わっていたら、作成ごと取り消される", async () => {
    const before = await departmentSnapshot();
    await expect(
      create({
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberB1,
        previousDepartmentVersion: 99,
      }),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it.each([
    ["大小文字違い", `${TEST_TAG}既存a`],
    [
      "前後空白付き（Service で除去済みの値と同じ比較キー）",
      `${TEST_TAG}既存A`,
    ],
  ])(
    "#196 AC-1（2-1 AC-12）: 既存の部署名と%sは DuplicateDepartmentError(department_name)で何も変わらない",
    async (_label, name) => {
      const before = await departmentSnapshot();
      const error = await create({ name, ownerUserId: memberB1 }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(DuplicateDepartmentError);
      // 部署名の一意制約と、通常チャンネル名の一意制約のどちらが先に当たっても名前の衝突として扱う
      expect(["department_name", "channel_name"]).toContain(
        (error as DuplicateDepartmentError).reason,
      );
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-3（7-1 2026-11-08承認）: アーカイブ済みのチャンネル名と大小文字違いで衝突すると channel_name で、部署・チャンネル・ロール・所属・参加・監査がすべて0件のまま", async () => {
    await insertChannel({
      name: `${TEST_TAG}衝突のお知らせ`,
      purpose: "normal",
      departmentId: null,
      archived: true,
    });
    const before = await departmentSnapshot();
    const error = await create({
      name: `${TEST_TAG}衝突`.toUpperCase(),
      ownerUserId: memberB1,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DuplicateDepartmentError);
    expect((error as DuplicateDepartmentError).reason).toBe("channel_name");
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-3（7-1 2026-11-08承認）: 部署名「Xのお知らせ」は、既存の部署Xのお知らせチャンネルと衝突して channel_name", async () => {
    const before = await departmentSnapshot();
    const error = await create({
      name: `${TEST_TAG}既存Aのお知らせ`,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DuplicateDepartmentError);
    expect((error as DuplicateDepartmentError).reason).toBe("channel_name");
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5（計画レビュー 6）: 監査が書けなければ全体が取り消され、未知のDBエラーは専用エラーに変えずに再送出する", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_department_audit BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'department.%' BEGIN SELECT RAISE(ABORT, 'unit_fail_department_audit'); END",
    );
    const before = await departmentSnapshot();
    const error = await create({ ownerUserId: memberB1 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateDepartmentError);
    expect(error).not.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: チャンネル参加の途中で失敗したら、部署・チャンネル・ロール・所属もすべて取り消される", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_channel_member BEFORE INSERT ON channel_members BEGIN SELECT RAISE(ABORT, 'unit_fail_channel_member'); END",
    );
    const before = await departmentSnapshot();
    await expect(create({ ownerUserId: memberB1 })).rejects.toThrow();
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-1・AC-5: 同じ名前の同時作成は1件だけ確定する", async () => {
    const results = await Promise.allSettled([
      create({ name: `${TEST_TAG}同時` }),
      create({ name: `${TEST_TAG}同時` }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(DuplicateDepartmentError);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM departments WHERE name_normalized = ?",
    )
      .bind(`${TEST_TAG}同時`.toLowerCase())
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    expect(
      (await departmentAudits()).filter(
        (a) => a.action === "department.create",
      ),
    ).toHaveLength(1);
    expect(await departmentInvariantViolations()).toEqual([]);
  });
});

describe("#196 部署の改名（Repository・D1）", () => {
  it("#196 AC-1・AC-3（2-1 AC-13・7-1 2026-11-08承認）: 改名で両チャンネル名が追従し、版が進み、監査が1件", async () => {
    const renamed = await rename(deptB.id, 1, `${TEST_TAG}新B`);
    expect(renamed).toMatchObject({
      id: deptB.id,
      name: `${TEST_TAG}新B`,
      version: 2,
    });
    expect(typeof renamed.updatedAt).toBe("string");
    expect(await departmentRow(deptB.id)).toMatchObject({
      name: `${TEST_TAG}新B`,
      name_normalized: `${TEST_TAG}新B`.toLowerCase(),
      version: 2,
    });
    const channels = await autoChannelsOf(deptB.id);
    expect(channels.map((c) => [c.purpose, c.name, c.name_normalized])).toEqual(
      [
        [
          "announcement",
          `${TEST_TAG}新Bのお知らせ`,
          `${TEST_TAG}新Bのお知らせ`.toLowerCase(),
        ],
        ["department", `${TEST_TAG}新B`, `${TEST_TAG}新B`.toLowerCase()],
      ],
    );
    // チャンネルのIDと参加者は変わらない
    expect(channels.map((c) => c.room_id).sort()).toEqual(
      [deptB.dedicatedChannelId, deptB.announcementChannelId].sort(),
    );
    expect(await membersOf(deptB.dedicatedChannelId)).toHaveLength(3);
    // 自動チャンネル以外の名前は変えない
    const chat = await env.DB.prepare(
      "SELECT name FROM channels WHERE room_id = ?",
    )
      .bind(chatB)
      .first<{ name: string }>();
    expect(chat?.name).toBe(`${TEST_TAG}B雑談`);
    const audits = await departmentAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "department.rename",
      target_id: deptB.id,
      result: "success",
    });
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toMatchObject({
      previousVersion: 1,
      nextVersion: 2,
    });
    expect(audits[0]?.detail ?? "").not.toContain("新B");
  });

  it("#196 AC-3（計画レビュー 1）: 「Xのお知らせ」を「X」に改名しても自分の通常チャンネルと衝突せず成功し、両方追従する", async () => {
    const dept = await insertDepartmentWithChannels("営業のお知らせ");
    const owner = await insertUser("testuser_dept_self1", dept.id);
    await makeOwner(owner, dept.id);
    const renamed = await rename(dept.id, 1, `${TEST_TAG}営業`);
    expect(renamed.name).toBe(`${TEST_TAG}営業`);
    const channels = await autoChannelsOf(dept.id);
    expect(channels.map((c) => [c.purpose, c.name])).toEqual([
      ["announcement", `${TEST_TAG}営業のお知らせ`],
      ["department", `${TEST_TAG}営業`],
    ]);
  });

  it("#196 AC-3（計画レビュー 1）: 「a」を「aのお知らせ」に改名しても自分のお知らせチャンネルと衝突せず成功し、両方追従する", async () => {
    const dept = await insertDepartmentWithChannels("a");
    const owner = await insertUser("testuser_dept_self2", dept.id);
    await makeOwner(owner, dept.id);
    const renamed = await rename(dept.id, 1, `${TEST_TAG}aのお知らせ`);
    expect(renamed.name).toBe(`${TEST_TAG}aのお知らせ`);
    const channels = await autoChannelsOf(dept.id);
    expect(channels.map((c) => [c.purpose, c.name])).toEqual([
      ["announcement", `${TEST_TAG}aのお知らせのお知らせ`],
      ["department", `${TEST_TAG}aのお知らせ`],
    ]);
  });

  it("#196 AC-1（2-1 AC-12）: 大小文字だけの改名は自分自身とは衝突しない", async () => {
    const renamed = await rename(deptB.id, 1, `${TEST_TAG}既存b`);
    expect(renamed.name).toBe(`${TEST_TAG}既存b`);
    expect((await autoChannelsOf(deptB.id)).map((c) => c.name)).toEqual([
      `${TEST_TAG}既存bのお知らせ`,
      `${TEST_TAG}既存b`,
    ]);
  });

  it("#196 AC-1（2-1 AC-12）: 他の部署名と大小文字違いで重複する改名は DuplicateDepartmentError で、名前・チャンネル・版・監査が変わらない", async () => {
    const before = await departmentSnapshot();
    await expect(
      rename(deptB.id, 1, `${TEST_TAG}既存c`),
    ).rejects.toBeInstanceOf(DuplicateDepartmentError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-3（7-1 2026-11-08承認）: アーカイブ済みのチャンネル名と衝突する改名は channel_name で全体が取り消される", async () => {
    await insertChannel({
      name: `${TEST_TAG}旧チャンネル`,
      purpose: "normal",
      departmentId: null,
      archived: true,
    });
    const before = await departmentSnapshot();
    const error = await rename(deptB.id, 1, `${TEST_TAG}旧チャンネル`).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DuplicateDepartmentError);
    expect((error as DuplicateDepartmentError).reason).toBe("channel_name");
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-3: 改名後のお知らせ名だけが他のチャンネルと衝突しても、部署名と通常チャンネル名も含めて全体が取り消される", async () => {
    await insertChannel({
      name: `${TEST_TAG}新名のお知らせ`,
      purpose: "normal",
      departmentId: deptC.id,
    });
    const before = await departmentSnapshot();
    const error = await rename(deptB.id, 1, `${TEST_TAG}新名`).catch(
      (e: unknown) => e,
    );
    expect((error as DuplicateDepartmentError).reason).toBe("channel_name");
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 版が一致しない改名は DepartmentConflictError で何も変わらない", async () => {
    const before = await departmentSnapshot();
    await expect(
      rename(deptB.id, 2, `${TEST_TAG}版違い`),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 無効な部署の改名は DepartmentConflictError で何も変わらない", async () => {
    const inactive = await insertDepartmentWithChannels("無効部署", {
      isActive: false,
    });
    const before = await departmentSnapshot();
    await expect(
      rename(inactive.id, 1, `${TEST_TAG}無効部署改`),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 同じ版の同時改名は片方だけ確定し、敗者の監査を残さない", async () => {
    const results = await Promise.allSettled([
      rename(deptB.id, 1, `${TEST_TAG}先`),
      rename(deptB.id, 1, `${TEST_TAG}後`),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(DepartmentConflictError);
    const row = await departmentRow(deptB.id);
    expect(row?.version).toBe(2);
    const channels = await autoChannelsOf(deptB.id);
    expect(channels.find((c) => c.purpose === "department")?.name).toBe(
      row?.name,
    );
    expect(channels.find((c) => c.purpose === "announcement")?.name).toBe(
      `${row?.name}のお知らせ`,
    );
    expect(
      (await departmentAudits()).filter(
        (a) => a.action === "department.rename",
      ),
    ).toHaveLength(1);
  });

  it("#196 AC-5: 改名の監査が書けなければ、部署名もチャンネル名も変わらない", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_department_audit BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'department.%' BEGIN SELECT RAISE(ABORT, 'unit_fail_department_audit'); END",
    );
    const before = await departmentSnapshot();
    const error = await rename(deptB.id, 1, `${TEST_TAG}監査失敗`).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateDepartmentError);
    expect(error).not.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });
});

describe("#196 オーナーの交代（Repository・D1）", () => {
  it("#196 AC-2（0-8 AC-4）: 前のオーナーが全体管理者なら兼任だけが外れ、新オーナー（同じ部署の一般社員）が付く。所属は変わらない", async () => {
    const result = await changeOwner({
      departmentId: deptA.id,
      version: 1,
      ownerUserId: memberA1,
    });
    expect(result).toMatchObject({
      departmentId: deptA.id,
      ownerUserId: memberA1,
      version: 2,
    });
    expect(typeof result.updatedAt).toBe("string");
    expect(await ownersOf(deptA.id)).toEqual([memberA1]);
    const adminRoles = await env.DB.prepare(
      "SELECT role_id FROM user_role_assignments WHERE user_id = ?",
    )
      .bind(admin)
      .all<{ role_id: string }>();
    expect(adminRoles.results.map((r) => r.role_id)).toEqual([
      "role_global_admin",
    ]);
    expect(await departmentOf(admin)).toBe(deptA.id);
    expect(await departmentOf(memberA1)).toBe(deptA.id);
    expect(await membersOf(deptA.dedicatedChannelId)).toEqual(
      [admin, memberA1].sort(),
    );
    const audits = await departmentAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "department.owner_change",
      target_id: deptA.id,
      result: "success",
    });
    const detail = audits[0]?.detail ?? "";
    expect(detail).toContain(admin);
    expect(detail).toContain(memberA1);
    expect(detail).not.toContain("テスト太郎");
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2（0-8 AC-4・AC-5・C-44）: 全体管理者を任命すると、所属は動かず自動参加もしない。前のオーナーは一般メンバーに戻り、所属は変わらない", async () => {
    await changeOwner({
      departmentId: deptB.id,
      version: 1,
      ownerUserId: admin,
    });
    expect(await ownersOf(deptB.id)).toEqual([admin]);
    // 全体管理者は複数の部署でオーナーを兼ねられる
    expect(await ownersOf(deptA.id)).toEqual([admin]);
    expect(await departmentOf(admin)).toBe(deptA.id);
    expect(await membersOf(deptB.dedicatedChannelId)).not.toContain(admin);
    const ownerBRoles = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_role_assignments WHERE user_id = ?",
    )
      .bind(ownerB)
      .first<{ n: number }>();
    expect(ownerBRoles?.n).toBe(0);
    expect(await departmentOf(ownerB)).toBe(deptB.id);
    expect(await membersOf(deptB.dedicatedChannelId)).toContain(ownerB);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2・AC-3（0-8 AC-7・7-1 AC-2）: 他部署の一般社員を任命すると所属が移り、自動チャンネルの参加が付け替わる", async () => {
    await changeOwner({
      departmentId: deptC.id,
      version: 1,
      ownerUserId: memberB1,
    });
    expect(await ownersOf(deptC.id)).toEqual([memberB1]);
    expect(await departmentOf(memberB1)).toBe(deptC.id);
    expect(await membersOf(deptC.dedicatedChannelId)).toContain(memberB1);
    expect(await membersOf(deptC.announcementChannelId)).toContain(memberB1);
    expect(await membersOf(deptB.dedicatedChannelId)).not.toContain(memberB1);
    expect(await membersOf(deptB.announcementChannelId)).not.toContain(
      memberB1,
    );
    expect(await membersOf(chatB)).toEqual([memberB1]);
    // 前のオーナー ownerC は一般メンバーに戻り、部署Cに残る
    expect(await departmentOf(ownerC)).toBe(deptC.id);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2（0-8 AC-10）: 別部署の現オーナーを任命すると、後任ありで両部署の交代・所属・参加が一括で反映され、両方の版が進む", async () => {
    await changeOwner({
      departmentId: deptC.id,
      version: 1,
      ownerUserId: ownerB,
      previousDepartmentSuccessorUserId: memberB1,
      previousDepartmentVersion: 1,
    });
    expect(await ownersOf(deptC.id)).toEqual([ownerB]);
    expect(await ownersOf(deptB.id)).toEqual([memberB1]);
    expect(await departmentOf(ownerB)).toBe(deptC.id);
    expect(await departmentOf(memberB1)).toBe(deptB.id);
    expect(await membersOf(deptC.dedicatedChannelId)).toContain(ownerB);
    expect(await membersOf(deptB.dedicatedChannelId)).not.toContain(ownerB);
    expect((await departmentRow(deptC.id))?.version).toBe(2);
    expect((await departmentRow(deptB.id))?.version).toBe(2);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it.each([
    ["後任なし", () => null],
    ["後任が無効な社員（指名後に無効化された場合を含む）", () => inactiveB],
    ["後任が他部署の社員", () => memberC1],
    ["後任が全体管理者", () => admin],
  ])(
    "#196 AC-2（0-8 AC-10・計画レビュー 2(b)(c)）: 別部署の現オーナーの任命で%sなら、全体が取り消される",
    async (_label, successor) => {
      const before = await departmentSnapshot();
      await expect(
        changeOwner({
          departmentId: deptC.id,
          version: 1,
          ownerUserId: ownerB,
          previousDepartmentSuccessorUserId: successor(),
          previousDepartmentVersion: 1,
        }),
      ).rejects.toBeInstanceOf(DepartmentConflictError);
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-2（計画レビュー 2(c)）: 無効な社員の任命は、batch の前提確認で取り消される", async () => {
    const before = await departmentSnapshot();
    await expect(
      changeOwner({
        departmentId: deptB.id,
        version: 1,
        ownerUserId: inactiveB,
      }),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-2・AC-5: 版が一致しない交代は DepartmentConflictError で何も変わらない", async () => {
    const before = await departmentSnapshot();
    await expect(
      changeOwner({
        departmentId: deptB.id,
        version: 7,
        ownerUserId: memberB1,
      }),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-2・AC-5（計画レビュー 2(a)）: 元部署の版が変わっていたら、対象部署の交代ごと取り消される", async () => {
    const before = await departmentSnapshot();
    await expect(
      changeOwner({
        departmentId: deptC.id,
        version: 1,
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberB1,
        previousDepartmentVersion: 2,
      }),
    ).rejects.toBeInstanceOf(DepartmentConflictError);
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-2・AC-5: 同じ版で別々の人を同時に任命すると片方だけ確定し、オーナーは常に1人", async () => {
    const results = await Promise.allSettled([
      changeOwner({
        departmentId: deptB.id,
        version: 1,
        ownerUserId: memberB1,
      }),
      changeOwner({
        departmentId: deptB.id,
        version: 1,
        ownerUserId: memberB2,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toBeInstanceOf(
      DepartmentConflictError,
    );
    const owners = await ownersOf(deptB.id);
    expect(owners).toHaveLength(1);
    expect([memberB1, memberB2]).toContain(owners[0]);
    expect(
      (await departmentAudits()).filter(
        (a) => a.action === "department.owner_change",
      ),
    ).toHaveLength(1);
    expect(await departmentInvariantViolations()).toEqual([]);
  });

  it("#196 AC-2・AC-5（計画レビュー 2(a)(b)）: 元部署Bのオーナー交代と、Bのオーナーを部署Cへ移す交代が同時に走っても、片方だけ確定し不変条件が保たれる", async () => {
    const results = await Promise.allSettled([
      changeOwner({
        departmentId: deptC.id,
        version: 1,
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberB1,
        previousDepartmentVersion: 1,
      }),
      changeOwner({
        departmentId: deptB.id,
        version: 1,
        ownerUserId: memberB2,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toBeInstanceOf(
      DepartmentConflictError,
    );
    expect(await departmentInvariantViolations()).toEqual([]);
    expect(await ownersOf(deptB.id)).toHaveLength(1);
    expect(await ownersOf(deptC.id)).toHaveLength(1);
  });

  it("#196 AC-2（計画レビュー 2(b)）: 一般社員が2つの部署のオーナーになる交代は、同時に送っても片方しか確定しない", async () => {
    // memberB1 を部署Aと部署Cのオーナーに同時に任命する。全体管理者でないオーナーは1部署だけ
    const results = await Promise.allSettled([
      changeOwner({
        departmentId: deptA.id,
        version: 1,
        ownerUserId: memberB1,
      }),
      changeOwner({
        departmentId: deptC.id,
        version: 1,
        ownerUserId: memberB1,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await departmentInvariantViolations()).toEqual([]);
    const owned = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_role_assignments WHERE user_id = ? AND role_id = 'role_owner'",
    )
      .bind(memberB1)
      .first<{ n: number }>();
    expect(owned?.n).toBe(1);
  });

  it("#196 AC-5: 交代の監査が書けなければ、ロール・所属・参加・版がすべて元のまま", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_department_audit BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'department.%' BEGIN SELECT RAISE(ABORT, 'unit_fail_department_audit'); END",
    );
    const before = await departmentSnapshot();
    await expect(
      changeOwner({
        departmentId: deptC.id,
        version: 1,
        ownerUserId: ownerB,
        previousDepartmentSuccessorUserId: memberB1,
        previousDepartmentVersion: 1,
      }),
    ).rejects.toThrow();
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 参加の付け替えの途中で失敗したら、ロールと所属も元のまま", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_channel_member BEFORE INSERT ON channel_members BEGIN SELECT RAISE(ABORT, 'unit_fail_channel_member'); END",
    );
    const before = await departmentSnapshot();
    await expect(
      changeOwner({
        departmentId: deptC.id,
        version: 1,
        ownerUserId: memberB1,
      }),
    ).rejects.toThrow();
    expect(await departmentSnapshot()).toEqual(before);
  });
});

describe("#196 オーナー候補（Repository・D1。計画レビュー 5）", () => {
  async function setDisplayName(userId: string, name: string) {
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind(name, userId)
      .run();
  }
  const candidates = (q: string, limit = 50) =>
    withDepartments(env, (repository) =>
      repository.listOwnerCandidates({ q, limit }),
    );

  it("#196 AC-2（0-8 AC-7）: 有効な社員だけを返し、無効な社員は出さない。返す項目は最小限", async () => {
    const page = await candidates("");
    const ids = page.items.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([admin, memberA1, ownerB, memberB1, memberB2]),
    );
    expect(ids).not.toContain(inactiveB);
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual([
        "departmentId",
        "displayName",
        "id",
        "isGlobalAdmin",
        "ownedDepartmentId",
      ]);
    expect(page.items.find((i) => i.id === ownerB)).toMatchObject({
      departmentId: deptB.id,
      ownedDepartmentId: deptB.id,
      isGlobalAdmin: false,
    });
    expect(page.items.find((i) => i.id === memberB1)).toMatchObject({
      departmentId: deptB.id,
      ownedDepartmentId: null,
      isGlobalAdmin: false,
    });
    expect(page.items.find((i) => i.id === admin)).toMatchObject({
      isGlobalAdmin: true,
    });
    const text = JSON.stringify(page);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("testuser_dept_");
    expect(text).not.toContain("v1:");
  });

  it("#196 AC-2: 表示名の部分一致で絞り込み、% と _ は文字どおりに扱う", async () => {
    await setDisplayName(memberB1, "テスト%社員");
    await setDisplayName(memberB2, "テスト_社員");
    await setDisplayName(memberC1, "テストX社員");
    const percent = await candidates("%");
    expect(percent.items.map((i) => i.id)).toEqual([memberB1]);
    const underscore = await candidates("_");
    expect(underscore.items.map((i) => i.id)).toEqual([memberB2]);
    const plain = await candidates("X社員");
    expect(plain.items.map((i) => i.id)).toEqual([memberC1]);
  });

  it("#196 AC-2: limit 件までを返し、続きがあれば nextCursor で次を取れる（重複なし）", async () => {
    const first = await withDepartments(env, (repository) =>
      repository.listOwnerCandidates({ q: "", limit: 2 }),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const seen = new Set(first.items.map((i) => i.id));
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const current = cursor;
      const next = await withDepartments(env, (repository) =>
        repository.listOwnerCandidates({
          q: "",
          limit: 2,
          cursor: decodeCursor(current),
        }),
      );
      for (const item of next.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = next.nextCursor;
    }
    expect(seen.has(inactiveB)).toBe(false);
    // 有効な社員は admin・memberA1・ownerB・memberB1・memberB2・ownerC・memberC1 の7人（無効な inactiveB は出ない）
    expect(seen.size).toBe(7);
  });
});

describe("#196 監査の内容・失敗の理由・元のエラーの保持（Repository・D1。ミューテーションの補強）", () => {
  const reasonOf = (error: unknown) =>
    error instanceof DepartmentConflictError ? error.reason : error;
  /** エラーとその原因をたどった、すべての文言 */
  const messageChain = (error: unknown) => {
    const messages: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join("\n");
  };
  const detailOf = async (action: string) => {
    const audits = (await departmentAudits()).filter(
      (a) => a.action === action,
    );
    expect(audits).toHaveLength(1);
    return JSON.parse(audits[0]?.detail ?? "null") as unknown;
  };

  it("#196 AC-1・AC-2: 作成の監査の詳細は、オーナー・元部署・後任のIDだけ（指名なしは元部署・後任が null）", async () => {
    await create({ name: `${TEST_TAG}監査なし` });
    expect(await detailOf("department.create")).toEqual({
      ownerUserId: admin,
      previousDepartmentId: null,
      successorUserId: null,
    });
  });

  it("#196 AC-2（0-8 AC-2）: 別部署の現オーナーを指名した作成の監査には、元部署と後任のIDが入る", async () => {
    await create({
      name: `${TEST_TAG}監査あり`,
      ownerUserId: ownerB,
      previousDepartmentSuccessorUserId: memberB1,
      previousDepartmentVersion: 1,
    });
    expect(await detailOf("department.create")).toEqual({
      ownerUserId: ownerB,
      previousDepartmentId: deptB.id,
      successorUserId: memberB1,
    });
  });

  it("#196 AC-2（0-8 AC-2）: 交代の監査の詳細は、新旧オーナー・元部署・後任のIDと、変更前後の版", async () => {
    await changeOwner({
      departmentId: deptC.id,
      version: 1,
      ownerUserId: ownerB,
      previousDepartmentSuccessorUserId: memberB1,
      previousDepartmentVersion: 1,
    });
    expect(await detailOf("department.owner_change")).toEqual({
      previousOwnerUserId: ownerC,
      newOwnerUserId: ownerB,
      previousDepartmentId: deptB.id,
      successorUserId: memberB1,
      previousVersion: 1,
      nextVersion: 2,
    });
  });

  it("#196 AC-2: 同じ部署の中の交代の監査では、元部署・後任は null", async () => {
    await changeOwner({
      departmentId: deptB.id,
      version: 1,
      ownerUserId: memberB1,
    });
    expect(await detailOf("department.owner_change")).toEqual({
      previousOwnerUserId: ownerB,
      newOwnerUserId: memberB1,
      previousDepartmentId: null,
      successorUserId: null,
      previousVersion: 1,
      nextVersion: 2,
    });
  });

  it.each([
    [
      "改名で版が違う",
      () => rename(deptB.id, 5, `${TEST_TAG}版違い`),
      "version",
    ],
    [
      "交代で版が違う",
      () =>
        changeOwner({
          departmentId: deptB.id,
          version: 5,
          ownerUserId: memberB1,
        }),
      "version",
    ],
    [
      "元部署の版が違う",
      () =>
        changeOwner({
          departmentId: deptC.id,
          version: 1,
          ownerUserId: ownerB,
          previousDepartmentSuccessorUserId: memberB1,
          previousDepartmentVersion: 9,
        }),
      "version",
    ],
    [
      "すでにその部署のオーナー",
      () =>
        changeOwner({
          departmentId: deptB.id,
          version: 1,
          ownerUserId: ownerB,
        }),
      "already_owner",
    ],
    [
      "別部署の現オーナーに後任がない",
      () =>
        changeOwner({
          departmentId: deptC.id,
          version: 1,
          ownerUserId: ownerB,
        }),
      "successor_required",
    ],
    [
      "後任の社員が存在しない",
      () =>
        changeOwner({
          departmentId: deptC.id,
          version: 1,
          ownerUserId: ownerB,
          previousDepartmentSuccessorUserId: "01JUNITNOSUCCESSOR00000000",
        }),
      "successor_invalid",
    ],
    [
      "不要な後任",
      () =>
        changeOwner({
          departmentId: deptB.id,
          version: 1,
          ownerUserId: memberB1,
          previousDepartmentSuccessorUserId: memberB2,
        }),
      "successor_unneeded",
    ],
    [
      "指名した社員が存在しない",
      () =>
        changeOwner({
          departmentId: deptB.id,
          version: 1,
          ownerUserId: "01JUNITNOOWNER000000000000",
        }),
      "owner_not_found",
    ],
    [
      "指名した社員が無効",
      () =>
        changeOwner({
          departmentId: deptB.id,
          version: 1,
          ownerUserId: inactiveB,
        }),
      "owner_inactive",
    ],
  ])(
    "#196 AC-2・AC-5（計画レビュー 6）: %sときは、理由 %s の DepartmentConflictError で何も変わらない",
    async (_label, run, reason) => {
      const before = await departmentSnapshot();
      const error = await run().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DepartmentConflictError);
      expect(reasonOf(error)).toBe(reason);
      expect(await departmentSnapshot()).toEqual(before);
    },
  );

  it("#196 AC-5: 元部署が無効なら、元部署のオーナーを移す交代は inactive_department で何も変わらない", async () => {
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(deptB.id)
      .run();
    const before = await departmentSnapshot();
    const error = await changeOwner({
      departmentId: deptC.id,
      version: 1,
      ownerUserId: ownerB,
      previousDepartmentSuccessorUserId: memberB1,
    }).catch((e: unknown) => e);
    expect(reasonOf(error)).toBe("inactive_department");
    expect(await departmentSnapshot()).toEqual(before);
  });

  it("#196 AC-5: 無効な部署の改名は inactive_department", async () => {
    const inactive = await insertDepartmentWithChannels("無効改名", {
      isActive: false,
    });
    const error = await rename(inactive.id, 1, `${TEST_TAG}無効改名2`).catch(
      (e: unknown) => e,
    );
    expect(reasonOf(error)).toBe("inactive_department");
  });

  it("#196 AC-1（計画レビュー 6）: 名前の衝突のエラーは名前・文言が決まっていて、元の一意制約の違反を原因として持つ", async () => {
    const error = await create({ name: `${TEST_TAG}既存A` }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DuplicateDepartmentError);
    expect(error).toMatchObject({
      name: "DuplicateDepartmentError",
      message: "部署名またはチャンネル名が重複しています",
    });
    expect((error as Error).cause).toBeDefined();
    expect(messageChain((error as Error).cause)).toMatch(/UNIQUE/i);
  });

  it("#196 AC-5: 前提の不一致のエラーは名前・文言が決まっている", async () => {
    const error = await rename(deptB.id, 5, `${TEST_TAG}版違い`).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      name: "DepartmentConflictError",
      message: "部署の状態が前提と合いません",
    });
  });

  it("#196 AC-5（計画レビュー 6）: 未知のDBエラーは、元のエラーのまま（原因の文言を失わずに）投げる", async () => {
    await env.DB.exec(
      "CREATE TRIGGER unit_fail_department_audit BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'department.%' BEGIN SELECT RAISE(ABORT, 'unit_fail_department_audit'); END",
    );
    for (const run of [
      () => create({ name: `${TEST_TAG}未知1` }),
      () => rename(deptB.id, 1, `${TEST_TAG}未知2`),
      () =>
        changeOwner({
          departmentId: deptB.id,
          version: 1,
          ownerUserId: memberB1,
        }),
    ]) {
      const error = await run().catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(messageChain(error)).toContain("unit_fail_department_audit");
    }
  });

  it("#196 AC-3: 同じ部署の社員をオーナーにしても、その人の既存の参加（参加日時）は変わらない", async () => {
    const joined = async () =>
      (
        await env.DB.prepare(
          "SELECT channel_id, joined_at FROM channel_members WHERE user_id = ? ORDER BY channel_id",
        )
          .bind(memberB1)
          .all<{ channel_id: string; joined_at: string }>()
      ).results;
    const before = await joined();
    await changeOwner({
      departmentId: deptB.id,
      version: 1,
      ownerUserId: memberB1,
    });
    expect(await joined()).toEqual(before);
  });
});
