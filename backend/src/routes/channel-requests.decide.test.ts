// #131 チャンネルの作成申請の承認（EP-2-10）・却下（EP-2-11）を、実際のアプリ入口と隔離 D1 で確かめる。時刻は Date だけを CHREQ_NOW に固定する。
// 期待値は要件 2-2 AC-2・AC-3・AC-4・AC-5・AC-7・AC-8・AC-10・AC-13・AC-14、3-4 AC-2・AC-3、計画の「判定の順番」「batch」「利用者決定 B・C」から決める。
// 判定の順番（全 API で固定）：
//   (1) 審査者の門（全体管理者か、いずれかの部署のオーナーか）。でなければ 403 FORBIDDEN（再認証の有無によらない。authorize が拒否を記録）
//   (2) 再認証（5 分以内）。なければ 403 REAUTH_REQUIRED
//   (3) 申請が見えない（存在しない・範囲外）なら 404 NOT_FOUND（logger.audit に記録）
//   (4) 見えるが決裁できない（オーナー自身の申請をそのオーナーが）なら 403 FORBIDDEN（logger.audit に記録）
//   (5) batch の中で決裁済み・取り下げ済みなら 409 CONFLICT「この申請はすでに処理されています」
// 契約（実装者へ。テストが決めたもの）：
//  - POST /api/channel-requests/:requestId/approve（本文なし）→ 200 { requestId, status: "approved", channelId, roomId }（channelId と roomId は同じ部屋の ID）
//      1 つの db.batch で：部署の有効性の確認（部署の version は変えない）→ rooms → channels（purpose=normal、created_by=申請者、名前・説明・公開範囲・部署は申請の値）
//      → channel_members（申請者だけ）→ 申請の更新（approved・decided_by・decided_at・channel_id）→ 監査 channel_request.approve 1 件
//      （detail のキーは channelId・departmentId・requestId・visibility。自動参加の監査（channel.join）は増やさない）→ 通知 channel_request.approved を申請者へ
//      （room_id = 作ったチャンネル、target_id = 申請 ID。決裁者 = 申請者なら送らない）
//      承認時に同じ名前のチャンネルがあれば 409「同じ名前のチャンネルがあるため承認できません。却下してください」、部署が無効なら 409「部署が無効のため承認できません」
//  - POST /api/channel-requests/:requestId/reject 本文（strict）{ reason }（前後の空白を除いて 1〜200 文字。違反は 422 fields: ["reason"]）
//      → 200 { requestId, status: "rejected", reason }（reason は除いた後）。監査 channel_request.reject 1 件（detail のキーは departmentId・requestId。理由の本文は入れない）
//      → 通知 channel_request.rejected を申請者へ（room_id は null、target_id = 申請 ID）
// データは架空（testuser_chreq_・@example.com・[UNIT_TEST] の部署・UNIT_TEST_ のチャンネル名）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REAUTH_VALIDITY_MS } from "../../../shared/reauth-policy";
import { apiRequest } from "../../test/api-request";
import {
  BASE,
  CHREQ_NOW,
  MESSAGES,
  NAME_PREFIX,
  auditLogLines,
  channelRow,
  cleanupChannelRequestTestData,
  departmentVersion,
  detailKeys,
  failAuditOf,
  failMemberInsert,
  failNotificationInsert,
  insertChannelRequest,
  membersOfChannel,
  otherAudits,
  requestAudits,
  requestIdAt,
  requestNotificationColumns,
  requestNotifications,
  requestRow,
  requestSnapshot,
  sessionFor,
  setupWorld,
  type Actor,
  type World,
} from "../../test/channel-request-fixtures";
import { insertChannel } from "../../test/department-fixtures";

type ActorKey =
  | "ownerS"
  | "memberS1"
  | "memberS2"
  | "memberD1"
  | "ownerH"
  | "memberH1"
  | "admin";
type DeptKey = "deptS" | "deptD" | "deptH" | null;

let w: World;
let logLines: string[];

const actorOf = (key: ActorKey): Actor => w[key];
const deptOf = (key: DeptKey) => (key === null ? null : w[key].id);

const post = (path: string, token: string | null, body?: unknown) =>
  apiRequest("POST", path, {
    token,
    ...(body === undefined ? {} : { body }),
  });
