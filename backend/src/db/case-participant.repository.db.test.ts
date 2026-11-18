// #147（147-B）5-1 AC-3・AC-7・AC-11・AC-17・AC-21（Q6）、C-182 Q1・Q2、計画レビュー1回目の2：参加者の追加・削除（退出）と納期の変更の
// Repository の書き込み（1操作＝1回の db.batch）を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの（計画 147-B の「判定と書き込みの条件の突き合わせ」「batch の中身」「同時の操作」）：
//   batch の前提（案件が進行中／操作者が有効で資格がある／対象の条件／納期の読んだ値）が、それぞれ崩れたら、何も残らない
//   （参加の行・案件の行・版・監査）。末尾の不変条件（削除の後も有効な参加者が1人以上）。監査が同じ batch で1件（detail は入れ子なし・氏名なし）。
//   既存の監査の行を書き換えない。2つの書き込みを同時に送ったとき（Promise.all）の結果。
// 判定の順・応答コード・読み直しの結果（409 の reason など）は、結合テスト（routes/cases.participants.test.ts）と、
// 割り込みのテスト（services/case-participant.interleave.test.ts）で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 147-B。実装の担当へ）：backend/src/db/case.repository.ts
//   repository.addParticipant({ caseId, actorId, userId, traceId }): Promise<unknown>
//   repository.removeParticipant({ caseId, actorId, userId, traceId }): Promise<unknown>（userId が actorId と同じなら退出）
//   repository.changeDueDate({ caseId, actorId, before: string | null, after: string | null, traceId }): Promise<unknown>
//   前提・不変条件が崩れたら CaseStateChangedError（case.repository.ts から公開）を投げ、batch 全体が取り消される。未知の DB エラーはそのまま投げる。
//   監査（同じ batch。audit-actions.ts に足す）：target_type は "case"、target_id は案件 ID、actor_id は操作者、result は "success"
//     case.participant.add（detail { caseId, userId }）・case.participant.remove（detail { caseId, userId, self }）・
//     case.due_date.change（detail { caseId, before, after }）
//   納期の変更は cases.due_date・version（＋1）・updated_at を更新する。
// 自動参加の人：参加者で、有効で、全体管理者か、案件の担当部署のどれかのオーナー（その時点の割り当て）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  MISSING_CASE_ID,
  removeCaseMember,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  caseWriteAudits,
  caseWriteRow,
  caseWriteSnapshot,
  isFlat,
  parseDetail,
  participantIdsOf,
  setCaseDepartments,
  setCaseDueDate,
  setCaseStatus,
} from "../../test/case-participant-fixtures";
import {
  casereqTraceId,
  removeGlobalAdmin,
  removeOwner,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { makeOwner } from "../../test/department-fixtures";
import { CaseStateChangedError, withCases } from "./case.repository";

let w: CaseWorld;
/** 進行中・deptS 担当：memberS1（作成者）・memberD1。自動参加の人はいない。納期なし */
let plain: SeededCase;
/** 進行中・deptS 担当：memberS1・ownerS（担当部署のオーナー）・admin（全体管理者）・ownerD（他部署のオーナー） */
let withAuto: SeededCase;

const NAME_S1 = "テスト操作者147B";
const NAME_TARGET = "テスト対象147B";

const add = (caseId: string, actorId: string, userId: string) =>
  withCases(env, (r) =>
    r.addParticipant({ caseId, actorId, userId, traceId: casereqTraceId() }),
  );
const remove = (caseId: string, actorId: string, userId: string) =>
  withCases(env, (r) =>
    r.removeParticipant({
      caseId,
      actorId,
      userId,
      traceId: casereqTraceId(),
    }),
  );
const changeDueDate = (
  caseId: string,
  actorId: string,
  before: string | null,
  after: string | null,
) =>
  withCases(env, (r) =>
    r.changeDueDate({
      caseId,
      actorId,
      before,
      after,
      traceId: casereqTraceId(),
    }),
  );

/** 失敗が CaseStateChangedError で、何も変わっていないこと */
async function expectNothingChanged(run: () => Promise<unknown>) {
  const before = await caseWriteSnapshot();
  await expect(run()).rejects.toBeInstanceOf(CaseStateChangedError);
  expect(await caseWriteSnapshot()).toEqual(before);
}

beforeEach(async () => {
  w = await setupCaseWorld();
  await setDisplayName(w.memberS1.id, NAME_S1);
  await setDisplayName(w.memberS2.id, NAME_TARGET);
  plain = await seedCase({
    n: 71,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147B参加者",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  withAuto = await seedCase({
    n: 72,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147B自動参加",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.ownerS.id, joinedAt: joinedAt(2) },
      { userId: w.admin.id, joinedAt: joinedAt(3) },
      { userId: w.ownerD.id, joinedAt: joinedAt(4) },
    ],
  });
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#147 147-B 5-1 AC-3・AC-7: 参加者の追加の batch", () => {
  it("#147 AC-3・AC-7: 参加者が社員を追加すると、参加の行が1行入り、監査 case.participant.add が1件（detail は caseId・userId だけ）", async () => {
    await add(plain.id, w.memberS1.id, w.memberS2.id);
    expect(await participantIdsOf(plain.roomId)).toEqual(
      [w.memberS1.id, w.memberD1.id, w.memberS2.id].sort(),
    );
    const audits = await caseWriteAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.participant.add",
      target_type: "case",
      target_id: plain.id,
      result: "success",
    });
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: plain.id,
      userId: w.memberS2.id,
    });
  });

  it("#147 AC-3: 所属の部署に関係なく追加できる（所属のない社員）", async () => {
    await add(plain.id, w.memberS1.id, w.noDept.id);
    expect(await participantIdsOf(plain.roomId)).toContain(w.noDept.id);
  });

  // 前提が崩れたら何も残らない（計画「判定と書き込みの条件の突き合わせ」の追加の列の全行）。
  // 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
  it.each([
    {
      label: "案件が終了中",
      arrange: () => setCaseStatus(plain.id, "closed"),
      actor: () => w.memberS1.id,
      target: () => w.memberS2.id,
    },
    {
      label: "操作者が無効（参加の行は残る）",
      arrange: () => setUserActive(w.memberS1.id, false),
      actor: () => w.memberS1.id,
      target: () => w.memberS2.id,
    },
    {
      label: "操作者が参加者でない",
      arrange: async () => {},
      actor: () => w.memberS2.id,
      target: () => w.noDept.id,
    },
    {
      label: "操作者が外された",
      arrange: () => removeCaseMember(plain.roomId, w.memberS1.id),
      actor: () => w.memberS1.id,
      target: () => w.memberS2.id,
    },
    {
      label: "対象が無効",
      arrange: async () => {},
      actor: () => w.memberS1.id,
      target: () => w.inactive.id,
    },
    {
      label: "対象がすでに参加者",
      arrange: async () => {},
      actor: () => w.memberS1.id,
      target: () => w.memberD1.id,
    },
  ])(
    "#147 147-B 前提（追加）: $label なら CaseStateChangedError で、参加の行・案件の行・監査が何も変わらない",
    async ({ arrange, actor, target }) => {
      await arrange();
      await expectNothingChanged(() => add(plain.id, actor(), target()));
    },
  );

  it("#147 147-B 前提（追加）: 案件の担当部署のオーナーでも、参加していなければ追加できない（管理の資格は追加の資格でない）", async () => {
    await expectNothingChanged(() => add(plain.id, w.ownerS.id, w.memberS2.id));
  });

  it("#147 147-B 前提（追加）: 存在しない案件には何も書かない", async () => {
    await expectNothingChanged(() =>
      add(MISSING_CASE_ID, w.memberS1.id, w.memberS2.id),
    );
  });
});

