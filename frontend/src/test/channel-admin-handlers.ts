// #143-b：チャンネル管理（S-39）とアーカイブ（S-38）のテストで使う MSW の応答（架空のデータのみ）。
// 契約（計画 #143-b 5.1。backend/src/routes/admin-channels.test.ts・admin-deleted-items.test.ts と同じ）：
//   GET /api/admin/channels?q&state&limit&cursor → { items: AdminChannel[], nextCursor: string | null }
//   GET /api/admin/channels/:channelId → AdminChannel
//   GET /api/admin/deleted-items?type&limit&cursor → { items: ArchivedItem[], nextCursor: string | null }
//   AdminChannel：{ id, name, description, purpose, visibility, department: { id, name, isActive } | null, state, version, memberCount,
//                   archive: { archivedBy: { id, displayName }, archivedAt, reason } | null, manage: { canRename, canEditDescription, canArchive, canRestore } }
//   ArchivedItem：{ type: "channel", id, name, caseNumber: null, deletedBy: { id, displayName }, deletedAt, reason, version, department, canRestore }
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。ID は ULID の形（同じ引数に同じ値を返す）。
import { http, HttpResponse } from "msw";
import { SHELL_USER } from "./app-shell-harness";
import { server } from "./server";

export const CHANNEL_EDIT_PERMISSION = "perm.channel.edit";
export const CHANNEL_DELETE_PERMISSION = "perm.channel.delete";

const pad = (n: number, width: number) => String(n).padStart(width, "0");
/** n 番目のチャンネルの ID（26 文字の ULID の形） */
export const adminChannelId = (n: number) => `01JTEST143BCH${pad(n, 13)}`;
/** n 番目の部署の ID */
export const adminDepartmentId = (n: number) => `01JTEST143BDEPT${pad(n, 11)}`;
/** n 番目の利用者の ID */
export const adminMemberId = (n: number) => `01JTEST143BMEMB${pad(n, 11)}`;
/** n 番目のチャンネルの名前（架空） */
export const adminChannelName = (n: number) => `E2E_TEST_143b管理${pad(n, 3)}`;

export type AdminChannelManage = {
  canRename: boolean;
  canEditDescription: boolean;
  canArchive: boolean;
  canRestore: boolean;
};

export type AdminChannel = {
  id: string;
  name: string;
  description: string;
  purpose: "normal" | "department" | "announcement" | "company_general";
  visibility: "public" | "private";
  department: { id: string; name: string; isActive: boolean } | null;
  state: "active" | "archived";
  version: number;
  memberCount: number;
  archive: {
    archivedBy: { id: string; displayName: string };
    archivedAt: string;
    reason: string | null;
  } | null;
  manage: AdminChannelManage;
};

export type ArchivedItem = {
  type: "channel";
  id: string;
  name: string;
  caseNumber: null;
  deletedBy: { id: string; displayName: string };
  deletedAt: string;
  reason: string | null;
  version: number;
  department: { id: string; name: string; isActive: boolean } | null;
  canRestore: boolean;
};

export const ACTIVE_NORMAL_MANAGE: AdminChannelManage = {
  canRename: true,
  canEditDescription: true,
  canArchive: true,
  canRestore: false,
};
export const DESCRIPTION_ONLY_MANAGE: AdminChannelManage = {
  canRename: false,
  canEditDescription: true,
  canArchive: false,
  canRestore: false,
};
export const ARCHIVED_MANAGE: AdminChannelManage = {
  canRename: false,
  canEditDescription: false,
  canArchive: false,
  canRestore: true,
};

export const ARCHIVED_AT = "2026-11-15T00:00:00.000Z";

/** 一覧の1件（既定：部署 1 の、使用中の公開の通常のチャンネル。参加者 3 人） */
export function adminChannel(
  n: number,
  overrides: Partial<AdminChannel> = {},
): AdminChannel {
  return {
    id: adminChannelId(n),
    name: adminChannelName(n),
    description: "[E2E_TEST]説明",
    purpose: "normal",
    visibility: "public",
    department: {
      id: adminDepartmentId(1),
      name: "[E2E_TEST]部署143b",
      isActive: true,
    },
    state: "active",
    version: 3,
    memberCount: 3,
    archive: null,
    manage: ACTIVE_NORMAL_MANAGE,
    ...overrides,
  };
}

