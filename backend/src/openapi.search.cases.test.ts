// #155（155-C）A-2：API の仕様書（docs/api/openapi.json）に、EP-4-02 GET /api/search/cases の契約が書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）は openapi.test.ts の全体の番人が確かめ、ここでは重ねない。
// 期待は計画 5章：クエリ q（必須。100文字まで・NUL を許さない）・limit・cursor（任意）。200 は { items, nextCursor }（総件数を持たない）。
//   行の項目は id・caseNumber・title・status（active | closed）・client（id・name・isActive）・departments（id・name・isActive の配列）・
//   dueDate（null を許す）・progress（done・total。null を許す）・isParticipant・matchedIn（title | caseNumber | client の配列。1つ以上）。
//   参加者だけの項目（説明・参加者・参加者数・管理の資格・部屋の ID・最終更新・版）は持たない。エラーは 401・403・422。429 は書かない。
// 検証は項目ごとに別の事例にする（1つの事例が落ちても、ほかの項目の誤りが隠れない）。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";

type Schema = {
  type?: string | string[];
  enum?: string[];
  minItems?: number;
  nullable?: boolean;
  items?: Schema;
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
  schema?: { maxLength?: number; pattern?: string; $ref?: string };
};
type Operation = {
  parameters?: Parameter[];
  responses?: Record<
    string,
    { content?: Record<string, { schema?: Schema }> } | { $ref: string }
  >;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

function resolve(schema: Schema | undefined): Schema {
  if (schema === undefined) return {};
  if (schema.$ref !== undefined)
    return resolve(schemas[schema.$ref.replace("#/components/schemas/", "")]);
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

/** null を許すか（OpenAPI 3.1 の type の配列・3.0 の nullable・oneOf/anyOf の null のどれでもよい） */
function allowsNull(schema: Schema): boolean {
  if (Array.isArray(schema.type)) return schema.type.includes("null");
  if (schema.nullable === true) return true;
  const alternatives = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].map(
    resolve,
  );
  return alternatives.some(
    (alt) =>
      alt.type === "null" ||
      (Array.isArray(alt.type) && alt.type.includes("null")),
  );
}

/** null 以外の形（oneOf/anyOf のときは null でない方） */
function nonNull(schema: Schema): Schema {
  const alternatives = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].map(
    resolve,
  );
  const found = alternatives.find((alt) => alt.type !== "null");
  return found ?? schema;
}

const operation = () => {
  const op = paths["/api/search/cases"]?.get;
  if (op === undefined)
    throw new Error("GET /api/search/cases が仕様書にありません");
  return op;
};

function itemSchema(): Schema {
  const response = operation().responses?.["200"] as
    { content?: Record<string, { schema?: Schema }> } | undefined;
  const body = resolve(response?.content?.["application/json"]?.schema);
  return resolve(body.properties?.items?.items);
}

describe("#155 4-2 AC-1 155-C A-2 EP-4-02 の仕様書", () => {
  it("#155 A-2: クエリは q（必須）と、limit・cursor（任意）だけ", () => {
    const params = (operation().parameters ?? []).filter(
      (p) => p.in === "query",
    );
    const byName = new Map(params.map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(["cursor", "limit", "q"]);
    expect(byName.get("q")?.required).toBe(true);
    expect(byName.get("limit")?.required ?? false).toBe(false);
    expect(byName.get("cursor")?.required ?? false).toBe(false);
  });

  it("#155 A-2: q は100文字まで、NUL を含む語を許さない（パターン）", () => {
    const q = (operation().parameters ?? []).find(
      (p) => p.in === "query" && p.name === "q",
    );
    expect(q?.schema?.maxLength).toBe(100);
    const pattern = new RegExp(q?.schema?.pattern ?? "", "u");
    for (const good of ["若草会館", "a", "QZA-2611", "this AND that"])
      expect({ value: good, ok: pattern.test(good) }).toEqual({
        value: good,
        ok: true,
      });
    for (const bad of ["\u0000若草", "若\u0000草", "若草\u0000"])
      expect({ value: JSON.stringify(bad), ok: pattern.test(bad) }).toEqual({
        value: JSON.stringify(bad),
        ok: false,
      });
  });

  it("#155 A-2: 200 は items と nextCursor だけ（総件数を持たない）", () => {
    const response = operation().responses?.["200"] as
      { content?: Record<string, { schema?: Schema }> } | undefined;
    const body = resolve(response?.content?.["application/json"]?.schema);
    expect(Object.keys(body.properties ?? {}).sort()).toEqual([
      "items",
      "nextCursor",
    ]);
  });

  it("#155 4-2 AC-2 A-2: 行の項目は検索の結果の項目だけで、すべて必須（参加者だけの項目を持たない）", () => {
    const item = itemSchema();
    const expected = [
      "caseNumber",
      "client",
      "departments",
      "dueDate",
      "id",
      "isParticipant",
      "matchedIn",
      "progress",
      "status",
      "title",
    ];
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(expected);
    expect([...(item.required ?? [])].sort()).toEqual(expected);
  });

  it("#155 A-2: status は active・closed の列挙", () => {
    const status = resolve(itemSchema().properties?.status);
    expect([...(status.enum ?? [])].sort()).toEqual(["active", "closed"]);
  });

  it("#155 A-2: matchedIn は title・caseNumber・client の列挙の配列で、1つ以上", () => {
    const matchedIn = resolve(itemSchema().properties?.matchedIn);
    expect(matchedIn.type).toBe("array");
    expect(matchedIn.minItems).toBe(1);
    expect([...(resolve(matchedIn.items).enum ?? [])].sort()).toEqual(
      ["caseNumber", "client", "title"].sort(),
    );
  });

  it("#155 A-2: client は id・name・isActive（すべて必須）", () => {
    const client = resolve(itemSchema().properties?.client);
    expect(Object.keys(client.properties ?? {}).sort()).toEqual([
      "id",
      "isActive",
      "name",
    ]);
    expect([...(client.required ?? [])].sort()).toEqual([
      "id",
      "isActive",
      "name",
    ]);
  });

  it("#155 A-2: departments は id・name・isActive（すべて必須）の配列", () => {
    const departments = resolve(itemSchema().properties?.departments);
    expect(departments.type).toBe("array");
    const department = resolve(departments.items);
    expect(Object.keys(department.properties ?? {}).sort()).toEqual([
      "id",
      "isActive",
      "name",
    ]);
    expect([...(department.required ?? [])].sort()).toEqual([
      "id",
      "isActive",
      "name",
    ]);
  });

  it("#155 A-2: progress は null を許し、null でないときは done・total（必須）", () => {
    const progress = resolve(itemSchema().properties?.progress);
    expect(allowsNull(progress)).toBe(true);
    const shape = resolve(nonNull(progress));
    expect([...(shape.required ?? [])].sort()).toEqual(["done", "total"]);
  });

  it("#155 A-2: dueDate は null を許す", () => {
    const dueDate = resolve(itemSchema().properties?.dueDate);
    expect(allowsNull(dueDate)).toBe(true);
  });

  it("#155 A-2: エラーは 401・403・422。429 は書かない", () => {
    const codes = Object.keys(operation().responses ?? {});
    for (const code of ["401", "403", "422"]) expect(codes).toContain(code);
    expect(codes).not.toContain("429");
  });
});
