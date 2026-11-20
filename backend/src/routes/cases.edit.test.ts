// #150（150-C）5-1 AC-20、EP-5-20 PATCH /api/cases/:caseId：案件の内容（件名・説明・取引先・担当部署）の再編集を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 150-C 6章の「結合」「重大4 非開示」の行）：
//   - 401・送信元の 403・パスの形の 422・404・403（資格なし。終了中でも 409 より先で状態を漏らさない）
//   - 200 の形 { caseId, titleFormatted }（説明・版を含まない）・no-store・再認証なしで通る
//   - 一覧・概要に新しい件名・取引先・担当部署が出て、案件番号は同じ。通知が増えない（C-124・C-140(3)）
//   - 非参加の管理者（担当部署のオーナー）：expected の方式で編集できる。編集の後も詳細は 403・部屋のメッセージは 404。
//     description・version を送ると 403（重大4・重大7）。応答・エラー・監査に説明の本文が出ない
//   - 自動参加したオーナーは詳細を見られる（C-133(3)）
//   - 重大4：非参加者（資格なし）と非参加の管理者が受け取る概要・一覧は、説明だけの更新の前後で完全に同じ。概要・一覧の項目に version がない
//   - 参加者が expected を送ると 422、dueDate・caseNumber を送ると 422、無効な取引先・部署は 422、終了中は 409 closed、版違いは 409 stale
// batch の前提・件数の確認は DB（db/case-edit.repository.db.test.ts）、判定の順の網羅は単体（services/case-edit.*.test.ts）で確かめる。
// 契約（実装前の仮置き。計画 150-C 4.2）：本文は strict。成功は 200 { caseId, titleFormatted }。
// 期待値は要件 5-1 AC-20・C-122・C-124・C-129・C-130・C-133・C-140 と計画 150-C 4.2 から決める。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  MISSING_CASE_ID,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASE_EDIT_MESSAGES,
  caseDepartmentIdsOf,
  caseEditAudits,
  caseEditRow,
  caseEditSnapshot,
  editPath,
  notificationCount,
} from "../../test/case-edit-fixtures";
import {
  BAD_ORIGIN,
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
} from "../../test/case-room-fixtures";
import { setCaseStatus } from "../../test/case-participant-fixtures";

type ErrorBody = {
  code: string;
  message: string;
  fields?: string[];
  reason?: string;
};

const TITLE = "[UNIT_TEST]150C結合の件名";
const SECRET_DESCRIPTION = "[UNIT_TEST]150C参加者だけの説明";

let w: CaseWorld;
/**
 * 進行中・deptS 担当・clientA：memberS1・memberS2・admin（全体管理者）。
 * ownerS（deptS のオーナー）は参加していない＝非参加の管理者。memberD1・ownerD・noDept は参加していない
 */
let room: SeededCase;

const patch = (
  caseId: string,
  token: string | null,
  body?: unknown,
  origin?: string,
) =>
  apiRequest("PATCH", editPath(caseId), {
    token,
    body,
    ...(origin === undefined ? {} : { origin }),
  });

const summaryText = async (token: string) =>
  (await apiRequest("GET", `${CASES_BASE}/${room.id}`, { token })).text();
const listText = async (token: string) =>
  (
    await apiRequest("GET", `${CASES_BASE}?scope=all&status=active`, { token })
  ).text();
const detailOf = (token: string) =>
  apiRequest("GET", `${CASES_BASE}/${room.id}/detail`, { token });
const messagesOf = (token: string) =>
  apiRequest("GET", `/api/rooms/${room.roomId}/messages?limit=50`, { token });

async function expectError(
  res: Response,
  status: number,
  expected: Partial<ErrorBody>,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  const body = (await res.json()) as ErrorBody;
  expect(body).toMatchObject(expected);
  return body;
}

