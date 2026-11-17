// API の仕様書（docs/api/openapi.json）と、実際のルートの突き合わせ。
// API を足す・消す・変えるときは、同じ変更の中で仕様書も直す（食い違うと、このテストが失敗する）。
// 組み立ては backend/src/index.ts と同じ。DB につなぐ処理だけを、使わない代役にしている。index.ts にルートを足したら、ここにも足す。
import { describe, expect, it } from "vitest";
import spec from "../../docs/api/openapi.json";
import { createApp } from "./app";
import { ULID_PATTERN } from "../../shared/ulid-rules";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./lib/audit-actions";
import { adminAccountRoutes } from "./routes/accounts";
import {
  ADMIN_CHANNEL_PURPOSES,
  ADMIN_CHANNEL_STATES,
  CHANNEL_VISIBILITIES,
  adminChannelRoutes,
} from "./routes/admin-channels";
import {
  DELETED_ITEM_TYPES,
  adminDeletedItemRoutes,
} from "./routes/admin-deleted-items";
import { adminAuditLogRoutes } from "./routes/audit-logs";
import {
  attachmentRoutes,
  replyAttachmentRoutes,
  roomAttachmentRoutes,
} from "./routes/attachments";
import { authRoutes } from "./routes/auth";
import { caseRequestRoutes } from "./routes/case-requests";
import { caseRoutes } from "./routes/cases";
import { channelRequestRoutes } from "./routes/channel-requests";
import { channelRoutes } from "./routes/channels";
import { adminClientRoutes, clientRoutes } from "./routes/clients";
import { adminDepartmentRoutes, departmentRoutes } from "./routes/departments";
import { dmRoutes } from "./routes/dms";
import { meRoutes } from "./routes/me";
import { messageItemRoutes, messageRoutes } from "./routes/messages";
import { notificationRoutes } from "./routes/notifications";
import { readPositionRoutes } from "./routes/read-positions";
import {
  adminRetirementRequestRoutes,
  retirementRequestRoutes,
} from "./routes/retirement-requests";
import { sampleUserRoutes } from "./routes/sample-users";
import { setupRoutes } from "./routes/setup";
import { threadReadPositionRoutes } from "./routes/thread-read-positions";
import { threadRoutes } from "./routes/threads";
import { unreadRoutes } from "./routes/unread";
import { userRoutes } from "./routes/users";

// DB につなぐ処理は使わない代役（このテストは、ルートの組み立てだけを確かめる）
const unusedDb = () => Promise.reject(new Error("DB は使いません"));

const app = createApp({
  routes: [
    { path: "/api/sample-users", app: sampleUserRoutes(unusedDb) },
    // #119：初回セットアップ。index.ts と同じパスに組み込む
    { path: "/api/setup", app: setupRoutes(unusedDb) },
    // #120：ログイン・ログアウト・セッション。index.ts と同じパスに組み込む
    { path: "/api/auth", app: authRoutes(unusedDb) },
    // #237：未読の一覧。index.ts と同じく /api/me より前に組み込む
    { path: "/api/me/unread", app: unreadRoutes() },
    // #137：スレッド一覧（EP-3-08）。index.ts と同じく /api/me より前に組み込む
    { path: "/api/me/threads", app: threadRoutes() },
    { path: "/api/me", app: meRoutes(unusedDb) },
    { path: "/api/admin/clients", app: adminClientRoutes() },
    // #199：アカウントの発行と一覧。index.ts と同じパスに組み込む
    { path: "/api/admin/accounts", app: adminAccountRoutes() },
    { path: "/api/clients", app: clientRoutes() },
    // #196：部署の管理。index.ts と同じパスに組み込む
    { path: "/api/admin/departments", app: adminDepartmentRoutes() },
    { path: "/api/departments", app: departmentRoutes() },
    // #200：チャンネルの一覧・詳細・参加。index.ts と同じパスに組み込む
    { path: "/api/channels", app: channelRoutes() },
    // #201：メッセージの一覧・投稿。index.ts と同じパスに組み込む
    { path: "/api/rooms", app: messageRoutes() },
    // #237：部屋の既読。index.ts と同じパスに組み込む
    { path: "/api/rooms", app: readPositionRoutes() },
    { path: "/api/users", app: userRoutes() },
    // #124：通知の一覧・未読数・既読。index.ts と同じパスに組み込む
    { path: "/api/me/notifications", app: notificationRoutes() },
    // #131：チャンネルの作成申請・自分の申請・審査一覧・承認・却下・取り下げ。index.ts と同じパスに組み込む
    { path: "/api/channel-requests", app: channelRequestRoutes() },
    // #128：退職処理の申請・自分の申請・取り下げ・全体管理者の一覧・却下。index.ts と同じパスに組み込む
    { path: "/api/retirement-requests", app: retirementRequestRoutes() },
    {
      path: "/api/admin/retirement-requests",
      app: adminRetirementRequestRoutes(),
    },
    // #136：DM の開始・一覧・詳細。index.ts と同じパスに組み込む
    { path: "/api/dms", app: dmRoutes() },
    // #134：メッセージの編集・削除（EP-1-03・EP-1-04）。index.ts と同じパスに組み込む
    { path: "/api/messages", app: messageItemRoutes() },
    // #137：スレッドの既読（EP-3-09）。返信の取得・投稿（EP-1-07・EP-1-08）は messageItemRoutes に入る。index.ts と同じパスに組み込む
    { path: "/api/messages", app: threadReadPositionRoutes() },
    // #140：添付のアップロード（通常の投稿用・返信用）と配信。index.ts と同じパスに組み込む
    { path: "/api/rooms", app: roomAttachmentRoutes() },
    { path: "/api/messages", app: replyAttachmentRoutes() },
    { path: "/api/attachments", app: attachmentRoutes() },
    // #146：案件の作成申請・自分の申請・取り下げ・類似件名の確認。index.ts と同じパスに組み込む
    { path: "/api/case-requests", app: caseRequestRoutes() },
    // #147：案件の一覧・概要・詳細（EP-5-06〜08）。index.ts と同じパスに組み込む
    { path: "/api/cases", app: caseRoutes() },
    // #156：監査ログの閲覧（EP-0-19）。index.ts と同じパスに組み込む
    { path: "/api/admin/audit-logs", app: adminAuditLogRoutes() },
    // #143-b：チャンネル管理（EP-2-42・EP-2-43）とアーカイブの一覧（EP-2-40）。index.ts と同じパスに組み込む
    { path: "/api/admin/channels", app: adminChannelRoutes() },
    { path: "/api/admin/deleted-items", app: adminDeletedItemRoutes() },
  ],
});

const METHODS = ["get", "post", "put", "patch", "delete"];
const CHANGING = ["POST", "PUT", "PATCH", "DELETE"];

type Operation = { responses: Record<string, unknown> };

/** 仕様書の操作（名前は "GET /api/health" の形） */
// #289: ULID の形の pattern の番人。pattern の中身ではなく、項目の名前で ID を集める（別の書き方の緩い形式も検出するため）。
type JsonObject = Record<string, unknown>;
const isObject = (node: unknown): node is JsonObject =>
  node !== null && typeof node === "object" && !Array.isArray(node);
