// #150（150-C）EP-5-20（計画 150-C 5章・6章「契約」）：API の仕様書（docs/api/openapi.json）に、案件の再編集の契約が書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）と、Origin の 403・401 の記載は openapi.test.ts の全体の番人が確かめ、ここでは重ねない。
// 期待値は計画 150-C 4.2：PATCH /api/cases/{caseId} の本文は strict で、変える項目 title・description・clientId・departmentIds（1件以上・重複なし）と、
//   衝突の検知の version（整数・1以上）か expected（{ title, clientId, departmentIds }）。caseNumber・dueDate は持たない。
//   成功は 200 { caseId, titleFormatted }（説明・版を持たない）。409 の reason は closed・stale・retry。
//   詳細（CaseDetail）は version を必須の整数で持ち、概要（CaseSummary）は version を持たない（重大4）。
//   監査の操作の enum に case.edit。類似件名の確認 GET /api/case-requests/similar-title に任意のクエリ excludeCaseId（ULID）。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { ULID_PATTERN } from "../../shared/ulid-rules";

type Schema = {
  type?: string | string[];
  items?: Schema;
  minItems?: number;
  minimum?: number;
  uniqueItems?: boolean;
  additionalProperties?: boolean | Schema;
  enum?: unknown[];
  pattern?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
};
type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
};
type Response = {
  description?: string;
  content?: Record<string, { schema?: Schema }>;
};
type Operation = {
  parameters?: Parameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Schema }>;
  };
  responses?: Record<string, Response>;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

const CASE = "/api/cases/{caseId}";
const SIMILAR = "/api/case-requests/similar-title";
const VALID_ULID = "01JTESTCASE150C0000000001A";
const INVALID_ULIDS = [
  "81JTESTCASE150C0000000001A",
  "01JTESTCASE150C000000001A",
  "01jtestcase150c0000000001a",
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

/** 本文の schema の全体（oneOf・anyOf の枝も含めて）の項目名 */
function allPropertyNames(schema: Schema): string[] {
  const own = Object.keys(schema.properties ?? {});
  const branches = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].map(
    (branch) => allPropertyNames(resolve(branch)),
  );
  return [...new Set([...own, ...branches.flat()])];
}

function propertyOf(schema: Schema, name: string): Schema {
  if (schema.properties?.[name] !== undefined)
    return resolve(schema.properties[name]);
  for (const branch of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
    const found = propertyOf(resolve(branch), name);
    if (Object.keys(found).length > 0) return found;
  }
  return {};
}

const editBody = () =>
  resolve(
    paths[CASE]?.patch?.requestBody?.content?.["application/json"]?.schema,
  );

