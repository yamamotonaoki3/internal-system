// API 層：案件の TODO（#149。EP-5-13・14・17・18）の通信はここに書く。共通の apiClient を使い、応答は Zod で検証する。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";
import { todoProgressSchema } from "./case-api";

const personSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string(),
  isActive: z.boolean(),
});
const itemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  completed: z.boolean(),
  version: z.number().int(),
  assignee: personSchema.nullable(),
  previousAssignee: personSchema.nullable(),
  completedAssignee: personSchema.nullable(),
});
const pageSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
  progress: todoProgressSchema,
});
const addedSchema = itemSchema.extend({ progress: todoProgressSchema });
const stateChangedSchema = z.object({
  id: z.string().min(1),
  completed: z.boolean(),
  version: z.number().int(),
  progress: todoProgressSchema,
});

export type TodoPerson = z.infer<typeof personSchema>;
export type CaseTodo = z.infer<typeof itemSchema>;
export type CaseTodoPage = z.infer<typeof pageSchema>;

const todosPath = (caseId: string) =>
  `/cases/${encodeURIComponent(caseId)}/todos`;

export async function fetchCaseTodos(
  caseId: string,
  cursor?: string,
): Promise<CaseTodoPage> {
  const response = await apiClient.get(todosPath(caseId), {
    params: { cursor },
  });
  return pageSchema.parse(response.data);
}

/** assigneeUserId が null なら担当なし */
export async function addCaseTodo(
  caseId: string,
  input: { title: string; assigneeUserId: string | null },
): Promise<z.infer<typeof addedSchema>> {
  const response = await apiClient.post(todosPath(caseId), input);
  return addedSchema.parse(response.data);
}

/** completed が真なら完了に、偽なら未完了に戻す */
export async function setCaseTodoCompleted(
  caseId: string,
  todoId: string,
  completed: boolean,
): Promise<z.infer<typeof stateChangedSchema>> {
  const response = await apiClient.post(
    `${todosPath(caseId)}/${encodeURIComponent(todoId)}/${completed ? "complete" : "uncomplete"}`,
  );
  return stateChangedSchema.parse(response.data);
}
