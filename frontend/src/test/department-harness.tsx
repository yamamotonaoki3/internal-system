// #196 部署管理の画面のテストで使う、架空の応答と描画の部品（MSW）。データはすべて架空（testuser_dept_・E2E でない [UNIT_TEST]）。
// 一覧（GET /api/admin/departments）・候補（GET /api/admin/departments/owner-candidates）・作成・改名・交代の応答を、
// テストの中の配列で状態として持ち、成功した書き込みのあとの一覧に反映する（再読込なしの更新を確かめるため）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { authKeys } from "../features/auth/api/query-keys";
import { ReauthProvider } from "../features/auth/ReauthProvider";
import { TEST_USER } from "./auth-handlers";
import { server } from "./server";

export type DepartmentItem = {
  id: string;
  name: string;
  isActive: boolean;
  ownerUserId: string;
  ownerDisplayName: string;
  memberCount: number;
  version: number;
};

export type Candidate = {
  id: string;
  displayName: string;
  departmentId: string | null;
  ownedDepartmentId: string | null;
  isGlobalAdmin: boolean;
};

export const ADMIN: Candidate = {
  id: "01JTESTDEPTADMIN0000000001",
  displayName: "テスト管理者",
  departmentId: "01JTESTDEPTHQ0000000000001",
  ownedDepartmentId: "01JTESTDEPTHQ0000000000001",
  isGlobalAdmin: true,
};
export const OWNER_SALES: Candidate = {
  id: "01JTESTDEPTOWNERS000000001",
  displayName: "テスト営業オーナー",
  departmentId: "01JTESTDEPTSALES0000000001",
  ownedDepartmentId: "01JTESTDEPTSALES0000000001",
  isGlobalAdmin: false,
};
export const MEMBER_SALES: Candidate = {
  id: "01JTESTDEPTMEMBERS00000001",
  displayName: "テスト営業メンバー",
  departmentId: "01JTESTDEPTSALES0000000001",
  ownedDepartmentId: null,
  isGlobalAdmin: false,
};
export const MEMBER_DEV: Candidate = {
  id: "01JTESTDEPTMEMBERD00000001",
  displayName: "テスト開発メンバー",
  departmentId: "01JTESTDEPTDEV00000000001",
  ownedDepartmentId: null,
  isGlobalAdmin: false,
};
export const ALL_CANDIDATES = [ADMIN, OWNER_SALES, MEMBER_SALES, MEMBER_DEV];

export const HQ: DepartmentItem = {
  id: "01JTESTDEPTHQ0000000000001",
  name: "[UNIT_TEST]本部",
  isActive: true,
  ownerUserId: ADMIN.id,
  ownerDisplayName: ADMIN.displayName,
  memberCount: 1,
  version: 1,
};
export const SALES: DepartmentItem = {
  id: "01JTESTDEPTSALES0000000001",
  name: "[UNIT_TEST]営業",
  isActive: true,
  ownerUserId: OWNER_SALES.id,
  ownerDisplayName: OWNER_SALES.displayName,
  memberCount: 2,
  version: 3,
};
export const DEV: DepartmentItem = {
  id: "01JTESTDEPTDEV00000000001",
  name: "[UNIT_TEST]開発",
  isActive: true,
  ownerUserId: ADMIN.id,
  ownerDisplayName: ADMIN.displayName,
  memberCount: 1,
  version: 1,
};

export const CONFLICT_MESSAGE =
  "同じ名前の部署またはチャンネルがあります。別の部署名を入力してください";

export type Sent = { method: string; path: string; body: unknown };

