// ヘッダーの検索欄（#155）。送ると、前後の空白を除いた語で S-15（/search?q=…）へ移る。
import { createSearchParams, useNavigate } from "react-router";
import { SearchKeywordForm } from "./SearchKeywordForm";

export function HeaderSearch() {
  const navigate = useNavigate();
  // 768px 未満では form ごと出さない（ヘッダーが崩れるため）。入口はドロワーの先頭のリンク（navigation.ts の searchNavItem）
  return (
    <div className="hidden md:block">
      <SearchKeywordForm
        label="メッセージの検索"
        submitLabel="メッセージを検索"
        onSearch={(q) =>
          void navigate({
            pathname: "/search",
            search: createSearchParams({ q }).toString(),
          })
        }
      />
    </div>
  );
}