const approve = (id: string, token: string) =>
  post(`${BASE}/${id}/approve`, token);
const reject = (id: string, token: string, reason: unknown = "テストの理由") =>
  post(`${BASE}/${id}/reject`, token, { reason });

let nameSeq = 0;
async function pending(
  requester: ActorKey,
  dept: DeptKey,
  options: { visibility?: "public" | "private"; description?: string } = {},
) {
  nameSeq += 1;
  const name = `${NAME_PREFIX}決裁${nameSeq}`;
  const id = await insertChannelRequest({
    departmentId: deptOf(dept),
    name,
    requestedBy: actorOf(requester).id,
    ...options,
  });
  return { id, name };
}

/** 拒否の記録（logger.audit の failure）の件数 */
const failureAudits = () =>
  auditLogLines(logLines).filter(
    (line) => line.attributes?.result === "failure",
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CHREQ_NOW));
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupWorld();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupChannelRequestTestData();
});

describe("#131 AC-7・AC-8・AC-10（2-2 AC-7・AC-8・AC-10）承認できる人の表", () => {
  // [説明, 申請者, 申請の部署, 決裁する人, 期待する status]
  it.each<[string, ActorKey, DeptKey, ActorKey, number]>([
    ["部署の申請をその部署のオーナーが", "memberS1", "deptS", "ownerS", 200],
    [
      "部署の申請を他部署のオーナーが（範囲外）",
      "memberS1",
      "deptS",
      "ownerH",
      404,
    ],
    [
      "部署の申請を同じ部署のメンバーが（門で拒否）",
      "memberS1",
      "deptS",
      "memberS2",
      403,
    ],
    ["部署の申請を任命された全体管理者が", "memberD1", "deptD", "admin", 200],
    [
      "一般社員の部署の申請を任命されていない全体管理者が",
      "memberS1",
      "deptS",
      "admin",
      404,
    ],
    ["会社直属の申請を全体管理者が（AC-10）", "memberS1", null, "admin", 200],
    [
      "会社直属の申請を全体管理者でないオーナーが（範囲外）",
      "memberS1",
      null,
      "ownerS",
      404,
    ],
    [
      "会社直属の申請をメンバーが（門で拒否）",
      "memberS1",
      null,
      "memberS2",
      403,
    ],
    [
      "オーナー自身の申請をそのオーナーが（AC-8）",
      "ownerS",
      "deptS",
      "ownerS",
      403,
    ],
    [
      "オーナー自身の申請を任命されていない全体管理者が（AC-8）",
      "ownerS",
      "deptS",
      "admin",
      200,
    ],
    [
      "オーナー自身の申請を他部署のオーナーが",
      "ownerS",
      "deptS",
      "ownerH",
      404,
    ],
    [
      "全体管理者自身の会社直属の申請を本人が（自己承認。AC-10）",
      "admin",
      null,
      "admin",
      200,
    ],
    ["メンバーが自分の申請を", "memberS1", "deptS", "memberS1", 403],
  ])(
    "#131 AC-7・AC-8・AC-10: %s → %s（承認）",
    async (_label, requester, dept, decider, status) => {
      const { id } = await pending(requester, dept);
      const before = await requestSnapshot();
      const res = await approve(id, actorOf(decider).token);
      expect(res.status).toBe(status);
      if (status === 200) {
        expect((await requestRow(id))?.status).toBe("approved");
      } else {
        expect(await res.json()).toMatchObject({
          code: status === 403 ? "FORBIDDEN" : "NOT_FOUND",
        });
        expect(await requestSnapshot()).toEqual(before);
      }
    },
  );

  it.each<[string, ActorKey, DeptKey, ActorKey, number]>([
    ["部署の申請をその部署のオーナーが", "memberS1", "deptS", "ownerS", 200],
    [
      "一般社員の部署の申請を任命されていない全体管理者が",
      "memberS1",
      "deptS",
      "admin",
      404,
    ],
    [
      "会社直属の申請を全体管理者でないオーナーが",
      "memberS1",
      null,
      "ownerS",
      404,
    ],
    ["オーナー自身の申請をそのオーナーが", "ownerS", "deptS", "ownerS", 403],
    [
      "オーナー自身の申請を任命されていない全体管理者が",
      "ownerS",
      "deptS",
      "admin",
      200,
    ],
    ["部署の申請をメンバーが", "memberS1", "deptS", "memberS2", 403],
  ])(
    "#131 AC-7・AC-8: 却下も同じ表に従う：%s → %s",
    async (_label, requester, dept, decider, status) => {
      const { id } = await pending(requester, dept);
      const res = await reject(id, actorOf(decider).token);
      expect(res.status).toBe(status);
      expect((await requestRow(id))?.status).toBe(
        status === 200 ? "rejected" : "pending",
      );
    },
  );

  it("#131 AC-8: 全体管理者を兼ねるオーナーは、自分が出した自部署のチャンネルの申請を自分で承認できる", async () => {
    // admin の所属を、admin がオーナーを務める deptD に移す（兼任のオーナー本人の申請）
    await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
      .bind(w.deptD.id, w.admin.id)
      .run();
    const { id } = await pending("admin", "deptD");
    const res = await approve(id, w.admin.token);
    expect(res.status).toBe(200);
    expect(await requestRow(id)).toMatchObject({
      status: "approved",
      decided_by: w.admin.id,
    });
  });

  it("#131 AC-7（計画「判定の時点」）: 申請の後にオーナーが交代したら、新しいオーナーが決裁し、前のオーナーは決裁できない", async () => {
    const { id } = await pending("memberS1", "deptS");
    await env.DB.prepare(
      "UPDATE user_role_assignments SET user_id = ? WHERE user_id = ? AND role_id = 'role_owner'",
    )
      .bind(w.memberS2.id, w.ownerS.id)
      .run();
    const newOwnerToken = await sessionFor(w.memberS2.id);
    expect((await approve(id, w.ownerS.token)).status).toBe(403);
    expect((await approve(id, newOwnerToken)).status).toBe(200);
  });
});