describe("#147 147-B 5-1 AC-3・AC-7: 参加者の削除・退出の batch", () => {
  it("#147 AC-3・AC-7: 参加者が別の参加者を外すと、参加の行が消え、監査 case.participant.remove が1件（self は false）", async () => {
    await remove(plain.id, w.memberS1.id, w.memberD1.id);
    expect(await participantIdsOf(plain.roomId)).toEqual([w.memberS1.id]);
    const audits = await caseWriteAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.participant.remove",
      target_type: "case",
      target_id: plain.id,
      result: "success",
    });
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: plain.id,
      userId: w.memberD1.id,
      self: false,
    });
  });

  it("#147 AC-3: 本人の退出で、自分の行が消え、監査の self が true", async () => {
    await remove(plain.id, w.memberD1.id, w.memberD1.id);
    expect(await participantIdsOf(plain.roomId)).toEqual([w.memberS1.id]);
    const [audit] = await caseWriteAudits();
    expect(parseDetail(audit?.detail ?? null)).toEqual({
      caseId: plain.id,
      userId: w.memberD1.id,
      self: true,
    });
  });

  it("#147 AC-3: その案件の参加の行だけを消す（ほかの案件の同じ人の参加は残る）", async () => {
    await remove(withAuto.id, w.memberS1.id, w.memberS1.id);
    expect(await participantIdsOf(withAuto.roomId)).not.toContain(
      w.memberS1.id,
    );
    expect(await participantIdsOf(plain.roomId)).toContain(w.memberS1.id);
  });

  it("#147 C-142(1): 退職者（無効な社員）の参加の行も外せる", async () => {
    await addCaseMember(plain.roomId, w.inactive.id);
    await remove(plain.id, w.memberS1.id, w.inactive.id);
    expect(await participantIdsOf(plain.roomId)).not.toContain(w.inactive.id);
  });

  it("#147 Q1: 自動参加の全体管理者がいれば、一般の参加者の最後の1人も外せる（全体管理者を有効な参加者に数える）", async () => {
    // withAuto から一般の参加者を memberS1 だけにし、他部署のオーナーも外す
    await removeCaseMember(withAuto.roomId, w.ownerD.id);
    await removeCaseMember(withAuto.roomId, w.ownerS.id);
    await remove(withAuto.id, w.memberS1.id, w.memberS1.id);
    expect(await participantIdsOf(withAuto.roomId)).toEqual([w.admin.id]);
  });

  it("#147 C-133: 他部署（担当部署でない）のオーナーは外せる", async () => {
    await remove(withAuto.id, w.memberS1.id, w.ownerD.id);
    expect(await participantIdsOf(withAuto.roomId)).not.toContain(w.ownerD.id);
  });

  it("#147 C-133: 担当部署から外れた部署のオーナーは、一般の参加者として外せる", async () => {
    await setCaseDepartments(withAuto.id, [w.deptD.id]);
    // deptD のオーナー（ownerD）が新しく自動参加の人になるため、ownerS を外す
    await remove(withAuto.id, w.memberS1.id, w.ownerS.id);
    expect(await participantIdsOf(withAuto.roomId)).not.toContain(w.ownerS.id);
  });

  it("#147 C-133: オーナーの交代で前のオーナーになった人は外せる", async () => {
    await removeOwner(w.ownerS.id, w.deptS.id);
    await remove(withAuto.id, w.memberS1.id, w.ownerS.id);
    expect(await participantIdsOf(withAuto.roomId)).not.toContain(w.ownerS.id);
  });

  it.each([
    {
      label: "案件が終了中",
      arrange: () => setCaseStatus(plain.id, "closed"),
      room: () => plain,
      actor: () => w.memberS1.id,
      target: () => w.memberD1.id,
    },
    {
      label: "操作者が無効（参加の行は残る）",
      arrange: () => setUserActive(w.memberS1.id, false),
      room: () => plain,
      actor: () => w.memberS1.id,
      target: () => w.memberD1.id,
    },
    {
      label: "操作者が参加者でない",
      arrange: async () => {},
      room: () => plain,
      actor: () => w.memberS2.id,
      target: () => w.memberD1.id,
    },
    {
      label: "対象が参加者でない",
      arrange: async () => {},
      room: () => plain,
      actor: () => w.memberS1.id,
      target: () => w.memberS2.id,
    },
    {
      label: "対象が担当部署のオーナー（自動参加）",
      arrange: async () => {},
      room: () => withAuto,
      actor: () => w.memberS1.id,
      target: () => w.ownerS.id,
    },
    {
      label: "対象が全体管理者（自動参加）",
      arrange: async () => {},
      room: () => withAuto,
      actor: () => w.memberS1.id,
      target: () => w.admin.id,
    },
    {
      label: "担当部署のオーナー本人の退出（Q2）",
      arrange: async () => {},
      room: () => withAuto,
      actor: () => w.ownerS.id,
      target: () => w.ownerS.id,
    },
    {
      label: "全体管理者本人の退出（Q2）",
      arrange: async () => {},
      room: () => withAuto,
      actor: () => w.admin.id,
      target: () => w.admin.id,
    },
    {
      label:
        "最後の有効な参加者の退出（退職者の行だけが残る。末尾の不変条件。Q1）",
      arrange: async () => {
        await removeCaseMember(plain.roomId, w.memberD1.id);
        await addCaseMember(plain.roomId, w.inactive.id);
      },
      room: () => plain,
      actor: () => w.memberS1.id,
      target: () => w.memberS1.id,
    },
  ])(
    "#147 147-B 前提・不変条件（削除）: $label なら CaseStateChangedError で、何も変わらない",
    async ({ arrange, room, actor, target }) => {
      await arrange();
      await expectNothingChanged(() => remove(room().id, actor(), target()));
    },
  );
});

