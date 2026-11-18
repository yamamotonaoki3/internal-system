// 申請の欄の候補：取引先（有効なもの）・担当部署（有効なもの）。追加の候補の社員の検索は members の useUserSearch を使う。
import { useQuery } from "@tanstack/react-query";
import {
  fetchClientChoices,
  fetchDepartmentChoices,
} from "../api/case-request-api";
import { caseRequestChoiceKeys } from "../api/query-keys";

export function useClientChoices() {
  return useQuery({
    queryKey: caseRequestChoiceKeys.clients,
    queryFn: fetchClientChoices,
    retry: false,
  });
}

export function useDepartmentChoices() {
  return useQuery({
    queryKey: caseRequestChoiceKeys.departments,
    queryFn: fetchDepartmentChoices,
    retry: false,
  });
}
