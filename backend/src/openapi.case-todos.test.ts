// #149（149-A）EP-5-13・14・17・18、計画 6.2・6.9(1)：API の仕様書（docs/api/openapi.json）に、TODO の一覧・追加・完了・取り消しの契約と、
// 概要・一覧の項目の progress が書かれていること。実際のルートとの突き合わせ（足りない・余分がない）と、Origin の 403・401 の記載は
// openapi.test.ts の全体の番人が確かめ、ここでは重ねない。ID の pattern は shared/ulid-rules.ts の ULID_PATTERN と同じ判定であること。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { ULID_PATTERN } from "../../shared/ulid-rules";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
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
  additionalProperties?: boolean | Schema;
};
type Parameter = { name: string; in: string; schema?: Schema };
type Response = {
  description?: string;
  content?: Record<string, { schema?: Schema }>;
};
type Operation = {
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, Response>;
};

const paths = spec.paths as unknown as Record<
  string,
  Record<string, Operation>
>;
const schemas = spec.components.schemas as unknown as Record<string, Schema>;

const TODOS = "/api/cases/{caseId}/todos";
const COMPLETE = "/api/cases/{caseId}/todos/{todoId}/complete";
const UNCOMPLETE = "/api/cases/{caseId}/todos/{todoId}/uncomplete";

