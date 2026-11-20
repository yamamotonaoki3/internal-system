// ヘッダーの検索欄（#155）。送ると、前後の空白を除いた語で S-15（/search?q=…）へ移る。
import { createSearchParams, useNavigate } from "react-router";
import { SearchKeywordForm } from "./SearchKeywordForm";

export function HeaderSearch() {
  const navigate = useNavigate();
  return (
    <SearchKeywordForm
      label="メッセージの検索"
      onSearch={(q) =>
        void navigate({
          pathname: "/search",
          search: createSearchParams({ q }).toString(),
        })
      }
    />
  );
}
