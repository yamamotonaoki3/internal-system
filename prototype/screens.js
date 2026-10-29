"use strict";

// screens.md の画面構成を試すための架空データ。案件の状態と権限は app.js に置く。
// S-21（部署のお知らせの専用画面）は廃止された（C-108）ため欠番。番号は詰めない。
const screenCatalog = [
  ["S01", "共通レイアウト"],
  ["S02", "ログイン"],
  ["S03", "初回パスワード変更"],
  ["S04", "パスワード変更"],
  ["S05", "チャンネル"],
  ["S06", "ダイレクトメッセージ"],
  ["S07", "スレッド（返信）"],
  ["S08", "部署作成"],
  ["S09", "チャンネル一覧と参加"],
  ["S10", "チャンネル作成の申請"],
  ["S11", "チャンネル作成の承認一覧"],
  ["S12", "チャンネル招待"],
  ["S13", "部署管理（オーナー）"],
  ["S14", "通知一覧"],
  ["S15", "検索結果"],
  ["S16", "案件一覧"],
  ["S17", "案件詳細"],
  ["S18", "案件の作成申請・参加者管理"],
  ["S19", "プロフィール設定"],
  ["S20", "社員一覧"],
  ["S22", "アカウント管理"],
  ["S23", "アカウント登録"],
  ["S24", "部署の一覧とオーナーの任命・交代"],
  ["S25", "監査ログ"],
  ["S26", "再認証ダイアログ"],
  ["S27", "プロフィールカード"],
  ["S28", "全体管理者の引き継ぎ"],
  ["S29", "案件の承認一覧"],
  ["S30", "ロールの編集（第2段階）"],
  ["S31", "ロールの新規作成（第2段階）"],
  ["S32", "共通フォルダの作成・編集"],
  ["S33", "自分専用の整理スペース"],
  ["S34", "初代全体管理者の初回セットアップ"],
  ["S35", "スレッド一覧"],
  ["S36", "取引先の管理"],
  ["S37", "緊急削除の申請一覧"],
];
// 会社のワークスペースは1つ（C-93）。チャンネルの置き場は「部署」か「会社直属」のどちらか。
// dept が COMPANY のチャンネルは会社直属（全部署に属さない）。部署の専用チャンネルは、部署名と同じ名前の公開チャンネル（C-95）。
const COMPANY = "会社直属";
const prototypeData = {
  channels: [
    {
      id: "general",
      name: "全社連絡",
      dept: COMPANY,
      folder: "共通連絡",
      private: false,
      members: ["u1", "u2", "u3", "u4", "u5", "u7", "u8"],
      messages: [
        {
          mid: "m-gen-1",
          by: "u3",
          text: "今週の連絡事項を共有します。",
          at: "10:02",
          mentions: ["u1"],
          // 未読の見本（参加者だけに付く）。u1 は下の返信が未読のため、親メッセージの未読は付けない。
          unreadFor: ["u2", "u4", "u5", "u7", "u8"],
          attachments: [{ id: "a-gen-1", name: "議事録.pdf" }],
          replies: [
            {
              by: "u1",
              text: "確認しました。",
              at: "10:10",
              ts: Date.now() - 90 * 60000,
            },
            {
              mid: "m-gen-1-r2",
              by: "u3",
              text: "ありがとうございます。次回もよろしくお願いします。",
              at: "10:25",
              ts: Date.now() - 30 * 60000,
              unreadFor: ["u1"],
            },
          ],
        },
      ],
    },
    {
      id: "sales",
      name: "営業部",
      dept: "営業部",
      folder: "共通連絡",
      private: false,
      members: ["u1", "u2", "u5"],
      messages: [
        {
          by: "u2",
          text: "今週の打ち合わせ内容を共有します。",
          at: "09:20",
          mentions: ["u1"],
          replies: [
            {
              by: "u2",
              text: "資料は後ほど共有します。",
              at: "09:40",
              ts: Date.now() - 180 * 60000,
            },
          ],
        },
      ],
    },
    {
      id: "design",
      name: "設計部",
      dept: "設計部",
      folder: "共通連絡",
      private: false,
      members: ["u3", "u4", "u8"],
      messages: [
        {
          by: "u4",
          text: "図面の更新を確認してください。",
          at: "11:15",
          replies: [
            {
              by: "u3",
              text: "確認します。",
              at: "11:30",
              ts: Date.now() - 60 * 60000,
              unreadFor: ["u4"],
            },
          ],
        },
      ],
    },
    {
      id: "lunch",
      name: "lunch",
      dept: COMPANY,
      folder: "雑談",
      private: false,
      members: ["u1", "u3", "u5"],
      messages: [
        {
          by: "u1",
          text: "金曜日のランチについて相談です。",
          at: "12:30",
          replies: [],
        },
      ],
    },
    {
      id: "planning",
      name: "企画共有",
      dept: "営業部",
      folder: "案件系",
      private: true,
      members: ["u1", "u2"],
      messages: [
        { by: "u1", text: "企画案を共有します。", at: "10:40", replies: [] },
      ],
    },
    {
      id: "soumu",
      name: "総務部",
      dept: "総務部",
      folder: "共通連絡",
      private: false,
      members: ["u5", "u7"],
      messages: [
        {
          by: "u5",
          text: "総務部の専用チャンネルです。",
          at: "09:00",
          replies: [],
        },
      ],
    },
    // 部署のお知らせ専用チャンネル（C-108）。公開で、投稿できるのは自部署のオーナーと全体管理者だけ。
    // announce は、このプロトタイプ内の表現にすぎない（投稿制限の持たせ方は C-108(1) で未決定）。
    // 初期の参加者は部署の社員の見本で、自動参加と決めたものではない（C-108(3) は未決定）。置き場のフォルダも案。
    // お知らせは題名を設けず、通常のメッセージと同じ規則（本文 1〜4,000文字）とする（C-116(4)、7-2 AC-4）。
    // 確認用の呼び名 P1〜P6 の投稿は announce.js の定数。依頼・緊急削除の申請の見本もそこにある。
    {
      id: "announce-sales",
      name: "営業部のお知らせ",
      dept: "営業部",
      folder: "共通連絡",
      private: false,
      announce: true,
      // u3 は、他部署の社員が参加した場合の見本（参加しても投稿はできない）。
      members: ["u1", "u2", "u5", "u3"],
      messages: [
        {
          mid: "m-ann-p1",
          by: "u5",
          text: "展示会の準備は予定どおり進んでいます。",
          at: "10/12",
          unreadFor: ["u2"],
          replies: [
            {
              by: "u2",
              text: "了解しました。",
              at: "10/12",
              ts: Date.now() - 14 * 86400000,
            },
          ],
        },
        {
          mid: "m-ann-p2",
          by: "u2",
          text: "来週の月曜日は全体会議です。",
          at: "10/20",
          unreadFor: ["u3"],
          replies: [],
        },
        {
          mid: "m-ann-p3",
          by: "u5",
          text: "来月の営業会議の日程は、決まりしだい連絡します。",
          at: "10/22",
          replies: [],
        },
        {
          mid: "m-ann-p4",
          by: "u5",
          text: "展示会の来場者アンケートの結果を共有します。",
          at: "10/23",
          replies: [],
        },
      ],
    },
    {
      id: "announce-design",
      name: "設計部のお知らせ",
      dept: "設計部",
      folder: "共通連絡",
      private: false,
      announce: true,
      members: ["u3", "u4", "u8"],
      messages: [
        {
          mid: "m-ann-h1",
          by: "u6",
          text: "（承認された緊急削除の見本の投稿）",
          at: "10/10",
          deleted: true,
          replies: [],
        },
        {
          mid: "m-ann-h2",
          by: "u6",
          text: "図面のファイル名の付け方を統一します。",
          at: "10/11",
          replies: [],
        },
        {
          mid: "m-ann-h3",
          by: "u6",
          text: "図面の保管先を変更しました。",
          at: "10/12",
          replies: [],
        },
        {
          mid: "m-ann-p6",
          by: "u6",
          text: "旧オーナーが書いた、図面の確認手順についての連絡です。",
          at: "10/16",
          replies: [
            {
              by: "u3",
              text: "確認しました。",
              at: "10/16",
              ts: Date.now() - 12 * 86400000,
            },
          ],
        },
        {
          mid: "m-ann-p5",
          by: "u4",
          text: "今月末までに最新の図面を提出してください。",
          at: "10/18",
          unreadFor: ["u3"],
          replies: [],
        },
      ],
    },
    {
      id: "announce-soumu",
      name: "総務部のお知らせ",
      dept: "総務部",
      folder: "共通連絡",
      private: false,
      announce: true,
      members: ["u5", "u7"],
      messages: [
        {
          by: "u5",
          text: "備品の棚卸しを実施します。",
          at: "10/15",
          replies: [],
        },
      ],
    },
  ],
  dm: {
    "u1:u3": [
      { by: "u3", text: "資料を確認しました。", at: "09:41", replies: [] },
    ],
  },
  notices: [
    {
      id: "n1",
      recipient: "u1",
      type: "メンション",
      text: "# 全社連絡 であなたに言及がありました",
      target: "S05",
      channel: "general",
    },
    {
      id: "n2",
      recipient: "u1",
      type: "新着",
      text: "testuser_003 からダイレクトメッセージ",
      target: "S06",
      user: "u3",
    },
    {
      id: "n3",
      recipient: "u1",
      type: "案件",
      text: "案件「新店舗の什器配置」に更新があります",
      target: "S17",
      caseId: "C-104",
    },
  ],
  channelRequests: [
    {
      id: "CH-01",
      name: "project-x",
      dept: "営業部",
      by: "u1",
      private: true,
      status: "pending",
      reason: "",
    },
    // オーナー自身の申請は、全体管理者が承認する（C-107 (a)）。
    {
      id: "CH-02",
      name: "営業共有",
      dept: "営業部",
      by: "u2",
      private: false,
      status: "pending",
      reason: "",
    },
    // 会社直属のチャンネルの申請は、全体管理者が承認する（C-105）。
    {
      id: "CH-03",
      name: "社内イベント",
      dept: COMPANY,
      by: "u1",
      private: false,
      status: "pending",
      reason: "",
    },
    {
      id: "CH-04",
      name: "図面レビュー",
      dept: "設計部",
      by: "u3",
      private: false,
      status: "pending",
      reason: "",
    },
  ],
  // 個人整理スペースの登録（2-8）。登録は元へのリンクだけを持ち、内容は複製しない（C-67）。
  // kind: channel / file / message / reply / case / dm。refId は対象のID（dm は相手のID）。
  // 種類＋refId が同じものは1件だけ（C-72）。folderId が null なら「フォルダなし」（C-69）。
  // sv7 は閲覧権限のない案件、sv8 は元が削除されたメッセージの見本（C-70）。
  saved: {
    u1: [
      { id: "sv1", kind: "case", refId: "C-104", folderId: "f1" },
      { id: "sv2", kind: "dm", refId: "u3", folderId: "f1" },
      { id: "sv3", kind: "message", refId: "m-gen-1", folderId: "f1" },
      { id: "sv4", kind: "reply", refId: "m-gen-1-r2", folderId: "f1" },
      { id: "sv5", kind: "file", refId: "a-gen-1", folderId: "f2" },
      { id: "sv6", kind: "channel", refId: "sales", folderId: null },
      { id: "sv7", kind: "case", refId: "C-103", folderId: null },
      { id: "sv8", kind: "message", refId: "m-removed-001", folderId: null },
    ],
  },
  // 自分用フォルダは入れ子にできず、本人だけに見える（C-69）。
  myFolders: {
    u1: [
      { id: "f1", name: "確認待ち" },
      { id: "f2", name: "資料" },
    ],
  },
  // 部署の一覧。会社直属（会社のワークスペース）は部署ではないので入れない（C-93）。
  // 部署のオーナーは社員のデータ（role と department、全体管理者は ownerOf）から求める。
  departments: ["営業部", "設計部", "総務部"],
  // 拠点ラベル（C-119。管理の置き場所は未決定のため S-24 の中に置く【案】）。部署の階層・権限・オーナーには使わない。
  // 部署ごとに1つまで（任意）。data-model.md の department_locations【案】に相当する対応表で、総務部は拠点を持たない見本。
  locations: [
    { id: "loc-osaka", name: "大阪" },
    { id: "loc-tokyo", name: "東京" },
  ],
  departmentLocations: { 営業部: "loc-osaka", 設計部: "loc-tokyo" },
  // 全体管理者が確認する退職処理の申請（0-1 AC-20）。申請しただけでは所属・状態は変わらない。
  retireRequests: [
    {
      id: "RT-01",
      target: "u8",
      by: "u4",
      at: "10/20 09:30",
      status: "pending",
    },
  ],
  // 本人が提出した本名変更届（C-75）。承認するまで本名は変わらない。本名の値は持たない。
  nameChanges: [{ id: "NC-01", user: "u3", status: "pending" }],
  // 登録済みの部署異動（C-30）。異動日までは現在の所属を維持する。
  transfers: [],
  // 共通フォルダは部署ごと（C-97）。会社直属のチャンネルのフォルダの管理者は【案：全体管理者】で未確定。
  folders: {
    営業部: ["共通連絡", "案件系"],
    設計部: ["共通連絡"],
    総務部: ["共通連絡"],
    [COMPANY]: ["共通連絡", "雑談"],
  },
};
const ui = {
  channelId: "general",
  dmUserId: null,
  thread: null,
  profile: null,
  search: "",
  accountFilter: "すべて",
  accountState: "有効",
  inviteChannelId: null,
  staffFilter: "すべて",
  registerMode: "individual",
  // サイドバーの閉じているセクション（案）。保存は extras.js の sidebarStorage。
  sideCollapsed: new Set(),
  sideLoadedFor: null,
  manageDept: null,
  dirFilter: "すべて",
  dirLocFilter: "すべて",
  staffLocFilter: "すべて",
  channelFilter: "",
  screenBeforeAuth: "S01",
  drawerReturn: null,
  threadReturn: null,
};
// 部署のデータから作る。会社直属は部署ではなく、案件の担当部署にもしない（C-98）。
// 無効にした部署（C-103）は、重複の判定（allDepartmentNames）には残し、選択肢（departmentNames）からは外す。
prototypeData.disabledDepartments = [];
const allDepartmentNames = () => [...prototypeData.departments];
const isDeptDisabled = (name) => prototypeData.disabledDepartments.includes(name);
const departmentNames = () =>
  prototypeData.departments.filter((name) => !isDeptDisabled(name));
