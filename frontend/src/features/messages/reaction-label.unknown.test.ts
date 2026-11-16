// #138 AC-1（1-7 AC-2・AC-3）: reactionLabel — 絵文字はその文字、スタンプは日本語の名前、一覧にないスタンプ id は id をそのまま出す。データは架空。
// ミューテーションの生き残り（reaction-label.ts:8・10）を検出するための補強。期待値は設計書（reactions.md）と reaction-label.ts 先頭の定め
//   「一覧にないスタンプ id は id をそのまま出す（表示を隠さない）」から書く（STAMPS を読み込まず、リテラルで書く）。
import { describe, expect, it } from "vitest";
import { describeReaction, reactionLabel } from "./reaction-label";

describe("#138 AC-1 reactionLabel", () => {
  it("#138 AC-1: 一覧にないスタンプ id は、例外を出さず id をそのまま返す（表示を隠さない）", () => {
    expect(reactionLabel({ kind: "stamp", value: "retired-stamp" })).toBe(
      "retired-stamp",
    );
  });

  it("#138 AC-1: 一覧にないスタンプ id でも、describeReaction は例外を出さず id から始まる文言を作る", () => {
    expect(
      describeReaction({
        kind: "stamp",
        value: "retired-stamp",
        count: 1,
        reactedByMe: false,
        users: [
          {
            id: "01JTESTUSER00000000000R001",
            displayName: "テストリアクション1",
            isActive: true,
          },
        ],
      }),
    ).toBe("retired-stamp 1人：テストリアクション1");
  });

  it("#138 AC-1: スタンプは日本語の名前を返す", () => {
    expect(reactionLabel({ kind: "stamp", value: "ok" })).toBe("了解");
  });

  it("#138 AC-1: 絵文字は値の文字をそのまま返す（値がスタンプの id と同じ綴りでも、スタンプの名前にしない）", () => {
    expect(reactionLabel({ kind: "emoji", value: "ok" })).toBe("ok");
    expect(reactionLabel({ kind: "emoji", value: "👍" })).toBe("👍");
  });
});
