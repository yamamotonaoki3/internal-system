// #147（147-B）EP-5-09・EP-5-10・納期の変更：API の仕様書（docs/api/openapi.json）に、参加者の追加・削除と納期の変更の契約、
// 詳細の参加者の autoRole・removable（Q8）、概要の canEditDueDate が書かれていること。
// 実際のルートとの突き合わせ（足りない・余分がない）と、Origin の 403・401 の記載は openapi.test.ts の全体の番人が確かめ、ここでは重ねない。
// ID の pattern は shared/ulid-rules.ts の ULID_PATTERN と同じ判定（^[0-7][0-9A-HJKMNP-TV-Z]{25}$）、日付の pattern は \d の形
//   （復号後にバックスラッシュが1つ）であることを、見本の文字列で確かめる。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { ULID_PATTERN } from "../../shared/ulid-rules";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  pattern?: string;
  nullable?: boolean;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  additionalProperties?: boolean | Schema;
};
type Parameter = { name: string; in: string; schema?: Schema };
type Operation = {
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, unknown>;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

const PARTICIPANTS = "/api/cases/{caseId}/participants";
const PARTICIPANT = "/api/cases/{caseId}/participants/{userId}";
const DUE_DATE = "/api/cases/{caseId}/due-date";

const VALID_ULIDS = [
  "01JTESTCASE147B00000000001",
  "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
];
const INVALID_ULIDS = [
  "81JTESTCASE147B00000000001",
  "01JTESTCASE147B0000000001",
  "01JTESTCASE147B0000000000I",
  "01JTESTCASE147B0000000000L",
  "01JTESTCASE147B0000000000O",
  "01JTESTCASE147B0000000000U",
  "01jtestcase147b00000000001",
];

/** $ref と allOf をたどって、プロパティを1つの表にする */
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

describe("#147 147-B API の仕様書：参加者の追加・削除と納期の変更", () => {
  it.each([
    {
      name: `POST ${PARTICIPANTS}`,
      path: PARTICIPANTS,
      method: "post",
      codes: ["201", "401", "403", "404", "409", "422"],
    },
    {
      name: `DELETE ${PARTICIPANT}`,
      path: PARTICIPANT,
      method: "delete",
      codes: ["204", "401", "403", "404", "409", "422"],
    },
    {
      name: `PATCH ${DUE_DATE}`,
      path: DUE_DATE,
      method: "patch",
      codes: ["200", "401", "403", "404", "409", "422"],
    },
  ])(
    "#147 5-1 AC-3・AC-11・AC-17（EP-5-09・EP-5-10）: $name の応答コードが書かれている",
    ({ path, method, codes }) => {
      const operation = paths[path]?.[method];
      expect(operation, `${method} ${path}`).toBeDefined();
      for (const code of codes)
        expect(Object.keys(operation?.responses ?? {})).toContain(code);
    },
  );

  it("#147 5-1 AC-3: パスの caseId・userId と、追加の本文の userId の pattern は ULID_PATTERN と同じ判定", () => {
    const checked: string[] = [];
    for (const [path, method] of [
      [PARTICIPANTS, "post"],
      [PARTICIPANT, "delete"],
      [DUE_DATE, "patch"],
    ] as const) {
      for (const parameter of paths[path]?.[method]?.parameters ?? []) {
        if (parameter.in !== "path") continue;
        expectUlidPattern(
          `${method} ${path} ${parameter.name}`,
          resolve(parameter.schema).pattern,
        );
        checked.push(`${method}:${parameter.name}`);
      }
    }
    expect(checked.sort()).toEqual(
      ["delete:caseId", "delete:userId", "patch:caseId", "post:caseId"].sort(),
    );
    const body = resolve(
      paths[PARTICIPANTS]?.post?.requestBody?.content?.["application/json"]
        ?.schema,
    );
    expect(body.required).toContain("userId");
    expectUlidPattern(
      "追加の本文 userId",
      resolve(body.properties?.userId).pattern,
    );
  });

  it("#147 5-1 AC-17: 納期の変更の本文は dueDate（必須。YYYY-MM-DD か null）で、pattern は 2026-11-17 に一致し、ほかの形に一致しない", () => {
    const body = resolve(
      paths[DUE_DATE]?.patch?.requestBody?.content?.["application/json"]
        ?.schema,
    );
    expect(body.required).toContain("dueDate");
    const dueDate = resolve(body.properties?.dueDate);
    const pattern =
      dueDate.pattern ??
      [...(dueDate.oneOf ?? []), ...(dueDate.anyOf ?? [])]
        .map(resolve)
        .find((s) => s.pattern !== undefined)?.pattern;
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern ?? "");
    expect(re.test("2026-11-17")).toBe(true);
    for (const sample of ["2026/11/17", "20261117", "2026-1-7", "d{4}-d{2}"])
      expect(re.test(sample), sample).toBe(false);
    // null を許すこと（未定に戻す）
    const text = JSON.stringify(dueDate);
    expect(text.includes("null")).toBe(true);
  });

  it("#147 Q8: 詳細の参加者は autoRole（global_admin・department_owner・null）と removable（真偽）を必須で持ち、userId は ULID の形", () => {
    const detail = resolve(schemas.CaseDetail);
    const participants = resolve(detail.properties?.participants);
    const participant = resolve(participants.items);
    expect(participant.required).toEqual(
      expect.arrayContaining(["autoRole", "removable", "userId"]),
    );
    const autoRole = resolve(participant.properties?.autoRole);
    const values = [
      ...(autoRole.enum ?? []),
      ...[...(autoRole.oneOf ?? []), ...(autoRole.anyOf ?? [])].flatMap(
        (s) => resolve(s).enum ?? [],
      ),
    ];
    expect(values.filter((v) => v !== null).sort()).toEqual(
      ["department_owner", "global_admin"].sort(),
    );
    expect(JSON.stringify(autoRole).includes("null")).toBe(true);
    expect(resolve(participant.properties?.removable).type).toBe("boolean");
    expectUlidPattern(
      "CaseDetail.participants[].userId",
      resolve(participant.properties?.userId).pattern,
    );
  });

  it("#147 5-1 AC-17・AC-21（Q6）: 概要（CaseSummary）は canEditDueDate（真偽）を必須で持つ", () => {
    const summary = resolve(schemas.CaseSummary);
    expect(summary.required).toContain("canEditDueDate");
    expect(resolve(summary.properties?.canEditDueDate).type).toBe("boolean");
  });
});
