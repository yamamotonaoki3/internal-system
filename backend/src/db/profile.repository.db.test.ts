// #130 AC-1（0-4 AC-6）・AC-2（6-1 AC-3）・AC-3（7-3 AC-1・AC-3）・既存データ：migration 0013（users のステータスの列）と、
// プロフィールの Repository が使う表の形を、隔離 D1 で確かめる。期待値は計画 1章（DB）から決める：
//  - status_kind text NOT NULL DEFAULT 'available'、5値の CHECK
//  - status_return_at・status_message・status_updated_at・status_updated_by（users.id への外部キー）は NULL 可
//  - インデックス users_directory_idx (department_id, display_name, id)・users_display_name_idx (display_name, id)
// 一覧の絞り込み・並び・カーソル、代理設定と監査の原子性は、Repository の関数の形に依存しないよう、実際のアプリ入口から確かめる
// （routes/users.test.ts・routes/me.profile.test.ts。ここでは、一覧の SQL がインデックスを使うことを EXPLAIN で確かめる）。
// データは架空（testuser_prof_db_・テスト太郎・@example.com・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
  testId,
} from "../../test/role-fixtures";

afterEach(async () => {
  await env.DB.prepare(
    "UPDATE users SET status_updated_by = NULL WHERE login_id LIKE 'testuser!_prof!_db!_%' ESCAPE '!'",
  )
    .run()
    .catch((error: unknown) => {
      // migration 0013 の前（列がない）だけは、外す対象がない。それ以外の失敗は伝える
      if (!String(error).includes("status_updated_by")) throw error;
    });
  await cleanupRoleTestData();
});

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
};

async function usersColumns() {
  const { results } = await env.DB.prepare(
    "PRAGMA table_info(users)",
  ).all<ColumnInfo>();
  return new Map(results.map((column) => [column.name, column]));
}

async function statusOf(userId: string) {
  return env.DB.prepare(
    "SELECT status_kind, status_return_at, status_message, status_updated_at, status_updated_by FROM users WHERE id = ?",
  )
    .bind(userId)
    .first();
}

describe("#130 migration 0013：users のステータスの列", () => {
  it("#130 AC-2（6-1 AC-3）: status_kind は NOT NULL・既定値 available", async () => {
    const column = (await usersColumns()).get("status_kind");
    expect(column).toBeDefined();
    expect(column?.type.toLowerCase()).toBe("text");
    expect(column?.notnull).toBe(1);
    expect(column?.dflt_value?.replace(/['"]/g, "")).toBe("available");
  });

  it.each([
    "status_return_at",
    "status_message",
    "status_updated_at",
    "status_updated_by",
  ])("#130 AC-1（0-4 AC-1・AC-6）: %s は NULL 可の text", async (name) => {
    const column = (await usersColumns()).get(name);
    expect(column).toBeDefined();
    expect(column?.type.toLowerCase()).toBe("text");
    expect(column?.notnull).toBe(0);
  });

  it("#130 AC-1（0-4 AC-6）: status_updated_by は users.id を参照する", async () => {
    const { results } = await env.DB.prepare(
      "PRAGMA foreign_key_list(users)",
    ).all<{ table: string; from: string; to: string }>();
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "users",
          from: "status_updated_by",
          to: "id",
        }),
      ]),
    );
  });

  it("#130 既存データ: 既存の INSERT（ステータスの列を書かない形）がそのまま通り、在席・戻り予定なし・一言なしで読める", async () => {
    const id = await insertUser(
      "testuser_prof_db_legacy",
      await insertDepartment("プロフDB既存"),
    );
    expect(await statusOf(id)).toEqual({
      status_kind: "available",
      status_return_at: null,
      status_message: null,
      status_updated_at: null,
      status_updated_by: null,
    });
  });

  it.each(["available", "away", "absent", "vacation", "meeting"])(
    "#130 AC-2（6-1 AC-3）: %s は保存できる",
    async (kind) => {
      const id = await insertUser(
        `testuser_prof_db_${kind}`,
        await insertDepartment(`プロフDB${kind}`),
      );
      await env.DB.prepare("UPDATE users SET status_kind = ? WHERE id = ?")
        .bind(kind, id)
        .run();
      expect((await statusOf(id))?.status_kind).toBe(kind);
    },
  );

  it.each(["busy", "", "Available"])(
    "#130 AC-2（6-1 AC-3）: 6種類目（%j）は DB の CHECK でも拒否する",
    async (kind) => {
      const id = await insertUser(
        "testuser_prof_db_check",
        await insertDepartment("プロフDB検査"),
      );
      await expect(
        env.DB.prepare("UPDATE users SET status_kind = ? WHERE id = ?")
          .bind(kind, id)
          .run(),
      ).rejects.toThrow(/CHECK/i);
      expect((await statusOf(id))?.status_kind).toBe("available");
    },
  );

  it("#130 AC-2（6-1 AC-3）: NULL も拒否する", async () => {
    const id = await insertUser(
      "testuser_prof_db_null",
      await insertDepartment("プロフDB空"),
    );
    await expect(
      env.DB.prepare("UPDATE users SET status_kind = NULL WHERE id = ?")
        .bind(id)
        .run(),
    ).rejects.toThrow(/NOT NULL/i);
  });

  it("#130 AC-1（0-4 AC-6）: status_updated_by に存在しない利用者は入れられない（外部キー）", async () => {
    const id = await insertUser(
      "testuser_prof_db_fk",
      await insertDepartment("プロフDB外部キー"),
    );
    await expect(
      env.DB.prepare("UPDATE users SET status_updated_by = ? WHERE id = ?")
        .bind(testId("NOUSER"), id)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("#130 AC-3（7-3 AC-1・AC-3）一覧のインデックス", () => {
  async function indexColumns(name: string) {
    const { results } = await env.DB.prepare(`PRAGMA index_info(${name})`).all<{
      seqno: number;
      name: string;
    }>();
    return results.sort((a, b) => a.seqno - b.seqno).map((row) => row.name);
  }

  it("#130 AC-3（7-3 AC-3）: users_directory_idx は (department_id, display_name, id)", async () => {
    expect(await indexColumns("users_directory_idx")).toEqual([
      "department_id",
      "display_name",
      "id",
    ]);
  });

  it("#130 AC-3（7-3 AC-1）: users_display_name_idx は (display_name, id)", async () => {
    expect(await indexColumns("users_display_name_idx")).toEqual([
      "display_name",
      "id",
    ]);
  });

  it("#130 AC-3（7-3 AC-3）: 部署で絞った一覧（表示名・IDの順、カーソルより後）は users_directory_idx を使う", async () => {
    const { results } = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM users
       WHERE is_active = 1 AND department_id = ? AND (display_name > ? OR (display_name = ? AND id > ?))
       ORDER BY display_name, id LIMIT 21`,
    )
      .bind(testId("DEPT"), "テスト太郎", "テスト太郎", testId("USER"))
      .all<{ detail: string }>();
    expect(results.map((row) => row.detail).join("\n")).toContain(
      "users_directory_idx",
    );
  });
});

describe("#130 既存データ", () => {
  it("#130 既存データ: 既存の利用者の行は、すべて在席・戻り予定なしで読める（NULL の status_kind がない）", async () => {
    await insertUser(
      "testuser_prof_db_any",
      await insertDepartment("プロフDB全体"),
    );
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE status_kind IS NULL OR status_kind NOT IN ('available','away','absent','vacation','meeting')",
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
