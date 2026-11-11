// #130 AC-1（0-4 AC-1・AC-3・AC-4・AC-9）・EP-0-03・EP-0-12：自分のプロフィールの取得（GET /api/me/profile）と変更（PATCH /api/me/profile）を、
// 実際のアプリ入口と隔離 D1 で確かめる。時刻は vi.useFakeTimers（Date だけ）で PROFILE_NOW に固定する。
// 公開形の仮定（契約。計画 1章）：
//  - GET の応答：displayName・legalName（復号した値）・department（{id,name}）・jobTitle・email・extension・status（{kind,returnAt,message}）。Cache-Control: no-store
//  - PATCH の本文：displayName・status・returnAt・statusMessage のうち変える項目だけ（strict。0項目は422）
//  - PATCH の応答：displayName・status・returnAt・statusMessage・updatedAt
//  - 検証のエラーは 422 VALIDATION_ERROR（項目名は fields）
// データは架空（testuser_prof_・テスト太郎・テスト花子・@example.com・[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROFILE_NOW,
  cleanupProfileTestData,
  detailKeys,
  failAuditOf,
  insertProfileUser,
  newProfileContext,
  profileAuditRows,
  profileRequest,
  sessionTokenFor,
  userStatusRow,
  type ProfileContext,
} from "../../test/profile-fixtures";
import { insertDepartment } from "../../test/role-fixtures";

let context: ProfileContext;
let deptId: string;
let selfId: string;
let otherId: string;
let selfToken: string;
let logLines: string[];

const iso = (ms: number) => new Date(PROFILE_NOW.getTime() + ms).toISOString();
const HOUR = 60 * 60 * 1000;
const ONE_YEAR_LATER = "2027-11-11T00:00:00.000Z";

const patch = (body: unknown, options: { origin?: string | null } = {}) =>
  profileRequest(context, "PATCH", "/api/me/profile", {
    token: selfToken,
    body,
    ...options,
  });
const getProfile = (token: string | null = selfToken) =>
  profileRequest(context, "GET", "/api/me/profile", { token });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PROFILE_NOW);
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  context = newProfileContext();
  deptId = await insertDepartment("プロフィール営業");
  selfId = await insertProfileUser(context, "testuser_prof_self", deptId, {
    legalName: "テスト花子",
    displayName: "テスト太郎",
    extension: "1234",
  });
  otherId = await insertProfileUser(context, "testuser_prof_other", deptId, {
    legalName: "テスト次郎本名",
    displayName: "テスト次郎",
    extension: "5678",
  });
  selfToken = await sessionTokenFor(selfId);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupProfileTestData();
});

describe("#130 EP-0-03 GET /api/me/profile", () => {
  it("#130 AC-1（0-4 AC-11・EP-0-03）: 自分の表示名・本名（復号）・部署・メール・内線・ステータスを返し、no-store", async () => {
    const res = await getProfile();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      displayName: "テスト太郎",
      legalName: "テスト花子",
      department: { id: deptId, name: "[UNIT_TEST]プロフィール営業" },
      email: "testuser_prof_self@example.com",
      extension: "1234",
      status: { kind: "available", returnAt: null, message: null },
    });
  });

  it("#130 EP-0-03: principal の利用者の値だけを返し、他人の情報が混ざらない", async () => {
    const body = JSON.stringify(await (await getProfile()).json());
    expect(body).not.toContain("テスト次郎");
    expect(body).not.toContain("testuser_prof_other");
    expect(body).not.toContain("5678");
    expect(body).not.toContain(otherId);
  });

  it("#130 EP-0-03: 未認証は 401", async () => {
    const res = await getProfile(null);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#130 AC-1（0-4 AC-11）: 本名の復号値をログに出さない", async () => {
    await getProfile();
    expect(logLines.join("\n")).not.toContain("テスト花子");
  });
});