const deptDisplay = (name) => (isDeptDisabled(name) ? `${name}（無効）` : name);
// 拠点ラベル（C-119）。拠点を持たない部署（と会社直属）はラベルなし。表示と絞り込みだけに使い、権限の判定には使わない。
const locationOf = (dept) =>
  prototypeData.locations.find((loc) => loc.id === prototypeData.departmentLocations[dept]) || null;
// 戻り値は e() で無害化済みの小さな印（HTML）。なしは空文字。
const locationBadge = (dept) =>
  locationOf(dept) ? ` <span class="loc-badge" title="拠点ラベル（案）">${e(locationOf(dept).name)}</span>` : "";
// option は文字だけのため、印の代わりに（拠点名）を添える。
const deptOptionLabel = (name) => (locationOf(name) ? `${deptDisplay(name)}（${locationOf(name).name}）` : deptDisplay(name));
const locationFilterOptions = () => [["すべて", "すべて"], ...prototypeData.locations.map((loc) => [loc.id, loc.name])];
const SCREEN_IDS = new Set(screenCatalog.map(([id]) => id));
const adminOnly = () => currentUser().role === "admin";
// 管理できる部署（S-13）。オーナーは自部署、全体管理者は任命された部署だけ（C-99・C-107）。
const managedDepts = () =>
  currentUser().role === "owner"
    ? [currentUser().department]
    : adminOnly()
      ? (currentUser().ownerOf || []).filter((name) => !isDeptDisabled(name))
      : [];
const ownerHere = () => managedDepts().length > 0;
// 共通フォルダ（S-32）の対象。全体管理者は全部署と会社直属、オーナーは自部署（C-97・C-110）。
// 無効にした部署のフォルダを対象から外すかは未決定（Q-16）のため、外さず「（無効）」と添える。
const folderTargets = () =>
  adminOnly() ? [...allDepartmentNames(), COMPANY] : [...managedDepts()];
const pickTarget = (list, current) =>
  list.includes(current) ? current : list[0] || null;
const manageDeptNow = () => pickTarget(managedDepts(), ui.manageDept);
const folderTargetNow = () => pickTarget(folderTargets(), ui.manageDept);
const deptLabel = (name) => (name === COMPANY ? "会社直属" : name);
// 公開チャンネルは参加しなくても読める。非公開は参加者だけ（C-94）。投稿・リアクションは参加者のみ。
const canReadChannel = (channel) =>
  !!channel && (!channel.private || isChannelMember(channel));
// お知らせ専用チャンネル（C-108）の投稿は、自部署のオーナーと全体管理者だけ（C-96・7-2 AC-1）。
// ほかの人は、参加しても投稿できない。リアクションと返信は、参加者なら通常どおり使える。
const canPostAnnounce = (channel) =>
  adminOnly() ||
  (currentUser().role === "owner" && currentUser().department === channel.dept);
// 投稿できるのは参加者だけ（C-94）。お知らせ専用チャンネルは、そのうえで canPostAnnounce も満たすこと。
const canPostChannel = (channel) =>
  isChannelMember(channel) &&
  !channel.readOnly &&
  (!channel.announce || canPostAnnounce(channel));
// 未読は参加者だけに付く（C-94）。親メッセージか返信のどちらかに、自分宛ての未読があるか。
const channelUnread = (channel) =>
  isChannelMember(channel) &&
  channel.messages.some(
    (message) =>
      message.unreadFor?.includes(state.userId) ||
      (message.replies || []).some((reply) =>
        reply.unreadFor?.includes(state.userId),
      ),
  );
// チャンネルを開くと、親メッセージの未読だけが既読になる。返信の未読は、スレッドを開いたときに消す（C-91）。
function markChannelRead(channel) {
  let changed = false;
  channel.messages.forEach((message) => {
    if (message.unreadFor?.includes(state.userId)) {
      message.unreadFor = message.unreadFor.filter((id) => id !== state.userId);
      changed = true;
    }
  });
  return changed;
}
// サイドバーのチャンネルの分け方（C-106【案】）。会社 → 自部署 → 他部署の順。
const channelSection = (channel) =>
  channel.dept === COMPANY
    ? "company"
    : channel.dept === currentUser().department
      ? "own"
      : "other";
const defaultChannelId = () =>
  (
    prototypeData.channels.find(
      (channel) => channelSection(channel) === "company" && isChannelMember(channel),
    ) ||
    prototypeData.channels.find(
      (channel) => isChannelMember(channel) && canReadChannel(channel),
    )
  )?.id || "";
// チャンネル作成の承認者（C-105・C-107）。部署のチャンネルは自部署のオーナー（オーナー自身の申請は全体管理者）、
// 会社直属のチャンネルは全体管理者（自己承認可）。
const channelRequestOwnerIsApplicant = (request) =>
  employees.some(
    (person) =>
      person.id === request.by &&
      person.active &&
      person.role === "owner" &&
      person.department === request.dept,
  );
const canReviewChannelRequest = (request) => {
  if (!request || request.status !== "pending") return false;
  const me = currentUser();
  if (request.by === me.id && me.role !== "admin") return false;
  if (request.dept === COMPANY) return me.role === "admin";
  if (me.role === "owner") return me.department === request.dept;
  if (me.role === "admin")
    return (
      !!me.ownerOf?.includes(request.dept) ||
      channelRequestOwnerIsApplicant(request)
    );
  return false;
};
// S-11 に出す申請（履歴を含む）。オーナーは自部署の分、全体管理者は会社直属・任命された部署・オーナー自身の分と自分の分。
const channelRequestsForReview = () =>
  prototypeData.channelRequests.filter((request) => {
    const me = currentUser();
    if (me.role === "owner") return request.dept === me.department;
    if (me.role !== "admin") return false;
    return (
      request.dept === COMPANY ||
      !!me.ownerOf?.includes(request.dept) ||
      channelRequestOwnerIsApplicant(request) ||
      request.by === me.id
    );
  });
const ownNotices = () =>
  prototypeData.notices.filter((note) => note.recipient === state.userId);
const activeChannel = () =>
  prototypeData.channels.find((channel) => channel.id === ui.channelId);
const isChannelMember = (channel) => channel?.members.includes(state.userId);
const dmKey = (a, b) => [a, b].sort().join(":");
const protoButton = (label, action, attrs = "", primary = false) =>
  `<button type="button" class="button ${primary ? "primary" : ""}" data-ui="${action}" ${attrs}>${e(label)}</button>`;
const screenFrame = (id, title, intro, content, actions = "") =>
  `<div data-screen-id="${e(id.replace(/^S(\d{2})$/, "S-$1"))}"><div class="page-heading"><div><p class="eyebrow">${e(id.replace(/^S(\d{2})$/, "S-$1"))} · 画面構成</p><h1>${e(title)}</h1><p class="subtle">${e(intro)}</p></div><div class="heading-actions">${actions}</div></div>${content}</div>`;
const shellCard = (title, body, action = "") =>
  `<section class="panel shell-card"><div class="panel-header"><h2>${e(title)}</h2>${action}</div><div class="panel-body">${body}</div></section>`;
// limits は [最小文字数, 最大文字数]。入力欄の長さの上限を表示する（C-90）。
const field = (
  label,
  id,
  type = "text",
  value = "",
  required = false,
  limits = null,
  normalize = false,
) =>
  `<div class="form-field"><label for="${id}">${e(label)}</label><input id="${id}" name="${id}" type="${type}" value="${e(value)}" ${required ? "required" : ""} ${limits ? `data-min="${limits[0]}" data-max="${limits[1]}" data-name="${e(label.replace(/（.*）/, ""))}"` : ""} ${normalize ? "data-normalize" : ""}></div>`;
const selectField = (label, id, options, selected = "") =>
  `<div class="form-field"><label for="${id}">${e(label)}</label><select id="${id}" name="${id}">${options.map(([value, text]) => `<option value="${e(value)}" ${value === selected ? "selected" : ""}>${e(text)}</option>`).join("")}</select></div>`;
const personButton = (id) =>
  `<button type="button" class="person-link" data-ui="profile" data-user="${e(id)}">${e(nameOf(id))}</button>`;
const hint = (text) => `<p class="prototype-hint">${e(text)}</p>`;
const unavailable = (text) =>
  `<div class="muted-box"><strong>操作見本</strong><br>${e(text)}</div>`;

