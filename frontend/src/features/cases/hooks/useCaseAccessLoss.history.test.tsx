// #149（149-C）#308・計画 plan-149c 5.5「資格を失ったとき」：useCaseAccessLoss は、参加者だった人が参加者でなくなったとき「だけ」、
// TODO の履歴・削除済みの一覧のキャッシュを取り除く（参加者だけの中身の後片付け forgetCaseContent の一部）。
//   (i) 参加者のままの再描画では残す、(ii) 最初から参加者でない描画では何も取り除かない（ほかの利用者・ほかの案件も）、
//   (iii) 参加者 → 非参加で、その案件の分だけ消える（ほかの案件・ほかの利用者の分は残る）。非参加のままの再描画や、非参加 → 参加でも消さない。
// キーは期待の独立のため、配列で直接書く。データは架空（testuser_・[UNIT_TEST]）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useCaseAccessLoss } from "./useCaseAccessLoss";

const USER = "01JTESTUSER149C000000000U1";
const OTHER_USER = "01JTESTUSER149C000000000U2";
const CASE = "01JTESTCASE149C00000000001";
const OTHER_CASE = "01JTESTCASE149C00000000002";
const TODO_1 = "01JTESTTODO149C00000000001";

const HISTORY = ["cases", "todoEvents", USER, CASE, TODO_1] as const;
const DELETED = ["cases", "deletedTodos", USER, CASE] as const;
const OTHER_CASE_HISTORY = [
  "cases",
  "todoEvents",
  USER,
  OTHER_CASE,
  TODO_1,
] as const;
const OTHER_CASE_DELETED = ["cases", "deletedTodos", USER, OTHER_CASE] as const;
const OTHER_USER_HISTORY = [
  "cases",
  "todoEvents",
  OTHER_USER,
  CASE,
  TODO_1,
] as const;
const OTHER_USER_DELETED = ["cases", "deletedTodos", OTHER_USER, CASE] as const;
const ALL_KEYS = [
  HISTORY,
  DELETED,
  OTHER_CASE_HISTORY,
  OTHER_CASE_DELETED,
  OTHER_USER_HISTORY,
  OTHER_USER_DELETED,
] as const;

function setup(initialParticipant: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  for (const key of ALL_KEYS) client.setQueryData([...key], { pages: [] });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onLost = () => undefined;
  const view = renderHook(
    ({ isParticipant }: { isParticipant: boolean }) =>
      useCaseAccessLoss({
        caseId: CASE,
        userId: USER,
        roomId: null,
        isParticipant,
        onLost,
      }),
    { wrapper, initialProps: { isParticipant: initialParticipant } },
  );
  return { client, ...view };
}

const has = (client: QueryClient, key: readonly string[]) =>
  client.getQueryCache().find({ queryKey: [...key], exact: true }) !==
  undefined;

const remaining = (client: QueryClient) =>
  ALL_KEYS.filter((key) => has(client, key));

describe("#149 149-C #308 履歴・削除済みの一覧のキャッシュは、参加者でなくなったときだけ取り除く", () => {
  it("#149 149-C #308 (i): 参加者のままの再描画では、履歴・削除済みの一覧のキャッシュが残る", () => {
    const { client, rerender } = setup(true);
    expect(remaining(client)).toHaveLength(ALL_KEYS.length);
    rerender({ isParticipant: true });
    rerender({ isParticipant: true });
    expect(remaining(client)).toHaveLength(ALL_KEYS.length);
  });

  it("#149 149-C #308 (ii): 最初から参加者でない人の描画では、何も取り除かない（ほかの利用者・ほかの案件の分も、この案件の分も）", () => {
    const { client, rerender } = setup(false);
    expect(remaining(client)).toHaveLength(ALL_KEYS.length);
    rerender({ isParticipant: false });
    expect(remaining(client)).toHaveLength(ALL_KEYS.length);
  });

  it("#149 149-C #308 (iii): 参加者から非参加になったときだけ、その案件の履歴（全 TODO）・削除済みの一覧が消え、ほかの案件・ほかの利用者の分は残る", () => {
    const { client, rerender } = setup(true);
    rerender({ isParticipant: false });
    expect(has(client, HISTORY)).toBe(false);
    expect(has(client, DELETED)).toBe(false);
    expect(has(client, OTHER_CASE_HISTORY)).toBe(true);
    expect(has(client, OTHER_CASE_DELETED)).toBe(true);
    expect(has(client, OTHER_USER_HISTORY)).toBe(true);
    expect(has(client, OTHER_USER_DELETED)).toBe(true);
  });

  it("#149 149-C #308 (iii): 取り除いた後、非参加のままの再描画や、参加者に戻ったときには、作り直されたキャッシュを取り除かない（変化の1回だけ）", () => {
    const { client, rerender } = setup(true);
    rerender({ isParticipant: false });
    client.setQueryData([...DELETED], { pages: [] });
    client.setQueryData([...HISTORY], { pages: [] });
    rerender({ isParticipant: false });
    expect(has(client, DELETED)).toBe(true);
    expect(has(client, HISTORY)).toBe(true);
    rerender({ isParticipant: true });
    expect(has(client, DELETED)).toBe(true);
    expect(has(client, HISTORY)).toBe(true);
  });
});