describe("#131 判定の順番（計画・利用者決定 B）", () => {
  it("#131 判定の順番 (1): メンバーは再認証の有無によらず 403 FORBIDDEN（REAUTH_REQUIRED ではない）。存在しない ID でも 403", async () => {
    const { id } = await pending("memberS1", "deptS");
    const missing = requestIdAt(1_700_000_000_000);
    for (const [path, token] of [
      [`${BASE}/${id}/approve`, w.memberS2.plain],
      [`${BASE}/${id}/approve`, w.memberS2.token],
      [`${BASE}/${missing}/approve`, w.memberS2.token],
      [`${BASE}/${id}/reject`, w.memberS2.plain],
      [`${BASE}/${missing}/reject`, w.memberS2.token],
    ] as const) {
      const body = path.endsWith("reject") ? { reason: "理由" } : undefined;
      const res = await post(path, token, body);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("#131 判定の順番 (1): 門の拒否は authorize が記録する（logger.audit の perm.channel.request.approve.owner・failure）", async () => {
    const { id } = await pending("memberS1", "deptS");
    await approve(id, w.memberS2.token);
    const denied = failureAudits().filter(
      (line) => line.body === "perm.channel.request.approve.owner",
    );
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(denied)).not.toContain(`${NAME_PREFIX}決裁`);
  });

  it.each<[string, ActorKey, DeptKey, ActorKey | "missing"]>([
    ["自分が決裁できる申請", "memberS1", "deptS", "ownerS"],
    ["範囲外の申請", "memberS1", "deptS", "ownerH"],
    ["オーナー自身の申請", "ownerS", "deptS", "ownerS"],
    ["存在しない申請", "memberS1", "deptS", "missing"],
  ])(
    "#131 判定の順番 (2): 審査者が再認証していなければ、%sでも 403 REAUTH_REQUIRED（404・403 FORBIDDEN より先）",
    async (_label, requester, dept, decider) => {
      const { id } = await pending(requester, dept);
      const target =
        decider === "missing" ? requestIdAt(1_700_000_000_000) : id;
      const token =
        decider === "missing" ? w.ownerS.plain : actorOf(decider).plain;
      const before = await requestSnapshot();
      for (const res of [
        await approve(target, token),
        await reject(target, token),
      ]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      }
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it.each([["再認証から 5 分を過ぎた", REAUTH_VALIDITY_MS + 1_000]])(
    "#131 AC-3（2-2 AC-3・0-5）: %s審査者は 403 REAUTH_REQUIRED で、申請・チャンネル・監査・通知が変わらない",
    async (_label, ago) => {
      const { id } = await pending("memberS1", "deptS");
      const stale = await sessionFor(w.ownerS.id, ago);
      const before = await requestSnapshot();
      for (const res of [await approve(id, stale), await reject(id, stale)]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
      }
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 AC-3（0-5）: 再認証から 4 分 59 秒なら承認できる（5 分の境界の内側）", async () => {
    const { id } = await pending("memberS1", "deptS");
    const fresh = await sessionFor(w.ownerS.id, REAUTH_VALIDITY_MS - 1_000);
    expect((await approve(id, fresh)).status).toBe(200);
  });

  it("#131 判定の順番 (3): 再認証済みの審査者が、範囲外・存在しない申請を決裁すると 404 で、拒否が logger.audit に記録される", async () => {
    const { id } = await pending("memberS1", "deptS");
    for (const [target, token] of [
      [id, w.ownerH.token],
      [requestIdAt(1_700_000_000_000), w.ownerS.token],
    ] as const) {
      logLines.length = 0;
      const res = await approve(target, token);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(failureAudits().length).toBeGreaterThanOrEqual(1);
    }
    expect((await requestRow(id))?.status).toBe("pending");
  });

  it("#131 判定の順番 (4): オーナー自身の申請をそのオーナーが決裁すると 403 FORBIDDEN で、拒否が logger.audit に記録される（名前は記録しない）", async () => {
    const { id, name } = await pending("ownerS", "deptS");
    logLines.length = 0;
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN" });
    const failures = failureAudits();
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(failures)).not.toContain(name);
  });

  // 拒否の記録の中身（ミューテーションの不足の対応）：操作ごとの action 名・理由の分類・対象の申請 ID・記録した利用者と trace_id
  it.each<
    [
      string,
      "approve" | "reject",
      ActorKey,
      ActorKey,
      "not_found" | "own_request",
      number,
      string,
    ]
  >([
    [
      "範囲外の申請の承認",
      "approve",
      "memberS1",
      "ownerH",
      "not_found",
      404,
      "申請が見つかりません",
    ],
    [
      "範囲外の申請の却下",
      "reject",
      "memberS1",
      "ownerH",
      "not_found",
      404,
      "申請が見つかりません",
    ],
    [
      "オーナー自身の申請の承認",
      "approve",
      "ownerS",
      "ownerS",
      "own_request",
      403,
      "この申請は承認・却下できません",
    ],
    [
      "オーナー自身の申請の却下",
      "reject",
      "ownerS",
      "ownerS",
      "own_request",
      403,
      "この申請は承認・却下できません",
    ],
  ])(
    "#131 判定の順番 (3)・(4): %sの拒否は、logger.audit に channel_request.%s・failure・理由 %s・対象の申請 ID・操作した利用者で記録する",
    async (_label, operation, requester, decider, reason, status, message) => {
      const { id } = await pending(requester, "deptS");
      logLines.length = 0;
      const res =
        operation === "approve"
          ? await approve(id, actorOf(decider).token)
          : await reject(id, actorOf(decider).token);
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ message });
      const lines = failureAudits().filter(
        (line) => line.body === `channel_request.${operation}`,
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]?.attributes).toMatchObject({
        log_type: "audit",
        result: "failure",
        target: id,
        reason,
      });
      expect(lines[0]?.user_id).toBe(actorOf(decider).id);
      expect(lines[0]?.trace_id).toEqual(expect.any(String));
      // ほかの操作の名前で記録しない
      const other = operation === "approve" ? "reject" : "approve";
      expect(
        failureAudits().filter(
          (line) => line.body === `channel_request.${other}`,
        ),
      ).toEqual([]);
    },
  );

  it("#131 判定の順番 (1): 門の拒否は会社の範囲（target: company）で、操作した利用者として記録する", async () => {
    const { id } = await pending("memberS1", "deptS");
    logLines.length = 0;
    await approve(id, w.memberS2.token);
    const denied = failureAudits().filter(
      (line) => line.body === "perm.channel.request.approve.owner",
    );
    expect(denied).toHaveLength(1);
    expect(denied[0]?.attributes).toMatchObject({
      target: "company",
      reason: "forbidden",
    });
    expect(denied[0]?.user_id).toBe(w.memberS2.id);
  });

  it.each(["approved", "rejected", "withdrawn"] as const)(
    "#131 判定の順番 (5)・二重決裁: %s の申請への承認・却下は 409「すでに処理されています」で、行・監査・通知は増えない",
    async (status) => {
      const id = await insertChannelRequest({
        departmentId: w.deptS.id,
        name: `${NAME_PREFIX}決裁済み`,
        requestedBy: w.memberS1.id,
        status,
        decidedBy: status === "withdrawn" ? w.memberS1.id : w.ownerS.id,
      });
      const before = await requestSnapshot();
      for (const res of [
        await approve(id, w.ownerS.token),
        await reject(id, w.ownerS.token),
      ]) {
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          code: "CONFLICT",
          message: MESSAGES.decided,
        });
      }
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 二重決裁: 承認の後の承認・却下は 409 で、チャンネルは 1 つだけ", async () => {
    const { id } = await pending("memberS1", "deptS");
    expect((await approve(id, w.ownerS.token)).status).toBe(200);
    const before = await requestSnapshot();
    expect((await approve(id, w.ownerS.token)).status).toBe(409);
    expect((await reject(id, w.ownerS.token)).status).toBe(409);
    expect(await requestSnapshot()).toEqual(before);
  });

  it("#131 二重決裁（同時実行）: 同じ申請を同時に 2 回承認すると、1 回だけ 200 で、チャンネル・監査・通知は 1 件ずつ", async () => {
    const { id, name } = await pending("memberS1", "deptS");
    const results = await Promise.all([
      approve(id, w.ownerS.token),
      approve(id, w.ownerS.token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { results: channels } = await env.DB.prepare(
      "SELECT room_id FROM channels WHERE name_normalized = ?",
    )
      .bind(name.toLowerCase())
      .all();
    expect(channels).toHaveLength(1);
    expect(
      (await requestAudits()).filter(
        (a) => a.action === "channel_request.approve",
      ),
    ).toHaveLength(1);
    expect(await requestNotifications()).toHaveLength(1);
  });
});

describe("#131 AC-2・AC-3・AC-14（2-2 AC-2・AC-3・AC-14）承認の結果", () => {
  it("#131 AC-3・AC-14: 承認で申請の内容どおりの通常チャンネルができ、申請者だけが参加者になる。応答・申請の行・監査 1 件が残る", async () => {
    const { id, name } = await pending("memberS1", "deptS", {
      visibility: "private",
      description: "テストの説明",
    });
    const assignmentsBefore = (await requestSnapshot()).assignments;
    const othersBefore = await otherAudits();
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requestId: string;
      status: string;
      channelId: string;
      roomId: string;
    };
    expect(Object.keys(body).sort()).toEqual(
      ["channelId", "requestId", "roomId", "status"].sort(),
    );
    expect(body).toMatchObject({ requestId: id, status: "approved" });
    expect(body.roomId).toBe(body.channelId);
    expect(await channelRow(body.channelId)).toEqual({
      room_id: body.channelId,
      department_id: w.deptS.id,
      name,
      name_normalized: name.toLowerCase(),
      description: "テストの説明",
      visibility: "private",
      purpose: "normal",
      created_by: w.memberS1.id,
      deleted_at: null,
    });
    expect(await membersOfChannel(body.channelId)).toEqual([w.memberS1.id]);
    // 2-2 AC-14：申請者に管理権限を付けない（ロールの割り当ては増えない）
    expect((await requestSnapshot()).assignments).toEqual(assignmentsBefore);
    expect(await requestRow(id)).toMatchObject({
      status: "approved",
      decided_by: w.ownerS.id,
      decided_at: CHREQ_NOW,
      channel_id: body.channelId,
      decision_reason: null,
    });
    const audits = await requestAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.ownerS.id,
      action: "channel_request.approve",
      target_type: "channel_request",
      target_id: id,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual([
      "channelId",
      "departmentId",
      "requestId",
      "visibility",
    ]);
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toEqual({
      channelId: body.channelId,
      departmentId: w.deptS.id,
      requestId: id,
      visibility: "private",
    });
    expect(audits[0]?.detail ?? "").not.toContain(name);
    expect(audits[0]?.detail ?? "").not.toContain("テストの説明");
    // 利用者決定 C：チャンネルの作成と申請者の自動参加は、承認の監査 1 件に含める（channel.join 等は増えない）
    expect(await otherAudits()).toEqual(othersBefore);
  });

  it("#131 AC-2（2-2 AC-2）: 承認待ちの間はチャンネルとして使えず（一覧に出ず、詳細・参加は 404）、承認の後に使える", async () => {
    const { id, name } = await pending("memberS1", null);
    const listNames = async (token: string) =>
      (
        (await (
          await apiRequest("GET", "/api/channels?limit=100", { token })
        ).json()) as {
          items: { name: string }[];
        }
      ).items.map((item) => item.name);
    expect(await listNames(w.memberS1.token)).not.toContain(name);
    expect(
      (
        await apiRequest("GET", `/api/channels/${id}`, {
          token: w.memberS1.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await apiRequest("POST", `/api/channels/${id}/join`, {
          token: w.memberS2.token,
        })
      ).status,
    ).toBe(404);
    const res = await approve(id, w.admin.token);
    const { channelId } = (await res.json()) as { channelId: string };
    expect(await listNames(w.memberS1.token)).toContain(name);
    const detail = await apiRequest("GET", `/api/channels/${channelId}`, {
      token: w.memberS1.token,
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ name, joined: true });
  });

  it("#131 AC-14（投稿の退行）: 承認でできた部署の非公開チャンネルに、申請者は投稿できる", async () => {
    const { id } = await pending("memberS1", "deptS", {
      visibility: "private",
    });
    const { channelId } = (await (
      await approve(id, w.ownerS.token)
    ).json()) as {
      channelId: string;
    };
    const res = await apiRequest("POST", `/api/rooms/${channelId}/messages`, {
      token: w.memberS1.token,
      body: { body: "テストの投稿" },
    });
    expect(res.status).toBe(201);
  });

  it("#131 AC-14: 決裁者は参加者にならない（オーナーが承認しても、参加者は申請者だけ）", async () => {
    const { id } = await pending("memberS1", null);
    const { channelId } = (await (await approve(id, w.admin.token)).json()) as {
      channelId: string;
    };
    expect(await membersOfChannel(channelId)).toEqual([w.memberS1.id]);
  });

  it("#131 計画「部署が無効」: 有効な部署のチャンネルを承認しても、部署の version は変わらない", async () => {
    const { id } = await pending("memberS1", "deptS");
    const before = await departmentVersion(w.deptS.id);
    expect((await approve(id, w.ownerS.token)).status).toBe(200);
    expect(await departmentVersion(w.deptS.id)).toBe(before);
  });

  it("#131 計画「部署が無効」: 申請の後に部署が無効になったら、承認は 409「部署が無効のため承認できません」で何も作られず、申請は承認待ちのまま", async () => {
    const { id } = await pending("memberS1", "deptS");
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(w.deptS.id)
      .run();
    const before = await requestSnapshot();
    // 全体管理者（任命なし）ではなく、範囲内のオーナーで確かめる
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: MESSAGES.departmentInactive,
    });
    expect(await requestSnapshot()).toEqual(before);
    expect((await requestRow(id))?.status).toBe("pending");
  });

  it.each(["rejected", "withdrawn"] as const)(
    "#131 判定の順番 (5)（コードレビューの指摘）: %s の申請の部署が無効になっていても、承認は「部署が無効」ではなく「すでに処理されています」の 409",
    async (status) => {
      const id = await insertChannelRequest({
        departmentId: w.deptS.id,
        name: `${NAME_PREFIX}決裁済み無効部署`,
        requestedBy: w.memberS1.id,
        status,
        decidedBy: status === "withdrawn" ? w.memberS1.id : w.ownerS.id,
      });
      await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
        .bind(w.deptS.id)
        .run();
      const before = await requestSnapshot();
      const res = await approve(id, w.ownerS.token);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "CONFLICT",
        message: MESSAGES.decided,
      });
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 計画「部署が無効」（repository L406）: 会社直属の申請を承認しても、どの部署の version も変わらない", async () => {
    const { id } = await pending("memberS1", null);
    const before = (await requestSnapshot()).departments;
    expect((await approve(id, w.admin.token)).status).toBe(200);
    expect((await requestSnapshot()).departments).toEqual(before);
  });
});

