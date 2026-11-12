// #131 チャンネルの作成申請の画面（S-10・S-11）のテストで使う、架空の応答と描画の部品（MSW）。データはすべて架空（testuser_・テスト太郎・UNIT_TEST_）。
// 自分の申請（GET /api/channel-requests/mine）と審査一覧（GET /api/channel-requests）を、テストの中の配列で状態として持ち、
// 成功した書き込み（申請・取り下げ・承認・却下）のあとの一覧に反映する（再読込なしの更新を確かめるため）。
// 応答の形は、バックエンドのテスト（backend/src/routes/channel-requests*.test.ts）が決めた契約と同じ。
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

export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export type MyRequest = {
  id: string;
  departmentId: string | null;
  name: string;
  visibility: "public" | "private";
  status: RequestStatus;
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  channelId: string | null;
};

export type ReviewRequest = MyRequest & {
  requesterId: string;
  requesterDisplayName: string;
  canApprove: boolean;
};

export const DEPT_SALES = {
  id: "01JTESTCHREQDEPTSALES0001",
  name: "[UNIT_TEST]営業",
};
export const NOW = "2026-11-12T00:00:00.000Z";
export const APPROVE_PERMISSION = "perm.channel.request.approve.owner";

/** サーバーの 409 の文言（バックエンドのテストが決めた文言） */
export const SERVER_MESSAGES = {
  decided: "この申請はすでに処理されています",
  nameTakenOnApprove:
    "同じ名前のチャンネルがあるため承認できません。却下してください",
  departmentInactive: "部署が無効のため承認できません",
  createConflict: "同じ名前のチャンネルか承認待ちの申請があります",
} as const;

export function myRequest(
  suffix: string,
  overrides: Partial<MyRequest> = {},
): MyRequest {
  return {
    id: `01JTESTCHREQ${suffix.padStart(14, "0")}`.slice(0, 26),
    departmentId: DEPT_SALES.id,
    name: `UNIT_TEST_申請${suffix}`,
    visibility: "public",
    status: "pending",
    rejectReason: null,
    createdAt: NOW,
    decidedAt: null,
    channelId: null,
    ...overrides,
  };
}

export function reviewRequest(
  suffix: string,
  overrides: Partial<ReviewRequest> = {},
): ReviewRequest {
  return {
    ...myRequest(suffix),
    requesterId: "01JTESTCHREQREQUESTER0001",
    requesterDisplayName: "テスト申請者",
    canApprove: true,
    ...overrides,
  };
}

/** GET /api/me/profile：所属（null は所属なし）を選べる */
export function respondProfileDepartment(
  department: { id: string; name: string } | null,
) {
  server.use(
    http.get("/api/me/profile", () =>
      HttpResponse.json({
        id: TEST_USER.id,
        loginId: TEST_USER.loginId,
        displayName: TEST_USER.displayName,
        legalName: "テスト花子",
        email: "testuser_001@example.com",
        extension: null,
        jobTitle: null,
        department,
        status: { kind: "available", returnAt: null, message: null },
      }),
    ),
  );
}

export type Sent = { method: string; path: string; body: unknown };

/** 自分の申請の一覧と、申請・取り下げの架空の応答。sent に送った要求を記録する */
export function respondMyRequests(initial: MyRequest[] = []) {
  let items = [...initial];
  const sent: Sent[] = [];
  let listCalls = 0;
  server.use(
    http.get("/api/channel-requests/mine", () => {
      listCalls += 1;
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.post("/api/channel-requests", async ({ request }) => {
      const body = (await request.json()) as {
        scope: string;
        name: string;
        visibility: "public" | "private";
      };
      sent.push({ method: "POST", path: "/api/channel-requests", body });
      const created = myRequest("NEW", {
        departmentId: body.scope === "department" ? DEPT_SALES.id : null,
        name: String(body.name).trim(),
        visibility: body.visibility,
      });
      items = [created, ...items];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(
      "/api/channel-requests/:requestId/withdraw",
      async ({ params }) => {
        const path = `/api/channel-requests/${String(params.requestId)}/withdraw`;
        sent.push({ method: "POST", path, body: null });
        items = items.map((item) =>
          item.id === params.requestId
            ? { ...item, status: "withdrawn", decidedAt: NOW }
            : item,
        );
        return HttpResponse.json({
          requestId: params.requestId,
          status: "withdrawn",
        });
      },
    ),
  );
  return { sent, listCalls: () => listCalls };
}

/** 審査一覧と、承認・却下の架空の応答。status の絞り込みを反映し、queries に一覧の取得のクエリを記録する */
export function respondReviewRequests(initial: ReviewRequest[] = []) {
  let items = [...initial];
  const sent: Sent[] = [];
  const queries: URLSearchParams[] = [];
  server.use(
    http.get("/api/channel-requests", ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      const status = params.get("status");
      return HttpResponse.json({
        items: items.filter(
          (item) => status === null || item.status === status,
        ),
        nextCursor: null,
      });
    }),
    http.post("/api/channel-requests/:requestId/approve", ({ params }) => {
      const id = String(params.requestId);
      sent.push({
        method: "POST",
        path: `/api/channel-requests/${id}/approve`,
        body: null,
      });
      items = items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "approved",
              canApprove: false,
              decidedAt: NOW,
              channelId: "01JTESTCHREQNEWROOM000001",
            }
          : item,
      );
      return HttpResponse.json({
        requestId: id,
        status: "approved",
        channelId: "01JTESTCHREQNEWROOM000001",
        roomId: "01JTESTCHREQNEWROOM000001",
      });
    }),
    http.post(
      "/api/channel-requests/:requestId/reject",
      async ({ params, request }) => {
        const id = String(params.requestId);
        const body = (await request.json()) as { reason: string };
        sent.push({
          method: "POST",
          path: `/api/channel-requests/${id}/reject`,
          body,
        });
        items = items.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "rejected",
                canApprove: false,
                decidedAt: NOW,
                rejectReason: body.reason.trim(),
              }
            : item,
        );
        return HttpResponse.json({
          requestId: id,
          status: "rejected",
          reason: body.reason.trim(),
        });
      },
    ),
  );
  return { sent, queries };
}

/** 書き込みを失敗させる（409・422 などの表示を確かめる）。送った本文を記録する */
export function failPost(
  path: string,
  status: number,
  body: { code: string; message: string; fields?: string[] },
) {
  const sent: unknown[] = [];
  server.use(
    http.post(path, async ({ request }) => {
      const text = await request.text();
      sent.push(text === "" ? null : JSON.parse(text));
      return HttpResponse.json(body, { status });
    }),
  );
  return sent;
}

/** 再認証の API。呼ばれた回数を返す */
export function respondReauthOk() {
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
 * 画面を、ReauthProvider・TanStack Query・ルーターの中に描画する。
 * reauthenticatedAt を現在時刻にすると、再認証のダイアログを出さずに操作が進む。
 */
export function renderChannelRequestScreen(
  element: ReactNode,
  options: {
    at: string;
    path: string;
    reauthenticatedAt?: string | null;
    permissions?: string[];
  },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const session = {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: options.reauthenticatedAt ?? null,
    permissions: options.permissions ?? [APPROVE_PERMISSION],
  };
  client.setQueryData(authKeys.session, session);
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session)));
  const user = userEvent.setup();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.at]}>
        <ReauthProvider>
          <Routes>
            <Route path={options.path} element={element} />
          </Routes>
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client, ...rendered };
}
