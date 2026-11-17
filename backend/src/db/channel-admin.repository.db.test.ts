// #143-b b-AC-1・b-AC-2（2-6 AC-5①⑥・AC-6、C-131・C-132・C-142(5)、D-1・D-3）: S-39（チャンネル管理）と S-38（アーカイブ）の
// 見える範囲の SQL（db/channel-admin.repository.ts）を、マイグレーション済みの D1 で確かめる（計画 #143-b 8.1 の B1〜B11。DB の層の役割：
// 範囲・その時点の資格・検索・カーソル・100 を超える件数）。判定の順・403/404 は Service と結合のテストで見る。
// 期待は計画 5.3 と要件から決める：
//   範囲：操作者が有効で、会社範囲の全体管理者なら案件専用以外のすべて（会社直属・全社連絡・無効な部署を含む）。部署のオーナーは、その部署の
//         案件専用以外のすべて（参加していない非公開・部署の専用・お知らせ専用を含む）。会社直属は全体管理者だけ。範囲はその時点の割り当てで決まる。
//   並び：一覧は name_normalized の昇順（一意）、アーカイブの一覧は deleted_at の新しい順・同じなら room_id の降順。
//   検索：instr による部分一致。検索語は channelNameKey(q) と channelNameKey(formatChannelName(q)) の2つ。% _ \ は文字として比べる。
// 実装が前提とする約束（実装前。報告に明記）：
//   withChannelAdmin(env, (repository) => ...) / createChannelAdminRepository(db)
//   repository.listManageable(actorId, { q?: string, state: "all" | "active" | "archived", limit: number, cursor?: CursorPayload })
//     : Promise<{ items: AdminChannelRow[]; nextCursor: string | null }>（nextCursor は lib/cursor.ts の encodeCursor の値。v は name_normalized）
//   repository.findManageable(actorId, roomId): Promise<AdminChannelRow | null>
//   repository.listArchived(actorId, { limit, cursor? }): Promise<{ items: AdminChannelRow[]; nextCursor: string | null }>（v は deleted_at）
//   AdminChannelRow = { roomId, name, description, purpose, visibility, departmentId, departmentName, departmentIsActive（boolean か null）,
//     version, memberCount（有効な参加者の数）, deletedAt, deletedBy, deletedByName, archiveReason（開いているアーカイブの記録の理由） }
//   行の項目はこの14個だけ（メッセージの中身・参加者の一覧・最終の投稿を返さない）。
// 部署の専用・お知らせ専用は、部署の作成と同じ保存の形（name をそのまま、name_normalized = trim + toLowerCase）で直接入れる（department-fixtures）。
// データは架空（testuser_chadmdb_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVED_AT,
  TEST_TAG,
  cleanupChannelManageScenario,
  insertManagedChannel,
  markArchived,
} from "../../test/channel-manage-fixtures";
import {
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  cleanupDmTestData,
  deactivateUser,
  insertDm,
} from "../../test/dm-fixtures";
import {
  insertAssignment,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";
import { COMPANY_GENERAL_ROOM_ID } from "../lib/channel-rules";
import { decodeCursor, type CursorPayload } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { withChannelAdmin } from "./channel-admin.repository";

type State = "all" | "active" | "archived";
type ListOptions = {
  q?: string;
  state?: State;
  limit?: number;
  cursor?: CursorPayload;
};

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let admin: string;
let ownerA: string;
let ownerB: string;
let member: string;
let member2: string;
/** 部署 A の部屋 */
let aPublic: string;
let aPrivate: string;
let aArchived: string;
let aCase: string;
/** 部署 B の部屋 */
let bPrivate: string;
let bPublic: string;
/** 会社直属の通常のチャンネル */
let companyNormal: string;
/** DM の部屋（チャンネルではない） */
let dmRoom: string;

const list = (actorId: string, options: ListOptions = {}) =>
  withChannelAdmin(env, (r) =>
    r.listManageable(actorId, {
      state: options.state ?? "all",
      limit: options.limit ?? 100,
      ...(options.q === undefined ? {} : { q: options.q }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }),
  );

const archivedList = (
  actorId: string,
  options: { limit?: number; cursor?: CursorPayload } = {},
) =>
  withChannelAdmin(env, (r) =>
    r.listArchived(actorId, {
      limit: options.limit ?? 100,
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    }),
  );

const find = (actorId: string, roomId: string) =>
  withChannelAdmin(env, (r) => r.findManageable(actorId, roomId));

/** ページを最後まで送って、すべての行の room_id を返す（ページの数も返す） */
async function readAll(
  actorId: string,
  options: Omit<ListOptions, "cursor"> = {},
) {
  const ids: string[] = [];
  let cursor: CursorPayload | undefined;
  let pages = 0;
  for (;;) {
    const page = await list(actorId, {
      ...options,
      ...(cursor === undefined ? {} : { cursor }),
    });
    pages += 1;
    ids.push(...page.items.map((row) => row.roomId));
    if (page.nextCursor === null) break;
    cursor = decodeCursor(page.nextCursor);
    if (pages > 50) throw new Error("ページ送りが終わりません");
  }
  return { ids, pages };
}

const sorted = (ids: readonly string[]) => [...ids].sort();

/** 部署 A のオーナーが管理できる、beforeEach の部屋（案件専用を除く） */
const scopeA = () => [
  aPublic,
  aPrivate,
  aArchived,
  deptA.dedicatedChannelId,
  deptA.announcementChannelId,
];
const scopeB = () => [
  bPrivate,
  bPublic,
  deptB.dedicatedChannelId,
  deptB.announcementChannelId,
];

async function nameKeysOf(ids: readonly string[]) {
  const { results } = await env.DB.prepare(
    "SELECT room_id, name_normalized FROM channels WHERE room_id IN (SELECT value FROM json_each(?))",
  )
    .bind(JSON.stringify(ids))
    .all<{ room_id: string; name_normalized: string }>();
  return results;
}

/** 名前の比較キーの昇順（同じなら room_id の昇順）に並べた room_id */
async function byNameKey(ids: readonly string[]) {
  const rows = await nameKeysOf(ids);
  return rows
    .sort((x, y) =>
      x.name_normalized === y.name_normalized
        ? x.room_id < y.room_id
          ? -1
          : 1
        : x.name_normalized < y.name_normalized
          ? -1
          : 1,
    )
    .map((row) => row.room_id);
}

async function removeAssignment(userId: string, roleId: string) {
  await env.DB.prepare(
    "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = ?",
  )
    .bind(userId, roleId)
    .run();
}

async function setDeletedAt(roomId: string, deletedAt: string) {
  await env.DB.prepare("UPDATE channels SET deleted_at = ? WHERE room_id = ?")
    .bind(deletedAt, roomId)
    .run();
}

/** 復元済みの古いアーカイブの記録を入れる（理由の取り違えの確認用） */
async function insertRestoredEvent(roomId: string, by: string, reason: string) {
  await env.DB.prepare(
    "INSERT INTO channel_archive_events (id, channel_id, archived_by, archived_at, reason, restored_by, restored_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      testId("OLDARCV"),
      roomId,
      by,
      "2026-11-01T00:00:00.000Z",
      reason,
      by,
      "2026-11-02T00:00:00.000Z",
    )
    .run();
}

beforeEach(async () => {
  deptA = await insertDepartmentWithChannels("143b管理DB_A");
  deptB = await insertDepartmentWithChannels("143b管理DB_B");
  admin = await insertUser("testuser_chadmdb_admin", deptA.id);
  ownerA = await insertUser("testuser_chadmdb_ownera", deptA.id);
  ownerB = await insertUser("testuser_chadmdb_ownerb", deptB.id);
  member = await insertUser("testuser_chadmdb_member", deptA.id);
  member2 = await insertUser("testuser_chadmdb_member2", deptA.id);
  await makeGlobalAdmin(admin);
  await makeOwner(ownerA, deptA.id);
  await makeOwner(ownerB, deptB.id);
  aPublic = await insertManagedChannel("143b管理DB_A公開", {
    departmentId: deptA.id,
    members: [member],
  });
  // オーナー A は参加していない非公開
  aPrivate = await insertManagedChannel("143b管理DB_A非公開", {
    departmentId: deptA.id,
    visibility: "private",
    members: [member],
  });
  aArchived = await insertManagedChannel("143b管理DB_Aアーカイブ", {
    departmentId: deptA.id,
    members: [member],
  });
  await markArchived(aArchived, member2, `${TEST_TAG}統合のため`);
  aCase = await insertManagedChannel("143b管理DB_A案件", {
    departmentId: deptA.id,
    purpose: "case",
    visibility: "private",
    members: [admin, ownerA],
  });
  bPrivate = await insertManagedChannel("143b管理DB_B非公開", {
    departmentId: deptB.id,
    visibility: "private",
    members: [ownerB],
  });
  bPublic = await insertManagedChannel("143b管理DB_B公開", {
    departmentId: deptB.id,
  });
  companyNormal = await insertManagedChannel("143b管理DB_会社直属", {
    departmentId: null,
    members: [member],
  });
  dmRoom = await insertDm(ownerA, member);
});

afterEach(async () => {
  try {
    await cleanupDmTestData();
  } finally {
    await cleanupChannelManageScenario();
  }
});

describe("#143-b b-AC-1 見える範囲（B1〜B3）", () => {
  it("#143-b b-AC-1（B1。2-6 AC-5①・D-1・D-3）: 全体管理者には、全部署・会社直属・全社連絡・部署の専用・お知らせ専用・参加していない非公開・アーカイブ中・無効な部署のチャンネルが1回ずつ出る。案件専用と DM は出ない", async () => {
    const inactive = await insertDepartmentWithChannels("143b管理DB_無効", {
      isActive: false,
    });
    const { ids } = await readAll(admin);
    const expected = [
      ...scopeA(),
      ...scopeB(),
      companyNormal,
      COMPANY_GENERAL_ROOM_ID,
      inactive.dedicatedChannelId,
      inactive.announcementChannelId,
    ];
    for (const id of expected) expect(ids, id).toContain(id);
    expect(ids).not.toContain(aCase);
    expect(ids).not.toContain(dmRoom);
    expect(new Set(ids).size).toBe(ids.length);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM channels WHERE purpose = 'case'",
    ).all<{ n: number }>();
    expect(results[0]?.n).toBeGreaterThan(0);
  });

  it("#143-b b-AC-1（B2。C-142(5)）: 部署 A のオーナーには、部署 A の案件専用以外のすべて（参加していない非公開・アーカイブ中・専用・お知らせ専用）だけが出る", async () => {
    const { ids } = await readAll(ownerA);
    expect(sorted(ids)).toEqual(sorted(scopeA()));
  });

  it("#143-b b-AC-1（B2）: 部署 B のオーナーには、部署 B の分だけが出る（部署 A・会社直属・全社連絡は出ない）", async () => {
    const { ids } = await readAll(ownerB);
    expect(sorted(ids)).toEqual(sorted(scopeB()));
  });

  it("#143-b b-AC-1（B2）: 一般の社員（参加者でも）には、1件も出ない", async () => {
    expect((await list(member)).items).toEqual([]);
    expect((await archivedList(member)).items).toEqual([]);
  });

  it("#143-b b-AC-1（B2・D-3）: 部署が無効でも、そのオーナーには部署のチャンネルが出る", async () => {
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(deptA.id)
      .run();
    const { ids } = await readAll(ownerA);
    expect(sorted(ids)).toEqual(sorted(scopeA()));
    const row = (await list(ownerA)).items.find((r) => r.roomId === aPublic);
    expect(row?.departmentIsActive).toBe(false);
  });

  it("#143-b b-AC-1（B3）: 全体管理者が部署 B のオーナーを兼ねても、結果は全体管理者だけのときと同じで、重複しない", async () => {
    const before = (await readAll(admin)).ids;
    // 部署のオーナーは1人だけ（DB の制約）なので、先に部署 B のオーナーを外す
    await removeAssignment(ownerB, ROLE_IDS.owner);
    await makeOwner(admin, deptB.id);
    const after = (await readAll(admin)).ids;
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });
});

describe("#143-b b-AC-1 その時点の資格（B4）", () => {
  it("#143-b b-AC-1（B4）: オーナーの割り当てを外した直後の読み取りでは、一覧・アーカイブの一覧・1件のどれも返らない", async () => {
    expect((await list(ownerA)).items.length).toBeGreaterThan(0);
    await removeAssignment(ownerA, ROLE_IDS.owner);
    expect((await list(ownerA)).items).toEqual([]);
    expect((await archivedList(ownerA)).items).toEqual([]);
    expect(await find(ownerA, aPublic)).toBeNull();
  });

  it("#143-b b-AC-1（B4）: オーナーを無効にした直後の読み取りでは、割り当てが残っていても返らない", async () => {
    await deactivateUser(ownerA);
    expect((await list(ownerA)).items).toEqual([]);
    expect((await archivedList(ownerA)).items).toEqual([]);
    expect(await find(ownerA, aPublic)).toBeNull();
  });

  it("#143-b b-AC-1（B4）: 全体管理者を無効にした直後の読み取りでは返らない", async () => {
    await deactivateUser(admin);
    expect((await list(admin)).items).toEqual([]);
    expect(await find(admin, companyNormal)).toBeNull();
  });

  it("#143-b b-AC-1（B4）: 部署 B のオーナーを兼ねる全体管理者から、全体管理者の割り当てを外すと、部署 B の分だけになる", async () => {
    await removeAssignment(ownerB, ROLE_IDS.owner);
    await makeOwner(admin, deptB.id);
    await removeAssignment(admin, ROLE_IDS.globalAdmin);
    const { ids } = await readAll(admin);
    expect(sorted(ids)).toEqual(sorted(scopeB()));
    expect(await find(admin, companyNormal)).toBeNull();
  });

  it("#143-b b-AC-1（B4）: オーナーが部署 A から部署 B に替わると、その時点の割り当てで部署 B の分だけになる", async () => {
    await removeAssignment(ownerB, ROLE_IDS.owner);
    await removeAssignment(ownerA, ROLE_IDS.owner);
    await makeOwner(ownerA, deptB.id);
    const { ids } = await readAll(ownerA);
    expect(sorted(ids)).toEqual(sorted(scopeB()));
  });
});

describe("#143-b b-AC-1 状態の絞り込みとアーカイブの項目（B5）", () => {
  it("#143-b b-AC-1（B5）: state=active はアーカイブ中を除き、archived はアーカイブ中だけ、all は両方", async () => {
    const active = (await readAll(ownerA, { state: "active" })).ids;
    expect(sorted(active)).toEqual(
      sorted(scopeA().filter((id) => id !== aArchived)),
    );
    expect((await readAll(ownerA, { state: "archived" })).ids).toEqual([
      aArchived,
    ]);
    expect(sorted((await readAll(ownerA, { state: "all" })).ids)).toEqual(
      sorted(scopeA()),
    );
  });

  it("#143-b b-AC-1（B5）: アーカイブ中の行は、アーカイブした人（channels.deleted_by）・日時・開いている記録の理由を持つ。復元済みの古い記録の理由は出ない", async () => {
    await insertRestoredEvent(aArchived, ownerA, `${TEST_TAG}古い理由`);
    const row = await find(ownerA, aArchived);
    expect(row).toMatchObject({
      roomId: aArchived,
      deletedAt: ARCHIVED_AT,
      deletedBy: member2,
      deletedByName: "テスト太郎",
      archiveReason: `${TEST_TAG}統合のため`,
    });
  });

  it("#143-b b-AC-1（B5）: 理由なしでアーカイブした行の archiveReason は null。使用中の行は deletedAt・deletedBy・deletedByName・archiveReason がすべて null", async () => {
    const noReason = await insertManagedChannel("143b管理DB_理由なし", {
      departmentId: deptA.id,
    });
    await insertRestoredEvent(noReason, ownerA, `${TEST_TAG}前回の理由`);
    await markArchived(noReason, ownerA, null);
    expect((await find(ownerA, noReason))?.archiveReason).toBeNull();
    expect(await find(ownerA, aPublic)).toMatchObject({
      deletedAt: null,
      deletedBy: null,
      deletedByName: null,
      archiveReason: null,
    });
  });
});

describe("#143-b b-AC-1 名前の部分一致（B6）", () => {
  it("#143-b b-AC-1（B6 (1)）: 部署の作成の形で作った、全角の英数字・大文字を含む専用・お知らせ専用を、表示された名前の一部（全角のまま・大文字のまま・全角の小文字）で見つけられる", async () => {
    const wide = await insertDepartmentWithChannels("ＴＥＳＴ部署Ａ");
    const both = sorted([wide.dedicatedChannelId, wide.announcementChannelId]);
    for (const q of ["ＴＥＳＴ部署Ａ", "ｔｅｓｔ部署ａ", "ＴＥＳＴ部署"])
      expect(sorted((await readAll(admin, { q })).ids), q).toEqual(both);
    expect(
      (await readAll(admin, { q: "ＴＥＳＴ部署Ａのお知らせ" })).ids,
    ).toEqual([wide.announcementChannelId]);
  });

  it("#143-b b-AC-1（B6 (2)）: 申請・名前の変更の形（半角に整形済み）の通常のチャンネルを、半角・大文字・全角で見つけられる", async () => {
    const room = await insertManagedChannel("Abc検索Xyz", {
      departmentId: deptA.id,
    });
    for (const q of ["abc検索", "ABC検索XYZ", "ＡＢＣ検索", "ａｂｃ検索ｘｙｚ"])
      expect((await readAll(ownerA, { q })).ids, q).toEqual([room]);
  });

  it("#143-b b-AC-1（B6 (3)）: 検索語の前後の空白（全角を含む）は無視する", async () => {
    const room = await insertManagedChannel("空白検索Qrs", {
      departmentId: deptA.id,
    });
    expect((await readAll(ownerA, { q: "  空白検索qrs　" })).ids).toEqual([
      room,
    ]);
  });

  it("#143-b b-AC-1（B6 (4)）: % _ \\ は文字として比べ、含まない名前には一致しない", async () => {
    const percent = await insertManagedChannel("記号q%z", {
      departmentId: deptA.id,
    });
    const plain = await insertManagedChannel("記号qxz", {
      departmentId: deptA.id,
    });
    const underscore = await insertManagedChannel("記号q_z", {
      departmentId: deptA.id,
    });
    const backslash = await insertManagedChannel("記号q\\z", {
      departmentId: deptA.id,
    });
    expect((await readAll(ownerA, { q: "q%z" })).ids).toEqual([percent]);
    expect((await readAll(ownerA, { q: "q_z" })).ids).toEqual([underscore]);
    expect((await readAll(ownerA, { q: "q\\z" })).ids).toEqual([backslash]);
    expect((await readAll(ownerA, { q: "qxz" })).ids).toEqual([plain]);
    expect((await readAll(ownerA, { q: "%" })).ids).toEqual([percent]);
  });

  it("#143-b b-AC-1（B6 (5)）: 55 文字の日本語（LIKE の 50 バイトを超える）でも一致する", async () => {
    const long = "あいうえお".repeat(11);
    expect(long).toHaveLength(55);
    const room = await insertManagedChannel(long, { departmentId: deptA.id });
    expect((await readAll(ownerA, { q: long })).ids).toEqual([room]);
  });

  it("#143-b b-AC-1（B6 (6)）: 範囲外のチャンネルは、名前が一致しても出ない（部署 B のオーナーが部署 A の名前で探す・オーナーが会社直属の名前で探す）", async () => {
    expect((await readAll(ownerB, { q: "143b管理DB_A非公開" })).ids).toEqual(
      [],
    );
    expect((await readAll(ownerA, { q: "143b管理DB_会社直属" })).ids).toEqual(
      [],
    );
    expect((await readAll(ownerA, { q: "143b管理DB_A案件" })).ids).toEqual([]);
    expect((await readAll(admin, { q: "143b管理DB_A案件" })).ids).toEqual([]);
    expect((await readAll(ownerA, { q: "143b管理DB_A非公開" })).ids).toEqual([
      aPrivate,
    ]);
  });

  it("#143-b b-AC-1（B6）: 検索と状態の絞り込みは AND で組む", async () => {
    expect(
      (await readAll(ownerA, { q: "143b管理DB_A", state: "archived" })).ids,
    ).toEqual([aArchived]);
    expect(
      sorted(
        (await readAll(ownerA, { q: "143b管理DB_A", state: "active" })).ids,
      ),
    ).toEqual(
      sorted([
        aPublic,
        aPrivate,
        deptA.dedicatedChannelId,
        deptA.announcementChannelId,
      ]),
    );
  });
});

describe("#143-b b-AC-1 並びとカーソル（B7・B8）", () => {
  it("#143-b b-AC-1（B7）: 一覧は名前の比較キーの昇順", async () => {
    const page = await list(ownerA);
    expect(page.items.map((r) => r.roomId)).toEqual(await byNameKey(scopeA()));
    expect(page.nextCursor).toBeNull();
  });

  it("#143-b b-AC-1（B7）: 範囲内が 101 件を超えても、100 件ずつのページ送りで重複・欠落なく名前の順に読め、範囲外の行は混ざらない", async () => {
    const extra: string[] = [];
    for (let i = 0; i < 101; i += 1)
      extra.push(
        await insertManagedChannel(`143b大量${String(i).padStart(3, "0")}`, {
          departmentId: deptA.id,
        }),
      );
    for (let i = 0; i < 3; i += 1)
      await insertManagedChannel(`143b大量B${String(i).padStart(3, "0")}`, {
        departmentId: deptB.id,
      });
    const first = await list(ownerA, { limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const { ids, pages } = await readAll(ownerA, { limit: 100 });
    expect(pages).toBe(2);
    expect(ids).toEqual(await byNameKey([...scopeA(), ...extra]));
  });

  it("#143-b b-AC-1（B7）: 範囲外の行（部署 B の非公開・会社直属・案件専用）の名前と ID で作ったカーソルでも、範囲内の行だけが、その位置の後から返る", async () => {
    const ordered = await byNameKey(scopeA());
    const keys = new Map(
      (await nameKeysOf([...scopeA(), bPrivate, companyNormal, aCase])).map(
        (r) => [r.room_id, r.name_normalized],
      ),
    );
    for (const outside of [bPrivate, companyNormal, aCase]) {
      const v = keys.get(outside) ?? "";
      const page = await list(ownerA, { cursor: { v, id: outside } });
      const expected = ordered.filter((id) => {
        const key = keys.get(id) ?? "";
        return key > v || (key === v && id > outside);
      });
      expect(
        page.items.map((r) => r.roomId),
        outside,
      ).toEqual(expected);
    }
    const all = await list(ownerA, { cursor: { v: "", id: bPrivate } });
    expect(all.items.map((r) => r.roomId)).toEqual(ordered);
  });

  it("#143-b b-AC-1（B7）: 返した最後の行から次のカーソルを作る（limit を 2 にして続けて読むと、全件と同じ）", async () => {
    const first = await list(ownerA, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const cursor = decodeCursor(first.nextCursor ?? "");
    expect(cursor.id).toBe(first.items[1]?.roomId);
    const { ids } = await readAll(ownerA, { limit: 2 });
    expect(ids).toEqual(await byNameKey(scopeA()));
  });

  it("#143-b b-AC-1（B8）: 全体管理者が 101 を超える部署のオーナーを兼ねても、一覧・1件・アーカイブの一覧の文が失敗しない（値の数が一定）", async () => {
    for (let i = 0; i < 101; i += 1) {
      const department = await insertDepartment(
        `143b多数${String(i).padStart(3, "0")}`,
      );
      await insertAssignment(admin, ROLE_IDS.owner, "department", department);
    }
    const page = await list(admin, { q: "143b管理DB", limit: 100 });
    expect(page.items.map((r) => r.roomId)).toContain(aPrivate);
    expect(await find(admin, aPrivate)).not.toBeNull();
    expect((await archivedList(admin)).items.map((r) => r.roomId)).toContain(
      aArchived,
    );
  });
});

describe("#143-b b-AC-1 参加者数と返す項目（B9）", () => {
  it("#143-b b-AC-1（B9。2-6 AC-5⑥）: memberCount は有効な参加者だけを数える", async () => {
    const leaver = await insertUser("testuser_chadmdb_leaver", deptA.id);
    await insertMember(aPublic, member2);
    await insertMember(aPublic, leaver);
    await deactivateUser(leaver);
    expect((await find(ownerA, aPublic))?.memberCount).toBe(2);
    expect((await find(ownerA, aPrivate))?.memberCount).toBe(1);
    expect((await find(ownerA, deptA.dedicatedChannelId))?.memberCount).toBe(0);
  });

  it("#143-b b-AC-1（B9）: 行の項目はキーの完全一致で決めた 14 個だけ（メッセージの中身・参加者の一覧・最終の投稿を持たない）", async () => {
    const keys = [
      "archiveReason",
      "deletedAt",
      "deletedBy",
      "deletedByName",
      "departmentId",
      "departmentIsActive",
      "departmentName",
      "description",
      "memberCount",
      "name",
      "purpose",
      "roomId",
      "version",
      "visibility",
    ];
    const rows = [
      ...(await list(admin)).items,
      ...(await archivedList(admin)).items,
    ];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(keys);
    const one = await find(admin, aArchived);
    expect(Object.keys(one ?? {}).sort()).toEqual(keys);
  });

  it("#143-b b-AC-1（B9）: 部署・会社直属の項目（部署の名前と有効性、会社直属は null）と、種類・公開・版を返す", async () => {
    expect(await find(admin, aPrivate)).toMatchObject({
      roomId: aPrivate,
      name: `${TEST_TAG}143b管理DB_A非公開`,
      purpose: "normal",
      visibility: "private",
      departmentId: deptA.id,
      departmentName: deptA.name,
      departmentIsActive: true,
      version: 1,
    });
    expect(await find(admin, companyNormal)).toMatchObject({
      departmentId: null,
      departmentName: null,
      departmentIsActive: null,
    });
    expect(await find(admin, COMPANY_GENERAL_ROOM_ID)).toMatchObject({
      purpose: "company_general",
      departmentId: null,
    });
    expect(await find(ownerA, deptA.announcementChannelId)).toMatchObject({
      purpose: "announcement",
    });
  });
});

describe("#143-b b-AC-2 アーカイブの一覧（B10）", () => {
  let aArchived2: string;
  let bArchived: string;
  let companyArchived: string;

  beforeEach(async () => {
    aArchived2 = await insertManagedChannel("143b管理DB_Aアーカイブ2", {
      departmentId: deptA.id,
      visibility: "private",
    });
    await markArchived(aArchived2, admin, null);
    bArchived = await insertManagedChannel("143b管理DB_Bアーカイブ", {
      departmentId: deptB.id,
    });
    await markArchived(bArchived, ownerB, `${TEST_TAG}B の理由`);
    companyArchived = await insertManagedChannel("143b管理DB_会社アーカイブ", {
      departmentId: null,
    });
    await markArchived(companyArchived, admin, null);
  });

  it("#143-b b-AC-2（B10。C-132）: オーナーには自部署のアーカイブ済みすべて（誰がアーカイブしたものでも・参加していない非公開も）だけが出る。使用中は出ない", async () => {
    const ids = (await archivedList(ownerA)).items.map((r) => r.roomId);
    expect(sorted(ids)).toEqual(sorted([aArchived, aArchived2]));
  });

  it("#143-b b-AC-2（B10）: 全体管理者には全部署・会社直属のアーカイブ済みが出る", async () => {
    const ids = (await archivedList(admin)).items.map((r) => r.roomId);
    expect(sorted(ids)).toEqual(
      sorted([aArchived, aArchived2, bArchived, companyArchived]),
    );
  });

  it("#143-b b-AC-2（B10・決定 Q2）: アーカイブした日時の新しい順。同じ日時なら room_id の降順", async () => {
    await setDeletedAt(aArchived, "2026-11-16T00:00:00.000Z");
    await setDeletedAt(bArchived, "2026-11-14T00:00:00.000Z");
    // aArchived2 と companyArchived は同じ日時（ARCHIVED_AT）
    const tie = [aArchived2, companyArchived].sort().reverse();
    const ids = (await archivedList(admin)).items.map((r) => r.roomId);
    expect(ids).toEqual([aArchived, ...tie, bArchived]);
  });

  it("#143-b b-AC-2（B10）: 1 件ずつのページ送りで、重複・欠落なく同じ順に読める（同じ日時の行をまたいでも）", async () => {
    const all = (await archivedList(admin)).items.map((r) => r.roomId);
    const seen: string[] = [];
    let cursor: CursorPayload | undefined;
    for (let i = 0; i < 10; i += 1) {
      const page = await archivedList(admin, {
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((r) => r.roomId));
      if (page.nextCursor === null) break;
      cursor = decodeCursor(page.nextCursor);
    }
    expect(seen).toEqual(all);
  });

  it("#143-b b-AC-2（B10）: 範囲外の行の日時と ID で作ったカーソルでも、範囲内の行だけが返る", async () => {
    await setDeletedAt(bArchived, "2026-11-16T00:00:00.000Z");
    const page = await archivedList(ownerA, {
      cursor: { v: "2026-11-16T00:00:00.000Z", id: bArchived },
    });
    expect(sorted(page.items.map((r) => r.roomId))).toEqual(
      sorted([aArchived, aArchived2]),
    );
  });

  it("#143-b b-AC-2（B10）: 行の deletedBy・deletedAt は channels の値、理由は開いている記録", async () => {
    const rows = (await archivedList(admin)).items;
    expect(rows.find((r) => r.roomId === bArchived)).toMatchObject({
      deletedBy: ownerB,
      deletedByName: "テスト太郎",
      deletedAt: ARCHIVED_AT,
      archiveReason: `${TEST_TAG}B の理由`,
      departmentId: deptB.id,
    });
    expect(rows.find((r) => r.roomId === aArchived2)).toMatchObject({
      deletedBy: admin,
      archiveReason: null,
    });
  });
});

describe("#143-b b-AC-1 1件（B11）", () => {
  it("#143-b b-AC-1（B11）: 範囲内は行を返す（参加していない非公開・アーカイブ中・お知らせ専用）", async () => {
    for (const id of [aPrivate, aArchived, deptA.announcementChannelId])
      expect((await find(ownerA, id))?.roomId, id).toBe(id);
  });

  it("#143-b b-AC-1（B11）: 範囲外（他部署の非公開・会社直属・全社連絡）・存在しない・案件専用・DM の部屋は、どれも null", async () => {
    for (const id of [
      bPrivate,
      companyNormal,
      COMPANY_GENERAL_ROOM_ID,
      testId("NOROOM"),
      aCase,
      dmRoom,
    ])
      expect(await find(ownerA, id), id).toBeNull();
    expect(await find(admin, aCase)).toBeNull();
    expect(await find(admin, dmRoom)).toBeNull();
  });
});