// ULID ではない ID の名前。ULID として検証されていない（実装の検証と仕様が一致している）ため、対象から外す
const NON_ULID_ID_NAMES: Record<string, string> = {
  // 利用者が決める文字列（英数字と . _ -。3〜32文字）で、ULID ではない
  loginId: "利用者が決めるログイン用の文字列",
  // リクエストごとの追跡用の ID で、ULID ではない
  traceId: "追跡用の ID",
};
// 実装が ULID の形を検証せず、長さだけを検証するパスのパラメータ（形式の違う ID も存在しない ID と同じく 404 にするため）。
// 仕様が実装と一致するよう pattern を付けない。対象は「パス」と「パラメータ名」の組で、スキーマのプロパティは外さない
const LENGTH_ONLY_PATH_PARAMETERS = new Set([
  "/api/rooms/{roomId}/attachments|roomId",
  "/api/rooms/{roomId}/mention-candidates|roomId",
  "/api/rooms/{roomId}/messages|roomId",
  "/api/messages/{messageId}/replies/attachments|messageId",
  "/api/messages/{messageId}|messageId",
  "/api/messages/{messageId}/reactions|messageId",
  "/api/messages/{messageId}/reactions/{kind}/{value}|messageId",
  "/api/messages/{messageId}/replies|messageId",
  "/api/me/notifications/{notificationId}/read|notificationId",
  "/api/case-requests/{requestId}/withdraw|requestId",
  "/api/case-requests/{requestId}/approve|requestId",
  "/api/case-requests/{requestId}/reject|requestId",
  "/api/retirement-requests/{requestId}/withdraw|requestId",
  "/api/admin/retirement-requests/{requestId}/reject|requestId",
]);
const isLengthOnlyPathParameter = (name: string, path: string) => {
  const route =
    /^\/paths\/(\/.+)\/(?:get|post|put|patch|delete)\/parameters\[\d+\]\/schema$/.exec(
      path,
    )?.[1];
  return (
    route !== undefined && LENGTH_ONLY_PATH_PARAMETERS.has(route + "|" + name)
  );
};
const isIdName = (name: string) => name === "id" || name.endsWith("Id");
const resolveRef = (root: unknown, node: unknown): unknown => {
  let current = node;
  for (let i = 0; i < 10; i++) {
    if (!isObject(current) || typeof current.$ref !== "string") return current;
    let target: unknown = root;
    for (const key of current.$ref.replace("#/", "").split("/"))
      target = isObject(target) ? target[key] : undefined;
    current = target;
  }
  return current;
};
// Crockford の文字クラスを使う pattern を、JSON のパスつきで集める
const collectCrockfordPatterns = (root: unknown) => {
  const found: { path: string; schema: unknown }[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, path + "[" + i + "]"));
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "pattern" &&
        typeof value === "string" &&
        value.includes("0-9A-HJKMNP-TV-Z")
      )
        found.push({ path, schema: node });
      else walk(value, path + "/" + key);
    }
  };
  walk(root, "");
  return found;
};
const ULID_VALID_SAMPLES = [
  "01JTESTCASE147A00000000001",
  "01JTESTCASE289A00000000002",
  "7ZZZZZZZZZZZZZZZZZZZZZZZZZ",
  "00000000000000000000000000",
];
const ULID_INVALID_SAMPLES = [
  "81JTESTCASE147A00000000001",
  "91JTESTCASE147A00000000001",
  "A1JTESTCASE147A00000000001",
  "01JTESTCASE147A0000000001",
  "01JTESTCASE147A000000000011",
  "01jtestcase147a00000000001",
  "01JTESTCASE147A0000000000I",
  "01JTESTCASE147A0000000000L",
  "01JTESTCASE147A0000000000O",
  "01JTESTCASE147A0000000000U",
];
const isStringCapable = (schema: JsonObject) =>
  schema.type === undefined ||
  (Array.isArray(schema.type)
    ? schema.type.includes("string")
    : schema.type === "string");
const patternMatchesUlidRules = (pattern: string) => {
  const re = new RegExp(pattern);
  return [...ULID_VALID_SAMPLES, ...ULID_INVALID_SAMPLES].every(
    (sample) => re.test(sample) === ULID_PATTERN.test(sample),
  );
};
// 「この位置は ID である」という文脈（項目の名前で決まる）を持ったまま、スキーマを評価する。評価できない形は、不一致として扱う（黙って外さない）
// 文字列になりうる枝は、どれも ULID と同じ判定の pattern（または、値がすべて ULID の enum）を満たすこと
const isUlidSchema = (root: unknown, schema: unknown, depth = 0): boolean => {
  const resolved = resolveRef(root, schema);
  if (!isObject(resolved) || depth > 10) return false;
  if (!isStringCapable(resolved)) return true;
  if (typeof resolved.pattern === "string")
    return patternMatchesUlidRules(resolved.pattern);
  if (Array.isArray(resolved.enum))
    return (
      resolved.enum.length > 0 &&
      resolved.enum.every(
        (value) =>
          value === null ||
          (typeof value === "string" && ULID_PATTERN.test(value)),
      )
    );
  const branches = (key: string) => {
    const value = resolved[key];
    return Array.isArray(value) ? value : undefined;
  };
  const choices = branches("oneOf") ?? branches("anyOf");
  if (choices !== undefined)
    return (
      choices.length > 0 &&
      choices.every((branch) => isUlidSchema(root, branch, depth + 1))
    );
  const all = branches("allOf");
  if (all !== undefined) {
    // allOf は、どれかの枝に ULID と同じ判定の pattern があり、かつ文字列になりうること
    return all.some((branch) => {
      const resolvedBranch = resolveRef(root, branch);
      return (
        isObject(resolvedBranch) &&
        isStringCapable(resolvedBranch) &&
        isUlidSchema(root, resolvedBranch, depth + 1)
      );
    });
  }
  return false;
};
// 〜Ids の位置：配列（合成の中の配列も）をたどり、要素を同じ規則で評価する
const isUlidArraySchema = (
  root: unknown,
  schema: unknown,
  depth = 0,
): boolean => {
  const resolved = resolveRef(root, schema);
  if (!isObject(resolved) || depth > 10) return false;
  if (resolved.type === "null") return true;
  const choices = Array.isArray(resolved.oneOf)
    ? resolved.oneOf
    : Array.isArray(resolved.anyOf)
      ? resolved.anyOf
      : undefined;
  if (choices !== undefined)
    return (
      choices.length > 0 &&
      choices.every((branch) => isUlidArraySchema(root, branch, depth + 1))
    );
  if (Array.isArray(resolved.allOf))
    return resolved.allOf.some((branch) =>
      isUlidArraySchema(root, branch, depth + 1),
    );
  return resolved.items !== undefined && isUlidSchema(root, resolved.items);
};
// ID を表す位置（パス・クエリのパラメータ、スキーマのプロパティのうち、名前が id・〜Id・〜Ids のもの）を、JSON のパスつきで集める。
// 位置の数は名前だけで決まり、スキーマの形には依存しない
const collectIdPositions = (root: unknown) => {
  const found: { path: string; name: string; schema: unknown }[] = [];
  const consider = (name: string, schema: unknown, path: string) => {
    if (NON_ULID_ID_NAMES[name] !== undefined) return;
    if (isLengthOnlyPathParameter(name, path)) return;
    if (isIdName(name) || name.endsWith("Ids"))
      found.push({ path, name, schema });
  };
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, path + "[" + i + "]"));
      return;
    }
    if (!isObject(node)) return;
    if (
      typeof node.name === "string" &&
      (node.in === "path" || node.in === "query")
    )
      consider(node.name, node.schema, path + "/schema");
    if (isObject(node.properties))
      for (const [name, schema] of Object.entries(node.properties))
        consider(name, schema, path + "/properties/" + name);
    for (const [key, value] of Object.entries(node))
      walk(value, path + "/" + key);
  };
  walk(root, "");
  return found;
};
// schema の pattern が ULID_PATTERN と同じ判定か（pattern が無い場合も「合わない」）
const matchesUlidRules = (schema: unknown) =>
  isObject(schema) &&
  typeof schema.pattern === "string" &&
  patternMatchesUlidRules(schema.pattern);