function caseSubnav() {
  return `<nav class="case-subnav" aria-label="案件一覧の切替">${[
    ["active", "進行中"],
    ["archived", "終了した案件"],
    ["my", "自分の申請"],
  ]
    .map(
      ([tab, label]) =>
        `<button type="button" class="${state.caseTab === tab ? "active" : ""}" data-ui="case-tab" data-tab="${tab}">${label}</button>`,
    )
    .join("")}</nav>`;
}
// 追加と編集は同じ入力（題名・任意の担当者）。担当者は、その案件の参加者だけから選ぶ（5-4 AC-6）。
function todoEditForm(item, todo) {
  const draftless = todo || { id: "", title: "", assignee: null };
  const keptName =
    todo?.done &&
    todo.assignee &&
    !item.members.includes(todo.assignee)
      ? [[todo.assignee, `${nameOf(todo.assignee)}（完了時の担当）`]]
      : [];
  const options = [["", "担当なし"]]
    .concat(
      item.members
        .filter((id) => employees.find((person) => person.id === id)?.active)
        .map((id) => [id, nameOf(id)]),
      keptName,
    )
    .map(
      ([value, text]) =>
        `<option value="${e(value)}" ${value === (draftless.assignee || "") ? "selected" : ""}>${e(text)}</option>`,
    )
    .join("");
  return `<form id="todo-form" class="todo-form" data-todo="${e(draftless.id)}" aria-label="${todo ? "TODOの編集" : "TODOの追加"}"><div class="form-field"><label for="todo-title">題名</label><input id="todo-title" name="title" value="${e(draftless.title)}" autocomplete="off" placeholder="次に行うこと" data-min="1" data-max="100" data-name="TODOの題名" data-normalize></div><div class="form-field"><label for="todo-assignee">担当者（任意）</label><select id="todo-assignee" name="assignee">${options}</select></div><div class="todo-form-actions"><button type="submit" class="button small primary">保存</button><button type="button" class="button small" data-action="todo-cancel" data-todo="${e(draftless.id)}">キャンセル</button></div></form>`;
}
function todoContent(item, readOnly) {
  const edit =
    !readOnly && state.todoEdit?.caseId === item.id ? state.todoEdit : null;
  const rows = item.todos.length
    ? item.todos
        .map((todo) => {
          if (edit && edit.todoId === todo.id)
            return `<div class="todo-item editing">${todoEditForm(item, todo)}</div>`;
          return `<div class="todo-item ${todo.done ? "done" : ""}"><input type="checkbox" data-todo="${e(todo.id)}" aria-label="${e(todo.title)}を${todo.done ? "未完了に戻す" : "完了にする"}" ${todo.done ? "checked" : ""} ${readOnly ? "disabled" : ""}><span class="todo-title">${e(todo.title)}</span><span class="todo-owner">担当: ${todo.assignee ? e(nameOf(todo.assignee)) + (todo.done && !item.members.includes(todo.assignee) ? "（完了時の担当）" : "") : "なし"}${!todo.assignee && todo.formerAssignee ? `（以前の担当: ${e(todo.formerAssignee)}）` : ""}</span>${readOnly ? "" : `<span class="inline-actions"><button type="button" class="button small" data-action="todo-edit" data-todo="${e(todo.id)}" aria-label="${e(todo.title)}を編集">編集</button><button type="button" class="button small" data-action="todo-delete" data-todo="${e(todo.id)}" aria-label="${e(todo.title)}を削除">削除</button></span>`}</div>`;
        })
        .join("")
    : edit && edit.todoId === ""
      ? ""
      : '<p class="subtle">項目なし</p>';
  const tail = readOnly
    ? ""
    : edit && edit.todoId === ""
      ? `<div class="todo-item editing">${todoEditForm(item, null)}</div>`
      : '<div class="todo-add"><button type="button" class="button small" data-action="todo-add">+ 項目を追加</button></div>';
  return rows + tail;
}
// サイドバー（パソコンの左）とドロワー（スマートフォン）の両方を描き直す。開閉の操作と未読の変化では、メインの画面は描き直さない。
function renderSidebars() {
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  document.querySelector("#sidebar-content").innerHTML = sidebarContent("side");
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  document.querySelector("#drawer-content").innerHTML =
    sidebarContent("drawer");
}
function renderShell() {
  const auth = ["S02", "S03", "S34"].includes(state.page);
  document.body.classList.toggle("auth-view", auth);
  const viewer = document.querySelector("#viewer");
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  viewer.innerHTML = employees
    .filter((person) => person.active)
    .map(
      (person) =>
        `<option value="${person.id}" ${person.id === state.userId ? "selected" : ""}>${e(person.name)}（${person.role === "admin" ? "全体管理者" : person.role === "owner" ? "オーナー" : deptOf(person)}）</option>`,
    )
    .join("");
  document.querySelector("#avatar-menu-button").textContent =
    currentUser().name.slice(-2);
  const jump = document.querySelector("#screen-catalog");
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  jump.innerHTML = screenCatalog
    .map(
      ([id, label]) =>
        `<option value="S-${id.slice(1)}" ${state.page === id ? "selected" : ""}>S-${id.slice(1)} ${e(label)}</option>`,
    )
    .join("");
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  document.querySelector("#state-controls").innerHTML = [
    ["data", "データあり"],
    ["loading", "読み込み中"],
    ["empty", "データなし"],
    ["error", "エラー"],
  ]
    .map(
      ([value, label]) =>
        `<button type="button" class="${state.viewState === value ? "active" : ""}" data-action="state" data-value="${value}" aria-pressed="${state.viewState === value}">${label}</button>`,
    )
    .join("");
  renderSidebars();
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  document.querySelector("#mobile-nav").innerHTML = [
    ["S01", "ホーム"],
    ["S06", "DM"],
    ["S16", "案件"],
    ["S14", "通知"],
    ["S19", "自分"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" data-ui="go" data-page="${id}" class="${state.page === id ? "active" : ""}" ${state.page === id ? 'aria-current="page"' : ""}>${label}</button>`,
    )
    .join("");
  document.querySelector("#thread-panel").hidden = !ui.thread;
  if (ui.thread) renderThread();
}
// サイドバーの開閉（案。要件 S-01 への反映は、確かめた後）。見出しは button と aria-expanded にし、閉じた本体は hidden にする。
// 閉じていても、未読のあるチャンネルだけは見出しの下に残す（未読は参加者だけ。件数は出さない）。
// 本体の id は描画先ごとに分ける（prefix は side か drawer）。パソコンのサイドバーとドロワーの両方に描くため。
function sideToggleSection(prefix, key, label, bodyHtml, unreadChannels, kind) {
  const closed = sideCollapsed().has(key);
  const bodyId = `${prefix}-body-${key}`;
  const head = `<button type="button" class="side-toggle ${kind}" data-ui="side-toggle" data-section="${key}" aria-expanded="${!closed}" aria-controls="${bodyId}"><span aria-hidden="true">${closed ? "▶" : "▼"}</span> ${label}</button>`;
  const unread =
    closed && unreadChannels.length
      ? `<div class="side-unread">${unreadChannels.map(sidebarChannelButton).join("")}</div>`
      : "";
  return `${head}${unread}<div class="side-body" id="${bodyId}" ${closed ? "hidden" : ""}>${bodyHtml}</div>`;
}
// チャンネル欄は「会社」「自部署」「他部署」に分ける（C-106【案】）。公開チャンネルは参加していなくても読めるため、
// 未参加の公開チャンネルも「未参加」と示して並べる。非公開は参加者だけに出す。
function sidebarChannelButton(channel) {
  const joined = isChannelMember(channel);
  return `<button type="button" class="side-link" data-ui="channel" data-id="${e(channel.id)}"># ${e(channel.name)}${channel.private ? ' <span class="side-tag">非公開</span>' : ""}${joined ? "" : ' <span class="side-tag">未参加</span>'}${channelUnread(channel) ? ' <span class="unread-mark">● 未読</span>' : ""}</button>`;
}
function sidebarFolderGroups(dept, channels) {
  const folders = prototypeData.folders[dept] || [];
  const names = [
    ...folders,
    ...channels.filter((c) => !folders.includes(c.folder)).map(() => "フォルダなし"),
  ];
  return [...new Set(names)]
    .map((folder) => {
      const inFolder = channels.filter((c) =>
        folder === "フォルダなし" ? !folders.includes(c.folder) : c.folder === folder,
      );
      return inFolder.length
        ? `<div class="side-group"><strong>⌄ ${e(folder)}</strong>${inFolder.map(sidebarChannelButton).join("")}</div>`
        : "";
    })
    .join("");
}
function sidebarChannelSections(prefix) {
  const visible = prototypeData.channels.filter(canReadChannel);
  const company = visible.filter((c) => channelSection(c) === "company");
  const own = visible.filter((c) => channelSection(c) === "own");
  const other = visible.filter((c) => channelSection(c) === "other");
  const otherDepts = [...new Set(other.map((c) => c.dept))];
  const empty = '<span class="side-empty">チャンネルはありません</span>';
  const sub = (key, label, channels, bodyHtml) =>
    `<div class="side-sub">${sideToggleSection(prefix, key, label, bodyHtml || empty, channels.filter(channelUnread), "side-subhead")}</div>`;
  return (
    sub("company", "会社", company, sidebarFolderGroups(COMPANY, company)) +
    sub(
      "own",
      `自部署（${e(currentUser().department)}）`,
      own,
      sidebarFolderGroups(currentUser().department, own),
    ) +
    sub(
      "other",
      "他部署",
      other,
      otherDepts
        .map(
          (dept) =>
            `<div class="side-group"><strong>⌄ ${e(deptDisplay(dept))}${locationBadge(dept)}</strong>${other.filter((c) => c.dept === dept).map(sidebarChannelButton).join("")}</div>`,
        )
        .join(""),
    )
  );
}
function sidebarContent(prefix) {
  const manage = folderTargets().length
    ? `<button type="button" class="side-link" data-ui="go" data-page="S32">フォルダを管理</button>`
    : "";
  // 管理メニュー（C-116(2)）。サイドバー最下部の「管理」項目に、ロールに応じた項目だけを出す。一般メンバーには出さない。
  // 全体管理者の項目のうち S-24・S-08 を、まとめて「全体管理」と呼ぶ（C-113。総称であり、見出しは作らない）。
  // 用途ごとの4つのまとまりに分け、まとまりごとに開閉できる（C-118で決定。保存は社員ごと）。S-24とS-08を1項目にまとめるかは未決定で、別項目の案。
  // ロールに応じて、自分に関係する項目だけを出し、項目が0個のまとまりは見出しごと出さない。
  const isOwnerOrAdmin = currentUser().role === "owner" || adminOnly();
  const manageGroups = [
    [
      "manage-approve",
      "承認",
      [
        ...(isOwnerOrAdmin
          ? [
              ["S11", "チャンネル作成の承認"],
              ["S29", "案件作成の承認"],
            ]
          : []),
        ...(adminOnly() ? [["S37", "緊急削除の申請"]] : []),
      ],
    ],
    [
      "manage-account",
      "アカウント",
      adminOnly()
        ? [
            ["S22", "アカウント管理"],
            ["S23", "アカウント登録"],
            ["S28", "全体管理者の引き継ぎ"],
          ]
        : [],
    ],
    [
      "manage-dept",
      "部署",
      [
        // S-24 と S-08 をまとめて「全体管理」と呼ぶ（C-113。総称であり、画面名・入口は変えない）。
        ...(adminOnly()
          ? [
              ["S24", "全体管理（部署の一覧・オーナーの任命・交代）"],
              ["S08", "部署を作成"],
            ]
          : []),
        ...(ownerHere() ? [["S13", "部署管理（オーナー）"]] : []),
      ],
    ],
    [
      "manage-master",
      "マスタ・記録",
      adminOnly()
        ? [
            ["S36", "取引先の管理"],
            ["S25", "監査ログ"],
          ]
        : [],
    ],
  ].filter(([, , items]) => items.length);
  const manageBlock = manageGroups.length
    ? `<nav class="side-section side-admin" aria-label="管理"><strong>管理</strong><p class="side-empty">まとまりと開閉は決定済み（C-118）</p>${manageGroups
        .map(([key, label, items]) =>
          sideToggleSection(
            prefix,
            key,
            label,
            items
              .map(
                ([id, text]) =>
                  `<button type="button" class="side-link" data-ui="go" data-page="${id}">${text}</button>`,
              )
              .join(""),
            [],
            "side-top",
          ),
        )
        .join("")}</nav>`
    : "";
  // 案件専用チャンネルは「案件」の見出しの下にまとめる。参加者だけに出し、通常のチャンネル一覧には出さない（C-83）。
  const caseChannels = state.cases
    .filter((item) => isMember(item))
    .map(
      (item) =>
        `<button type="button" class="side-link" data-ui="case-open" data-id="${e(item.id)}">▣ ${e(item.no)} ${e(item.title)}${item.status === "archived" ? "（終了）" : ""}</button>`,
    )
    .join("");
  const unreadThreads = unreadThreadTotal();
  // DM・案件・整理スペースには未読のデータがない。閉じたときに残す未読は、チャンネルだけ（未決定）。
  const dmBody = `<button type="button" class="side-link side-add" data-ui="dm-new">＋ 新しいDM</button>${employees
    .filter((person) => person.active && person.id !== state.userId)
    .slice(0, 2)
    .map(
      (person) =>
        `<button type="button" class="side-link" data-ui="dm" data-user="${person.id}">@ ${e(person.name)}</button>`,
    )
    .join("")}`;
  const caseBody = `<button type="button" class="side-link" data-ui="go" data-page="S16">▣ 案件一覧</button>${caseChannels || '<span class="side-empty">参加中の案件はありません</span>'}`;
  const orgBody = `<button type="button" class="side-link" data-ui="go" data-page="S33">◇ 自分専用</button>`;
  const section = (key, label, body) =>
    `<div class="side-section">${sideToggleSection(prefix, key, label, body, [], "side-top")}</div>`;
  const channelBlock = `<div class="side-section"><strong>チャンネル</strong>${sidebarChannelSections(prefix)}<button type="button" class="side-link side-add" data-ui="go" data-page="S09">＋ 探す / 参加 / 申請</button>${manage}</div>`;
  // 保存できないときは黙らずに知らせる。sideCollapsed() の読み込みの後に判定するため、最後に組み立てる。
  const saveNote = sidebarStatus.available
    ? ""
    : '<p class="side-empty" role="status">この端末では開閉の状態を覚えられません</p>';
  return `<div class="side-content">${channelBlock}${section("dm", "ダイレクトメッセージ", dmBody)}<div class="side-section"><strong>スレッド</strong><button type="button" class="side-link" data-ui="go" data-page="S35">スレッド一覧${unreadThreads ? `<span class="unread-mark">● 未読 ${unreadThreads}件</span>` : ""}</button></div>${section("case", "案件", caseBody)}${section("org", "整理スペース", orgBody)}<div class="side-section"><strong>共通</strong><button type="button" class="side-link" data-ui="go" data-page="S20">社員一覧</button></div>${manageBlock}${saveNote}</div>`;
}
function showNoPermission() {
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  screen.innerHTML = shellCard(
    "この画面を使う権限がありません",
    `<p class="subtle">表示する社員を確認してください。</p>${protoButton("ホームへ戻る", "go", 'data-page="S01"')}`,
  );
}
function renderExtraPage(page) {
  if (!SCREEN_IDS.has(page)) {
    navigate("S01");
    return;
  }
  if (
    ["S08", "S22", "S23", "S24", "S25", "S28", "S36", "S37"].includes(page) &&
    !adminOnly()
  )
    return showNoPermission();
  if (page === "S11" && !(currentUser().role === "owner" || adminOnly()))
    return showNoPermission();
  if (page === "S13" && !ownerHere()) return showNoPermission();
  if (page === "S32" && !folderTargets().length) return showNoPermission();
  if (
    ["S30", "S31"].includes(page) &&
    !(adminOnly() || currentUser().role === "owner")
  )
    return showNoPermission();
  if (page === "S26") return renderReauthDemo();
  if (page === "S27") return renderProfileDemo();
  if (page === "S33" && state.viewState === "empty") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
    screen.innerHTML = personalSpaceScreen(true);
    return;
  }
  if (state.viewState !== "data") {
    // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
    screen.innerHTML = screenFrame(
      page,
      screenCatalog.find(([id]) => id === page)?.[1] || "",
      "",
      statePanel(),
    );
    return;
  }
  const renderers = {
    S01: homeScreen,
    S02: loginScreen,
    S03: firstPasswordScreen,
    S04: changePasswordScreen,
    S05: channelScreen,
    S06: dmScreen,
    S08: createDepartmentScreen,
    S09: channelDirectoryScreen,
    S10: channelRequestScreen,
    S11: channelApprovalsScreen,
    S12: invitationScreen,
    S13: departmentManageScreen,
    S14: notificationsScreen,
    S15: searchScreen,
    S18: caseRequestScreen,
    S19: profileScreen,
    S20: employeeScreen,
    S22: accountsScreen,
    S23: accountRegisterScreen,
    S24: departmentAdminScreen,
    S25: auditScreen,
    S28: adminHandoverScreen,
    S30: rolesScreen,
    S31: newRoleScreen,
    S32: sharedFolderScreen,
    S33: personalSpaceScreen,
    S34: setupScreen,
    S35: threadsScreen,
    S36: clientsScreen,
    S37: emergencyListScreen,
  };
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  screen.innerHTML = (renderers[page] || homeScreen)();
}
// 案内だけを出す。未読の要約や最近のチャンネルは出さない（C-77）。
function homeScreen() {
  return `<div data-screen-id="S-01" class="welcome"><p class="eyebrow">S-01 · 共通レイアウト</p><h1>ようこそ、${e(currentUser().name)}さん</h1><p>サイドバー（スマートフォンでは左上のメニュー）からチャンネルやダイレクトメッセージを選んでください。</p></div>`;
}
function loginScreen() {
  return `<div class="auth-panel">${screenFrame(
    "S02",
    "ログイン",
    "架空の入力欄です。入力したパスワードは保存しません。",
    `<form data-proto-form="login">${field("ユーザーID", "login-id", "text", "testuser_001", true)}${field("パスワード", "login-password", "password", "", true)}<button type="button" class="text-button" data-ui="toggle-password" data-target="login-password">パスワードを表示</button><div class="form-actions"><button type="submit" class="button primary">ログインする</button></div></form>`,
  )}</div>`;
}
function firstPasswordScreen() {
  return `<div class="auth-panel">${screenFrame(
    "S03",
    "初回パスワード変更",
    "初期パスワードの発行直後は、変更するまでホームに進みません。",
    `<form data-proto-form="first-password">${field("現在の初期パスワード", "first-current", "password", "", true)}${field("新しいパスワード", "first-new", "password", "", true)}${field("新しいパスワード（確認）", "first-confirm", "password", "", true)}${hint("入力値は保存しません。")}<div class="form-actions"><button type="submit" class="button primary">変更して続ける</button></div></form>`,
  )}</div>`;
}
function changePasswordScreen() {
  return screenFrame(
    "S04",
    "パスワード変更",
    "現在のパスワードを確認して変更する画面です。",
    shellCard(
      "パスワードを変更する",
      `<form data-proto-form="change-password">${field("現在のパスワード", "password-current", "password", "", true)}${field("新しいパスワード", "password-new", "password", "", true)}${field("新しいパスワード（確認）", "password-confirm", "password", "", true)}<button type="submit" class="button primary">変更する</button></form>`,
    ),
  );
}
function messageRows(messages, source) {
  if (!messages.length)
    return '<div class="empty-screen"><h2>まだメッセージがありません</h2><p>最初の投稿をしましょう。</p></div>';
  const readonlyCase =
    source === "case" && getCase(state.selectedId)?.status === "archived";
  // 未参加の公開チャンネルでは本文は読めるが、リアクションは参加者だけが使える（C-94）。
  const notJoined = source === "channel" && !isChannelMember(activeChannel());
  const announce = source === "channel" && !!activeChannel()?.announce;
  const readOnlyChannel = source === "channel" && !!activeChannel()?.readOnly;
  return messages
    .map(
      (message, index) =>
        message.deleted
          ? announceDeletedRow(message, index)
          : `<article class="chat-message" data-mid="${e(midOf(message))}"><div class="message-avatar">${e(nameOf(message.by).slice(-2))}</div><div class="chat-body"><div class="chat-meta">${personButton(message.by)}<time>${e(message.at)}</time>${message.editedAt ? '<span class="subtle">（編集済み）</span>' : ""}</div><p>${e(message.text)}</p>${announce ? announceMarks(activeChannel(), message) : ""}${attachmentList(message, source)}<div class="chat-tools">${readonlyCase ? "" : readOnlyChannel ? `<button type="button" disabled aria-label="リアクションは読み取り専用のため使えません（いいね ${message.likes || 0}人）">👍 ${message.likes || 0} 読み取り専用</button>` : notJoined ? `<button type="button" disabled aria-label="リアクションは参加すると使えます（いいね ${message.likes || 0}人）">👍 ${message.likes || 0} 参加すると使えます</button>` : `<button type="button" data-ui="reaction" data-source="${source}" data-index="${index}" aria-label="いいね ${message.likes || 0}人">👍 ${message.likes || 0}</button>`}<button type="button" data-ui="thread-open" data-source="${source}" data-index="${index}">返信 ${message.replies?.length || 0}件</button><button type="button" data-ui="org-add" data-kind="message" data-ref="${e(midOf(message))}" aria-label="${e(nameOf(message.by))}の${e(message.at)}のメッセージを整理スペースに登録">整理スペースに登録</button>${announce ? announceMenu(activeChannel(), message) : ""}</div></div></article>`,
    )
    .join("");
}
function composer(kind) {
  const draft = draftFor(
    kind === "channel" ? `channel:${ui.channelId}` : `dm:${ui.dmUserId}`,
  );
  return `<form class="chat-composer" data-proto-form="chat" data-kind="${kind}"><label for="chat-text">メッセージを入力</label><textarea id="chat-text" name="text" required placeholder="メッセージを入力" data-min="1" data-max="4000" data-name="メッセージ" data-draft-key="${e(draft.key)}">${e(draft.text)}</textarea>${draftNote(draft)}<div class="composer-toolbar"><span class="inline-actions"><button type="button" disabled title="装飾は未再現">B</button><button type="button" disabled title="装飾は未再現"><i>i</i></button><button type="button" disabled title="添付は未再現">添付</button><button type="button" disabled title="メンションは未再現">@</button><button type="button" disabled title="絵文字は未再現">😀</button></span><button type="submit" class="button primary">送信</button></div></form>`;
}
function channelScreen() {
  let channel = activeChannel();
  if (!canReadChannel(channel)) {
    channel = prototypeData.channels.find(
      (item) => item.id === defaultChannelId(),
    );
    if (channel) ui.channelId = channel.id;
  }
  if (!canReadChannel(channel))
    return screenFrame(
      "S05",
      "チャンネル",
      "",
      shellCard("見つかりません", "<p>このチャンネルは表示できません。</p>"),
    );
  const joined = isChannelMember(channel);
  // 親メッセージの未読は、開いた時点で既読にする。サイドバーは先に描画済みのため、変わったときだけ描き直す。
  if (markChannelRead(channel)) renderSidebars();
  const participants = channel.members
    .map(
      (id) =>
        `<div class="person">${personButton(id)}${id !== state.userId ? protoButton("DMを送る", "dm", `data-user="${id}"`) : ""}</div>`,
    )
    .join("");
  // 未参加の公開チャンネルは、投稿欄の代わりに参加の案内を出す（C-94）。
  const joinNotice = `<div class="join-notice" role="status"><p><strong>参加すると使えます</strong></p><p class="subtle">このチャンネルは公開のため、参加しなくても内容を読めます。投稿とリアクションは参加者だけが使えます。</p>${protoButton("参加する", "join-channel", `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}に参加する"`, true)}</div>`;
  // 参加していても投稿できない場合（お知らせ専用チャンネルの一般社員・他部署の社員）は、入力欄の代わりに理由を出す。
  const noPostNotice = `<div class="join-notice" role="status"><p><strong>投稿できません</strong></p><p class="subtle">このチャンネルに投稿できるのは、${e(channel.dept)}のオーナーと全体管理者だけです。リアクションと返信は、参加していれば使えます。</p></div>`;
  const readOnlyNotice = `<div class="join-notice" role="status"><p><strong>読み取り専用です</strong></p><p class="subtle">この部署は無効化されたため、読み取り専用です。</p></div>`;
  return screenFrame(
    "S05",
    `# ${channel.name}`,
    `${deptLabel(channel.dept)} ・ ${channel.announce ? "お知らせ専用 ・ " : ""}${channel.private ? "非公開" : "公開"}チャンネル${joined ? "" : " ・ 参加せずに読んでいます"}`,
    `<details class="mobile-participants"><summary>参加者 ${channel.members.length}人</summary>${participants || "<p class=\"subtle\">参加者はまだいません</p>"}</details><div class="chat-layout">${shellCard("メッセージ", `${channel.announce ? hint("お知らせの依頼・緊急削除の申請の文言と印は案です（未決定）。") : ""}${messageRows(channel.messages, "channel")}${channel.readOnly ? readOnlyNotice : !joined ? joinNotice : canPostChannel(channel) ? composer("channel") : noPostNotice}`)}<div class="desktop-participants">${shellCard("参加者", participants || '<p class="subtle">参加者はまだいません</p>')}</div></div>`,
    (channel.private && joined
      ? protoButton(
          "招待",
          "invite-open",
          `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}に社員を招待"`,
        )
      : "") +
      protoButton(
        "整理スペースに登録",
        "org-add",
        `data-kind="channel" data-ref="${e(channel.id)}" aria-label="# ${e(channel.name)}を整理スペースに登録"`,
      ),
  );
}
function dmScreen() {
  const partner = employees.find(
    (person) => person.id === ui.dmUserId && person.active,
  );
  if (!partner)
    return screenFrame(
      "S06",
      "新しいDM",
      "相手の部署とステータスを確認して、1対1の会話を始めます。",
      shellCard(
        "相手を選ぶ",
        `<label for="dm-search">表示名で検索</label><input id="dm-search" type="search" placeholder="表示名で検索" autocomplete="off"><div class="people-cards">${employees
          .filter((person) => person.active && person.id !== state.userId)
          .map(
            (person) =>
              `<div class="person-card" data-name="${e(person.name)}"><div>${personButton(person.id)}<p>${e(deptOf(person))} ・ ${e(person.status || "在席")}</p></div>${protoButton("DMを送る", "dm", `data-user="${person.id}"`)}</div>`,
          )
          .join("")}</div><p id="dm-search-empty" class="subtle" hidden>該当する社員がいません。</p>`,
      ),
    );
  const key = dmKey(state.userId, partner.id);
  const messages = prototypeData.dm[key] || [];
  return screenFrame(
    "S06",
    `@ ${partner.name}`,
    `${deptOf(partner)} ・ ${partner.status || "在席"} ・ 戻り予定: なし`,
    shellCard(
      "1対1のやり取り",
      `${messageRows(messages, "dm")}${composer("dm")}`,
      protoButton("＋ 新しいDM", "dm-new") +
        protoButton(
          "整理スペースに登録",
          "org-add",
          `data-kind="dm" data-ref="${e(partner.id)}" aria-label="${e(partner.name)}との会話を整理スペースに登録"`,
        ),
    ),
  );
}
function threadMessages(thread) {
  if (thread.source === "case") return getCase(thread.caseId)?.messages || [];
  if (thread.source === "dm")
    return prototypeData.dm[dmKey(state.userId, thread.partnerId)] || [];
  return (
    prototypeData.channels.find((item) => item.id === thread.channelId)
      ?.messages || []
  );
}
const threadDraftScope = (thread) =>
  `thread:${thread.source}:${thread.caseId || thread.channelId || thread.partnerId}:${threadMessages(thread).indexOf(thread.message)}`;
