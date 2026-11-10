import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReauth } from "../auth/hooks/useReauth";
import { channelKeys } from "../channels";
import {
  changeDepartmentOwner,
  createDepartment,
  renameDepartment,
  type Department,
  type OwnerAssignment,
} from "./department-api";
import { departmentKeys } from "./query-keys";
import { NotSentError } from "./write-errors";

/** 再認証（必要なら）を挟んで書き込む。再認証が完了しなかった場合は、要求を送らずに NotSentError にする */
async function sendWithReauth<T>(
  withReauth: <R>(title: string, operation: () => Promise<R>) => Promise<R>,
  title: string,
  operation: () => Promise<T>,
): Promise<T> {
  let sent = false;
  try {
    return await withReauth(title, () => {
      sent = true;
      return operation();
    });
  } catch (error) {
    if (sent) throw error;
    throw new NotSentError({ cause: error });
  }
}

/** 部署の作成・改名・オーナー交代。成功したら、一覧とオーナー候補を取り直す（再読込なしで画面に反映する） */
export function useDepartmentMutations() {
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  const onSuccess = () =>
    queryClient.invalidateQueries({ queryKey: departmentKeys.all });
  // 作成・交代では、全体管理者のオーナーが専用チャンネルへ自動参加するため、参加中のチャンネルも取り直す
  const onSuccessWithChannels = async () => {
    await Promise.all([
      onSuccess(),
      queryClient.invalidateQueries({ queryKey: channelKeys.all }),
    ]);
  };
  return {
    create: useMutation({
      mutationFn: (input: {
        name: string;
        description: string;
        ownerUserId?: string;
        previousDepartmentSuccessorUserId?: string;
      }) =>
        sendWithReauth(withReauth, "部署の作成", () => createDepartment(input)),
      onSuccess: onSuccessWithChannels,
    }),
    rename: useMutation({
      mutationFn: (input: { department: Department; name: string }) =>
        sendWithReauth(withReauth, "部署名の変更", () =>
          renameDepartment(input.department.id, {
            name: input.name,
            version: input.department.version,
          }),
        ),
      onSuccess,
    }),
    changeOwner: useMutation({
      mutationFn: (input: {
        department: Department;
        assignment: OwnerAssignment;
      }) =>
        sendWithReauth(withReauth, "オーナーの変更", () =>
          changeDepartmentOwner(input.department.id, {
            ...input.assignment,
            version: input.department.version,
          }),
        ),
      onSuccess: onSuccessWithChannels,
    }),
  };
}
