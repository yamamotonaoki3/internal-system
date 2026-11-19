// #148（148-B-2）5-2 AC-8・AC-9・計画 6.3〜6.7：API の仕様書（docs/api/openapi.json）の契約。
// - EP-1-23 PATCH /api/attachments/{attachmentId}（本文 { publicationVisibility }・応答 { id, publicationVisibility }・応答コード）
// - アップロードの2つの入口のクエリ publicationVisibility と、201 の UploadedAttachmentItem（AttachmentItem の項目 ＋ publicationVisibility〔2値か null〕）
// - メッセージの表示の AttachmentItem は変わらない（additionalProperties: false の契約を壊さない）
// - 返信の取得の ReplyLatestPage・ReplyAfterPage に caseRoom（boolean・必須）
// - 監査の検索の action・targetType の enum に、case.attachment.visibility.change・attachment
// 期待値は要件から直接書く（shared の定義から作らない）。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  $ref?: string;
  oneOf?: Schema[];
  anyOf?: Schema[];
  nullable?: boolean;
};
type Parameter = { name: string; in: string; schema?: Schema };
type Operation = {
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

const resolve = (schema: Schema | undefined): Schema => {
  if (schema?.$ref === undefined) return schema ?? {};
  return resolve(schemas[schema.$ref.replace("#/components/schemas/", "")]);
};
const json = (op: Operation | undefined, code: string) =>
  op?.responses?.[code]?.content?.["application/json"]?.schema;
/** 値の候補（enum。oneOf・anyOf の中も） */
const valuesOf = (schema: Schema | undefined): unknown[] => {
  const s = resolve(schema);
  return [
    ...(s.enum ?? []),
    ...[...(s.oneOf ?? []), ...(s.anyOf ?? [])].flatMap(valuesOf),
  ];
};
const allowsNull = (schema: Schema | undefined) =>
  JSON.stringify(resolve(schema)).includes("null");

const PATCH_PATH = "/api/attachments/{attachmentId}";
const UPLOADS = [
  "/api/rooms/{roomId}/attachments",
  "/api/messages/{messageId}/replies/attachments",
];

describe("#148 AC-9 EP-1-23 の契約", () => {
  const op = () => paths[PATCH_PATH]?.patch;

  it("#148 AC-9: PATCH があり、応答コード 200・401・403・404・409・422 が書かれている", () => {
    expect(op()).toBeDefined();
    for (const code of ["200", "401", "403", "404", "409", "422"])
      expect(Object.keys(op()?.responses ?? {})).toContain(code);
  });

  it("#148 AC-9: 本文は publicationVisibility（必須・participants_only と public_archive の2値）", () => {
    const body = resolve(
      op()?.requestBody?.content?.["application/json"]?.schema,
    );
    expect(body.required).toEqual(["publicationVisibility"]);
    expect(
      [...valuesOf(body.properties?.publicationVisibility)].sort(),
    ).toEqual(["participants_only", "public_archive"]);
  });

  it("#148 AC-9: 200 は { id, publicationVisibility } だけ", () => {
    const ok = resolve(json(op(), "200"));
    expect(Object.keys(ok.properties ?? {}).sort()).toEqual([
      "id",
      "publicationVisibility",
    ]);
    expect([...(ok.required ?? [])].sort()).toEqual([
      "id",
      "publicationVisibility",
    ]);
  });
});

describe("#148 AC-8 アップロードの契約", () => {
  it.each(UPLOADS)(
    "#148 AC-8: %s にクエリ publicationVisibility（任意・2値）",
    (path) => {
      const param = (paths[path]?.post?.parameters ?? []).find(
        (p) => p.in === "query" && p.name === "publicationVisibility",
      );
      expect(param).toBeDefined();
      expect(
        (param as { required?: boolean } | undefined)?.required ?? false,
      ).toBe(false);
      expect([...valuesOf(param?.schema)].sort()).toEqual([
        "participants_only",
        "public_archive",
      ]);
    },
  );

  it.each(UPLOADS)(
    "#148 AC-8 計画 6.3: %s の 201 は UploadedAttachmentItem",
    (path) => {
      expect(json(paths[path]?.post, "201")?.$ref).toBe(
        "#/components/schemas/UploadedAttachmentItem",
      );
    },
  );

  it("#148 AC-8: UploadedAttachmentItem は AttachmentItem の項目と publicationVisibility（2値か null・必須）。additionalProperties: false", () => {
    const uploaded = resolve(schemas.UploadedAttachmentItem);
    expect(uploaded.additionalProperties).toBe(false);
    expect(Object.keys(uploaded.properties ?? {}).sort()).toEqual(
      [
        "id",
        "name",
        "kind",
        "contentType",
        "size",
        "publicationVisibility",
      ].sort(),
    );
    expect(uploaded.required).toContain("publicationVisibility");
    const value = uploaded.properties?.publicationVisibility;
    expect(valuesOf(value)).toEqual(
      expect.arrayContaining(["participants_only", "public_archive"]),
    );
    expect(allowsNull(value)).toBe(true);
  });

  it("#148 AC-8 計画 15章: メッセージの表示の AttachmentItem は変わらない（公開範囲を持たない）", () => {
    const item = resolve(schemas.AttachmentItem);
    expect(item.additionalProperties).toBe(false);
    expect(Object.keys(item.properties ?? {}).sort()).toEqual(
      ["id", "name", "kind", "contentType", "size"].sort(),
    );
  });
});

describe("#148 AC-8 計画 6.7 返信の取得の caseRoom", () => {
  it.each(["ReplyLatestPage", "ReplyAfterPage"])(
    "#148 AC-8: %s に caseRoom（boolean・必須）",
    (name) => {
      const page = resolve(schemas[name]);
      expect(page.required).toContain("caseRoom");
      expect(resolve(page.properties?.caseRoom).type).toBe("boolean");
    },
  );
});

describe("#148 AC-9 計画 6.5 監査の検索の enum", () => {
  const body = () =>
    resolve(
      paths["/api/admin/audit-logs/search"]?.post?.requestBody?.content?.[
        "application/json"
      ]?.schema,
    );
  const param = (name: string) => ({ schema: body().properties?.[name] });

  it("#148 AC-9: action に case.attachment.visibility.change、targetType に attachment", () => {
    expect(valuesOf(param("action")?.schema)).toContain(
      "case.attachment.visibility.change",
    );
    expect(valuesOf(param("targetType")?.schema)).toContain("attachment");
  });
});
