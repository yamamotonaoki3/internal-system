// S-17 の内容の編集（#150 の 150-C）の入力チェック。件名・説明の規則は shared/case-rules.ts の定義（サーバー側でも同じ規則で検査する）。
// 件名は整形した値を送らない（整形で値が変わったかをサーバーが返し、「表記を整えて保存しました」を出すため）。
import { z } from "zod";
import {
  caseDescriptionSchema,
  caseTitleSchema,
} from "../../../../../shared/case-rules";

export const caseEditFormSchema = z.object({
  title: z.string().refine((value) => caseTitleSchema.safeParse(value).success),
  description: caseDescriptionSchema,
  clientId: z.string().min(1),
  // 0件にはできない（C-130(1)）
  departmentIds: z.array(z.string()).min(1),
});

export type CaseEditFormValues = z.infer<typeof caseEditFormSchema>;

/** サーバーの 422 の fields のうち、フォームの欄に当たるもの */
export const caseEditFieldNames = [
  "title",
  "description",
  "clientId",
  "departmentIds",
] as const;
