// 申請の欄の候補：取引先（有効なもの）・担当部署（有効なもの）・追加の候補の社員の検索。
import { useQuery } from "@tanstack/react-query";
import {
  fetchClientChoices,
  fetchDepartmentChoices,
  searchCandidateUsers,
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

export function useCandidateSearch(q: string) {
  return useQuery({
    queryKey: caseRequestChoiceKeys.users(q),
    queryFn: () => searchCandidateUsers(q),
    enabled: q !== "",
    retry: false,
  });
}
