// S-18 の中身：申請フォームと自分の申請。「修正して再申請」で、元の申請の値を入れたフォームに作り直す。
// 欄の候補（取引先・部署）と、申請できるか（所属がある、または全体管理者）は、読み終わった部分から出す（説明などはすぐに入力できる）。
// 下書きはここで1つだけ開き、再申請で入れた元の説明も下書きとして保存する。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { useSession, useSignedInUserId } from "../../auth";
import { caseRequestDraftScope, useDraft } from "../../drafts";
import { useMyProfile } from "../../profile";
import type { CaseRequestItem } from "../api/case-request-api";
import { describeError } from "../describe-error";
import {
  useClientChoices,
  useDepartmentChoices,
} from "../hooks/useCaseRequestChoices";
import { CaseRequestForm } from "./CaseRequestForm";
import { MyCaseRequestList } from "./MyCaseRequestList";

// 所属がなくても申請できる全体管理者かどうか（表示の制御。認可はサーバーが行う）
const ADMIN_PERMISSION = "perm.account.create";

export function CaseRequestWorkspace() {
  const userId = useSignedInUserId();
  const draft = useDraft(userId, caseRequestDraftScope());
  const session = useSession();
  const profile = useMyProfile();
  const clients = useClientChoices();
  const departments = useDepartmentChoices();
  const [resubmit, setResubmit] = useState<{
    item: CaseRequestItem;
    key: number;
  } | null>(null);

  const failed = [session, profile, clients, departments].find(
    (query) => query.isError,
  );

  function startResubmit(item: CaseRequestItem) {
    draft.save(item.description);
    setResubmit((current) => ({ item, key: (current?.key ?? 0) + 1 }));
  }

  return (
    <>
      {failed !== undefined && (
        <Alert tone="error" role="alert">
          {describeError(failed.error)}
        </Alert>
      )}
      <CaseRequestForm
        key={resubmit?.key ?? 0}
        clients={clients.data}
        departments={departments.data}
        canRequest={
          profile.isSuccess && session.isSuccess
            ? profile.data.department !== null ||
              session.data.permissions?.includes(ADMIN_PERMISSION) === true
            : undefined
        }
        userId={userId}
        draft={draft}
        resubmit={resubmit?.item ?? null}
      />
      <section>
        <h2 className="mb-2 text-lg font-bold">自分の申請</h2>
        <MyCaseRequestList onResubmit={startResubmit} />
      </section>
    </>
  );
}