function renderThread() {
  const panel = document.querySelector("#thread-panel");
  const thread = ui.thread;
  if (!thread) {
    panel.hidden = true;
    return;
  }
  if (!threadCanRead(thread)) {
    closeThread();
    return;
  }
  const message = thread.message;
  panel.hidden = false;
  const canReply = threadCanWrite(thread);
  const draft = draftFor(threadDraftScope(thread));
  panel.dataset.screenId = "S-07";
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  panel.innerHTML = `<div class="thread-header"><strong>S-07 スレッド</strong><button type="button" data-ui="thread-close" aria-label="スレッドを閉じる">×</button></div><div class="thread-scroll"><p class="thread-label">${e(thread.label || "")}</p><p class="side-caption">元のメッセージ</p><div class="chat-message" data-mid="${e(midOf(message))}"><div class="message-avatar">${e(nameOf(message.by).slice(-2))}</div><div class="chat-body">${personButton(message.by)}${message.deleted ? '<p class="deleted-note">削除されました</p>' : `<p>${e(message.text)}</p><div class="chat-tools"><button type="button" data-ui="org-add" data-kind="message" data-ref="${e(midOf(message))}" aria-label="元のメッセージを整理スペースに登録">整理スペースに登録</button></div>`}</div></div><h3>返信 ${message.replies?.length || 0}件</h3>${message.replies?.length ? message.replies.map((reply) => `<div class="thread-reply" data-mid="${e(midOf(reply))}"><strong>${e(nameOf(reply.by))}</strong> <time>${e(reply.at || "")}</time><p>${e(reply.text)}</p><div class="chat-tools"><button type="button" data-ui="org-add" data-kind="reply" data-ref="${e(midOf(reply))}" aria-label="${e(nameOf(reply.by))}の${e(reply.at || "")}の返信を整理スペースに登録">整理スペースに登録</button></div></div>`).join("") : '<p class="subtle">まだ返信がありません。</p>'}</div>${canReply ? `<form class="thread-form" data-proto-form="reply"><label for="reply-text">返信を入力</label><textarea id="reply-text" name="text" required data-min="1" data-max="4000" data-name="返信" data-draft-key="${e(draft.key)}">${e(draft.text)}</textarea>${draftNote(draft)}<button type="submit" class="button primary">返信する</button></form>` : `<p class="prototype-hint">${message.deleted ? "削除された投稿には返信できません。" : thread.source === "channel" ? (prototypeData.channels.find((item) => item.id === thread.channelId)?.readOnly ? "この部署は無効化されたため、読み取り専用です。" : "参加すると返信できます。") : "読み取り専用です。"}</p>`}`;
}
function renderReauthDemo() {
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  screen.innerHTML = screenFrame(
    "S26",
    "再認証ダイアログ",
    "重要操作の前に重ねる画面の確認用です。",
    shellCard(
      "画面見本",
      `${protoButton("再認証を開く", "reauth-demo")}${hint("入力値は保存されません。実際の認証は行いません。")}`,
    ),
  );
}
function renderProfileDemo() {
  // nosemgrep: insecure-innerhtml, insecure-document-method プロトタイプの画面の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、利用者の入力をそのまま入れない
  screen.innerHTML = screenFrame(
    "S27",
    "プロフィールカード",
    "表示名から重ねて開く画面の確認用です。",
    shellCard(
      "画面見本",
      protoButton("プロフィールカードを開く", "profile", 'data-user="u3"'),
    ),
  );
}
const requestStatusLabel = (request) =>
  request.status === "pending"
    ? "承認待ち"
    : request.status === "approved"
      ? "承認済み"
      : "却下";
// 公開チャンネルの一覧。参加していなくても読める（C-94）。部署の絞り込みは会社直属・自部署・他部署の順（C-106【案】）。
function channelDirectoryScreen() {
  const own = currentUser().department;
  const sectionOrder = { company: 0, own: 1, other: 2 };
  const filterOptions = [
    ["すべて", "すべて"],
    [COMPANY, "会社直属"],
    [own, `自部署（${deptOptionLabel(own)}）`],
    ...departmentNames()
      .filter((name) => name !== own)
      .map((name) => [name, deptOptionLabel(name)]),
  ];
  const channels = prototypeData.channels
    .filter(canReadChannel)
    .filter((channel) => ui.dirFilter === "すべて" || channel.dept === ui.dirFilter)
    // 拠点で絞ると、拠点を持たない会社直属のチャンネルは出ない（Q-50 未決定。試作の案）。
    .filter((channel) => ui.dirLocFilter === "すべて" || locationOf(channel.dept)?.id === ui.dirLocFilter)
    .sort(
      (a, b) =>
        sectionOrder[channelSection(a)] - sectionOrder[channelSection(b)],
    );
  const row = (channel) => {
    const joined = isChannelMember(channel);
    const dedicated = channel.dept !== COMPANY && channel.name === channel.dept;
    // お知らせ専用の区別の出し方は未決定（screens.md S-09）。ここでは案として文字のタグを付ける。
    const tag = channel.announce ? "（お知らせ専用）" : dedicated ? "（部署の専用チャンネル）" : "";
    return `<div class="directory-row" data-channel-name="${e(channel.name)}"><div><strong># ${e(channel.name)}</strong><p class="subtle">${e(deptLabel(channel.dept))}${locationBadge(channel.dept)}${tag} ・ ${channel.private ? "非公開" : "公開"} ・ ${channel.members.length}人が参加 ・ ${joined ? "参加済み" : "未参加（参加せずに読めます）"}</p></div><div class="inline-actions">${protoButton(joined ? "開く" : "読む", "channel", `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}を${joined ? "開く" : "参加せずに読む"}"`)}${joined ? "" : protoButton("参加する", "join-channel", `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}に参加する"`)}</div></div>`;
  };
  return screenFrame(
    "S09",
    "チャンネルを探す",
    "会社直属のチャンネルと全部署の公開チャンネル、参加中の非公開チャンネルを表示します。公開チャンネルは参加しなくても読めます。",
    shellCard(
      "チャンネル一覧",
      `<div class="directory-toolbar">${selectField("部署", "directory-dept", filterOptions, ui.dirFilter)}${selectField("拠点（案）", "directory-location", locationFilterOptions(), ui.dirLocFilter)}<div class="form-field"><label for="channel-search">名前で絞り込み</label><input id="channel-search" type="search" autocomplete="off"></div></div><div class="list-cards" id="channel-list">${channels.map(row).join("") || "<p>参加できるチャンネルがありません。チャンネルを申請できます。</p>"}</div><p id="channel-search-empty" class="subtle" hidden>該当するチャンネルがありません。</p>`,
      protoButton("＋ チャンネルを申請", "go", 'data-page="S10"'),
    ),
  );
}
// チャンネル名の使用可能文字（C-117(1)、V-25）。「日本語」の範囲は未定義のため、判定は案（Q-1）。
const channelNameCharsOk = (name) =>
  /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々〆a-zA-Z0-9０-９Ａ-Ｚａ-ｚ_-]+$/u.test(name);