describe("#131 AC-13（2-2 AC-13）承認時の名前の重複", () => {
  it.each([
    ["同じ名前の通常チャンネル", false],
    ["同じ名前のアーカイブ済みチャンネル", true],
  ])(
    "#131 AC-13: 申請の後に%sができていたら、承認は 409（名前のメッセージ。二重決裁と別）で何も作られず、承認待ちのまま残り、その後に却下できる",
    async (_label, archived) => {
      const { id, name } = await pending("memberS1", "deptS");
      await insertChannel({
        name: name.toUpperCase(),
        purpose: "normal",
        departmentId: w.deptD.id,
        archived,
      });
      const before = await requestSnapshot();
      const res = await approve(id, w.ownerS.token);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; message: string };
      expect(body).toEqual(
        expect.objectContaining({
          code: "CONFLICT",
          message: MESSAGES.nameTakenOnApprove,
        }),
      );
      expect(body.message).not.toBe(MESSAGES.decided);
      expect(await requestSnapshot()).toEqual(before);
      expect((await requestRow(id))?.status).toBe("pending");
      const rejected = await reject(id, w.ownerS.token, "同じ名前があります");
      expect(rejected.status).toBe(200);
    },
  );
});

describe("#131 AC-3（batch の原子性）承認の途中の失敗", () => {
  it.each<[string, () => Promise<void>]>([
    ["監査の書き込み", () => failAuditOf("channel_request.approve")],
    ["通知の書き込み", failNotificationInsert],
    ["参加者の書き込み", failMemberInsert],
  ])(
    "#131 AC-3: %sが失敗すると 500 で、チャンネル・ルーム・参加・申請の更新・監査・通知のどれも残らない",
    async (_label, fail) => {
      const { id } = await pending("memberS1", "deptS");
      await fail();
      const before = await requestSnapshot();
      const res = await approve(id, w.ownerS.token);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("unit_131_fail");
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 AC-3: 却下の監査の書き込みが失敗すると 500 で、申請は承認待ちのまま・通知もない", async () => {
    const { id } = await pending("memberS1", "deptS");
    await failAuditOf("channel_request.reject");
    const before = await requestSnapshot();
    const res = await reject(id, w.ownerS.token);
    expect(res.status).toBe(500);
    expect(await requestSnapshot()).toEqual(before);
  });
});

