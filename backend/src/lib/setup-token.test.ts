// #119 AC-1・AC-4：初回専用の認証（SETUP_TOKEN）の照合（計画 D-6・改訂版 3.1・最終の修正 3）。
// 両方を SHA-256 にして定数時間で比べる。トークンはテストの中で乱数から作る（実際の値を書かない）。
import { describe, expect, it } from "vitest";
import { newSetupToken } from "../../test/random-secrets";
import { verifySetupToken } from "./setup-token";

describe("初回専用の認証の照合（verifySetupToken）", () => {
  it("#119 AC-1: 設定と同じトークンは true", async () => {
    const token = newSetupToken();
    expect(token).toHaveLength(43);
    expect(await verifySetupToken(token, token)).toBe(true);
  });

  it("#119 AC-1: 別のトークンは false", async () => {
    expect(await verifySetupToken(newSetupToken(), newSetupToken())).toBe(
      false,
    );
  });

  it("#119 AC-1: 1文字だけ違う・大文字小文字だけ違うトークンは false", async () => {
    const token = newSetupToken();
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(await verifySetupToken(token.slice(0, -1) + last, token)).toBe(
      false,
    );
    const flipped = token.replace(/[a-z]/, (c) => c.toUpperCase());
    if (flipped !== token)
      expect(await verifySetupToken(flipped, token)).toBe(false);
  });

  it("#119 AC-1: 長さが違う入力（42文字・44文字・空・前後に空白）は false（長さの違いで例外にしない）", async () => {
    const token = newSetupToken();
    for (const input of [
      token.slice(0, 42),
      `${token}A`,
      "",
      ` ${token}`,
      `${token}\n`,
    ]) {
      expect(await verifySetupToken(input, token)).toBe(false);
    }
  });

  it("#119 AC-1: 非常に長い入力でも false で、例外にしない", async () => {
    const token = newSetupToken();
    expect(await verifySetupToken("A".repeat(10_000), token)).toBe(false);
  });
});
