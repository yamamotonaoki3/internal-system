// #270（270-A）1-6 AC-4・計画 3章（security）・9章：API の仕様書（docs/api/openapi.json）の契約。
// - EP-1-11 DELETE /api/attachments/{attachmentId}：param は ULID、成功は 204（本文なし）、
//   エラーは 401・403（FORBIDDEN・FORBIDDEN_ORIGIN・REAUTH_REQUIRED・PASSWORD_CHANGE_REQUIRED）・404・409・422（計画 3章 security の行）
// - 監査の検索の action の enum に attachment.delete（AC-7）
// 実際のルートと仕様書の一致は、既存の openapi.test.ts が確かめる（ここでは重ねない）。期待値は計画から直接書く。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  pattern?: string;
  properties?: Record<string, Schema>;
  $ref?: string;
  oneOf?: Schema[];
  anyOf?: Schema[];
};
type Parameter = { name: string; in: string; schema?: Schema; $ref?: string };
type Operation = {
  parameters?: Parameter[];
  requestBody?: unknown;
  responses?: Record<
    string,
    { $ref?: string; content?: Record<string, { schema?: Schema }> }
  >;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation> & { parameters?: Parameter[] }
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;
const resolve = (schema: Schema | undefined): Schema => {
  if (schema?.$ref === undefined) return schema ?? {};
  return resolve(schemas[schema.$ref.replace("#/components/schemas/", "")]);
};
const valuesOf = (schema: Schema | undefined): unknown[] => {
  const s = resolve(schema);
  return [
    ...(s.enum ?? []),
    ...[...(s.oneOf ?? []), ...(s.anyOf ?? [])].flatMap(valuesOf),
  ];
};

const PATH = "/api/attachments/{attachmentId}";
const op = () => paths[PATH]?.delete;

describe("#270 AC-1〜AC-4 EP-1-11 DELETE /api/attachments/{attachmentId} の契約", () => {
  it("#270 AC-1: DELETE の操作があり、本文を受け取らず、成功は 204 で本文がない", () => {
    expect(op()).toBeDefined();
    expect(op()?.requestBody).toBeUndefined();
    const ok = op()?.responses?.["204"];
    expect(ok).toBeDefined();
    expect(ok?.content).toBeUndefined();
  });

  it("#270 AC-2〜AC-4: 401・403・404・409・422 の応答を書いている", () => {
    for (const code of ["401", "403", "404", "409", "422"])
      expect(op()?.responses?.[code], code).toBeDefined();
  });

  it("#270 AC-3: 403 の説明に FORBIDDEN・FORBIDDEN_ORIGIN・REAUTH_REQUIRED・PASSWORD_CHANGE_REQUIRED を挙げている", () => {
    const text = JSON.stringify(op()?.responses?.["403"] ?? {});
    for (const code of [
      "FORBIDDEN",
      "FORBIDDEN_ORIGIN",
      "REAUTH_REQUIRED",
      "PASSWORD_CHANGE_REQUIRED",
    ])
      expect(text, code).toContain(code);
  });

  it("#270 AC-2: param の attachmentId（path・必須）を、操作かパスの共通の引数に書いている", () => {
    const params = [
      ...(paths[PATH]?.parameters ?? []),
      ...(op()?.parameters ?? []),
    ];
    expect(
      params.some(
        (p) =>
          (p.name === "attachmentId" && p.in === "path") ||
          (p.$ref ?? "").includes("attachmentId"),
      ),
    ).toBe(true);
  });
});

describe("#270 AC-7 監査の検索の enum", () => {
  it("#270 AC-7: action に attachment.delete がある", () => {
    const body = resolve(
      (
        paths["/api/admin/audit-logs/search"]?.post?.requestBody as
          { content?: Record<string, { schema?: Schema }> } | undefined
      )?.content?.["application/json"]?.schema,
    );
    expect(valuesOf(body.properties?.action)).toContain("attachment.delete");
  });
});
