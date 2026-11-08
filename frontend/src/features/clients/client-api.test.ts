import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server";
import {
  createClient,
  fetchAdminClients,
  fetchClientCandidates,
} from "./client-api";

describe("#192 AC-6（5-7 AC-4）: 申請候補API", () => {
  it("#192 AC-6（5-7 AC-4）: 有効候補の安定ID・コード・名前と次カーソルを返す", async () => {
    const result = {
      items: [
        { id: "client_abc", code: "ABC", name: "testclient_alpha" },
        { id: "client_int", code: "INT", name: "社内" },
      ],
      nextCursor: "cursor_next",
    };
    server.use(
      http.get("/api/clients/candidates", () => HttpResponse.json(result)),
    );
    await expect(fetchClientCandidates()).resolves.toEqual(result);
  });

  it("#192 AC-6（5-7 AC-4）: 次ページのcursorを候補APIへ渡す", async () => {
    let cursor: string | null = null;
    server.use(
      http.get("/api/clients/candidates", ({ request }) => {
        cursor = new URL(request.url).searchParams.get("cursor");
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    await fetchClientCandidates({ cursor: "cursor_next" });
    expect(cursor).toBe("cursor_next");
  });

  it("#192 AC-6・AC-7（5-7 AC-4）: 候補取得失敗を空の候補として扱わない", async () => {
    server.use(
      http.get("/api/clients/candidates", () =>
        HttpResponse.json(
          { code: "FORBIDDEN", message: "参照できません" },
          { status: 403 },
        ),
      ),
    );
    await expect(fetchClientCandidates()).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });
});

describe("#192 AC-6・AC-7（5-7 AC-11）: 管理APIの応答契約", () => {
  it("#192 AC-6（5-7 AC-11）: 正常な空一覧は次cursorなしで返す", async () => {
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    await expect(fetchAdminClients()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("#192 AC-6・AC-7（5-7 AC-11）: HTTP200でも管理一覧のactive型が違えば成功データにしない", async () => {
    server.use(
      http.get("/api/admin/clients", () =>
        HttpResponse.json({
          items: [
            {
              id: "client_abc",
              code: "ABC",
              name: "testclient_alpha",
              active: "true",
              version: 1,
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    await expect(fetchAdminClients()).rejects.toThrow();
  });

  it("#192 AC-2・AC-7（5-7 AC-2）: HTTP201でも登録結果に管理versionがなければ成功データにしない", async () => {
    server.use(
      http.post("/api/admin/clients", () =>
        HttpResponse.json(
          {
            id: "client_abc",
            code: "ABC",
            name: "testclient_alpha",
            active: true,
          },
          { status: 201 },
        ),
      ),
    );
    await expect(
      createClient({ code: "ABC", name: "testclient_alpha" }),
    ).rejects.toThrow();
  });
});