const VALID_ULIDS = [
  "01JTESTCASE149A00000000001",
  "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
];
const INVALID_ULIDS = [
  "81JTESTCASE149A00000000001",
  "01JTESTCASE149A0000000001",
  "01JTESTCASE149A0000000000I",
  "01JTESTCASE149A0000000000U",
  "01jtestcase149a00000000001",
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

/** null を許す型（oneOf・anyOf・type の配列）から、null でない側を取り出す */
function nonNull(schema: Schema): Schema {
  const choices = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].map(
    resolve,
  );
  const found = choices.find((s) => s.type !== "null");
  return found ?? schema;
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

const json = (operation: Operation | undefined, code: string) =>
  resolve(operation?.responses?.[code]?.content?.["application/json"]?.schema);

function expectProgress(where: string, schema: Schema | undefined) {
  const progress = resolve(schema);
  expect(allowsNull(progress), `${where} は null を許す`).toBe(true);
  const object = resolve(nonNull(progress));
  expect(object.required, where).toEqual(
    expect.arrayContaining(["done", "total"]),
  );
  expect(resolve(object.properties?.done).type).toBe("integer");
  expect(resolve(object.properties?.total).type).toBe("integer");
}

describe("#149 149-A API の仕様書：TODO", () => {
  it.each([
    { path: TODOS, method: "get", codes: ["200", "401", "403", "404", "422"] },
    {
      path: TODOS,
      method: "post",
      codes: ["201", "401", "403", "404", "409", "422"],
    },
    {
      path: COMPLETE,
      method: "post",
      codes: ["200", "401", "403", "404", "409", "422"],
    },
    {
      path: UNCOMPLETE,
      method: "post",
      codes: ["200", "401", "403", "404", "409", "422"],
    },
  ])(
    "#149 AC-1（EP-5-13・14・17・18）: $method $path の応答コードが書かれている",
    ({ path, method, codes }) => {
      const operation = paths[path]?.[method];
      expect(operation, `${method} ${path}`).toBeDefined();
      for (const code of codes)
        expect(Object.keys(operation?.responses ?? {})).toContain(code);
    },
  );

  it("#149 AC-1: パスの caseId・todoId の pattern は ULID_PATTERN と同じ判定", () => {
    const checked: string[] = [];
    for (const [path, method] of [
      [TODOS, "get"],
      [TODOS, "post"],
      [COMPLETE, "post"],
      [UNCOMPLETE, "post"],
    ] as const) {
      for (const parameter of paths[path]?.[method]?.parameters ?? []) {
        if (parameter.in !== "path") continue;
        expectUlidPattern(
          `${method} ${path} ${parameter.name}`,
          resolve(parameter.schema).pattern,
        );
        checked.push(`${path}:${method}:${parameter.name}`);
      }
    }
    expect(checked.sort()).toEqual(
      [
        `${TODOS}:get:caseId`,
        `${TODOS}:post:caseId`,
        `${COMPLETE}:post:caseId`,
        `${COMPLETE}:post:todoId`,
        `${UNCOMPLETE}:post:caseId`,
        `${UNCOMPLETE}:post:todoId`,
      ].sort(),
    );
  });

  it("#149 AC-1 決定 Q4: 一覧のクエリ limit は既定 100・最大 100、cursor がある", () => {
    const parameters = paths[TODOS]?.get?.parameters ?? [];
    const limit = parameters.find(
      (p) => p.in === "query" && p.name === "limit",
    );
    expect(limit).toBeDefined();
    expect(resolve(limit?.schema).maximum).toBe(100);
    expect(resolve(limit?.schema).default).toBe(100);
    expect(
      parameters.some((p) => p.in === "query" && p.name === "cursor"),
    ).toBe(true);
  });

  it("#149 AC-1 5-4 AC-1・AC-4 計画 6.9(1): 一覧の応答は items・nextCursor・progress（0件は null）。項目は id・title・completed・version・assignee・previousAssignee・completedAssignee", () => {
    const page = json(paths[TODOS]?.get, "200");
    expect(page.required).toEqual(
      expect.arrayContaining(["items", "nextCursor", "progress"]),
    );
    expectProgress("一覧の progress", page.properties?.progress);
    const item = resolve(resolve(page.properties?.items).items);
    expect(item.required).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "completed",
        "version",
        "assignee",
        "previousAssignee",
        "completedAssignee",
      ]),
    );
    expectUlidPattern("項目の id", resolve(item.properties?.id).pattern);
    for (const key of ["assignee", "previousAssignee", "completedAssignee"]) {
      const person = resolve(item.properties?.[key]);
      expect(allowsNull(person), `${key} は null を許す`).toBe(true);
      expect(resolve(nonNull(person)).required, key).toEqual(
        expect.arrayContaining(["userId", "displayName", "isActive"]),
      );
    }
  });

  it("#149 AC-1 5-4 AC-2・AC-5・AC-6: 追加の本文は title（必須）と assigneeUserId（任意。ULID か null）だけで、ほかの項目を受け付けない（期限・優先度なし）", () => {
    const body = resolve(
      paths[TODOS]?.post?.requestBody?.content?.["application/json"]?.schema,
    );
    expect(body.required).toEqual(["title"]);
    expect(Object.keys(body.properties ?? {}).sort()).toEqual(
      ["assigneeUserId", "title"].sort(),
    );
    expect(body.additionalProperties).toBe(false);
    const assignee = resolve(body.properties?.assigneeUserId);
    expect(allowsNull(assignee)).toBe(true);
    expectUlidPattern(
      "追加の本文 assigneeUserId",
      resolve(nonNull(assignee)).pattern ?? assignee.pattern,
    );
  });

  it("#149 AC-1 5-4 AC-2: 追加の 201 は id・title・completed・assignee・progress を持つ", () => {
    const created = json(paths[TODOS]?.post, "201");
    expect(created.required).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "completed",
        "assignee",
        "progress",
      ]),
    );
    expectProgress("追加の progress", created.properties?.progress);
  });

  it.each([COMPLETE, UNCOMPLETE])(
    "#149 AC-1 5-4 AC-3・AC-8: %s の 200 は id・completed・version・progress を持つ",
    (path) => {
      const body = json(paths[path]?.post, "200");
      expect(body.required).toEqual(
        expect.arrayContaining(["id", "completed", "version", "progress"]),
      );
      expectProgress(`${path} の progress`, body.properties?.progress);
    },
  );

  it("#149 AC-1 5-4 AC-9: 409 の説明に reason（追加は closed、完了・取り消しは closed と todo_deleted）が書かれている", () => {
    expect(paths[TODOS]?.post?.responses?.["409"]?.description).toContain(
      "closed",
    );
    for (const path of [COMPLETE, UNCOMPLETE]) {
      const description = paths[path]?.post?.responses?.["409"]?.description;
      expect(description, path).toContain("closed");
      expect(description, path).toContain("todo_deleted");
    }
  });

  it.each([
    ["post", TODOS],
    ["post", COMPLETE],
    ["post", UNCOMPLETE],
  ] as const)(
    "#149 AC-1 計画 6.10（コードレビュー1回目）: %s %s の応答に 503（ID の作り直しの上限を超えた）が書かれている",
    (method, path) => {
      expect(Object.keys(paths[path]?.[method]?.responses ?? {})).toContain(
        "503",
      );
    },
  );

  it("#149 AC-1 5-1 AC-2・R-78: 概要（CaseSummary）は progress（{ done, total } か null）を必須で持つ", () => {
    const summary = resolve(schemas.CaseSummary);
    expect(summary.required).toContain("progress");
    expectProgress("CaseSummary.progress", summary.properties?.progress);
  });
});

