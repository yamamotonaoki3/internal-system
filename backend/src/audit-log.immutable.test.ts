// #156（0-6 AC-4）: 監査ログは、画面からも本番のコードからも、変更・削除されない（C-76・permissions.md R-16）。
// 削除の経路が後から入るのを検出するため、本番のコード（backend/src のテスト以外・backend/db/migrations・backend/db/scripts）を読み、
// audit_logs の DELETE・UPDATE・DROP・TRUNCATE と、.delete(auditLogs)・.update(auditLogs) がないことを確かめる。
// これは DB の振る舞いではなくコードの性質のため、静的に見る。テストの後始末（テストのファイル・backend/test・backend/db/seeds・e2e/seeds）は対象外
// （架空のテストデータを、識別子だけで消すため）。
// 注意：このテストが空振りしないよう、(1) 読んだファイルの数、(2) 検出の規則そのものが、悪い例を検出することも確かめる。
import { describe, expect, it } from "vitest";

const sources = import.meta.glob(
  [
    "./**/*.ts",
    "!./**/*.test.ts",
    "!./**/*.db.test.ts",
    "../db/migrations/*.sql",
    "../db/scripts/*",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  {
    name: "DELETE FROM audit_logs",
    pattern: /delete\s+from\s+["`[]?audit_logs/i,
  },
  { name: "UPDATE audit_logs", pattern: /update\s+["`[]?audit_logs/i },
  {
    name: "DROP TABLE audit_logs",
    pattern: /drop\s+table\s+(if\s+exists\s+)?["`[]?audit_logs/i,
  },
  {
    name: "TRUNCATE audit_logs",
    pattern: /truncate\s+(table\s+)?["`[]?audit_logs/i,
  },
  { name: ".delete(auditLogs)", pattern: /\.delete\(\s*auditLogs\s*\)/ },
  { name: ".update(auditLogs)", pattern: /\.update\(\s*auditLogs\s*\)/ },
];

const violations = (text: string) =>
  FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);

describe("#156 0-6 AC-4: 監査ログを消す・変える経路が、本番のコードにない（静的）", () => {
  it("#156 0-6 AC-4: 対象のファイルを読めている（本番のコードと migration を含み、空振りしていない）", () => {
    const paths = Object.keys(sources);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.some((p) => p.endsWith("/audit-log.repository.ts"))).toBe(
      true,
    );
    expect(paths.some((p) => p.includes("/db/migrations/0001_"))).toBe(true);
    expect(paths.some((p) => p.includes("/db/scripts/"))).toBe(true);
    expect(paths.filter((p) => p.endsWith(".test.ts"))).toEqual([]);
  });

  it("#156 0-6 AC-4: 検出の規則は、削除・更新・破棄の書き方（大文字・小文字・引用符・Drizzle）を検出する", () => {
    expect(violations("DELETE FROM audit_logs WHERE id = 1")).toEqual([
      "DELETE FROM audit_logs",
    ]);
    expect(violations('delete   from "audit_logs"')).toEqual([
      "DELETE FROM audit_logs",
    ]);
    expect(violations("UPDATE audit_logs SET result = 'x'")).toEqual([
      "UPDATE audit_logs",
    ]);
    expect(violations("DROP TABLE IF EXISTS `audit_logs`")).toEqual([
      "DROP TABLE audit_logs",
    ]);
    expect(violations("TRUNCATE TABLE audit_logs")).toEqual([
      "TRUNCATE audit_logs",
    ]);
    expect(violations("await db.delete(auditLogs).where(x)")).toEqual([
      ".delete(auditLogs)",
    ]);
    expect(violations("db.update( auditLogs ).set({})")).toEqual([
      ".update(auditLogs)",
    ]);
    // 読み取り・追加・索引の作成は検出しない
    expect(
      violations(
        "SELECT * FROM audit_logs; INSERT INTO audit_logs VALUES (1);",
      ),
    ).toEqual([]);
    expect(
      violations(
        "CREATE INDEX audit_logs_actor_occurred_idx ON audit_logs (actor_id);",
      ),
    ).toEqual([]);
    expect(violations("db.insert(auditLogs).values(row)")).toEqual([]);
  });

  it("#156 0-6 AC-4: 本番のコード・migration・データ修復のスクリプトに、audit_logs の DELETE・UPDATE・DROP・TRUNCATE はない", () => {
    const found = Object.entries(sources)
      .map(([path, text]) => ({ path, names: violations(text) }))
      .filter((entry) => entry.names.length > 0);
    expect(found).toEqual([]);
  });
});
