// #146（146-A）計画 A-1：案件の作成申請の3つの表の形と制約を、マイグレーション済みの D1 に直接書いて確かめる。
// 期待値は計画 A-1 の CHECK・PK・索引から決める（approved・rejected は 146-B で使うが、CHECK は A で入れる）。
// D1 では PRAGMA を使わない。表・索引は sqlite_master、列は raw({ columnNames: true }) で読む。
// データは架空（testuser_casereq_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CASEREQ_NOW,
  cleanupCaseRequestTestData,
  insertCaseRequest,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

let w: CaseWorld;

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseRequestTestData();
});

async function columnsOf(table: string): Promise<string[]> {
  const [names] = await env.DB.prepare(`SELECT * FROM ${table} LIMIT 0`).raw({
    columnNames: true,
  });
  return (names ?? []).map(String).sort();
}

type Row = {
  id: string;
  status: string;
  version?: number;
  decided_by?: string | null;
  decision_reason?: string | null;
  case_id?: string | null;
  decided_at?: string | null;
  due_date?: string | null;
};

/** 申請の行を1件、指定の列で直接入れる（制約の確認用。既定は有効な pending） */
function insertRaw(row: Row) {
  return env.DB.prepare(
    `INSERT INTO case_creation_requests (id, client_id, title, description, due_date, requested_by, status, version,
       decided_by, decision_reason, case_id, resubmitted_from, requested_at, decided_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      row.id,
      w.clientA.id,
      "[UNIT_TEST]制約",
      row.due_date ?? null,
      w.memberS1.id,
      row.status,
      row.version ?? 1,
      row.decided_by ?? null,
      row.decision_reason ?? null,
      row.case_id ?? null,
      CASEREQ_NOW,
      row.decided_at ?? null,
    )
    .run();
}

const ID = (n: number) => `01JTESTCASEREQSCHEMA${String(n).padStart(6, "0")}`;

describe("#146 計画 A-1 表と列", () => {
  it("#146 A-1: 3つの表が決めた列を持つ", async () => {
    expect(await columnsOf("case_creation_requests")).toEqual(
      [
        "id",
        "client_id",
        "title",
        "description",
        "due_date",
        "requested_by",
        "status",
        "version",
        "decided_by",
        "decision_reason",
        "case_id",
        "resubmitted_from",
        "requested_at",
        "decided_at",
      ].sort(),
    );
    expect(await columnsOf("case_creation_request_departments")).toEqual(
      ["department_id", "request_id"].sort(),
    );
    expect(await columnsOf("case_creation_request_candidates")).toEqual(
      ["added_at", "added_by", "request_id", "user_id"].sort(),
    );
  });

  it("#146 A-1: 既定値は status = pending・version = 1・description = 空", async () => {
    await env.DB.prepare(
      "INSERT INTO case_creation_requests (id, client_id, title, requested_by, requested_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(ID(1), w.clientA.id, "[UNIT_TEST]既定", w.memberS1.id, CASEREQ_NOW)
      .run();
    const row = await env.DB.prepare(
      "SELECT status, version, description FROM case_creation_requests WHERE id = ?",
    )
      .bind(ID(1))
      .first<{ status: string; version: number; description: string }>();
    expect(row).toEqual({ status: "pending", version: 1, description: "" });
  });

  it("#146 A-1: client_id・title・requested_by・version は NOT NULL", async () => {
    const insert = (column: string) =>
      env.DB.prepare(
        `INSERT INTO case_creation_requests (id, client_id, title, requested_by, version, requested_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          ID(2),
          column === "client_id" ? null : w.clientA.id,
          column === "title" ? null : "[UNIT_TEST]NULL",
          column === "requested_by" ? null : w.memberS1.id,
          column === "version" ? null : 1,
          CASEREQ_NOW,
        )
        .run();
    for (const column of ["client_id", "title", "requested_by", "version"])
      await expect(insert(column), column).rejects.toThrow(/NOT NULL/i);
  });
});

