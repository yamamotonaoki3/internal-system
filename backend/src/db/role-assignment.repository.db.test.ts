// #119 AC-2・AC-3：ロール・割り当て・会社の設定のテーブルの制約と、初期ロールのシードがコードの定数と一致すること。
// 結合のテスト：本物と同じ実行エンジン（workerd）のローカルの D1 で確かめる。データは架空（testuser_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRoleTestData,
  countRows,
  insertAssignment,
  insertDepartment,
  insertUser,
  TEST_TAG,
} from "../../test/role-fixtures";
import {
  INITIAL_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_IDS,
} from "../lib/permissions";

afterEach(cleanupRoleTestData);

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("初期ロールのシード（seed_initial_roles のマイグレーション）", () => {
  it("#119 AC-3: roles に固定の3つのロールがあり、システムのロール（is_system=1）である", async () => {
    const { results } = await env.DB.prepare(
      "SELECT id, scope_type, department_id, is_system FROM roles WHERE id IN (?, ?, ?) ORDER BY id",
    )
      .bind(ROLE_IDS.member, ROLE_IDS.owner, ROLE_IDS.globalAdmin)
      .all<{
        id: string;
        scope_type: string;
        department_id: string | null;
        is_system: number;
      }>();
    expect(results.map((r) => r.id)).toEqual(sorted(Object.values(ROLE_IDS)));
    for (const r of results) {
      expect(r.is_system).toBe(1);
      expect(r.department_id).toBeNull();
    }
    const scope = Object.fromEntries(results.map((r) => [r.id, r.scope_type]));
    expect(scope[ROLE_IDS.globalAdmin]).toBe("company");
    expect(scope[ROLE_IDS.owner]).toBe("department");
  });

  it("#119 AC-3: role_permissions の行が、INITIAL_ROLE_PERMISSIONS と過不足なく一致する（シードの二重持ちの食い違いを検出する）", async () => {
    const { results } = await env.DB.prepare(
      "SELECT role_id, permission_id FROM role_permissions",
    ).all<{ role_id: string; permission_id: string }>();
    const actual = sorted(
      results.map((r) => `${r.role_id} ${r.permission_id}`),
    );
    const expected = sorted(
      Object.entries(INITIAL_ROLE_PERMISSIONS).flatMap(([role, perms]) =>
        (perms as readonly string[]).map((p) => `${role} ${p}`),
      ),
    );
    expect(actual).toEqual(expected);
  });

  it("#119 AC-3: role_permissions に、PERMISSIONS にない権限IDがない", async () => {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT permission_id FROM role_permissions",
    ).all<{ permission_id: string }>();
    const known = new Set<string>(PERMISSIONS);
    expect(results.filter((r) => !known.has(r.permission_id))).toEqual([]);
  });

  it("#119 AC-3: 同じロールに同じ権限IDを2回入れられない（複合主キー）", async () => {
    const [first] = INITIAL_ROLE_PERMISSIONS[ROLE_IDS.member];
    await expect(
      env.DB.prepare(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      )
        .bind(ROLE_IDS.member, first)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i);
  });
});

