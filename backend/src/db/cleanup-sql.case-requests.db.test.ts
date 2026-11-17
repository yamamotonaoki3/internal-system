// #146（146-A）計画 A-10：共通のテストデータの削除（backend/db/seeds/cleanup.sql）が、案件の作成申請の3つの表
// （case_creation_request_candidates・case_creation_request_departments・case_creation_requests）を、外部キー違反にならない順で消すことを確かめる。
// 再申請の resubmitted_from（自己参照）があっても消せること、テストの利用者・部署・取引先が残らないこと（残数 0）を確かめる。
// 方法は cleanup-sql.thread.db.test.ts と同じ：cleanup.sql をコメント行を除いて文ごとに分け、1つの batch で隔離 D1 に流す。
// 失敗の確認：いまの cleanup.sql は申請の表を消さないため、利用者・部署・取引先の削除が外部キーで失敗する（Red）。
// データは架空（testuser_casereq_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import {
  cleanupCaseRequestTestData,
  insertCaseRequest,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

let w: CaseWorld;

function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((text) => text.trim().replace(/;$/, ""))
    .filter((text) => text.length > 0);
}

async function count(sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseRequestTestData();
});

describe("#146 計画 A-10 cleanup.sql と案件の作成申請", () => {
  it("#146 A-10: 申請・申請の部署・候補（再申請の自己参照を含む）を外部キーの順で消し、テストの利用者・部署・取引先と申請の行が残らない", async () => {
    const original = await insertCaseRequest({
      clientId: w.clientA.id,
      title: "[UNIT_TEST]元の申請",
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id, w.deptD.id],
      candidateIds: [w.memberD1.id],
      status: "withdrawn",
    });
    await insertCaseRequest({
      clientId: w.clientA.id,
      title: "[UNIT_TEST]再申請",
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      candidateIds: [w.ownerH.id],
      resubmittedFrom: original,
    });
    await env.DB.batch(
      statementsOf(cleanupSql).map((text) => env.DB.prepare(text)),
    );
    const testUsers =
      "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!'";
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM case_creation_requests WHERE requested_by IN (${testUsers}) OR title LIKE '[UNIT_TEST]%'`,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM case_creation_request_departments WHERE request_id NOT IN (SELECT id FROM case_creation_requests)",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM case_creation_request_candidates WHERE request_id NOT IN (SELECT id FROM case_creation_requests)",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM users WHERE login_id LIKE 'testuser!_casereq!_%' ESCAPE '!'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM departments WHERE name LIKE '[UNIT!_TEST]casereq%' ESCAPE '!'",
      ),
    ).toBe(0);
  });
});