/** 一覧・候補・書き込みの架空の応答を入れる。sent に送った要求を記録する */
export function respondDepartments(
  initial: DepartmentItem[] = [HQ, SALES, DEV],
  candidates: Candidate[] = ALL_CANDIDATES,
) {
  let items = [...initial];
  const sent: Sent[] = [];
  let listCalls = 0;
  server.use(
    http.get("/api/admin/departments", () => {
      listCalls += 1;
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.get("/api/admin/departments/owner-candidates", () =>
      HttpResponse.json({ items: candidates, nextCursor: null }),
    ),
    http.post("/api/departments", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push({ method: "POST", path: "/api/departments", body });
      const owner = candidates.find((c) => c.id === body.ownerUserId) ?? ADMIN;
      const created: DepartmentItem = {
        id: "01JTESTDEPTNEW00000000001",
        name: String(body.name).trim(),
        isActive: true,
        ownerUserId: owner.id,
        ownerDisplayName: owner.displayName,
        memberCount: owner.isGlobalAdmin ? 0 : 1,
        version: 1,
      };
      items = [...items, created];
      return HttpResponse.json(
        {
          id: created.id,
          name: created.name,
          description: String(body.description ?? ""),
          ownerUserId: owner.id,
          dedicatedChannelId: "01JTESTROOMNEW0000000000A1",
          announcementChannelId: "01JTESTROOMNEW0000000000A2",
          version: 1,
          createdAt: "2026-11-09T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.patch("/api/admin/departments/:id", async ({ request, params }) => {
      const body = (await request.json()) as { name: string; version: number };
      sent.push({
        method: "PATCH",
        path: `/api/admin/departments/${String(params.id)}`,
        body,
      });
      items = items.map((item) =>
        item.id === params.id
          ? { ...item, name: body.name.trim(), version: item.version + 1 }
          : item,
      );
      const updated = items.find((item) => item.id === params.id);
      return HttpResponse.json({
        id: updated?.id,
        name: updated?.name,
        version: updated?.version,
        updatedAt: "2026-11-09T00:00:00.000Z",
      });
    }),
    http.put("/api/departments/:id/owner", async ({ request, params }) => {
      const body = (await request.json()) as {
        ownerUserId: string;
        previousDepartmentSuccessorUserId?: string | null;
        version: number;
      };
      sent.push({
        method: "PUT",
        path: `/api/departments/${String(params.id)}/owner`,
        body,
      });
      const owner = candidates.find((c) => c.id === body.ownerUserId);
      const successor = candidates.find(
        (c) => c.id === body.previousDepartmentSuccessorUserId,
      );
      items = items.map((item) => {
        if (item.id === params.id && owner)
          return {
            ...item,
            ownerUserId: owner.id,
            ownerDisplayName: owner.displayName,
            version: item.version + 1,
          };
        if (successor && item.id === owner?.ownedDepartmentId)
          return {
            ...item,
            ownerUserId: successor.id,
            ownerDisplayName: successor.displayName,
            version: item.version + 1,
          };
        return item;
      });
      const updated = items.find((item) => item.id === params.id);
      return HttpResponse.json({
        departmentId: params.id,
        ownerUserId: body.ownerUserId,
        version: updated?.version,
        updatedAt: "2026-11-09T00:00:00.000Z",
      });
    }),
  );
  return {
    sent,
    listCalls: () => listCalls,
  };
}

/** 書き込みを失敗させる（409・422 などの表示を確かめる） */
export function failWrite(
  method: "post" | "patch" | "put",
  path: string,
  status: number,
  body: { code: string; message: string; fields?: string[] },
) {
  const sent: unknown[] = [];
  server.use(
    http[method](path, async ({ request }) => {
      sent.push(await request.json());
      return HttpResponse.json(body, { status });
    }),
  );
  return sent;
}

/** 再認証のAPI。呼ばれた回数を返す */
export function respondReauth() {
  let calls = 0;
  server.use(
    http.post("/api/auth/reauthenticate", () => {
      calls += 1;
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
  );
  return { calls: () => calls };
}

/**
 * 部署管理の画面を、ReauthProvider・TanStack Query・ルーターの中に描画する。
 * reauthenticatedAt を現在時刻にすると、再認証のダイアログを出さずに操作が進む。
 */
export function renderDepartments(
  routes: { path: string; element: ReactNode }[],
  options: { at: string; reauthenticatedAt?: string | null },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const session = {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: options.reauthenticatedAt ?? null,
    permissions: ["perm.client.manage", "perm.workspace.create"],
  };
  client.setQueryData(authKeys.session, session);
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session)));
  const user = userEvent.setup();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.at]}>
        <ReauthProvider>
          <Routes>
            {routes.map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={route.element}
              />
            ))}
          </Routes>
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client, ...rendered };
}