describe("#150 150-C API の仕様書：案件の再編集（PATCH /api/cases/{caseId}）", () => {
  it("#150 EP-5-20: PATCH があり、応答コード 200・401・403・404・409・422 が書かれる", () => {
    const operation = paths[CASE]?.patch;
    expect(operation, `PATCH ${CASE}`).toBeDefined();
    for (const code of ["200", "401", "403", "404", "409", "422"])
      expect(Object.keys(operation?.responses ?? {})).toContain(code);
  });

  it("#150 4.2: パスの caseId の pattern は ULID_PATTERN と同じ判定", () => {
    const parameter = paths[CASE]?.patch?.parameters?.find(
      (p) => p.in === "path" && p.name === "caseId",
    );
    const re = new RegExp(resolve(parameter?.schema).pattern ?? "^$");
    expect(ULID_PATTERN.test(VALID_ULID)).toBe(true);
    expect(re.test(VALID_ULID)).toBe(true);
    for (const sample of INVALID_ULIDS)
      expect(re.test(sample), sample).toBe(false);
  });

  it("#150 4.2・Q2＝A: 本文は必須で、項目は title・description・clientId・departmentIds・version・expected だけ（caseNumber・dueDate を持たない）", () => {
    expect(paths[CASE]?.patch?.requestBody?.required).toBe(true);
    expect(allPropertyNames(editBody()).sort()).toEqual(
      [
        "clientId",
        "departmentIds",
        "description",
        "expected",
        "title",
        "version",
      ].sort(),
    );
  });

  it("#150 4.2: 本文は余分な項目を許さない（strict）", () => {
    const body = editBody();
    const branches = [...(body.oneOf ?? []), ...(body.anyOf ?? [])].map(
      resolve,
    );
    for (const schema of branches.length > 0 ? branches : [body])
      expect(schema.additionalProperties).toBe(false);
  });

  it("#150 4.2・C-130(1): departmentIds は ULID の配列で、1件以上・重複なし。clientId は ULID", () => {
    const departments = propertyOf(editBody(), "departmentIds");
    expect(departments.type).toBe("array");
    expect(departments.minItems).toBe(1);
    expect(departments.uniqueItems).toBe(true);
    const item = new RegExp(resolve(departments.items).pattern ?? "^$");
    expect(item.test(VALID_ULID)).toBe(true);
    const client = new RegExp(
      propertyOf(editBody(), "clientId").pattern ?? "^$",
    );
    expect(client.test(VALID_ULID)).toBe(true);
    for (const sample of INVALID_ULIDS)
      expect(client.test(sample), sample).toBe(false);
  });

  it("#150 Q3＝C: version は整数で 1 以上、expected は title・clientId・departmentIds を必須で持つ", () => {
    const version = propertyOf(editBody(), "version");
    expect(version.type).toBe("integer");
    expect(version.minimum).toBe(1);
    const expected = propertyOf(editBody(), "expected");
    expect([...(expected.required ?? [])].sort()).toEqual(
      ["clientId", "departmentIds", "title"].sort(),
    );
  });

  it("#150 4.2: 200 の本文は caseId と titleFormatted（真偽）を必須で持ち、description・version を持たない", () => {
    const body = resolve(
      paths[CASE]?.patch?.responses?.["200"]?.content?.["application/json"]
        ?.schema,
    );
    expect([...(body.required ?? [])].sort()).toEqual(
      ["caseId", "titleFormatted"].sort(),
    );
    expect(resolve(body.properties?.titleFormatted).type).toBe("boolean");
    expect(Object.keys(body.properties ?? {})).not.toContain("description");
    expect(Object.keys(body.properties ?? {})).not.toContain("version");
  });

  it("#150 4.2: 409 に reason の closed・stale・retry が書かれる", () => {
    const conflict = JSON.stringify(paths[CASE]?.patch?.responses?.["409"]);
    for (const reason of ["closed", "stale", "retry"])
      expect(conflict).toContain(reason);
  });

  it("#150 4.2.1・重大4: CaseDetail は version を必須の整数で持ち、CaseSummary は version を持たない", () => {
    const detail = resolve(schemas.CaseDetail);
    expect(detail.required).toContain("version");
    expect(resolve(detail.properties?.version).type).toBe("integer");
    const summary = resolve(schemas.CaseSummary);
    expect(Object.keys(summary.properties ?? {})).not.toContain("version");
    expect(summary.required ?? []).not.toContain("version");
  });

  it("#150 5-1 AC-20: 監査ログの操作の enum（検索・一覧の項目）に case.edit がある", () => {
    for (const name of ["AuditLogSearch", "AuditLogItem"]) {
      const action = resolve(schemas[name]?.properties?.action);
      expect(action.enum, name).toContain("case.edit");
    }
  });

  it("#150 C-122(6)・4.5: 類似件名の確認に、任意のクエリ excludeCaseId（ULID）がある", () => {
    const parameter = paths[SIMILAR]?.get?.parameters?.find(
      (p) => p.in === "query" && p.name === "excludeCaseId",
    );
    expect(parameter).toBeDefined();
    expect(parameter?.required ?? false).toBe(false);
    const re = new RegExp(resolve(parameter?.schema).pattern ?? "^$");
    expect(re.test(VALID_ULID)).toBe(true);
    for (const sample of INVALID_ULIDS)
      expect(re.test(sample), sample).toBe(false);
  });
});