describe("ロールの割り当て（user_role_assignments）の制約", () => {
  it("#119 AC-2: 全体管理者は1人だけ：2人目への全体管理者の割り当ては、一意の制約で失敗する（2-1 AC-10）", async () => {
    const dept = await insertDepartment("部署A");
    const first = await insertUser("testuser_001", dept);
    const second = await insertUser("testuser_002", dept);
    await insertAssignment(first, ROLE_IDS.globalAdmin, "company", null);
    await expect(
      insertAssignment(second, ROLE_IDS.globalAdmin, "company", null),
    ).rejects.toThrow(/UNIQUE/i);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_role_assignments WHERE role_id = ?",
    )
      .bind(ROLE_IDS.globalAdmin)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("#119 AC-2: 部署のオーナーは部署ごとに1人：同じ部署の2人目のオーナーは失敗し、別の部署なら入る", async () => {
    const deptA = await insertDepartment("部署A");
    const deptB = await insertDepartment("部署B");
    const u1 = await insertUser("testuser_001", deptA);
    const u2 = await insertUser("testuser_002", deptA);
    await insertAssignment(u1, ROLE_IDS.owner, "department", deptA);
    await expect(
      insertAssignment(u2, ROLE_IDS.owner, "department", deptA),
    ).rejects.toThrow(/UNIQUE/i);
    await expect(
      insertAssignment(u2, ROLE_IDS.owner, "department", deptB),
    ).resolves.toBeUndefined();
  });

  it("#119 AC-2: 同じ人が、会社範囲（全体管理者）と部署範囲（オーナー）の両方の割り当てを持てる（2-1 AC-6・AC-8）", async () => {
    const deptA = await insertDepartment("部署A");
    const deptB = await insertDepartment("部署B");
    const admin = await insertUser("testuser_001", deptA);
    await insertAssignment(admin, ROLE_IDS.globalAdmin, "company", null);
    await insertAssignment(admin, ROLE_IDS.owner, "department", deptA);
    // 複数の部署のオーナーを兼ねられる（2-1 AC-6）
    await insertAssignment(admin, ROLE_IDS.owner, "department", deptB);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM user_role_assignments WHERE user_id = ?",
    )
      .bind(admin)
      .first<{ n: number }>();
    expect(row?.n).toBe(3);
  });

  it("#119 AC-2: CHECK 制約：会社範囲なのに部署を指定した割り当ては失敗する", async () => {
    const dept = await insertDepartment("部署A");
    const u = await insertUser("testuser_001", dept);
    await expect(
      insertAssignment(u, ROLE_IDS.globalAdmin, "company", dept),
    ).rejects.toThrow(/CHECK/i);
  });

  it("#119 AC-2: CHECK 制約：部署範囲なのに部署がない割り当ては失敗する", async () => {
    const dept = await insertDepartment("部署A");
    const u = await insertUser("testuser_001", dept);
    await expect(
      insertAssignment(u, ROLE_IDS.owner, "department", null),
    ).rejects.toThrow(/CHECK/i);
  });

  it("#119 AC-2: 存在しないロール・利用者への割り当ては、外部キーで失敗する", async () => {
    const dept = await insertDepartment("部署A");
    const u = await insertUser("testuser_001", dept);
    await expect(
      insertAssignment(u, "role_not_exists", "company", null),
    ).rejects.toThrow(/FOREIGN KEY/i);
    await expect(
      insertAssignment(
        "01JNOUSER00000000000000000",
        ROLE_IDS.owner,
        "department",
        dept,
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("会社の設定（company_settings）は会社に1つ（2-1 AC-5・AC-9）", () => {
  it("#119 AC-2: id='company' の1件目は入り、2件目は失敗する", async () => {
    await env.DB.prepare(
      "INSERT INTO company_settings (id, company_name, created_at) VALUES ('company', ?, ?)",
    )
      .bind(`${TEST_TAG}テスト株式会社`, "2026-11-03T00:00:00.000Z")
      .run();
    await expect(
      env.DB.prepare(
        "INSERT INTO company_settings (id, company_name, created_at) VALUES ('company', ?, ?)",
      )
        .bind(`${TEST_TAG}別のテスト株式会社`, "2026-11-03T00:00:00.000Z")
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i);
    expect(await countRows("company_settings")).toBe(1);
  });

  it("#119 AC-2: id が 'company' 以外の行は、CHECK 制約で入らない", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO company_settings (id, company_name, created_at) VALUES ('other', ?, ?)",
      )
        .bind(`${TEST_TAG}テスト株式会社`, "2026-11-03T00:00:00.000Z")
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });
});

describe("部署・利用者の一意性（最後の守り）", () => {
  it("#119 AC-2: 部署名は大文字・小文字だけの違いも重複として入らない（name_normalized の一意。2-1 AC-12）", async () => {
    await insertDepartment("Sales");
    await expect(insertDepartment("SALES")).rejects.toThrow(/UNIQUE/i);
  });

  it("#119 AC-1: 社員IDは大文字・小文字を区別せず一意（login_id_normalized。0-1 AC-2）", async () => {
    const dept = await insertDepartment("部署A");
    await insertUser("testuser_001", dept);
    await expect(insertUser("TESTUSER_001", dept)).rejects.toThrow(/UNIQUE/i);
  });
});
