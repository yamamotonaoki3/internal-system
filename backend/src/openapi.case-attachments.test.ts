// #148（148-B-1）EP-5-19、計画 148-B-1「API」：API の仕様書（docs/api/openapi.json）に、案件の添付の一覧の契約が書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）と、Origin の 403・401 の記載は openapi.test.ts の全体の番人が確かめ、ここでは重ねない
// （ルートは caseRoutes の中に置く計画なので、番人の自前のルートの一覧〔/api/cases の caseRoutes()〕で突き合わせの対象になる）。
// ID の pattern は shared/ulid-rules.ts の ULID_PATTERN と同じ判定であること（先例：openapi.case-todos.test.ts）。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { ULID_PATTERN } from "../../shared/ulid-rules";

type Schema = {
  type?: string | string[];
  pattern?: string;
  maximum?: number;
  minimum?: number;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
};
type Parameter = { name: string; in: string; schema?: Schema };
type Operation = {
  parameters?: Parameter[];
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

const ATTACHMENTS = "/api/cases/{caseId}/attachments";

const VALID_ULIDS = [
  "01JTESTCASE148B00000000001",
  "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
];
const INVALID_ULIDS = [
  "81JTESTCASE148B00000000001",
  "01JTESTCASE148B0000000001",
  "01JTESTCASE148B0000000000I",
  "01JTESTCASE148B0000000000U",
  "01jtestcase148b00000000001",
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
const allowsNull = (schema: Schema) => JSON.stringify(schema).includes("null");

function expectUlidPattern(where: string, pattern: string | undefined) {
  expect(pattern, where).toBeDefined();
  const re = new RegExp(pattern ?? "");
  for (const sample of VALID_ULIDS) {
    expect(ULID_PATTERN.test(sample), sample).toBe(true);
    expect(re.test(sample), `${where} ${sample}`).toBe(true);
  }
  for (const sample of INVALID_ULIDS) {
    expect(ULID_PATTERN.test(sample), sample).toBe(false);
    expect(re.test(sample), `${where} ${sample}`).toBe(false);
  }
}

const operation = () => paths[ATTACHMENTS]?.get;
const page = () =>
  resolve(
    operation()?.responses?.["200"]?.content?.["application/json"]?.schema,
  );
const item = () => resolve(resolve(page().properties?.items).items);

describe("#148 148-B-1 API の仕様書：案件の添付の一覧（EP-5-19）", () => {
  it("#148 AC-7: GET /api/cases/{caseId}/attachments の応答コード 200・401・403・404・422 が書かれている", () => {
    expect(operation(), `get ${ATTACHMENTS}`).toBeDefined();
    for (const code of ["200", "401", "403", "404", "422"])
      expect(Object.keys(operation()?.responses ?? {})).toContain(code);
  });

  it("#148 AC-7: パスの caseId の pattern は ULID_PATTERN と同じ判定", () => {
    const caseId = (operation()?.parameters ?? []).find(
      (p) => p.in === "path" && p.name === "caseId",
    );
    expectUlidPattern("caseId", resolve(caseId?.schema).pattern);
  });

  it("#148 AC-7 計画「API」: クエリ limit は最小 1・最大 100・既定 50、cursor がある", () => {
    const parameters = operation()?.parameters ?? [];
    const limit = parameters.find(
      (p) => p.in === "query" && p.name === "limit",
    );
    expect(limit).toBeDefined();
    expect(resolve(limit?.schema).minimum).toBe(1);
    expect(resolve(limit?.schema).maximum).toBe(100);
    expect(resolve(limit?.schema).default).toBe(50);
    expect(
      parameters.some((p) => p.in === "query" && p.name === "cursor"),
    ).toBe(true);
  });

  it("#148 AC-7 決定 Q5: 応答は items・nextCursor。項目は id・name・kind・contentType・size・uploadedAt・messageId・threadParentId・uploader", () => {
    expect(page().required).toEqual(
      expect.arrayContaining(["items", "nextCursor"]),
    );
    expect(allowsNull(resolve(page().properties?.nextCursor))).toBe(true);
    const keys = [
      "id",
      "name",
      "kind",
      "contentType",
      "size",
      "uploadedAt",
      "messageId",
      "threadParentId",
      "uploader",
    ];
    expect(item().required).toEqual(expect.arrayContaining(keys));
    expect(Object.keys(item().properties ?? {}).sort()).toEqual(
      [...keys].sort(),
    );
    expect(allowsNull(resolve(item().properties?.threadParentId))).toBe(true);
    expect(resolve(item().properties?.size).type).toBe("integer");
  });

  it("#148 AC-7: 項目の id・messageId・threadParentId・uploader.id の pattern は ULID_PATTERN と同じ判定", () => {
    const props = item().properties ?? {};
    expectUlidPattern("id", resolve(props.id).pattern);
    expectUlidPattern("messageId", resolve(props.messageId).pattern);
    const parent = resolve(props.threadParentId);
    const parentPattern =
      parent.pattern ??
      [...(parent.oneOf ?? []), ...(parent.anyOf ?? [])]
        .map(resolve)
        .find((s) => s.pattern !== undefined)?.pattern;
    expectUlidPattern("threadParentId", parentPattern);
    const uploader = resolve(props.uploader);
    expect(uploader.required).toEqual(
      expect.arrayContaining(["id", "displayName", "isActive"]),
    );
    expect(Object.keys(uploader.properties ?? {}).sort()).toEqual([
      "displayName",
      "id",
      "isActive",
    ]);
    expectUlidPattern("uploader.id", resolve(uploader.properties?.id).pattern);
  });
});