// #149（149-B）EP-5-15（PATCH 編集）・EP-5-16（DELETE 削除）、計画 6.2.1・10節「契約」、決定 Q1・Q2
const TODO_ITEM = "/api/cases/{caseId}/todos/{todoId}";

type Numeric = Schema & {
  minLength?: number;
  maxLength?: number;
};

describe("#149 149-B API の仕様書：TODO の編集・削除", () => {
  it.each([
    {
      method: "patch",
      codes: ["200", "401", "403", "404", "409", "422", "503"],
    },
    {
      method: "delete",
      codes: ["204", "401", "403", "404", "409", "422", "503"],
    },
  ])(
    "#149 AC-1（EP-5-15・16）: $method の応答コードが書かれている",
    ({ method, codes }) => {
      const operation = paths[TODO_ITEM]?.[method];
      expect(operation, `${method} ${TODO_ITEM}`).toBeDefined();
      for (const code of codes)
        expect(Object.keys(operation?.responses ?? {}), code).toContain(code);
    },
  );

  it("#149 AC-1: 編集・削除のパスの caseId・todoId の pattern は ULID_PATTERN と同じ判定", () => {
    const checked: string[] = [];
    for (const method of ["patch", "delete"]) {
      for (const parameter of paths[TODO_ITEM]?.[method]?.parameters ?? []) {
        if (parameter.in !== "path") continue;
        expectUlidPattern(
          `${method} ${parameter.name}`,
          resolve(parameter.schema).pattern,
        );
        checked.push(`${method}:${parameter.name}`);
      }
    }
    expect(checked.sort()).toEqual(
      ["delete:caseId", "delete:todoId", "patch:caseId", "patch:todoId"].sort(),
    );
  });

  it("#149 AC-1 5-4 AC-8 決定 Q1: 編集の本文は strict で、version（必須・整数・最小1）・title（任意・1〜100文字）・assigneeUserId（任意・ULID か null）だけ", () => {
    const body = resolve(
      paths[TODO_ITEM]?.patch?.requestBody?.content?.["application/json"]
        ?.schema,
    );
    expect(body.additionalProperties).toBe(false);
    expect(body.required).toEqual(["version"]);
    expect(Object.keys(body.properties ?? {}).sort()).toEqual(
      ["assigneeUserId", "title", "version"].sort(),
    );
    const version = resolve(body.properties?.version);
    expect(version.type).toBe("integer");
    expect(version.minimum).toBe(1);
    const title = resolve(body.properties?.title) as Numeric;
    expect(title.minLength).toBe(1);
    expect(title.maxLength).toBe(100);
    const assignee = resolve(body.properties?.assigneeUserId);
    expect(allowsNull(assignee)).toBe(true);
    expectUlidPattern(
      "編集の本文 assigneeUserId",
      resolve(nonNull(assignee)).pattern ?? assignee.pattern,
    );
  });

  it("#149 AC-1 計画 6.2.1: 編集の本文は、title か assigneeUserId の少なくとも一方が必須（anyOf）で、版だけの本文は定義に合わない", () => {
    const body = resolve(
      paths[TODO_ITEM]?.patch?.requestBody?.content?.["application/json"]
        ?.schema,
    );
    const alternatives = (body.anyOf ?? []).map(resolve);
    expect(alternatives.map((a) => a.required)).toEqual(
      expect.arrayContaining([["title"], ["assigneeUserId"]]),
    );
    // 版だけの本文（{ version: 1 }）は、どの選択肢の必須も満たさない
    const versionOnly = new Set(["version"]);
    const satisfiedBy = alternatives.filter((a) =>
      (a.required ?? []).every((name) => versionOnly.has(name)),
    );
    expect(satisfiedBy).toEqual([]);
    expect(alternatives.length).toBeGreaterThan(0);
  });

  it("#149 AC-1 5-4 AC-8: 編集の 200 は、一覧の項目と同じ項目（id・title・completed・version・assignee・previousAssignee・completedAssignee）と progress を持つ", () => {
    const edited = json(paths[TODO_ITEM]?.patch, "200");
    expect(edited.required).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "completed",
        "version",
        "assignee",
        "previousAssignee",
        "completedAssignee",
        "progress",
      ]),
    );
    expectProgress("編集の progress", edited.properties?.progress);
  });

  it("#149 AC-1 決定 Q2 計画 10節 #27: 削除は本文を受け取らず（requestBody がない）、204 は本文なし", () => {
    const operation = paths[TODO_ITEM]?.delete;
    expect(operation?.requestBody).toBeUndefined();
    expect(operation?.responses?.["204"]?.content).toBeUndefined();
  });

  it("#149 AC-1 5-4 AC-9 決定 Q1: 編集の 409 の reason に closed・todo_deleted・todo_changed・todo_completed、削除の 409 に closed が書かれている", () => {
    const editConflict = JSON.stringify(
      paths[TODO_ITEM]?.patch?.responses?.["409"] ?? {},
    );
    const resolvedEdit = JSON.stringify(json(paths[TODO_ITEM]?.patch, "409"));
    for (const reason of [
      "closed",
      "todo_deleted",
      "todo_changed",
      "todo_completed",
    ])
      expect(`${editConflict}${resolvedEdit}`, reason).toContain(reason);
    const deleteConflict = `${JSON.stringify(
      paths[TODO_ITEM]?.delete?.responses?.["409"] ?? {},
    )}${JSON.stringify(json(paths[TODO_ITEM]?.delete, "409"))}`;
    expect(deleteConflict).toContain("closed");
  });
});

