// #143-b b-AC-1〜b-AC-3（計画 #143-b 5.2・8.1 の S1〜S4）: S-39・S-38 の Service（services/channel-admin.service.ts）の判定と、行から応答の形への組み立て。
// Repository・割り当ての読み込み・authorizer は代役にし、「最初の判定は通ったが、取得の時点で0件・資格なし」のような競合を作る（Service の層の役割）。
// 期待は計画 5.1・5.2 から決める：
//   assertCanOpen(actor, permission)：割り当てを読み、会社の範囲か本人の部署範囲の割り当てのいずれかの部署で permission を持てば通す。
//     持たなければ authorizer.authorize(principal, permission, { type: "company" }) を呼び、その 403 をそのまま伝える。
//   list・listArchived：0件のときだけ資格を読み直し、失っていれば 403、あれば空の成功（成功に見せかけた空にしない）。
//   get：行がなければ資格を読み直し、失っていれば 403、あれば 404「チャンネルが見つかりません」（理由によらず同じ1種類の文）。
//   manage・canRestore は種類と状態だけで決まる（lib/channel-rules.ts の channelManageActions と同じ。D-1）。
// 実装が前提とする約束（実装前。報告に明記）：
//   createChannelAdminService(repository: ChannelAdminRepository, deps: { authorizer: { can, authorize }, roleAssignments: RoleAssignmentRepository })
//     .assertCanOpen(actor: { userId, traceId }, permission: "perm.channel.edit" | "perm.channel.delete"): Promise<void>
//     .list(actor, { q?, state, limit, cursor? }): Promise<{ items: AdminChannel[]; nextCursor: string | null }>（再確認は perm.channel.edit）
//     .get(actor, roomId): Promise<AdminChannel>（再確認は perm.channel.edit）
//     .listArchived(actor, { limit, cursor? }): Promise<{ items: ArchivedItem[]; nextCursor: string | null }>（再確認は perm.channel.delete）
//   行（AdminChannelRow）の形は db/channel-admin.repository.db.test.ts の冒頭のとおり。
// データは架空。
import { describe, expect, it, vi } from "vitest";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS, type Permission } from "../lib/permissions";
import { createChannelAdminService } from "./channel-admin.service";

const ACTOR = {
  userId: "01JTESTCHADMUSER0000000001",
  traceId: "unit-auth-chadm",
};
const ROOM = "01JTESTCHADMROOM0000000001";
const DEPT = "01JTESTCHADMDEPT0000000001";
const OTHER_DEPT = "01JTESTCHADMDEPT0000000002";
const ARCHIVER = "01JTESTCHADMUSER0000000002";
const ARCHIVED_AT = "2026-11-15T00:00:00.000Z";
const NOT_FOUND = "チャンネルが見つかりません";

type Purpose = "normal" | "department" | "announcement" | "company_general";

type Row = {
  roomId: string;
  name: string;
  description: string;
  purpose: Purpose;
  visibility: "public" | "private";
  departmentId: string | null;
  departmentName: string | null;
  departmentIsActive: boolean | null;
  version: number;
  memberCount: number;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedByName: string | null;
  archiveReason: string | null;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  roomId: ROOM,
  name: "[UNIT_TEST]管理",
  description: "[UNIT_TEST]説明",
  purpose: "normal",
  visibility: "private",
  departmentId: DEPT,
  departmentName: "[UNIT_TEST]部署",
  departmentIsActive: true,
  version: 3,
  memberCount: 2,
  deletedAt: null,
  deletedBy: null,
  deletedByName: null,
  archiveReason: null,
  ...overrides,
});
const archivedRow = (overrides: Partial<Row> = {}) =>
  row({
    deletedAt: ARCHIVED_AT,
    deletedBy: ARCHIVER,
    deletedByName: "テスト太郎",
    archiveReason: "[UNIT_TEST]理由",
    ...overrides,
  });

