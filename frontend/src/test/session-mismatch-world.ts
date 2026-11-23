// #298：画面の利用者とセッションの利用者が食い違うときの、App 全体のテストで使う模擬のサーバー（架空のデータのみ）。
// 模擬のサーバーは「Cookie のセッションの利用者」（serverUser）を持ち、PR-1 のサーバーの契約（ADR-0035・C-209）と同じに断る：
//   要求ヘッダー X-Expected-User-Id が無い → 通す／serverUser と同じ → 通す／違う → 409 SESSION_USER_MISMATCH（セッションがあるときだけ）
//   セッションが無い（serverUser が null）→ 認証の要る API は 401 UNAUTHENTICATED（ヘッダーがあっても）
// ヘッダーの名前・コードは、本番の定義から取り込まず、ここにリテラルで書く（期待の値を独立に持つため）。
// 届いた要求は、メソッド・パス・ヘッダー・返したステータスを記録する（ヘッダーが A であることを、比べた結果と別に確かめるため）。
// 名前を use〜 にしない（React Hooks の規則の誤検知を避ける）。
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { respondPublicStatus } from "./auth-handlers";
import { server } from "./server";

export const EXPECTED_USER_HEADER = "X-Expected-User-Id";

export type MismatchUser = {
  id: string;
  displayName: string;
  loginId: string;
};

export const MISMATCH_USER_A: MismatchUser = {
  id: "01JTESTUSER298WORLDA000001",
  displayName: "testuser_298_wa",
  loginId: "testuser_298_wa",
};
export const MISMATCH_USER_B: MismatchUser = {
  id: "01JTESTUSER298WORLDB000001",
  displayName: "testuser_298_wb",
  loginId: "testuser_298_wb",
};
export const MISMATCH_CHANNEL_ID = "01JTESTCHAN298WORLD0000001";

export type RecordedRequest = {
  method: string;
  path: string;
  header: string | null;
  status: number;
};

export type MismatchWorld = {
  /** 模擬のサーバーの、Cookie のセッションの利用者（null は未ログイン） */
  serverUser: MismatchUser | null;
  mustChangePassword: boolean;
  /** セッションの取得（GET /api/auth/session）を保留する */
  sessionHold: Promise<void> | null;
  /** 添付のアップロードを保留する（届いた時点で比べ、応答だけを保留する） */
  uploadHold: Promise<void> | null;
  /** 届いた要求（セッションの取得を含む） */
  requests: RecordedRequest[];
  /** 受け付けた投稿（作成者として扱った利用者の ID と本文） */
  acceptedPosts: { userId: string; body: string }[];
  /** 初回セットアップが済んだか */
  setupDone: boolean;
};

const json = (body: unknown, status = 200) =>
  HttpResponse.json(body as Record<string, unknown>, { status });

function sessionBody(user: MismatchUser, mustChangePassword: boolean) {
  return {
    user,
    permissions: [],
    mustChangePassword,
    reauthenticatedAt: null,
  };
}

