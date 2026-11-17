// #146（146-A）案件の作成の申請の画面（S-18）のテストで使う、架空の応答と描画の部品（MSW）。データはすべて架空（testuser_・テスト太郎・[UNIT_TEST]）。
// 自分の申請（GET /api/case-requests/mine）をテストの中の配列で状態として持ち、成功した書き込み（申請・取り下げ）のあとの一覧に反映する。
// 応答の形は、バックエンドのテスト（backend/src/routes/case-requests.test.ts）が決めた契約と同じ。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { authKeys } from "../features/auth/api/query-keys";
import { TEST_USER } from "./auth-handlers";
import { server } from "./server";

export { respondProfileDepartment } from "./channel-request-handlers";

export type CaseRequestStatus =
  "pending" | "approved" | "rejected" | "withdrawn" | "auto_cancelled";

export type CaseRequestItem = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  client: { id: string; code: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  candidates: { userId: string; displayName: string }[];
  status: CaseRequestStatus;
  rejectReason: string | null;
  caseId: string | null;
  /** 146-B：承認済みなら案件番号、それ以外は null */
  caseNumber: string | null;
  resubmittedFrom: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export const NOW = "2026-11-17T03:00:00.000Z";
export const CLIENT_A = {
  id: "01JTESTCASEREQCLIENT00001",
  code: "QZA",
  name: "テスト商事A [UNIT_TEST]",
};
export const CLIENT_B = {
  id: "01JTESTCASEREQCLIENT00002",
  code: "QZB",
  name: "テスト商事B [UNIT_TEST]",
};
export const DEPT_SALES = {
  id: "01JTESTCASEREQDEPTSALES01",
  name: "[UNIT_TEST]営業",
};
export const DEPT_DEV = {
  id: "01JTESTCASEREQDEPTDEV0001",
  name: "[UNIT_TEST]開発",
};
export const CANDIDATE = {
  id: "01JTESTCASEREQCANDIDATE01",
  displayName: "testuser_casereq_d1",
};
/** 全体管理者だけがセッションの permissions に持つもの（表示の制御。認可はサーバー） */
export const ADMIN_PERMISSIONS = [
  "perm.client.manage",
  "perm.account.create",
  "perm.workspace.create",
  "perm.channel.request.approve.owner",
];

/** 画面に出す文言（要件・計画で決まっているもの） */
export const TEXTS = {
  caution:
    "件名は参加していない人にも見える場合があります。機密情報を書かないでください",
  similar: "似た案件があります",
  formatted: "表記を整えて保存しました",
  submitted: "案件の作成を申請しました。承認されると案件が作られます",
  noDepartment: "所属部署がないため申請できません",
  decided: "この申請はすでに処理されています",
} as const;

export function caseRequestItem(
  suffix: string,
  overrides: Partial<CaseRequestItem> = {},
): CaseRequestItem {
  return {
    id: `01JTESTCASEREQ${suffix.padStart(12, "0")}`.slice(0, 26),
    title: `[UNIT_TEST]案件${suffix}`,
    description: "",
    dueDate: null,
    client: { ...CLIENT_A, isActive: true },
    departments: [{ ...DEPT_SALES, isActive: true }],
    candidates: [],
    status: "pending",
    rejectReason: null,
    caseId: null,
    caseNumber: null,
    resubmittedFrom: null,
    createdAt: NOW,
    decidedAt: null,
    ...overrides,
  };
}

/** 取引先の候補・部署・社員の検索の応答（選ぶ欄の候補） */
export function respondChoices() {
  const userQueries: string[] = [];
  server.use(
    http.get("/api/clients/candidates", () =>
      HttpResponse.json({ items: [CLIENT_A, CLIENT_B], nextCursor: null }),
    ),
    http.get("/api/users/departments", () =>
      HttpResponse.json({ items: [DEPT_SALES, DEPT_DEV] }),
    ),
    http.get("/api/users", ({ request }) => {
      userQueries.push(new URL(request.url).searchParams.get("q") ?? "");
      return HttpResponse.json({
        items: [
          {
            id: CANDIDATE.id,
            displayName: CANDIDATE.displayName,
            department: DEPT_DEV,
            extension: null,
            email: "testuser_casereq_d1@example.com",
            status: { kind: "available", returnAt: null, message: null },
            canSetStatus: false,
          },
        ],
        nextCursor: null,
      });
    }),
  );
  return { userQueries };
}

/** 類似件名の確認。hasSimilar を選べる。送ったクエリを記録する */
export function respondSimilar(hasSimilar: boolean) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get("/api/case-requests/similar-title", ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return HttpResponse.json({
        hasSimilar,
        formattedTitle: (params.get("title") ?? "").trim(),
      });
    }),
  );
  return { queries };
}

