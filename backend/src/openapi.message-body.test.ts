// #270（270-B）計画 2.11：API の仕様書（docs/api/openapi.json）の本文の制約が、添付だけの投稿（本文なし＝空文字）を表していることを確かめる。
// 根拠：利用者の決定1（API は本文なしを空文字で受け渡す）・決定3（編集で本文を空にできる）・1-1 AC-5（本文は4,000文字まで）・計画 2.11
//   MessageCreate.body（投稿・返信・編集の要求）・MessageItem.body・MessageEdited.body：minLength は 0（または未指定）で空文字を許し、maxLength 4000 を保つ。
//   MessageItem.body は削除済みの null も許す（これまでどおり）。
// 既存の backend/src/openapi.test.ts（ルートと仕様書の突き合わせ）は、本文の minLength を見ないため、ここで確かめる（計画 改訂1 の指摘4）。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";

type BodySchema = {
  type?: string | string[];
  minLength?: number;
  maxLength?: number;
};

function bodyOf(name: string): BodySchema {
  const schemas = (
    spec as unknown as {
      components: {
        schemas: Record<string, { properties?: Record<string, BodySchema> }>;
      };
    }
  ).components.schemas;
  const body = schemas[name]?.properties?.body;
  if (body === undefined)
    throw new Error(`${name} の body が仕様書にありません`);
  return body;
}

const typesOf = (schema: BodySchema) =>
  Array.isArray(schema.type) ? schema.type : [schema.type];

describe("#270 計画 2.11 仕様書の本文の制約（添付だけの投稿）", () => {
  it.each(["MessageCreate", "MessageItem", "MessageEdited"])(
    "#270 AC-4（決定1）: %s の body は空文字を許し（minLength が 0 か未指定）、maxLength は 4000",
    (name) => {
      const body = bodyOf(name);
      expect(typesOf(body)).toContain("string");
      expect(body.minLength ?? 0).toBe(0);
      expect(body.maxLength).toBe(4000);
    },
  );

  it("#270 AC-4: MessageItem の body は、削除済みの null もこれまでどおり許す", () => {
    expect(typesOf(bodyOf("MessageItem"))).toContain("null");
  });

  it("#270 AC-4: MessageCreate・MessageEdited の body は null を許さない（本文なしは空文字で表す）", () => {
    expect(typesOf(bodyOf("MessageCreate"))).not.toContain("null");
    expect(typesOf(bodyOf("MessageEdited"))).not.toContain("null");
  });
});