/** アーカイブ中の一覧の1件 */
export function archivedAdminChannel(
  n: number,
  overrides: Partial<AdminChannel> = {},
): AdminChannel {
  return adminChannel(n, {
    state: "archived",
    archive: {
      archivedBy: { id: adminMemberId(1), displayName: "testuser_143b_owner" },
      archivedAt: ARCHIVED_AT,
      reason: "[E2E_TEST]統合のため",
    },
    manage: ARCHIVED_MANAGE,
    ...overrides,
  });
}

/** アーカイブの一覧の1件（既定：testuser_143b_owner が理由つきでアーカイブ） */
export function archivedItem(
  n: number,
  overrides: Partial<ArchivedItem> = {},
): ArchivedItem {
  return {
    type: "channel",
    id: adminChannelId(n),
    name: adminChannelName(n),
    caseNumber: null,
    deletedBy: { id: adminMemberId(1), displayName: "testuser_143b_owner" },
    deletedAt: ARCHIVED_AT,
    reason: "[E2E_TEST]統合のため",
    version: 4,
    department: {
      id: adminDepartmentId(1),
      name: "[E2E_TEST]部署143b",
      isActive: true,
    },
    canRestore: true,
    ...overrides,
  };
}

export type Page<T> = { items: T[]; nextCursor: string | null };
type Responder<T> = (
  params: URLSearchParams,
  call: number,
) => Page<T> | Response | Promise<Page<T> | Response>;

/** GET /api/admin/channels。受けたクエリを順に返す */
export function respondAdminChannels(responder: Responder<AdminChannel>) {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get("/api/admin/channels", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      calls.push(params);
      const result = await responder(params, calls.length);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return calls;
}

/** GET /api/admin/channels/:channelId。受けた ID を順に返す */
export function respondAdminChannel(
  responder: (
    id: string,
  ) => AdminChannel | Response | Promise<AdminChannel | Response>,
) {
  const calls: string[] = [];
  server.use(
    http.get("/api/admin/channels/:channelId", async ({ params }) => {
      const id = String(params.channelId);
      calls.push(id);
      const result = await responder(id);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return calls;
}

/** GET /api/admin/deleted-items。受けたクエリを順に返す */
export function respondArchivedItems(responder: Responder<ArchivedItem>) {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get("/api/admin/deleted-items", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      calls.push(params);
      const result = await responder(params, calls.length);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return calls;
}

/** GET /api/auth/session：testuser_001 が、渡した権限を持つ */
export function respondChannelAdminSession(
  permissions: string[] = [CHANNEL_EDIT_PERMISSION, CHANNEL_DELETE_PERMISSION],
) {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SHELL_USER,
        permissions,
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
  );
}

/** 再認証（S-26）・アーカイブ・復元・名前と説明の変更の応答。送られた本文を順に返す */
export function respondManageWrites(
  options: {
    archive?: () => Response | Promise<Response>;
    restore?: () => Response | Promise<Response>;
    patch?: () => Response | Promise<Response>;
  } = {},
) {
  const sent = {
    archives: [] as { id: string; body: unknown }[],
    restores: [] as { id: string; body: unknown }[],
    patches: [] as { id: string; body: unknown }[],
    reauths: 0,
  };
  server.use(
    http.post("/api/auth/reauthenticate", () => {
      sent.reauths += 1;
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
    http.post(
      "/api/channels/:channelId/delete",
      async ({ request, params }) => {
        sent.archives.push({
          id: String(params.channelId),
          body: await request.json(),
        });
        if (options.archive) return options.archive();
        return HttpResponse.json({
          id: String(params.channelId),
          version: 4,
          deletedAt: "2026-11-17T00:00:00.000Z",
        });
      },
    ),
    http.post(
      "/api/channels/:channelId/restore",
      async ({ request, params }) => {
        sent.restores.push({
          id: String(params.channelId),
          body: await request.json(),
        });
        if (options.restore) return options.restore();
        return HttpResponse.json({
          id: String(params.channelId),
          version: 5,
          restoredAt: "2026-11-17T00:00:00.000Z",
        });
      },
    ),
    http.patch("/api/channels/:channelId", async ({ request, params }) => {
      sent.patches.push({
        id: String(params.channelId),
        body: await request.json(),
      });
      if (options.patch) return options.patch();
      return HttpResponse.json({
        id: String(params.channelId),
        name: "x",
        description: "x",
        version: 4,
        updatedAt: "2026-11-17T00:00:00.000Z",
      });
    }),
  );
  return sent;
}

/** 解決を手で制御する保留（固定の時間の待ちを使わない） */
export function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