// 案件作成の申請の入力の検査と正規化（画面の送信と実行する関数の両方から呼ぶ）。{ error } か { value } を返す。
// 保存する値は、ここで検査・正規化した値だけを使う。文字列でない値は、未指定として許す項目（納期・説明・参加候補・再申請元）の
// undefined・null を除いて拒否する。件名は整形後の文字数、担当部署は一般社員・オーナーが自部署のみ・全体管理者は有効な全部署、
// 取引先は有効なもの、納期は存在する日付で今日（日本時間）以降。
function cleanCaseRequest(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return { error: "申請の内容が正しくありません。" };
  const missing = (v) => v === undefined || v === null;
  if (typeof values.title !== "string") return { error: "件名を入力してください。" };
  const title = normalizeInput(values.title);
  if (!title) return { error: "件名を入力してください。" };
  if ([...title].length > 100) return { error: "件名は1〜100文字で入力してください（整形後の文字数）。" };
  if (!missing(values.description) && typeof values.description !== "string") return { error: "説明は文字で入力してください。" };
  const description = missing(values.description) ? "" : values.description.trim();
  if ([...description].length > 2000) return { error: "説明は2000文字以内で入力してください。" };
  if (!missing(values.due) && typeof values.due !== "string") return { error: "納期は日付で入力してください。" };
  const due = missing(values.due) ? "" : values.due.trim();
  if (due && !isRealDate(due)) return { error: "納期は日付で入力してください。" };
  if (due && due < todayText()) return { error: "今日以降の日付を選んでください。" };
  if (
    typeof values.department !== "string" ||
    (currentUser().role !== "admin" && values.department !== currentUser().department) ||
    !departmentNames().includes(values.department)
  )
    return { error: "担当部署を選んでください（一般社員は自部署のみ）。" };
  if (typeof values.clientCode !== "string" || !clientByCode(values.clientCode)?.active)
    return { error: "取引先を一覧から選んでください。" };
  if (!missing(values.candidates) && (!Array.isArray(values.candidates) || values.candidates.some((id) => typeof id !== "string")))
    return { error: "参加候補が正しくありません。" };
  const candidates = (values.candidates || []).filter(
    (id) => id !== state.userId && employees.some((person) => person.id === id && person.active),
  );
  if (!missing(values.previous) && typeof values.previous !== "string") return { error: "再申請の元が正しくありません。" };
  return {
    value: {
      title,
      changed: values.title.trim() !== title,
      clientCode: values.clientCode,
      due,
      description,
      department: values.department,
      candidates: [...new Set(candidates)],
      previous: values.previous || null,
      draftKey: typeof values.draftKey === "string" ? values.draftKey : undefined,
    },
  };
}
const caseRequestProblem = (values) => cleanCaseRequest(values).error || "";
// 案件作成の申請を作る。類似件名の警告のあとの確定でも、警告がないときも、ここを1回だけ通る。
function createCaseRequest(values) {
  // 警告のあとの確定でも、保存の直前に必ず再検査する。検査に通らなければ何も変えない。
  const cleaned = cleanCaseRequest(values);
  if (cleaned.error) return refuse(cleaned.error);
  const clean = cleaned.value;
  const previous = clean.previous ? getRequest(clean.previous) : null;
  if (
    clean.previous &&
    (!previous ||
      previous.applicant !== state.userId ||
      !["rejected", "withdrawn"].includes(previous.status))
  )
    return refuse();
  state.requests.push({
    id: `R-${Date.now()}`,
    title: clean.title,
    clientCode: clean.clientCode,
    due: clean.due,
    description: clean.description,
    caseNo: "",
    department: clean.department,
    applicant: state.userId,
    candidates: clean.candidates,
    added: [],
    status: "pending",
    reason: "",
    previous: previous?.id || null,
  });
  // 申請を送ったら、説明の下書きを消す。
  removeDraft(clean.draftKey);
  state.reapplySource = null;
  state.caseTab = "my";
  proceedTo("S16");
  return notify(`案件の作成を申請しました。${clean.changed ? "表記を整えて保存しました（案）。" : ""}`);
}
let pendingCaseRequest = null;
// 似た件名の警告（案）。「戻って直す」・閉じる・Esc では申請を作らず、入力と下書きを残す。
function openSimilarWarning(values, similar) {
  pendingCaseRequest = values;
  showModal(
    "似た案件があります（案）",
    `<p>同じ取引先に、似た件名の案件があります。重複した申請でないかを確かめてください。警告だけで、申請は止めません。</p><ul class="plain-list">${similar
      .map((item) => `<li>${e(item.no)} ${e(item.title)}（${e(caseStatusLabel(item))}）</li>`)
      .join("")}</ul>${hint("似ているかの判定の基準は未決定です（案：同じ取引先の進行中・終了の案件が対象。整形後に、空白・ハイフン・アンダースコアを除いた件名が同じ、または3文字以上の一方が他方を含むとき）。申請中の申請は比べません。")}`,
    "case-request-confirm",
    "このまま申請する",
    false,
    "戻って直す",
  );
}
function channelRequestScreen() {
  const own = prototypeData.channelRequests.filter(
    (request) => request.by === state.userId,
  );
  const dept = currentUser().department;
  return screenFrame(
    "S10",
    "チャンネル作成の申請",
    "承認されるまではチャンネルとして使えません。",
    `${shellCard("作成を申請", `<div class="banner">案件に関する話題のチャンネルは非公開をおすすめします。案件専用チャンネルは案件承認時に自動作成されます。</div><form data-proto-form="channel-request">${field("チャンネル名", "channel-name", "text", "", true, [1, 50], true)}${field("説明（任意）", "channel-description", "text", "", false, [0, 500])}<fieldset><legend>公開範囲</legend><label><input type="radio" name="visibility" value="public" checked> 公開</label><label><input type="radio" name="visibility" value="private"> 非公開</label></fieldset><fieldset><legend>作る場所（他部署のチャンネルは選べません）</legend><label><input type="radio" name="place" value="own" checked> 自部署のチャンネル（${e(dept)}）</label><label><input type="radio" name="place" value="company"> 会社直属のチャンネル</label></fieldset><p class="subtle">承認する人: 自部署のチャンネルは自部署のオーナー（オーナー自身の申請は全体管理者）、会社直属のチャンネルは全体管理者です。チャンネル名は会社内で重複できません（大文字・小文字は区別しません。承認待ちの申請の名前を含みます）。</p><p class="subtle">使える文字は、日本語（ひらがな・カタカナ・漢字・長音符「ー」・「々」「〆」）・英数字・ハイフン・アンダースコアです。記号・スペースは使えません（C-117・C-120で決定）。部署の自動作成名「{部署名}のお知らせ」は例外です。保存時に表記を自動で整えます（全角英数字を半角に、ハイフン類を「-」に。細部は案）。長さと重複は整形後の値で判定します（案）。</p><button type="submit" class="button primary">申請する</button></form>`)}${shellCard("自分の申請", own.length ? own.map((request) => `<div class="directory-row"><div><strong># ${e(request.name)}</strong><p class="subtle">${e(deptLabel(request.dept))} ・ ${request.private ? "非公開" : "公開"} ・ ${requestStatusLabel(request)}</p>${request.reason ? `<p class="subtle">却下理由: ${e(request.reason)}</p>` : ""}</div></div>`).join("") : "<p>申請はまだありません。</p>")}`,
  );
}
function channelApprovalsScreen() {
  const rows = channelRequestsForReview();
  return screenFrame(
    "S11",
    "チャンネル作成の承認一覧",
    "承認は1段階です。部署のチャンネルは自部署のオーナー（オーナー自身の申請は全体管理者）、会社直属のチャンネルは全体管理者が承認します。",
    shellCard(
      "申請と履歴",
      rows
        .map(
          (request) =>
            `<div class="directory-row"><div><strong># ${e(request.name)}</strong><p class="subtle">${e(deptLabel(request.dept))} ・ 申請者: ${e(nameOf(request.by))} ・ ${request.private ? "非公開" : "公開"} ・ ${requestStatusLabel(request)}</p>${request.reason ? `<p class="subtle">理由: ${e(request.reason)}</p>` : ""}</div><div class="inline-actions">${canReviewChannelRequest(request) ? protoButton("承認", "channel-review", `data-id="${request.id}" data-result="approve" aria-label="# ${e(request.name)}を承認"`) + protoButton("却下", "channel-review", `data-id="${request.id}" data-result="reject" aria-label="# ${e(request.name)}を却下"`) : request.status === "pending" && request.by === state.userId ? '<span class="subtle">自分では承認できません</span>' : ""}</div></div>`,
        )
        .join("") || "<p>承認待ちはありません。</p>",
    ),
  );
}
// 招待は通常チャンネルだけ。再認証して確定すると同時に参加者へ追加する（C-51）。部署への招待・申込・許可は設けない（C-37）。
function invitableChannels() {
  return prototypeData.channels.filter(isChannelMember);
}
function invitationScreen() {
  const channels = invitableChannels();
  const channel =
    channels.find((item) => item.id === ui.inviteChannelId) || channels[0];
  if (!channel)
    return screenFrame(
      "S12",
      "チャンネル招待",
      "チャンネルの参加者が、有効な社員をチャンネルに招待します。",
      shellCard("招待できるチャンネルがありません", "<p>参加しているチャンネルがないため、招待できません。</p>"),
    );
  const candidates = employees.filter(
    (person) => person.active && person.id !== state.userId,
  );
  return screenFrame(
    "S12",
    "チャンネル招待",
    "チャンネルの参加者が、有効な社員を招待します。再認証して確定すると同時に参加者へ追加されます。",
    shellCard(
      "チャンネルへの招待",
      `<form data-proto-form="invite" data-no-guard><div class="form-field"><label for="invite-channel">招待先のチャンネル</label><select id="invite-channel" name="invite-channel">${channels.map((item) => `<option value="${e(item.id)}" ${item.id === channel.id ? "selected" : ""}># ${e(item.name)}（${e(deptLabel(item.dept))}）</option>`).join("")}</select></div><div class="form-field"><label for="invite-person">対象社員（有効な社員）</label><select id="invite-person" name="invite-person">${candidates.map((person) => `<option value="${e(person.id)}">${e(person.name)}（${e(deptOf(person))}）${channel.members.includes(person.id) ? "（参加済み）" : ""}</option>`).join("")}</select></div><p id="invite-status" class="form-error" role="alert" hidden></p><p class="subtle">再認証して確定すると、対象の社員はその場でこのチャンネルの参加者になります。本人の申込や別の人の許可は要りません。確定後の辞退・取り消しはありません。確定する前なら、画面を閉じて取り消せます。</p><button type="submit" class="button primary">招待を確認</button></form>`,
    ) +
      hint(
        "案件専用チャンネルは対象外です（参加者の追加・削除は案件の画面で行います）。",
      ),
  );
}
function departmentManageScreen() {
  const dept = manageDeptNow();
  const depts = managedDepts();
  const people = employees.filter(
    (person) => person.department === dept && person.active,
  );
  const pendingFor = (id) =>
    prototypeData.retireRequests.some(
      (request) => request.target === id && request.status === "pending",
    );
  const operation = (person) => {
    if (person.role === "admin")
      return '<span class="subtle">全体管理者は対象外です</span>';
    if (person.role === "owner")
      return '<span class="subtle">オーナーの退職は全体管理者が先に交代させます</span>';
    return pendingFor(person.id)
      ? '<span class="badge pending">退職処理を申請済み</span>'
      : protoButton(
          "退職処理を全体管理者へ申請",
          "retire-apply",
          `data-user="${e(person.id)}" aria-label="${e(person.name)}の退職処理を全体管理者へ申請"`,
        );
  };
  const members =
    `<p class="subtle">拠点ラベル（案）:${locationOf(dept) ? locationBadge(dept) : " なし"}（表示のみ。設定は全体管理者が行います）</p><p class="subtle">メンバー ${people.length}人</p>` +
    people
      .map(
        (person) =>
          `<div class="directory-row"><div>${personButton(person.id)}<p class="subtle">${person.role === "owner" ? "オーナー" : "メンバー"}</p></div><div class="inline-actions">${operation(person)}</div></div>`,
      )
      .join("") +
    '<p class="subtle">申請しただけでは、社員は有効なままで、所属・権限も変わりません。退職の確定とアカウントの無効化は全体管理者が行います。部署異動も全体管理者が直接行います。</p>';
  return screenFrame(
    "S13",
    "部署管理（オーナー）",
    `${dept} のオーナーがメンバーとチャンネルを管理します。`,
    (depts.length > 1
      ? shellCard(
          "対象の部署",
          selectField("管理する部署", "manage-dept", depts.map((n) => [n, deptOptionLabel(n)]), dept),
        )
      : "") +
      `<div class="guide-grid">${shellCard("メンバー", members)}${shellCard(
        "チャンネル",
        prototypeData.channels
          .filter((channel) => channel.dept === dept)
          .map(
            (channel) =>
              `<div class="directory-row"># ${e(channel.name)} <span>${channel.private ? "非公開" : "公開"}</span></div>`,
          )
          .join("") + protoButton("共通フォルダを管理", "go", 'data-page="S32"'),
      )}</div>` +
      hint(
        "部署範囲のロールの付与・解除は第2段階です。この試作には出していません。オーナーの任命・交代はこの画面ではできません（全体管理者が「部署の一覧とオーナーの任命・交代」で行います）。会社直属のチャンネルの管理は全体管理者です。",
      ),
  );
}
function notificationsScreen() {
  return screenFrame(
    "S14",
    "通知一覧",
    "未読とメンションをまとめて確認します。",
    shellCard(
      "新しい通知",
      ownNotices()
        .map(
          (note) =>
            `<div class="directory-row"><div><strong>${e(note.type)}</strong><p class="subtle">${e(note.text)}</p></div>${protoButton("開く", "notification-open", `data-id="${note.id}"`)}</div>`,
        )
        .join("") || "<p>新しい通知はありません。</p>",
    ),
  );
}
// 案件の内容（メッセージ・TODO・添付名）を検索できるのは参加者と、公開済みアーカイブの閲覧者だけ（5-1 AC-12）。
// 審査用の一時閲覧では検索させない。
const canSearchContent = (item) =>
  isMember(item) || (item.status === "archived" && item.visibility === "public");
function caseSearchHits(item, has) {
  if (!canSearchContent(item)) return [];
  const hits = [];
  item.messages.forEach((message) => {
    if (has(message.text))
      hits.push({ type: "メッセージ", text: message.text, mid: midOf(message) });
    (message.attachments || []).forEach((att) => {
      if (
        has(att.name) &&
        (att.scope === "public" || canSeeRestrictedAttachment(item))
      )
        hits.push({ type: "添付", text: att.name, mid: midOf(message) });
    });
  });
  item.todos.forEach((todo) => {
    if (has(todo.title)) hits.push({ type: "TODO", text: todo.title });
  });
  return hits;
}
function searchScreen() {
  const term = ui.search.trim().toLowerCase();
  const has = (text) => !!term && String(text).toLowerCase().includes(term);
  // 参加していない公開チャンネルも対象（C-117(2)）。非公開は参加者だけ、DM・閲覧権限のない案件の中身は対象外。
  const channelHits = prototypeData.channels
    .filter((channel) => canReadChannel(channel))
    .flatMap((channel) =>
      channel.messages
        .filter(
          (message) =>
            !message.deleted &&
            (!term || message.text.toLowerCase().includes(term)),
        )
        .map((message) => ({ channel, message })),
    );
  const cases = state.cases
    .map((item) => ({
      item,
      meta:
        !term ||
        [item.title, clientNameOf(item.clientCode)].some(has) ||
        caseNoMatches(item, term),
      inner: caseSearchHits(item, has),
    }))
    .filter((hit) => hit.meta || hit.inner.length);
  const caseCard = ({ item, inner }) =>
    `<div class="directory-row search-case"><div><strong><span class="case-id">${e(item.no)}</span>${e(item.title)}</strong><p class="subtle">取引先: ${e(clientLabelOf(item.clientCode))} ・ ${e(item.department)} ・ ${e(caseStatusLabel(item))} ・ 進捗 ${progressHtml(item)} ・ 納期 ${item.due ? e(item.due) : "なし"}</p>${inner.length ? `<ul class="search-inner" aria-label="${e(item.title)}の一致した内容">${inner.map((hit) => `<li><span class="badge archived">${e(hit.type)}</span> ${e(hit.text.slice(0, 60))}${hit.mid ? ` <button type="button" class="button small" data-ui="case-msg-open" data-id="${e(item.id)}" data-mid="${e(hit.mid)}" aria-label="${e(item.title)}の該当の投稿を開く">投稿を開く</button><button type="button" class="button small" data-ui="org-add" data-kind="message" data-ref="${e(hit.mid)}" aria-label="該当の投稿を整理スペースに登録">整理スペースに登録</button>` : ""}</li>`).join("")}</ul>` : ""}</div><div class="inline-actions">${protoButton("概要を開く", "case-open", `data-id="${e(item.id)}"`)}${canSeeContent(item) ? protoButton("整理スペースに登録", "org-add", `data-kind="case" data-ref="${e(item.id)}" aria-label="${e(item.no)} ${e(item.title)}を整理スペースに登録"`) : ""}</div></div>`;
  return screenFrame(
    "S15",
    "検索結果",
    "案件は件名・案件番号（先頭から一致）・取引先名で探せます。案件の参加者と公開済みアーカイブは、メッセージ・TODO・添付名も対象です。非参加者には概要だけを示します。",
    `<form data-proto-form="search" data-no-guard class="directory-toolbar"><label for="search-term">キーワード</label><input id="search-term" name="term" type="search" value="${e(ui.search)}" data-max="100" data-name="検索語"><button type="submit" class="button primary">検索する</button></form>${shellCard("メッセージ", channelHits.length ? channelHits.map((hit) => `<div class="directory-row"><div><strong># ${e(hit.channel.name)}</strong>${isChannelMember(hit.channel) ? "" : '<span class="subtle">（参加していません・案）</span>'}<p>${e(hit.message.text)}</p></div><div class="inline-actions">${protoButton("開く", "channel", `data-id="${hit.channel.id}"`)}${protoButton("整理スペースに登録", "org-add", `data-kind="message" data-ref="${e(midOf(hit.message))}" aria-label="# ${e(hit.channel.name)}のメッセージを整理スペースに登録"`)}</div></div>`).join("") : "<p>該当するメッセージはありません。</p>")}${shellCard("案件", cases.length ? cases.map(caseCard).join("") : "<p>該当する案件はありません。</p>")}`,
  );
}
function caseRequestScreen() {
  const item = state.selectedId && getCase(state.selectedId);
  const manage =
    item && item.status === "active" && isMember(item) && state.caseManage;
  if (manage)
    return screenFrame(
      "S18",
      "案件の参加者を管理",
      `${item.title} ・ 参加者を変更すると専用チャンネルにも反映されます。`,
      shellCard(
        "参加者",
        `${item.members.map((id) => `<div class="directory-row">${personButton(id)}${protoButton("外す", "case-remove", `data-id="${item.id}" data-user="${id}" aria-label="${e(nameOf(id))}を外す"`)}</div>`).join("")}<div class="inline-actions">${protoButton("参加者を追加", "case-add", `data-id="${item.id}"`)}${protoButton("案件の詳細へ戻る", "case-open", `data-id="${item.id}"`)}</div>`,
      ),
    );
  const prior = state.reapplySource ? getRequest(state.reapplySource) : null;
  // 説明の下書きは端末に一時保存する（C-82・C-117(5)）。新規の申請と、却下後の再申請でキーを分け、件名・個人情報は保存しない。
  const descDraft = draftFor(prior ? `case-request:reapply:${prior.id}` : "case-request:new");
  // 担当部署は必須。一般社員・オーナーは自部署のみ、全体管理者は全部署から選ぶ（C-98）。
  const department =
    currentUser().role === "admin"
      ? `<div class="form-field"><label for="case-department">担当部署（必須）</label><select id="case-department" name="case-department" required><option value="">担当部署を選んでください</option>${departmentNames()
          .map(
            (name) =>
              `<option value="${e(name)}" ${prior?.department === name ? "selected" : ""}>${e(deptOptionLabel(name))}</option>`,
          )
          .join("")}</select></div>`
      : `<p class="form-label">担当部署（必須。自部署のみ）</p><div class="muted-box">${e(currentUser().department)}</div><input type="hidden" name="case-department" value="${e(currentUser().department)}">`;
  const clients = `<div class="form-field"><label for="case-client">取引先（必須）</label><select id="case-client" name="case-client" required><option value="">取引先を選んでください</option>${state.clients
    .filter((client) => client.active)
    .map(
      (client) =>
        `<option value="${e(client.code)}" ${prior?.clientCode === client.code ? "selected" : ""}>${e(client.name)}（${e(client.code)}）</option>`,
    )
    .join(
      "",
    )}</select><p class="form-hint">社内の案件は「社内（INT）」を選びます。案件番号は承認されたときに自動で付き、入力はできません。</p></div>`;
  return screenFrame(
    "S18",
    prior ? "修正して再申請" : "案件の作成を申請",
    "承認されるまで案件や専用チャンネルは作られません。",
    shellCard(
      "申請する内容",
      `<form data-proto-form="case-request"><div class="banner">申請者は承認時に自動参加します。</div><div class="form-field"><label for="case-title">案件名（件名）</label><p class="field-note" id="case-title-note">件名は参加していない人にも見える場合があります。機密情報を書かないでください</p><input id="case-title" name="case-title" required value="${e(prior?.title || "")}" aria-describedby="case-title-note" data-min="1" data-max="100" data-name="件名" data-normalize><p class="form-hint">保存時に表記を自動で整えます（全角英数字を半角に、連続する空白を1つに、ハイフン類を「-」に。細部は案）。同じ取引先に似た件名の案件があるときは、申請の前に警告します（警告だけで止めません。基準は案）。</p></div>${clients}<div class="form-field"><label for="case-description">説明（任意）</label><textarea id="case-description" name="case-description" data-max="2000" data-name="説明" data-draft-key="${e(descDraft.key)}">${e(descDraft.text || prior?.description || "")}</textarea>${draftNote(descDraft)}</div><div class="form-field"><label for="case-due">納期（任意）</label><input id="case-due" name="case-due" type="date" min="${e(todayText())}" value="${e(prior?.due || "")}"><p class="form-hint">今日以降の日付だけ入力できます（入力欄の細部は案）。設定すると全社員が案件の一覧と概要で見られます。通知や期限の警告は出ません。</p></div>${department}<p class="form-label">追加の参加候補（任意）</p><p class="subtle">他部署の社員も選べます。承認者は候補の追加のみできます。</p>${participantOptions(prior?.candidates || [], [state.userId])}<div class="form-actions"><button type="submit" class="button primary">申請する</button>${protoButton("案件一覧へ", "go", 'data-page="S16"')}</div></form>`,
    ),
  );
}
function profileScreen() {
  const user = currentUser();
  return screenFrame(
    "S19",
    "プロフィール設定",
    "表示名・ステータスを変更し、管理者だけが変更できる社員情報を確認します。",
    shellCard(
      "自分のプロフィール",
      `<form data-proto-form="profile">${field("表示名", "display-name", "text", user.name, true, [1, 30])}<fieldset><legend>ステータス</legend>${["在席", "外出", "欠席", "休暇", "会議中"].map((status) => `<label class="radio-label"><input type="radio" name="status" value="${status}" ${(user.status || "在席") === status ? "checked" : ""}> ${status}</label>`).join("")}</fieldset>${field("戻り予定（任意）", "return-time", "time")}${field("一言メッセージ（任意）", "status-message", "text", user.message || "", false, [0, 100])}<button type="submit" class="button primary">保存する</button></form><div class="readonly-info"><strong>全体管理者だけが変更できる項目</strong><p>部署: ${e(deptOf(user))} / 役職: ${e(titleOf(user))} / メール: ${e(emailOf(user))} / 内線: ${e(extOf(user))}</p><p>本名: テスト社員 ${e(user.id.slice(-1))}（架空）</p><p class="subtle">本名は直接変更できません。変更届を出し、全体管理者が承認すると更新されます。</p></div>${protoButton("本名の変更届を出す", "name-change-request")}${protoButton("パスワードを変更", "go", 'data-page="S04"')}`,
    ),
  );
}
function employeeScreen() {
  // 有効で所属部署がある社員だけを出す。無効化済み（退職者）は出さない（7-3 AC-1、C-36）。
  const list = employees.filter(
    (person) =>
      person.active &&
      !!person.department &&
      (ui.staffFilter === "すべて" || person.department === ui.staffFilter) &&
      // 拠点を持たない部署の社員は、拠点を選んだときは出ない（Q-50 の考え方に合わせた案）。
      (ui.staffLocFilter === "すべて" || locationOf(person.department)?.id === ui.staffLocFilter),
  );
  return screenFrame(
    "S20",
    "社員一覧",
    "表示名を押すと本名・部署・ステータスのプロフィールカードを開きます。",
    shellCard(
      "社員",
      `${selectField(
        "部署で絞り込む",
        "staff-department",
        [["すべて", "すべて"], ...departmentNames().map((name) => [name, deptOptionLabel(name)])],
        ui.staffFilter,
      )}${selectField("拠点で絞り込む（案）", "staff-location", locationFilterOptions(), ui.staffLocFilter)}<div class="list-cards">${list.map((person) => `<div class="directory-row"><div>${personButton(person.id)}<p class="subtle">${e(person.department)}${locationBadge(person.department)} ・ 内線 ${e(extOf(person))} ・ <a href="mailto:${e(emailOf(person))}">${e(emailOf(person))}</a> ・ ${e(person.status || "在席")}</p></div><div class="inline-actions">${person.id !== state.userId ? protoButton("DMを送る", "dm", `data-user="${person.id}"`) : ""}${adminOnly() || (currentUser().role === "owner" && currentUser().department === person.department) ? protoButton("代理設定", "delegate-status", `data-user="${person.id}"`) : ""}</div></div>`).join("") || "<p>該当する社員がいません。</p>"}</div>`,
    ),
  );
}
function accountRegisterScreen() {
  const individual = ui.registerMode === "individual";
  return screenFrame(
    "S23",
    "アカウント登録",
    "個別登録とCSV一括登録を切り替えて確認します。",
    `<div class="case-subnav"><button type="button" class="${individual ? "active" : ""}" data-ui="register-mode" data-mode="individual">1人ずつ</button><button type="button" class="${!individual ? "active" : ""}" data-ui="register-mode" data-mode="csv">CSVで一括</button></div>` +
      (individual
        ? shellCard(
            "1人ずつ登録",
            `<form data-proto-form="account-register">${field("ユーザーID", "register-id", "text", "", true, [3, 32])}${field("表示名", "register-name", "text", "", true, [1, 30])}${field("メールアドレス", "register-email", "email", "", true, [3, 254])}<label><input type="checkbox" required> 全体管理者がメールアドレスを確認した</label>${field("初期パスワード", "register-password", "password", "", true)}${field("初期パスワード（確認）", "register-confirm", "password", "", true)}${selectField(
              "所属部署",
              "register-department",
              [
                ["営業部", "営業部"],
                ["設計部", "設計部"],
              ],
            )}${field("本名", "register-real-name", "text", "", false, [0, 50])}${field("内線番号（任意）", "register-extension", "text", "", false, [0, 10])}${field("役職（任意）", "register-title", "text", "", false, [0, 30])}<button type="submit" class="button primary">入力を確認</button></form>`,
          )
        : shellCard(
            "CSVで一括登録",
            `<label for="register-csv">CSVファイル</label><input id="register-csv" type="file" accept=".csv" disabled><p class="subtle">各行で所属部署を指定します。列定義と文字コードは未決定のため、ファイルの読み込み・登録は再現していません。</p><div class="directory-row"><strong>入力エラーの表示見本</strong><span>行3・ユーザーID: 既存のIDです</span></div>`,
          )),
  );
}
// 案件の終了・再開・引き継ぎは、誰が・いつ・どの案件かと、理由・再選定の結果を残す（C-81）。
function auditScreen() {
  const rows = state.audit.length
    ? state.audit
        .map(
          (event) =>
            `<div class="directory-row audit-row"><div><strong>${e(event.kind || "操作")}</strong><span class="subtle"> 対象: ${e(event.target || "—")}</span><p>${e(event.text)}</p></div><div class="audit-meta"><time>${e(event.at)}</time><span>操作した人: ${e(event.actor || "—")}</span><span>結果: 成功</span></div></div>`,
        )
        .join("")
    : "<p>この試作で記録された操作はまだありません。案件の終了・再開などを行うと、ここに記録されます。</p>";
  return screenFrame(
    "S25",
    "監査ログ",
    "重要操作の記録と、絞り込み・ページ送りを確認します。",
    shellCard(
      "記録",
      `<div class="directory-toolbar"><label for="audit-kind">種類</label><select id="audit-kind"><option>すべて</option><option>申請・承認</option><option>閲覧</option></select><label for="audit-date">日付</label><input id="audit-date" type="date"></div><div class="list-cards">${rows}</div><div class="pagination"><button type="button" disabled>前へ</button><span>1 ページ</span><button type="button" disabled>次へ</button></div>`,
    ) +
      shellCard(
        "表示見本（案件の引き継ぎ）",
        `<div class="directory-row audit-row"><div><strong>案件の引き継ぎ</strong><span class="subtle"> 対象: ABC-261001-0001（見本）</span><p>最後の有効参加者の無効化に伴い、後任を指定して引き継いだ記録の形です。</p></div><div class="audit-meta"><span>操作した人: testuser_005</span><span>結果: 成功</span></div></div>` +
          hint(
            "案件の引き継ぎはアカウントの無効化操作を再現していないため、記録の形だけを見本にしています。",
          ),
      ),
  );
}
function adminHandoverScreen() {
  return screenFrame(
    "S28",
    "全体管理者の引き継ぎ",
    "有効な社員を後任に指名し、再認証して引き継ぐ流れです。",
    shellCard(
      "引き継ぎ先",
      `${selectField(
        "後任の社員",
        "new-admin",
        employees
          .filter((person) => person.active && person.id !== state.userId)
          .map((person) => [person.id, person.name]),
      )}<p class="subtle">前の全体管理者は一般メンバーに戻ります。両者の部署所属の扱いは未決定です。</p>${protoButton("再認証の画面を確認", "reauth-demo")}`,
    ),
  );
}
function rolesScreen() {
  return screenFrame(
    "S30",
    "ロールの編集",
    "第2段階の将来画面です。通常の業務メニューには表示されません。",
    shellCard(
      "権限の一覧見本",
      `<div class="directory-row"><strong>一般メンバー</strong><span>初期値で固定</span></div><div class="directory-row"><strong>オーナー</strong><span>編集範囲は第2段階で確認</span></div><div class="directory-row"><strong>全体管理者</strong><span>編集対象外</span></div>${unavailable("権限IDと変更手順は未決定のため、編集操作は行いません。")}`,
    ),
  );
}
function newRoleScreen() {
  return screenFrame(
    "S31",
    "ロールの新規作成と名前の変更",
    "第2段階の将来画面です。通常の業務メニューには表示されません。",
    shellCard(
      "作成フォームの見本",
      `${field("ロール名", "new-role-name")}${selectField(
        "範囲",
        "new-role-scope",
        [
          ["company", "会社全体"],
          ["department", "部署"],
        ],
      )}${unavailable("名前変更の権限・付与操作・権限IDが未決定のため、登録しません。")}`,
    ),
  );
}
// 共通フォルダは部署ごと。管理は自部署のオーナー（全体管理者は任命された部署）（C-97）。
function sharedFolderScreen() {
  const target = folderTargetNow();
  const targets = folderTargets();
  const folders = prototypeData.folders[target] || [];
  return screenFrame(
    "S32",
    "チャンネルの共通フォルダ",
    target === COMPANY
      ? "会社直属のチャンネルのフォルダです。全体管理者が管理します（C-110）。"
      : `${deptDisplay(target)} の共通フォルダです。${target} の社員には同じ並びで表示されます。`,
    (targets.length > 1
      ? shellCard(
          "対象",
          selectField(
            "フォルダを管理する場所",
            "folder-dept",
            targets.map((name) => [name, name === COMPANY ? "会社直属" : deptOptionLabel(name)]),
            target,
          ),
        )
      : "") +
      shellCard(
        "フォルダ一覧",
        `${folders
          .map(
            (folder) =>
              `<div class="directory-row"><strong>⌄ ${e(folder)}</strong><span>${
                prototypeData.channels
                  .filter(
                    (channel) =>
                      channel.dept === target && channel.folder === folder,
                  )
                  .map((channel) => "# " + e(channel.name))
                  .join("、") || "空"
              }</span>${protoButton("名前を変更", "rename-folder", `data-name="${e(folder)}" aria-label="${e(folder)}の名前を変更"`)}</div>`,
          )
          .join(
            "",
          )}<form data-proto-form="folder"><label for="folder-name">新しいフォルダ名</label><input id="folder-name" name="name" required data-min="1" data-max="50" data-name="フォルダ名"><button type="submit" class="button primary">フォルダを作成</button></form>`,
      ) +
      hint(
        "名前は前後の空白を除いて1〜50文字、同じ部署内で大文字・小文字を区別せず重複できません。入れ子、複数フォルダへの所属、削除、チャンネルの入れ替え、再認証の要否はこの試作では再現していません。",
      ),
  );
}
function protoModal(title, body, actionLabel = "") {
  showModal(
    title,
    `${body}${hint("画面の確認用です。未決定の業務結果は反映しません。")}`,
    "demo-only",
    actionLabel,
  );
}
function openProfile(id) {
  const person = employees.find((value) => value.id === id);
  if (!person) return;
  ui.profile = id;
  showModal(
    "S-27 プロフィールカード",
    `<div class="person-card"><span class="message-avatar">${e(person.name.slice(-2))}</span><div><strong>${e(person.name)}</strong><p>本名: テスト社員 ${e(person.id.slice(-1))}（架空）</p><p>部署: ${e(deptOf(person))} ・ ${e(person.status || "在席")}</p></div></div>${person.id !== state.userId ? protoButton("DMを送る", "dm", `data-user="${person.id}"`) : ""}`,
    "demo-only",
    "",
  );
}
function openReauth() {
  showModal(
    "S-26 再認証",
    `${field("パスワードを再入力", "reauth-password", "password")}<p class="subtle">重要操作の前に表示します。入力値は保存せず、実際の本人確認は行いません。</p>`,
    "demo-only",
    "",
  );
}

function closeDrawer() {
  const drawer = document.querySelector("#drawer");
  if (drawer.open) drawer.close();
  ui.drawerReturn?.focus();
}
function openDrawer() {
  ui.drawerReturn = document.activeElement;
  const drawer = document.querySelector("#drawer");
  drawer.showModal();
  drawer.querySelector("button")?.focus();
}
function closeThread() {
  ui.thread = null;
  document.querySelector("#thread-panel").hidden = true;
  document.querySelector("#thread-panel").replaceChildren();
  document.body.classList.remove("thread-open");
  document.querySelector(".topbar")?.removeAttribute("inert");
  document.querySelector(".mobile-nav")?.removeAttribute("inert");
  document.querySelector("#screen")?.removeAttribute("inert");
  document.querySelector(".prototype-toolbar")?.removeAttribute("inert");
  ui.threadReturn?.focus();
}
function threadCanRead(thread) {
  if (!thread || thread.viewerId !== state.userId) return false;
  if (thread.source === "case") {
    const item = getCase(thread.caseId);
    return (
      !!item && canSeeContent(item) && item.messages.includes(thread.message)
    );
  }
  if (thread.source === "channel") {
    const channel = prototypeData.channels.find(
      (item) => item.id === thread.channelId,
    );
    return !!channel && canReadChannel(channel) && channel.messages.includes(thread.message);
  }
  if (thread.source === "dm") {
    return (
      !!thread.partnerId &&
      employees.some(
        (person) => person.id === thread.partnerId && person.active,
      ) &&
      (prototypeData.dm[dmKey(state.userId, thread.partnerId)] || []).includes(
        thread.message,
      )
    );
  }
  return false;
}
function threadCanWrite(thread) {
  if (!threadCanRead(thread)) return false;
  // 削除済みの親投稿には新しい返信をつけられない。既存の返信は読める（1-4 AC-2・C-59）。
  if (thread.message.deleted) return false;
  if (thread.source === "channel") {
    const channel = prototypeData.channels.find(
      (item) => item.id === thread.channelId,
    );
    return isChannelMember(channel) && !channel.readOnly;
  }
  if (thread.source !== "case") return true;
  const item = getCase(thread.caseId);
  return item.status === "active" && isMember(item);
}
function openThread(source, index) {
  let messages;
  if (source === "case") {
    const item = getCase(state.selectedId);
    if (!item || !canSeeContent(item)) return refuse();
    messages = item.messages;
  } else if (source === "dm") {
    if (!ui.dmUserId) return refuse();
    messages = prototypeData.dm[dmKey(state.userId, ui.dmUserId)] || [];
  } else {
    const channel = activeChannel();
    if (!canReadChannel(channel)) return refuse();
    messages = channel.messages;
  }
  const message = messages[Number(index)];
  if (!message) return refuse("元のメッセージが見つかりません。");
  showThread({
    source,
    message,
    viewerId: state.userId,
    caseId: state.selectedId,
    channelId: ui.channelId,
    partnerId: ui.dmUserId,
    label:
      source === "case"
        ? `${getCase(state.selectedId).no} ${getCase(state.selectedId).title}`
        : source === "dm"
          ? `@ ${nameOf(ui.dmUserId)}`
          : `# ${activeChannel().name}`,
  });
}
// スレッドを開くと、その返信は既読になる（C-91）。S-35からも元の画面からも同じ入口を使う。
function showThread(thread) {
  ui.threadReturn = document.activeElement;
  ui.thread = thread;
  markThreadRead(thread.message);
  renderShell();
  document.body.classList.add("thread-open");
  if (window.matchMedia("(max-width: 767px)").matches) {
    document.querySelector(".topbar")?.setAttribute("inert", "");
    document.querySelector(".mobile-nav")?.setAttribute("inert", "");
    document.querySelector("#screen")?.setAttribute("inert", "");
    document.querySelector(".prototype-toolbar")?.setAttribute("inert", "");
  }
  document.querySelector("#thread-panel").querySelector("button")?.focus();
}
function proceedTo(page) {
  closeDrawer();
  const avatarDialog = document.querySelector("#avatar-dialog");
  if (avatarDialog.open) avatarDialog.close();
  if (ui.thread) closeThread();
  state.caseManage = false;
  // S-37 の絞り込みは、開き直すたびに既定の「申請中」に戻す（C-115）。
  if (page === "S37" && state.page !== "S37") ui.annFilter = "pending";
  navigate(page);
}
function uiAction(element) {
  const action = element.dataset.ui;
  if (action === "tool-toggle") {
    const content = document.querySelector("#tool-content");
    content.hidden = !content.hidden;
    element.setAttribute("aria-expanded", String(!content.hidden));
    return;
  }
  if (action === "drawer-open") return openDrawer();
  if (action === "drawer-close") return closeDrawer();
  if (action === "avatar-menu") return openAvatarMenu();
  if (action === "avatar-close")
    return document.querySelector("#avatar-dialog").close();
  if (action === "logout") {
    // ログアウトのボタンを押したときは、そのユーザーの下書きを消す（C-82）。
    clearUserDrafts(state.userId);
    return proceedTo("S02");
  }
  if (action === "go") return proceedTo(element.dataset.page);
  if (action === "case-tab") {
    state.caseTab = element.dataset.tab;
    return proceedTo("S16");
  }
  if (action === "case-open") return openCase(element.dataset.id);
  if (action === "case-manage") {
    const item = getCase(element.dataset.id);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    state.caseManage = true;
    return navigate("S18", true);
  }
  if (action === "channel") {
    const channel = prototypeData.channels.find(
      (item) => item.id === element.dataset.id,
    );
    if (!canReadChannel(channel)) return refuse();
    ui.channelId = channel.id;
    return proceedTo("S05");
  }
  if (action === "join-channel") {
    const channel = prototypeData.channels.find(
      (item) => item.id === element.dataset.id,
    );
    // 公開チャンネルには、部署を問わず自分で参加できる（C-94）。非公開は招待による。
    if (!channel || channel.private) return refuse();
    if (!channel.members.includes(state.userId))
      channel.members.push(state.userId);
    ui.channelId = channel.id;
    notify(`#${channel.name} に参加しました。`);
    return proceedTo("S05");
  }
  if (action === "dm") {
    const person = employees.find(
      (item) => item.id === element.dataset.user && item.active,
    );
    if (!person || person.id === state.userId) return refuse();
    if (modal.open) closeModal();
    ui.dmUserId = person.id;
    return proceedTo("S06");
  }
  if (action === "dm-clear") {
    ui.dmUserId = null;
    return render();
  }
  if (action === "profile") return openProfile(element.dataset.user);
  if (action === "thread-open")
    return openThread(element.dataset.source, element.dataset.index);
  if (action === "thread-close") return closeThread();
  if (action === "toggle-password") {
    const input = document.getElementById(element.dataset.target);
    if (input) {
      input.type = input.type === "password" ? "text" : "password";
      element.textContent =
        input.type === "password" ? "パスワードを表示" : "パスワードを隠す";
    }
    return;
  }
  if (action === "reaction") {
    const source = element.dataset.source,
      index = Number(element.dataset.index);
    if (
      source === "case" &&
      (getCase(state.selectedId)?.status !== "active" ||
        !isMember(getCase(state.selectedId)))
    )
      return refuse();
    if (source === "channel" && !isChannelMember(activeChannel()))
      return refuse();
    // 無効にした部署のお知らせ専用チャンネル（読み取り専用）では、リアクションも受け付けない。
    if (source === "channel" && activeChannel()?.readOnly)
      return refuse("この部署は無効化されたため、読み取り専用です。");
    const message =
      source === "channel"
        ? activeChannel()?.messages[index]
        : source === "dm"
          ? (prototypeData.dm[dmKey(state.userId, ui.dmUserId)] || [])[index]
          : getCase(state.selectedId)?.messages[index];
    if (!message) return refuse();
    if (message.deleted) return refuse("この投稿はすでに削除されています。");
    message.likes = (message.likes || 0) + 1;
    return render();
  }
  if (action === "notification-open") {
    const note = ownNotices().find((item) => item.id === element.dataset.id);
    if (!note) return refuse();
    if (note.announce) return announceOpenNotice(note);
    if (note.channel) {
      const channel = prototypeData.channels.find(
        (item) => item.id === note.channel,
      );
      if (!isChannelMember(channel)) return refuse();
      ui.channelId = channel.id;
    }
    if (note.user) ui.dmUserId = note.user;
    if (note.caseId) return openCase(note.caseId);
    return proceedTo(note.target);
  }
  if (action === "register-mode") {
    ui.registerMode = element.dataset.mode;
    return render();
  }
  if (action === "reauth-demo") return openReauth();
  if (action === "owner-handover")
    return protoModal(
      "S-24 オーナーの任命・交代（確認の見本）",
      `<p>${e(element.dataset.dept)} のオーナーを交代します。新しいオーナーを選び、別部署の現オーナーを選んだときは元部署の後任も選び、再認証して確定します。</p>${selectField(
        "新しいオーナー",
        "successor",
        employees
          .filter((person) => person.active)
          .map((person) => [person.id, `${person.name}（${deptOf(person)}）`]),
      )}`,
    );
  if (action === "delegate-status") {
    const person = employees.find((value) => value.id === element.dataset.user);
    if (
      !person ||
      !(
        adminOnly() ||
        (currentUser().role === "owner" &&
          currentUser().department === person.department)
      )
    )
      return refuse();
    return showModal(
      "ステータスを代理設定",
      `<p>対象: ${e(person.name)}</p>${selectField(
        "ステータス",
        "delegated-status",
        ["在席", "外出", "欠席", "休暇", "会議中"].map((value) => [
          value,
          value,
        ]),
      )}<input type="hidden" name="person" value="${person.id}">`,
      "delegate-status",
      "設定する",
    );
  }
  if (action === "channel-review") {
    const request = prototypeData.channelRequests.find(
      (value) => value.id === element.dataset.id,
    );
    if (!canReviewChannelRequest(request)) return refuse();
    ui.pendingChannelDecision = {
      id: request.id,
      result: element.dataset.result,
    };
    return showModal(
      "S-26 再認証",
      `${field("パスワードを再入力", "reauth-password", "password", "", true)}<p class="subtle">入力値は保存しません。</p>`,
      "channel-reauth",
      "確認して続ける",
    );
  }
  if (action === "case-add") {
    const item = getCase(element.dataset.id);
    if (!item || item.status !== "active" || !isMember(item)) return refuse();
    const candidates = employees.filter(
      (person) => person.active && !item.members.includes(person.id),
    );
    return showModal(
      "参加者を追加",
      selectField(
        "社員",
        "case-new-member",
        candidates.map((person) => [person.id, person.name]),
      ) + `<input type="hidden" name="id" value="${e(item.id)}">`,
      "case-add",
      "追加する",
    );
  }
  if (action === "case-remove") {
    const item = getCase(element.dataset.id),
      user = element.dataset.user;
    if (
      !item ||
      item.status !== "active" ||
      !isMember(item) ||
      !item.members.includes(user) ||
      item.members.length <= 1
    )
      return refuse("最後の参加者は外せません。");
    item.members = item.members.filter((id) => id !== user);
    releaseAssignee(item, [user]);
    record(item, `${nameOf(user)} を参加者から外しました`);
    notify("参加者を更新しました。");
    return render();
  }
  if (action === "rename-folder")
    return showModal(
      "フォルダ名を変更",
      `${field("名前", "folder-rename", "text", element.dataset.name, true, [1, 50])}<input type="hidden" name="before" value="${e(element.dataset.name)}">`,
      "rename-folder",
      "変更する",
    );
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target.closest("[data-ui]");
    if (!target || target.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    uiAction(target);
  },
  true,
);
document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    if (target.id === "directory-dept") {
      ui.dirFilter = target.value;
      render();
      document.getElementById("directory-dept")?.focus();
      event.stopImmediatePropagation();
      return;
    }
    if (target.id === "directory-location") {
      ui.dirLocFilter = target.value;
      render();
      document.getElementById("directory-location")?.focus();
      event.stopImmediatePropagation();
      return;
    }
    if (target.id === "manage-dept" || target.id === "folder-dept") {
      ui.manageDept = target.value;
      render();
      document.getElementById(target.id)?.focus();
      event.stopImmediatePropagation();
      return;
    }
    if (target.id === "screen-catalog") {
      if (target.value === "S-07") {
        ui.channelId = "general";
        proceedTo("S05");
        openThread("channel", 0);
        return;
      }
      proceedTo(target.value.replace("S-", "S"));
      event.stopImmediatePropagation();
    }
    if (target.id === "staff-department") {
      ui.staffFilter = target.value;
      render();
    }
    if (target.id === "staff-location") {
      ui.staffLocFilter = target.value;
      render();
      document.getElementById("staff-location")?.focus();
    }
    if (target.id === "account-department") {
      ui.accountFilter = target.value;
      render();
    }
  },
  true,
);
document.querySelector("#drawer").addEventListener("click", (event) => {
  if (event.target.id === "drawer") closeDrawer();
});
document
  .querySelector("#drawer")
  .addEventListener("close", () => ui.drawerReturn?.focus());

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (form.id === "global-search") {
      event.preventDefault();
      event.stopImmediatePropagation();
      ui.search = String(new FormData(form).get("query") || "").trim();
      proceedTo("S15");
      return;
    }
    // name="id" の入力欄があると form.id が要素に置き換わるため、属性で読む。
    if (
      form.getAttribute("id") === "modal-form" &&
      [
        "delegate-status",
        "channel-reauth",
        "channel-reject",
        "case-add",
        "rename-folder",
        "demo-only",
      ].includes(form.dataset.submit)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const data = new FormData(form),
        action = form.dataset.submit;
      if (action === "delegate-status") {
        const person = employees.find(
          (value) => value.id === data.get("person"),
        );
        if (
          !person ||
          !(
            adminOnly() ||
            (currentUser().role === "owner" &&
              currentUser().department === person.department)
          )
        )
          return refuse();
        person.status = String(data.get("delegated-status"));
        auditLog("ステータスの代理設定", person.name, `${person.name} のステータスを代理設定`);
        closeModal();
        render();
        return notify("ステータスを代理設定しました。");
      }
      if (action === "channel-reauth") {
        if (!String(data.get("reauth-password") || ""))
          return modalError("パスワードを入力してください。");
        const decision = ui.pendingChannelDecision;
        const request = prototypeData.channelRequests.find(
          (value) => value.id === decision?.id,
        );
        if (!canReviewChannelRequest(request)) return refuse();
        closeModal();
        if (decision.result === "reject")
          return showModal(
            "チャンネル申請を却下",
            `<p># ${e(request.name)} を却下します。</p><div class="form-field"><label for="channel-reason">却下理由（必須。1〜200文字）</label><textarea id="channel-reason" name="reason" required data-min="1" data-max="200" data-name="却下理由"></textarea></div><input type="hidden" name="id" value="${e(request.id)}">`,
            "channel-reject",
            "却下する",
          );
        request.status = "approved";
        prototypeData.channels.push({
          id: `ch-${Date.now()}`,
          name: request.name,
          dept: request.dept,
          folder: prototypeData.folders[request.dept]?.[0] || "共通連絡",
          private: request.private,
          members: [request.by],
          messages: [],
        });
        auditLog("チャンネル作成の承認", `#${request.name}`, `#${request.name} の作成を承認`);
        render();
        return notify("承認しました。チャンネルが使えるようになりました。");
      }
      if (action === "channel-reject") {
        const request = prototypeData.channelRequests.find(
          (value) => value.id === data.get("id"),
        );
        if (!canReviewChannelRequest(request)) return refuse();
        request.status = "rejected";
        request.reason = String(data.get("reason") || "").trim();
        auditLog("チャンネル作成の却下", `#${request.name}`, `#${request.name} の作成を却下（理由: ${request.reason}）`);
        closeModal();
        render();
        return notify("申請を却下しました。");
      }
      if (action === "case-add") {
        const item = getCase(data.get("id")),
          member = String(data.get("case-new-member") || "");
        if (
          !item ||
          item.status !== "active" ||
          !isMember(item) ||
          item.members.includes(member)
        )
          return refuse();
        if (!employees.some((person) => person.id === member && person.active))
          return modalError("有効な社員を選んでください。");
        item.members.push(member);
        record(item, `${nameOf(member)} を参加者に追加`);
        closeModal();
        render();
        return notify("参加者を追加しました。");
      }
      if (action === "rename-folder") {
        const target = folderTargetNow();
        if (!target) return refuse();
        const before = String(data.get("before") || ""),
          after = String(data.get("folder-rename") || "").trim();
        const folders = prototypeData.folders[target] || [];
        if (!after || !folders.includes(before))
          return modalError("フォルダ名を入力してください。");
        // 前後の空白を除き、大文字・小文字を区別せず、同じ部署内の重複を認めない（2-7 AC-9、C-73）。
        if (
          folders.some(
            (name) =>
              name !== before && normalizeName(name) === normalizeName(after),
          )
        )
          return modalError(
            "同じ名前の共通フォルダがすでにあります（大文字・小文字の違いは区別しません）。",
          );
        folders[folders.indexOf(before)] = after;
        prototypeData.channels
          .filter(
            (channel) =>
              channel.dept === target &&
              channel.folder === before,
          )
          .forEach((channel) => (channel.folder = after));
        closeModal();
        render();
        return notify("共通フォルダの名前を変更しました。");
      }
      closeModal();
      return notify("画面の見本を確認しました。");
    }
    if (!form.dataset.protoForm) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const kind = form.dataset.protoForm,
      data = new FormData(form);
    if (kind === "login") {
      return proceedTo("S01");
    }
    if (kind === "first-password" || kind === "change-password") {
      if (
        data.get(kind === "first-password" ? "first-new" : "password-new") !==
        data.get(
          kind === "first-password" ? "first-confirm" : "password-confirm",
        )
      )
        return notify("確認用パスワードが一致しません。");
      proceedTo(kind === "first-password" ? "S01" : "S19");
      return notify("変更の画面を確認しました。入力値は保存していません。");
    }
    if (kind === "chat") {
      const text = String(data.get("text") || "").trim();
      if (!text) return notify("メッセージを入力してください。");
      if (form.dataset.kind === "channel") {
        const channel = activeChannel();
        if (!isChannelMember(channel)) return refuse("参加すると使えます。");
        if (channel.readOnly) return refuse("この部署は無効化されたため、読み取り専用です。");
        if (!canPostChannel(channel))
          return refuse(
            `このチャンネルに投稿できるのは、${channel.dept}のオーナーと全体管理者だけです。`,
          );
        channel.messages.push({
          by: state.userId,
          text,
          at: stamp(),
          replies: [],
        });
        removeDraft(form.querySelector("[data-draft-key]")?.dataset.draftKey);
      } else {
        if (
          !ui.dmUserId ||
          !employees.some(
            (person) => person.id === ui.dmUserId && person.active,
          )
        )
          return refuse();
        (prototypeData.dm[dmKey(state.userId, ui.dmUserId)] ||= []).push({
          by: state.userId,
          text,
          at: stamp(),
          replies: [],
        });
        removeDraft(form.querySelector("[data-draft-key]")?.dataset.draftKey);
      }
      render();
      return notify("メッセージを表示しました。");
    }
    if (kind === "reply") {
      if (!threadCanWrite(ui.thread))
        return refuse("この返信を投稿できません。");
      const text = String(data.get("text") || "").trim();
      if (!text) return notify("返信を入力してください。");
      const thread = ui.thread;
      // 返信の相手には未読の印が付く。元の投稿者・これまでの返信者・メンションされた人が対象（C-91）。
      const recipients = [
        ...new Set([
          thread.message.by,
          ...(thread.message.mentions || []),
          ...(thread.message.replies || []).map((reply) => reply.by),
        ]),
      ].filter((id) => id !== state.userId);
      (thread.message.replies ||= []).push({
        by: state.userId,
        text,
        at: stamp(),
        ts: Date.now(),
        unreadFor: recipients,
      });
      removeDraft(form.querySelector("[data-draft-key]")?.dataset.draftKey);
      renderShell();
      return notify("返信を表示しました。");
    }
    if (kind === "search") {
      ui.search = String(data.get("term") || "").trim();
      return render();
    }
    if (kind === "profile") {
      const name = String(data.get("display-name") || "").trim();
      if (!name) return notify("表示名を入力してください。");
      currentUser().name = name;
      currentUser().status = String(data.get("status"));
      currentUser().message = String(data.get("status-message") || "");
      render();
      return notify("プロフィールを保存しました。");
    }
    if (kind === "channel-request") {
      // チャンネル名は保存時に自動整形する（C-121【案】）。長さ・使用可能文字・重複は整形後の値で判定する。
      const rawName = String(data.get("channel-name") || "");
      const name = normalizeInput(rawName);
      if (!name)
        return fieldError("channel-name", "チャンネル名を入力してください。");
      if ([...name].length > 50)
        return fieldError("channel-name", "チャンネル名は1〜50文字で入力してください（整形後の文字数）。");
      if (!channelNameCharsOk(name))
        return fieldError(
          "channel-name",
          "使えない文字が含まれています（使えるのは、日本語・英数字・ハイフン・アンダースコア）。",
        );
      // 作る場所は自部署か会社直属だけ（他部署は不可）。名前は会社内で一意。大文字・小文字は区別せず、
      // 承認待ちの申請の名前も対象にする（C-105、2-2 AC-13）。却下された申請の名前は数えない。
      const dept =
        data.get("place") === "company" ? COMPANY : currentUser().department;
      const taken =
        prototypeData.channels.some(
          (channel) => compareKey(channel.name) === compareKey(name),
        ) ||
        prototypeData.channelRequests.some(
          (request) =>
            request.status === "pending" &&
            compareKey(request.name) === compareKey(name),
        );
      if (taken)
        return fieldError(
          "channel-name",
          "同じ名前のチャンネル（または承認待ちの申請）が会社内にあります（大文字・小文字の違いは区別しません）。",
        );
      prototypeData.channelRequests.push({
        id: `CH-${Date.now()}`,
        name,
        dept,
        by: state.userId,
        private: data.get("visibility") === "private",
        status: "pending",
        reason: "",
      });
      render();
      return notify(`チャンネルの作成を申請しました。${rawName.trim() !== name ? "表記を整えて保存しました（案）。" : ""}`);
    }
    if (kind === "case-request") {
      // 件名は保存時に自動整形する（C-121【案】）。長さは整形後の文字数で検査する。
      const titleRaw = String(data.get("case-title") || ""),
        title = normalizeInput(titleRaw),
        department = String(data.get("case-department") || ""),
        clientCode = String(data.get("case-client") || ""),
        due = String(data.get("case-due") || ""),
        description = String(data.get("case-description") || "").trim();
      // 入力の検査は実行する関数（createCaseRequest）と共通の caseRequestProblem で行う。
      const problem = caseRequestProblem({ title, department, clientCode, due, description });
      if (problem) return notify(problem);
      const previous = state.reapplySource
        ? getRequest(state.reapplySource)
        : null;
      if (
        previous &&
        (previous.applicant !== state.userId ||
          !["rejected", "withdrawn"].includes(previous.status))
      )
        return refuse();
      // 保存・再検査には整形前の件名を渡し、整形は検査の中（cleanCaseRequest）で一度だけ行う。
      const values = {
        title: titleRaw,
        clientCode,
        due,
        description,
        department,
        candidates: data.getAll("candidates").map(String),
        previous: previous?.id || null,
        draftKey: form.querySelector("[data-draft-key]")?.dataset.draftKey,
      };
      // 同じ取引先に似た件名の案件があれば、申請の前に警告する（C-121(3)【案】）。警告だけで止めない。
      const similar = similarCases(clientCode, title);
      if (similar.length) return openSimilarWarning(values, similar);
      return createCaseRequest(values);
    }
    if (kind === "folder") {
      const target = folderTargetNow();
      if (!target) return refuse();
      const name = String(data.get("name") || "").trim(),
        folders = (prototypeData.folders[target] ||= []);
      if (!name) return fieldError("folder-name", "フォルダ名を入力してください。");
      if (folders.some((value) => normalizeName(value) === normalizeName(name)))
        return fieldError(
          "folder-name",
          "同じ名前の共通フォルダがすでにあります（大文字・小文字の違いは区別しません）。",
        );
      folders.push(name);
      render();
      return notify("共通フォルダを作成しました。");
    }
    if (kind === "department") return submitDepartmentForm(data);
    if (kind === "setup") return submitSetupForm(data);
    if (kind === "invite") return submitInviteForm(data);
    if (kind === "account-register")
      return notify("入力画面の見本です。登録結果は再現していません。");
  },
  true,
);