/** 非参加の管理者が概要で見た値（expected） */
const expectedNow = () => ({
  title: TITLE,
  clientId: w.clientA.id,
  departmentIds: [w.deptS.id],
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1661,
    clientId: w.clientA.id,
    code: "QZA",
    title: TITLE,
    description: SECRET_DESCRIPTION,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
      { userId: w.admin.id, joinedAt: joinedAt(3) },
    ],
  });
  await seedRoomMessage(
    room.roomId,
    w.memberS1.id,
    16611,
    "[UNIT_TEST]150C参加者のやり取り",
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#150 150-C 共通：認証・送信元・パス・存在", () => {
  it("#150 EP-5-20: 未認証は 401 UNAUTHENTICATED で、何も変わらない", async () => {
    const before = await caseEditSnapshot();
    const res = await patch(room.id, null, {
      version: 1,
      title: "[UNIT_TEST]x",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await caseEditSnapshot()).toEqual(before);
  });

  it("#150 EP-5-20・security: 許可外の Origin は 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const before = await caseEditSnapshot();
    const res = await patch(
      room.id,
      w.memberS1.token,
      { version: 1, title: "[UNIT_TEST]x" },
      BAD_ORIGIN,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await caseEditSnapshot()).toEqual(before);
  });

  it("#150 4.2 の 1: パスの caseId が ULID でなければ 422", async () => {
    await expectError(
      await patch("not-a-ulid", w.memberS1.token, { version: 1 }),
      422,
      { code: "VALIDATION_ERROR" },
    );
  });

  it("#150 4.2 の 2: 案件がなければ、本文が壊れていても 404「案件が見つかりません」", async () => {
    await expectError(
      await patch(MISSING_CASE_ID, w.memberS1.token, { bad: true }),
      404,
      { code: "NOT_FOUND", message: CASE_EDIT_MESSAGES.notFound },
    );
  });

  it("#150 4.2 の 3・security: 参加者でも管理の資格もない社員は、終了中の案件でも 403（409 closed より先。状態を漏らさない）", async () => {
    await setCaseStatus(room.id, "closed");
    const before = await caseEditSnapshot();
    const body = await expectError(
      await patch(room.id, w.noDept.token, {
        version: 1,
        title: "[UNIT_TEST]x",
      }),
      403,
      { code: "FORBIDDEN", message: CASE_EDIT_MESSAGES.cannotEdit },
    );
    expect(body.reason).toBeUndefined();
    expect(await caseEditSnapshot()).toEqual(before);
  });
});