describe("#147 147-B 5-1 AC-17・AC-21（Q6）: 納期の変更の batch", () => {
  it("#147 AC-17: 参加者が納期を設定すると、due_date・版（+1）・updated_at が変わり、監査 case.due_date.change が1件（before・after）", async () => {
    const before = await caseWriteRow(plain.id);
    await changeDueDate(plain.id, w.memberS1.id, null, "2026-12-01");
    const after = await caseWriteRow(plain.id);
    expect(after.due_date).toBe("2026-12-01");
    expect(after.version).toBe(before.version + 1);
    expect(after.updated_at).not.toBe(before.updated_at);
    const audits = await caseWriteAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.due_date.change",
      target_type: "case",
      target_id: plain.id,
      result: "success",
    });
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: plain.id,
      before: null,
      after: "2026-12-01",
    });
  });

  it("#147 AC-17: 未定（null）に戻せる。監査の before は前の値、after は null", async () => {
    await setCaseDueDate(plain.id, "2026-12-01");
    await changeDueDate(plain.id, w.memberS1.id, "2026-12-01", null);
    expect((await caseWriteRow(plain.id)).due_date).toBeNull();
    const [audit] = await caseWriteAudits();
    expect(parseDetail(audit?.detail ?? null)).toEqual({
      caseId: plain.id,
      before: "2026-12-01",
      after: null,
    });
  });

  it.each([
    { label: "参加していない担当部署のオーナー", actor: () => w.ownerS.id },
    { label: "参加していない全体管理者", actor: () => w.admin.id },
  ])(
    "#147 AC-21（Q6）・C-122: $label は納期を変えられる",
    async ({ actor }) => {
      await changeDueDate(plain.id, actor(), null, "2026-12-02");
      expect((await caseWriteRow(plain.id)).due_date).toBe("2026-12-02");
      expect(await caseWriteAudits()).toHaveLength(1);
    },
  );

  it.each([
    {
      label: "案件が終了中",
      arrange: () => setCaseStatus(plain.id, "closed"),
      actor: () => w.memberS1.id,
      before: null,
    },
    {
      label: "操作者（参加者）が無効（参加の行は残る）",
      arrange: () => setUserActive(w.memberS1.id, false),
      actor: () => w.memberS1.id,
      before: null,
    },
    {
      label: "操作者が一般の非参加者",
      arrange: async () => {},
      actor: () => w.memberS2.id,
      before: null,
    },
    {
      label: "操作者が他部署（担当部署でない）のオーナー",
      arrange: async () => {},
      actor: () => w.ownerD.id,
      before: null,
    },
    {
      label: "非参加の担当部署のオーナーが、オーナーでなくなった",
      arrange: () => removeOwner(w.ownerS.id, w.deptS.id),
      actor: () => w.ownerS.id,
      before: null,
    },
    {
      label: "非参加の全体管理者が、全体管理者でなくなった",
      arrange: () => removeGlobalAdmin(w.admin.id),
      actor: () => w.admin.id,
      before: null,
    },
    {
      label: "非参加の担当部署のオーナーが、担当部署から外れた",
      arrange: () => setCaseDepartments(plain.id, [w.deptD.id]),
      actor: () => w.ownerS.id,
      before: null,
    },
    {
      label: "読んだ値（before）が今の値と違う",
      arrange: () => setCaseDueDate(plain.id, "2026-12-05"),
      actor: () => w.memberS1.id,
      before: null,
    },
    {
      label: "読んだ値は日付だが、今は未定",
      arrange: async () => {},
      actor: () => w.memberS1.id,
      before: "2026-12-05",
    },
  ])(
    "#147 147-B 前提（納期）: $label なら CaseStateChangedError で、due_date・版・監査が何も変わらない",
    async ({ arrange, actor, before }) => {
      await arrange();
      await expectNothingChanged(() =>
        changeDueDate(plain.id, actor(), before, "2026-12-10"),
      );
    },
  );

  it("#147 147-B 前提（納期）: 新しく就任したオーナーは、参加していなくても変えられる（その時点の割り当てで判定する）", async () => {
    await removeOwner(w.ownerS.id, w.deptS.id);
    await makeOwner(w.memberS2.id, w.deptS.id);
    await changeDueDate(plain.id, w.memberS2.id, null, "2026-12-03");
    expect((await caseWriteRow(plain.id)).due_date).toBe("2026-12-03");
  });
});

