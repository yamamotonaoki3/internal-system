// #150（150-A）EP-5-11・EP-5-12（計画 150-A 6.7）：API の仕様書（docs/api/openapi.json）に、案件の終了・再開の契約が書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）と、Origin の 403・401 の記載は openapi.test.ts の全体の番人が確かめ、ここでは重ねない。
// 監査の操作の enum と AUDIT_ACTIONS の集合の一致も openapi.test.ts（#156）が確かめる。ここでは、終了・再開の操作が入っていることだけを確かめる。
// 期待値は計画 150-A 6.1：パスの caseId は ULID の形、本文なし、成功は 200 { caseId, status }、409 の reason は
//   終了が already_closed・stale・retry、再開が already_active・stale・retry。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { ULID_PATTERN } from "../../shared/ulid-rules";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  $ref?: string;
  allOf?: Schema[];
};
type Parameter = { name: string; in: string; schema?: Schema };
type Response = {
  description?: string;
  content?: Record<string, { schema?: Schema }>;
};
type Operation = {
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean };
  responses?: Record<string, Response>;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

const CLOSE = "/api/cases/{caseId}/close";
const REOPEN = "/api/cases/{caseId}/reopen";

const VALID_ULIDS = [
  "01JTESTCASE150A0000000001A",
  "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
];
const INVALID_ULIDS = [
  "81JTESTCASE150A0000000001A",
  "01JTESTCASE150A000000001A",
  "01JTESTCASE150A000000000I",
  "01jtestcase150a0000000001a",
];

function resolve(schema: Schema | undefined): Schema {
  if (schema === undefined) return {};
  if (schema.$ref !== undefined) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    return resolve(schemas[name]);
  }
  if (schema.allOf !== undefined) {
    const parts = schema.allOf.map(resolve);
    return {
      ...schema,
      properties: Object.assign({}, ...parts.map((p) => p.properties ?? {})),
      required: parts.flatMap((p) => p.required ?? []),
    };
  }
  return schema;
}

const OPERATIONS = [
  {
    name: "終了",
    path: CLOSE,
    status: "closed",
    reasons: ["already_closed", "stale", "retry"],
    other: "already_active",
  },
  {
    name: "再開",
    path: REOPEN,
    status: "active",
    reasons: ["already_active", "stale", "retry"],
    other: "already_closed",
  },
];

describe("#150 150-A API の仕様書：案件の終了・再開", () => {
  it.each(OPERATIONS)(
    "#150 EP-5-11・EP-5-12: $name（POST $path）の応答コード 200・401・403・404・409・422 が書かれ、本文は必須でない",
    ({ path }) => {
      const operation = paths[path]?.post;
      expect(operation, `POST ${path}`).toBeDefined();
      for (const code of ["200", "401", "403", "404", "409", "422"])
        expect(Object.keys(operation?.responses ?? {})).toContain(code);
      expect(operation?.requestBody?.required ?? false).toBe(false);
    },
  );

  it.each(OPERATIONS)(
    "#150 6.1: $name のパスの caseId の pattern は ULID_PATTERN と同じ判定",
    ({ path }) => {
      const parameter = paths[path]?.post?.parameters?.find(
        (p) => p.in === "path" && p.name === "caseId",
      );
      const pattern = resolve(parameter?.schema).pattern;
      expect(pattern).toBeDefined();
      const re = new RegExp(pattern ?? "");
      for (const sample of VALID_ULIDS) {
        expect(ULID_PATTERN.test(sample), sample).toBe(true);
        expect(re.test(sample), sample).toBe(true);
      }
      for (const sample of INVALID_ULIDS) {
        expect(ULID_PATTERN.test(sample), sample).toBe(false);
        expect(re.test(sample), sample).toBe(false);
      }
    },
  );

  it.each(OPERATIONS)(
    "#150 6.1: $name の 200 の本文は caseId（ULID の形）と status（$status）を必須で持ち、closedAt・reopenedAt を持たない",
    ({ path, status }) => {
      const body = resolve(
        paths[path]?.post?.responses?.["200"]?.content?.["application/json"]
          ?.schema,
      );
      expect(body.required).toEqual(
        expect.arrayContaining(["caseId", "status"]),
      );
      const statusSchema = resolve(body.properties?.status);
      const values = statusSchema.enum ?? [statusSchema.const];
      expect(values).toContain(status);
      expect(
        new RegExp(resolve(body.properties?.caseId).pattern ?? "^$").test(
          VALID_ULIDS[0] ?? "",
        ),
      ).toBe(true);
      expect(Object.keys(body.properties ?? {})).not.toContain("closedAt");
      expect(Object.keys(body.properties ?? {})).not.toContain("reopenedAt");
    },
  );

  it.each(OPERATIONS)(
    "#150 6.1・6.7: $name の 409 に、reason（$reasons）が書かれ、もう一方の状態の reason は書かれない",
    ({ path, reasons, other }) => {
      const conflict = JSON.stringify(paths[path]?.post?.responses?.["409"]);
      for (const reason of reasons) expect(conflict).toContain(reason);
      expect(conflict).not.toContain(other);
    },
  );

  it("#150 5-1 AC-13: 監査ログの操作の enum（検索・一覧の項目）に case.close・case.reopen がある", () => {
    for (const name of ["AuditLogSearch", "AuditLogItem"]) {
      const action = resolve(schemas[name]?.properties?.action);
      expect(action.enum, name).toEqual(
        expect.arrayContaining(["case.close", "case.reopen"]),
      );
    }
  });
});