describe("#150 150-C 参加者の編集（5-1 AC-20・C-122・C-129・C-130・C-133）", () => {
  it("#150 AC-20: 200 { caseId, titleFormatted }・no-store（説明・版を含まない）。再認証なしで通る", async () => {
    const res = await patch(room.id, w.memberS1.token, {
      version: 1,
      title: "[UNIT_TEST]150C新しい件名",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({
      caseId: room.id,
      titleFormatted: false,
    });
  });

  it("#150 C-122(6): 全角の英数字は整形して保存し、titleFormatted が真", async () => {
    const res = await patch(room.id, w.memberS1.token, {
      version: 1,
      title: "[UNIT_TEST]１５０Ｃ　見積",
    });
    expect(await res.json()).toEqual({ caseId: room.id, titleFormatted: true });
    expect((await caseEditRow(room.id)).title).toBe("[UNIT_TEST]150C 見積");
  });

  it("#150 AC-20・C-129・C-130・C-133(3): 件名・取引先・担当部署を変えると、一覧・概要に新しい値が出て案件番号は同じ。deptD のオーナーが自動参加して詳細を見られる。通知は増えない", async () => {
    const notifications = await notificationCount();
    expect((await detailOf(w.ownerD.token)).status).toBe(403);
    const res = await patch(room.id, w.memberS1.token, {
      version: 1,
      title: "[UNIT_TEST]150C一覧に出る件名",
      clientId: w.clientB.id,
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    expect(res.status).toBe(200);
    const summary = JSON.parse(await summaryText(w.noDept.token)) as {
      title: string;
      caseNumber: string;
      client: { id: string };
      departments: { id: string }[];
    };
    expect(summary).toMatchObject({
      title: "[UNIT_TEST]150C一覧に出る件名",
      caseNumber: room.caseNumber,
      client: { id: w.clientB.id },
    });
    expect(summary.departments.map((d) => d.id).sort()).toEqual(
      [w.deptS.id, w.deptD.id].sort(),
    );
    const list = JSON.parse(await listText(w.noDept.token)) as {
      items: { id: string; title: string; caseNumber: string }[];
    };
    expect(list.items.find((item) => item.id === room.id)).toMatchObject({
      title: "[UNIT_TEST]150C一覧に出る件名",
      caseNumber: room.caseNumber,
    });
    expect((await detailOf(w.ownerD.token)).status).toBe(200);
    expect(await notificationCount()).toBe(notifications);
  });

  it("#150 4.2・Q2＝A: dueDate・caseNumber・未知の項目を送ると 422 で fields に項目名。何も変わらない", async () => {
    for (const [name, value] of [
      ["dueDate", "2026-12-24"],
      ["caseNumber", "QZA-261117-9999"],
      ["status", "closed"],
    ] as const) {
      const before = await caseEditSnapshot();
      const body = await expectError(
        await patch(room.id, w.memberS1.token, { version: 1, [name]: value }),
        422,
        { code: "VALIDATION_ERROR" },
      );
      expect(body.fields, name).toContain(name);
      expect(await caseEditSnapshot()).toEqual(before);
    }
  });

  it('#150 Q3＝C: 有効な参加者が expected を送ると 422 fields ["version"]', async () => {
    const body = await expectError(
      await patch(room.id, w.memberS1.token, {
        expected: expectedNow(),
        title: "[UNIT_TEST]150C新",
      }),
      422,
      { code: "VALIDATION_ERROR" },
    );
    expect(body.fields).toEqual(["version"]);
  });

  it("#150 C-129(1)・C-130: 無効な取引先は 422 clientId、無効な部署を新しく足すと 422 departmentIds", async () => {
    const client = await expectError(
      await patch(room.id, w.memberS1.token, {
        version: 1,
        clientId: w.clientOff.id,
      }),
      422,
      { code: "VALIDATION_ERROR" },
    );
    expect(client.fields).toEqual(["clientId"]);
    await env.DB.prepare("UPDATE departments SET is_active = 0 WHERE id = ?")
      .bind(w.deptD.id)
      .run();
    const department = await expectError(
      await patch(room.id, w.memberS1.token, {
        version: 1,
        departmentIds: [w.deptS.id, w.deptD.id],
      }),
      422,
      { code: "VALIDATION_ERROR" },
    );
    expect(department.fields).toEqual(["departmentIds"]);
  });

  it("#150 C-122(4): 終了中の案件は 409 closed「終了した案件は変更できません」", async () => {
    await setCaseStatus(room.id, "closed");
    await expectError(
      await patch(room.id, w.memberS1.token, {
        version: 1,
        title: "[UNIT_TEST]x",
      }),
      409,
      {
        code: "CONFLICT",
        reason: "closed",
        message: CASE_EDIT_MESSAGES.closed,
      },
    );
  });

  it("#150 4.2 の 8: 版が古ければ 409 stale（先の編集の後の2つ目の編集）", async () => {
    expect(
      (
        await patch(room.id, w.memberS1.token, {
          version: 1,
          description: "[UNIT_TEST]150C先の説明",
        })
      ).status,
    ).toBe(200);
    await expectError(
      await patch(room.id, w.memberS2.token, {
        version: 1,
        description: "[UNIT_TEST]150C後の説明",
      }),
      409,
      { code: "CONFLICT", reason: "stale", message: CASE_EDIT_MESSAGES.stale },
    );
    expect((await caseEditRow(room.id)).description).toBe(
      "[UNIT_TEST]150C先の説明",
    );
  });
});

describe("#150 150-C 非参加の管理者（担当部署のオーナー。C-122(3)・Q3＝C）", () => {
  it("#150 C-122(3): ownerS は expected で件名を変えられ、編集の後も詳細は 403・部屋のメッセージは 404 のまま（自動参加しない）", async () => {
    const res = await patch(room.id, w.ownerS.token, {
      expected: expectedNow(),
      title: "[UNIT_TEST]150Cオーナーの件名",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      caseId: room.id,
      titleFormatted: false,
    });
    expect(text).not.toContain(SECRET_DESCRIPTION);
    expect((await caseEditRow(room.id)).title).toBe(
      "[UNIT_TEST]150Cオーナーの件名",
    );
    expect((await detailOf(w.ownerS.token)).status).toBe(403);
    expect((await messagesOf(w.ownerS.token)).status).toBe(404);
  });

  it("#150 重大7・security: ownerS が description を送ると 403「説明を変更できるのは参加者だけです」。説明は変わらず、エラー・監査に説明の本文が出ない", async () => {
    const before = await caseEditSnapshot();
    const res = await patch(room.id, w.ownerS.token, {
      expected: expectedNow(),
      description: "[UNIT_TEST]150Cオーナーの説明",
    });
    const text = await res.text();
    expect(res.status).toBe(403);
    expect(JSON.parse(text)).toMatchObject({
      code: "FORBIDDEN",
      message: CASE_EDIT_MESSAGES.descriptionParticipantsOnly,
    });
    expect(text).not.toContain(SECRET_DESCRIPTION);
    expect(await caseEditSnapshot()).toEqual(before);
  });

  it.each([1, 2])(
    "#150 重大4・security: ownerS が version（%i。いまの版は 1）を送ると、版が合っていてもいなくても同じ 403（409 と 200 の違いで版の一致を答えない）",
    async (version) => {
      const body = await expectError(
        await patch(room.id, w.ownerS.token, {
          version,
          title: "[UNIT_TEST]150Cオーナーの件名",
        }),
        403,
        {
          code: "FORBIDDEN",
          message: CASE_EDIT_MESSAGES.descriptionParticipantsOnly,
        },
      );
      expect(body.reason).toBeUndefined();
    },
  );

  it("#150 重大7: 参加者が説明を変えても、監査の detail・非参加の管理者の概要・一覧に説明の本文が出ない", async () => {
    await patch(room.id, w.memberS1.token, {
      version: 1,
      description: "[UNIT_TEST]150C新しい秘密の説明",
    });
    const audits = await caseEditAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail ?? "").not.toContain("新しい秘密の説明");
    expect(audits[0]?.detail ?? "").not.toContain(SECRET_DESCRIPTION);
    for (const text of [
      await summaryText(w.ownerS.token),
      await listText(w.ownerS.token),
    ]) {
      expect(text).not.toContain("新しい秘密の説明");
      expect(text).not.toContain(SECRET_DESCRIPTION);
    }
  });
});

describe("#150 150-C 重大4：概要・一覧に版を返さず、説明だけの更新は非参加者に分からない", () => {
  it("#150 重大4: 概要・一覧の項目に version がない（参加者・非参加者・非参加の管理者のどれにも）", async () => {
    for (const token of [w.memberS1.token, w.noDept.token, w.ownerS.token]) {
      const summary = JSON.parse(await summaryText(token)) as Record<
        string,
        unknown
      >;
      expect(Object.keys(summary)).not.toContain("version");
      const list = JSON.parse(await listText(token)) as {
        items: Record<string, unknown>[];
      };
      const item = list.items.find((i) => i.id === room.id);
      expect(item).toBeDefined();
      expect(Object.keys(item ?? {})).not.toContain("version");
    }
  });

  it("#150 重大4: 説明だけの更新の前後で、非参加者（資格なし）と非参加の管理者が受け取る概要・一覧の本文が完全に同じ", async () => {
    const viewers = [w.noDept.token, w.ownerS.token];
    const before = await Promise.all(
      viewers.map(async (t) => [await summaryText(t), await listText(t)]),
    );
    const res = await patch(room.id, w.memberS1.token, {
      version: 1,
      description: "[UNIT_TEST]150C説明だけの更新",
    });
    expect(res.status).toBe(200);
    expect((await caseEditRow(room.id)).version).toBe(2);
    const after = await Promise.all(
      viewers.map(async (t) => [await summaryText(t), await listText(t)]),
    );
    expect(after).toEqual(before);
  });

  it("#150 4.2.1: 参加者の詳細には version（整数）があり、編集のたびに 1 進む", async () => {
    const first = (await (await detailOf(w.memberS1.token)).json()) as {
      version: number;
    };
    expect(first.version).toBe(1);
    await patch(room.id, w.memberS1.token, {
      version: 1,
      description: "[UNIT_TEST]150C版の確認",
    });
    const second = (await (await detailOf(w.memberS1.token)).json()) as {
      version: number;
      description: string;
    };
    expect(second).toMatchObject({
      version: 2,
      description: "[UNIT_TEST]150C版の確認",
    });
  });
});

describe("#150 150-C 担当部署の付け外し（C-133(2)）", () => {
  it("#150 C-133(2): 担当部署から外れた部署のオーナーは、一般の参加者として残り、詳細を見られる", async () => {
    // ownerS を参加者にしてから、deptS を外して deptD にする
    await env.DB.prepare(
      "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
    )
      .bind(room.roomId, w.ownerS.id, joinedAt(10))
      .run();
    const res = await patch(room.id, w.memberS1.token, {
      version: 1,
      departmentIds: [w.deptD.id],
    });
    expect(res.status).toBe(200);
    expect(await caseDepartmentIdsOf(room.id)).toEqual([w.deptD.id]);
    expect((await detailOf(w.ownerS.token)).status).toBe(200);
  });
});