describe("#147 147-B 監査：project-rules（監査）", () => {
  it("#147 147-B: 3つの監査の detail は入れ子を持たず、氏名（表示名）を含まない", async () => {
    await add(plain.id, w.memberS1.id, w.memberS2.id);
    await remove(plain.id, w.memberS1.id, w.memberS2.id);
    await changeDueDate(plain.id, w.memberS1.id, null, "2026-12-01");
    const audits = await caseWriteAudits();
    expect(audits.map((a) => a.action)).toEqual([
      "case.participant.add",
      "case.participant.remove",
      "case.due_date.change",
    ]);
    for (const audit of audits) {
      const detail = parseDetail(audit.detail);
      expect(isFlat(detail), audit.action).toBe(true);
      expect(audit.detail ?? "", audit.action).not.toContain(NAME_S1);
      expect(audit.detail ?? "", audit.action).not.toContain(NAME_TARGET);
      expect(audit.detail ?? "", audit.action).not.toContain("example.com");
    }
  });

  it("#147 147-B: 後の操作は、前の監査の行を書き換えない", async () => {
    await add(plain.id, w.memberS1.id, w.memberS2.id);
    const [first] = await caseWriteAudits();
    await remove(plain.id, w.memberS1.id, w.memberS2.id);
    await changeDueDate(plain.id, w.memberS1.id, null, "2026-12-01");
    const audits = await caseWriteAudits();
    expect(audits).toHaveLength(3);
    expect(audits[0]).toEqual(first);
  });
});

