-- #146（146-B）E2E専用（e2e/case-approvals.spec.ts）。承認の後に、案件・案件専用チャンネル・自動参加ができたことを、識別子だけで数える（読み取りだけ）。
-- 承認した申請：01JTE2E00000000000B0008146（取引先 QKF）。申請者 e2euser_caseapp_member・担当部署のオーナー e2euser_caseapp_owner。
SELECT
  (SELECT COUNT(*) FROM cases c
     JOIN case_creation_requests r ON r.case_id = c.id
     WHERE r.id = '01JTE2E00000000000B0008146' AND r.status = 'approved'
       AND c.case_number GLOB 'QKF-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]') AS check_case_count,
  (SELECT COUNT(*) FROM channels ch
     JOIN cases c ON c.channel_id = ch.room_id
     WHERE c.request_id = '01JTE2E00000000000B0008146'
       AND ch.purpose = 'case' AND ch.visibility = 'private' AND ch.department_id IS NULL
       AND ch.name = c.case_number) AS check_channel_count,
  (SELECT COUNT(*) FROM channel_members m
     JOIN cases c ON c.channel_id = m.channel_id
     WHERE c.request_id = '01JTE2E00000000000B0008146'
       AND m.user_id IN ('01JTE2E00000000000B0005146', '01JTE2E00000000000B0006146')) AS check_member_count,
  (SELECT COUNT(*) FROM cases c
     JOIN case_creation_requests r ON r.case_id = c.id
     WHERE r.id = '01JTE2E00000000000B0009146') AS check_rejected_case_count;