describe("#131 AC-4・AC-5（2-2 AC-4・AC-5）却下", () => {
  it("#131 AC-4・AC-5: 却下で理由（前後の空白を除いたもの）が残り、状態・決裁者・日時が残る。監査 1 件に理由の本文を入れない。チャンネルは作らない", async () => {
    const { id, name } = await pending("memberS1", "deptS");
    const roomsBefore = (await requestSnapshot()).rooms;
    const res = await reject(id, w.ownerS.token, "  名前を見直してください　");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      requestId: id,
      status: "rejected",
      reason: "名前を見直してください",
    });
    expect(await requestRow(id)).toMatchObject({
      status: "rejected",
      decided_by: w.ownerS.id,
      decided_at: CHREQ_NOW,
      decision_reason: "名前を見直してください",
      channel_id: null,
    });
    expect((await requestSnapshot()).rooms).toEqual(roomsBefore);
    const audits = await requestAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.ownerS.id,
      action: "channel_request.reject",
      target_type: "channel_request",
      target_id: id,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual([
      "departmentId",
      "requestId",
    ]);
    expect(audits[0]?.detail ?? "").not.toContain("見直して");
    expect(audits[0]?.detail ?? "").not.toContain(name);
  });

  it.each([
    ["1 文字", "あ"],
    ["200 文字", "あ".repeat(200)],
    ["前後に空白を付けた 200 文字", `  ${"あ".repeat(200)}　`],
  ])("#131 AC-4: 理由が%sなら却下できる", async (_label, reason) => {
    const { id } = await pending("memberS1", "deptS");
    const res = await reject(id, w.ownerS.token, reason);
    expect(res.status).toBe(200);
    expect((await requestRow(id))?.decision_reason).toBe(reason.trim());
  });

  it.each<[string, unknown]>([
    ["空", ""],
    ["空白だけ", "   "],
    ["全角空白だけ", "　　"],
    ["201 文字", "あ".repeat(201)],
    ["文字列でない", 123],
    ["null", null],
  ])(
    "#131 AC-4（V-27・V-28）: 理由が%sなら 422（fields: reason）で、何も変わらない",
    async (_label, reason) => {
      const { id } = await pending("memberS1", "deptS");
      const before = await requestSnapshot();
      const res = await reject(id, w.ownerS.token, reason);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["reason"],
      });
      expect(await requestSnapshot()).toEqual(before);
    },
  );

  it("#131 AC-4: 理由がない・余計な項目がある本文は 422", async () => {
    const { id } = await pending("memberS1", "deptS");
    const before = await requestSnapshot();
    for (const body of [{}, { reason: "理由", status: "approved" }]) {
      const res = await post(`${BASE}/${id}/reject`, w.ownerS.token, body);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await requestSnapshot()).toEqual(before);
  });
});