export type Sent = { method: string; path: string; body: unknown };

/**
 * 自分の申請の一覧と、申請・取り下げの架空の応答。sent に送った要求を記録する。
 * pages を渡すと、cursor ごとのページで返す（次のページの確認用）。
 */
export function respondMyCaseRequests(
  initial: CaseRequestItem[] = [],
  options: { titleFormatted?: boolean; hasSimilarTitle?: boolean } = {},
) {
  let items = [...initial];
  const sent: Sent[] = [];
  let listCalls = 0;
  server.use(
    http.get("/api/case-requests/mine", () => {
      listCalls += 1;
      return HttpResponse.json({ items, nextCursor: null });
    }),
    http.post("/api/case-requests", async ({ request }) => {
      const body = (await request.json()) as {
        title: string;
        clientId: string;
        departmentIds: string[];
        resubmitOf?: string;
      };
      sent.push({ method: "POST", path: "/api/case-requests", body });
      const created = caseRequestItem("NEW", {
        title: body.title.trim(),
        resubmittedFrom: body.resubmitOf ?? null,
      });
      items = [created, ...items];
      return HttpResponse.json(
        {
          ...created,
          titleFormatted: options.titleFormatted ?? false,
          hasSimilarTitle: options.hasSimilarTitle ?? false,
        },
        { status: 201 },
      );
    }),
    http.post("/api/case-requests/:requestId/withdraw", ({ params }) => {
      const id = String(params.requestId);
      sent.push({
        method: "POST",
        path: `/api/case-requests/${id}/withdraw`,
        body: null,
      });
      items = items.map((item) =>
        item.id === id
          ? { ...item, status: "withdrawn" as const, decidedAt: NOW }
          : item,
      );
      return HttpResponse.json({ requestId: id, status: "withdrawn" });
    }),
  );
  return { sent, listCalls: () => listCalls };
}

/** 自分の申請を cursor ごとのページで返す（次のページの確認用） */
export function respondMyCaseRequestPages(pages: CaseRequestItem[][]) {
  const cursors: (string | null)[] = [];
  server.use(
    http.get("/api/case-requests/mine", ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      cursors.push(cursor);
      const index = cursor === null ? 0 : Number(cursor.replace("page-", ""));
      const next = index + 1 < pages.length ? `page-${index + 1}` : null;
      return HttpResponse.json({ items: pages[index] ?? [], nextCursor: next });
    }),
  );
  return { cursors };
}

/** 書き込みを失敗させる（409・422・403 の表示を確かめる）。送った本文を記録する */
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

export type SessionUser = { id: string; displayName: string; loginId: string };

/** 画面を、TanStack Query・ルーターの中に描画する。セッションの利用者と permissions を選べる */
export function renderCaseRequestScreen(
  element: ReactNode,
  options: {
    at?: string;
    path?: string;
    permissions?: string[];
    user?: SessionUser;
    client?: QueryClient;
  } = {},
) {
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
  const session = {
    user: options.user ?? TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: options.permissions ?? [],
  };
  client.setQueryData(authKeys.session, session);
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session)));
  const user = userEvent.setup();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.at ?? "/case-requests"]}>
        <Routes>
          <Route path={options.path ?? "/case-requests"} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client, ...rendered };
}