export function respondMismatchWorld(
  initial: MismatchUser | null,
): MismatchWorld {
  const world: MismatchWorld = {
    serverUser: initial,
    mustChangePassword: false,
    sessionHold: null,
    uploadHold: null,
    requests: [],
    acceptedPosts: [],
    setupDone: true,
  };
  respondPublicStatus();

  const record = (request: Request, status: number) => {
    world.requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      header: request.headers.get(EXPECTED_USER_HEADER),
      status,
    });
  };

  /** サーバーの契約どおりに断るか、通すなら、その時点の利用者で応答を作る */
  const guarded =
    (
      make: (
        user: MismatchUser,
        info: Parameters<HttpResponseResolver>[0],
      ) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown },
    ): HttpResponseResolver =>
    async (info) => {
      const { request } = info;
      const user = world.serverUser;
      const header = request.headers.get(EXPECTED_USER_HEADER);
      if (user === null) {
        record(request, 401);
        return json(
          { code: "UNAUTHENTICATED", message: "ログインしてください" },
          401,
        );
      }
      if (header !== null && header !== user.id) {
        record(request, 409);
        return json(
          {
            code: "SESSION_USER_MISMATCH",
            message: "[UNIT_TEST]298画面の利用者とセッションの利用者が違います",
          },
          409,
        );
      }
      const { status, body } = await make(user, info);
      record(request, status);
      if (status === 204) return new HttpResponse(null, { status: 204 });
      return json(body, status);
    };

  server.use(
    http.get("/api/auth/session", async ({ request }) => {
      const user = world.serverUser;
      const hold = world.sessionHold;
      if (hold !== null) await hold;
      if (user === null) {
        record(request, 401);
        return json(
          { code: "UNAUTHENTICATED", message: "ログインしてください" },
          401,
        );
      }
      record(request, 200);
      return json(sessionBody(user, world.mustChangePassword));
    }),
    http.post("/api/auth/login", async ({ request }) => {
      const { loginId } = (await request.json()) as { loginId: string };
      const user = [MISMATCH_USER_A, MISMATCH_USER_B].find(
        (candidate) => candidate.loginId === loginId,
      );
      if (user === undefined) {
        record(request, 401);
        return json(
          {
            code: "INVALID_CREDENTIALS",
            message: "ユーザーIDまたはパスワードが違います",
          },
          401,
        );
      }
      world.serverUser = user;
      record(request, 200);
      return json(sessionBody(user, world.mustChangePassword));
    }),
    // ログアウト：公開の経路だが、セッションがあれば食い違いを断る（AC-2）。セッションが無ければ 204（べき等）
    http.post("/api/auth/logout", async ({ request }) => {
      const user = world.serverUser;
      const header = request.headers.get(EXPECTED_USER_HEADER);
      if (user !== null && header !== null && header !== user.id) {
        record(request, 409);
        return json(
          { code: "SESSION_USER_MISMATCH", message: "[UNIT_TEST]298食い違い" },
          409,
        );
      }
      world.serverUser = null;
      record(request, 204);
      return new HttpResponse(null, { status: 204 });
    }),
    http.put(
      "/api/me/password",
      guarded((user) => {
        world.mustChangePassword = false;
        return { status: 200, body: sessionBody(user, false) };
      }),
    ),
    http.get("/api/setup/status", () =>
      json({ setupRequired: !world.setupDone }),
    ),
    http.post("/api/setup", ({ request }) => {
      world.setupDone = true;
      record(request, 201);
      return json(
        {
          user: {
            id: MISMATCH_USER_A.id,
            loginId: MISMATCH_USER_A.loginId,
            displayName: MISMATCH_USER_A.displayName,
          },
          initialPassword: "Tq7#xZ9!mK2$pW4v",
        },
        201,
      );
    }),
    http.get(
      "/api/channels/:channelId",
      guarded((user, { params }) => ({
        status: 200,
        body: {
          id: String(params.channelId),
          roomId: String(params.channelId),
          name: `[UNIT_TEST]298${user.displayName}の部屋`,
          description: `[UNIT_TEST]298${user.displayName}の説明`,
          visibility: "public",
          departmentId: null,
          isCaseChannel: false,
          caseId: null,
          version: 1,
          manage: {
            canRename: false,
            canEditDescription: false,
            canArchive: false,
          },
          readOnly: false,
          joined: true,
          canPost: true,
          memberCount: 1,
          members: [{ id: user.id, displayName: user.displayName }],
        },
      })),
    ),
    http.get(
      "/api/rooms/:roomId/messages",
      guarded(() => ({
        status: 200,
        body: { items: [], nextCursor: null, hasMore: false },
      })),
    ),
    http.post(
      "/api/rooms/:roomId/attachments",
      guarded(async (_user, { request }) => {
        const name = decodeURIComponent(
          request.headers.get("X-File-Name") ?? "",
        );
        const size = (await request.arrayBuffer()).byteLength;
        const hold = world.uploadHold;
        if (hold !== null) await hold;
        return {
          status: 201,
          body: {
            id: "01JTESTATT298WORLD00000001",
            name,
            kind: "document",
            contentType: "application/pdf",
            size,
            publicationVisibility: null,
          },
        };
      }),
    ),
    http.post(
      "/api/rooms/:roomId/messages",
      guarded(async (user, { request, params }) => {
        const { body } = (await request.json()) as { body: string };
        world.acceptedPosts.push({ userId: user.id, body });
        return {
          status: 201,
          body: {
            id: "01JTESTMSG298WORLD00000001",
            roomId: String(params.roomId),
            createdAt: "2026-11-24T00:00:00.000Z",
          },
        };
      }),
    ),
  );
  return world;
}

/** 記録のうち、指定のメソッドとパスの要求 */
export function requestsTo(
  world: MismatchWorld,
  method: string,
  path: RegExp,
): RecordedRequest[] {
  return world.requests.filter(
    (request) => request.method === method && path.test(request.path),
  );
}
