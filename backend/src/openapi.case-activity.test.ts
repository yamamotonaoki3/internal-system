// #148（148-C）5-1 AC-4 の残り・C-191(4)：API の仕様書（docs/api/openapi.json）の CaseSummary（一覧 EP-5-06 の項目と概要 EP-5-07 の応答）に、
// lastActivityAt・channelId が、必須・null を許す形で書かれていること。値の意味（有効な参加者だけ）が説明に書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）は openapi.test.ts の全体の番人が確かめ、ここでは重ねない。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";

type Schema = {
  type?: string | string[];
  format?: string;
  pattern?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  $ref?: string;
};

const schemas = spec.components.schemas as unknown as Record<string, Schema>;
const paths = spec.paths as unknown as Record<
  string,
  Record<
    string,
    {
      responses?: Record<
        string,
        { content?: Record<string, { schema?: Schema }> }
      >;
    }
  >
>;

const ULID = "^[0-7][0-9A-HJKMNP-TV-Z]{25}$";

function resolve(schema: Schema | undefined): Schema {
  if (schema?.$ref === undefined) return schema ?? {};
  return resolve(schemas[schema.$ref.replace("#/components/schemas/", "")]);
}

const okSchema = (path: string) =>
  resolve(
    paths[path]?.get?.responses?.["200"]?.content?.["application/json"]?.schema,
  );

describe("#148 148-C API の仕様書：CaseSummary の lastActivityAt・channelId", () => {
  const summary = schemas.CaseSummary ?? {};

  it("#148 148-C 5-1 AC-4: lastActivityAt は必須で、null を許す日時（date-time）", () => {
    expect(summary.required).toContain("lastActivityAt");
    const p = summary.properties?.lastActivityAt;
    expect(p?.type).toEqual(["string", "null"]);
    expect(p?.format).toBe("date-time");
    expect(p?.description ?? "").toContain("参加者");
  });

  it("#148 148-C 5-1 AC-2: channelId は必須で、null を許す ULID の形", () => {
    expect(summary.required).toContain("channelId");
    const p = summary.properties?.channelId;
    expect(p?.type).toEqual(["string", "null"]);
    expect(p?.pattern).toBe(ULID);
    expect(p?.description ?? "").toContain("参加者");
  });

  it("#148 148-C: 一覧（GET /api/cases）の items と、概要（GET /api/cases/{caseId}）の応答が、どちらも CaseSummary の2項目を持つ", () => {
    const page = okSchema("/api/cases");
    const item = resolve(page.properties?.items?.items);
    const one = okSchema("/api/cases/{caseId}");
    for (const target of [item, one]) {
      expect(target.required).toEqual(
        expect.arrayContaining(["lastActivityAt", "channelId"]),
      );
      expect(Object.keys(target.properties ?? {})).toEqual(
        expect.arrayContaining(["lastActivityAt", "channelId"]),
      );
    }
  });
});