const findMismatchedUlidPaths = (root: unknown) => [
  ...collectIdPositions(root)
    .filter(({ name, schema }) =>
      name.endsWith("Ids")
        ? !isUlidArraySchema(root, schema)
        : !isUlidSchema(root, schema),
    )
    .map(({ path, schema }) => path + " " + JSON.stringify(schema)),
  ...collectCrockfordPatterns(root)
    .filter(({ schema }) => !matchesUlidRules(schema))
    .map(({ path, schema }) => path + " [Crockford] " + JSON.stringify(schema)),
];

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item as Record<string, Operation>)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, operation]) => ({
      name: `${method.toUpperCase()} ${path}`,
      operation,
    })),
);

/** 実際のルート（ミドルウェアは除く） */
const actual = [
  ...new Set(
    app.routes
      .filter((route) => route.method !== "ALL")
      .map(
        (route) =>
          `${route.method} ${route.path.replace(/\/:([A-Za-z_][A-Za-z0-9_]*)(?=\/|$)/g, "/{$1}")}`,
      ),
  ),
].sort();

describe("API の仕様書（docs/api/openapi.json）", () => {
  it("#123 0-3 AC-1/0-5 AC-1: 認証情報APIの成功と拒否の契約が書かれている", () => {
    for (const name of [
      "PUT /api/me/password",
      "POST /api/auth/reauthenticate",
    ]) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of ["200", "401", "403", "409", "422", "429", "503"])
        expect(Object.keys(operation?.operation.responses ?? {})).toContain(
          code,
        );
    }
    expect(actual).not.toContain("GET /api/me");
  });
  it("#196 AC-1・AC-2・AC-4: 部署の操作の成功と拒否の応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/departments": ["201", "401", "403", "404", "409", "422"],
      "GET /api/admin/departments": ["200", "401", "403", "422"],
      "PATCH /api/admin/departments/{id}": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "PUT /api/departments/{id}/owner": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "GET /api/admin/departments/owner-candidates": [
        "200",
        "401",
        "403",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#199 AC-1・AC-3・AC-5: アカウントの発行・一覧・部署の候補の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/admin/accounts": ["201", "401", "403", "409", "422"],
      "GET /api/admin/accounts": ["200", "401", "403", "422"],
      "GET /api/admin/accounts/department-options": ["200", "401", "403"],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#128 AC-9・AC-14: アカウントの無効化・再有効化・部署異動の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/admin/accounts/{id}/deactivate": [
        "204",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/admin/accounts/{id}/reactivate": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/admin/accounts/{id}/transfer": [
        "204",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#200 AC-2・AC-3: チャンネルの一覧・詳細・参加の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "GET /api/channels": ["200", "401", "404", "422"],
      "GET /api/channels/{channelId}": ["200", "401", "404", "422"],
      "POST /api/channels/{channelId}/join": [
        "200",
        "401",
        "403",
        "404",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#143 a-AC-1〜a-AC-3: チャンネルの名前・説明の変更（EP-2-36）・アーカイブ（EP-2-37）・復元（EP-2-38）の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "PATCH /api/channels/{channelId}": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/channels/{channelId}/delete": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/channels/{channelId}/restore": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#143 軽微2（コードレビュー1回目）: ChannelUpdate は version を必須にし、名前・説明の少なくとも一方を anyOf と required で必須にしている（version だけの本文を許さない）", () => {
    const schemas = (
      spec as unknown as {
        components: { schemas: Record<string, Record<string, unknown>> };
      }
    ).components.schemas;
    const update = schemas.ChannelUpdate;
    expect(update).toBeDefined();
    expect(update?.required as string[] | undefined).toContain("version");
    const anyOf = update?.anyOf as { required?: string[] }[] | undefined;
    expect(Array.isArray(anyOf)).toBe(true);
    const alternatives = (anyOf ?? []).map((entry) =>
      [...(entry.required ?? [])].sort().join(","),
    );
    expect(alternatives.sort()).toEqual(["description", "name"]);
  });
  it("#201 AC-1・AC-2・AC-3: メッセージの一覧・投稿の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "GET /api/rooms/{roomId}/messages": ["200", "401", "404", "422"],
      "POST /api/rooms/{roomId}/messages": [
        "201",
        "401",
        "403",
        "404",
        "422",
        "503",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#131 AC-1・AC-3・AC-4・AC-6・AC-7・AC-15: チャンネルの作成申請・自分の申請・審査一覧・承認・却下・取り下げの契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/channel-requests": ["201", "401", "403", "409", "422"],
      "GET /api/channel-requests/mine": ["200", "401", "422"],
      "GET /api/channel-requests": ["200", "401", "403", "422"],
      "POST /api/channel-requests/{requestId}/approve": [
        "200",
        "401",
        "403",
        "404",
        "409",
      ],
      "POST /api/channel-requests/{requestId}/reject": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/channel-requests/{requestId}/withdraw": [
        "200",
        "401",
        "403",
        "404",
        "409",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#146 5-3 AC-1・AC-7・AC-14（EP-5-01・EP-5-02）: 案件の作成申請・自分の申請・取り下げ・類似件名の確認の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/case-requests": ["201", "401", "403", "409", "422"],
      "GET /api/case-requests/mine": ["200", "401", "422"],
      "POST /api/case-requests/{requestId}/withdraw": [
        "200",
        "401",
        "403",
        "404",
        "409",
      ],
      "GET /api/case-requests/similar-title": ["200", "401", "422"],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#128 0-1 AC-20・C-177（U-1）: 退職処理の申請・自分の申請・取り下げ・全体管理者の一覧・却下の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/retirement-requests": [
        "201",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "GET /api/retirement-requests/mine": ["200", "401", "422"],
      "POST /api/retirement-requests/{requestId}/withdraw": [
        "200",
        "401",
        "403",
        "404",
        "409",
      ],
      "GET /api/admin/retirement-requests": ["200", "401", "403", "422"],
      "POST /api/admin/retirement-requests/{requestId}/reject": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#146 5-3 AC-3〜AC-6（EP-5-03〜EP-5-05。146-B）: 審査一覧・承認・却下の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "GET /api/case-requests": ["200", "401", "403", "422"],
      "POST /api/case-requests/{requestId}/approve": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/case-requests/{requestId}/reject": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#147 5-1 AC-2・AC-4・AC-14（EP-5-06〜EP-5-08。147-A）: 案件の一覧・概要・詳細の契約が書かれている", () => {
    const expected: Record<string, string[]> = {
      "GET /api/cases": ["200", "401", "403", "422"],
      "GET /api/cases/{caseId}": ["200", "401", "403", "404", "422"],
      "GET /api/cases/{caseId}/detail": ["200", "401", "403", "404", "422"],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });
  it("#289 AC-1: API 仕様の全体で、ID の位置（名前が id・〜Id・〜Ids）の pattern は、shared/ulid-rules.ts の ULID_PATTERN と同じ判定になる（pattern の無い項目も失敗）", () => {
    // 集める対象（空振りしない）と、見本自体が ULID_PATTERN の判定どおりであること（見本の書き間違いを防ぐ）
    expect(collectIdPositions(spec).length).toBeGreaterThan(0);
    expect(collectCrockfordPatterns(spec).length).toBeGreaterThan(0);
    for (const sample of ULID_VALID_SAMPLES)
      expect(ULID_PATTERN.test(sample), sample).toBe(true);
    for (const sample of ULID_INVALID_SAMPLES)
      expect(ULID_PATTERN.test(sample), sample).toBe(false);
    expect(findMismatchedUlidPaths(spec)).toEqual([]);
  });
  it("#289 AC-2: 番人は、別の書き方の緩い pattern・pattern の無い ID の位置・合成スキーマの中の緩い pattern を検出でき、ID の位置の数はスキーマの形で減らない", () => {
    const original = JSON.stringify(spec);
    const clone = () => JSON.parse(original) as typeof spec;
    const baseline = findMismatchedUlidPaths(spec).length;
    const positionCount = collectIdPositions(spec).length;
    expect(findMismatchedUlidPaths(clone())).toEqual(
      findMismatchedUlidPaths(spec),
    );
    // 変更する位置（文字列の ID と、〜Ids の配列）の、複製の中の schema を取り出す
    const pick = (root: typeof spec, ids: boolean) => {
      const position = collectIdPositions(root).find(
        ({ name, schema }) =>
          name.endsWith("Ids") === ids &&
          isObject(schema) &&
          schema.$ref === undefined &&
          matchesUlidRules(ids ? schema.items : schema),
      );
      expect(
        position,
        ids ? "〜Ids の位置" : "文字列の ID の位置",
      ).toBeDefined();
      return position?.schema as JsonObject;
    };
    const replace = (target: JsonObject, content: JsonObject) => {
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, content);
    };
    const LOOSE = "^[0-9A-Z]{26}$";
    const mutations: Record<string, (root: typeof spec) => void> = {
      "別の書き方の緩い pattern": (root) => {
        pick(root, false).pattern = LOOSE;
      },
      "pattern を消す": (root) => {
        delete pick(root, false).pattern;
      },
      "Crockford の文字クラスの緩い pattern": (root) => {
        pick(root, false).pattern = "^[0-9A-HJKMNP-TV-Z]{26}$";
      },
      "oneOf で包んだ文字列": (root) => {
        replace(pick(root, false), {
          oneOf: [{ type: "string", pattern: LOOSE }],
        });
      },
      "allOf の中の緩い pattern": (root) => {
        replace(pick(root, false), {
          allOf: [{ type: "string", pattern: LOOSE }],
        });
      },
      "allOf に pattern が無い": (root) => {
        replace(pick(root, false), { allOf: [{ type: "string" }] });
      },
      "type が無く pattern だけが緩い": (root) => {
        replace(pick(root, false), { pattern: LOOSE });
      },
      "type が無く pattern も無い": (root) => {
        replace(pick(root, false), { description: "ID" });
      },
      "enum の値が ULID でない": (root) => {
        replace(pick(root, false), { type: "string", enum: ["abc"] });
      },
      "参照先の oneOf": (root) => {
        (root.components.schemas as Record<string, unknown>).TmpUlid289 = {
          oneOf: [{ type: "string", pattern: LOOSE }],
        };
        replace(pick(root, false), { $ref: "#/components/schemas/TmpUlid289" });
      },
      "oneOf で包んだ〜Ids の配列": (root) => {
        replace(pick(root, true), {
          oneOf: [{ type: "array", items: { type: "string", pattern: LOOSE } }],
        });
      },
      "〜Ids の要素に pattern が無い": (root) => {
        replace(pick(root, true), { type: "array", items: { type: "string" } });
      },
      "評価できない形（型も合成も無い）": (root) => {
        replace(pick(root, false), { oneOf: [] });
      },
    };
    for (const [name, mutate] of Object.entries(mutations)) {
      const mutated = clone();
      mutate(mutated);
      expect(findMismatchedUlidPaths(mutated).length, name).toBeGreaterThan(
        baseline,
      );
      expect(collectIdPositions(mutated).length, name).toBe(positionCount);
    }
    // 変更しない場合の位置の数と、ID でない名前の項目（loginId）が集まらないこと
    expect(collectIdPositions(clone()).length).toBe(positionCount);
    expect(
      collectIdPositions(spec).some(({ name }) => name === "loginId"),
    ).toBe(false);
  });
  it("#136 AC-1・AC-3（C-168(2)・(4)・(5)・(7)）: DM の開始・一覧・詳細と、メッセージの DM の枝の応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/dms": ["200", "401", "403", "404", "422"],
      "GET /api/dms": ["200", "401", "403", "422"],
      "GET /api/dms/{roomId}": ["200", "401", "403", "404", "422"],
      // DM の一覧は perm.dm.message.view の拒否で 403、投稿は相手が無効なら 409（C-168(2)）
      "GET /api/rooms/{roomId}/messages": ["200", "401", "403", "404", "422"],
      "POST /api/rooms/{roomId}/messages": [
        "201",
        "401",
        "403",
        "404",
        "409",
        "422",
        "503",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });

  it("#136 C-168(3): GET /api/users は、表示名の検索 q（1〜100文字）をクエリに書いている", () => {
    const parameters = (
      spec.paths["/api/users"].get as {
        parameters?: {
          name: string;
          in: string;
          schema?: { minLength?: number; maxLength?: number };
        }[];
      }
    ).parameters;
    const q = parameters?.find((p) => p.name === "q" && p.in === "query");
    expect(q).toBeDefined();
    expect(q?.schema?.minLength).toBe(1);
    expect(q?.schema?.maxLength).toBe(100);
  });

  it("#237 AC-1・AC-2（EP-3-01・EP-3-02）: 未読の一覧と既読の応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      // 未読の一覧：perm.notification.own の拒否で 403（改訂2 C）
      "GET /api/me/unread": ["200", "401", "403", "422"],
      // 既読：未参加の公開チャンネルと送信元の不正で 403、見えない部屋・別の部屋のメッセージで 404
      "PUT /api/rooms/{roomId}/read-position": [
        "204",
        "401",
        "403",
        "404",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });

  it("#134 AC-1（1-3 AC-1・AC-2・AC-4・AC-6）: メッセージの編集・削除の応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      // 編集：本人以外・未参加・送信元の不正は 403、見えないは 404、削除済み・読み取り専用・DM の相手が無効は 409、本文の誤りは 422
      "PATCH /api/messages/{messageId}": [
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      // 削除：成功は 204。403 は FORBIDDEN・FORBIDDEN_ORIGIN・REAUTH_REQUIRED
      "DELETE /api/messages/{messageId}": ["204", "401", "403", "404", "409"],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
    const deleteForbidden = JSON.stringify(
      (
        spec.paths as Record<
          string,
          Record<string, { responses: Record<string, unknown> }>
        >
      )["/api/messages/{messageId}"]?.delete?.responses["403"] ?? {},
    );
    expect(deleteForbidden).toContain("REAUTH_REQUIRED");
  });

  it("#134 AC-1（1-3 AC-3・AC-4・計画 7）: 一覧の項目（MessageItem）に editedAt・deleted があり、body は削除済みのとき null になれる", () => {
    const item = (
      spec.components.schemas as Record<
        string,
        {
          required?: string[];
          properties?: Record<string, { type?: string | string[] }>;
        }
      >
    ).MessageItem;
    for (const name of ["editedAt", "deleted"])
      expect(item?.required, name).toContain(name);
    expect(item?.properties?.deleted?.type).toBe("boolean");
    expect(item?.properties?.editedAt?.type).toEqual(
      expect.arrayContaining(["string", "null"]),
    );
    expect(item?.properties?.body?.type).toEqual(
      expect.arrayContaining(["string", "null"]),
    );
  });

  it("#137 AC-1（1-4 AC-1〜4）: 返信の取得・投稿とスレッド一覧・スレッドの既読の応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      // 返信の取得（EP-1-07）：見えない・返信への返信・存在しないは 404、本文の形は 422
      "GET /api/messages/{messageId}/replies": ["200", "401", "404", "422"],
      // 返信の投稿（EP-1-08）：未参加・権限・送信元の不正は 403、見えない・返信への返信は 404、削除済みの親・部屋の状態は 409、本文の誤りは 422、ID の競合の上限は 503
      "POST /api/messages/{messageId}/replies": [
        "201",
        "401",
        "403",
        "404",
        "409",
        "422",
        "503",
      ],
      // スレッド一覧（EP-3-08）：perm.notification.own の拒否は 403、limit・cursor の誤りは 422
      "GET /api/me/threads": ["200", "401", "403", "422"],
      // スレッドの既読（EP-3-09）：未参加・権限・送信元の不正は 403、見えない・別のスレッドの返信は 404、形の誤りは 422
      "PUT /api/messages/{messageId}/thread-read-position": [
        "204",
        "401",
        "403",
        "404",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });

  it("#137 AC-1（決めたこと3）: 一覧の項目（MessageItem）に parentMessageId（文字列か null）と replyCount（整数）がある", () => {
    const item = (
      spec.components.schemas as Record<
        string,
        {
          required?: string[];
          properties?: Record<string, { type?: string | string[] }>;
        }
      >
    ).MessageItem;
    for (const name of ["parentMessageId", "replyCount"])
      expect(item?.required, name).toContain(name);
    expect(item?.properties?.parentMessageId?.type).toEqual(
      expect.arrayContaining(["string", "null"]),
    );
    expect(item?.properties?.replyCount?.type).toBe("integer");
  });

  it("#134 AC-1（1-3 AC-6・改訂1 指摘2）: チャンネルの詳細（ChannelDetail）に readOnly（真偽）がある", () => {
    const detail = (
      spec.components.schemas as Record<
        string,
        {
          required?: string[];
          properties?: Record<string, { type?: string | string[] }>;
        }
      >
    ).ChannelDetail;
    expect(detail?.required).toContain("readOnly");
    expect(detail?.properties?.readOnly?.type).toBe("boolean");
  });

  it("#156 0-6 AC-1・AC-3（EP-0-19）: 監査ログの検索の応答コードが書かれている（200・401・403・422。429 は作らない）", () => {
    const operation = operations.find(
      (entry) => entry.name === "POST /api/admin/audit-logs/search",
    );
    expect(operation).toBeDefined();
    const codes = Object.keys(operation?.operation.responses ?? {});
    for (const code of ["200", "401", "403", "422"])
      expect(codes).toContain(code);
    expect(codes).not.toContain("429");
  });

  it("#156 0-6 AC-3（C-180）: 監査ログの検索の from・to の pattern は、JST の日付 YYYY-MM-DD だけに一致する", () => {
    const search = (
      spec as unknown as {
        components: {
          schemas: Record<
            string,
            { properties?: Record<string, { pattern?: string }> }
          >;
        };
      }
    ).components.schemas.AuditLogSearch;
    for (const key of ["from", "to"]) {
      const pattern = search?.properties?.[key]?.pattern;
      expect(pattern, key).toBeTypeOf("string");
      const regex = new RegExp(pattern ?? "");
      expect(regex.test("2026-11-17"), `${key} 一致`).toBe(true);
      for (const bad of ["2026-1-7", "20261117", "2026-11-17T00:00:00Z"])
        expect(regex.test(bad), `${key} ${bad}`).toBe(false);
    }
  });

  it("#156 0-6 AC-3: 仕様書のすべての pattern は、正規表現として読め、復号後にバックスラッシュが2つ続く書き間違いを含まない", () => {
    const patterns: { at: string; pattern: string }[] = [];
    const walk = (node: unknown, at: string) => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${at}[${i}]`));
      } else if (node !== null && typeof node === "object") {
        for (const [key, child] of Object.entries(node)) {
          if (key === "pattern" && typeof child === "string")
            patterns.push({ at: `${at}.${key}`, pattern: child });
          else walk(child, `${at}.${key}`);
        }
      }
    };
    walk(spec, "$");
    expect(patterns.length).toBeGreaterThan(0);
    for (const { at, pattern } of patterns) {
      expect(() => new RegExp(pattern), at).not.toThrow();
      expect(pattern.includes("\\\\"), `${at}: ${pattern}`).toBe(false);
    }
  });

  it("#156 0-6 AC-3: 仕様書のどの pattern も、バックスラッシュの抜けた文字クラス（d{・w+ など）を含まない", () => {
    // 判定の正規表現そのものの確認（合う例・合わない例）
    const missingBackslash = /(?<!\\)[dws][{+*]/;
    expect(missingBackslash.test("^d{4}-d{2}$")).toBe(true);
    expect(missingBackslash.test("^w+$")).toBe(true);
    expect(missingBackslash.test("^\\d{4}-\\d{2}$")).toBe(false);
    expect(missingBackslash.test("^[0-9]{4}$")).toBe(false);
    expect(missingBackslash.test("^[a-z]+$")).toBe(false);

    const found: { at: string; pattern: string }[] = [];
    const walk = (node: unknown, at: string) => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${at}[${i}]`));
      } else if (node !== null && typeof node === "object") {
        for (const [key, child] of Object.entries(node)) {
          if (key === "pattern" && typeof child === "string")
            found.push({ at: `${at}.${key}`, pattern: child });
          else walk(child, `${at}.${key}`);
        }
      }
    };
    walk(spec, "$");
    expect(found.length).toBeGreaterThan(0);
    for (const { at, pattern } of found)
      expect(missingBackslash.test(pattern), `${at}: ${pattern}`).toBe(false);
  });

  it("#156 0-6 AC-3: 説明に YYYY-MM-DD を含む文字列の項目の pattern は、2026-11-17 に一致する", () => {
    const dated: { at: string; pattern: string }[] = [];
    const walk = (node: unknown, at: string) => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${at}[${i}]`));
      } else if (node !== null && typeof node === "object") {
        const schema = node as {
          type?: unknown;
          pattern?: unknown;
          description?: unknown;
        };
        if (
          schema.type === "string" &&
          typeof schema.pattern === "string" &&
          typeof schema.description === "string" &&
          schema.description.includes("YYYY-MM-DD")
        )
          dated.push({ at, pattern: schema.pattern });
        for (const [key, child] of Object.entries(node))
          walk(child, `${at}.${key}`);
      }
    };
    walk(spec, "$");
    expect(dated.length).toBeGreaterThan(0);
    for (const { at, pattern } of dated)
      expect(new RegExp(pattern).test("2026-11-17"), `${at}: ${pattern}`).toBe(
        true,
      );
  });

  it("#156 0-6 AC-4（R-16）: 監査ログの変更・削除・書き出しの操作は、仕様書にも実際のルートにもない（検索の POST だけ）", () => {
    const auditOperations = (names: string[]) =>
      names.filter((name) => name.includes("/api/admin/audit-logs"));
    expect(auditOperations(operations.map((o) => o.name))).toEqual([
      "POST /api/admin/audit-logs/search",
    ]);
    expect(auditOperations(actual)).toEqual([
      "POST /api/admin/audit-logs/search",
    ]);
  });

  it("#156 0-6 AC-5: 監査ログの一覧の項目（AuditLogItem）は、detail・trace_id・本名・メール・ログイン ID の項目を持たない", () => {
    const schemas = (
      spec as unknown as {
        components: { schemas: Record<string, { properties?: object }> };
      }
    ).components.schemas;
    const item = schemas.AuditLogItem;
    expect(item).toBeDefined();
    const names = Object.keys(item?.properties ?? {});
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "occurredAt",
        "action",
        "result",
        "actor",
        "target",
      ]),
    );
    for (const forbidden of [
      "detail",
      "traceId",
      "trace_id",
      "legalName",
      "email",
      "loginId",
    ])
      expect(names).not.toContain(forbidden);
  });

  it("#156 0-6 AC-1: セッションの応答の権限（permissions）に perm.audit_log.view が書かれている", () => {
    const session = JSON.stringify(spec.paths["/api/auth/session"]);
    const components = JSON.stringify(
      (spec as unknown as { components: object }).components,
    );
    expect(session + components).toContain("perm.audit_log.view");
  });

  it("#156 0-6 AC-3: 監査ログの操作・対象の種類の enum は、入力の検証の定義（AUDIT_ACTIONS・AUDIT_TARGET_TYPES）と集合として一致する", () => {
    type Prop = { enum?: string[] };
    const schemas = (
      spec as unknown as {
        components: {
          schemas: Record<string, { properties?: Record<string, Prop> }>;
        };
      }
    ).components.schemas;
    const diff = (
      actual: string[] | undefined,
      expected: readonly string[],
    ) => ({
      足りない: expected.filter((v) => !(actual ?? []).includes(v)),
      余分: (actual ?? []).filter((v) => !expected.includes(v)),
    });
    const none = { 足りない: [], 余分: [] };
    expect(
      diff(schemas.AuditLogSearch?.properties?.action?.enum, AUDIT_ACTIONS),
      "AuditLogSearch.action",
    ).toEqual(none);
    expect(
      diff(
        schemas.AuditLogSearch?.properties?.targetType?.enum,
        AUDIT_TARGET_TYPES,
      ),
      "AuditLogSearch.targetType",
    ).toEqual(none);
    expect(
      diff(schemas.AuditLogItem?.properties?.action?.enum, AUDIT_ACTIONS),
      "AuditLogItem.action",
    ).toEqual(none);
  });

  it("実際のルートと、同じ操作が書かれている（足りない・余分がない）", () => {
    expect(operations.map((o) => o.name).sort()).toEqual(actual);
  });

  it("状態を変える操作は、送信元（Origin）が不正なときの 403 を書いている（C-28）", () => {
    const missing = operations
      .filter(({ name }) => CHANGING.includes(name.split(" ")[0] ?? ""))
      .filter(({ operation }) => !("403" in operation.responses))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it("認証が必要な API（/api/auth/）は、未認証の 401 を書いている", () => {
    const missing = operations
      .filter(({ name }) => name.includes(" /api/auth/"))
      .filter(({ operation }) => !("401" in operation.responses))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it("#119 AC-4: 初回セットアップの GET /api/setup/status と POST /api/setup が書かれている", () => {
    const names = operations.map((o) => o.name);
    expect(names).toContain("GET /api/setup/status");
    expect(names).toContain("POST /api/setup");
  });

  it("#119 AC-1・AC-4: POST /api/setup は 201・403・409・422・503 を書き、401 は書かない（未認証で呼ぶ初回専用の API）", () => {
    const setup = operations.find((o) => o.name === "POST /api/setup");
    const codes = Object.keys(setup?.operation.responses ?? {});
    for (const code of ["201", "403", "409", "422", "503"])
      expect(codes).toContain(code);
    expect(codes).not.toContain("401");
  });

  it("#120 0-2 AC-1・AC-2: POST /api/auth/login・POST /api/auth/logout・GET /api/auth/session が書かれている", () => {
    const names = operations.map((o) => o.name);
    expect(names).toContain("POST /api/auth/login");
    expect(names).toContain("POST /api/auth/logout");
    expect(names).toContain("GET /api/auth/session");
  });

  it("#120 AC-3・0-2 AC-7: POST /api/auth/login は 200・401・403・422・429・503 を書いている", () => {
    const login = operations.find((o) => o.name === "POST /api/auth/login");
    const codes = Object.keys(login?.operation.responses ?? {});
    for (const code of ["200", "401", "403", "422", "429", "503"])
      expect(codes).toContain(code);
  });

  it("#120 0-2 AC-2: POST /api/auth/logout は 204 と 403 を書いている", () => {
    const logout = operations.find((o) => o.name === "POST /api/auth/logout");
    const codes = Object.keys(logout?.operation.responses ?? {});
    for (const code of ["204", "403"]) expect(codes).toContain(code);
  });

  it("#120 0-2 AC-3: 保護された API（/api/sample-users）は、未認証の 401 を書いている", () => {
    const missing = operations
      .filter(({ name }) => name.includes(" /api/sample-users"))
      .filter(({ operation }) => !("401" in operation.responses))
      .map(({ name }) => name);
    expect(missing).toEqual([]);
  });

  it("#120 AC-3: POST /api/setup は、試行制限の 429 を書いている", () => {
    const setup = operations.find((o) => o.name === "POST /api/setup");
    expect(Object.keys(setup?.operation.responses ?? {})).toContain("429");
  });
});

type Schema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema & { $ref?: string };
  $ref?: string;
};
type ReactionOperation = {
  responses: Record<string, { description?: string }>;
};

describe("API の仕様書：リアクション（#138）", () => {
  const POST_NAME = "POST /api/messages/{messageId}/reactions";
  const DELETE_NAME =
    "DELETE /api/messages/{messageId}/reactions/{kind}/{value}";

  it.each([POST_NAME, DELETE_NAME])(
    "#138 AC-1: %s が仕様書に書かれ、実際のルートと一致する",
    (name) => {
      expect(operations.map((o) => o.name)).toContain(name);
      expect(actual).toContain(name);
    },
  );

  it.each([POST_NAME, DELETE_NAME])(
    "#138 AC-1（U-12）: %s の成功は 200 だけ（201・204 は書かない）。401・403・404・409・422 を書いている",
    (name) => {
      const operation = operations.find((o) => o.name === name);
      const codes = Object.keys(operation?.operation.responses ?? {});
      for (const code of ["200", "401", "403", "404", "409", "422"])
        expect(codes, name).toContain(code);
      for (const code of ["201", "204"])
        expect(codes, name).not.toContain(code);
    },
  );

  it.each([POST_NAME, DELETE_NAME])(
    "#138 AC-1（4回目の指摘2）: %s の 409 の説明に、状態の変化（やり直しても決まらない競合）を含める",
    (name) => {
      const operation = operations.find((o) => o.name === name)
        ?.operation as unknown as ReactionOperation | undefined;
      expect(operation?.responses["409"]?.description, name).toContain(
        "状態の変化",
      );
    },
  );

  it("#138 AC-1: 成功の応答（200）は { messageId, reactions } で、reactions は Reaction の配列", () => {
    const schemas = spec.components.schemas as unknown as Record<
      string,
      Schema
    >;
    const operation = (
      spec.paths as unknown as Record<
        string,
        Record<
          string,
          {
            responses: Record<
              string,
              { content?: Record<string, { schema?: Schema }> }
            >;
          }
        >
      >
    )["/api/messages/{messageId}/reactions"]?.post;
    const schema =
      operation?.responses["200"]?.content?.["application/json"]?.schema;
    const resolved =
      schema?.$ref === undefined
        ? schema
        : schemas[schema.$ref.replace("#/components/schemas/", "")];
    expect(resolved?.required).toEqual(
      expect.arrayContaining(["messageId", "reactions"]),
    );
    expect(resolved?.properties?.reactions?.type).toBe("array");
  });

  it("#138 AC-1: Reaction は kind・value・count・reactedByMe・users を必須で持ち、users は id・displayName・isActive を持つ", () => {
    const schemas = spec.components.schemas as unknown as Record<
      string,
      Schema
    >;
    const reaction = schemas.Reaction;
    expect(reaction?.required).toEqual(
      expect.arrayContaining([
        "kind",
        "value",
        "count",
        "reactedByMe",
        "users",
      ]),
    );
    expect(reaction?.properties?.count?.type).toBe("integer");
    expect(reaction?.properties?.reactedByMe?.type).toBe("boolean");
    expect(reaction?.properties?.users?.type).toBe("array");
    expect(reaction?.properties?.users?.items?.required).toEqual(
      expect.arrayContaining(["id", "displayName", "isActive"]),
    );
  });

  it("#138 AC-1: Reaction.kind は emoji か stamp の列挙", () => {
    const schemas = spec.components.schemas as unknown as Record<
      string,
      { properties?: Record<string, { enum?: string[] }> }
    >;
    expect(
      [...(schemas.Reaction?.properties?.kind?.enum ?? [])].sort(),
    ).toEqual(["emoji", "stamp"]);
  });

  it("#138 AC-1: 一覧の項目（MessageItem）に reactions（Reaction の配列）が必須である", () => {
    const schemas = spec.components.schemas as unknown as Record<
      string,
      Schema
    >;
    const item = schemas.MessageItem;
    expect(item?.required).toContain("reactions");
    expect(item?.properties?.reactions?.type).toBe("array");
    expect(item?.properties?.reactions?.items?.$ref).toBe(
      "#/components/schemas/Reaction",
    );
  });
  it("#140 AC-1・AC-3: 添付のアップロード（2つの入口）と配信の応答コードが書かれている", () => {
    const expected: Record<string, string[]> = {
      "POST /api/rooms/{roomId}/attachments": [
        "201",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "POST /api/messages/{messageId}/replies/attachments": [
        "201",
        "401",
        "403",
        "404",
        "409",
        "422",
      ],
      "GET /api/attachments/{attachmentId}": [
        "200",
        "206",
        "401",
        "403",
        "404",
        "422",
      ],
    };
    for (const [name, codes] of Object.entries(expected)) {
      const operation = operations.find((entry) => entry.name === name);
      expect(operation, name).toBeDefined();
      for (const code of codes)
        expect(
          Object.keys(operation?.operation.responses ?? {}),
          name,
        ).toContain(code);
    }
  });

  it("#140 AC-1: 一覧の項目（MessageItem）に attachments（AttachmentItem の配列）が必須で、投稿の入力に attachmentIds がある", () => {
    const schemas = spec.components.schemas as unknown as Record<
      string,
      Schema
    >;
    const item = schemas.MessageItem;
    expect(item?.required).toContain("attachments");
    expect(item?.properties?.attachments?.type).toBe("array");
    expect(item?.properties?.attachments?.items?.$ref).toBe(
      "#/components/schemas/AttachmentItem",
    );
    expect(schemas.MessageCreate?.properties?.attachmentIds?.type).toBe(
      "array",
    );
    expect(schemas.AttachmentItem?.required).toEqual(
      expect.arrayContaining(["id", "name", "kind", "contentType", "size"]),
    );
  });
});

// #143-b b-AC-1・b-AC-2（O1。計画 #143-b 5.1）: チャンネル管理の一覧・1件（EP-2-42・EP-2-43）と、アーカイブの一覧（EP-2-40）の契約。
// 実装が前提とする約束（実装前。報告に明記）：routes/admin-channels.ts は adminChannelRoutes と、入力・応答の enum の定義
// ADMIN_CHANNEL_STATES（all・active・archived）・ADMIN_CHANNEL_PURPOSES（normal・department・announcement・company_general）・
// CHANNEL_VISIBILITIES（public・private）を公開する。routes/admin-deleted-items.ts は adminDeletedItemRoutes と DELETED_ITEM_TYPES（channel）を公開する。
describe("API の仕様書：チャンネル管理・アーカイブの一覧（#143-b）", () => {
  type Schema = {
    $ref?: string;
    type?: string | string[];
    enum?: string[];
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    required?: string[];
    properties?: Record<string, Schema>;
    items?: Schema;
    oneOf?: Schema[];
    anyOf?: Schema[];
    allOf?: Schema[];
  };
  type Parameter = { $ref?: string; name: string; in: string; schema?: Schema };
  type Op = { parameters?: Parameter[]; responses: Record<string, unknown> };
  const doc = spec as unknown as {
    paths: Record<string, Record<string, Op>>;
    components: Record<string, Record<string, unknown>>;
  };
  const ULID = "^[0-7][0-9A-HJKMNP-TV-Z]{25}$";

  function resolve<T>(value: T): T {
    const ref = (value as { $ref?: string } | undefined)?.$ref;
    if (ref === undefined) return value;
    const [, , group, name] = ref.split("/");
    return resolve(doc.components[group ?? ""]?.[name ?? ""] as T);
  }
  const op = (path: string) => doc.paths[path]?.get;
  const param = (path: string, name: string) =>
    (op(path)?.parameters ?? [])
      .map((entry) => resolve(entry))
      .find((entry) => entry.name === name);
  const schema = (name: string) =>
    resolve(doc.components.schemas?.[name] as Schema | undefined);
  /** null 可の書き方（oneOf・anyOf・type の配列）を外して、中の定義を返す */
  function nonNull(value: Schema | undefined): Schema | undefined {
    const resolved = resolve(value);
    const alternatives = resolved?.oneOf ?? resolved?.anyOf;
    if (alternatives !== undefined)
      return nonNull(
        alternatives.find((entry) => resolve(entry).type !== "null"),
      );
    return resolved;
  }
  const sameSet = (
    actual: readonly string[] | undefined,
    expected: readonly string[],
  ) => expect([...(actual ?? [])].sort()).toEqual([...expected].sort());

  it("#143-b b-AC-1・b-AC-2（O1）: 3つの操作と応答コードが書かれている（403 は管理者でないとき、404 は1件だけ）", () => {
    const expected: Record<string, string[]> = {
      "/api/admin/channels": ["200", "401", "403", "422"],
      "/api/admin/channels/{channelId}": ["200", "401", "403", "404", "422"],
      "/api/admin/deleted-items": ["200", "401", "403", "422"],
    };
    for (const [path, codes] of Object.entries(expected)) {
      const operation = op(path);
      expect(operation, path).toBeDefined();
      for (const code of codes)
        expect(Object.keys(operation?.responses ?? {}), path).toContain(code);
    }
    expect(
      Object.keys(op("/api/admin/channels")?.responses ?? {}),
    ).not.toContain("404");
  });

  it("#143-b b-AC-1（O1）: channelId の pattern は shared/ulid-rules.ts と同じ形", () => {
    expect(
      param("/api/admin/channels/{channelId}", "channelId")?.schema?.pattern,
    ).toBe(ULID);
  });

  it("#143-b b-AC-1（O1）: 一覧のクエリは q（1〜55 文字）・state・limit・cursor。state の enum は実装の定義と、計画の集合の両方と一致する", () => {
    const q = resolve(param("/api/admin/channels", "q")?.schema);
    expect(q?.maxLength).toBe(55);
    expect(q?.minLength).toBe(1);
    const state = resolve(param("/api/admin/channels", "state")?.schema);
    sameSet(state?.enum, ADMIN_CHANNEL_STATES);
    sameSet(state?.enum, ["all", "active", "archived"]);
    expect(param("/api/admin/channels", "limit")).toBeDefined();
    expect(param("/api/admin/channels", "cursor")).toBeDefined();
  });

  it("#143-b b-AC-2（O1）: アーカイブの一覧の type の enum は実装の定義と一致し、いまは channel だけ（case は #151）", () => {
    const type = resolve(param("/api/admin/deleted-items", "type")?.schema);
    sameSet(type?.enum, DELETED_ITEM_TYPES);
    sameSet(type?.enum, ["channel"]);
  });

  it("#143-b b-AC-1（O1）: AdminChannel は計画 5.1 の項目をすべて必須にし、id は ULID の形、purpose・visibility・state の enum は実装の定義と一致する", () => {
    const item = schema("AdminChannel");
    expect(item).toBeDefined();
    const keys = [
      "id",
      "name",
      "description",
      "purpose",
      "visibility",
      "department",
      "state",
      "version",
      "memberCount",
      "archive",
      "manage",
    ];
    const properties = item?.properties ?? {};
    const enumOf = (key: string) => resolve(properties[key])?.enum;
    sameSet(item?.required, keys);
    sameSet(Object.keys(properties), keys);
    expect(resolve(properties.id)?.pattern).toBe(ULID);
    sameSet(enumOf("purpose"), ADMIN_CHANNEL_PURPOSES);
    sameSet(enumOf("purpose"), [
      "normal",
      "department",
      "announcement",
      "company_general",
    ]);
    sameSet(enumOf("visibility"), CHANNEL_VISIBILITIES);
    sameSet(enumOf("visibility"), ["public", "private"]);
    sameSet(enumOf("state"), ["active", "archived"]);
    sameSet(Object.keys(nonNull(properties.manage)?.properties ?? {}), [
      "canRename",
      "canEditDescription",
      "canArchive",
      "canRestore",
    ]);
  });

  it("#143-b b-AC-1（O1）: 一覧の応答 AdminChannelPage は items と nextCursor だけで、件数（total）を持たない", () => {
    const page = schema("AdminChannelPage");
    sameSet(Object.keys(page?.properties ?? {}), ["items", "nextCursor"]);
  });

  it("#143-b b-AC-2（O1）: ArchivedItem は EP-2-40 の項目と version・department・canRestore を持ち、id は ULID の形。ArchivedItemPage は items と nextCursor だけ", () => {
    const item = schema("ArchivedItem");
    const keys = [
      "type",
      "id",
      "name",
      "caseNumber",
      "deletedBy",
      "deletedAt",
      "reason",
      "version",
      "department",
      "canRestore",
    ];
    sameSet(item?.required, keys);
    sameSet(Object.keys(item?.properties ?? {}), keys);
    expect(resolve(item?.properties?.id)?.pattern).toBe(ULID);
    sameSet(resolve(item?.properties?.type)?.enum, DELETED_ITEM_TYPES);
    sameSet(Object.keys(schema("ArchivedItemPage")?.properties ?? {}), [
      "items",
      "nextCursor",
    ]);
  });
});