describe("#131 3-4 AC-2・AC-3：決裁の通知", () => {
  it("#131 3-4 AC-2: 承認で申請者に channel_request.approved が 1 件（room_id は作ったチャンネル、target_id は申請 ID）。ほかの誰にも送らない", async () => {
    const { id } = await pending("memberS1", "deptS");
    const { channelId } = (await (
      await approve(id, w.ownerS.token)
    ).json()) as {
      channelId: string;
    };
    expect(await requestNotifications()).toEqual([
      {
        user_id: w.memberS1.id,
        kind: "channel_request.approved",
        room_id: channelId,
        message_id: null,
        target_id: id,
      },
    ]);
  });

  it("#131 3-4 AC-2: 却下で申請者に channel_request.rejected が 1 件（room_id は null）。理由は通知の行に入れない", async () => {
    const { id } = await pending("memberS1", null);
    await reject(id, w.admin.token, "テストの却下理由です");
    expect(await requestNotifications()).toEqual([
      {
        user_id: w.memberS1.id,
        kind: "channel_request.rejected",
        room_id: null,
        message_id: null,
        target_id: id,
      },
    ]);
    const { results } = await env.DB.prepare(
      "SELECT * FROM notifications WHERE kind LIKE 'channel_request.%'",
    ).all();
    expect(JSON.stringify(results)).not.toContain("テストの却下理由です");
  });

  it.each([
    ["承認", "approve"],
    ["却下", "reject"],
  ] as const)(
    "#131 3-4 AC-2: 全体管理者が自分の会社直属の申請を%sしたとき（自己決裁）は、通知を送らない",
    async (_label, action) => {
      const { id } = await pending("admin", null);
      const res =
        action === "approve"
          ? await approve(id, w.admin.token)
          : await reject(id, w.admin.token);
      expect(res.status).toBe(200);
      expect(await requestNotifications()).toEqual([]);
    },
  );

  it("#131 3-4 AC-2（計画「通知」）: 通知の表に理由・名前・本文の列を足さない（列の集合は #124 のまま）", async () => {
    expect(await requestNotificationColumns()).toEqual(
      [
        "created_at",
        "id",
        "kind",
        "message_id",
        "read_at",
        "room_id",
        "target_id",
        "user_id",
      ].sort(),
    );
  });

  it("#131 3-4 AC-3: 拒否された決裁（403・404・409）では、誰にも通知しない", async () => {
    const { id } = await pending("memberS1", "deptS");
    await approve(id, w.memberS2.token);
    await approve(id, w.ownerH.token);
    await approve(id, w.admin.token);
    expect(await requestNotifications()).toEqual([]);
  });
});
