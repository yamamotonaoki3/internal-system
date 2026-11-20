// #155（155-A）A-2：API の仕様書（docs/api/openapi.json）に、EP-4-01 GET /api/search/messages の契約が書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）は openapi.test.ts の全体の番人が確かめ、ここでは重ねない。
// 期待は計画 4.4：クエリ q（必須）・roomId・from・to・limit・cursor（任意）。200 は { items, nextCursor }（総件数の項目を持たない）、
//   項目は messageId・parentMessageId・roomId・roomKind・roomName・author（id・displayName）・excerpt・createdAt。
//   エラーは 401・403・422。429 は作らない（利用者の決定 D-7）。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";

type Schema = {
  type?: string | string[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  $ref?: string;
  allOf?: Schema[];
};
type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: { maxLength?: number; pattern?: string; $ref?: string };
};
type Operation = {
  operationId?: string;
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

const operation = () => {
  const op = paths["/api/search/messages"]?.get;
  if (op === undefined)
    throw new Error("GET /api/search/messages が仕様書にありません");
  return op;
};

describe("#155 AC-4 A-2 EP-4-01 の仕様書", () => {
  it("#155 AC-4 A-2: クエリは q（必須）と、roomId・from・to・limit・cursor（任意）", () => {
    const params = (operation().parameters ?? []).filter(
      (p) => p.in === "query",
    );
    const byName = new Map(params.map((p) => [p.name, p]));
    expect([...byName.keys()].sort()).toEqual(
      ["cursor", "from", "limit", "q", "roomId", "to"].sort(),
    );
    expect(byName.get("q")?.required).toBe(true);
    for (const name of ["roomId", "from", "to", "limit", "cursor"])
      expect(byName.get(name)?.required ?? false).toBe(false);
  });

  it("#155 AC-4 A-2: 200 は items と nextCursor だけ（総件数を持たない）。項目の形", () => {
    const response = operation().responses?.["200"] as
      { content?: Record<string, { schema?: Schema }> } | undefined;
    const body = resolve(response?.content?.["application/json"]?.schema);
    expect(Object.keys(body.properties ?? {}).sort()).toEqual([
      "items",
      "nextCursor",
    ]);
    const item = resolve(body.properties?.items?.items);
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(
      [
        "author",
        "createdAt",
        "excerpt",
        "messageId",
        "parentMessageId",
        "roomId",
        "roomKind",
        "roomName",
      ].sort(),
    );
    const author = resolve(item.properties?.author);
    expect(Object.keys(author.properties ?? {}).sort()).toEqual(
      ["displayName", "id"].sort(),
    );
  });

  it("#155 AC-4 A-2 D-7: エラーは 401・403・422。429 は書かない", () => {
    const codes = Object.keys(operation().responses ?? {});
    for (const code of ["401", "403", "422"]) expect(codes).toContain(code);
    expect(codes).not.toContain("429");
  });

  it("#155 AC-3 A-2: q の制約は実装と同じ（100文字まで。NUL を含む語を許さない）", () => {
    const q = (operation().parameters ?? []).find(
      (p) => p.in === "query" && p.name === "q",
    );
    const schema = q?.schema ?? {};
    expect(schema.maxLength).toBe(100);
    expect(typeof schema.pattern).toBe("string");
    const pattern = new RegExp(schema.pattern ?? "", "u");
    for (const ok of ["見積書", "a", "this AND that", "制御\t文字"])
      expect({ value: ok, ok: pattern.test(ok) }).toEqual({
        value: ok,
        ok: true,
      });
    for (const ng of ["\u0000見積書", "見積\u0000書", "見積書\u0000"])
      expect({ value: JSON.stringify(ng), ok: pattern.test(ng) }).toEqual({
        value: JSON.stringify(ng),
        ok: false,
      });
  });
});