describe("#130 EP-0-12 PATCH /api/me/profile の共通", () => {
  it("#130 EP-0-12: 未認証は 401", async () => {
    const res = await profileRequest(context, "PATCH", "/api/me/profile", {
      token: null,
      body: { displayName: "テスト改名" },
    });
    expect(res.status).toBe(401);
  });

  it("#130 EP-0-12: 許可外の Origin は 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const before = await userStatusRow(selfId);
    const res = await patch(
      { displayName: "テスト改名" },
      { origin: "https://origin.invalid" },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await userStatusRow(selfId)).toEqual(before);
  });

  it("#130 EP-0-12: 0項目（{}）は 422", async () => {
    const res = await patch({});
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each([
    { legalName: "テスト改名本名" },
    { email: "testuser_prof_new@example.com" },
    { extension: "9999" },
    { jobTitle: "テスト役職" },
    { departmentId: "01JTESTPROFDEPT00000000001" },
    { userId: "01JTESTPROFOTHER0000000001", displayName: "テスト改名" },
  ])(
    "#130 AC-1（0-4 AC-9）: 未知の項目（%o）は 422 で、何も変わらない",
    async (body) => {
      const before = await userStatusRow(selfId);
      const res = await patch(body);
      expect(res.status).toBe(422);
      expect(await userStatusRow(selfId)).toEqual(before);
    },
  );

  it("#130 EP-0-12: 壊れた JSON は 422", async () => {
    const res = await profileRequest(context, "PATCH", "/api/me/profile", {
      token: selfToken,
      rawBody: "{",
    });
    expect(res.status).toBe(422);
  });
});

describe("#130 AC-1（0-4 AC-9）表示名の変更", () => {
  it.each([
    ["1文字", "あ", "あ"],
    ["30文字", "あ".repeat(30), "あ".repeat(30)],
    ["前後の空白は除く", "  テスト改名  ", "テスト改名"],
  ])("#130 AC-1（0-4 AC-9）: %s は可", async (_label, input, saved) => {
    const res = await patch({ displayName: input });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: saved });
    expect((await userStatusRow(selfId))?.display_name).toBe(saved);
  });

  it.each([
    ["空", ""],
    ["空白だけ（除いた後0文字）", "   "],
    ["31文字", "あ".repeat(31)],
    ["改行を含む", "テスト\n改名"],
    ["タブを含む", "テスト\t改名"],
    ["文字列でない", 123],
  ])("#130 AC-1（0-4 AC-9）: %s は 422", async (_label, input) => {
    const res = await patch({ displayName: input });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await userStatusRow(selfId))?.display_name).toBe("テスト太郎");
  });

  it("#130 AC-1（0-4 AC-9）: 他人と同じ表示名も可（重複を拒否しない）", async () => {
    const res = await patch({ displayName: "テスト次郎" });
    expect(res.status).toBe(200);
    expect((await userStatusRow(selfId))?.display_name).toBe("テスト次郎");
  });

  it("#130 AC-1（0-4 AC-9・R-09）: 他人の表示名を変える経路はない（自分の行だけが変わる）", async () => {
    await patch({ displayName: "テスト改名" });
    expect((await userStatusRow(otherId))?.display_name).toBe("テスト次郎");
    for (const [method, path] of [
      ["PATCH", `/api/users/${otherId}/profile`],
      ["PUT", `/api/users/${otherId}/profile`],
      ["PATCH", `/api/users/${otherId}`],
    ] as const) {
      const res = await profileRequest(context, method, path, {
        token: selfToken,
        body: { displayName: "テスト乗っ取り" },
      });
      expect([404, 405]).toContain(res.status);
    }
    expect((await userStatusRow(otherId))?.display_name).toBe("テスト次郎");
  });

  it("#130 AC-1（0-4 AC-9）: script タグを含む表示名も、そのままの文字として保存して返す", async () => {
    const name = "<script>x</script>";
    const res = await patch({ displayName: name });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: name });
  });
});