describe("#146 計画 A-1 CHECK", () => {
  it.each(["pending", "approved", "rejected", "withdrawn", "auto_cancelled"])(
    "#146 A-1: status = %s は入る（必要な列を満たすとき）",
    async (status) => {
      const decided = status !== "pending";
      await expect(
        insertRaw({
          id: ID(10),
          status,
          decided_by: decided ? w.ownerS.id : null,
          decided_at: decided ? CASEREQ_NOW : null,
          decision_reason: status === "rejected" ? "理由" : null,
          case_id: status === "approved" ? "01JTESTCASEREQCASE0000001" : null,
        }),
      ).resolves.toBeDefined();
    },
  );

  it("#146 A-1・5-3 AC-8: 決めた5つ以外の status は入らない", async () => {
    await expect(
      insertRaw({
        id: ID(11),
        status: "cancelled",
        decided_by: w.ownerS.id,
        decided_at: CASEREQ_NOW,
      }),
    ).rejects.toThrow(/CHECK/i);
  });

  it("#146 A-1: rejected で理由がなければ入らない", async () => {
    await expect(
      insertRaw({
        id: ID(12),
        status: "rejected",
        decided_by: w.ownerS.id,
        decided_at: CASEREQ_NOW,
      }),
    ).rejects.toThrow(/CHECK/i);
  });

  it("#146 A-1: approved で case_id がなければ入らない", async () => {
    await expect(
      insertRaw({
        id: ID(13),
        status: "approved",
        decided_by: w.ownerS.id,
        decided_at: CASEREQ_NOW,
      }),
    ).rejects.toThrow(/CHECK/i);
  });

  it.each([
    ["decided_at がない", { decided_by: "OWNER", decided_at: null }],
    ["decided_by がない", { decided_by: null, decided_at: CASEREQ_NOW }],
  ])(
    "#146 A-1: pending 以外（withdrawn）で %s なら入らない",
    async (_label, cols) => {
      await expect(
        insertRaw({
          id: ID(14),
          status: "withdrawn",
          decided_by: cols.decided_by === "OWNER" ? w.ownerS.id : null,
          decided_at: cols.decided_at,
        }),
      ).rejects.toThrow(/CHECK/i);
    },
  );

  it.each(["2026-11-17", null])(
    "#146 A-1: due_date = %s は入る",
    async (due) => {
      await expect(
        insertRaw({ id: ID(15), status: "pending", due_date: due }),
      ).resolves.toBeDefined();
    },
  );

  it.each(["2026/11/17", "2026-1-17", "20261117", "abcd-ef-gh", ""])(
    "#146 A-1: due_date = %s は形が違うので入らない",
    async (due) => {
      await expect(
        insertRaw({ id: ID(16), status: "pending", due_date: due }),
      ).rejects.toThrow(/CHECK/i);
    },
  );
});

describe("#146 計画 A-1 主キーと索引", () => {
  it("#146 A-1: 申請の部署は (request_id, department_id) が主キーで、同じ組の2行目は入らない", async () => {
    const id = await insertCaseRequest({
      clientId: w.clientA.id,
      title: "[UNIT_TEST]PK部署",
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
    });
    await expect(
      env.DB.prepare(
        "INSERT INTO case_creation_request_departments (request_id, department_id) VALUES (?, ?)",
      )
        .bind(id, w.deptS.id)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i);
  });

  it("#146 A-1: 候補は (request_id, user_id) が主キーで、同じ組の2行目は入らない", async () => {
    const id = await insertCaseRequest({
      clientId: w.clientA.id,
      title: "[UNIT_TEST]PK候補",
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      candidateIds: [w.memberD1.id],
    });
    await expect(
      env.DB.prepare(
        "INSERT INTO case_creation_request_candidates (request_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)",
      )
        .bind(id, w.memberD1.id, w.ownerS.id, CASEREQ_NOW)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i);
  });

  it("#146 A-1: 索引 (requested_by, id)・(status, id)・(client_id, title)、申請の部署の department_id がある", async () => {
    const { results } = await env.DB.prepare(
      "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name LIKE 'case_creation_request%'",
    ).all<{ tbl_name: string; sql: string }>();
    const columnsOfIndex = results.map((r) => ({
      table: r.tbl_name,
      columns: (/\(([^)]*)\)\s*$/.exec(r.sql)?.[1] ?? "")
        .replace(/[`"\s]/g, "")
        .split(","),
    }));
    const has = (table: string, columns: string[]) =>
      columnsOfIndex.some(
        (index) =>
          index.table === table &&
          index.columns.join(",") === columns.join(","),
      );
    expect(has("case_creation_requests", ["requested_by", "id"])).toBe(true);
    expect(has("case_creation_requests", ["status", "id"])).toBe(true);
    expect(has("case_creation_requests", ["client_id", "title"])).toBe(true);
    expect(has("case_creation_request_departments", ["department_id"])).toBe(
      true,
    );
  });
});