// #149（149-C）EP-5-24（履歴）・EP-5-25（削除済みの一覧）・EP-5-26（復元）、計画 plan-149c 5.1・9.7（C1）
const EVENTS = "/api/cases/{caseId}/todos/{todoId}/events";
const DELETED = "/api/cases/{caseId}/deleted-todos";
const RESTORE = "/api/cases/{caseId}/todos/{todoId}/restore";

describe("#149 149-C API の仕様書：TODO の履歴・削除済みの一覧・復元", () => {
  it.each([
    { path: EVENTS, method: "get", codes: ["200", "401", "403", "404", "422"] },
    {
      path: DELETED,
      method: "get",
      codes: ["200", "401", "403", "404", "422"],
    },
    {
      path: RESTORE,
      method: "post",
      codes: ["200", "401", "403", "404", "409", "422", "503"],
    },
  ])(
    "#149 149-C C1（EP-5-24・25・26）: $method $path の応答コードが書かれている",
    ({ path, method, codes }) => {
      const operation = paths[path]?.[method];
      expect(operation, `${method} ${path}`).toBeDefined();
      for (const code of codes)
        expect(Object.keys(operation?.responses ?? {}), code).toContain(code);
    },
  );

  it("#149 149-C C1: パスの caseId・todoId の pattern は ULID_PATTERN と同じ判定", () => {
    const checked: string[] = [];
    for (const [path, method] of [
      [EVENTS, "get"],
      [DELETED, "get"],
      [RESTORE, "post"],
    ] as const) {
      for (const parameter of paths[path]?.[method]?.parameters ?? []) {
        if (parameter.in !== "path") continue;
        expectUlidPattern(
          `${method} ${path} ${parameter.name}`,
          resolve(parameter.schema).pattern,
        );
        checked.push(`${path}:${method}:${parameter.name}`);
      }
    }
    expect(checked.sort()).toEqual(
      [
        `${EVENTS}:get:caseId`,
        `${EVENTS}:get:todoId`,
        `${DELETED}:get:caseId`,
        `${RESTORE}:post:caseId`,
        `${RESTORE}:post:todoId`,
      ].sort(),
    );
  });

  it.each([EVENTS, DELETED])(
    "#149 149-C 決定 Q5 C1: %s のクエリ limit は既定 100・最大 100、cursor がある",
    (path) => {
      const parameters = paths[path]?.get?.parameters ?? [];
      const limit = parameters.find(
        (p) => p.in === "query" && p.name === "limit",
      );
      expect(limit).toBeDefined();
      expect(resolve(limit?.schema).maximum).toBe(100);
      expect(resolve(limit?.schema).default).toBe(100);
      expect(
        parameters.some((p) => p.in === "query" && p.name === "cursor"),
      ).toBe(true);
    },
  );

  it("#149 149-C 5-4 AC-10・AC-11 C1: 履歴の 200 は items・nextCursor。記録は id・kind・createdAt・actor・title・previousTitle・assignee・previousAssignee。kind は8種類", () => {
    const page = json(paths[EVENTS]?.get, "200");
    expect(page.required).toEqual(
      expect.arrayContaining(["items", "nextCursor"]),
    );
    const event = resolve(resolve(page.properties?.items).items);
    expect(event.required).toEqual(
      expect.arrayContaining([
        "id",
        "kind",
        "createdAt",
        "actor",
        "title",
        "previousTitle",
        "assignee",
        "previousAssignee",
      ]),
    );
    expect([...(resolve(event.properties?.kind).enum ?? [])].sort()).toEqual(
      [
        "assignee_change",
        "auto_unassign",
        "complete",
        "create",
        "delete",
        "restore",
        "title_change",
        "uncomplete",
      ].sort(),
    );
    expect(resolve(resolve(event.properties?.actor)).required).toEqual(
      expect.arrayContaining(["userId", "displayName", "isActive"]),
    );
    for (const key of ["assignee", "previousAssignee"]) {
      const person = resolve(event.properties?.[key]);
      expect(allowsNull(person), `${key} は null を許す`).toBe(true);
      expect(resolve(nonNull(person)).required, key).toEqual(
        expect.arrayContaining(["userId", "displayName", "isActive"]),
      );
    }
    for (const key of ["title", "previousTitle"])
      expect(
        allowsNull(resolve(event.properties?.[key])),
        `${key} は null を許す`,
      ).toBe(true);
  });

  it("#149 149-C 5-4 AC-12 C1: 削除済みの一覧の 200 は items・nextCursor（progress を持たない）。項目は一覧の項目に deletedAt・deletedBy を足したもの", () => {
    const page = json(paths[DELETED]?.get, "200");
    expect(page.required).toEqual(
      expect.arrayContaining(["items", "nextCursor"]),
    );
    expect(Object.keys(page.properties ?? {})).not.toContain("progress");
    const item = resolve(resolve(page.properties?.items).items);
    expect(item.required).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "completed",
        "version",
        "assignee",
        "previousAssignee",
        "completedAssignee",
        "deletedAt",
        "deletedBy",
      ]),
    );
    expect(resolve(item.properties?.deletedBy).required).toEqual(
      expect.arrayContaining(["userId", "displayName", "isActive"]),
    );
  });

  it("#149 149-C 5-4 AC-13 決定 Q2 C1: 復元は本文を受け取らず（requestBody がない）、200 は一覧の項目と progress を持つ", () => {
    const operation = paths[RESTORE]?.post;
    expect(operation?.requestBody).toBeUndefined();
    const restored = json(operation, "200");
    expect(restored.required).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "completed",
        "version",
        "assignee",
        "previousAssignee",
        "completedAssignee",
        "progress",
      ]),
    );
    expectProgress("復元の progress", restored.properties?.progress);
  });

  it("#149 149-C 5-4 AC-9 C1: 復元の 409 の reason に closed が書かれている", () => {
    const conflict = `${JSON.stringify(
      paths[RESTORE]?.post?.responses?.["409"] ?? {},
    )}${JSON.stringify(json(paths[RESTORE]?.post, "409"))}`;
    expect(conflict).toContain("closed");
  });
});
