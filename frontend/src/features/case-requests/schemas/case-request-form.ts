// S-18 の入力チェック。件名・説明・納期の規則は shared/case-rules.ts の定義（サーバー側でも同じ規則で検査する）。
// 件名は整形した値を送らない（整形で値が変わったかをサーバーが返し、「表記を整えて保存しました」を出すため）。
import { z } from "zod";
import {
  caseDescriptionSchema,
  caseDueDateSchema,
  caseTitleSchema,
  isDueDateBeforeToday,
} from "../../../../../shared/case-rules";

export const caseRequestFormSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().refine((value) => caseTitleSchema.safeParse(value).success),
  description: caseDescriptionSchema,
  // 空は「納期なし」。今日（日本時間）より前は送らない
  dueDate: z
    .string()
    .refine(
      (value) =>
        value === "" ||
        (caseDueDateSchema.safeParse(value).success &&
          !isDueDateBeforeToday(value, new Date())),
    ),
  departmentIds: z.array(z.string()).min(1),
});

export type CaseRequestFormValues = z.infer<typeof caseRequestFormSchema>;

/** サーバーの 422 の fields のうち、フォームの欄に当たるもの（候補は欄の外の検索欄に出す） */
export const caseRequestFieldNames = [
  "clientId",
  "title",
  "description",
  "dueDate",
  "departmentIds",
] as const;
