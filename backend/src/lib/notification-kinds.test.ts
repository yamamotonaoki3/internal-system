// #124 AC-2（3-4 AC-4・AC-5 を後続 Issue が足せる作り）：通知の種類の定義元（shared/notification-kinds.ts）の判定。
// 本 Issue では種類は 0 件。テストは「定義を差し替えられる引数」で任意の種類を使い、本番の定義が空でも後続が足せることを確かめる。
// 契約（実装者へ。計画「種類の定義元」）：
//  - NOTIFICATION_KIND_DEFINITIONS：種類 → { containsRoomContent: boolean } の読み取り専用のオブジェクト（本 Issue では 0 件）
//  - type NotificationKind = keyof typeof NOTIFICATION_KIND_DEFINITIONS
//  - isNotificationKind(value: unknown, definitions = NOTIFICATION_KIND_DEFINITIONS): value is NotificationKind
//      定義に自分自身のキーとして存在する文字列だけ true（継承されたキー "toString" 等・文字列でない値は false）
//  - roomContentKinds(definitions = NOTIFICATION_KIND_DEFINITIONS): 属性 containsRoomContent が true の種類の配列
// データは架空（test_ で始まる種類名）。
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KIND_DEFINITIONS,
  isNotificationKind,
  roomContentKinds,
} from "../../../shared/notification-kinds";

const DEFINITIONS = {
  test_room_kind: { containsRoomContent: true },
  test_plain_kind: { containsRoomContent: false },
  test_room_kind_2: { containsRoomContent: true },
} as const;

describe("#124 AC-2 isNotificationKind", () => {
  it("#124 AC-2: 本番の定義にない文字列は false", () => {
    expect(isNotificationKind("test_undefined_kind")).toBe(false);
    expect(isNotificationKind("")).toBe(false);
  });

  it.each([123, null, undefined, {}, [], true])(
    "#124 AC-2: 文字列でない値（%o）は false",
    (value) => {
      expect(isNotificationKind(value)).toBe(false);
    },
  );

  it.each(["__proto__", "toString", "constructor", "hasOwnProperty"])(
    "#124 AC-2: Object が継承するキー（%s）は種類として認めない",
    (key) => {
      expect(isNotificationKind(key)).toBe(false);
      expect(isNotificationKind(key, DEFINITIONS)).toBe(false);
    },
  );

  it("#124 AC-2: 渡した定義にある種類だけ true（後続の Issue が定義に 1 件足せば通る）", () => {
    expect(isNotificationKind("test_room_kind", DEFINITIONS)).toBe(true);
    expect(isNotificationKind("test_plain_kind", DEFINITIONS)).toBe(true);
    expect(isNotificationKind("test_undefined_kind", DEFINITIONS)).toBe(false);
  });

  it("#124 AC-2: 定義が空なら、どの文字列も false", () => {
    expect(isNotificationKind("test_room_kind", {})).toBe(false);
  });
});

describe("#124 AC-2 roomContentKinds（3-1 AC-3 の土台）", () => {
  it("#124 AC-2: containsRoomContent が true の種類だけを返す", () => {
    expect([...roomContentKinds(DEFINITIONS)].sort()).toEqual([
      "test_room_kind",
      "test_room_kind_2",
    ]);
  });

  it("#124 AC-2: true の種類がなければ空の配列（空の IN を作らせない判断の元になる）", () => {
    expect(
      roomContentKinds({ test_plain_kind: { containsRoomContent: false } }),
    ).toEqual([]);
    expect(roomContentKinds({})).toEqual([]);
  });

  it("#124 AC-2: 本番の定義の各種類は containsRoomContent を真偽値で持ち、部屋の内容を含む種類の一覧はその部分集合", () => {
    for (const definition of Object.values(NOTIFICATION_KIND_DEFINITIONS))
      expect(typeof definition.containsRoomContent).toBe("boolean");
    for (const kind of roomContentKinds()) {
      expect(isNotificationKind(kind)).toBe(true);
      expect(NOTIFICATION_KIND_DEFINITIONS[kind].containsRoomContent).toBe(
        true,
      );
    }
  });
});
