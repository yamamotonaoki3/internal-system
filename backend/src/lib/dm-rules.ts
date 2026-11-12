// DM（1対1）の規則。画面にもDBにも依存しない純粋な定義。

/** 2人の組を一意にするキー：利用者IDを小さい順に ':' でつなぐ（同じ2人の DM を重ねて作らないため）。同じIDどうし（自分宛て）は呼び出し側の誤り */
export function directKeyOf(a: string, b: string): string {
  if (a === b) throw new Error("同じ利用者どうしの DM のキーは作れません");
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
