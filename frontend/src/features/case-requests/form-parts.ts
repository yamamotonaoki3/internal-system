// 案件の作成申請の機能のうち、案件の内容の編集（cases の S-17。#150 の 150-C）が使う欄の部品・候補・類似件名の公開部分。
// index.ts とは分ける：index.ts は案件の機能（cases）を参照する部品を含むため、cases から index.ts を参照すると循環になる。
export { caseRequestKeys } from "./api/query-keys";
export type { Choice } from "./api/case-request-api";
export { DepartmentCheckboxes } from "./components/DepartmentCheckboxes";
export { SimilarTitleNotice } from "./components/SimilarTitleNotice";
export {
  useClientChoices,
  useDepartmentChoices,
} from "./hooks/useCaseRequestChoices";
export { useSimilarTitle } from "./hooks/useSimilarTitle";
export { TITLE_CAUTION } from "./labels";
