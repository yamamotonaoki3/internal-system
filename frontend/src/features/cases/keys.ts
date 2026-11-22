// 案件の機能のうち、キャッシュのキー（caseKeys）だけの公開部分。添付の削除（messages）が使う。
// index.ts とは分ける：index.ts は messages の部品を読み込むため、messages から index.ts を参照すると循環になる。
export { caseKeys } from "./api/query-keys";