describe("#130 AC-1（0-4 AC-9・Q-1）表示名の変更の監査", () => {
  it("#130 AC-1（0-4 AC-9・Q-1）: 表示名を変えると profile.display_name_change が1件残り、detail のキーの集合は空（値を入れない）", async () => {
    const res = await patch({ displayName: "テスト改名" });
    expect(res.status).toBe(200);
    const audits = await profileAuditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: selfId,
      action: "profile.display_name_change",
      target_type: "user",
      target_id: selfId,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual([]);
    expect(audits[0]?.detail ?? "").not.toContain("テスト改名");
    expect(audits[0]?.detail ?? "").not.toContain("テスト太郎");
  });

  it("#130 AC-1（0-4 AC-9・Q-1）: 監査の挿入が失敗すると、表示名の更新も取り消される（同じ db.batch）", async () => {
    await failAuditOf("profile.display_name_change");
    const before = await userStatusRow(selfId);
    const res = await patch({ displayName: "テスト改名" });
    expect(res.status).toBe(500);
    expect(await userStatusRow(selfId)).toEqual(before);
    expect(await profileAuditRows()).toHaveLength(0);
  });

  it("#130 AC-1（P-2）: ステータス・一言だけの変更では監査を残さない", async () => {
    const res = await patch({
      status: "away",
      returnAt: iso(HOUR),
      statusMessage: "テスト外出中",
    });
    expect(res.status).toBe(200);
    expect(await profileAuditRows()).toHaveLength(0);
  });
});

describe("#130 AC-1（0-4 AC-1・AC-3）ステータスと一言", () => {
  it.each(["available", "away", "absent", "vacation", "meeting"])(
    "#130 AC-2（6-1 AC-3）: %s を保存でき、応答と DB に反映される",
    async (kind) => {
      const res = await patch({ status: kind });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: kind });
      expect((await userStatusRow(selfId))?.status_kind).toBe(kind);
    },
  );

  it("#130 AC-2（6-1 AC-3）: 5種類以外は 422", async () => {
    const res = await patch({ status: "busy" });
    expect(res.status).toBe(422);
    expect((await userStatusRow(selfId))?.status_kind).toBe("available");
  });

  it("#130 AC-1（0-4 AC-3）: 一言は100文字まで可・101文字は 422・空は null", async () => {
    expect((await patch({ statusMessage: "あ".repeat(100) })).status).toBe(200);
    expect((await userStatusRow(selfId))?.status_message).toBe(
      "あ".repeat(100),
    );
    expect((await patch({ statusMessage: "あ".repeat(101) })).status).toBe(422);
    const cleared = await patch({ statusMessage: "  " });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ statusMessage: null });
    expect((await userStatusRow(selfId))?.status_message).toBeNull();
  });

  it("#130 AC-1（0-4 AC-3）: 一言に改行は 422", async () => {
    expect((await patch({ statusMessage: "一行目\n二行目" })).status).toBe(422);
  });

  it("#130 AC-1（0-4 AC-1）: 変更後の GET にステータス・戻り予定・一言が出る", async () => {
    const returnAt = iso(2 * HOUR);
    await patch({ status: "meeting", returnAt, statusMessage: "テスト会議" });
    expect(await (await getProfile()).json()).toMatchObject({
      status: { kind: "meeting", returnAt, message: "テスト会議" },
    });
  });

  it("#130 個人情報: 表示名・一言・本名・メールの値をログに出さない", async () => {
    await patch({
      displayName: "テスト改名ログ",
      statusMessage: "テスト秘密の一言",
    });
    await getProfile();
    const logs = logLines.join("\n");
    for (const value of [
      "テスト改名ログ",
      "テスト秘密の一言",
      "テスト花子",
      "testuser_prof_self@example.com",
    ])
      expect(logs).not.toContain(value);
  });
});