describe("#147 147-B 同時の操作（2つの書き込みを同時に送る）", () => {
  it("#147 147-B: 同じ人を同時に2回追加すると、片方だけが成り立ち、もう片方は CaseStateChangedError。行は1つ、監査も1件", async () => {
    const results = await Promise.allSettled([
      add(plain.id, w.memberS1.id, w.memberS2.id),
      add(plain.id, w.memberD1.id, w.memberS2.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CaseStateChangedError,
    );
    expect(
      (await participantIdsOf(plain.roomId)).filter(
        (id) => id === w.memberS2.id,
      ),
    ).toHaveLength(1);
    expect(await caseWriteAudits()).toHaveLength(1);
  });

  it("#147 147-B Q1: 最後の2人の一般の参加者が同時に退出すると、片方だけが成り立ち、有効な参加者が1人残る（監査も1件）", async () => {
    const results = await Promise.allSettled([
      remove(plain.id, w.memberS1.id, w.memberS1.id),
      remove(plain.id, w.memberD1.id, w.memberD1.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      CaseStateChangedError,
    );
    expect(await participantIdsOf(plain.roomId)).toHaveLength(1);
    expect(await caseWriteAudits()).toHaveLength(1);
  });

  it("#147 147-B: 納期を同じ読んだ値から同時に2回変えると、片方だけが成り立ち、版は1つだけ増える", async () => {
    const before = await caseWriteRow(plain.id);
    const results = await Promise.allSettled([
      changeDueDate(plain.id, w.memberS1.id, null, "2026-12-01"),
      changeDueDate(plain.id, w.memberD1.id, null, "2026-12-02"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await caseWriteRow(plain.id)).version).toBe(before.version + 1);
    expect(await caseWriteAudits()).toHaveLength(1);
  });
});