type Facts = Awaited<ReturnType<RoleAssignmentRepository["findByUserId"]>>;
const ADMIN: Facts = {
  user: { isActive: true },
  assignments: [
    { roleId: ROLE_IDS.globalAdmin, scopeType: "company", departmentId: null },
  ],
};
const OWNER: Facts = {
  user: { isActive: true },
  assignments: [
    {
      roleId: ROLE_IDS.owner,
      scopeType: "department",
      departmentId: OTHER_DEPT,
    },
  ],
};
const MEMBER: Facts = {
  user: { isActive: true },
  assignments: [
    { roleId: ROLE_IDS.member, scopeType: "department", departmentId: DEPT },
  ],
};
const INACTIVE_ADMIN: Facts = { ...ADMIN, user: { isActive: false } };

type AuthorizeCall = { userId: string; permission: Permission; scope: unknown };

/** 呼ばれた順に事実を返す（最後の値を以後も返す） */
function roleAssignments(facts: Facts[]) {
  let i = 0;
  const findByUserId = vi.fn(async () => {
    const value = facts[Math.min(i, facts.length - 1)] ?? null;
    i += 1;
    return value;
  });
  return { findByUserId };
}

/** 本物と同じく、拒否のときは FORBIDDEN を投げる authorize（呼ばれたら必ず拒否する：Service は持たないときだけ呼ぶ） */
function denyingAuthorizer() {
  const calls: AuthorizeCall[] = [];
  return {
    calls,
    can: vi.fn(async () => false),
    async authorize(
      principal: { userId: string },
      permission: Permission,
      scope?: unknown,
    ) {
      calls.push({ userId: principal.userId, permission, scope });
      throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
}

type Page = { items: Row[]; nextCursor: string | null };

function fakeRepository(options: {
  list?: Page;
  archived?: Page;
  found?: Row | null;
}) {
  return {
    listManageable: vi.fn(
      async () => options.list ?? { items: [], nextCursor: null },
    ),
    listArchived: vi.fn(
      async () => options.archived ?? { items: [], nextCursor: null },
    ),
    findManageable: vi.fn(async () => options.found ?? null),
  };
}

function build(
  repository: ReturnType<typeof fakeRepository>,
  facts: Facts[],
  authorizer = denyingAuthorizer(),
) {
  const assignments = roleAssignments(facts);
  const service = createChannelAdminService(
    repository as never,
    {
      authorizer,
      roleAssignments: assignments,
    } as never,
  );
  return { service, authorizer, assignments };
}

async function errorOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("失敗しませんでした");
}

const PERMISSIONS = ["perm.channel.edit", "perm.channel.delete"] as const;

describe("#143-b b-AC-3 assertCanOpen（S1）", () => {
  for (const permission of PERMISSIONS) {
    it.each([
      ["全体管理者", ADMIN],
      ["所属しない部署のオーナー", OWNER],
    ] as const)(
      `#143-b b-AC-3（S1）: %s は ${permission} で通り、authorize の拒否を呼ばない`,
      async (_label, facts) => {
        const { service, authorizer } = build(fakeRepository({}), [facts]);
        await expect(
          service.assertCanOpen(ACTOR, permission),
        ).resolves.toBeUndefined();
        expect(authorizer.calls).toEqual([]);
      },
    );

    it.each([
      ["一般の社員", MEMBER],
      ["無効な全体管理者", INACTIVE_ADMIN],
      ["存在しない利用者", null],
    ] as const)(
      `#143-b b-AC-3（S1）: %s は ${permission} で 403。authorize を会社の範囲で呼び、拒否が運用ログに残る経路を通る`,
      async (_label, facts) => {
        const repository = fakeRepository({});
        const { service, authorizer } = build(repository, [facts]);
        const error = await errorOf(() =>
          service.assertCanOpen(ACTOR, permission),
        );
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("FORBIDDEN");
        expect(authorizer.calls).toEqual([
          { userId: ACTOR.userId, permission, scope: { type: "company" } },
        ]);
        expect(repository.listManageable).not.toHaveBeenCalled();
        expect(repository.findManageable).not.toHaveBeenCalled();
      },
    );
  }
});

describe("#143-b b-AC-1 0件のときの資格の読み直し（S2・S3）", () => {
  it("#143-b b-AC-1（S2）: 一覧が0件で、読み直すと資格を失っていれば 403（空の成功にしない）", async () => {
    const repository = fakeRepository({
      list: { items: [], nextCursor: null },
    });
    const { service, assignments } = build(repository, [MEMBER]);
    const error = await errorOf(() =>
      service.list(ACTOR, { state: "all", limit: 20 }),
    );
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect(repository.listManageable).toHaveBeenCalledTimes(1);
    expect(assignments.findByUserId).toHaveBeenCalled();
  });

  it("#143-b b-AC-1（S2）: 一覧が0件で、資格があれば空の 200（items は空・nextCursor は null）", async () => {
    const { service } = build(fakeRepository({}), [OWNER]);
    expect(
      await service.list(ACTOR, { state: "archived", limit: 20, q: "なし" }),
    ).toEqual({ items: [], nextCursor: null });
  });

  it("#143-b b-AC-2（S2）: アーカイブの一覧が0件で、資格を失っていれば 403、あれば空", async () => {
    const lost = build(fakeRepository({}), [INACTIVE_ADMIN]);
    expect(
      (
        (await errorOf(() =>
          lost.service.listArchived(ACTOR, { limit: 20 }),
        )) as AppError
      ).code,
    ).toBe("FORBIDDEN");
    const kept = build(fakeRepository({}), [ADMIN]);
    expect(await kept.service.listArchived(ACTOR, { limit: 20 })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("#143-b b-AC-1（S2）: 行があれば、読み直しの結果に関わらずその行を返す（一覧の条件が範囲を決める）", async () => {
    const { service } = build(
      fakeRepository({ list: { items: [row()], nextCursor: "next" } }),
      [OWNER],
    );
    const page = await service.list(ACTOR, { state: "all", limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([ROOM]);
    expect(page.nextCursor).toBe("next");
  });

  it("#143-b b-AC-1（S2）: 入力（q・state・limit・cursor）を Repository へそのまま渡す（操作者は actor の ID）", async () => {
    const repository = fakeRepository({
      list: { items: [row()], nextCursor: null },
    });
    const { service } = build(repository, [ADMIN]);
    const cursor = { v: "[unit_test]a", id: ROOM };
    await service.list(ACTOR, { q: "検索", state: "active", limit: 5, cursor });
    expect(repository.listManageable).toHaveBeenCalledWith(ACTOR.userId, {
      q: "検索",
      state: "active",
      limit: 5,
      cursor,
    });
  });

  it("#143-b b-AC-1（S3）: 1件が見つからず資格があれば 404「チャンネルが見つかりません」", async () => {
    const { service } = build(fakeRepository({ found: null }), [OWNER]);
    const error = await errorOf(() => service.get(ACTOR, ROOM));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("NOT_FOUND");
    expect((error as AppError).message).toBe(NOT_FOUND);
  });

  it("#143-b b-AC-1（S3）: 1件が見つからず資格を失っていれば 403", async () => {
    const { service } = build(fakeRepository({ found: null }), [MEMBER]);
    expect(
      ((await errorOf(() => service.get(ACTOR, ROOM))) as AppError).code,
    ).toBe("FORBIDDEN");
  });

  it("#143-b b-AC-1（S3）: 1件の取得は Repository に操作者の ID と部屋の ID を渡す", async () => {
    const repository = fakeRepository({ found: row() });
    const { service } = build(repository, [ADMIN]);
    await service.get(ACTOR, ROOM);
    expect(repository.findManageable).toHaveBeenCalledWith(ACTOR.userId, ROOM);
  });

  it("#143-b b-AC-1（S2）: 割り当ての読み込みの失敗は、そのまま伝える（成功・空にしない）", async () => {
    const repository = fakeRepository({});
    const service = createChannelAdminService(
      repository as never,
      {
        authorizer: denyingAuthorizer(),
        roleAssignments: {
          findByUserId: vi.fn(async () => {
            throw new Error("D1 の読み込みに失敗");
          }),
        },
      } as never,
    );
    const error = await errorOf(() =>
      service.list(ACTOR, { state: "all", limit: 20 }),
    );
    expect((error as Error).message).toBe("D1 の読み込みに失敗");
  });
});

describe("#143-b b-AC-1・b-AC-2 応答の形と manage（S4）", () => {
  it("#143-b b-AC-1（S4）: 一覧の行は計画 5.1 の項目だけを持ち、部署・状態・アーカイブを組み立てる（使用中・部署あり）", async () => {
    const { service } = build(
      fakeRepository({ found: row({ departmentIsActive: false }) }),
      [ADMIN],
    );
    const item = await service.get(ACTOR, ROOM);
    expect(item).toEqual({
      id: ROOM,
      name: "[UNIT_TEST]管理",
      description: "[UNIT_TEST]説明",
      purpose: "normal",
      visibility: "private",
      department: { id: DEPT, name: "[UNIT_TEST]部署", isActive: false },
      state: "active",
      version: 3,
      memberCount: 2,
      archive: null,
      manage: {
        canRename: true,
        canEditDescription: true,
        canArchive: true,
        canRestore: false,
      },
    });
  });

  it("#143-b b-AC-1（S4）: アーカイブ中の行は state=archived、archive に人・日時・理由（理由なしは null）。会社直属の department は null", async () => {
    const { service } = build(
      fakeRepository({
        found: archivedRow({
          departmentId: null,
          departmentName: null,
          departmentIsActive: null,
          archiveReason: null,
        }),
      }),
      [ADMIN],
    );
    const item = await service.get(ACTOR, ROOM);
    expect(item).toMatchObject({
      state: "archived",
      department: null,
      archive: {
        archivedBy: { id: ARCHIVER, displayName: "テスト太郎" },
        archivedAt: ARCHIVED_AT,
        reason: null,
      },
    });
  });

  const NONE = {
    canRename: false,
    canEditDescription: false,
    canArchive: false,
    canRestore: false,
  };
  it.each([
    [
      "通常・使用中",
      row(),
      { ...NONE, canRename: true, canEditDescription: true, canArchive: true },
    ],
    [
      "部署の専用・使用中",
      row({ purpose: "department" }),
      { ...NONE, canEditDescription: true },
    ],
    [
      "お知らせ専用・使用中",
      row({ purpose: "announcement" }),
      { ...NONE, canEditDescription: true },
    ],
    [
      "全社連絡・使用中",
      row({
        purpose: "company_general",
        departmentId: null,
        departmentName: null,
        departmentIsActive: null,
      }),
      { ...NONE, canEditDescription: true },
    ],
    ["通常・アーカイブ中", archivedRow(), { ...NONE, canRestore: true }],
  ] as const)(
    "#143-b b-AC-1（S4・D-1）: %s の manage は種類と状態だけで決まる",
    async (_label, found, manage) => {
      const { service } = build(fakeRepository({ found }), [OWNER]);
      expect((await service.get(ACTOR, ROOM)).manage).toEqual(manage);
    },
  );

  it("#143-b b-AC-2（S4。EP-2-40）: アーカイブの一覧の行は type=channel・caseNumber=null・deletedBy・deletedAt・reason・version・department・canRestore だけ", async () => {
    const { service } = build(
      fakeRepository({
        archived: { items: [archivedRow()], nextCursor: "next" },
      }),
      [OWNER],
    );
    const page = await service.listArchived(ACTOR, { limit: 1 });
    expect(page).toEqual({
      items: [
        {
          type: "channel",
          id: ROOM,
          name: "[UNIT_TEST]管理",
          caseNumber: null,
          deletedBy: { id: ARCHIVER, displayName: "テスト太郎" },
          deletedAt: ARCHIVED_AT,
          reason: "[UNIT_TEST]理由",
          version: 3,
          department: { id: DEPT, name: "[UNIT_TEST]部署", isActive: true },
          canRestore: true,
        },
      ],
      nextCursor: "next",
    });
  });
});

// #143-b ミューテーションの生き残り（channel-admin.service.ts）への追加
describe("#143-b b-AC-1・b-AC-2: 資格の読み直しは0件のときだけ", () => {
  it("#143-b b-AC-1: 一覧が1件以上なら、資格を読み直さない（割り当てを読まない）", async () => {
    const { service, assignments } = build(
      fakeRepository({ list: { items: [row()], nextCursor: null } }),
      [MEMBER],
    );
    await service.list(ACTOR, { state: "all", limit: 20 });
    expect(assignments.findByUserId).not.toHaveBeenCalled();
  });

  it("#143-b b-AC-2: アーカイブの一覧が1件以上なら、資格を読み直さない", async () => {
    const { service, assignments } = build(
      fakeRepository({
        archived: { items: [archivedRow()], nextCursor: null },
      }),
      [MEMBER],
    );
    await service.listArchived(ACTOR, { limit: 20 });
    expect(assignments.findByUserId).not.toHaveBeenCalled();
  });

  it("#143-b b-AC-1・b-AC-2: 0件なら1回だけ読み直す", async () => {
    const one = build(fakeRepository({}), [OWNER]);
    await one.service.list(ACTOR, { state: "all", limit: 20 });
    expect(one.assignments.findByUserId).toHaveBeenCalledTimes(1);
    const two = build(fakeRepository({}), [OWNER]);
    await two.service.listArchived(ACTOR, { limit: 20 });
    expect(two.assignments.findByUserId).toHaveBeenCalledTimes(1);
  });
});

describe("#143-b b-AC-1: 部署とアーカイブした人の整形（非開示）", () => {
  it.each([
    [
      "会社直属（3つとも null）",
      { departmentId: null, departmentName: null, departmentIsActive: null },
    ],
    ["部署の名前が読めない", { departmentName: null }],
    ["部署の有効性が読めない", { departmentIsActive: null }],
    ["部署の ID がない", { departmentId: null }],
  ] as const)(
    "#143-b b-AC-1: %s なら department は null（読めない部署の一部を出さない）",
    async (_label, overrides) => {
      const { service } = build(fakeRepository({ found: row(overrides) }), [
        ADMIN,
      ]);
      expect((await service.get(ACTOR, ROOM)).department).toBeNull();
    },
  );

  it("#143-b b-AC-1（D-3）: 無効な部署は isActive=false のまま名前を出す", async () => {
    const { service } = build(
      fakeRepository({ found: row({ departmentIsActive: false }) }),
      [ADMIN],
    );
    expect((await service.get(ACTOR, ROOM)).department).toEqual({
      id: DEPT,
      name: "[UNIT_TEST]部署",
      isActive: false,
    });
  });

  it.each([
    ["アーカイブした人の ID がない", { deletedBy: null }],
    ["アーカイブした人の表示名がない", { deletedByName: null }],
  ] as const)(
    "#143-b b-AC-1・b-AC-2: %s アーカイブ済みの行は、成功に見せかけず失敗にする（1件・アーカイブの一覧）",
    async (_label, overrides) => {
      const broken = archivedRow(overrides);
      const one = build(fakeRepository({ found: broken }), [ADMIN]);
      await expect(one.service.get(ACTOR, ROOM)).rejects.toThrow();
      const many = build(
        fakeRepository({ archived: { items: [broken], nextCursor: null } }),
        [ADMIN],
      );
      await expect(
        many.service.listArchived(ACTOR, { limit: 20 }),
      ).rejects.toThrow();
    },
  );

  it("#143-b b-AC-2: 退職者（無効）がアーカイブした行も、表示名（本名ではない）をそのまま出す", async () => {
    const { service } = build(
      fakeRepository({
        archived: {
          items: [archivedRow({ deletedByName: "testuser_143b_retired" })],
          nextCursor: null,
        },
      }),
      [ADMIN],
    );
    const page = await service.listArchived(ACTOR, { limit: 20 });
    expect(page.items[0]?.deletedBy).toEqual({
      id: ARCHIVER,
      displayName: "testuser_143b_retired",
    });
  });

  it("#143-b b-AC-2: アーカイブの一覧にアーカイブされていない行が来たら、失敗にする", async () => {
    const { service } = build(
      fakeRepository({ archived: { items: [row()], nextCursor: null } }),
      [ADMIN],
    );
    await expect(service.listArchived(ACTOR, { limit: 20 })).rejects.toThrow();
  });
});
