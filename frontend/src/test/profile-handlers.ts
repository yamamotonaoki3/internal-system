// #130：プロフィール・社員一覧・ステータスのテストで使う MSW の応答（架空のデータのみ）。サーバーの状態を持つ簡易な模擬。
// GET/PATCH /api/me/profile・GET /api/auth/session（表示名を状態から返す）・GET /api/users・GET /api/users/departments・
// GET /api/users/:userId/profile-card・PUT /api/users/:userId/status を、テストの中の状態で返す。書き込みは状態に反映する（再読込なしの更新を確かめるため）。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse } from "msw";
import { SHELL_USER } from "./app-shell-harness";
import { server } from "./server";

export type StatusKind =
  "available" | "away" | "absent" | "vacation" | "meeting";
export type Status = {
  kind: StatusKind;
  returnAt: string | null;
  message: string | null;
};

export const DEPT_SALES = {
  id: "01JTESTPROFDEPT0000000S001",
  name: "[E2E_TEST]営業部130",
} as const;
export const DEPT_DEV = {
  id: "01JTESTPROFDEPT0000000D001",
  name: "[E2E_TEST]開発部130",
} as const;

export type Member = {
  id: string;
  displayName: string;
  legalName: string;
  department: { id: string; name: string };
  extension: string | null;
  email: string;
  status: Status;
  canSetStatus: boolean;
};

export function member(n: number, overrides: Partial<Member> = {}): Member {
  const suffix = String(n).padStart(3, "0");
  return {
    id: `01JTESTPROFMEMBER000000${suffix}`,
    displayName: `テスト社員${suffix}`,
    legalName: `テスト本名${suffix}`,
    department: DEPT_SALES,
    extension: `1${suffix}`,
    email: `testuser_${suffix}@example.com`,
    status: { kind: "available", returnAt: null, message: null },
    canSetStatus: false,
    ...overrides,
  };
}

export type ProfileWorld = {
  self: {
    displayName: string;
    legalName: string;
    email: string;
    extension: string | null;
    jobTitle: string | null;
    department: { id: string; name: string } | null;
    status: Status;
  };
  members: Member[];
  /** PATCH /api/me/profile の本文 */
  patchBodies: Record<string, unknown>[];
  /** PUT /api/users/:userId/status の対象と本文 */
  putRequests: { userId: string; body: Record<string, unknown> }[];
  /** GET /api/users の要求（クエリの確認用） */
  listRequests: URL[];
  /** GET /api/users/:userId/profile-card の要求の利用者ID */
  cardRequests: string[];
  /** 1ページの件数（既定 20） */
  pageSize: number;
  /** 次の PATCH を、この応答で失敗させる（1回だけ） */
  failNextPatch: { status: number; body: unknown } | null;
};

const toDirectoryItem = (m: Member) => ({
  id: m.id,
  displayName: m.displayName,
  department: m.department,
  extension: m.extension,
  email: m.email,
  status: m.status,
  canSetStatus: m.canSetStatus,
});

/** 自分（SHELL_USER）を members に含めたいときは、id を SHELL_USER.id にした Member を渡す */
export function respondProfileWorld(
  options: {
    self?: Partial<ProfileWorld["self"]>;
    members?: Member[];
    pageSize?: number;
    permissions?: string[];
  } = {},
): ProfileWorld {
  const world: ProfileWorld = {
    self: {
      displayName: SHELL_USER.displayName,
      legalName: "テスト花子",
      email: "testuser_001@example.com",
      extension: "1001",
      jobTitle: "テスト係",
      department: DEPT_SALES,
      status: { kind: "available", returnAt: null, message: null },
      ...options.self,
    },
    members: (options.members ?? []).map((m) => ({ ...m })),
    patchBodies: [],
    putRequests: [],
    listRequests: [],
    cardRequests: [],
    pageSize: options.pageSize ?? 20,
    failNextPatch: null,
  };

  const syncSelfRow = () => {
    const row = world.members.find((m) => m.id === SHELL_USER.id);
    if (row) {
      row.displayName = world.self.displayName;
      row.status = { ...world.self.status };
    }
  };

  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: { ...SHELL_USER, displayName: world.self.displayName },
        permissions: options.permissions ?? [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
    http.get("/api/me/profile", () =>
      HttpResponse.json({
        id: SHELL_USER.id,
        loginId: SHELL_USER.loginId,
        ...world.self,
      }),
    ),
    http.patch("/api/me/profile", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      world.patchBodies.push(body);
      if (world.failNextPatch !== null) {
        const failure = world.failNextPatch;
        world.failNextPatch = null;
        return HttpResponse.json(failure.body as Record<string, unknown>, {
          status: failure.status,
        });
      }
      if (typeof body.displayName === "string")
        world.self.displayName = body.displayName.trim();
      if (typeof body.status === "string") {
        world.self.status.kind = body.status as StatusKind;
        if (body.status === "available") world.self.status.returnAt = null;
      }
      if ("returnAt" in body)
        world.self.status.returnAt = (body.returnAt as string | null) ?? null;
      if ("statusMessage" in body) {
        const text =
          typeof body.statusMessage === "string"
            ? body.statusMessage.trim()
            : "";
        world.self.status.message = text === "" ? null : text;
      }
      syncSelfRow();
      return HttpResponse.json({
        displayName: world.self.displayName,
        status: world.self.status.kind,
        returnAt: world.self.status.returnAt,
        statusMessage: world.self.status.message,
        updatedAt: "2026-11-11T00:00:00.000Z",
      });
    }),
    http.get("/api/users/departments", () =>
      HttpResponse.json({ items: [DEPT_SALES, DEPT_DEV] }),
    ),
    http.get("/api/users", ({ request }) => {
      const url = new URL(request.url);
      world.listRequests.push(url);
      const departmentId = url.searchParams.get("departmentId");
      const cursor = url.searchParams.get("cursor");
      const filtered = world.members.filter(
        (m) => departmentId === null || m.department.id === departmentId,
      );
      const start = cursor === null ? 0 : Number(cursor.replace("c", ""));
      const items = filtered.slice(start, start + world.pageSize);
      const next = start + world.pageSize;
      return HttpResponse.json({
        items: items.map(toDirectoryItem),
        nextCursor: next < filtered.length ? `c${next}` : null,
      });
    }),
    http.get("/api/users/:userId/profile-card", ({ params }) => {
      const userId = String(params.userId);
      world.cardRequests.push(userId);
      const found = world.members.find((m) => m.id === userId);
      if (!found)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "見つかりませんでした" },
          { status: 404 },
        );
      return HttpResponse.json({
        userId: found.id,
        displayName: found.displayName,
        legalName: found.legalName,
        department: found.department,
        status: found.status,
      });
    }),
    http.put("/api/users/:userId/status", async ({ params, request }) => {
      const userId = String(params.userId);
      const body = (await request.json()) as Record<string, unknown>;
      world.putRequests.push({ userId, body });
      const found = world.members.find((m) => m.id === userId);
      if (!found)
        return HttpResponse.json(
          { code: "NOT_FOUND", message: "見つかりませんでした" },
          { status: 404 },
        );
      found.status = {
        ...found.status,
        kind: body.status as StatusKind,
        returnAt:
          body.status === "available"
            ? null
            : ((body.returnAt as string | undefined) ?? null),
      };
      return HttpResponse.json({
        userId,
        status: found.status.kind,
        returnAt: found.status.returnAt,
        updatedAt: "2026-11-11T00:00:00.000Z",
      });
    }),
  );
  return world;
}
