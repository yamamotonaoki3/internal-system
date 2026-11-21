// 検索の機能のうち、検索の結果のキャッシュのキー（searchKeys）だけの公開部分。資格を失ったときの後片付け（cases）が使う。
// index.ts とは分ける：index.ts は案件の機能（cases）を参照する部品を含むため、cases から index.ts を参照すると循環になる。
export { searchKeys } from "./api/query-keys";
