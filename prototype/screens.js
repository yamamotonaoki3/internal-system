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
  ["S38", "アーカイブ"],
  ["S39", "チャンネル管理"],
  ["S40", "案件管理"],
];
// 会社のワークスペースは1つ（C-93）。チャンネルの置き場は「部署」か「会社直属」のどちらか。
// dept が COMPANY のチャンネルは会社直属（全部署に属さない）。部署の専用チャンネルは、部署名と同じ名前の公開チャンネル（C-95）。
const COMPANY = "会社直属";
const prototypeData = {
  channels: [
    {
      id: "general",
      name: "全社連絡",
      description: "全社員向けの連絡用チャンネルです（架空）。",
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
      description: "営業部の専用チャンネルです（架空）。",
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
      description: "ランチの相談用です（架空）。",
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
        // 書式の見本（C-128。架空）。画像記法・表・タスクリスト・脚注・HTML・許可しない形式のリンクは、描画せず原文の文字のまま出る。
        {
          mid: "m-lunch-md",
          by: "u3",
          text: "**太字**・*斜体*・~~取り消し線~~ の見本です。\n- 箇条書き1\n- 箇条書き2\n> 引用の見本です\n`インラインコード` と、コードブロック：\n```\nconst a = \"<b>x</b> **そのまま**\";\n```\nリンク：[例](https://example.com/)　自動リンク：https://example.com/a?b=1&c=2\n画像記法：![画像](https://example.com/a.png)\n| 表 | 見出し |\n- [ ] タスク\n脚注の参照[^1]\n<script>alert(1)</script> &lt;b&gt;\n[危険なリンク](javascript:alert(1))　@testuser_001",
          at: "12:40",
          replies: [],
        },
      ],
    },
    {
      id: "planning",
      name: "企画共有",
      description: "企画案の共有用です（架空）。",
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
  // 送信前の添付の一覧（C-126）。送る場所の鍵（channel:{id}・dm:{相手のID}・case:{id}）ごとの { name, size, type, scope? } の配列。
  // ファイルの中身は読まず・送らず・保存しない。再読み込みで消える。
  pendingAttachments: {},
  // 取引先の一覧（S-36）の検索語と状態の絞り込み（all・active・inactive）。再読み込みで初期化される。
  clientQuery: "",
  clientState: "all",
  // S-39・S-40 の検索語と状態の絞り込み。再読み込みで初期化される。
  chAdmQuery: "",
  chAdmState: "all",
  caAdmQuery: "",
  caAdmState: "all",
};
// 部署のデータから作る。会社直属は部署ではなく、案件の担当部署にもしない（C-98）。
// 無効にした部署（C-103）は、重複の判定（allDepartmentNames）には残し、選択肢（departmentNames）からは外す。
prototypeData.disabledDepartments = [];
// 物理削除したチャンネル・案件のID。過去の通知・整理スペースで「削除されました」を出すために残す（案件番号は state.purgedCaseNos に残し、再利用しない）。
prototypeData.purged = [];
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
// アーカイブしたチャンネルは、誰も開けない（Q-70の案）。
const canReadChannel = (channel) =>
  !!channel && !channel.deletedAt && (!channel.private || isChannelMember(channel));
// アーカイブ（旧：論理削除。C-123・C-124）。案件の status の "archived" は「終了」で、deletedAt を持つものが「アーカイブ」。取り違えないこと。
const chArchived = (channel) => !!channel?.deletedAt;
const caseArchived = (item) => !!item?.deletedAt;
// チャンネルの種類。全社連絡・部署の専用・お知らせ専用は、名前の変更もアーカイブもできない（C-124(11)）。
const channelKind = (channel) =>
  channel.id === "general"
    ? "general"
    : channel.announce
      ? "announce"
      : channel.dept !== COMPANY && channel.name === channel.dept
        ? "dedicated"
        : "normal";
const CHANNEL_KIND_LABEL = {
  general: "全社連絡",
  announce: "お知らせ専用チャンネル",
  dedicated: "部署の専用チャンネル",
  normal: "通常のチャンネル",
};
const ownsDept = (dept) => currentUser().role === "owner" && currentUser().department === dept;
// 通常のチャンネルは、全体管理者（全部）と、自部署のオーナー（自部署のもの。会社直属・他部署は不可）が管理できる。
const channelManager = (channel) => adminOnly() || ownsDept(channel.dept);
const canRenameChannel = (channel) => !chArchived(channel) && channelKind(channel) === "normal" && channelManager(channel);
const canArchiveChannel = canRenameChannel;
// 説明は、専用・お知らせ専用も自部署のオーナーと全体管理者が変えられる。全社連絡は全体管理者だけ（C-124(11)）。
const canDescribeChannel = (channel) =>
  !chArchived(channel) && (channelKind(channel) === "general" ? adminOnly() : channelManager(channel));
// 復元できるのは、全体管理者と、自部署のチャンネルのオーナー（誰がアーカイブしたものでも。C-132(2)。#95 のQ-73の案を置き換え）。
const canRestoreChannel = (channel) =>
  chArchived(channel) && (adminOnly() || ownsDept(channel.dept));
// 物理削除は全体管理者だけで、アーカイブした後だけ（C-123）。
const canPurge = (target) => adminOnly() && !!target?.deletedAt;
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
  renderHeaderStatus();
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
        // チャンネル管理（S-39）・案件管理（S-40）は、全体管理者とオーナー向け。置き場所は案（Q-105）。
        ...(adminOnly() || currentUser().role === "owner"
          ? [
              ["S39", "チャンネル管理"],
              ["S40", "案件管理"],
            ]
          : []),
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
  // 「アーカイブ」は管理の外の、独立した項目（C-123）。全体管理者とオーナーに出す。色は案。
  const archiveBlock =
    adminOnly() || currentUser().role === "owner"
      ? '<div class="side-section side-archive-block"><button type="button" class="side-link side-archive" data-ui="go" data-page="S38">▤ アーカイブ（案）</button></div>'
      : "";
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
    .filter((item) => isMember(item) && !caseArchived(item))
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
  return `<div class="side-content">${channelBlock}${section("dm", "ダイレクトメッセージ", dmBody)}<div class="side-section"><strong>スレッド</strong><button type="button" class="side-link" data-ui="go" data-page="S35">スレッド一覧${unreadThreads ? `<span class="unread-mark">● 未読 ${unreadThreads}件</span>` : ""}</button></div>${section("case", "案件", caseBody)}${section("org", "整理スペース", orgBody)}<div class="side-section"><strong>共通</strong><button type="button" class="side-link" data-ui="go" data-page="S20">社員一覧</button></div>${archiveBlock}${manageBlock}${saveNote}</div>`;
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
  if (["S38", "S39", "S40"].includes(page) && !(currentUser().role === "owner" || adminOnly())) return showNoPermission();
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
    S38: archiveScreen,
    S39: channelAdminScreen,
    S40: caseAdminScreen,
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
/* ---------- 書式（マークダウンの最小実装。C-128(1)。外部ライブラリなし）---------- */
// 元の文字列（エスケープ前）を先に解析し、トークンにしてから組み立てる。生成した HTML を再び解析しない。
// 組み立てでは、タグは固定、中身はすべて e()（escapeHtml）を通す。URL は元の値で http・https・mailto だけを許可し、属性に出すときにエスケープする。
// 対応：太字（**）・斜体（* と _）・取り消し線（~~ だけ）・インラインコード・コードブロック・引用・箇条書き・リンク・URL の自動リンク。メンションは強調表示だけ。
// 描画しない（原文の文字のまま出す。見せ方は未決定で案。Q-79）：画像記法・表・タスクリスト・脚注・許可しない形式のリンク・HTML。
const MD_PROTOCOLS = ["http:", "https:", "mailto:"];
function mdSafeUrl(url) {
  if (typeof url !== "string" || !url || /[\s\u0000-\u001f]/.test(url)) return false;
  // 解析できない値は、リンクにしない（検査の結果であり、エラーの握りつぶしではない）。古いブラウザで canParse がないときも、リンクにしない。
  if (typeof URL.canParse !== "function" || !URL.canParse(url)) return false;
  return MD_PROTOCOLS.includes(new URL(url).protocol);
}
const mdWordChar = (ch) => !!ch && /[A-Za-z0-9_぀-ヿ一-鿿]/.test(ch);
function mdTokens(src, depth) {
  const out = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  const names = employees.map((person) => `@${person.name}`).sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // 画像記法は、範囲全体を原文の文字にする（描画しない。Q-79の案）。
    if (ch === "!" && src[i + 1] === "[") {
      const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest);
      if (image) {
        buf += image[0];
        i += image[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const link = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
      if (link) {
        if (mdSafeUrl(link[2])) {
          flush();
          out.push({ t: "link", v: link[1] || link[2], href: link[2] });
        } else buf += link[0];
        i += link[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "m" || ch === "H" || ch === "M") && !mdWordChar(src[i - 1])) {
      const auto = /^(?:https?:\/\/|mailto:)[^\s<>"'`]+/i.exec(rest);
      if (auto) {
        const url = auto[0].replace(/[.,;:!?)）」』、。]+$/, "");
        if (mdSafeUrl(url)) {
          flush();
          out.push({ t: "link", v: url, href: url });
          i += url.length;
          continue;
        }
      }
    }
    if (ch === "@") {
      const name = names.find((value) => rest.startsWith(value));
      if (name) {
        flush();
        out.push({ t: "mention", v: name });
        i += name.length;
        continue;
      }
    }
    let matched = false;
    for (const [mark, type] of [["**", "strong"], ["~~", "del"]]) {
      if (!rest.startsWith(mark)) continue;
      const end = src.indexOf(mark, i + 2);
      const inner = end > i + 2 ? src.slice(i + 2, end) : "";
      if (!inner.trim()) continue;
      flush();
      out.push({ t: type, c: depth < 2 ? mdTokens(inner, depth + 1) : [{ t: "text", v: inner }] });
      i = end + 2;
      matched = true;
      break;
    }
    if (matched) continue;
    if (ch === "*" && src[i + 1] !== "*") {
      const end = src.indexOf("*", i + 1);
      const inner = end > i + 1 && src[end + 1] !== "*" ? src.slice(i + 1, end) : "";
      if (inner && inner.trim() === inner) {
        flush();
        out.push({ t: "em", c: depth < 2 ? mdTokens(inner, depth + 1) : [{ t: "text", v: inner }] });
        i = end + 1;
        continue;
      }
    }
    if (ch === "_" && !mdWordChar(src[i - 1])) {
      const end = src.indexOf("_", i + 1);
      const inner = end > i + 1 && !mdWordChar(src[end + 1]) ? src.slice(i + 1, end) : "";
      if (inner && inner.trim() === inner) {
        flush();
        out.push({ t: "em", c: depth < 2 ? mdTokens(inner, depth + 1) : [{ t: "text", v: inner }] });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}
function mdHtml(tokens) {
  return tokens
    .map((token) => {
      if (token.t === "code") return `<code>${e(token.v)}</code>`;
      if (token.t === "strong") return `<strong>${mdHtml(token.c)}</strong>`;
      if (token.t === "em") return `<em>${mdHtml(token.c)}</em>`;
      if (token.t === "del") return `<del>${mdHtml(token.c)}</del>`;
      if (token.t === "mention") return `<span class="mention">${e(token.v)}</span>`;
      if (token.t === "link") return `<a href="${e(token.href)}" target="_blank" rel="noopener noreferrer">${e(token.v)}</a>`;
      return e(token.v);
    })
    .join("");
}
// 本文を、ブロック（コードブロック・引用・箇条書き・段落）に分けて組み立てる。文字列だけを返す（描画は呼び出し側）。
function renderMarkdown(text) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  // 表・脚注の定義・タスクリストの行は、整形せず原文の文字のまま出す。
  const raw = (line) => /^\s*\|/.test(line) || /^\s*\[\^[^\]]+\]:/.test(line) || /^\s*[-*]\s+\[[ xX]\]/.test(line);
  const item = (line) => /^\s*[-*]\s+/.test(line) && !raw(line);
  const fence = (line) => /^\s*```/.test(line);
  const quote = (line) => /^\s*>/.test(line);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
    } else if (fence(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !fence(lines[i])) code.push(lines[i++]);
      i += 1;
      blocks.push(`<pre><code>${e(code.join("\n"))}</code></pre>`);
    } else if (quote(line)) {
      const group = [];
      while (i < lines.length && quote(lines[i])) group.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(`<blockquote>${group.map((value) => mdHtml(mdTokens(value, 0))).join("<br>")}</blockquote>`);
    } else if (item(line)) {
      const group = [];
      while (i < lines.length && item(lines[i])) group.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push(`<ul>${group.map((value) => `<li>${mdHtml(mdTokens(value, 0))}</li>`).join("")}</ul>`);
    } else {
      const group = [];
      while (i < lines.length && lines[i].trim() && !fence(lines[i]) && !quote(lines[i]) && !item(lines[i])) group.push(lines[i++]);
      blocks.push(`<p>${group.map((value) => (raw(value) ? e(value) : mdHtml(mdTokens(value, 0)))).join("<br>")}</p>`);
    }
  }
  return `<div class="message-text">${blocks.join("")}</div>`;
}

/* ---------- 絵文字・スタンプ・リアクション（C-128(2)(3)。外部ライブラリなし）---------- */
// 絵文字は端末の絵文字をそのまま表示する（native 表示）固定の見本の一覧。読みは日本語の検索の見せ方の見本（ひらがな・カタカナの違いは吸収する。
// 表記ゆれ・別の漢字・読みの網羅は足りない。ひらがな検索の取りこぼしは案で、本番の部品の検証で確かめる）。
const REACTION_EMOJI = [
  ["thumbsup", "👍", "いいね", "いいね good ok りょうかい"],
  ["clap", "👏", "拍手", "はくしゅ すごい"],
  ["pray", "🙏", "お願い・感謝", "おねがい ありがとう"],
  ["tada", "🎉", "お祝い", "おいわい おめでとう"],
  ["grin", "😀", "笑顔", "えがお にこにこ"],
  ["joy", "😂", "大笑い", "おおわらい ばくしょう"],
  ["smile", "😊", "にっこり", "にっこり ほほえみ"],
  ["heart_eyes", "😍", "大好き", "だいすき"],
  ["thinking", "🤔", "考え中", "かんがえちゅう うーん"],
  ["cry", "😢", "悲しい", "かなしい なみだ"],
  ["wow", "😮", "驚き", "おどろき びっくり"],
  ["sweat", "😅", "苦笑い", "にがわらい あせ"],
  ["eyes", "👀", "見ています", "みています ちぇっく"],
  ["muscle", "💪", "がんばる", "がんばる ちから"],
  ["check", "✅", "完了", "かんりょう ちぇっく"],
  ["cross", "❌", "ばつ", "ばつ だめ"],
  ["star", "⭐", "星", "ほし すたー"],
  ["heart", "❤️", "ハート", "はーと あい"],
  ["fire", "🔥", "炎", "ほのお もえる"],
  ["rocket", "🚀", "ロケット", "ろけっと はっしゃ"],
  ["bulb", "💡", "アイデア", "あいであ ひらめき"],
  ["memo", "📝", "メモ", "めも きろく"],
  ["onigiri", "🍙", "おにぎり", "おにぎり ごはん"],
  ["ramen", "🍜", "ラーメン", "らーめん めん"],
  ["coffee", "☕", "コーヒー", "こーひー きゅうけい"],
  ["cat", "🐱", "猫", "ねこ ねこちゃん cat"],
  ["dog", "🐶", "犬", "いぬ いぬちゃん dog"],
  ["sakura", "🌸", "桜", "さくら はな"],
  ["sun", "☀️", "晴れ", "はれ たいよう"],
  ["bow", "🙇", "お辞儀", "おじぎ すみません もうしわけ"],
];
// スタンプは画像だけ。この試作では仮の画像（インラインの SVG。固定の文字列で、ファイルは足さない）。素材の出どころ・件数は未決定。
const STAMPS = [
  ["ok", "了解", "#0b6b5f"],
  ["thanks", "ありがとう", "#7a3e00"],
  ["good", "いいね", "#2b4f9e"],
  ["tired", "お疲れさま", "#5a2f77"],
  ["confirm", "確認します", "#1f5f73"],
  ["wow", "すごい", "#8a2b2b"],
];
const stampSvg = (stamp, size = 1) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 40" width="${Math.round(72 * size)}" height="${Math.round(30 * size)}" role="img" aria-label="スタンプ：${e(stamp[1])}（仮の画像）"><rect width="96" height="40" rx="8" fill="${e(stamp[2])}"/><text x="48" y="25" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff" font-family="sans-serif">${e(stamp[1])}</text></svg>`;
// 鍵は、固定の一覧から作った正規の鍵と完全に一致するものだけを許す（末尾に余分な文字がある鍵は拒否する）。
// 検査のあとは、返した key（正規の鍵）を、重複の判定・保存・表示のすべてに使う。
const reactionInfo = (key) => {
  if (typeof key !== "string") return null;
  const emoji = REACTION_EMOJI.find((entry) => `emoji:${entry[0]}` === key);
  if (emoji) return { key, kind: "emoji", label: emoji[2], html: e(emoji[1]), glyph: emoji[1] };
  const stamp = STAMPS.find((entry) => `stamp:${entry[0]}` === key);
  if (stamp) return { key, kind: "stamp", label: `スタンプ：${stamp[1]}（仮の画像）`, html: stampSvg(stamp, 0.6) };
  return null;
};
// 1つのメッセージに付けられるリアクションの種類は20種類まで。同じ人の同じリアクションは1回だけ（C-90）。
const REACTION_MAX_KINDS = 20;
// リアクションを付ける・取り消す実行する関数（コンソールから呼べる）。target は postMessage と同じ形（返信は対象外）。
// mid は、その部屋の親メッセージの ID（配列の位置は使わない）。key は固定の一覧の鍵（emoji:thumbsup・stamp:ok など）。
// 現在の画面（activeChannel・state.selectedId・ui.dmUserId）に依存せず、実行のたびに対象・権限・状態を検査する。
function toggleReaction(target, mid, key) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return refuse("リアクションの対象が正しくありません。");
  target = { source: target.source, id: target.id, userId: target.userId };
  if (typeof mid !== "string" || !mid) return refuse("元の投稿が見つかりません。");
  const info = reactionInfo(key);
  if (!info) return refuse("使えないリアクションです。");
  const reactionKey = info.key;
  let list;
  if (target.source === "channel") {
    if (typeof target.id !== "string") return refuse("リアクションの対象が正しくありません。");
    const channel = prototypeData.channels.find((value) => value.id === target.id);
    if (!channel) return refuse("チャンネルが見つかりません。");
    if (chArchived(channel)) return refuse(ARCHIVED_MESSAGE);
    if (!canReadChannel(channel)) return refuse();
    if (!isChannelMember(channel)) return refuse("参加すると使えます。");
    if (channel.readOnly) return refuse("この部署は無効化されたため、読み取り専用です。");
    list = channel.messages;
  } else if (target.source === "dm") {
    if (typeof target.userId !== "string") return refuse("リアクションの対象が正しくありません。");
    const partner = employees.find((person) => person.id === target.userId);
    if (!partner || !partner.active || partner.id === state.userId) return refuse("相手が見つかりません。");
    list = prototypeData.dm[dmKey(state.userId, partner.id)] || [];
  } else if (target.source === "case") {
    if (typeof target.id !== "string") return refuse("リアクションの対象が正しくありません。");
    const item = getCase(target.id);
    if (!item) return refuse("案件が見つかりません。");
    if (caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
    if (item.status !== "active") return refuse("終了した案件では、リアクションを使えません。");
    if (!isMember(item)) return refuse();
    list = item.messages;
  } else return refuse("リアクションの対象が正しくありません。");
  // 親投稿は、すでに付いている mid で探す（拒否のときにデータを変えない）。
  const message = list.find((value) => value.mid === mid);
  if (!message) return refuse("元の投稿が見つかりません。");
  if (message.deleted) return refuse("この投稿はすでに削除されています。");
  const reactions = message.reactions || [];
  const found = reactions.find((value) => value.key === reactionKey);
  if (found?.users.includes(state.userId)) {
    found.users = found.users.filter((id) => id !== state.userId);
    message.reactions = reactions.filter((value) => value.users.length);
    return true;
  }
  if (!found && reactions.length >= REACTION_MAX_KINDS)
    return refuse(`リアクションの種類は${REACTION_MAX_KINDS}種類までです。`);
  if (found) found.users.push(state.userId);
  else (message.reactions ||= []).push({ key: reactionKey, users: [state.userId] });
  return true;
}
// メッセージの下のリアクションの表示。数と付けた人が分かり（title・aria-label）、押すと付ける・取り消す。既存の「👍」の入口は emoji:thumbsup に結び付ける。
function reactionBarHtml(message, source, roomId, mode) {
  const thumbs = (message.reactions || []).find((value) => value.key === "emoji:thumbsup");
  const others = (message.reactions || []).filter((value) => value.key !== "emoji:thumbsup");
  const mine = (reaction) => !!reaction?.users.includes(state.userId);
  const people = (reaction) => (reaction?.users.length ? reaction.users.map(nameOf).join("、") : "まだいません");
  const attrs = (key) => `data-ui="reaction" data-source="${e(source)}" data-room="${e(roomId)}" data-mid="${e(midOf(message))}" data-key="${e(key)}"`;
  const locked = mode === "readonly" ? "読み取り専用" : mode === "notJoined" ? "参加すると使えます" : "";
  const button = (key, reaction, labelHtml, label) =>
    `<button type="button" ${locked ? "disabled" : attrs(key)} aria-pressed="${mine(reaction)}" title="${e(label)}: ${e(people(reaction))}" aria-label="${e(label)} ${reaction?.users.length || 0}人（${e(people(reaction))}）${locked ? `。${locked}` : mine(reaction) ? "。押すと取り消します" : ""}">${labelHtml} ${reaction?.users.length || 0}</button>`;
  return (
    button("emoji:thumbsup", thumbs, "👍", "いいね") +
    others.map((reaction) => button(reaction.key, reaction, reactionInfo(reaction.key)?.html || "", reactionInfo(reaction.key)?.label || "")).join("") +
    (locked
      ? `<span class="subtle">${locked}</span>`
      : `<button type="button" data-ui="picker-open" data-mode="message" data-source="${e(source)}" data-room="${e(roomId)}" data-mid="${e(midOf(message))}" aria-haspopup="dialog">＋ リアクション</button>`)
  );
}
// 選択画面（同じ枠の中のタブ「絵文字」「スタンプ」）。開くときに対象（target・mid）を ui.pickerFor に保持し、押したときにその対象で toggleReaction を呼ぶ。
// 画面を移動したら閉じる。入力欄の「😀」から開いたときは、絵文字を入力欄のカーソル位置に挿入し、スタンプはリアクションとして付ける案内だけを出す（Q-80の案）。
ui.pickerFor = null;
ui.picker = null;
const pickerEl = document.createElement("div");
pickerEl.id = "emoji-picker";
pickerEl.className = "emoji-picker";
pickerEl.hidden = true;
pickerEl.setAttribute("role", "dialog");
pickerEl.setAttribute("aria-label", "絵文字とスタンプ");
document.body.append(pickerEl);
const kanaToHira = (value) => value.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)).toLowerCase();
function pickerGridHtml() {
  const picker = ui.picker;
  if (picker.tab === "stamp") {
    if (picker.mode === "composer")
      return '<p class="form-hint" role="status">スタンプはメッセージへのリアクションとして付けます（案）。メッセージの「＋ リアクション」から選んでください。</p>';
    return `<div class="picker-grid stamps">${STAMPS.map((stamp) => `<button type="button" class="picker-item" data-ui="picker-pick" data-key="stamp:${e(stamp[0])}" aria-label="スタンプ：${e(stamp[1])}（仮の画像）">${stampSvg(stamp, 0.8)}</button>`).join("")}</div>`;
  }
  const term = kanaToHira(picker.query || "").trim();
  const shown = REACTION_EMOJI.filter((entry) => !term || kanaToHira(`${entry[2]} ${entry[3]}`).includes(term));
  if (!shown.length) return '<p class="form-hint" role="status">該当する絵文字はありません（検索の見せ方は案。読みの取りこぼしがあります）。</p>';
  return `<div class="picker-grid">${shown.map((entry) => `<button type="button" class="picker-item" data-ui="picker-pick" data-key="emoji:${e(entry[0])}" aria-label="${e(entry[2])}" title="${e(entry[2])}">${e(entry[1])}</button>`).join("")}</div>`;
}
function renderPicker() {
  const picker = ui.picker;
  const tab = (id, label) =>
    `<button type="button" role="tab" id="picker-tab-${id}" data-ui="picker-tab" data-tab="${id}" aria-selected="${picker.tab === id}" aria-controls="picker-panel" tabindex="${picker.tab === id ? 0 : -1}">${label}</button>`;
  // nosemgrep: insecure-innerhtml, insecure-document-method 選択画面の描画。入れる文字列は、固定の一覧と e()（escapeHtml）を通した値だけで組み立てており、入力をそのまま入れない
  pickerEl.innerHTML = `<div class="picker-head"><div role="tablist" aria-label="絵文字とスタンプ">${tab("emoji", "絵文字")}${tab("stamp", "スタンプ")}</div><button type="button" data-ui="picker-close" aria-label="選択画面を閉じる">×</button></div><div id="picker-panel" role="tabpanel" aria-labelledby="picker-tab-${picker.tab}">${picker.tab === "emoji" ? `<div class="form-field"><label for="picker-search">絵文字を探す（日本語の名前・読み）</label><input id="picker-search" type="search" autocomplete="off" value="${e(picker.query || "")}"></div>` : ""}<div id="picker-body">${pickerGridHtml()}</div></div><p class="form-hint">端末の絵文字をそのまま表示します。スタンプは仮の画像です（素材は未決定）。</p>`;
  pickerEl.hidden = false;
}
function refreshPickerBody() {
  const body = document.querySelector("#picker-body");
  if (!body) return;
  // nosemgrep: insecure-innerhtml, insecure-document-method 選択画面の一覧の描画。入れる文字列は、固定の一覧と e()（escapeHtml）を通した値だけで組み立てており、入力をそのまま入れない
  body.innerHTML = pickerGridHtml();
}
function openPicker(element) {
  const mode = element.dataset.mode === "composer" ? "composer" : "message";
  const picker = { mode, tab: "emoji", query: "", openerSelector: "" };
  if (mode === "message") {
    const source = element.dataset.source;
    const roomId = element.dataset.room || "";
    ui.pickerFor = {
      target: source === "dm" ? { source, userId: roomId } : { source, id: roomId },
      mid: element.dataset.mid || "",
    };
    picker.openerSelector = `[data-ui="picker-open"][data-mid="${CSS.escape(ui.pickerFor.mid)}"]`;
  } else {
    ui.pickerFor = null;
    picker.textareaId = element.closest("form")?.querySelector("textarea")?.id || "";
    picker.openerSelector = '[data-ui="picker-open"][data-mode="composer"]';
  }
  ui.picker = picker;
  renderPicker();
  pickerEl.querySelector('[role="tab"][aria-selected="true"]')?.focus();
}
function closePicker(restoreFocus = false) {
  if (!ui.picker) return;
  const selector = ui.picker.openerSelector;
  ui.picker = null;
  ui.pickerFor = null;
  pickerEl.hidden = true;
  pickerEl.replaceChildren();
  if (restoreFocus) document.querySelector(selector)?.focus();
}
function pickerPick(key) {
  const picker = ui.picker;
  if (!picker) return;
  if (picker.mode === "message") {
    const ok = ui.pickerFor ? toggleReaction(ui.pickerFor.target, ui.pickerFor.mid, key) : false;
    closePicker(true);
    if (ok) render();
    return;
  }
  const info = reactionInfo(key);
  const area = document.getElementById(picker.textareaId);
  if (!info?.glyph || !area) return;
  area.setRangeText(info.glyph, area.selectionStart, area.selectionEnd, "end");
  area.dispatchEvent(new Event("input", { bubbles: true }));
  closePicker(false);
  area.focus();
}
pickerEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    return closePicker(true);
  }
  if (!ui.picker || !event.target.matches?.('[role="tab"]') || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  ui.picker.tab = ui.picker.tab === "emoji" ? "stamp" : "emoji";
  renderPicker();
  pickerEl.querySelector('[role="tab"][aria-selected="true"]')?.focus();
});
pickerEl.addEventListener("input", (event) => {
  if (event.target.id !== "picker-search" || !ui.picker) return;
  ui.picker.query = event.target.value;
  refreshPickerBody();
});
function messageRows(messages, source) {
  if (!messages.length)
    return '<div class="empty-screen"><h2>まだメッセージがありません</h2><p>最初の投稿をしましょう。</p></div>';
  const readonlyCase =
    source === "case" && (getCase(state.selectedId)?.status === "archived" || caseArchived(getCase(state.selectedId)));
  // 未参加の公開チャンネルでは本文は読めるが、リアクションは参加者だけが使える（C-94）。
  const notJoined = source === "channel" && !isChannelMember(activeChannel());
  const announce = source === "channel" && !!activeChannel()?.announce;
  const readOnlyChannel = source === "channel" && !!activeChannel()?.readOnly;
  const roomId = source === "channel" ? ui.channelId : source === "dm" ? ui.dmUserId : state.selectedId;
  return messages
    .map(
      (message, index) =>
        message.deleted
          ? announceDeletedRow(message, index)
          : `<article class="chat-message" data-mid="${e(midOf(message))}"><div class="message-avatar">${e(nameOf(message.by).slice(-2))}</div><div class="chat-body"><div class="chat-meta">${personButton(message.by)}<time>${e(message.at)}</time>${message.editedAt ? '<span class="subtle">（編集済み）</span>' : ""}</div>${renderMarkdown(message.text)}${announce ? announceMarks(activeChannel(), message) : ""}${attachmentList(message, source)}<div class="chat-tools">${readonlyCase ? (message.reactions?.length ? reactionBarHtml(message, source, roomId, "readonly") : "") : reactionBarHtml(message, source, roomId, readOnlyChannel ? "readonly" : notJoined ? "notJoined" : "")}<button type="button" data-ui="thread-open" data-source="${source}" data-index="${index}">返信 ${message.replies?.length || 0}件</button><button type="button" data-ui="org-add" data-kind="message" data-ref="${e(midOf(message))}" aria-label="${e(nameOf(message.by))}の${e(message.at)}のメッセージを整理スペースに登録">整理スペースに登録</button>${announce ? announceMenu(activeChannel(), message) : ""}</div></div></article>`,
    )
    .join("");
}
/* ---------- 添付の検査・送信前の一覧・投稿（C-126。画面上の検査と案内の再現。ファイルの中身は読まず、送らず、保存しない） ---------- */
const ATTACH_COUNT_MAX = 10;
// 単位はMB（10の6乗バイト）で統一する（C-126）。上限ちょうどは可（Q-78の案）。
const ATTACH_SIZE_MAX = { image: 10000000, document: 25000000, video: 100000000 };
// 1メッセージの合計容量。【案】（C-126）
const ATTACH_TOTAL_MAX = 200000000;
const ATTACH_KIND_LABEL = { image: "画像", document: "文書", video: "動画" };
// 拡張子 → [種類, 許す MIME]。本番は中身で判定する（Q-77）。試作は、拡張子とブラウザが付けた種類（空は可）で判定する見本。
// SVG・実行形式・圧縮ファイル（zip など）は表にないので拒否される。
const ATTACH_EXT = {
  jpg: ["image", ["image/jpeg"]],
  jpeg: ["image", ["image/jpeg"]],
  png: ["image", ["image/png"]],
  gif: ["image", ["image/gif"]],
  webp: ["image", ["image/webp"]],
  pdf: ["document", ["application/pdf"]],
  doc: ["document", ["application/msword"]],
  docx: ["document", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  xls: ["document", ["application/vnd.ms-excel"]],
  xlsx: ["document", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  ppt: ["document", ["application/vnd.ms-powerpoint"]],
  pptx: ["document", ["application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
  txt: ["document", ["text/plain"]],
  csv: ["document", ["text/csv", "application/vnd.ms-excel"]],
  mp4: ["video", ["video/mp4"]],
  webm: ["video", ["video/webm"]],
};
let attachSeq = 0;
const attachExtOf = (name) => {
  const dot = String(name).lastIndexOf(".");
  return dot < 0 ? "" : String(name).slice(dot + 1).toLowerCase();
};
const attachKindOf = (name) => {
  const ext = attachExtOf(name);
  return Object.hasOwn(ATTACH_EXT, ext) ? ATTACH_EXT[ext][0] : null;
};
const sizeText = (bytes) =>
  `${bytes >= 1000000 ? `${(bytes / 1000000).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1000))}KB`}（${bytes.toLocaleString("ja-JP")}バイト）`;
// 添付の検査と正規化（画面と実行する関数の両方から呼ぶ）。{ error } か { value: [{ id, name, size, kind, scope?, by }] } を返す。
// files は配列。各要素は { name, size, type, scope? }。size は有限の正の整数。scope は案件の添付（withScope）だけが持ち、
// "public"・"restricted" のどちらか（省略は参加者限定。C-64）。呼び出し側の id・by・kind は使わず、ここで振り直す。
function cleanAttachments(files, options = {}) {
  if (!Array.isArray(files)) return { error: "添付の内容が正しくありません。" };
  // 疎な配列・独自のイテレーターは拒否する。検査したコピーだけを使う。
  files = denseList(files);
  if (!files) return { error: "添付の内容が正しくありません。" };
  if (!options || typeof options !== "object" || Array.isArray(options)) return { error: "添付の内容が正しくありません。" };
  const withScope = options.withScope === true;
  if (files.length > ATTACH_COUNT_MAX)
    return { error: `添付は1メッセージ${ATTACH_COUNT_MAX}ファイルまでです（現在${files.length}ファイル）。` };
  let total = 0;
  const value = [];
  for (const original of files) {
    if (!original || typeof original !== "object" || Array.isArray(original)) return { error: "添付の内容が正しくありません。" };
    // getter・Proxy で検査のあとに値が変わっても影響しないように、各値を1度だけ読んでコピーし、そのコピーを検査・合計・保存のすべてに使う。
    const file = { name: original.name, type: original.type, size: original.size, scope: original.scope };
    if (typeof file.name !== "string" || !file.name.trim() || /[\u0000-\u001f\u007f]/.test(file.name) || file.name.length > 255)
      return { error: "添付のファイル名が正しくありません。" };
    const name = file.name.trim();
    if (typeof file.type !== "string") return { error: `「${name}」の種類が正しくありません。` };
    if (typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size <= 0)
      return { error: `「${name}」のサイズが正しくありません。` };
    const ext = attachExtOf(name);
    if (!Object.hasOwn(ATTACH_EXT, ext))
      return { error: `「${name}」は添付できない形式です（画像は JPEG・PNG・GIF・WebP、文書は PDF・Word・Excel・PowerPoint・テキスト・CSV、動画は MP4・WebM。SVG・実行形式・圧縮ファイルは不可）。` };
    const [kind, mimes] = ATTACH_EXT[ext];
    if (file.type !== "" && !mimes.includes(file.type.toLowerCase()))
      return { error: `「${name}」はファイルの種類が拡張子と合いません。` };
    if (file.size > ATTACH_SIZE_MAX[kind])
      return { error: `「${name}」は${ATTACH_KIND_LABEL[kind]}の上限（${ATTACH_SIZE_MAX[kind] / 1000000}MB）を超えています（${sizeText(file.size)}）。` };
    const item = { id: `att-${Date.now()}-${++attachSeq}`, name, size: file.size, kind, by: state.userId };
    if (withScope) {
      const scope = file.scope === undefined ? "restricted" : file.scope;
      if (scope !== "public" && scope !== "restricted") return { error: `「${name}」の公開可否が正しくありません。` };
      item.scope = scope;
    } else if (file.scope !== undefined) return { error: "公開可否を選べるのは、案件の会話の添付だけです。" };
    total += file.size;
    value.push(item);
  }
  if (total > ATTACH_TOTAL_MAX)
    return { error: `1メッセージの添付の合計は${ATTACH_TOTAL_MAX / 1000000}MBまでです（案。現在${sizeText(total)}）。` };
  return { value };
}
// 投稿を確定する実行する関数（コンソールから呼べる）。target は { source: "channel", id }・{ source: "dm", userId }・{ source: "case", id }。
// 保存の直前に、本文・投稿先の存在・状態・権限・添付をすべて検査し、1つでも通らなければ何も保存しない（本文だけが投稿されることはない）。
// 保存するのは検査・正規化した値だけ。スレッドの返信は別の処理で、添付は付けられない（Q-84）。
function postMessage(target, text, files = []) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return refuse("投稿先が正しくありません。");
  target = { source: target.source, id: target.id, userId: target.userId };
  if (typeof text !== "string") return refuse("メッセージは文字で入力してください。");
  const body = text.trim();
  if (!body) return refuse("メッセージを入力してください。");
  if ([...body].length > 4000) return refuse("メッセージは1〜4000文字で入力してください。");
  const cleaned = cleanAttachments(files, { withScope: target.source === "case" });
  if (cleaned.error) return refuse(cleaned.error);
  let list;
  let scope;
  let item = null;
  if (target.source === "channel") {
    if (typeof target.id !== "string") return refuse("投稿先が正しくありません。");
    const channel = prototypeData.channels.find((value) => value.id === target.id);
    if (!channel) return refuse("チャンネルが見つかりません。");
    if (chArchived(channel)) return refuse(ARCHIVED_MESSAGE);
    if (!isChannelMember(channel)) return refuse("参加すると使えます。");
    if (channel.readOnly) return refuse("この部署は無効化されたため、読み取り専用です。");
    if (!canPostChannel(channel))
      return refuse(`このチャンネルに投稿できるのは、${channel.dept}のオーナーと全体管理者だけです。`);
    list = channel.messages;
    scope = `channel:${channel.id}`;
  } else if (target.source === "dm") {
    if (typeof target.userId !== "string") return refuse("投稿先が正しくありません。");
    const partner = employees.find((person) => person.id === target.userId);
    if (!partner || !partner.active || partner.id === state.userId) return refuse("相手が見つかりません。");
    list = prototypeData.dm[dmKey(state.userId, partner.id)] || [];
    scope = `dm:${partner.id}`;
  } else if (target.source === "case") {
    if (typeof target.id !== "string") return refuse("投稿先が正しくありません。");
    item = getCase(target.id);
    if (!item) return refuse("案件が見つかりません。");
    if (caseArchived(item)) return refuse(ARCHIVED_MESSAGE);
    if (item.status !== "active") return refuse("終了した案件には投稿できません。");
    if (!isMember(item)) return refuse();
    list = item.messages;
    scope = `case:${item.id}`;
  } else return refuse("投稿先が正しくありません。");
  const message = { by: state.userId, text: body, at: stamp(), replies: [] };
  if (cleaned.value.length) message.attachments = cleaned.value;
  if (target.source === "dm") (prototypeData.dm[dmKey(state.userId, target.userId)] ||= []).push(message);
  else list.push(message);
  delete ui.pendingAttachments[scope];
  if (item) record(item, "メッセージを投稿");
  // 下書きの消去は後始末。失敗しても、投稿の結果は変えず、失敗を記録する。
  runCleanup("下書きの消去", scope, () => removeDraftStrict(draftKey(scope)));
  return true;
}
const attachKeyOk = (key) => typeof key === "string" && /^(channel|dm|case):[A-Za-z0-9_-]+$/.test(key);
const attachWithScope = (key) => key.startsWith("case:");
// 送信前の添付の一覧（ファイル名・サイズ・取り消し。案件は公開可否）。入れる文字列は e() を通した値と固定のマークアップだけ。
function attachPendingHtml(key) {
  const list = ui.pendingAttachments[key] || [];
  if (!list.length) return "";
  const withScope = attachWithScope(key);
  const problem = cleanAttachments(list, { withScope }).error;
  const total = list.reduce((sum, file) => sum + file.size, 0);
  const items = list
    .map((file, index) => {
      const kind = attachKindOf(file.name);
      return `<li class="attach-item"><span class="attach-name">${e(file.name)}</span><span class="row-note">${kind ? e(ATTACH_KIND_LABEL[kind]) : "対象外の形式"} ・ ${e(sizeText(file.size))}</span>${withScope ? `<label class="attach-scope">公開可否 <select data-attach-scope data-key="${e(key)}" data-index="${index}"><option value="restricted" ${file.scope === "public" ? "" : "selected"}>参加者限定（初期値）</option><option value="public" ${file.scope === "public" ? "selected" : ""}>公開可能（全社員公開が承認された場合のみ）</option></select></label>` : ""}<button type="button" class="button small" data-ui="attach-remove" data-key="${e(key)}" data-index="${index}" aria-label="${e(file.name)}を取り消す">取り消し</button></li>`;
    })
    .join("");
  return `<p class="form-label">送信前の添付一覧（${list.length}件・合計 ${e(sizeText(total))}）</p><ul class="attach-list">${items}</ul>${problem ? `<p class="form-error" role="alert">${e(problem)}</p>` : ""}`;
}
function refreshAttachPending(key) {
  const box = document.querySelector(`#attach-pending[data-key="${CSS.escape(key)}"]`);
  if (!box) return;
  // nosemgrep: insecure-innerhtml, insecure-document-method 送信前の添付の一覧の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、ファイル名などの入力をそのまま入れない
  box.innerHTML = attachPendingHtml(key);
}
// 入力欄の「添付」ボタンと、ファイル選択（非表示）、送信前の一覧の入れ物。
const attachToolbarHtml = (key) =>
  `<button type="button" class="button small" data-ui="attach-open" aria-label="ファイルを添付する">添付</button><input type="file" multiple hidden data-attach-key="${e(key)}">`;
const attachAreaHtml = (key) =>
  `<p class="form-hint">添付は1メッセージ${ATTACH_COUNT_MAX}ファイル・合計${ATTACH_TOTAL_MAX / 1000000}MBまで（案）。画像${ATTACH_SIZE_MAX.image / 1000000}MB・文書${ATTACH_SIZE_MAX.document / 1000000}MB・動画${ATTACH_SIZE_MAX.video / 1000000}MBまで。この試作では、ファイルの中身は送らず、保存もしません。</p><div id="attach-pending" class="attach-pending" data-key="${e(key)}" aria-live="polite">${attachPendingHtml(key)}</div>`;
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.matches?.("input[type=file][data-attach-key]")) {
    const key = el.dataset.attachKey;
    if (!attachKeyOk(key)) return;
    const withScope = attachWithScope(key);
    const list = (ui.pendingAttachments[key] ||= []);
    Array.from(el.files).forEach((file) => {
      const entry = { name: file.name, size: file.size, type: file.type };
      if (withScope) entry.scope = "restricted";
      list.push(entry);
    });
    el.value = "";
    refreshAttachPending(key);
    return;
  }
  if (el.matches?.("select[data-attach-scope]") && attachKeyOk(el.dataset.key)) {
    const file = (ui.pendingAttachments[el.dataset.key] || [])[Number(el.dataset.index)];
    if (file && (el.value === "public" || el.value === "restricted")) file.scope = el.value;
  }
});
// 書式の書き方の案内（入力中のプレビューはない。C-60）。
const formatHintHtml = '<p class="form-hint">書式（案）：**太字**・*斜体*・~~取り消し線~~・`コード`・「> 」で引用・「- 」で箇条書き。URL は自動でリンクになります。入力中のプレビューはありません。「B」「i」のボタンは配置のみです。</p>';
function composer(kind) {
  const draft = draftFor(
    kind === "channel" ? `channel:${ui.channelId}` : `dm:${ui.dmUserId}`,
  );
  const key = kind === "channel" ? `channel:${ui.channelId}` : `dm:${ui.dmUserId}`;
  return `<form class="chat-composer" data-proto-form="chat" data-kind="${kind}"><label for="chat-text">メッセージを入力</label><textarea id="chat-text" name="text" required placeholder="メッセージを入力" data-min="1" data-max="4000" data-name="メッセージ" data-draft-key="${e(draft.key)}">${e(draft.text)}</textarea>${draftNote(draft)}${formatHintHtml}${attachAreaHtml(key)}<div class="composer-toolbar"><span class="inline-actions"><button type="button" disabled title="装飾は未再現">B</button><button type="button" disabled title="装飾は未再現"><i>i</i></button>${attachToolbarHtml(key)}<button type="button" disabled title="メンションは未再現">@</button><button type="button" data-ui="picker-open" data-mode="composer" aria-haspopup="dialog" aria-label="絵文字・スタンプを選ぶ">😀</button></span><button type="submit" class="button primary">送信</button></div></form>`;
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
    `${deptLabel(channel.dept)} ・ ${channel.announce ? "お知らせ専用 ・ " : ""}${channel.private ? "非公開" : "公開"}チャンネル${joined ? "" : " ・ 参加せずに読んでいます"}${channel.description ? ` ／ 説明: ${channel.description}` : ""}`,
    `<details class="mobile-participants"><summary>参加者 ${channel.members.length}人</summary>${participants || "<p class=\"subtle\">参加者はまだいません</p>"}</details><div class="chat-layout">${shellCard("メッセージ", `${channel.announce ? hint("お知らせの依頼・緊急削除の申請の文言と印は案です（未決定）。") : ""}${messageRows(channel.messages, "channel")}${channel.readOnly ? readOnlyNotice : !joined ? joinNotice : canPostChannel(channel) ? composer("channel") : noPostNotice}`)}<div class="desktop-participants">${shellCard("参加者", participants || '<p class="subtle">参加者はまだいません</p>')}</div></div>`,
    (channel.private && joined
      ? protoButton(
          "招待",
          "invite-open",
          `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}に社員を招待"`,
        )
      : "") +
      kebabHtml(`# ${channel.name}`, channelMenuItems(channel)) +
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
              `<div class="person-card" data-name="${e(person.name)}"><div>${personButton(person.id)}<p>${e(deptOf(person))} ・ ${e(statusText(person))}</p></div>${protoButton("DMを送る", "dm", `data-user="${person.id}"`)}</div>`,
          )
          .join("")}</div><p id="dm-search-empty" class="subtle" hidden>該当する社員がいません。</p>`,
      ),
    );
  const key = dmKey(state.userId, partner.id);
  const messages = prototypeData.dm[key] || [];
  return screenFrame(
    "S06",
    `@ ${partner.name}`,
    `${deptOf(partner)} ・ ${partner.status || "在席"} ・ 戻り予定: ${partner.returnAt && partner.status !== "在席" ? partner.returnAt : "なし"}`,
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
  `thread:${thread.source}:${thread.source === "case" ? thread.caseId : thread.source === "channel" ? thread.channelId : thread.partnerId}:${threadMessages(thread).indexOf(thread.message)}`;
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
  panel.innerHTML = `<div class="thread-header"><strong>S-07 スレッド</strong><button type="button" data-ui="thread-close" aria-label="スレッドを閉じる">×</button></div><div class="thread-scroll"><p class="thread-label">${e(thread.label || "")}</p><p class="side-caption">元のメッセージ</p><div class="chat-message" data-mid="${e(midOf(message))}"><div class="message-avatar">${e(nameOf(message.by).slice(-2))}</div><div class="chat-body">${personButton(message.by)}${message.deleted ? '<p class="deleted-note">削除されました</p>' : `${renderMarkdown(message.text)}<div class="chat-tools"><button type="button" data-ui="org-add" data-kind="message" data-ref="${e(midOf(message))}" aria-label="元のメッセージを整理スペースに登録">整理スペースに登録</button></div>`}</div></div><h3>返信 ${message.replies?.length || 0}件</h3>${message.replies?.length ? message.replies.map((reply) => `<div class="thread-reply" data-mid="${e(midOf(reply))}"><strong>${e(nameOf(reply.by))}</strong> <time>${e(reply.at || "")}</time>${renderMarkdown(reply.text)}<div class="chat-tools"><button type="button" data-ui="org-add" data-kind="reply" data-ref="${e(midOf(reply))}" aria-label="${e(nameOf(reply.by))}の${e(reply.at || "")}の返信を整理スペースに登録">整理スペースに登録</button></div></div>`).join("") : '<p class="subtle">まだ返信がありません。</p>'}</div>${canReply ? `<form class="thread-form" data-proto-form="reply"><label for="reply-text">返信を入力</label><textarea id="reply-text" name="text" required data-min="1" data-max="4000" data-name="返信" data-draft-key="${e(draft.key)}">${e(draft.text)}</textarea>${draftNote(draft)}<button type="submit" class="button primary">返信する</button></form>` : `<p class="prototype-hint">${message.deleted ? "削除された投稿には返信できません。" : thread.source === "channel" ? (prototypeData.channels.find((item) => item.id === thread.channelId)?.readOnly ? "この部署は無効化されたため、読み取り専用です。" : "参加すると返信できます。") : "読み取り専用です。"}</p>`}`;
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
    return `<div class="directory-row" data-channel-name="${e(channel.name)}"><div><strong># ${e(channel.name)}</strong><p class="subtle">${e(deptLabel(channel.dept))}${locationBadge(channel.dept)}${tag} ・ ${channel.private ? "非公開" : "公開"} ・ ${channel.members.length}人が参加 ・ ${joined ? "参加済み" : "未参加（参加せずに読めます）"}</p>${channel.description ? `<p class="subtle">説明: ${e(channel.description)}</p>` : ""}</div><div class="inline-actions">${protoButton(joined ? "開く" : "読む", "channel", `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}を${joined ? "開く" : "参加せずに読む"}"`)}${joined ? "" : protoButton("参加する", "join-channel", `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}に参加する"`)}</div></div>`;
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
/* ---------- 「⋯」メニュー・S-39 チャンネル管理・S-40 案件管理（C-131。#99 段階2）---------- */
// どの入口（ヘッダー・S-39・S-40・S-38）も、既存のダイアログと実行する関数だけを呼ぶ（新しい実行経路は作らない）。項目は既存の権限関数で出し分ける。
// メッセージ・TODO・説明（非参加の案件）は出さない（C-131(4)）。物理削除は置かない（S-38 だけ）。右クリックの処理は足さない。
function menuItemHtml(item) {
  const trigger = item.action ? `data-action="${e(item.action)}"` : `data-ui="${e(item.ui)}"`;
  return `<button type="button" role="menuitem" ${trigger} data-id="${e(item.id)}"${item.kind ? ` data-kind="${e(item.kind)}"` : ""}>${e(item.text)}</button>`;
}
// items が空のときは「⋯」を出さない。label は読み上げ用（対象の名前）。
function kebabHtml(label, items) {
  if (!items.length) return "";
  return `<span class="kebab"><button type="button" class="button small" data-ui="menu-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="${e(label)}の操作">⋯</button><div class="kebab-menu" role="menu" hidden>${items.map(menuItemHtml).join("")}</div></span>`;
}
function channelMenuItems(channel) {
  const items = [];
  if (canRenameChannel(channel)) items.push({ ui: "channel-manage", id: channel.id, text: "名前・説明を編集" });
  else if (canDescribeChannel(channel)) items.push({ ui: "channel-manage", id: channel.id, text: "説明を編集" });
  if (canArchiveChannel(channel)) items.push({ action: "archive-open", id: channel.id, kind: "channel", text: "アーカイブ" });
  if (canRestoreChannel(channel)) items.push({ ui: "archive-restore", id: channel.id, kind: "channel", text: "復元" });
  return items;
}
function caseMenuItems(item, editText = "編集") {
  const items = [];
  if (canEditCase(item)) items.push({ action: "edit-case", id: item.id, text: editText });
  if (canChangeDue(item)) items.push({ ui: "case-due-open", id: item.id, text: "納期を変更" });
  if (canArchiveCase(item)) items.push({ action: "archive-open", id: item.id, kind: "case", text: "アーカイブ" });
  if (canRestoreCase(item)) items.push({ ui: "archive-restore", id: item.id, kind: "case", text: "復元" });
  if (canViewArchivedCase(item) && !(state.page === "S17" && state.selectedId === item.id)) items.push({ ui: "case-open", id: item.id, text: "中身を見る（全体管理者）" });
  return items;
}
function closeKebabs() {
  document.querySelectorAll(".kebab-menu:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}
// 「⋯」を開いた入口（見出し・S-39・S-40 の行）。ダイアログを閉じて再描画したあと、フォーカスをそこへ戻すために覚える（画面を移動したら忘れる）。
function refocusMenuOrigin() {
  const origin = ui.menuOrigin;
  if (!origin) return;
  const toggle = document.querySelector(`${origin.selector} [data-ui="menu-toggle"]`);
  if (toggle && toggle.offsetParent !== null) return toggle.focus();
  // 行が消えたとき（担当部署の変更・アーカイブなど）は、一覧の検索欄か、画面へ戻す。
  const fallback = document.querySelector("#caadm-search, #chadm-search");
  if (fallback) return fallback.focus();
  screen.focus();
}
function toggleKebab(button) {
  const row = button.closest("[data-admin-case], [data-admin-channel]");
  ui.menuOrigin = {
    selector: row
      ? row.hasAttribute("data-admin-case")
        ? `[data-admin-case="${CSS.escape(row.getAttribute("data-admin-case"))}"]`
        : `[data-admin-channel="${CSS.escape(row.getAttribute("data-admin-channel"))}"]`
      : ".heading-actions",
  };
  const menu = button.nextElementSibling;
  const willOpen = menu?.hidden;
  closeKebabs();
  if (!menu || !willOpen) return;
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
  menu.querySelector('[role="menuitem"]')?.focus();
}
// 項目を押したときは、先にメニューを閉じて「⋯」のボタンへフォーカスを戻す（ダイアログを閉じたあとの戻り先にする）。メニューの外を押したときも閉じる。
window.addEventListener(
  "click",
  (event) => {
    const item = event.target.closest?.('[role="menuitem"]');
    if (item) {
      const toggle = item.closest(".kebab")?.querySelector('[data-ui="menu-toggle"]');
      closeKebabs();
      toggle?.focus();
      return;
    }
    if (!event.target.closest?.(".kebab")) closeKebabs();
  },
  true,
);
document.addEventListener("keydown", (event) => {
  const open = document.querySelector(".kebab-menu:not([hidden])");
  if (!open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    const toggle = open.previousElementSibling;
    closeKebabs();
    toggle?.focus();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const items = [...open.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
  }
});
const ADMIN_STATE_FILTERS = {
  channel: [["all", "すべて"], ["active", "有効"], ["archived", "アーカイブ中"]],
  case: [["all", "すべて"], ["active", "進行中"], ["ended", "終了"], ["archived", "アーカイブ中"]],
};
// S-39：全体管理者は全チャンネル、オーナーは自部署のチャンネル。案件専用チャンネルは出さない（案。Q-104）。名前の検索と、状態（有効／アーカイブ中）の絞り込み。
function visibleAdminChannels() {
  const term = compareKey(ui.chAdmQuery);
  return prototypeData.channels
    .filter((channel) => adminOnly() || ownsDept(channel.dept))
    .filter((channel) => ui.chAdmState === "all" || (ui.chAdmState === "archived") === chArchived(channel))
    .filter((channel) => !term || compareKey(channel.name).includes(term));
}
function channelAdminResultsHtml() {
  const shown = visibleAdminChannels();
  const rows = shown
    .map(
      (channel) =>
        `<tr data-admin-channel="${e(channel.id)}"><td data-label="名前"># ${e(channel.name)}</td><td data-label="説明">${e(channel.description || "なし")}</td><td data-label="種類">${e(CHANNEL_KIND_LABEL[channelKind(channel)])}（${e(deptLabel(channel.dept))}）</td><td data-label="公開範囲">${channel.private ? "非公開" : "公開"}</td><td data-label="参加者">${channel.members.length}人</td><td data-label="状態">${chArchived(channel) ? '<span class="badge shelved">アーカイブ中</span>' : "有効"}</td><td data-label="操作">${kebabHtml(`# ${channel.name}`, channelMenuItems(channel)) || '<span class="subtle">操作なし</span>'}</td></tr>`,
    )
    .join("");
  return `${shown.length ? `<table class="client-table"><caption class="visually-hidden">チャンネルの一覧</caption><thead><tr><th scope="col">名前</th><th scope="col">説明</th><th scope="col">種類</th><th scope="col">公開範囲</th><th scope="col">参加者</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<p id="chadm-empty">該当するチャンネルはありません。</p>'}<p class="form-hint" role="status">${shown.length}件を表示</p>`;
}
function refreshChannelAdmin() {
  const box = document.querySelector("#chadm-results");
  if (!box) return;
  // nosemgrep: insecure-innerhtml, insecure-document-method チャンネル管理の一覧の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、名前・説明などの入力をそのまま入れない
  box.innerHTML = channelAdminResultsHtml();
}
function channelAdminScreen() {
  return screenFrame(
    "S39",
    "チャンネル管理",
    adminOnly()
      ? "全体管理者は、全チャンネルを管理できます（案件専用チャンネルは出しません。案）。メッセージの中身は出しません。"
      : "オーナーは、自部署のチャンネルを管理できます。メッセージの中身は出しません。",
    shellCard(
      "チャンネルの一覧",
      `<div class="directory-toolbar"><div class="form-field"><label for="chadm-search">名前で検索</label><input id="chadm-search" type="search" autocomplete="off" value="${e(ui.chAdmQuery)}"></div>${selectField("状態", "chadm-state", ADMIN_STATE_FILTERS.channel, ui.chAdmState)}</div><div id="chadm-results">${channelAdminResultsHtml()}</div>`,
    ) +
      hint("列・並び順・ページ送り・スマートフォンでの見え方・「⋯」の項目の並びは案です（未決定。Q-105）。物理削除はアーカイブ画面（S-38）だけにあります。"),
  );
}
// S-40：全体管理者は全件、オーナーは自部署が担当部署の一つである案件。件名・番号の検索と、状態（進行中／終了／アーカイブ中）の絞り込み。説明・メッセージ・TODO は出さない。
const caseAdminState = (item) => (caseArchived(item) ? "archived" : item.status === "active" ? "active" : "ended");
function visibleAdminCases() {
  const term = compareKey(ui.caAdmQuery);
  return state.cases
    .filter((item) => adminOnly() || ownsAnyDept(item.departments))
    .filter((item) => ui.caAdmState === "all" || caseAdminState(item) === ui.caAdmState)
    .filter((item) => !term || compareKey(item.title).includes(term) || caseNoMatches(item, ui.caAdmQuery));
}
function caseAdminResultsHtml() {
  const shown = visibleAdminCases();
  const stateLabel = { active: "進行中", ended: "終了", archived: "アーカイブ中" };
  const rows = shown
    .map(
      (item) =>
        `<tr data-admin-case="${e(item.id)}"><td data-label="案件番号"><span class="case-id">${e(item.no)}</span></td><td data-label="件名">${e(item.title)}</td><td data-label="取引先">${e(clientLabelOf(item.clientCode))}</td><td data-label="担当部署">${e(deptsText(item))}</td><td data-label="状態">${caseArchived(item) ? '<span class="badge shelved">アーカイブ中</span>' : e(stateLabel[caseAdminState(item)])}</td><td data-label="納期">${dueText(item.due) ? e(dueText(item.due)) : "なし"}</td><td data-label="参加者">${item.members.length}人</td><td data-label="操作">${kebabHtml(item.no, caseMenuItems(item, isMember(item) ? "案件を編集" : "案件を編集（管理者）")) || '<span class="subtle">操作なし</span>'}</td></tr>`,
    )
    .join("");
  return `${shown.length ? `<table class="client-table"><caption class="visually-hidden">案件の一覧</caption><thead><tr><th scope="col">案件番号</th><th scope="col">件名</th><th scope="col">取引先</th><th scope="col">担当部署</th><th scope="col">状態</th><th scope="col">納期</th><th scope="col">参加者</th><th scope="col">操作</th></tr></thead><tbody>${rows}</tbody></table>` : '<p id="caadm-empty">該当する案件はありません。</p>'}<p class="form-hint" role="status">${shown.length}件を表示</p>`;
}
function refreshCaseAdmin() {
  const box = document.querySelector("#caadm-results");
  if (!box) return;
  // nosemgrep: insecure-innerhtml, insecure-document-method 案件管理の一覧の描画。入れる文字列は、固定のマークアップと e()（escapeHtml）を通した値だけで組み立てており、件名などの入力をそのまま入れない
  box.innerHTML = caseAdminResultsHtml();
}
function caseAdminScreen() {
  return screenFrame(
    "S40",
    "案件管理",
    adminOnly()
      ? "全体管理者は、全件の案件を管理できます。説明・メッセージ・TODO は出しません。"
      : "オーナーは、自部署が担当部署の一つである案件を管理できます。説明・メッセージ・TODO は出しません。",
    shellCard(
      "案件の一覧",
      `<div class="directory-toolbar"><div class="form-field"><label for="caadm-search">件名・案件番号で検索</label><input id="caadm-search" type="search" autocomplete="off" value="${e(ui.caAdmQuery)}"></div>${selectField("状態", "caadm-state", ADMIN_STATE_FILTERS.case, ui.caAdmState)}</div><div id="caadm-results">${caseAdminResultsHtml()}</div>`,
    ) +
      hint("列・並び順・ページ送り・スマートフォンでの見え方・「⋯」の項目の並びは案です（未決定。Q-105）。担当部署での絞り込みは作っていません（Q-101）。物理削除はアーカイブ画面（S-38）だけにあります。"),
  );
}
// アーカイブ画面 S-38（C-123・C-124）。見出しで「アーカイブしたチャンネル」「アーカイブした案件」に分ける（見出しの細部は案）。
// 全体管理者は全件、オーナーは自部署の範囲のアーカイブ済みすべて。中身は出さない（Q-70の案）。
// 並び順は、アーカイブした日時の新しい順（案）。絞り込みは作らない（未決定）。
function archivedItems() {
  // 全体管理者は全件、オーナーは自部署の範囲のすべて（誰がアーカイブしたものでも。チャンネルは自部署、案件は担当部署のどれか。C-132(3)）。
  const mine = (target, owns) => adminOnly() || owns;
  const byNew = (a, b) => b.deletedAt - a.deletedAt;
  return {
    channels: prototypeData.channels.filter((channel) => chArchived(channel) && mine(channel, ownsDept(channel.dept))).sort(byNew),
    cases: state.cases.filter((item) => caseArchived(item) && mine(item, ownsAnyDept(item.departments))).sort(byNew),
  };
}
function archiveScreen() {
  const { channels, cases } = archivedItems();
  const meta = (target) =>
    `アーカイブした人: ${e(nameOf(target.deletedBy))} ・ ${e(archiveTime(target.deletedAt))} ・ 理由: ${target.deleteReason ? e(target.deleteReason) : "なし"}`;
  const channelRow = (channel) =>
    `<div class="directory-row" data-archived-channel="${e(channel.id)}"><div><strong># ${e(channel.name)}</strong> <span class="badge shelved">アーカイブ済み</span><p class="subtle">チャンネル ・ ${e(deptLabel(channel.dept))} ・ 参加者${channel.members.length}人</p><p class="subtle">${meta(channel)}</p></div><div class="inline-actions">${canRestoreChannel(channel) ? protoButton("復元", "archive-restore", `data-kind="channel" data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}を復元"`) : ""}${canPurge(channel) ? protoButton("物理削除", "archive-purge", `data-kind="channel" data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}を物理削除"`) : ""}</div></div>`;
  const caseRow = (item) =>
    `<div class="directory-row" data-archived-case="${e(item.id)}"><div><strong><span class="case-id">${e(item.no)}</span>${e(item.title)}</strong> <span class="badge shelved">アーカイブ済み</span><p class="subtle">案件 ・ ${e(deptsText(item))} ・ 取引先 ${e(clientLabelOf(item.clientCode))} ・ ${e(caseStatusLabel(item))} ・ 参加者${item.members.length}人</p><p class="subtle">${meta(item)}</p></div><div class="inline-actions">${canViewArchivedCase(item) ? protoButton("中身を見る", "case-open", `data-id="${e(item.id)}" aria-label="${e(item.no)}の中身を見る"`) : ""}${canRestoreCase(item) ? protoButton("復元", "archive-restore", `data-kind="case" data-id="${e(item.id)}" aria-label="${e(item.no)}を復元"`) : ""}${canPurge(item) ? protoButton("物理削除", "archive-purge", `data-kind="case" data-id="${e(item.id)}" aria-label="${e(item.no)}を物理削除"`) : ""}</div></div>`;
  const none = '<p class="empty-note" role="status">アーカイブしたものはありません</p>';
  return screenFrame(
    "S38",
    "アーカイブ（案）",
    "アーカイブしたチャンネルと案件を確認し、復元できます。中身（メッセージ・TODOなど）は出しません（案件の中身は、強制参加の全体管理者だけが「中身を見る」で読み取り専用で見られます）。物理削除は全体管理者だけで、元に戻せません。",
    shellCard("アーカイブしたチャンネル", channels.length ? channels.map(channelRow).join("") : none) +
      shellCard("アーカイブした案件", cases.length ? cases.map(caseRow).join("") : none) +
      hint("見出し・並び順（新しい順）・文言は案です（未決定）。絞り込みは作っていません。全体管理者は全件、オーナーは自部署の範囲のアーカイブ済みすべてが出ます。"),
  );
}
// チャンネル名の使用可能文字（C-117(1)、V-25）。「日本語」の範囲は未定義のため、判定は案（Q-1）。
const channelNameCharsOk = (name) =>
  /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々〆a-zA-Z0-9０-９Ａ-Ｚａ-ｚ_-]+$/u.test(name);
// チャンネル名の検査（整形済みの名前を渡す）。問題がなければ空文字、あれば理由を返す。チャンネル名の申請と、名前の変更で共通。
// 重複は、既存のチャンネル（アーカイブしたものを含む。物理削除すると配列から消えるので比較に入らない）と、承認待ちの申請の名前と比べる。
// exceptId は、名前を変えるチャンネル自身（自分の名前とは比べない）。
function channelNameProblem(name, exceptId = null) {
  if (typeof name !== "string" || !name) return "チャンネル名を入力してください。";
  if ([...name].length > 50) return "チャンネル名は1〜50文字で入力してください（整形後の文字数）。";
  if (!channelNameCharsOk(name))
    return "使えない文字が含まれています（使えるのは、日本語・英数字・ハイフン・アンダースコア）。";
  const taken =
    prototypeData.channels.some((channel) => channel.id !== exceptId && compareKey(channel.name) === compareKey(name)) ||
    prototypeData.channelRequests.some(
      (request) => request.status === "pending" && compareKey(request.name) === compareKey(name),
    );
  if (taken)
    return "同じ名前のチャンネル（または承認待ちの申請）が会社内にあります（大文字・小文字の違いは区別しません。アーカイブしたチャンネルも含みます）。";
  return "";
}
// 案件作成の申請の入力の検査と正規化（画面の送信と実行する関数の両方から呼ぶ）。{ error } か { value } を返す。
// 保存する値は、ここで検査・正規化した値だけを使う。文字列でない値は、未指定として許す項目（納期・説明・参加候補・再申請元）の
// undefined・null を除いて拒否する。件名は整形後の文字数、担当部署は一般社員・オーナーが自部署のみ・全体管理者は有効な全部署、
// 取引先は有効なもの、納期は存在する日付で今日（日本時間）以降。
// 件名と説明の検査と正規化（申請と案件の再編集の両方から呼ぶ。C-122）。{ error } か { value: { title, changed, description } } を返す。
// 件名は文字列で、整形後1〜100文字。説明は未指定（undefined・null）なら空、指定するなら文字列で前後の空白を除いて2000文字以内。
// 文字列の配列を検査して、コピーを返す。配列でない・要素が文字列でない（疎な配列の空きを含む）ときは null。
// 疎な配列・独自のイテレーター・継承した添字（Array.prototype に定義した値）を受理しないように、length を1度だけ取得し、
// 各添字が自身のプロパティとして存在するか（Object.hasOwn）を確かめてから、値を1度だけ読んでコピーする。Array.from・スプレッドは使わない。
function denseList(value) {
  if (!Array.isArray(value)) return null;
  // length は1度だけ読み、数値・安全な整数・配列として取りうる範囲かを検査する（Proxy・valueOf で比較のたびに変わる値や NaN・負・小数・文字列を拒否）。
  // 以降は、このローカルの数値だけを使い、再取得・型変換をしない。
  const length = value.length;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) return null;
  const copy = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) return null;
    copy.push(value[index]);
  }
  return copy;
}
function denseStrings(value) {
  const copy = denseList(value);
  return copy && copy.every((item) => typeof item === "string") ? copy : null;
}
// 担当部署（配列）の検査と正規化。{ error } か { value: 新しい配列 } を返す。密な文字列の配列（疎な配列の空きは拒否）・重複は1つにまとめる・
// 1件以上・すべて有効な部署（完全一致）。誰でも全部署から選べる（C-132(1)）。保存には、ここが返したコピーだけを使う。
function cleanDepartments(list) {
  const copy = denseStrings(list);
  if (!copy) return { error: "担当部署の指定が正しくありません。" };
  const value = [...new Set(copy)];
  if (!value.length) return { error: "担当部署を1つ以上選んでください。" };
  const valid = departmentNames();
  if (value.some((name) => !valid.includes(name))) return { error: "担当部署には、有効な部署を選んでください。" };
  return { value };
}
function cleanCaseText(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return { error: "入力の内容が正しくありません。" };
  // 各値を1度だけ読んでコピーし、検査と保存に同じ値を使う（getter・Proxy で値が変わる入力への対策）。
  values = { title: values.title, description: values.description };
  const missing = (v) => v === undefined || v === null;
  if (typeof values.title !== "string") return { error: "件名を入力してください。" };
  const title = normalizeInput(values.title);
  if (!title) return { error: "件名を入力してください。" };
  if ([...title].length > 100) return { error: "件名は1〜100文字で入力してください（整形後の文字数）。" };
  if (!missing(values.description) && typeof values.description !== "string") return { error: "説明は文字で入力してください。" };
  const description = missing(values.description) ? "" : values.description.trim();
  if ([...description].length > 2000) return { error: "説明は2000文字以内で入力してください。" };
  return { value: { title, changed: values.title.trim() !== title, description } };
}
function cleanCaseRequest(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return { error: "申請の内容が正しくありません。" };
  // 各値を1度だけ読んでコピーし、検査と保存に同じ値を使う。
  values = {
    title: values.title,
    description: values.description,
    due: values.due,
    legacyDepartment: values.department,
    departments: values.departments,
    clientCode: values.clientCode,
    candidates: values.candidates,
    previous: values.previous,
    draftKey: values.draftKey,
  };
  const missing = (v) => v === undefined || v === null;
  const text = cleanCaseText(values);
  if (text.error) return text;
  const { title, description } = text.value;
  if (!missing(values.due) && typeof values.due !== "string") return { error: "納期は日付で入力してください。" };
  const due = missing(values.due) ? "" : values.due.trim();
  if (due && !isRealDate(due)) return { error: "納期は日付で入力してください。" };
  if (due && due < todayText()) return { error: "今日以降の日付を選んでください。" };
  // 旧形式（department の文字列）は拒否する。担当部署は departments（配列）で指定する。
  if (values.legacyDepartment !== undefined) return { error: "担当部署は departments で指定してください。" };
  const depts = cleanDepartments(values.departments);
  if (depts.error) return depts;
  if (typeof values.clientCode !== "string" || !clientByCode(values.clientCode)?.active)
    return { error: "取引先を一覧から選んでください。" };
  const candidateList = missing(values.candidates) ? [] : denseStrings(values.candidates);
  if (!candidateList) return { error: "参加候補が正しくありません。" };
  const candidates = candidateList.filter(
    (id) => id !== state.userId && employees.some((person) => person.id === id && person.active),
  );
  if (!missing(values.previous) && typeof values.previous !== "string") return { error: "再申請の元が正しくありません。" };
  return {
    value: {
      title,
      changed: text.value.changed,
      clientCode: values.clientCode,
      due,
      description,
      departments: depts.value,
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
    departments: [...clean.departments],
    applicant: state.userId,
    candidates: clean.candidates,
    added: [],
    status: "pending",
    reason: "",
    previous: previous?.id || null,
  });
  // 申請を送ったら、説明の下書きを消す。
  runCleanup("下書きの消去", "案件の申請", () => removeDraftStrict(clean.draftKey));
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
  return prototypeData.channels.filter((channel) => isChannelMember(channel) && !chArchived(channel));
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
          .filter((channel) => channel.dept === dept && !chArchived(channel))
          .map(
            (channel) =>
              `<div class="directory-row"># ${e(channel.name)} <span>${channel.private ? "非公開" : "公開"}</span>${canRenameChannel(channel) || canDescribeChannel(channel) ? protoButton("管理", "channel-manage", `data-id="${e(channel.id)}" aria-label="# ${e(channel.name)}を管理"`) : ""}</div>`,
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
  !caseArchived(item) && (isMember(item) || (item.status === "archived" && item.visibility === "public"));
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
    .filter((item) => !caseArchived(item))
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
    `<div class="directory-row search-case"><div><strong><span class="case-id">${e(item.no)}</span>${e(item.title)}</strong><p class="subtle">取引先: ${e(clientLabelOf(item.clientCode))} ・ ${e(deptsText(item))} ・ ${e(caseStatusLabel(item))} ・ 進捗 ${progressHtml(item)} ・ 納期 ${dueText(item.due) ? e(dueText(item.due)) : "なし"}</p>${inner.length ? `<ul class="search-inner" aria-label="${e(item.title)}の一致した内容">${inner.map((hit) => `<li><span class="badge archived">${e(hit.type)}</span> ${e(hit.text.slice(0, 60))}${hit.mid ? ` <button type="button" class="button small" data-ui="case-msg-open" data-id="${e(item.id)}" data-mid="${e(hit.mid)}" aria-label="${e(item.title)}の該当の投稿を開く">投稿を開く</button><button type="button" class="button small" data-ui="org-add" data-kind="message" data-ref="${e(hit.mid)}" aria-label="該当の投稿を整理スペースに登録">整理スペースに登録</button>` : ""}</li>`).join("")}</ul>` : ""}</div><div class="inline-actions">${protoButton("概要を開く", "case-open", `data-id="${e(item.id)}"`)}${canSeeContent(item) ? protoButton("整理スペースに登録", "org-add", `data-kind="case" data-ref="${e(item.id)}" aria-label="${e(item.no)} ${e(item.title)}を整理スペースに登録"`) : ""}</div></div>`;
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
        `${item.members.map((id) => `<div class="directory-row">${personButton(id)}${isForcedMember(item, id) ? `<span class="badge active">${forcedLabel(item, id)}</span>` : protoButton("外す", "case-remove", `data-id="${item.id}" data-user="${id}" aria-label="${e(nameOf(id))}を外す"`)}</div>`).join("")}<div class="inline-actions">${protoButton("参加者を追加", "case-add", `data-id="${item.id}"`)}${protoButton("案件の詳細へ戻る", "case-open", `data-id="${item.id}"`)}</div>`,
      ),
    );
  const prior = state.reapplySource ? getRequest(state.reapplySource) : null;
  // 説明の下書きは端末に一時保存する（C-82・C-117(5)）。新規の申請と、却下後の再申請でキーを分け、件名・個人情報は保存しない。
  const descDraft = draftFor(prior ? `case-request:reapply:${prior.id}` : "case-request:new");
  // 担当部署は必須（1つ以上）。誰でも全部署から複数を選べる（C-132(1)。C-98の「自部署のみ」を置き換え）。再申請は前の選択を引き継ぐ。
  // 新規の申請の初めの選択は、自分の所属部署（案）。
  const preset = prior?.departments || [currentUser().department];
  const department = `<fieldset class="form-field"><legend>担当部署（必須。1つ以上。全部署から選べます）</legend><div class="checkbox-list">${departmentNames()
    .map(
      (name) =>
        `<label class="checkbox-option"><input type="checkbox" name="case-department" value="${e(name)}" ${preset.includes(name) ? "checked" : ""}>${e(deptOptionLabel(name))}</label>`,
    )
    .join("")}</div><p class="form-hint">承認できるのは、選んだ担当部署のオーナーのいずれか（または全体管理者）です。</p></fieldset>`;
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
      `<form data-proto-form="profile">${field("表示名", "display-name", "text", user.name, true, [1, 30])}<fieldset><legend>ステータス</legend>${["在席", "外出", "欠席", "休暇", "会議中"].map((status) => `<label class="radio-label"><input type="radio" name="status" value="${status}" ${(user.status || "在席") === status ? "checked" : ""}> ${status}</label>`).join("")}</fieldset>${field("戻り予定（任意）", "return-time", "time", user.returnAt || "")}${field("一言メッセージ（任意）", "status-message", "text", user.message || "", false, [0, 100])}<button type="submit" class="button primary">保存する</button></form><div class="readonly-info"><strong>全体管理者だけが変更できる項目</strong><p>部署: ${e(deptOf(user))} / 役職: ${e(titleOf(user))} / メール: ${e(emailOf(user))} / 内線: ${e(extOf(user))}</p><p>本名: テスト社員 ${e(user.id.slice(-1))}（架空）</p><p class="subtle">本名は直接変更できません。変更届を出し、全体管理者が承認すると更新されます。</p></div>${protoButton("本名の変更届を出す", "name-change-request")}${protoButton("パスワードを変更", "go", 'data-page="S04"')}`,
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
      )}${selectField("拠点で絞り込む（案）", "staff-location", locationFilterOptions(), ui.staffLocFilter)}<div class="list-cards">${list.map((person) => `<div class="directory-row"><div>${personButton(person.id)}<p class="subtle">${e(person.department)}${locationBadge(person.department)} ・ 内線 ${e(extOf(person))} ・ <a href="mailto:${e(emailOf(person))}">${e(emailOf(person))}</a> ・ ${e(statusText(person))}</p></div><div class="inline-actions">${person.id !== state.userId ? protoButton("DMを送る", "dm", `data-user="${person.id}"`) : ""}${adminOnly() || (currentUser().role === "owner" && currentUser().department === person.department) ? protoButton("代理設定", "delegate-status", `data-user="${person.id}"`) : ""}</div></div>`).join("") || "<p>該当する社員がいません。</p>"}</div>`,
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
// 案件の編集の行（C-122）。件名は全文、説明は先頭40文字に短縮して出し、「全文を見る」で変更前・変更後の全文を出す。
// 同じ文字数で中身だけが違う変更も、変更前後の全文で区別できる。入れる値はすべて e() を通す。
function auditDetailHtml(event) {
  if (!Array.isArray(event.detail) || !event.detail.length) return "";
  const full = (value) => e(Array.isArray(value) ? value.join("・") : value || "（なし）");
  return `<div class="audit-detail">${event.detail
    .map((item) =>
      ["title", "name", "clientCode", "departments"].includes(item.field)
        ? `<p><strong>${{ title: "件名", name: "名前", clientCode: "取引先", departments: "担当部署" }[item.field]}</strong>　変更前: ${full(item.before)} → 変更後: ${full(item.after)}</p>`
        : `<p><strong>説明</strong>　変更前: ${e(excerpt(item.before || "（なし）"))} → 変更後: ${e(excerpt(item.after || "（なし）"))}</p><details><summary>全文を見る</summary><p class="audit-full">変更前: ${full(item.before)}</p><p class="audit-full">変更後: ${full(item.after)}</p></details>`,
    )
    .join("")}</div>`;
}
// 案件の終了・再開・引き継ぎは、誰が・いつ・どの案件かと、理由・再選定の結果を残す（C-81）。
function auditScreen() {
  const rows = state.audit.length
    ? state.audit
        .map(
          (event) =>
            `<div class="directory-row audit-row"><div><strong>${e(event.kind || "操作")}</strong><span class="subtle"> 対象: ${e(event.target || "—")}</span><p>${e(event.text)}</p>${auditDetailHtml(event)}</div><div class="audit-meta"><time>${e(event.at)}</time><span>操作した人: ${e(event.actor || "—")}</span><span>結果: 成功</span></div></div>`,
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
                      channel.dept === target && channel.folder === folder && !chArchived(channel),
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
    `<div class="person-card"><span class="message-avatar">${e(person.name.slice(-2))}</span><div><strong>${e(person.name)}</strong><p>本名: テスト社員 ${e(person.id.slice(-1))}（架空）</p><p>部署: ${e(deptOf(person))} ・ ${e(statusText(person))}</p></div></div>${person.id !== state.userId ? protoButton("DMを送る", "dm", `data-user="${person.id}"`) : ""}`,
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
// 参加を確定する実行する関数。公開で、アーカイブしておらず、未参加のチャンネルだけ。
function joinChannel(channelId) {
  if (typeof channelId !== "string") return refuse("チャンネルが見つかりません。");
  const channel = prototypeData.channels.find((item) => item.id === channelId);
  if (!channel) return refuse("チャンネルが見つかりません。");
  if (chArchived(channel)) return refuse(ARCHIVED_MESSAGE);
  if (channel.private) return refuse();
  if (isChannelMember(channel)) return refuse("すでに参加しています。");
  channel.members.push(state.userId);
  return true;
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
  return !caseArchived(item) && item.status === "active" && isMember(item);
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
// 通知の対象がアーカイブ・物理削除されているか。されていれば画面に出す文を返す（されていなければ空文字）。
function noticeGoneMessage(note) {
  if (note.channel) {
    const channel = prototypeData.channels.find((item) => item.id === note.channel);
    if (!channel) return prototypeData.purged.includes(note.channel) ? "削除されました（案）。" : "";
    if (chArchived(channel)) return "アーカイブされました。";
  }
  if (note.caseId) {
    const item = getCase(note.caseId);
    if (!item) return prototypeData.purged.includes(note.caseId) ? "削除されました（案）。" : "";
    if (caseArchived(item)) return "アーカイブされました。";
  }
  return "";
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
    ui.pendingAttachments = {};
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
    if (!item || caseArchived(item) || item.status !== "active" || !isMember(item)) return refuse();
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
    // 参加は実行する関数（joinChannel）に任せる。公開チャンネルには部署を問わず自分で参加できる（C-94）。非公開は招待による。
    const channel = prototypeData.channels.find((item) => item.id === element.dataset.id);
    if (!joinChannel(element.dataset.id)) return;
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
  if (action === "menu-toggle") return toggleKebab(element);
  if (action === "attach-open") {
    element.closest("form")?.querySelector('input[type="file"]')?.click();
    return;
  }
  if (action === "attach-remove") {
    const list = attachKeyOk(element.dataset.key) ? ui.pendingAttachments[element.dataset.key] : null;
    const index = Number(element.dataset.index);
    if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) return refuse();
    list.splice(index, 1);
    if (!list.length) delete ui.pendingAttachments[element.dataset.key];
    refreshAttachPending(element.dataset.key);
    document.querySelector('[data-ui="attach-open"]')?.focus();
    return;
  }
  if (action === "toggle-password") {
    const input = document.getElementById(element.dataset.target);
    if (input) {
      input.type = input.type === "password" ? "text" : "password";
      element.textContent =
        input.type === "password" ? "パスワードを表示" : "パスワードを隠す";
    }
    return;
  }
  // 既存の「👍」と、付いているリアクションのボタン。処理は toggleReaction（実行する関数）に任せる。対象は、ボタンが持つ部屋の ID と mid で明示する。
  if (action === "reaction") {
    const source = element.dataset.source;
    const roomId = element.dataset.room || "";
    const target = source === "dm" ? { source, userId: roomId } : { source, id: roomId };
    if (!toggleReaction(target, element.dataset.mid || "", element.dataset.key || "emoji:thumbsup")) return;
    return render();
  }
  if (action === "picker-open") return openPicker(element);
  if (action === "picker-close") return closePicker(true);
  if (action === "picker-tab") {
    if (!ui.picker || !["emoji", "stamp"].includes(element.dataset.tab)) return;
    ui.picker.tab = element.dataset.tab;
    renderPicker();
    return pickerEl.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }
  if (action === "picker-pick") return pickerPick(element.dataset.key || "");
  if (action === "notification-open") {
    const note = ownNotices().find((item) => item.id === element.dataset.id);
    if (!note) return refuse();
    // 対象がアーカイブされた・物理削除されたときは、移動せず、その旨を出す（C-124。Q-72の案）。
    const gone = noticeGoneMessage(note);
    if (gone) return notify(gone);
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
    if (!removeCaseMember(element.dataset.id, element.dataset.user)) return;
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
        if (!addCaseMember(String(data.get("id") || ""), String(data.get("case-new-member") || "")))
          return modalError(lastRefusal);
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
      // 送信は、投稿を確定する実行する関数（postMessage）に任せる。本文・権限・状態・添付をそこで検査し、通らなければ何も投稿しない。
      const channelForm = form.dataset.kind === "channel";
      const target = channelForm
        ? { source: "channel", id: ui.channelId }
        : { source: "dm", userId: ui.dmUserId };
      const key = channelForm ? `channel:${ui.channelId}` : `dm:${ui.dmUserId}`;
      if (!postMessage(target, String(data.get("text") || ""), ui.pendingAttachments[key] || [])) return;
      render();
      return notify("メッセージを表示しました。");
    }
    if (kind === "reply") {
      // 返信は実行する関数（postThreadReply）に任せる。親投稿の部屋・アーカイブ・権限・読み取り専用をそこで検査する。
      const thread = ui.thread;
      if (!thread || thread.viewerId !== state.userId) return refuse("この返信を投稿できません。");
      const target =
        thread.source === "channel"
          ? { source: "channel", id: thread.channelId }
          : thread.source === "dm"
            ? { source: "dm", userId: thread.partnerId }
            : { source: "case", id: thread.caseId };
      if (!postThreadReply(target, midOf(thread.message), String(data.get("text") || ""))) return;
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
      if (!setMyStatus(data.get("status"), data.get("return-time"))) return;
      currentUser().name = name;
      currentUser().message = String(data.get("status-message") || "");
      render();
      return notify("プロフィールを保存しました。");
    }
    if (kind === "channel-request") {
      // チャンネル名は保存時に自動整形する（C-121【案】）。長さ・使用可能文字・重複は整形後の値で判定する。
      const rawName = String(data.get("channel-name") || "");
      const name = normalizeInput(rawName);
      // 名前の検査は channelNameProblem（名前の変更 editChannel と共通）。アーカイブしたチャンネルの名前も重複の比較に入る（C-124(9)）。
      const nameProblem = channelNameProblem(name);
      if (nameProblem) return fieldError("channel-name", nameProblem);
      // 作る場所は自部署か会社直属だけ（他部署は不可）。名前は会社内で一意。大文字・小文字は区別せず、
      // 承認待ちの申請の名前も対象にする（C-105、2-2 AC-13）。却下された申請の名前は数えない。
      const dept =
        data.get("place") === "company" ? COMPANY : currentUser().department;
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
        departments = data.getAll("case-department").map(String),
        clientCode = String(data.get("case-client") || ""),
        due = String(data.get("case-due") || ""),
        description = String(data.get("case-description") || "").trim();
      // 入力の検査は実行する関数（createCaseRequest）と共通の caseRequestProblem で行う。
      const problem = caseRequestProblem({ title, departments, clientCode, due, description });
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
        departments,
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