describe("#130 AC-1（0-4 AC-4）戻り予定（時刻固定）", () => {
  it("#130 AC-1（0-4 AC-4）: 現在ちょうどは 422", async () => {
    const res = await patch({ status: "away", returnAt: iso(0) });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#130 AC-1（0-4 AC-4）: 過去は 422", async () => {
    expect((await patch({ status: "away", returnAt: iso(-1) })).status).toBe(
      422,
    );
  });

  it("#130 AC-1（0-4 AC-4）: 現在の1ms後は可", async () => {
    expect((await patch({ status: "away", returnAt: iso(1) })).status).toBe(
      200,
    );
  });

  it("#130 AC-1（0-4 AC-4）: 現在＋1年ちょうどは可、1ms 超えは 422", async () => {
    expect(
      (await patch({ status: "vacation", returnAt: ONE_YEAR_LATER })).status,
    ).toBe(200);
    const over = new Date(new Date(ONE_YEAR_LATER).getTime() + 1).toISOString();
    expect((await patch({ status: "vacation", returnAt: over })).status).toBe(
      422,
    );
  });

  it("#130 AC-1（0-4 AC-4）: オフセット付きの ISO 8601 を受け付け、同じ時点として保存する", async () => {
    const res = await patch({
      status: "away",
      returnAt: "2026-11-11T18:00:00+09:00",
    });
    expect(res.status).toBe(200);
    const saved = (await userStatusRow(selfId))?.status_return_at ?? "";
    expect(new Date(saved).toISOString()).toBe("2026-11-11T09:00:00.000Z");
  });

  it.each(["2026-11-12T09:00", "明日", "2026-13-01T00:00:00Z", 1_800_000_000])(
    "#130 AC-1（0-4 AC-4）: 日時として読めない・オフセットのない値（%s）は 422",
    async (returnAt) => {
      expect((await patch({ status: "away", returnAt })).status).toBe(422);
    },
  );

  it("#130 AC-1（0-4 AC-4・P-3）: 在席と戻り予定を同時に送ると 422", async () => {
    const res = await patch({ status: "available", returnAt: iso(HOUR) });
    expect(res.status).toBe(422);
  });

  it("#130 AC-1（0-4 AC-4・P-3）: 在席のまま戻り予定だけを送ると 422", async () => {
    const res = await patch({ returnAt: iso(HOUR) });
    expect(res.status).toBe(422);
    expect((await userStatusRow(selfId))?.status_return_at).toBeNull();
  });

  it("#130 AC-1（0-4 AC-4）: 外出中なら戻り予定だけの変更は可", async () => {
    await patch({ status: "away", returnAt: iso(HOUR) });
    const res = await patch({ returnAt: iso(2 * HOUR) });
    expect(res.status).toBe(200);
    const saved = (await userStatusRow(selfId))?.status_return_at ?? "";
    expect(new Date(saved).toISOString()).toBe(iso(2 * HOUR));
  });

  it("#130 AC-1（0-4 AC-4・P-3）: 在席を選ぶと戻り予定が消える", async () => {
    await patch({ status: "away", returnAt: iso(HOUR) });
    const res = await patch({ status: "available" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "available",
      returnAt: null,
    });
    expect((await userStatusRow(selfId))?.status_return_at).toBeNull();
  });

  it("#130 AC-1（0-4 AC-4）: 戻り予定を過ぎても、ステータスは自動で変わらない", async () => {
    await patch({ status: "away", returnAt: iso(HOUR) });
    vi.setSystemTime(new Date(PROFILE_NOW.getTime() + 3 * HOUR));
    const body = (await (
      await getProfile(await sessionTokenFor(selfId))
    ).json()) as { status: { returnAt: string } };
    expect(body).toMatchObject({
      status: { kind: "away" },
    });
    expect(new Date(body.status.returnAt).toISOString()).toBe(iso(HOUR));
  });
});
