// #120 AC-2：パスワードのハッシュの形式・パラメータの上限・再ハッシュの判定の境界（ADR-0007。ln=16・r=8・p=2）。
// 変異テストで生き残った境界（<= と <、||と&&）と文字列の形を確かめる。期待値は ADR-0007 の PHC 形式から決める。
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import { scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordConstantCost,
  type ScryptParams,
} from "./password";

const TEST_PASSWORD = "TestPass123!";
const b64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/=+$/, "");

/** 指定したパラメータで、本物の scrypt のハッシュを作る（上限を超える値は計算せず、形だけ作る） */
async function phc(
  logN: number,
  r: number,
  p: number,
  password = TEST_PASSWORD,
) {
  const salt = new Uint8Array(16).fill(7);
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 2 ** logN, r, p, maxmem: 256 * 1024 * 1024 },
      (e, k) => (e === null ? resolve(k) : reject(e)),
    ),
  );
  return `$scrypt$ln=${logN},r=${r},p=${p}$${b64(salt)}$${b64(key)}`;
}

describe(
  "hashPassword の形式（PHC）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 AC-2: $scrypt$ln=16,r=8,p=2$<塩16バイト>$<鍵32バイト>（base64・パディングなし）", async () => {
      const hash = await hashPassword(TEST_PASSWORD);
      const m =
        /^\$scrypt\$ln=16,r=8,p=2\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
          hash,
        );
      expect(m).not.toBeNull();
      expect(Buffer.from(m?.[1] ?? "", "base64")).toHaveLength(16);
      expect(Buffer.from(m?.[2] ?? "", "base64")).toHaveLength(32);
      expect(m?.[1]).not.toContain("=");
      expect(m?.[2]).not.toContain("=");
      expect(m?.[1]).toHaveLength(22);
      expect(m?.[2]).toHaveLength(43);
    });

    it("#120 AC-2: 同じパスワードでも、塩が違うので毎回違うハッシュになる", async () => {
      expect(await hashPassword(TEST_PASSWORD)).not.toBe(
        await hashPassword(TEST_PASSWORD),
      );
    });
  },
);

describe(
  "パラメータの上限（verifyPassword）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 AC-2: 上限ちょうど（ln=16・r=8・p=2）と最小（ln=1・r=1・p=1）は検証する", async () => {
      expect(await verifyPassword(TEST_PASSWORD, await phc(16, 8, 2))).toBe(
        true,
      );
      expect(await verifyPassword(TEST_PASSWORD, await phc(1, 1, 1))).toBe(
        true,
      );
    });

    it("#120 AC-2: どれか1つでも上限を超える・0 なら false（重い計算を強いない）", async () => {
      const salt = b64(new Uint8Array(16).fill(7));
      const key = b64(new Uint8Array(32).fill(1));
      for (const params of [
        "ln=17,r=8,p=2",
        "ln=16,r=9,p=2",
        "ln=16,r=8,p=3",
        "ln=0,r=8,p=2",
        "ln=16,r=0,p=2",
        "ln=16,r=8,p=0",
      ]) {
        expect(
          await verifyPassword(
            TEST_PASSWORD,
            `$scrypt$${params}$${salt}$${key}`,
          ),
          params,
        ).toBe(false);
      }
    });

    it("#120 AC-2: 形式の前後に余計な文字がある値は false", async () => {
      const good = await phc(10, 8, 1);
      expect(await verifyPassword(TEST_PASSWORD, good)).toBe(true);
      expect(await verifyPassword(TEST_PASSWORD, `x${good}`)).toBe(false);
      expect(await verifyPassword(TEST_PASSWORD, `${good}x`)).toBe(false);
      expect(await verifyPassword("WrongPass123!", good)).toBe(false);
    });
  },
);

describe(
  "verifyPasswordConstantCost の計算の内容",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it("#120 0-2 AC-7: 保存値なしのダミーは、現行のパラメータ・鍵32バイト・塩16バイトで計算する", async () => {
      const calls: { salt: Uint8Array; params: ScryptParams }[] = [];
      await verifyPasswordConstantCost(TEST_PASSWORD, null, {
        derive: async (_p, salt, params) => {
          calls.push({ salt, params });
          return new Uint8Array(32);
        },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.params).toEqual({ logN: 16, r: 8, p: 2, keyLength: 32 });
      expect(calls[0]?.salt).toHaveLength(16);
    });

    it("#120 AC-2: 保存値があるときは、その塩・パラメータ・鍵の長さで計算し、結果を比べる", async () => {
      const stored = await phc(10, 8, 1);
      const calls: ScryptParams[] = [];
      const ok = await verifyPasswordConstantCost(TEST_PASSWORD, stored, {
        derive: async (password, salt, params) => {
          calls.push(params);
          expect(Buffer.from(salt)).toEqual(Buffer.alloc(16, 7));
          return new Promise((resolve, reject) =>
            scrypt(
              password,
              salt,
              params.keyLength,
              { N: 2 ** params.logN, r: params.r, p: params.p },
              (e, k) => (e === null ? resolve(k) : reject(e)),
            ),
          );
        },
      });
      expect(ok).toBe(true);
      expect(calls).toEqual([{ logN: 10, r: 8, p: 1, keyLength: 32 }]);
    });

    it("#120 AC-2: 計算の結果が違えば false（長さが同じでも内容で比べる）", async () => {
      const stored = await phc(10, 8, 1);
      expect(
        await verifyPasswordConstantCost(TEST_PASSWORD, stored, {
          derive: async () => new Uint8Array(32),
        }),
      ).toBe(false);
    });
  },
);

describe("needsRehash の境界", { timeout: SCRYPT_TEST_TIMEOUT_MS }, () => {
  it("#120 AC-2: 形式が壊れた値・別方式は false（作り直しの対象にしない）", () => {
    for (const s of [
      "",
      "not-a-hash",
      "$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
    ])
      expect(needsRehash(s), s).toBe(false);
  });

  it("#120 AC-2: 現行より大きいパラメータも、現行と違うので true", () => {
    expect(needsRehash("$scrypt$ln=17,r=8,p=2$c2FsdA$aGFzaA")).toBe(true);
    expect(needsRehash("$scrypt$ln=16,r=8,p=2$c2FsdA$aGFzaA")).toBe(false);
  });
});
