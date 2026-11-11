// #124 AC-2（3-4 AC-4・AC-5 を後続 Issue が足せる作り）：通知の種類ごとの文言・移動先の対応表（notification-views.ts）の判定。
// 契約（実装者へ。計画「種類の定義元」）：
//   frontend/src/features/notifications/notification-views.ts が公開する：
//   - type NotificationView = { label: string; to: (item: NotificationItem) => string | null }
//   - NOTIFICATION_VIEWS：Record<NotificationKind, NotificationView>（本 Issue では 0 件）
//   - describeNotification(item, views: Readonly<Record<string, NotificationView>> = NOTIFICATION_VIEWS): { label: string; to: string | null }
//       対応表に（自分自身のキーとして）ない種類は、汎用の { label: "通知", to: null }（落ちない）
//       対応表にある種類は、その label と to(item) の結果（null なら移動先なし）
//   item の形：{ id, kind: string, roomId, messageId, targetId, createdAt, readAt }
// データは架空。
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KIND_DEFINITIONS } from "../../../../shared/notification-kinds";
import { NOTIFICATION_VIEWS, describeNotification } from "./notification-views";

const item = (
  kind: string,
  targetId: string | null = "01JTESTTARGET0000000001",
) => ({
  id: "01JTESTNOTIF00000000000001",
  kind,
  roomId: "01JTESTROOM000000000000R1",
  messageId: null,
  targetId,
  createdAt: "2026-11-11T00:00:00.000Z",
  readAt: null,
});

describe("#124 AC-2 describeNotification", () => {
  it("#124 AC-2: 対応表に無い種類は、汎用の「通知」・移動先なしで、落ちない", () => {
    expect(describeNotification(item("test_unknown_kind"))).toEqual({
      label: "通知",
      to: null,
    });
    expect(describeNotification(item("test_unknown_kind"), {})).toEqual({
      label: "通知",
      to: null,
    });
  });

  it.each(["__proto__", "toString", "constructor"])(
    "#124 AC-2: Object が継承するキー（%s）の種類も汎用の表示にする",
    (kind) => {
      expect(describeNotification(item(kind), {})).toEqual({
        label: "通知",
        to: null,
      });
    },
  );

  it("#124 AC-2: 対応表を差し替えると、文言と移動先がその通りになる（後続の Issue が 1 件足せる）", () => {
    const views = {
      test_kind: {
        label: "テストの通知",
        to: (n: { targetId: string | null }) => `/test/${n.targetId}`,
      },
    };
    expect(describeNotification(item("test_kind"), views)).toEqual({
      label: "テストの通知",
      to: "/test/01JTESTTARGET0000000001",
    });
  });

  it("#124 AC-2: 対応表の to が null を返す種類は、文言はそのままで移動先なし", () => {
    const views = { test_kind: { label: "テストの通知", to: () => null } };
    expect(describeNotification(item("test_kind"), views)).toEqual({
      label: "テストの通知",
      to: null,
    });
  });

  it("#124 AC-2: 差し替えた対応表にない種類は、汎用の表示のまま", () => {
    const views = { test_kind: { label: "テストの通知", to: () => "/x" } };
    expect(describeNotification(item("test_other_kind"), views)).toEqual({
      label: "通知",
      to: null,
    });
  });
});

describe("#124 AC-2 NOTIFICATION_VIEWS（定義元との対応）", () => {
  it("#124 AC-2: 定義元の全種類に、文言と移動先の関数がある（種類を足したのに画面の対応を忘れない）", () => {
    for (const kind of Object.keys(NOTIFICATION_KIND_DEFINITIONS)) {
      expect(Object.hasOwn(NOTIFICATION_VIEWS, kind)).toBe(true);
      const view = (
        NOTIFICATION_VIEWS as Record<
          string,
          { label: string; to: (n: unknown) => string | null }
        >
      )[kind];
      expect(typeof view?.label).toBe("string");
      expect(typeof view?.to).toBe("function");
    }
  });
});
