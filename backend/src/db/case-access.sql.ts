// 案件の管理の資格の SQL の条件。案件の Repository（case.repository.ts）と、案件の添付の Repository（case-attachment.repository.ts）が使う。
import { sql, type SQL } from "drizzle-orm";
import { ROLE_IDS } from "../lib/permissions";

/**
 * 管理の資格＝有効な全体管理者、または、その案件の担当部署のどれかの有効なオーナー。
 * 先に読んだ割り当てに頼ると、交代・無効化の後の要求に参加者数が返るため、読み取りの SQL の中で決める
 */
export function canManageSql(actorId: string | SQL, caseId: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM users mu WHERE mu.id = ${actorId} AND mu.is_active = 1 AND (
    EXISTS (SELECT 1 FROM user_role_assignments ga
      WHERE ga.user_id = mu.id AND ga.role_id = ${ROLE_IDS.globalAdmin} AND ga.scope_type = 'company')
    OR EXISTS (SELECT 1 FROM user_role_assignments oa
      JOIN case_departments ocd ON ocd.department_id = oa.department_id
      WHERE oa.user_id = mu.id AND oa.role_id = ${ROLE_IDS.owner} AND oa.scope_type = 'department'
        AND ocd.case_id = ${caseId})))`;
}
