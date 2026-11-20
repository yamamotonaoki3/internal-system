// #149（149-C）#308、計画 plan-149c 5.5「資格を失ったとき」・9.8 F17：閲覧の資格を失った案件の中身の片付け（forgetCaseContent）が、
// 削除済みの一覧（["cases","deletedTodos",利用者,案件]）は exact で、履歴（["cases","todoEvents",利用者,案件,TODO]）は案件までの前方一致で取り除くこと。
// ほかの案件・ほかの利用者のキャッシュは残す。既存の取り除き（詳細・TODO・添付）も変えない。
// キーの形は計画 5.5 の「キャッシュのキー」（caseKeys.todoEvents・caseKeys.deletedTodos）。テストは期待の独立のため、キーを配列で直接書く。
// データは架空（testuser_・[UNIT_TEST]）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { forgetCaseContent } from "./useCaseWrites";

const USER = "01JTESTUSER149C000000000U1";
const OTHER_USER = "01JTESTUSER149C000000000U2";
const CASE = "01JTESTCASE149C00000000001";
const OTHER_CASE = "01JTESTCASE149C00000000002";
const TODO_1 = "01JTESTTODO149C00000000001";
const TODO_2 = "01JTESTTODO149C00000000002";

const DATA = { pages: [], pageParams: [] };

function clientWith(keys: readonly (readonly string[])[]) {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData([...key], DATA);
  return client;
}

const has = (client: QueryClient, key: readonly string[]) =>
  client.getQueryCache().find({ queryKey: [...key], exact: true }) !==
  undefined;

describe("#149 149-C #308 F17 forgetCaseContent の取り除くキー", () => {
  it("#149 149-C #308 F17: 削除済みの一覧（その案件）は exact で取り除き、ほかの案件・ほかの利用者のものは残す", async () => {
    const client = clientWith([
      ["cases", "deletedTodos", USER, CASE],
      ["cases", "deletedTodos", USER, OTHER_CASE],
      ["cases", "deletedTodos", OTHER_USER, CASE],
    ]);
    await forgetCaseContent(client, USER, CASE);
    expect(has(client, ["cases", "deletedTodos", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "deletedTodos", USER, OTHER_CASE])).toBe(true);
    expect(has(client, ["cases", "deletedTodos", OTHER_USER, CASE])).toBe(true);
  });

  it("#149 149-C #308 F17: 履歴は、その案件のすべての TODO の分を（案件までの前方一致で）取り除き、ほかの案件・ほかの利用者のものは残す", async () => {
    const client = clientWith([
      ["cases", "todoEvents", USER, CASE, TODO_1],
      ["cases", "todoEvents", USER, CASE, TODO_2],
      ["cases", "todoEvents", USER, OTHER_CASE, TODO_1],
      ["cases", "todoEvents", OTHER_USER, CASE, TODO_1],
    ]);
    await forgetCaseContent(client, USER, CASE);
    expect(has(client, ["cases", "todoEvents", USER, CASE, TODO_1])).toBe(
      false,
    );
    expect(has(client, ["cases", "todoEvents", USER, CASE, TODO_2])).toBe(
      false,
    );
    expect(has(client, ["cases", "todoEvents", USER, OTHER_CASE, TODO_1])).toBe(
      true,
    );
    expect(has(client, ["cases", "todoEvents", OTHER_USER, CASE, TODO_1])).toBe(
      true,
    );
  });

  it("#149 149-C #308 F17（退行の確認）: 既存の取り除き（詳細・TODO の一覧・添付）は変わらず、概要は残す", async () => {
    const client = clientWith([
      ["cases", "detail", USER, CASE],
      ["cases", "todos", USER, CASE],
      ["cases", "attachments", USER, CASE],
      ["cases", "summary", USER, CASE],
    ]);
    await forgetCaseContent(client, USER, CASE);
    expect(has(client, ["cases", "detail", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "todos", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "attachments", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "summary", USER, CASE])).toBe(true);
  });
});
