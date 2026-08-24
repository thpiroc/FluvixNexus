# アーキテクチャ

> 対象: Session 3-8-9（Git の Diff 表示と破棄）完了時点の実装
> 最終更新: 2026-08-23

製品としての方向性は [DESIGN.md](../DESIGN.md) を参照。このドキュメントは「現在のコードがどう組まれているか」と「機能を足すときにどこへ書くか」を扱う。

---

## 1. プロセス構成

```
┌──────────────┐   contextBridge   ┌──────────────┐      IPC       ┌──────────────┐
│   Renderer   │ ◀───────────────▶ │   Preload    │ ◀────────────▶ │     Main     │
│  React / UI  │   window.fluvix   │  薄い橋渡し   │  invoke/handle │  OS 連携の実体 │
└──────────────┘                   └──────────────┘                └──────────────┘
        └───────────────────── shared/（型と定数の契約） ─────────────────────┘
```

| 層       | 責務                                                  | やってはいけないこと                                |
| -------- | ----------------------------------------------------- | --------------------------------------------------- |
| Main     | ウィンドウ管理、OS 連携、永続化、セキュリティポリシー | UI の都合を持ち込む                                 |
| Preload  | Main の機能を型付きの関数として Renderer へ公開する   | ファイル I/O・プロセス起動などの実処理              |
| Renderer | UI 描画とユーザー操作                                 | OS へ直接触れる（`window.fluvix` 以外の経路を持つ） |
| shared   | Main / Preload / Renderer 共通の型・定数              | 実装、Node.js / DOM 依存の型                        |

Renderer には Node.js も Electron も渡していない（`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`）。Renderer から OS に届く経路は `window.fluvix` に公開された API だけであり、その実体は Preload の薄いラッパ、最終的な処理は必ず Main にある。

---

## 2. ディレクトリ構成

```
src/
├── main/                     Main Process
│   ├── index.ts              エントリポイント（起動処理を呼ぶだけ）
│   ├── app/
│   │   ├── lifecycle.ts      多重起動の抑止・起動順序・終了条件
│   │   ├── runtime.ts        開発中か / dev server の URL
│   │   └── menu.ts           アプリケーションメニュー
│   ├── windows/
│   │   └── mainWindow.ts     BrowserWindow の生成と webPreferences
│   ├── security/
│   │   └── index.ts          遷移ガード・新規ウィンドウ拒否・権限の既定拒否
│   ├── ipc/
│   │   ├── index.ts          ハンドラ登録の入り口
│   │   ├── registry.ts       ipcMain.handle の登録基盤（送信元検証・例外の正規化）
│   │   ├── events.ts         Main → Renderer へイベントを送る唯一の経路（§3.3）
│   │   ├── errors.ts         IpcError と、Renderer へ返す形への変換
│   │   └── handlers/
│   │       ├── system.ts          system ドメインの実装
│   │       ├── window.ts          閉じてよいかの返事（§12.7）
│   │       ├── workspace.ts       レイアウトの読み書き（workspace ドメイン）
│   │       ├── workspaceFolder.ts フォルダを開く / 閉じる（workspace-folder ドメイン・§8）
│   │       ├── files.ts           Workspace 内の列挙・読み込み・作成 / 改名 / 削除（§9・§10）
│   │       ├── terminal.ts        シェルの起動 / 入力 / 大きさ / 片付け（§13）
│   │       ├── git.ts             リポジトリの検出・変更ファイルの一覧・Stage / Unstage・Commit・Push / Pull・ブランチ・差分 / 破棄（§14）
│   │       └── settings.ts        アプリの設定の永続化（Editor は §12.4・Files は §10.14・Terminal は §13.4）
│   ├── workspaceFolder/      開いているプロジェクトフォルダ（§8）
│   │   ├── currentWorkspaceFolder.ts  現在の Workspace の正本（開く・閉じる・復元・購読）
│   │   └── folderPath.ts              パスの検証と表示名（Electron 非依存・テスト対象）
│   ├── files/                Workspace の中を読む / 書き換える / 見張る（§9・§10・§11・§12）
│   │   ├── workspacePath.ts           Workspace 境界の検証（Electron / fs 非依存・テスト対象）
│   │   ├── watchPaths.ts              監視から来たパスの扱い（fs 非依存・テスト対象・§12.1）
│   │   ├── ignoredDirectories.ts      走らない / 見張らないフォルダ（監視と検索で共有・§10.10）
│   │   ├── entrySort.ts               並び順（Electron / fs 非依存・テスト対象）
│   │   ├── fileEntry.ts               FileEntry の作り方（Electron / fs 非依存）
│   │   ├── fileContent.ts             バイナリ判定・改行・文字コード（fs 非依存・テスト対象）
│   │   ├── readWorkspaceDirectory.ts  フォルダ1つ分の列挙
│   │   ├── readWorkspaceFile.ts       ファイル1件の読み込み
│   │   ├── writeWorkspaceFile.ts      ファイル1件の保存（§11.6）
│   │   ├── mutateWorkspaceEntry.ts    作成 / 改名 / 移動 / コピー / 削除（§10.2）
│   │   ├── copyTree.ts                フォルダの再帰コピー（リンクを辿らない・§10.8）
│   │   ├── linkEntryType.ts           リンクの種別（列挙と検索で共有）
│   │   ├── searchWorkspaceFiles.ts    root から再帰的に探す（上限つき・§10.10）
│   │   ├── searchWorkspaceFileContents.ts 中身で探す（1件ずつ読む・上限つき・§10.11）
│   │   ├── contentMatches.ts          文字列 → 一致の位置と preview（fs 非依存・テスト対象・§10.11）
│   │   ├── searchQuery.ts             検索語の規則（名前 / 全文で共有・fs 非依存・§10.11）
│   │   ├── workspaceSearchSession.ts  今走っている検索1本の管理（名前 / 全文で共有・テスト対象・§10.10）
│   │   └── workspaceWatcher.ts        外部変更の監視（§12.1）
│   ├── terminal/             シェルのセッション（§13）
│   │   ├── shellCommand.ts            何を起動するかの表と解決（Electron / fs 非依存・テスト対象・§13.2）
│   │   ├── terminalEnvironment.ts     何を渡すか（同上・§13.3）
│   │   ├── outputCoalescer.ts         出力を束ねてから配る（同上・§13.5）
│   │   ├── childProcesses.ts          実行中かを OS に聞く（Electron 非依存・テスト対象・§13.9）
│   │   └── terminalSessions.ts        動いているセッションの表（node-pty に触れる唯一の場所）
│   ├── git/                  Workspace を Git リポジトリとして扱う（§14）
│   │   ├── gitExecutable.ts           git 本体の解決（Electron / fs 非依存・テスト対象・§14.1）
│   │   ├── gitCommands.ts             実行する引数の表（組み立てられる唯一の場所・§14.2）
│   │   ├── gitEnvironment.ts          git へ渡す環境変数（同上・テスト対象・§14.3）
│   │   ├── gitOutput.ts               出力の読み取り・パスの比較・ブランチの一覧（同上・テスト対象・§14.4・§14.14）
│   │   ├── gitStatusOutput.ts         status --porcelain=v2 の読み取り（同上・テスト対象・§14.8）
│   │   ├── gitFailure.ts              stderr の分類（同上・テスト対象・§14.6・§14.11・§14.12・§14.14）
│   │   ├── gitPathspec.ts             pathspec として通してよい形か（同上・テスト対象・§14.10）
│   │   ├── runGit.ts                  git を実行する唯一の場所（cwd は現在の Workspace・§14.2）
│   │   ├── gitQueue.ts                走るのは常に1本（§14.11）
│   │   ├── gitRepository.ts           検出と一覧の噛み合わせ（§14.4・§14.8）
│   │   ├── gitInit.ts                 `git init` の噛み合わせ（§14.17）
│   │   ├── gitStage.ts                Stage / Unstage の噛み合わせ（§14.11）
│   │   ├── gitCommit.ts               Commit の噛み合わせ（§14.12）
│   │   ├── gitSync.ts                 Push / Pull / Commit & Push の噛み合わせ（§14.13）
│   │   ├── gitBranches.ts             ブランチの一覧 / 切り替え / 作成の噛み合わせ（§14.14）
│   │   ├── gitBlob.ts                 ls-files / ls-tree の読み取り・object 名の検査（同上・テスト対象・§14.16）
│   │   ├── gitDiff.ts                 差分（左右の中身2つ）の噛み合わせ（§14.16）
│   │   ├── gitDiscard.ts              破棄（restore --worktree / ごみ箱）の噛み合わせ（§14.16）
│   │   ├── gitOperationResult.ts      書き込み操作の応答の形（§14.12）
│   │   ├── gitWatchPaths.ts           `.git` の中で拾う名前か（Electron / fs 非依存・テスト対象・§14.15）
│   │   ├── gitChangeSchedule.ts       いつ配るか（同上・テスト対象・§14.15）
│   │   └── gitWatcher.ts              `.git` を見張り `git:changed` を配る（§14.15）
│   ├── github/                        GitHub へ公開する（git とは別のドメイン・§14.17）
│   │   ├── githubExecutable.ts        gh 本体の解決（Electron / fs 非依存・テスト対象・§14.1 と同じ規則）
│   │   ├── githubEnvironment.ts       gh へ渡す環境変数（git 用の表が土台・同上・テスト対象）
│   │   ├── githubCommands.ts          gh の引数の表（組み立てられる唯一の場所）
│   │   ├── githubOutput.ts            作られた repository の URL の読み取り（純粋・テスト対象）
│   │   ├── githubFailure.ts           gh の stderr の分類（純粋・テスト対象）
│   │   ├── runGitHubCli.ts            gh を実行する唯一の場所（cwd は現在の Workspace）
│   │   ├── githubRepositoryPublisher.ts  repository を作る相手（差し替え可能な境界・設計判断 12）
│   │   ├── ghRepositoryPublisher.ts   その GitHub CLI 実装
│   │   └── publishRepository.ts       公開の噛み合わせ（作る → remote → 初回 Push）
│   ├── store/
│   │   ├── jsonStore.ts      userData 配下への JSON 永続化（共通部分）
│   │   ├── windowBounds.ts   ウィンドウ状態の検証（Electron 非依存・テスト対象）
│   │   ├── windowState.ts    ウィンドウ状態の保存と復元
│   │   ├── workspaceLayoutDocument.ts  レイアウト文書の検証（Electron 非依存・テスト対象）
│   │   ├── workspaceLayout.ts          レイアウトの保存先（userData 配下）
│   │   ├── workspaceFolderDocument.ts  Workspace 文書の検証（Electron 非依存・テスト対象）
│   │   ├── workspaceFolder.ts          Workspace の保存先（userData 配下）
│   │   ├── editorSettingsDocument.ts   Editor 設定の検証（Electron 非依存・テスト対象）
│   │   ├── editorSettings.ts           Editor 設定の保存先（userData 配下・§12.4）
│   │   ├── filesSettingsDocument.ts    Files の見え方の検証（Electron 非依存・テスト対象）
│   │   ├── filesSettings.ts            Files の見え方の保存先（userData 配下・§10.14）
│   │   ├── terminalSettingsDocument.ts Terminal の見え方の検証（Electron 非依存・テスト対象）
│   │   └── terminalSettings.ts         Terminal の見え方の保存先（userData 配下・§13.4）
│   ├── logger/index.ts       Main 側のログ出力
│   └── platform/
│       ├── index.ts          OS 依存判定の抽象化
│       └── executablePath.ts PATH の辿り方（Terminal と Git が共有・テスト対象・§13.2・§14.1）
├── preload/
│   ├── index.ts              contextBridge での公開
│   ├── ipc/invoke.ts         Main を呼ぶ唯一の経路
│   ├── ipc/subscribe.ts      Main からのイベントを受ける唯一の経路（§3.3）
│   └── api/                  ドメインごとの薄いラッパ（env / system / workspace / workspaceFolder / files / terminal / settings）
├── renderer/
│   ├── index.html            CSP を含む唯一の HTML
│   └── src/
│       ├── main.tsx / App.tsx    エントリ。App は Provider と Workspace Shell を置くだけ
│       ├── api/fluvix.ts        window.fluvix を参照する唯一の場所
│       ├── api/result.ts        IpcResult の扱いと UI 文言の対応表
│       ├── styles/
│       │   ├── theme.css        色・間隔の変数（値を直接書いてよい唯一の場所）
│       │   └── global.css       最小リセット
│       ├── workspace/           Workspace Shell（§7）
│       ├── workspaceFolder/     開いているフォルダの写しと Welcome（§8.6）
│       ├── files/               ファイルツリー・カラム・操作・検索（§9・§10.4・§10.10・§10.13）
│       │   ├── fileTreeModel.ts   状態 → 行の並び（React / DOM 非依存・テスト対象）
│       │   ├── fileChanges.ts     変化 → 読み直す範囲（React / DOM 非依存・テスト対象）
│       │   ├── useFileTree.ts     状態の保持と読み込み（列挙の IPC と変更通知の購読）
│       │   ├── moveTarget.ts      移動先になれるか（React / DOM 非依存・テスト対象・§10.7）
│       │   ├── clipboard.ts       コピーの控えと貼り付け先の判断（同上・§10.8）
│       │   ├── dragDrop.ts        ドロップ先 → 移動 / コピーの行き先（同上・§10.9）
│       │   ├── filesAutoScroll.ts ドラッグ中の自動スクロールの量（同上・テスト対象・§10.14）
│       │   ├── useFileDrag.ts     ドラッグの追跡（files/ で唯一 DOM を読む場所・§10.9・§10.14）
│       │   ├── useFileActions.ts  作成 / 改名 / 移動 / コピー / 削除の依頼
│       │   ├── fileSearchModel.ts 名前の検索の状態と文言（React / DOM 非依存・テスト対象・§10.10）
│       │   ├── useFileSearch.ts   名前の検索の状態の保持と取り消し（§10.10）
│       │   ├── fileContentSearchModel.ts 全文検索の状態と行の並び（同上・テスト対象・§10.11）
│       │   ├── useFileContentSearch.ts   全文検索の状態の保持と取り消し（§10.11）
│       │   ├── fileIcon.ts       名前 / 種別 → アイコンの種類（同上・テスト対象・§10.12）
│       │   ├── filesColumnsModel.ts カラムの列の並び（同上・テスト対象・§10.13）
│       │   ├── filesLayoutMode.ts   表示方式の決め方と幅の上下限（同上・テスト対象・§10.13）
│       │   ├── filesSettings.ts     見え方 ↔ 保存形式の変換（同上・テスト対象・§10.14）
│       │   ├── useFilesLayout.ts    パネルの形の観測（ResizeObserver は1か所・§10.13）
│       │   ├── useFilesController.ts 状態と操作（ツリーとカラムが共有する・§10.13）
│       │   ├── FilesViewProvider.tsx 見え方の正本と永続化（パネルより長く生きる・§10.14）
│       │   ├── FilesView.tsx      一覧 / 検索の切り替え（パネルは増やさない・§10.10）
│       │   ├── FilesExplorer.tsx  器と表示方式の出し分け（§10.13）
│       │   ├── FileTree.tsx       縦に並べる + キーボード操作
│       │   ├── FileColumns.tsx    横に並べる + キーボード操作（§10.13）
│       │   ├── FileRows.tsx       ツリーとカラムで同じ行（状況・名前の入力・§10.13）
│       │   ├── FileSearch.tsx     検索モードの枠（ファイル名 / 全文の切り替え・§10.11）
│       │   ├── FileNameSearch.tsx 名前の検索欄と結果（§10.10）
│       │   ├── FileContentSearch.tsx 全文検索の検索欄と結果（§10.11）
│       │   ├── FileNameInput.tsx  ツリー内での名前の入力（作成・改名で共通）
│       │   ├── FileContextMenu.tsx 右クリックメニュー
│       │   ├── DeleteConfirm.tsx  削除の確認
│       │   ├── FileTreeIcons.tsx  その場で描く SVG（外部アセットを持たない・§10.12）
│       │   ├── filesError.ts      失敗の分類と文言
│       │   └── files.css          ツリー / カラム / 検索の見た目
│       ├── editor/              開いているファイルのタブと中身（§10.3・§11・§12）
│       │   ├── editorTabsModel.ts  タブの操作（React / DOM 非依存・テスト対象）
│       │   ├── editorTabState.ts   タブの状態の導き方（純粋・テスト対象。§12.3）
│       │   ├── editorReveal.ts     開いた後に見せる位置の依頼（純粋・§10.11）
│       │   ├── useEditorTabs.ts    タブ状態の保持と中身の読み込み
│       │   ├── useEditorSession.ts タブ・Model・保存・自動保存・競合の噛み合わせ（§11.5）
│       │   ├── useTabCloseGuard.ts 未保存のタブを閉じる前の確認（§12.6）
│       │   ├── autoSave.ts         Auto Save の設定モデル（純粋・テスト対象。§12.4）
│       │   ├── context.ts          Context の定義（Files が開き、Editor が出す）
│       │   ├── EditorProvider.tsx  Shell の外側でタブと Model を持ち、未保存を申告する
│       │   ├── EditorWorkArea.tsx  タブ列・自動保存の切り替え・中身の組み立て
│       │   ├── EditorTabs.tsx      タブ列（未保存 / Conflict / 削除済みの印）
│       │   ├── EditorDocumentView.tsx 何を出す状態か（Monaco / binary / too-large / 失敗）
│       │   ├── EditorConflictBar.tsx  Reload / Compare / 上書き（§12.3）
│       │   ├── TabCloseConfirm.tsx    タブ1枚ぶんの確認
│       │   ├── editor.css
│       │   └── monaco/            Monaco Editor（§11）
│       │       ├── language.ts        拡張子 → 言語 id（Monaco 非依存・テスト対象）
│       │       ├── monacoSetup.ts     Monaco 本体・Worker・テーマ・言語サービス
│       │       ├── documentStore.ts   Model / 未保存 / 食い違い / カーソル位置の持ち主
│       │       ├── MonacoEditor.tsx   エディタの器（遅延読み込みの入口）
│       │       └── MonacoDiffEditor.tsx Compare の差分（遅延読み込み）
│       ├── terminal/           動いているシェルと、その画面（§13）
│       │   ├── terminalTabsModel.ts   タブの並びの規則（React / DOM 非依存・テスト対象・§13.6.1）
│       │   ├── terminalDisplay.ts     見え方の既定値・範囲・打鍵の判断（React / DOM 非依存・テスト対象・§13.4）
│       │   ├── terminalSettings.ts    見え方 ↔ 保存形式の変換（同上・テスト対象・§13.4）
│       │   ├── useTerminalSettings.ts 見え方の正本と永続化（いつ読み、いつ書くか・§13.4）
│       │   ├── terminalScreenStore.ts xterm のインスタンスの持ち主（パネルより長く生きる・§13.6）
│       │   ├── useTerminalTabs.ts     タブごとのセッションの状態と IPC（§13.6・§13.6.1）
│       │   ├── useTerminalCloseGuard.ts 実行中のタブを閉じる前の確認（§13.9）
│       │   ├── terminalError.ts       失敗の文言（React / DOM 非依存）
│       │   ├── context.ts             Context の定義
│       │   ├── TerminalProvider.tsx   Shell の外側でセッションと画面を持ち、実行中を申告する
│       │   ├── TerminalView.tsx       何を出す状態か（起動中 / 動作中 / 終了 / 失敗）
│       │   ├── TerminalTabs.tsx       タブ列と、開く入口（＋ / シェルの選択 / 設定）
│       │   ├── TerminalSettingsMenu.tsx 表示設定の面（文字の大きさ・行数・§13.4）
│       │   ├── TerminalCloseConfirm.tsx タブ1枚ぶんの確認（§13.9）
│       │   ├── TerminalSurface.tsx    画面を置く器（遅延読み込みの入口・§13.7）
│       │   ├── xtermSetup.ts          xterm 本体・テーマ・測り直し（§13.7）
│       │   └── terminal.css
│       ├── git/               Workspace と Git リポジトリの関係（§14）
│       │   ├── gitRepositoryMessage.ts 状態 → 画面に出す文言（React / DOM 非依存・テスト対象・§14.6）
│       │   ├── gitChanges.ts          変更の一覧 → 画面に並べる形・行に置く操作・Commit が押せるか・破棄の確認の文言（React / DOM 非依存・テスト対象・§14.9・§14.11・§14.12・§14.16）
│       │   ├── gitBranches.ts         ブランチの一覧 → 面に並べる形・作れる名前か（React / DOM 非依存・テスト対象・§14.14）
│       │   ├── useGitRepository.ts     状態の保持・いつ調べ直すか（`files:changed` / `git:changed` の合流）・Stage / Unstage / Commit / Push / ブランチ / 差分 / 破棄 の実行（§14.5・§14.11・§14.12・§14.14・§14.15・§14.16）
│       │   ├── GitView.tsx             何を出す状態か（ブランチ / 一覧 / 案内 / 操作 / Commit 欄 / 差分の面・§14.9・§14.11・§14.12・§14.16）
│       │   ├── GitBranchMenu.tsx       ブランチを選ぶ / 作る面（ui/Popover の中身・§14.14）
│       │   ├── gitDiff.ts             差分の面に出す言葉・開ける行か（React / DOM 非依存・テスト対象・§14.16）
│       │   ├── GitDiffOverlay.tsx      一覧の上に重なる読み取り専用の差分（§14.16）
│       │   ├── GitDiscardConfirm.tsx   破棄の確認（§12.6・§14.16）
│       │   ├── GitInitConfirm.tsx      `git init` の確認（Workspace 名つき・§14.17）
│       │   ├── githubPublish.ts        公開の面に出す言葉・公開できるか（React / DOM 非依存・テスト対象・§14.17）
│       │   ├── GitHubPublishForm.tsx    GitHub に公開する面（畳んである・§14.17）
│       │   ├── GitIcons.tsx            Stage / Unstage / 差分 / 破棄 のアイコン（Files と同じ描き方・§14.11・§14.16）
│       │   └── git.css
│       ├── ui/                 パネルをまたいで使う器
│       │   ├── Popover.tsx          ボタンの真下に開く面（開閉と閉じ方だけを持つ）
│       │   ├── DropdownMenu.tsx     その面に項目を並べたもの（上部バー / Terminal のタブ列）
│       │   └── menu.css
│       └── unsaved/            失われるものがある操作に挟む確認（§12.6）
│           ├── types.ts             申告と確認の型（React / DOM 非依存）
│           ├── lossMessage.ts       確認の文面（React / DOM 非依存・テスト対象・§12.6）
│           ├── context.ts           Context の定義
│           ├── UnsavedChangesProvider.tsx 確認の器（App の一番外）
│           ├── UnsavedChangesDialog.tsx   まとめて尋ねる確認
│           ├── useWindowCloseRequest.ts   閉じてよいかの問い合わせに答える
│           └── unsaved.css
└── shared/
    ├── api.ts                window.fluvix の型
    ├── ipc/                  IPC の契約（要求 / 応答とイベント。§3）
    ├── workspace/            レイアウトの保存形式（§7.8）と Workspace の型（§8.2）
    ├── files/                ファイルの型・上限・名前の規則・コピー名の規則・相対位置・変化・文字コード・検索の規則・全文検索の上限と結果の型
    ├── terminal/              セッションの型・上限・大きさの正規化・シェルの選択肢（§13）
    ├── git/                   リポジトリの状態・HEAD・失敗の分類・変更ファイルの一覧・操作の対象と結末・Commit メッセージの規則・ブランチの一覧と名前の規則（§14）
    ├── github/                公開範囲・GitHub CLI の状態・repository 名の規則（§14.17）
    └── settings/             アプリ設定の保存形式（Editor は §12.4・Files の見え方は §10.14）
```

**「Workspace」という語は3つの意味に使われる**（DESIGN.md §3 の用語表）。実装での呼び分けは次のとおりで、ディレクトリ名・IPC ドメイン名もこれに従う。

| 意味                           | 実装での名前     | 場所                                                          |
| ------------------------------ | ---------------- | ------------------------------------------------------------- |
| 画面全体の器（Dockable UI）    | Workspace Shell  | `renderer/src/workspace/`（§7）                               |
| その配置の保存                 | Workspace Layout | `workspace:*` ドメイン / `workspace-layout.json`（§7.8）      |
| 開いているプロジェクトフォルダ | Workspace Folder | `workspace-folder:*` ドメイン / `workspace-folder.json`（§8） |

---

## 3. IPC

### 3.1 流れ

```
Renderer            fluvix.system.ping({ token })
   ↓
Preload             invokeIpc('system:ping', request)      ← 唯一の送信経路
   ↓
Main / registry     送信元の検証 → ハンドラ実行 → 例外を捕捉
   ↓
Main / handler      成功なら値を return、失敗なら IpcError を throw
   ↓
Renderer            IpcResult<T>（{ ok: true, data } | { ok: false, error }）
```

方針は3つ。

1. **IPC 境界を例外が越えない。** 戻り値は必ず `IpcResult` で、失敗も正常な戻り値として返る。
2. **失敗は `code` で分類する。** `message` は開発者向けで、UI 文言は Renderer 側の対応表（`renderer/src/api/result.ts`）が決める。
3. **チャンネルは契約にあるものだけ。** Renderer に `ipcRenderer` を渡していないため、契約外のチャンネルは呼びようがない。

### 3.2 ドメインを追加する手順

1. `shared/ipc/contracts/<domain>.ts` に契約（チャンネル名・要求・応答）を定義する
2. `shared/ipc/contract.ts` の `IpcContract` に `extends` で追加する
3. `shared/ipc/channels.ts` に定数を追加する（漏れると型エラーになる）
4. `main/ipc/handlers/<domain>.ts` を実装し、`main/ipc/index.ts` の登録リストへ足す
5. `preload/api/<domain>.ts` を作り、`preload/api/index.ts` と `shared/api.ts` の `FluvixApi` へ足す

### 3.3 Main → Renderer のイベント

Session 3-3 で追加した、要求と応答の対になるもう1本の経路。Terminal の出力・ファイルの変更・Git の状態変化・LSP / DAP の通知のように、**Main の側から一方的に流れるもの**をここに載せる。

```
Main / handler      emitIpcEvent('files:changed', payload)
   ↓
main/ipc/events.ts  アプリのウィンドウすべてへ送る（送れなくても失敗にしない）
   ↓
Preload             subscribe.ts が Electron の event を剥がし、payload だけを渡す
   ↓
Renderer            window.fluvix.files.onChanged(listener) → 解除の関数
```

#### 要求 / 応答とは別の契約にする

`IpcContract`（`contract.ts`）が扱うのは Renderer → Main の「要求と応答」だけで、対になる相手が必ず居る。イベントは片道で、**誰も要求していないのに届く / 誰も受け取っていないかもしれない / 1回の出来事が複数の受け手へ同時に届く**という性質を持つ。同じ契約に混ぜると `request` が意味を失い、「応答が来ない invoke」と「送りっぱなしの通知」が型の上で区別できなくなる。

そのため `IpcEventContract`（`event.ts`）を別に置き、チャンネル名の定数も `eventChannels.ts` に分けた。追加の手順は要求 / 応答と揃えてある（契約 → `extends` → 定数 → 実装）。定数の足し忘れは同じ形の型アサーションが検出する。

| 層       | ファイル               | 責務                                               |
| -------- | ---------------------- | -------------------------------------------------- |
| shared   | `ipc/event.ts`         | チャンネル名と payload の対応、購読の型            |
| shared   | `ipc/eventChannels.ts` | 定数と、購読してよいチャンネルかの判定             |
| Main     | `ipc/events.ts`        | 送る先の決定と、閉じかけのウィンドウの扱い         |
| Preload  | `ipc/subscribe.ts`     | チャンネルの検査と、Electron の event を剥がすこと |
| Renderer | `<domain>Api.on…`      | 購読と解除                                         |

#### 守っていること

- **Renderer へ `IpcRendererEvent` を渡さない。** これは `sender`（＝`ipcRenderer` 相当）と `ports` を持つ。そのまま listener へ流すと、contextBridge で切り離したはずの経路がイベントの引数として復活する。剥がすのは Preload の責務
- **購読できるのは契約にあるチャンネルだけ。** Renderer から届いた文字列をそのまま `ipcRenderer.on` へ渡さない。契約外を購読できると、Main が内部で使う任意のチャンネルを盗み聞きできてしまう（invoke 側で契約外を呼べないのと同じ線）
- **戻り値が解除の関数そのもの。** チャンネル名と関数を渡し直して解除する形にすると、無名関数で購読した箇所が解除できず、画面の一部を作り直すたびに listener が積み上がる
- **送れなくても失敗にしない。** ウィンドウがまだ無い / もう閉じている場合は黙って戻る。片道の通知が Main 側の処理を止める理由にならない
- **送るのはアプリのウィンドウすべて。** イベントは「Workspace で起きた出来事」であって特定のウィンドウ宛ての返事ではない。パネルを独立ウィンドウ化しても送る側は変わらない（`windows/mainWindow.ts` が `getAllWindows()` を避けているのは**同一性**の話で、ここは**集合**の話）
- **受け手は `workspaceId` を突き合わせる。** イベントには「要求」という対応関係が無く、受け手側で世代を数える手段がない。切り替えの前後で行き違った通知は捨てる

現在流れているのは5つ。LSP / DAP の通知も同じ経路に載せる。

| チャンネル               | 内容                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `files:changed`          | Workspace の中のファイルの変化（アプリの操作 / 外部変更。§10.5・§12.1） |
| `window:close-requested` | ウィンドウを閉じてよいかの問い合わせ（§12.7）                           |
| `terminal:data`          | シェルからの出力（§13.5）                                               |
| `terminal:exit`          | シェルが終わった（§13.5）                                               |
| `git:changed`            | `.git` が変わった（Session 3-8-8。§14.15）                              |

**`git:changed` を `files:changed` に相乗りさせていない。** 同じ「変わった」でも運ぶものが違う ── `files:changed` が運ぶのは「どの位置がどうなったか」（`WorkspaceFileChange`）で、`.git/index` が書き換わったことに当てはまる相対位置は存在しない。そもそも `files:changed` は `.git` を**除外することで**成り立っている（§12.1）ため、相乗りさせるにはその除外に穴を開けることになり、Files のツリーと Editor が `.git` の中の変化を受け取り始める（§14.15）。

`window:close-requested` だけは**応答を期待する**イベントで、他とは性質が違う。片道の経路にそれを載せているのは、対になる応答が「同じウィンドウから、同じ `requestId` で戻ってくる別の要求」でしかないため（Renderer が利用者に尋ねている間、Main の invoke を待たせ続ける形にしない）。送り先も**そのウィンドウ1つ**で、`emitIpcEvent`（全ウィンドウ）は通らない ── 「閉じてよいか」はそのウィンドウ宛ての問いかけであって、Workspace で起きた出来事の通知ではない。

---

## 4. 状態の永続化

保存されるものはどれも `app.getPath('userData')`（Windows では `%APPDATA%/Fluvix Nexus`）配下の小さな JSON になる。インストール先にもプロジェクトフォルダにも書かない。

| ファイル                 | 内容                                     | 検証（Electron 非依存）             | 保存を決める場所            |
| ------------------------ | ---------------------------------------- | ----------------------------------- | --------------------------- |
| `window-state.json`      | ウィンドウのサイズ・位置・最大化         | `store/windowBounds.ts`             | `store/windowState.ts`      |
| `workspace-layout.json`  | Workspace レイアウト（§7.8）             | `store/workspaceLayoutDocument.ts`  | `store/workspaceLayout.ts`  |
| `workspace-folder.json`  | 最後に開いていたフォルダ（§8.5）         | `store/workspaceFolderDocument.ts`  | `store/workspaceFolder.ts`  |
| `editor-settings.json`   | Editor の設定（Auto Save。§12.4）        | `store/editorSettingsDocument.ts`   | `store/editorSettings.ts`   |
| `files-settings.json`    | Files の見え方（表示方式・幅。§10.14）   | `store/filesSettingsDocument.ts`    | `store/filesSettings.ts`    |
| `terminal-settings.json` | Terminal の見え方（大きさ・行数。§13.4） | `store/terminalSettingsDocument.ts` | `store/terminalSettings.ts` |

**用途ごとに1ファイル・1チャンネルにする。** 設定が2つになった時点で `editor-settings.json` へ相乗りさせる選択肢はあったが、そうすると「Editor の設定」という限定が最初の相乗りで消え、片方の保存の失敗がもう片方を巻き込む（§5「永続化の API を用途ごとに切る」）。増やすのはファイルとチャンネルであって、既存の文書の項目ではない。3つめ（Terminal。Session 3-7-5）も同じ形をそのままなぞっており、**同じ形が3つ並んだ**ことでこれがこのアプリの設定の形になった。

共通の作法は `jsonStore.ts` が持つ。

- 保存は変化のたびに予約し、400ms 間引いてから一時ファイル経由で書き換える（書き込み中に落ちても既存ファイルが壊れない）。
- **読み込み時は必ず検証する。** 保存ファイルは利用者が手で編集できる場所にあり、アプリのバージョン差で形も変わる。壊れていれば既定値へ戻す（ウィンドウなら標準サイズ、レイアウトなら Default プリセット）。
- 保存に失敗してもアプリは止めない。次回起動が前回保存できた状態に戻るだけで済むため。

ウィンドウ状態は画面外判定（モニタ構成の変化）も見る。レイアウト側の検証は Main と Renderer で分担しており、その線引きは §7.8。Workspace は Main だけが検証する（§8.5）── レイアウトと違い、その値を使うのが Main 自身だから。

利用者が自分の配置に名前を付けて保存する機能（DESIGN.md §3）は未実装。組み込みのプリセットはコード側（§7.7）にあるため保存の対象ではなく、追加するなら `workspace-layout.json` と同じ経路にもう1ファイル増やす形になる。

メインウィンドウの参照は `windows/mainWindow.ts` が保持する。「もう開いているか」を `BrowserWindow.getAllWindows()` で判定していないのは、GitHub パネルを独立ウィンドウ化した時点で意味が変わるため。

---

## 5. セキュリティの現状

| 項目                                 | 状態                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| contextIsolation                     | 有効                                                                                               |
| nodeIntegration                      | 無効                                                                                               |
| sandbox                              | 有効                                                                                               |
| webviewTag                           | 無効（attach も拒否）                                                                              |
| Renderer から見える Node / Electron  | なし（`window.require` / `window.process` ともに undefined）                                       |
| 外部サイトへの遷移                   | 拒否（メインフレーム・サブフレームとも）                                                           |
| `window.open` / 新規ウィンドウ       | 拒否                                                                                               |
| Web 権限（通知・位置情報・カメラ等） | 既定拒否（要求・確認の両経路 + デバイス権限）                                                      |
| CSP                                  | `default-src 'self'` を基本に、`object-src` / `frame-src` / `base-uri` / `form-action` を `'none'` |
| IPC の送信元                         | アプリのウィンドウ以外からの呼び出しを拒否                                                         |
| ファイルへの書き込み                 | 用途を限定した API のみ（パスは Renderer から指定できない）                                        |
| 開くフォルダの指定                   | Renderer から渡せない（選ぶのはネイティブのダイアログだけ。§8.4）                                  |
| フォルダの中身を読む                 | 現在の Workspace の中だけ。root は Renderer から渡せない（§9.3）                                   |
| ファイルの作成 / 改名 / 削除         | 現在の Workspace の中だけ。読む側と同じ検証を通す（§10.2）                                         |
| ファイルの保存（上書き）             | 現在の Workspace の中だけ。**対象自身**の実体を確かめる（§11.6）                                   |
| 削除の方式                           | OS のごみ箱へ送るのみ。完全削除の経路を公開しない（§10.2）                                         |
| ファイルの監視                       | Main だけ。Renderer に filesystem の API を渡さず、届くのは相対位置だけ（§12.1）                   |
| 設定の保存                           | 用途専用の API のみ。保存先のパスもファイル名も Renderer から指定できない（§12.4）                 |
| ウィンドウを閉じる / アプリ終了      | Renderer から始められない。返事を返す口だけを公開する（§12.7）                                     |
| Main → Renderer のイベント           | 契約にあるチャンネルだけ購読できる。Electron の event は Preload が剥がす（§3.3）                  |
| Monaco の Worker                     | アプリにバンドルしたものだけ。blob: も外部 CDN も経由しない（§11.2。Diff Editor も同じ）           |
| シェルの起動                         | 起動する実行ファイルは Main の表が決める。PATH は辿って絶対パスで起動する（§13.1・§13.2）          |
| git の実行                           | コマンド・引数・作業ディレクトリを Renderer から渡せない（要求は `void`。§14.2）                   |
| git 本体の解決                       | PATH に任せず辿る。作業ディレクトリの中の `git.exe` は起動されない（§14.1）                        |

ガードは webContents 単位（`app.on('web-contents-created')`）で掛けている。ウィンドウが増えても掛け忘れが起きない形にするため。

### 永続化の API を用途ごとに切る

`workspace:save-layout` / `workspace:load-layout` が扱うのは Workspace レイアウトだけで、保存先のパスもファイル名も Renderer からは指定できない（`store/workspaceLayout.ts` が決める）。汎用のファイル読み書きを1つ公開すると、Renderer を OS から切り離している前提がそこで崩れる。

そのため、**別のものを保存したくなったらその用途専用の API を足す**という方針を取る。受け取った内容は Main 側でも検証してから書く（`store/workspaceLayoutDocument.ts`）。Renderer から届く値も境界の外から来たものとして扱い、想定外の内容や桁違いの大きさをそのままディスクに残さないため。

Session 3-1 の Workspace（開いているフォルダ）もこの方針に従い、レイアウトの API に相乗りさせず `workspace-folder:*` として別に足した（保存先も別ファイル）。こちらは Renderer が保存内容を組み立てることすらせず、Main が自分で作って書く（§8.4）。

Session 3-6-8 の Files の見え方（表示方式・カラムの幅）も同じで、既にある `settings:load-editor` / `settings:save-editor` に項目を足すのではなく `settings:load-files` / `settings:save-files` を足した（§10.14）。**同じドメインの中でも用途は切る** ── 「settings」は保存先の種類ではなく、保存を扱う場所の名前にすぎない。

### CSP の運用

- 実効的なポリシーは配布ビルド（`file://`）で全体に適用される。開発時は Vite が HMR 用の script タグを meta より前に差し込むため、その2つだけ適用外になる。**CSP の確認は必ずビルド後のアプリで行う。**
- 外部 CDN・外部フォント・外部 API は使わない。通信が必要になっても Renderer から直接叩かず Main 経由にする。
- **Monaco Editor は `worker-src 'self'` のまま動いている**（Session 3-4）。Monaco の既定の経路は Worker の起動用スクリプトを blob として作るため、そこを `MonacoEnvironment.getWorker` で迂回している（§11.2）。xterm.js を入れる際も同じ判断をする。
- `style-src` の `'unsafe-inline'` は、React / Monaco / xterm が実行時に style を注入するため必要。
- Monaco が使うアイコンフォント（codicon）は npm パッケージに同梱されたものがバンドルされる。`font-src 'self'` の範囲に収まり、外部フォントは増えていない。

---

## 6. 今後の機能を受け入れる余地

| 予定している機能                   | 現状の受け口                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockable UI / レイアウトプリセット | Workspace Shell（§7）。**STEP 2 として完成**（Dock / Split・ドラッグ&ドロップ・境界のリサイズ・表示管理・プリセットの器・レイアウトの保存 / 復元）。残りは §7.9                                   |
| Monaco Editor                      | **§11 / §12 として実装済み**（Worker・Model 管理・言語判定・保存・外部変更・Conflict・Auto Save）                                                                                                 |
| LSP                                | 言語 id は `editor/monaco/language.ts` が決める（§11.4）。サーバのプロセス起動は Main（`platform/` に OS 依存部分）、通知は §3.3 の経路                                                           |
| Files                              | **§9 / §10 として実装済み**（列挙・読み込み・作成 / 改名 / 移動 / コピー / 削除・保存・外部変更の追従・検索）                                                                                     |
| Settings（設定の永続化）           | **§12.4 として実装済み**（`settings:*` ドメイン）。設定を足すならチャンネルを増やす。画面は後続                                                                                                   |
| Terminal                           | **§13 として実装済み**（node-pty は Main・作業ディレクトリは §8・出力は §3.3 の経路）。複数タブは同じ表に足す                                                                                     |
| Git / GitHub パネル                | **§14 として実装済み**（git の実行基盤・検出・一覧・Stage / Unstage・Commit・Push / Pull・ブランチ・`.git` の監視・差分と破棄・`git init` と GitHub への公開）。増やすときは操作ごとに1本ずつ切る |
| GitHub パネルの独立ウィンドウ化    | セキュリティガードは webContents 単位、IPC は送信元ウィンドウを `IpcContext` で受け取れる。イベントは全ウィンドウへ届く（§3.3）                                                                   |
| DAP                                | Terminal / LSP と同じ経路（Main でプロセス、IPC でやり取り、通知は §3.3）                                                                                                                         |
| Mac 対応                           | OS 依存判定は `platform/`。Renderer / shared に OS 依存は入っていない                                                                                                                             |

STEP 1 から持ち越していた **Main → Renderer のイベント経路**は Session 3-3 で用意した（§3.3）。残る機能はいずれも現在の構造のまま追加できる。

---

## 7. Workspace Shell（Renderer の画面構造）

Dockable UI（DESIGN.md §3）の土台であり、**STEP 2 の成果物そのもの**。Session 2-1 で骨格を、Session 2-2 で Dock / Split のデータモデルと操作を、Session 2-3 でそれをマウスで動かすドラッグ&ドロップを、Session 2-4 で境界のリサイズを、Session 2-5 でパネルの表示管理とレイアウトプリセットの器を、Session 2-6 でレイアウトの保存 / 復元を実装し、Session 2-7 で全体を統合的に検証して構造を整えた。パネルの本機能はまだ入っていない（STEP 3）。

### 7.1 構成

```
src/renderer/src/workspace/
├── WorkspaceShell.tsx        画面全体の組み立て（唯一の入り口）
├── useWorkspaceLayout.ts     レイアウト状態の保持（layout/ と persistence/ を束ねる）
├── workspace.css             枠の見た目（分割・掴み手・タブ・上下のバー・ドロップ表示・メニュー）
├── workspace.integration.test.ts  STEP 2 全体を1本の流れとして通す統合テスト
├── layout/                   レイアウトを「データ」として扱う層（React / DOM 非依存）
│   ├── types.ts              DockNode（group / split）と WorkspaceLayout
│   ├── nodeId.ts             ノード id の発番（layout/ で唯一状態を持つ）
│   ├── tree.ts               木の探索・組み立て・正規化・検証（テスト対象）
│   ├── operations.ts         Dock / Split 操作の純粋関数（テスト対象）
│   ├── resize.ts             サイズ操作の純粋関数（テスト対象）
│   ├── panelVisibility.ts    パネルの表示 / 非表示と再表示時の配置（テスト対象）
│   ├── constraints.ts        最小サイズ・掴み手の太さと、その計算（テスト対象）
│   ├── defaultLayout.ts      Default プリセットの配置
│   └── presets.ts            レイアウトプリセットの表（テスト対象）
├── dnd/                      マウス操作を Dock 操作の引数へ翻訳する層
│   ├── types.ts              DockZone / DropCandidate / PanelDragState
│   ├── dockGuide.ts          座標 → DockZone の判定（テスト対象・DOM 非依存）
│   ├── dropTarget.ts         DockZone → DockTarget の翻訳と可否（テスト対象）
│   └── usePanelDrag.ts       ドラッグの追跡（唯一 DOM に触れる場所）
├── resize/                   ポインタの移動量をサイズ操作の引数へ翻訳する層
│   ├── types.ts              SplitBoundary / SplitResizeState
│   └── useSplitResize.ts     境界のドラッグの追跡（唯一 DOM に触れる場所）
├── persistence/              レイアウトを保存形式と行き来させる層（§7.8）
│   ├── layoutDocument.ts     保存形式との相互変換・検証・マイグレーション（テスト対象）
│   ├── restoreLayout.ts      復元の入口（ノード id の予約を伴う。テスト対象）
│   └── useLayoutPersistence.ts 起動時の読み込みと、変更の間引き保存（唯一 IPC を呼ぶ場所）
├── shell/                    枠を描くコンポーネント
│   ├── DockNodeView.tsx      木を辿って描く（split の並びと掴み手を作る）
│   ├── DockArea.tsx          Dock 可能な1領域（木の葉）。当たり判定用に自分を預ける
│   ├── DockResizeHandle.tsx  領域と領域の間の掴み手
│   ├── PanelGroup.tsx        パネルを置く共通コンテナ（タブ + 閉じる + 本体）
│   ├── DockGuideOverlay.tsx  ドロップ先の表示（5方向のガイドと結果のプレビュー）
│                             （上部バーのドロップダウンは ui/DropdownMenu.tsx へ引き上げ済み）
│   ├── WorkspaceTopBar.tsx   上部領域（Dock 対象外）
│   └── WorkspaceStatusBar.tsx 下部領域（Dock 対象外）
└── panels/                   パネルの中身と Registry
    ├── types.ts              PanelId / PanelDefinition
    ├── registry.ts           PanelId → 定義の対応表
    └── <Name>Panel.tsx       各パネル（現在は仮表示）
```

### 7.2 責務の分け方

| 層                    | 責務                                                     | やってはいけないこと                     |
| --------------------- | -------------------------------------------------------- | ---------------------------------------- |
| Shell                 | 領域の構成、パネルをどこに置くか、パネル共通の枠         | パネル固有の事情を持つ                   |
| Panel                 | 自分の中身だけ                                           | 自分の配置・サイズ・可視状態を前提にする |
| useWorkspaceLayout.ts | レイアウトを state として持ち、下の3層を束ねる           | レイアウトの意味を自分で決める           |
| layout/               | レイアウトのデータ表現と操作                             | React / DOM / 上位の層に依存する         |
| dnd/                  | マウス操作の解釈（どこへ落とそうとしているか）           | レイアウトを直接書き換える               |
| resize/               | ポインタの移動量の解釈（どの境界をどれだけ動かしたか）   | レイアウトを直接書き換える               |
| persistence/          | 保存形式との変換と、いつ読み書きするか                   | レイアウトの意味を新しく決める           |
| Registry              | PanelId から実体（表示名・識別色・コンポーネント）を解決 | レイアウトの状態を持つ                   |

要点は **画面の状態を JSX ではなく `WorkspaceLayout` というデータで表す**こと。レイアウトは `PanelId` の並びしか持たず、実体への解決は Registry が行う。この間接参照があるため、Dock / Split / リサイズはすべて「データの操作」に還元でき、レイアウトの保存・復元も JSON のまま扱える。

**参照は必ず上から下へ向かう。**

```
WorkspaceShell.tsx
   └── useWorkspaceLayout.ts      ← React に依存し、下の3層を束ねる唯一の場所
         ├── dnd/                 ┐
         ├── resize/              ├→ どれも layout/ を参照する
         ├── persistence/         ┘
         └── layout/              ← 何も参照しない（React も DOM も Registry も知らない）
```

`layout/` が下位にあり、`dnd/` `resize/` `persistence/` が横に並ぶ形にしてあるのは、機能が増えても依存が往復しないようにするため。Session 2-7 で `useWorkspaceLayout.ts` を `layout/` の中から Shell の隣へ移したのはこの理由による（`layout/` の中に置くと、データ層が保存の都合を知ることになり `layout/ ↔ persistence/` の参照が往復する）。

### 7.3 レイアウトのデータ構造（Dock / Split）

レイアウトは **領域の木**。`WorkspaceLayout` が持つのは根ノード1つだけで、「左」「下」といった位置は木の形から決まる結果であり、領域自身の属性ではない。

```
DockNode = DockGroupNode | DockSplitNode

group  … パネルを置く葉。panelIds（タブの並び）と activePanelId を持つ
split  … 領域を分ける枝。direction（row = 横並び / column = 縦並び）と children（2つ以上）
```

初期レイアウトの木:

```
split(column)
├── split(row)
│   ├── group[files]    240px
│   ├── group[editor]   残り
│   └── group[git]      280px
└── group[terminal]     220px
```

**size** は親の並び方向における基準サイズ。数値なら固定、`null` なら残りを埋める（同じ親に複数あれば等分）。新しく作られる領域は必ず `null` にするため、分割は常に等分から始まる。

**正規形**（`tree.ts` の `findLayoutProblems` が定義し、すべての操作が結果として保つ）:

1. 同じ `PanelId` が2箇所に現れない
2. パネルが無い group は木に無い（根だけは例外＝全パネルを閉じた状態）
3. split の子は2つ以上（型でも `readonly [DockNode, DockNode, ...DockNode[]]` として表現）
4. 同じ向きの split が入れ子になっていない（size を持つものは対象外）
5. `activePanelId` はその group にあるパネルを指している

不正な状態を作りにくくするための仕掛けは4つ。

- `DockNodeId` は branded type。素の文字列から作れるのは `nodeId.ts` だけ
- split の children は「2つ以上」を型で表す
- 領域を空にしうる操作は `tree.ts` の `mapGroup` を通り、空の group の除去と子が1つになった split の畳み込みがその場で起きる
- 開発ビルドでは操作のたびに `findLayoutProblems` で検査し、壊れた瞬間に console へ出す（配布ビルドでは丸ごと落ちる）

主な操作（すべて純粋関数で、入力を書き換えず、変化が無ければ元のオブジェクトを返す）。木の形を変える操作は `operations.ts`、大きさだけを変える操作は `resize.ts` に分けてある:

| 関数                                        | 内容                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `movePanel(layout, panelId, target)`        | Dock 操作の入口。target は `tab`（既存領域へ）か `split`（対象を分割してその側へ） |
| `splitNodeWithPanel(...)`                   | ノードを分割し、新しい領域へパネルを1枚置く                                        |
| `removePanelFromLayout(layout, panelId)`    | パネルを外す。空になった領域は自動で片付く（パネルを閉じる操作の実体）             |
| `activatePanelInLayout(...)`                | 領域内のタブ切り替え                                                               |
| `openPanelInLayout(...)`                    | 閉じたパネルを既定の位置へ戻す（§7.7）                                             |
| `resizeNode(layout, nodeId, size)`          | ノード1つの基準サイズを差し替える（px か null）                                    |
| `resizeSplitBoundary(layout, splitId, ...)` | split の中の1つの境界を動かす（§7.6）                                              |

`movePanel` は必ず「取り除いてから入れる」ため、同じパネルが2箇所に現れない。分割時、親が既に同じ向きの split で対象が `size: null` なら入れ子を作らず兄弟として差し込む（木を浅く保つ）。

対象が px サイズを持つ場合の扱いは `splitStyle` が決める。既定の `'carve'` では入れ子にして、新しい split がその px を引き継ぐ（220px の領域を分けたとき、外から見た大きさが 220px のままになるように）。`'insert'` は px を持つ対象でも兄弟として差し込む。ドロップは前者（「この領域を割る」）、閉じたパネルを元の並びへ戻すのは後者（「この領域の隣に置く」）。

`splitNodeWithPanel` の対象は領域（葉）に限らず木のどのノードでもよい。ドロップ先は必ず画面上の1領域なので `DockTarget` は葉しか指さないが、レイアウト操作としては制限する理由が無く、「Files / Editor / Git が並んでいる範囲全体の下へ Terminal を戻す」のように部分木の隣へ置きたい場面がある（§7.7）。

### 7.4 パネルを追加する手順

1. `workspace/panels/types.ts` の `PanelId` に識別子を足す
2. `workspace/panels/<Name>Panel.tsx` を作る
3. `workspace/panels/registry.ts` に登録する（`Record<PanelId, …>` のため漏れると型エラー）
4. 初期配置に出す場合は `layout/defaultLayout.ts` に置く

`PanelId` はレイアウトとして永続化されるため、一度決めた値は変更しない。

Registry に登録するだけで、そのパネルは View メニューに並び、閉じることも開くこともできるようになる（§7.7）。初期配置に置かないパネルは「最初から閉じている」状態として扱われる。

### 7.5 ドラッグ&ドロップ

Session 2-2 のレイアウト操作を、マウスから呼べるようにした層（`dnd/`）。**この層はレイアウトを書き換えない。**流れは一方向で、最後に必ず `layout/operations.ts` を通る。

```
タブを掴む（PanelGroup）
   ↓  PanelId
usePanelDrag        ドラッグの追跡。カーソル下の領域を探す（DOM を読む唯一の場所）
   ↓  領域の矩形 + カーソル座標
dockGuide           どの方向を狙っているか（DockZone）
   ↓  領域 id + DockZone
dropTarget          何が起きるか（DockTarget）。起きないなら null
   ↓  DockTarget
movePanel           レイアウトを変える（layout/）
```

**DockZone の決め方**（`dockGuide.ts`）。領域の4辺それぞれについて「端の帯にどれだけ入り込んでいるか」を 0〜1 に正規化し、最も深い辺を採る。どの帯にも入っていなければ `center`。正規化してから比べるため、横長の領域でも角の境界は素直に対角線になる。帯の広さは短辺の 30%、ただし 120px で頭打ちにする（割合だけだと広い領域で帯が数百 px になり、中央を狙えなくなるため）。

**DockTarget への翻訳**（`dropTarget.ts`）。`center` は `{ kind: 'tab' }`、上下左右は `{ kind: 'split', side }` になる。次の3つは `null`（＝落とせない）を返し、ガイド表示もこの結果から作る。

- 移動先の領域がもう無い
- 今そのパネルが居る領域の中央（既にそこのタブであり、移動にならない）
- 今そのパネルが居る領域の分割で、その領域にそのパネルしか入っていない（取り除いた時点で領域ごと消えるため、分割しても元と同じ形にしかならない）

守っている約束:

- **ドロップ可否と実際の操作は同じ判定から作る。** ガイドが許すのに何も起きない（逆も同様）という食い違いを構造的に防ぐ
- **DOM の位置はレイアウトの正本ではない。** `getBoundingClientRect` を読むのは「今どこを指しているか」を知るためだけで、読んだ値をレイアウトへ書き戻さない。ドロップの結果は必ず `WorkspaceLayout` の変更として表れ、画面はその写しになる
- **重複と後片付けは考えない。** `movePanel` が「取り除いてから入れる」ため、パネルの重複も空になった領域も UI 側の関心事にならない
- **ガイドは目印であって当たり判定ではない**（`pointer-events: none`）。落ちる先はカーソル座標だけで決まり、「的を正確に射ないと Dock できない」状態を作らない

HTML5 の Drag and Drop API ではなくポインタイベントを使っている。理由は、ドラッグ中の表示を自前で描くこと（既定のドラッグ画像が邪魔になる）、キャンセルの扱いを実装差に依存せず決められること、運ぶのが `PanelId` 1つで `DataTransfer` が要らないこと。ウィンドウ外へカーソルが出ても取りこぼさないよう、掴んだ時点で `setPointerCapture` する。

### 7.6 境界のリサイズ

Session 2-2 のレイアウトデータに対する「大きさ」の操作を、マウスから呼べるようにした層（`resize/`）。ドラッグ&ドロップと同じ立ち位置で、**この層もレイアウトを書き換えない。**流れは一方向で、最後に必ず `layout/resize.ts` を通る。

```
境界の掴み手を掴む（DockResizeHandle）
   ↓  どの split の何番目の境界か
useSplitResize      ポインタの追跡。両隣の領域の実サイズを測る（DOM を読む唯一の場所）
   ↓  境界 + 開始時の実サイズ + 開始位置からの移動量
resizeSplitBoundary 両側の新しい size を決める（layout/）
   ↓
WorkspaceLayout     React はその写しを描くだけ
```

掴み手は `split` の子と子の間に**もう1つの flex アイテムとして挟む**（境界の上に重ねるのではない）。この形にすると、リサイズが両隣の領域だけの話であることが DOM の並びでも保たれ、`resize/` は掴み手の前後の要素を測るだけで済む。木の何段目でも同じ形で挟まるため、入れ子の分割もそのままリサイズできる。太さは `constraints.ts` が持ち、`WorkspaceShell` がカスタムプロパティ（`--fx-dock-handle-thickness`）として CSS 側へ流す（可動範囲の計算にも同じ値が要るため、正本を1つにする）。

**両側の合計は常に変わらない。** 境界の移動は掴んだ2つの領域の間で大きさを移すだけで、他の領域や外側の大きさには影響しない。書き込むのは次の規則に従う（`resize.ts`）。ここが `size: number`（固定）と `size: null`（残りを埋める）の噛み合わせになる。

| 掴んだ2つ以外の可変領域 | 前 / 後            | 書き換える側                             |
| ----------------------- | ------------------ | ---------------------------------------- |
| 無い                    | px / px            | 両方                                     |
| 無い                    | px / null          | 前だけ（後は残りを埋めて追従する）       |
| 無い                    | null / px          | 後だけ（前は残りを埋めて追従する）       |
| 無い                    | null / null        | 前だけ（後を可変のまま残す）             |
| ある                    | どの組み合わせでも | 両方（片側だけだと無関係な領域まで動く） |

意図は「**可変領域を可変のまま残す**」こと。ウィンドウサイズの変化を引き受ける領域が1つも無くなると、リサイズするほどウィンドウのリサイズに弱くなるため。同じ理由で、`DockNodeView` は px 指定の子にも `flex-shrink` を許してある（入る限り指定どおり、入らなくなって初めて縮む）。

**最小サイズ**（`constraints.ts`）。潰れた領域はタブを掴むことも閉じることもできなくなるため下限を設ける。値はコンポーネントに書かず、`DOCK_SIZE_CONSTRAINTS` 1箇所で決める。

- 共通の下限（幅 140 / 高さ 64）と、パネルごとの上書き（Editor は幅 320 / 高さ 140）を持つ。中央の作業領域のように「置けるだけでは足りず、操作できる広さが要る」パネルを底上げするため
- 1つの領域の下限と、木としての下限は別物。`minNodeSize()` が再帰で求める（向きが同じ split は子の合計＋掴み手、違う向きなら子の最大）。入れ子の split を掴んだときも中身から限界が決まる
- 効かせるのは「今より狭くしない」ところまで。ウィンドウが狭くて既に下限を割っている領域を、境界の操作が押し戻さないようにする（操作と逆向きに動いて見えるため）

守っている約束:

- **DOM のサイズはレイアウトの正本ではない。** DOM を読むのは pointerdown の1回だけで、可変領域が今どれだけの大きさで表示されているかを知るために使う。読んだ値は操作の入力として渡すだけで状態としては持たず、結果は必ず `WorkspaceLayout` の変更として表れる
- **移動量は常に開始位置からの累計で扱う。** 前回の結果へ足し込むと、丸めと下限での頭打ちが積み重なってカーソルと境界がずれる。開始時の値からの再計算にしておくと、下限に当たった後に戻したときも素直に追従する
- **境界が動かないなら何も書かない。** レイアウトが持つ値と実サイズは（ウィンドウが狭いときなど）一致しないことがあり、「動かせなかった」だけの操作で表示中の大きさを書き込んでしまわないようにする
- **キャンセルは開始前のレイアウトへ戻す。** Escape / `pointercancel` / ウィンドウのフォーカス喪失で、掴んだ時点のレイアウトをそのまま復元する（`replaceLayout`）。移動量 0 で確定するのとは違い、ドラッグ中に px へ固定した領域も元の `null` に戻る
- **リサイズとドラッグ&ドロップは互いを知らない。** 掴む対象が別（タブ / 掴み手）で同時に始まらないため、それぞれ独立した hook として並ぶ。パネルのドラッグ中は掴み手を `pointer-events: none` にして、ドロップ先は必ず領域の側になるようにしている

カーソルは掴み手の `cursor`（`col-resize` / `row-resize`）で示し、ドラッグ中は画面全体に同じ形を掛ける（掴み手は数 px しかなく、カーソルが外れても Pointer Capture により操作は続いているため）。

### 7.7 パネルの表示管理とレイアウトプリセット

Session 2-5 で追加した層（`layout/panelVisibility.ts` と `layout/presets.ts`）。ここも純粋関数で、React にも DOM にも依存しない。

**閉じることと、Registry から消すことは別物。** Registry（`panels/registry.ts`）は「どんなパネルが存在するか」を持ち、`WorkspaceLayout` は「そのうち今どれをどこに置いているか」を持つ。閉じたパネルは定義として残り続けるため、同じ `PanelId` でいつでも戻せる。

```
表示中    … WorkspaceLayout の木のどこかに その PanelId がある
閉じている … 木のどこにも無い
```

**可視状態のための状態を別に持たない。** 持つと「レイアウトにはあるが非表示」「非表示なのにタブが残っている」というずれが起こりうるが、レイアウトから導出する限り定義上あり得ない。View メニューのチェックも `isPanelVisible(layout, panelId)` の結果そのもの。

閉じる操作の実体は `removePanelFromLayout` で、空になった領域の除去と split の畳み込みは §7.3 のとおり `tree.ts` が引き受ける。最後の1枚を閉じると空の root が残り、その状態でもドロップ先にはなる。

#### 再表示時の配置ルール

開く側だけは決めることがある。**閉じたパネルをどこへ戻すか**で、レイアウトにはもう手がかりが残っていない（取り除いた領域ごと畳まれている）。そこで、**そのとき適用されているレイアウトプリセットを「本来の居場所」の設計図として読む**。

ただしプリセットの形をそのまま復元するのではなく、**今のレイアウトを崩さずに、プリセットで隣に居た相手の隣へ戻す**。利用者が組んだ配置を、パネルを1枚開いただけで作り直してしまわないため。上から順に見て、最初に当てはまったものを採る。

| 条件                                     | 戻り方                             |
| ---------------------------------------- | ---------------------------------- |
| そもそも閉じていない                     | タブを手前に出すだけ（配置は不変） |
| プリセットで同じ領域に居たパネルが表示中 | その領域へタブとして戻す           |
| プリセットで近くに居たパネルが表示中     | その範囲の隣を分割して戻す         |
| どれも当てはまらない                     | 先頭の領域へタブとして戻す         |

3つめが本体で、プリセットの木を葉から根へ辿りながら「同じ split の中で、どちら側の何番目に居たか」を見る。近い兄弟から順に、その中のパネルが1枚でも表示されていれば、**表示されている分をまとめて含む最小のノード**（`findSmallestNodeContaining`）を相手にして分割する。相手が領域とは限らないのはこのためで、Terminal は Files / Editor / Git を含む部分木の下へ戻るので画面幅いっぱいになる。葉に限ると「Git の下」のような元の意図から外れた場所に戻ってしまう。

大きさもプリセットから引き継ぐ（Files は 240px、Terminal は 220px）。ただし引き継げるのは、プリセットでその値が効いていた向きと今回の分割の向きが一致するときだけ。`size` は「親の並び方向における大きさ」なので、向きが違えば同じ数値でも別の意味になる。

4つめは、他のパネルが1枚も表示されていない場合（すべて閉じた直後）と、プリセットに含まれないパネルを開いた場合。前者は空の root がその「先頭の領域」になるため、特別扱いが要らない。

#### レイアウトプリセット

`presets.ts` が `LayoutPresetId → LayoutPreset` の表を持つ。プリセットが持つのはレイアウトそのものではなく**レイアウトを作る関数**で、適用は常に `WorkspaceLayout` の差し替えとして起きる（＝状態の正本は 1 つのまま）。

Session 2-5 では Default だけを実装した。DESIGN.md §3 が挙げる Coding / Debug / Git / Minimal は、この表に足すだけで増える（画面側は `listLayoutPresets()` を並べるだけで、プリセットごとの分岐を持たない）。プリセットを足すときの約束は `presets.ts` の冒頭に書いてある。

`useWorkspaceLayout` が持つのはレイアウトと「どのプリセットから始まったか」の2つ。「変更されたか」は**適用直後のレイアウトと参照が同じか**で判定する。操作関数は変化が無ければ元のオブジェクトをそのまま返すため（§7.3 の約束）、参照の一致がそのまま未変更と同義になり、リサイズをキャンセルして元へ戻った場合も未変更に戻る。「レイアウトを初期化」は今のプリセットを適用し直す操作で、独自の初期状態を持たない。

#### UI

- **タブの閉じるボタン** … `PanelGroup`。タブ1枚は「切り替えのボタン」と「閉じるボタン」を並べた器（`button` を入れ子にできないため）で、`role="tab"` は器の側が持つ
- **View メニュー** … `WorkspaceTopBar`。Registry の全パネルを並べ、チェックが可視状態。閉じたパネルを見つけて戻せる唯一の入口
- **Layout メニュー** … 同じく上部バー。プリセットの切り替え

ネイティブのアプリケーションメニュー（`main/app/menu.ts`）ではなくアプリ内 UI にしているのは、操作面をアプリ内 UI に置く方針であること（配布ビルドではネイティブメニューを持たない）に加えて、表示状態の正本が Renderer 側のレイアウトにあるため。ネイティブメニューにチェック状態を出すには Main → Renderer のイベント経路（§3.3）が要る。

### 7.8 レイアウトの保存と復元

Session 2-6 で追加した層（`persistence/`）。**保存の対象は `WorkspaceLayout` ひとつ**であり、Dock / ドラッグ&ドロップ / リサイズ / 表示管理 / プリセットのどれも、保存のための処理を自分では持たない。画面の状態をデータとして表してきた（§7.2）結果がここで効く。

#### 経路

Renderer はファイルシステムに触れない。STEP 1 の責務分離をそのまま通す。

```
useWorkspaceLayout（レイアウトの持ち主）
   ↓  変わった / 起動した
persistence/useLayoutPersistence   いつ読むか・いつ書くか
   ↓  WorkspaceLayoutDocument
window.fluvix.workspace            Preload の薄いラッパ
   ↓  IPC（workspace:load-layout / workspace:save-layout）
main/ipc/handlers/workspace.ts     文書として妥当かを検証
   ↓
main/store/workspaceLayout.ts      %APPDATA%/Fluvix Nexus/workspace-layout.json
```

#### 保存するもの

```json
{
  "schemaVersion": 1,
  "layout": {
    "presetId": "default",
    "root": { "kind": "split", "id": "root", "size": null, "direction": "column", "children": [...] }
  }
}
```

木がそのまま入るため、配置・タブの並び・`activePanelId`・split の向き・`size` は木の一部として保存される。パネルの表示 / 非表示も同様で、閉じたパネルは木に居ないという形でしか表現されない（§7.7）。`presetId` だけは木の外にあり、閉じたパネルの戻り先を決めるのに要る。

パネル本体の機能状態（開いているファイル、Terminal のセッション）は対象外。それらはパネル自身の持ち物で、レイアウトとは別に保存する。

#### 保存形式は実行時モデルと別の型にする

`shared/workspace/layoutDocument.ts` が保存形式（`StoredDockNode`）を持ち、`renderer/.../layout/types.ts` の `DockNode` とは別の型になっている。ほぼ同じ形をしているのに分けているのは、**守るべき互換性の対象が違う**ため。

- 保存形式 … 過去のファイルを読めなくしてはいけない。変えるときは `schemaVersion` を上げる
- 実行時モデル … いつでも変えてよい

同じ型を使い回すと、実行時モデルを1つ変えた瞬間に保存済みファイルが読めなくなる。分けておけば、両者の差は `persistence/layoutDocument.ts` の変換1箇所に必ず現れる。保存形式が `DockNodeId` の branded type を使わず、`PanelId` も素の `string` で持つのも同じ理由（ファイルの中身は型では守れない）。

#### 検証の分担

| 層       | 見るもの                                                            |
| -------- | ------------------------------------------------------------------- |
| Main     | JSON として読めるか / `schemaVersion` が正の整数か / 大きすぎないか |
| Renderer | 木の形・`PanelId`・`size`・`direction`、そして正規形かどうか        |

レイアウトの意味を知っているのは Renderer だけであり、Main が中身を二重に解釈すると「どちらが正しいか」が生まれる。Main は保存先と書き込み方に責任を持ち、中身については「後で解釈できる形か」だけを見る。

読み込みの流れは次のとおりで、**どこで失敗しても例外にはせず、Default プリセットで起動する**（理由は console に残す）。

```
migrateStoredLayout    schemaVersion を今の形まで引き上げる（下げられない場合は失敗）
   ↓
toDockNode             形として読めるか。読めない値は失敗
   ↓
normalizeLayout        空の領域・重複・ずれた activePanelId を直す（§7.3）
   ↓
findLayoutProblems     直らない破綻が残っていないかの最終確認
   ↓
reserveDockNodeIds     復元した id を発番器に予約する（restoreLayout.ts）
```

直すものと失敗にするものの線引き:

| 内容                                            | 扱い                           |
| ----------------------------------------------- | ------------------------------ |
| 知らない `presetId`                             | Default として扱い、配置は残す |
| 空の領域・重複・ずれた `activePanelId`          | `normalizeLayout` が直す       |
| 知らない `PanelId` / `kind` / `direction`       | 失敗（Default へ）             |
| `size` が負の数、id が文字列でない              | 失敗（Default へ）             |
| 非対応の `schemaVersion`、JSON として壊れている | 失敗（Default へ）             |

知らない `PanelId` を「取り除いて続行」にしていないのは、それが起きるのはパネルを廃止したときであり、そのときは `schemaVersion` を上げてマイグレーションで畳むのが筋だから。マイグレーションを通してなお知らない `PanelId` が残っているなら、想定していない内容として扱う。

`reserveDockNodeIds` を忘れると、保存データの `dock-3` と起動後に発番した `dock-3` が衝突する。ノードの探索はすべて id で行うため、これは「掴んだのと別の領域が動く」という原因の分かりにくい形で表面化する（`restoreLayout.test.ts` が見張っている）。

#### いつ書くか

```
レイアウトが変わる → 400ms（Renderer 側の間引き）→ IPC → 400ms（Main 側の間引き）→ ディスク
```

間引きが2段あるのは、リサイズやドラッグが毎フレームレイアウトを変えるため。1回のドラッグで発生する書き込みは、操作が終わった後の1回だけになる。直前に保存を依頼した内容と同じであれば、そもそも送らない。

**終了時だけに頼らない。**通常操作の中で保存され続けたうえで、取りこぼしを2段で拾う。

- Renderer … `pagehide`（＝ウィンドウが閉じられる）で、間引き待ちの内容を即座に送る
- Main … `will-quit` で `flush()`。ウィンドウが閉じた後のイベントなので、上の送信を受け取ってから書ける

`before-quit` ではなく `will-quit` なのは、前者だとまだ Renderer の最後の保存依頼が届いていないため。

#### 復元が終わるまで描かない

`WorkspaceShell` は `restored` が false の間、枠だけを描く（数十 ms）。先に Default を描いてから差し替えると、起動のたびに配置が飛んで見えるうえ、その間の操作が復元で上書きされる。

「初期化した直後に再起動しただけで**変更あり**に見える」問題を避けるため、復元した配置がプリセットと同じ形なら、プリセット側のオブジェクトをそのまま採る（`isSameLayout`）。`modified` は参照の一致で判定している（§7.7）ので、これで従来の判定がそのまま成立する。

「レイアウトを初期化」に専用の保存処理は無い。プリセットを適用し直せば state が変わり、通常の保存経路がそのまま保存済みレイアウトを Default に書き換える。

### 7.9 STEP 2 の範囲外（STEP 3 以降）

| 項目                           | 追加先                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 各パネルの本機能               | `panels/<Name>Panel.tsx` の中身。Shell 側は変更不要（Files / Monaco Editor / Terminal / Git）                   |
| タブのドラッグによる並べ替え   | `dnd/` にタブ列の当たり判定を足し、`movePanel` に `{ kind: 'tab', index }` を渡す（**操作とテストは対応済み**） |
| プリセットの追加               | `layout/presets.ts` の表へ                                                                                      |
| 自作レイアウトの保存           | プリセットの表と保存形式の両方に載る。§7.8 の経路にもう1ファイル増やす形                                        |
| パネルの独立ウィンドウ化       | Main 側で別ウィンドウを開き、Shell のルートを分岐                                                               |
| Main → Renderer のイベント経路 | **Session 3-3 で追加済み**（§3.3）。Terminal の出力・LSP / DAP の通知も同じ経路に載せる                         |

タブの並べ替えは、レイアウト操作（`movePanel` の `{ kind: 'tab', index }`）と単体テスト・統合テストは揃っているが、**タブを掴んで並べ替える UI の入口だけが無い**状態にしてある。今できるのは「別の領域へ出して戻す」経路での並べ替えで、これは実機確認でも通している。

---

## 8. Workspace（開いているプロジェクトフォルダ）

Session 3-1 の成果物。Files / Editor / Terminal / Git が**共通の対象にするもの**であり、パネルの中身より先に用意する必要があった（DESIGN.md §3「Workspace」）。

§7 の Workspace Shell が「画面をどう並べるか」を扱うのに対し、こちらは「何を対象に動くか」を扱う。互いに独立していて、Workspace を切り替えても配置は変わらず、配置を変えても Workspace は変わらない。

### 8.1 正本は Main 側に置く

```
Main   … 今どのフォルダを開いているか（正本）        main/workspaceFolder/currentWorkspaceFolder.ts
Renderer … 表示のための写し（Context）              renderer/src/workspaceFolder/
```

Workspace を必要とする処理は、これから足すものも含めてすべて Main に居る。

| 機能     | Workspace の使いみち             |
| -------- | -------------------------------- |
| Files    | ファイルの列挙・読み書きの基点   |
| Terminal | シェルを起動する作業ディレクトリ |
| Git      | リポジトリの場所                 |
| LSP／DAP | プロジェクトの root              |

Renderer が正本を持ち、操作のたびにパスを渡す形にすると、これらが「Renderer から届いたパス」を信じて OS を触ることになる。Renderer を OS から切り離している意味がそこで無くなるため、**Main が自分で覚えている**形にした。Main 側の機能は `getCurrentWorkspaceFolder()` を呼ぶだけでよく、パスを引数で持ち回らない。

### 8.2 データ構造

```ts
StoredWorkspaceFolder  { id, rootPath, displayName, openedAt }        ← ディスクに置く形
WorkspaceFolder        { …Stored, exists }                            ← Renderer へ渡す形
```

保存形式と実行時の値を分ける理由は §7.8 と同じ（守るべき互換性の対象が違う）。`exists` を保存しないのは、それが保存した時点の事実でしかなく、次回起動時には確かめ直す必要があるため。

| 項目          | 内容                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `id`          | **開いた記録1件**の識別子（フォルダの識別子ではない）。同じフォルダを開き直せば別の id になる          |
| `rootPath`    | 絶対パス。`resolve` で正規化して持つ（同じフォルダが別の文字列として保存されないように）               |
| `displayName` | UI に出す名前。既定はフォルダ名。将来「名前を付ける」を足せるよう別項目にしてある                      |
| `openedAt`    | 開いた時刻（epoch ミリ秒）。「最近開いた順」の並べ替えに使う                                           |
| `exists`      | その値を作った時点で実在したか。**現在の Workspace では常に true**（§8.5）。false が要るのは将来の一覧 |

「最近開いた一覧」は、保存文書に `recent: StoredWorkspaceFolder[]` を足す形になる（`schemaVersion` を上げ、無ければ空配列として読む）。

### 8.3 経路

```
renderer/src/workspaceFolder/WorkspaceFolderProvider.tsx   ← Renderer で IPC を呼ぶ唯一の場所
   ↓  window.fluvix.workspaceFolder
preload/api/workspaceFolder.ts                             薄いラッパ
   ↓  IPC（workspace-folder:get-current / :open / :close）
main/ipc/handlers/workspaceFolder.ts                       ダイアログを出す・失敗の分類へ翻訳
   ↓
main/workspaceFolder/currentWorkspaceFolder.ts             正本。検証して切り替え、保存を依頼
   ↓
main/store/workspaceFolder.ts                              %APPDATA%/Fluvix Nexus/workspace-folder.json
```

チャンネルは3つだけ。

| チャンネル                     | 応答                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `workspace-folder:get-current` | `{ workspace, unavailableRootPath }`                          |
| `workspace-folder:open`        | `{ status: 'opened', workspace }` / `{ status: 'cancelled' }` |
| `workspace-folder:close`       | なし                                                          |

**取り消しを失敗にしていない。** 取り消しは通常の結末であり、`IpcResult` の失敗として返すと、Renderer 側のエラー文言（`api/result.ts`）を出さないための分岐が要る。応答の `status` で表す方が、扱いを間違えにくい。

### 8.4 Renderer は開く場所を指定できない

**3つのチャンネルはいずれも引数を取らない。** 開く対象を決めるのは Main が出すネイティブのフォルダ選択ダイアログだけで、Renderer が言えるのは「ダイアログを出して」までに留まる。

任意のパスを受け取る形にすると、Files / Terminal / Git がそのフォルダを基点に動く以上、実質的に「Renderer から任意の場所を指定できる API」になる。§5 で汎用のファイル API を公開しない方針を取っているのに、Workspace の指定でそれが迂回できてしまう。

「最近開いた一覧から開き直す」を足すときも、Renderer が渡すのは**一覧の項目の id** にする。パスは Main が自分の持っている一覧から引くため、この性質は変わらない。

なお、パスの検証（`workspaceFolder/folderPath.ts`）は経路が1つでも省かない。保存ファイルから読んだパスも同じ関数を通す（利用者が手で編集できる場所にあるため）。

### 8.5 復元と、フォルダが無い場合

ディスクにあるのは「**次回起動時に復元する対象**」であって「今開いているもの」ではない。Workspace を閉じれば `lastWorkspace` は null になり、次回は未選択で起動する。

起動後、最初に Workspace が必要になった時点で1度だけ復元する。

```
保存ファイルを読む → 文書として検証 → パスとして検証 → 実在するフォルダか
                     ↓ 失敗            ↓ 失敗           ↓ 無い
                   未選択            未選択           未選択（理由を Renderer へ返す）
```

**フォルダが無くても失敗にしない。** フォルダは削除も移動もされうるし、外付けドライブなら次に繋いだときには戻っている。起動できなくなる理由にはならないので、未選択の状態で開いて理由（`unavailableRootPath`）を Welcome に出す。黙って未選択にすると、利用者には「前回の状態が消えた」ようにしか見えない。

**そのとき保存内容は消さない。** 消すと、一時的に繋がっていないだけのドライブでパスを失う。次に Workspace を開いた時点で上書きされるため、古い記録が残り続けることもない。

この結果、`WorkspaceFolder.exists` は現在の Workspace としては常に true になる。存在しないフォルダを「現在の Workspace」にしてしまうと、以降のすべての機能が壊れた root を前提に動くことになるため。

### 8.6 Renderer 側（写しの配り方）

```
App.tsx
└── WorkspaceFolderProvider     状態の保持と IPC の呼び出し（唯一 IPC に触れる）
      └── WorkspaceShell        …
            ├── WorkspaceTopBar   名前の表示 / 開く / 閉じる
            ├── WorkspaceStatusBar 場所（rootPath）の表示
            └── panels/EditorPanel 未選択なら WorkspaceWelcome
```

**Context で配る。** パネルは自由に配置を変えられ、親子関係が固定されていないため（§7.3）、prop では配れない。Shell より外側に置くことで、どこに置かれたパネルからも `useWorkspaceFolder()` で同じ値が読める。これが「Workspace が変わったら各機能へ伝わる」経路の実体で、後続セッションで Files / Terminal / Git が同じ hook を使う。

Main → Renderer の**イベント経路（§3.3）はここでは要らなかった。** Workspace が変わるきっかけは利用者の操作だけで、その応答として新しい状態が返るため。Main 側の都合で変わる要因（フォルダの消失を監視するなど）ができた時点で、Terminal と同じ経路に載せる。

`status`（`loading` / `ready`）を持つのは、取得が済むまで「未選択」と区別が付かないため。先に未選択を描くと、復元された瞬間に Welcome から画面が入れ替わって見える。レイアウトの復元（§7.8「復元が終わるまで描かない」）と同じ考え方で、こちらは Workspace を出す箇所だけを空にしている（レイアウトと違い、画面全体を止める必要が無いため）。

### 8.7 Session 3-1 の範囲外

| 項目                         | 追加先                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| ファイルツリー・ファイル操作 | Files ドメイン（§9 で列挙まで実装済み。操作は後続セッション）           |
| 最近開いた一覧               | 保存文書へ `recent` を足し、開き直しは id で指定する（§8.2 / §8.4）     |
| Workspace の名前を変える     | `displayName` を別項目にしてあるため、保存形式は変えずに足せる          |
| 複数フォルダの同時オープン   | `WorkspaceFolder` は1件で持っている。増やすなら正本を配列にする段階から |
| フォルダの消失の検知         | Main → Renderer のイベント経路（§3.3）が要る                            |

---

## 9. Files（Workspace のファイルツリー）

Session 3-2 の成果物。§8 の Workspace を基点に、その中のフォルダ・ファイルを Files パネルへ出す。

パネルの中身としては最初の実装であり、**Renderer から OS のデータを読む経路**としても最初のもの。STEP 1 で分けた責務（Renderer は OS に触れない）を、実際にデータを読む機能でどう保つかがここに現れる。

### 9.1 経路

```
renderer/src/files/useFileTree.ts      ← Renderer で列挙を呼ぶ唯一の場所
   ↓  window.fluvix.files.readDirectory({ relativePath })
preload/api/files.ts                   薄いラッパ
   ↓  IPC（files:read-directory）
main/ipc/handlers/files.ts             基点を現在の Workspace から取り、失敗を分類へ翻訳
   ↓
main/files/readWorkspaceDirectory.ts   境界を確かめて1階層だけ読む
   ↓
main/files/workspacePath.ts            パス文字列としての判断（テスト対象）
```

このセクションが扱うのは列挙だけ。ファイルの中身の読み込みと、作成 / 改名 / 削除は §10。

| チャンネル             | 要求               | 応答                                                |
| ---------------------- | ------------------ | --------------------------------------------------- |
| `files:read-directory` | `{ relativePath }` | `{ workspaceId, relativePath, entries, truncated }` |

### 9.2 データ構造

```ts
FileEntry { id, name, relativePath, type, extension }
```

`WorkspaceLayout` とは別のモデルにしてある。レイアウトは利用者が組んだ配置で、保存され復元され、過去のファイルとの互換性を守る対象になる。こちらは**今ディスクにあるものの写し**でしかなく、保存もしなければ守る互換性も無い（次に読めば作り直される）。混ぜると、ディスクの都合でレイアウトの保存形式を変えることになる。

| 項目           | 内容                                                               |
| -------------- | ------------------------------------------------------------------ |
| `id`           | `d:src/main` / `f:src/main/index.ts`。**relativePath と種別の組**  |
| `name`         | 表示名（フォルダ内での名前）                                       |
| `relativePath` | Workspace root からの相対位置。区切りは常に `/`。root 自身は空文字 |
| `type`         | `file` / `directory`。symlink は指し先の種別                       |
| `extension`    | 小数点なし・小文字。フォルダと拡張子の無いファイルは null          |

**Renderer は絶対パスを持たない。** 持たせた時点で Renderer が「OS 上の場所」を正本として持ち始める。言えるのは「今の Workspace の中の、この相対位置」までに留める。区切りを `/` に固定しているのも同じ線で、OS の区切り文字は Main の中だけの話にしてある（DESIGN.md §8 の Mac 対応）。

`id` が種別を含むのは、同じ名前がファイルからフォルダへ置き換わったときに id が変わり、選択状態・展開状態がその場で無効になるため（別のものとして扱われる）。

**`hasChildren` を持たない。** それを知るには子フォルダを1つずつ開く必要があり、Lazy Load の意味が無くなる。空のフォルダは「展開したら何も無かった」として表示側で扱う。

### 9.3 Workspace の外へ出られないこと

この機能の要点。Renderer に渡しているのは相対位置だけだが、その文字列は境界の外から来る。

**root を要求に含めない。** 基点は Main が持つ現在の Workspace（§8.1）だけから決まる。Workspace の切り替え自体も Renderer からパスを渡せない（§8.4）ため、この2つが揃って「Renderer からは Workspace の外に手が届かない」が成立する。片方だけでは足りない ── 汎用のファイル API を公開しない方針（§5）は、root を指定できる API があればそこで迂回される。

検証は2段階で、**どちらか一方では足りない**。

| 段階                 | 見るもの                                                                 | 場所                              |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| パス文字列としての形 | `..` / 絶対パス / ドライブ相対（`C:foo`）/ `:` / NUL / 長さ              | `files/workspacePath.ts`          |
| 実体                 | realpath まで解決した結果が root の中にあるか（symlink・ジャンクション） | `files/readWorkspaceDirectory.ts` |

symlink は**相対位置としては正しいまま外を指せる**ため、文字列の検査だけでは通ってしまう。逆に実体の検査だけでは、`..` を含む要求が「たまたま内側に収まる」形で通り、判断が入力ごとに変わる。

決めていること:

- **`..` は結果が内側に収まる形でも受け付けない。** `a/../b` は resolve すれば内側だが、受け付ける理由が無い。判断を単純に保つほど後から穴が空きにくい
- **前方一致は区切り文字まで含めて比べる。** `D:\proj` と `D:\project` を通してしまわないため
- **Windows では大文字小文字を区別しない。** realpath はディスク上の表記（ドライブレターの大小を含む）を返すため、区別すると同じ場所を別物と判定する
- **読むのは realpath の側。** 確かめた対象と読む対象を同じにする（間に symlink が差し替えられても検証をすり抜けない）
- **外を指すものは「見つからない」ではなく拒否（`PERMISSION_DENIED`）にする。** Workspace の外は、存在するかどうかを含めて Renderer に答えない

外を指すフォルダ（junction など）もツリーには並ぶ。開けないだけで、あるものを隠すと「あるのに見えない」状態になるため。

### 9.4 Lazy Load

**再帰しない。** Workspace を開いた瞬間に全体を舐めると、`node_modules` を持つプロジェクトではそれだけで数万〜数十万件になる。読むのは常にフォルダ1階層で、展開されたときに初めてそのフォルダを読む。読む量は利用者が実際に開いた範囲で止まる。

Renderer 側の状態は**木ではなく「フォルダ単位の表」**で持つ（`fileTreeModel.ts`）。

```
directories: relativePath → { loading | ready(entries, truncated) | error(reason) }
expanded:    展開しているフォルダの relativePath の集合
```

木の形（どこにぶら下がるか・階層の深さ）は、この2つから `flattenFileTree()` が毎回導く。入れ子のオブジェクトで木を組み立てると、深い階層ほど更新のたびに親を作り直すことになるが、表なら届いた応答はその欄を差し替えるだけで済む。「畳んだら見えない」も状態ではなくこの導出で表す。

**読むのは「展開されたのに、まだ中身を知らないフォルダ」だけ**（`useFileTree.ts`）。展開の操作と読み込みを直接つながず、`expanded` と `directories` の差から導いている。この形にすると、展開の入口が増えても読み込みの経路は1本のままで、再読み込みは「読み込み済みを捨てる」だけで済む。

1回の応答は 5000 件で打ち切り、`truncated` で伝える。打ち切りを失敗にしないのは、`node_modules` のようなフォルダでも先頭だけは見えた方が行き止まりにならないため。並べ替えてから切るのは、先に切ると読むたびに見えるものが変わりうるため（`readdir` の順序はディスク側の都合で決まる）。

### 9.5 並び順

フォルダが先、それぞれ名前順（大文字小文字を区別せず、数値は数として見る）。表記だけが違う組（`README.md` と `readme.md`）は素の文字列比較で固定し、読むたびに並びが入れ替わらないようにする。

**並べ替えは Main 側で済ませる。** Renderer が受け取った時点で表示順になっている方が、ツリーの描画が「配列の順に並べるだけ」で済む。利用者が順序を選べるようにする段階では、契約に順序の指定を足して `entrySort.ts` へ渡す形にする（Renderer 側で並べ替えると、フォルダの中身の正本を Renderer が持つ話に近づく）。

### 9.6 Workspace が変わったとき

**破棄は `key` で行う。** `FilesPanel` が Workspace の id を `key` にして `FileTree` を作り直すため、前の Workspace で読み込んだ内容も展開状態も React が破棄する。「切り替わったら消す」処理を書くより、消し忘れが構造的に起きない。id は開いた記録ごとに変わる（§8.2）ので、同じフォルダを開き直した場合も作り直しになる。

それでも取りこぼす経路が1つある。**要求を出した後・応答が届く前に Workspace が切り替わる**場合で、応答の中身は新しい Workspace のものになっている。そのため応答に `workspaceId` を載せ、Renderer は自分が表示している Workspace の id と突き合わせて、違えば捨てる。読み込みの世代（再読み込みのたびに進む）も併せて見ており、「捨てた内容が後から戻ってくる」ことが起きない。

### 9.7 失敗はツリーの中で扱う

フォルダは読んでいる最中に消えるし、権限が無いこともある。**どれもアプリが落ちる理由にはしない。**

```
fs の失敗（ENOENT / EACCES / ENOTDIR / ELOOP …）
   ↓  readWorkspaceDirectory.ts が結末の値へ翻訳（この層は IPC を知らない）
   ↓  handlers/files.ts が IPC の失敗分類へ翻訳
   ↓  filesError.ts が「消えた / 権限が無い / それ以外」の3つへ落とす
Files パネル内の1行として表示 ＋ その場での再試行
```

失敗するのはそのフォルダだけで、ツリーの他の枝はそのまま残る。読み込み中・失敗を**状態として持つ**のはこのためで、ツリーの一部が読めていないというのは、この画面では例外ではなく通常の状態にあたる。

アプリの中の操作による変化は Main からの通知で自動的に反映される（§10.5）。それでも Files パネルに再読み込みを置いてあるのは、**アプリの外**で変わった内容（別のエディタ・Git の操作）を取り込む手段がまだ他に無いため。展開状態は保ったまま、読み込み済みの内容だけを捨てて読み直す。

### 9.8 Session 3-2 の範囲外

| 項目                     | 状況                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| ファイルを Editor で開く | **Session 3-3 で実装**（§10.3）                                                          |
| 作成 / リネーム / 削除   | **Session 3-3 で実装**（§10.2）                                                          |
| ファイル変更の通知       | **Session 3-3 で経路を用意**（§3.3・§10.5）。外部の変更の監視は後続                      |
| 移動                     | **Session 3-6-1 で実装**（§10.7）。境界の検証は §9.3 / §10.2 の経路を通る                |
| コピー                   | **Session 3-6-2 で実装**（§10.8）。境界の検証は移動と同じものを使い回す                  |
| ドラッグ&ドロップ        | **Session 3-6-3 で実装**（§10.9）。移動 / コピーの判定をそのまま使い回す                 |
| 検索（プロジェクト全体） | **Session 3-6-4 でファイル名検索**（§10.10）、**Session 3-6-5 で全文検索**（§10.11）     |
| カラム表示（横長時）     | **Session 3-6-7 で実装**（§10.13）。ツリーと同じデータ・同じ操作の別の描き方             |
| 種類別のファイルアイコン | **Session 3-6-6 で実装**（§10.12）。判定は `files/fileIcon.ts`、絵は `FileTreeIcons.tsx` |
| 並び順の選択             | 契約に順序の指定を足し、`entrySort.ts` へ渡す（§9.5）                                    |
| 仮想スクロール           | 5000 行は素の DOM で描けている。必要になるのは打ち切りを緩めるとき                       |

---

## 10. Files の操作と Editor 連携

Session 3-3 の成果物。§9 が「見る」までを扱うのに対し、こちらは **Files パネルを開発作業の入口にする**ところ（DESIGN.md §3「Files パネル」）。

```
Workspace を開く → Files でファイルを選ぶ → Editor で開く
                 → Files から作る / 名前を変える / 消す
```

### 10.1 何をどこで決めるか

境界の検証（§9.3）を書き換える側にも同じだけ効かせるのが要点。読む側だけを守っても、書く側から Workspace の外へ手が届けば意味が無い。

| 判断                             | 場所                           | 依存 |
| -------------------------------- | ------------------------------ | ---- |
| 相対位置の形（`..`・絶対パス）   | `main/files/workspacePath.ts`  | path |
| 相対位置の構造（親・配下・改名） | `shared/files/relativePath.ts` | なし |
| 名前として使える形               | `shared/files/fileName.ts`     | なし |
| コピーの名前の付け方             | `shared/files/copyName.ts`     | なし |
| 中身をテキストとして出せるか     | `main/files/fileContent.ts`    | なし |
| 実体が Workspace の中か          | `main/files/*.ts`（realpath）  | fs   |

**名前の規則・コピー名の規則・相対位置の扱いだけは shared に置いた。** ここまで「shared は型と定数」で通してきたが、この3つは Main と Renderer が**同じ答えを見る必要がある純粋な文字列の判断**で、2箇所に書くと片方だけ直された時点でずれる。

- 名前 … Renderer は入力中にその場で理由を出す必要がある（1文字ごとに IPC を往復させない）
- コピー名 … Main は実際にその名前で作り、Renderer は何ができるのかを説明する（§10.8）
- 相対位置 … Main は操作対象の親を求め、Renderer は消えたものの配下を畳む

`ipc/result.ts` の `ipcSuccess` / `ipcFailure` と同じ立ち位置。**Renderer が通した ＝ 許可された、ではない。** Main は受け取った名前を必ず同じ関数へ通してから fs を触る。ここにあるのは共有された規則であって、検査を Renderer へ委譲したわけではない。

OS のパスに関わる判断（区切り文字・ドライブ・realpath）は shared に入れない。それを入れると Renderer に OS 依存が持ち込まれる。

### 10.2 書き換える側の境界

チャンネルは4つ増えた。どれも root を指定する引数を持たない。

| チャンネル        | 要求                                     | 応答                                                                           |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `files:read-file` | `{ relativePath }`                       | `{ workspaceId, relativePath, name, status, byteLength, content, lineEnding }` |
| `files:create`    | `{ parentRelativePath, name, type }`     | `{ workspaceId, entry }`                                                       |
| `files:rename`    | `{ relativePath, name }`                 | `{ workspaceId, entry, fromRelativePath }`                                     |
| `files:copy`      | `{ relativePath, toParentRelativePath }` | `{ workspaceId, entry, skippedCount }`                                         |
| `files:delete`    | `{ relativePath }`                       | `{ workspaceId, relativePath, entryType, method }`                             |

#### 境界は「操作が起きるフォルダ」に対して確かめる

作成・改名・削除はどれも**あるフォルダの中で起きる**操作で、対象そのものは操作した後にしか（あるいは操作した時点で）存在しない。そのため確かめるのは**親フォルダ**で、操作するのはその realpath の直下に限る（`mutateWorkspaceEntry.ts` の `resolveTarget` に1箇所だけ置く）。

```
1. 相対位置を文字列として検証        `..` / 絶対パス / `:` / NUL / 長さ
2. 名前を検証                        1階層ぶんの名前か（用途で2種類。下記）
3. 親フォルダを realpath まで解決     symlink / ジャンクションの指し先を見る
4. その realpath が Workspace の中か  外なら拒否（PERMISSION_DENIED）
5. join(親の realpath, 名前) を操作   確かめた場所の直下だけを触る
```

2 で**区切り文字を含む名前を弾いている**ことが、「作成先は `parentRelativePath` だけで決まる」の担保になっている。ここが緩むと、境界を確かめた場所と実際に触る場所がずれる。

#### 名前の検証は、問いが2つある（Session 3-5.1）

同じ検証を全部の操作に通すと、**新規作成のための規則が既存のものにも掛かる。** `aux.ts` は「これから作る名前」としては受け付けないが、他の OS で作られたものが実際に置かれていることはある（Mac で作られたリポジトリを clone すれば起きる）。そこへ作成向けの規則を当てると、**ツリーに並んでいるのに削除できないファイル**ができる ── 守るものが何も無いのに、である。

| 問い                       | 関数                      | 使う場所                | 見るもの                                               |
| -------------------------- | ------------------------- | ----------------------- | ------------------------------------------------------ |
| これから付ける名前か       | `findFileNameProblem`     | 作成 / 改名の新しい名前 | 下段に加えて、予約デバイス名・末尾のドット / 空白      |
| 既に在るものを指せる名前か | `findExistingNameProblem` | 削除 / 改名の元         | 空でない・長さ・区切り文字 / 記号 / 制御文字・`.` `..` |

**緩めたのは名前の規則だけで、境界の検証（1・3・4・5）はどちらも同じものを通る。** 実在するかどうかは、その先の `lstat` が答える。

#### 相対位置そのものを trim しない（Session 3-5.1）

前後に空白を含む名前（`notes.txt `）はディスク上に実在しうる。相対位置を丸ごと trim すると、**利用者が指した `notes.txt ` が別のファイル `notes.txt` に化ける** ── 削除のような戻せない操作でそれが起きると、結末は「操作が失敗する」では済まない。

trim は**判定のためだけ**に使う（空白だけの入力は root と読む / 空白で囲んだ絶対パスも弾く）。判定は trim した写しに対して行い、**戻り値は必ず生の文字列から組み立てる。** こうすると弾く範囲は広いまま、fs へ渡す名前だけが手つかずで残る。

末尾のドット / 空白を落とすと `.` `..` になる要素（`.. ` など）は、Windows が本来その落とし方をするため位置の指定として弾く。**名前は入力欄から来たものだけ trim する**（`normalizeFileName`）── そちらは「利用者が今そこに打った文字列」で、打ち間違いの空白で弾く理由が無い。

#### シェルに宛先を伝えられない名前は、消さずに断る（Session 3-5.1）

`shell.trashItem` だけは fs と経路が違う。node は拡張表記（`\\?\`）でファイルシステムを叩くため `notes.txt ` を字義どおり扱えるが、**シェル側は Win32 のパス正規化を通し、末尾の空白とドットを落とす。** その結果 `notes.txt ` を渡すと隣の **`notes.txt` の方がごみ箱へ入る**（実機で確認済み。拡張表記を渡すと `Failed to parse path` で受け付けられない）。

指したものと違うものが消えるのは、削除できないことより悪い。宛先を正しく伝えられない名前は `shell.trashItem` へ渡さず、失敗として返す。`fs.rm` に切り替えないのは、完全削除の経路を持たない方針を曲げないため。掛かるのは削除だけで、作成はこの形の名前を受け付けず、改名は `fs.rename` を使うので字義どおり動く ── つまり**この名前のものは、改名してから消せる。**

4 で親を見るため、`linkToOutside/new.txt` は作成の時点で拒否される。一方 `linkToOutside` 自身の削除・改名は通る ── **リンクを消すのであって、指し先を消すのではない**ため。Workspace の中にある「外を指す入口」を片付けられないと、ツリーに並んでいるのに手が出せないものが残る。

**読み込みだけは対象そのものの realpath を見る**（`readWorkspaceFile.ts`）。目的が違うため。

| 操作 | 見る対象 | 理由                                         |
| ---- | -------- | -------------------------------------------- |
| 読む | 対象自身 | 外の実体の**中身を渡さない**ことが目的       |
| 書く | 親       | 外の実体には触れず、中のリンクを外すのが目的 |

結果として「Workspace の外を指す symlink は、開けないが消せる」になる。

#### 上書きしない

- **作成** … `writeFile` の `wx` と `mkdir`（recursive なし）はどちらも既存で EEXIST になる。先に存在を確かめてから作ると、その隙間に同名のものが現れた場合に**中身を消して上書きする**
- **改名** … `fs.rename` は行き先があれば黙って上書きするため、ここだけ事前に `lstat` で確かめる。大文字小文字だけを変える改名（`readme.md` → `README.md`）は Windows で「既にある」と判定されるので、その組み合わせだけ確認を飛ばす
- **コピー** … 同名でも断らず、衝突しない名前を作る（§10.8）。**上書きしない点は同じ**で、`COPYFILE_EXCL` と recursive なしの `mkdir` で作ってみて EEXIST なら次の候補へ進む

#### 削除は OS のごみ箱へ送るだけ

`fs.rm` を公開していない。Renderer から来た要求で戻せない削除が起きる状態を作らないため（誤操作の確認は UI にも入れているが、UI は迂回されうる）。`shell.trashItem` は Windows の IFileOperation を呼ぶもので、フォルダは中身ごとごみ箱へ入り、元の場所へ戻せる。

ごみ箱へ送れない場合（ネットワークドライブ・容量超過）は**失敗として返し、完全削除に切り替えない。**「ごみ箱に入ったつもりが消えていた」が起きる方が、削除できないより悪い。応答の `method` を真偽値ではなく `'recycle-bin'` という名前にしてあるのは、完全削除の経路を持たないことを型として残すため。

#### 失敗の分類

`CONFLICT` を `IpcErrorCode` に足した。同名衝突は**利用者が直せる**失敗で、`INVALID_REQUEST`（入力そのものが不正）とは次の一手が違う（前者は名前を変えれば通る）。Git の非早送りマージなど、後続ドメインでも同じ性質の失敗が出てくる。

名前の問題は `INVALID_REQUEST` の `detail` に `FileNameProblem` を入れて返す。UI 側の事前チェックをすり抜けた入力に対しても、Main が同じ規則で出した理由を表示できるようにするため。

##### ごみ箱へ送れなかった理由は、例外ではなく fs に訊く（Session 3-5.2）

`shell.trashItem` が投げるのは `message` と `stack` しか持たない素の Error で、`code` も `errno` も無い。残る手掛かりの message は**原因と対応していない**（Electron 43.3.0 / Windows 11 で観測）。

| message                              | 実際の原因                                                       |
| ------------------------------------ | ---------------------------------------------------------------- |
| `Failed to parse path`               | 対象が無い / 名前の末尾が空白・ドット / `/` 区切り / `\\?\` 表記 |
| `Operation was aborted`              | 対象または中のファイルが他プロセスに排他で開かれている           |
| `Failed to perform delete operation` | 権限が無く、シェルの昇格ダイアログを利用者が閉じた               |

1つの文言が無関係な原因を束ね、1つの原因が複数の文言に散る。**文字列で分類すると Electron の版が変わったときに静かに壊れる**ため、message は診断用の `detail` に残すだけにして、分類は**失敗した後にファイルシステムへ訊き直して**行う（`main/files/deleteObstacle.ts`）。`EBUSY` / `EACCES` / `EPERM` / `ENOENT` は OS ではなく libuv が決めるので、判定が OS ごとに割れない。

- **事前には調べない。** 読み取り専用属性のファイルは `open(path, 'r+')` が `EPERM` で失敗するが、ごみ箱へは問題なく入る。事前検査にすると今まで消せていたものを消せなくする
- **フォルダは中を歩く。** 削除を止めているのはたいてい中の1ファイル。件数と深さに上限を置き、見つからなければ `unknown`
- **リンクは開かない・辿らない。** `open` すると指し先を触ることになる（「消すのはリンクそのもの」と同じ理由）
- **`EBUSY` を `EPERM` より優先する。** 読み取り専用のファイル1つで「使用中」が隠れないように、上限まで探してから答える

`BUSY` を `IpcErrorCode` に足した。`CONFLICT`（要求を変えれば通る）とも `PERMISSION_DENIED`（待っても直らない）とも次の一手が違い、**使っている側を閉じて同じ要求をやり直す**のが答えになる。分からなかったものは `INTERNAL` のまま返す ── 以前は一律 `PERMISSION_DENIED` にしていたが、分からないものを「権限が無い」と言い切ると、閉じれば消せる場合にも利用者を諦めさせる。

### 10.3 Editor のタブ

```
持つ    tabs（開いた順） / activeTabId / 次の id
導く    active（activeTabId との一致） / 同じファイルが既に開いているか（relativePath の一致）
```

**`active` をタブごとの真偽値として持たない。** 持つと「2枚が active」「1枚も active でない」が表現できてしまう。Workspace Shell がパネルの可視状態をレイアウトから導出している（§7.7）のと同じ考え方。

**id は relativePath ではない。** 重複を防ぐ鍵は relativePath だが、タブの同一性は発番した id で持つ。relativePath を id にすると、リネームのたびに React から見て別のタブになり、スクロール位置や将来の編集状態が失われる。

未保存かどうかは、Session 3-3 の時点では常に false の `dirty` として項目だけ持たせてあった。「閉じてよいか」「印を出すか」の判断の入口をここに置くためで、Session 3-4 で実際に編集が入り、Session 3-5 で Conflict / 削除済みまで含む `state` に置き換わった（§12.3）。後から足していたら、判断が UI 側に散った状態から集め直すことになっていた。

中身は `EditorDocument` として状態で持つ（`loading` / `ready` / `binary` / `too-large` / `error`）。バイナリと大きすぎるを IPC の失敗にしていないのは、どちらも「読めたが、テキストとしては出せない」という**通常の結末**だから（`workspace-folder:open` の `'cancelled'` と同じ扱い）。

#### 配り方

Files が開き、Editor が出す。2つは自由に配置を変えられて親子関係が固定されていない（§7.3）ため、Context で配る（`editor/context.ts`）。Provider は **Workspace Shell の外側**（`App.tsx`）に置く。中に置くと、レイアウトの都合でパネルが作り直されたときにタブが消える。

```
App.tsx
└── WorkspaceFolderProvider     どの Workspace か
      └── EditorProvider        開いているタブ
            └── WorkspaceShell  …
```

Workspace が変わったときの破棄は、Files のように `key` では行えない（`key` を付け替えると Shell ごと作り直され、レイアウトの状態まで消える）。描画中に「前回見た Workspace」と食い違っていたら state を初期化する形にしてある（`useEditorTabs.ts`）。effect で消すと、1フレームだけ前の Workspace のタブが見える。

#### Monaco が入る範囲

差し替わったのは `EditorDocumentView.tsx` の中だけで、タブの状態（`editorTabsModel.ts`）と読み込みの経路（`useEditorTabs.ts`）は Session 3-4 でも変わっていない（足したのは印を差し替える操作と、応答に増えた `revision` の受け取りだけ）。Monaco 本体の話は §11。

Session 3-5 でも同じで、増えたのは印が真偽値から状態になったこと（§12.3）と、応答の `encoding` の受け取り（§12.5）だけ。読み込みの経路も、同じファイルを2枚開かないことも、リネームでタブが同じであり続けることも変わっていない。

### 10.4 Files の操作 UI

| 入口               | 置き場所                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| 右クリックメニュー | `FileContextMenu.tsx`（対象によって項目を変える）                                 |
| ツールバー         | `FilesExplorer.tsx`（新規ファイル / 新規フォルダ / 表示方式 / 検索 / 再読み込み） |
| root 行の ×        | `FileTree.tsx`（カラム表示では左端のカラムの見出し。Workspace を閉じる。下記）    |
| キーボード         | F2 で改名、Delete で削除                                                          |

**できない操作を並べて無効にするのではなく、出さない。** root に「削除」が灰色で並んでいると、条件次第で消せるように見える。root に改名・削除が無いのは、それが Workspace そのものであり Files パネルの操作範囲（Workspace の中）の外側にあたるため。

#### root 行の「Workspace を閉じる」

Files パネルは Workspace の中身を出す唯一の場所で、「もうこのフォルダで作業していない」と気づくのもここになる。そのため閉じる入口を上部バーの Workspace メニューだけに置かず、root 行にも出す。

**閉じるのは Workspace であって、フォルダではない。** 同じ行の右端に「削除」があると取り違えるため、root 行のコンテキストメニューには削除を出していない（上の表）。

処理は Session 3-1 の Workspace Close（`useWorkspaceFolder().closeWorkspace`）をそのまま呼ぶ。**ここに後片付けを書かない**のが要点で、

- Files のツリー … Workspace が未選択になれば `FilesPanel` が `FileTree` を描かなくなる（§9.6）
- Editor のタブ … `useEditorTabs` が Workspace の id の変化を見て捨てる（§10.3）
- 保存内容（`lastWorkspace`）… Main 側の Close 処理が解除する（§8.5）

はいずれも「Workspace が未選択になった結果」として起きる。閉じる入口が増えても、破棄の処理は増えない。

見た目とイベントで決めていること:

- ボタンは `flex: 0 0 auto`、名前の側は `flex: 1 1 auto; min-width: 0`。**Workspace 名がどれだけ長くても × が行の外へ押し出されない**（名前が省略される）
- クリックは `stopPropagation` する。しないと、閉じる操作が同時に root の開閉としても走る
- キーボードの `keydown` も止める。Enter で押したとき、行の ARIA tree 操作（Enter = 決定）へ抜けてしまうため

**名前は別のダイアログではなくツリーの中で打つ。** どのフォルダに対する操作なのかが画面から消えると、深い階層ほど分かりにくくなる。作成もリネームも同じ入力欄（`FileNameInput.tsx`）で、Enter が確定・Escape と focus 外れが取り消し。押し間違いで確定すると意図しないファイルが増える一方、取り消しは打ち直せば済むため、blur は取り消しにしてある。

#### 「確定した」と「送信している」を分ける（Session 3-5.1）

Enter を押しても、その名前が通るとは限らない。同名衝突・権限・直前に外から消された ── どれも**入力欄を閉じずに打ち直してもらう**べき失敗で、IPC の往復が終わるまで結果は分からない。

ここを1つの印（「もう確定した」）で済ませると、送信したまま失敗した入力欄が**確定済みとして固まる**（Enter も Escape も blur も、二重送信の抑止に飲まれる）。打ち直すことも取り消すこともできない行がツリーに残り、逃げ道はパネルを閉じるくらいしかなくなる。

```
editing ──Enter──▶ submitting ──失敗──▶ editing      打ち直して再試行できる
   │                    │
   │                    └───成功──▶ settled           入力欄はこの後消える
   └──Escape / blur────────────────▶ settled
```

**抑えるのは submitting のあいだだけ。** 二重送信を防ぎたいのは応答を待っている区間であって、失敗した後ではない。判断は `files/nameEditState.ts` に切り出してあり（`fileTreeModel.ts` が行の並びを決めているのと同じ立ち位置）、`FileNameInput.tsx` はそれに従って描くだけ。確定できたかは `onCommit` の戻り値（`boolean | Promise<boolean>`）で伝わる。

応答を待つあいだも入力欄を `disabled` にしない ── focus が外れ、失敗して戻ってきたときにカーソルが入力欄の外にある。受け付けないことは状態の側で判断する。失敗の理由は Files パネル上部のエラー行に出る（入力欄の下に出るのは、IPC を往復させずに分かる名前の問題だけ）。

「入力中のもの」は `FileTreeDraft` として1つだけ持ち、行の並びは `flattenFileTree` が導く（§9.4 と同じで、表示の形をデータとして決める）。作成は行が1つ増え、リネームは既存の行が入力欄に差し替わる。

削除の確認はアプリ内のモーダル（`DeleteConfirm.tsx`）。ファイルとフォルダで文を分け、そのフォルダを既に展開していれば中身の数も出す。**数を出すために削除の直前に読みに行かない**（大きなフォルダで確認が出るまで待たされる）。初期 focus は「キャンセル」に置く ── 確認の目的は誤操作を止めることなので、Enter を押した勢いで削除されない側を既定にする。

### 10.5 変化の伝わり方（Lazy Load を崩さない）

作成 / 改名 / 削除の結果は、応答ではなく**イベント**（§3.3）で配る。

```
handlers/files.ts     emitIpcEvent('files:changed', { workspaceId, changes })
   ↓
files/useFileTree.ts    変わったフォルダの欄を捨てる → 既存の読み込み経路が読み直す
editor/useEditorTabs.ts タブの位置を追従させる / 消えたタブを閉じる
```

**変化を知る必要がある側と、操作した側が違う。** 応答で配ると、操作した箇所（Files のコンテキストメニュー）が Editor の都合まで知ることになる。イベントにしておけば受け取る側が増えても送る側は変わらず、**アプリの外での変更（Session 3-5 のファイル監視）もまったく同じ形で流せている**（`changes` を配列にしてあるのはそのため。監視では複数の変化がまとめて届く）。どちらから来たかは payload の `source` が持つ（§12.2）。

**ツリー全体を読み直さない。** 1件の変化で読み直すのは**その親フォルダ**だけ（`fileChanges.ts` の `directoriesToReload`）。`node_modules` を展開した状態でファイルを1つ作っただけで数千件を読み直すことにならないようにするため。§9.4 の Lazy Load はそのまま保たれる。改名は元と先が同じフォルダなので1つに畳まれ、移動（§10.7）は別のフォルダなので2つになる ── **受け手はその区別を持たない。**「位置が変わった」から読み直す相手を導けば、同じ規則のまま両方に落ちる。

読み直しは**「忘れる」ことで起こす。** 読み込み済みの表からその欄を消すだけで、「展開されているのに中身を知らないフォルダを読む」という既存の経路が拾う。変更のための読み込み経路を別に作らないので、要求の重複や取り消しの扱いも従来の1本のまま。

消えた / 移った位置の配下は、読み込み済みの表からも展開状態からも外す。展開状態を残すと、**同じ名前のフォルダが後から作られたときに勝手に開いた状態で現れる**。

### 10.6 Session 3-3 の範囲外

| 項目                       | 状況                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| Monaco Editor 本実装       | **Session 3-4 で実装**（§11）                                                |
| 編集・保存・Auto Save      | **Session 3-4 / 3-5 で実装**（§11.5〜§11.7・§12.4）                          |
| UTF-8 以外の文字コード     | **境界を §12.5 に整理**（BOM の保持まで対応。それ以外は今もバイナリ扱い）    |
| 移動                       | **Session 3-6-1 で実装**（§10.7）。移動元と移動先の両方の親を境界に通す      |
| コピー / ペースト          | **Session 3-6-2 で実装**（§10.8）。単一のファイル / フォルダのみ             |
| ドラッグ&ドロップ          | **Session 3-6-3 で実装**（§10.9）。移動 / コピーへの2つめの入口              |
| ファイル変更監視の完成版   | **Session 3-5 で実装**（§12.1）。通知は `files:changed` をそのまま使っている |
| タブの並べ替え / 分割      | `editorTabsModel.ts` に操作を足す                                            |
| 右クリックメニューの共通化 | Terminal / Git でも要るようになったら `renderer/src/ui/` へ引き上げる        |

### 10.7 移動（Session 3-6-1）

`files:move` は「別のフォルダへ動かす（名前は変えない）」だけを持つ。改名（`files:rename`）と別のチャンネルにしてあるのは、**確かめる相手の数が違う**ため。

| 操作 | 触る場所 | 境界の検証                                              |
| ---- | -------- | ------------------------------------------------------- |
| 改名 | 1つ      | `resolveExisting`（元の親）だけ                         |
| 移動 | 2つ      | `resolveExisting`（元の親）＋ `resolveParent`（移動先） |

改名は新しい名前に区切り文字を含められない（`findFileNameProblem`）ので、行き先の親は必ず元の親と同じになる。そこへ移動を混ぜると**1つの要求が2つの場所を指す**ことになり、片方だけ通した経路から Workspace の外へ出られる。分けておけば、§10.2 の手順（相対位置の検証 → 親の realpath → 境界 → その直下だけを触る）を**両方に**そのまま通せる。

名前は動かす前のものをそのまま使うため、行き先で名前を検査し直さない。元の側は削除・改名と同じく `findExistingNameProblem`（既に在るものを指せるか）だけを当てる ── 他の OS で作られた `aux.ts` が「並んでいるのに動かせない」ものにならないようにするため（§10.2 の後半と同じ理由）。

**移動にしか無い失敗が1つある。** 移動先が、動かすもの自身か、その中（`src` を `src/lib` へ）。パスの形も名前も正しく、権限にも実在にも関係しないため、fs に任せると OS の `EINVAL` になり「引数が変」以上のことを伝えられない。判断できる側で判断し（`invalid-destination`）、理由は `INVALID_REQUEST` の `detail` に載せる。この文字列は送る側と読む側の両方が見るので shared に置く（`shared/files/move.ts` の `MOVE_INTO_SELF_DETAIL`。`FileNameProblem` を detail に載せているのと同じ扱い）。比べるのは **realpath どうし** ── 相対位置の文字列で比べると、途中にジャンクションを挟んだ行き先（`link/sub` が実は `src/sub`）をすり抜けさせてしまう。

**同じフォルダへの移動は、何もせずに成功として返す。** 行き先の存在確認が自分自身を見つけて `already-exists` になるのを避けるため（動かないという結果は同じでも、「同名のものがある」という理由は嘘になり、利用者は別の名前を探し始める）。行き先に既にあるものは、改名と同じく事前に `lstat` で確かめて断る ── `fs.rename` は黙って上書きするうえ、移動では行き先が別のフォルダにあり利用者から見えていないことが多い。

ボリュームをまたぐ移動（`EXDEV`）は失敗として返し、**「コピーしてから消す」へ切り替えない。** 移動のつもりで始めた操作が、途中で失敗したときに元と先の両方へ中途半端な状態を残す形になるため。

変化は改名と同じ `renamed` として配る（§10.5）。受け手から見れば「位置が変わった」だけで、Files は変わったフォルダを読み直し、Editor はタブの位置を付け替える ── **どちらも Session 3-3 から1行も変えていない。**

UI は2手に分ける（`FileContextMenu.tsx`）。

```
右クリック →「移動…」        動かすものを決める（この時点では何も起きない）
   ↓  Files パネル上部に案内が出る／その行が薄くなる
行き先を右クリック →「ここへ移動」
```

**行き先を選ぶダイアログを別に作らない。** 行き先を選ぶのに一番向いた道具が目の前のツリーそのもの（畳んだフォルダは開いてから選べる）であり、別の器を作ると「どこへ動かすのか」を2箇所で表すことになる。移動先になれないフォルダには**項目自体を出さない**（`moveTarget.ts`。§10.4 の「できない操作を並べて無効にするのではなく、出さない」をここでも通す）。ただし `moveTarget.ts` は Main の検証の代わりではない ── Renderer は realpath を持たないので、ジャンクションを挟んだ行き先が実は自分自身の中だった、という形はここでは見抜けない。それを見るのは Main で、断られたときは上の文言が出る。

失敗しても移動の状態を解かない（行き先を選び直せば通る失敗が大半のため）。やめる手段は右クリックメニューと Escape の両方に置く。

**Session 3-6-3 でドラッグ&ドロップが2つめの入口になった**（§10.9）。この2手は残す ── ドラッグでは行き先が画面に出ていないと選べないため、遠い場所へ動かす場合や畳んだフォルダの中を選びたい場合の道として要る。動かす処理も判定（`moveTarget.ts`）も共通で、増えたのは入口だけ。

### 10.8 コピー / ペースト（Session 3-6-2）

`files:copy` は「別のフォルダへ複製する（元は残る）」だけを持つ。対象は**単一のファイル / フォルダ**で、複数選択はまだ無い。

境界の確かめ方は移動（§10.7）とまったく同じ ── `resolveExisting`（元の親）と `resolveParent`（コピー先）の**両方**に §10.2 の手順を通し、行き先が複製するもの自身かその中なら断る。要求の形も相対位置2つで揃えてある。移動で通した経路をそのまま使えているので、コピーのために境界の検証は1行も増えていない。

違うのは4点で、どれも**コピーが「中身を持ってくる操作」である**ことから出てくる。

|                         | 移動                       | コピー                             |
| ----------------------- | -------------------------- | ---------------------------------- |
| 同じフォルダが行き先    | 何もせず成功               | **成立する**（複製が1つ増える）    |
| 同名のものがある        | 断る（`CONFLICT`）         | **名前を変えて作る**（下記）       |
| 元がリンク              | 通る（リンクを動かすだけ） | **断る**（`link-source`）          |
| 1回の fs 操作で終わるか | 終わる（`rename`）         | **終わらない**（途中で失敗しうる） |

#### 名前は「作ってみて、既にあったら次の候補へ」で決める

`example.txt` → `example copy.txt` → `example copy 2.txt`。この規則は `shared/files/copyName.ts` に置いた（`fileName.ts` と同じく、shared に実装を置く例外）。Main は実際に作る側、Renderer は何ができるのかを説明する側で、**2箇所に書くと「案内された名前」と「実際にできた名前」がずれる。**

上書きしない点は作成・改名・移動と同じで、コピーだけが**利用者に名前を訊き直さずに済ませている。** 複製は「同じものをもう1つ」であって名前そのものに意味が無いため、この省略が成立する。

**先に一覧を読んで空き番号を探さない。** 読んでから作るまでの隙間に同名のものが現れると、そこで上書きが起きる。`COPYFILE_EXCL` と recursive なしの `mkdir` はどちらも既存で EEXIST になるので、作ってみて EEXIST なら次の候補へ進めば、その隙間が無い（§10.2「上書きしない」と同じ考え方）。

拡張子はファイルだけ切り分ける（`my.folder` は `my copy.folder` ではなく `my.folder copy`）。上限（255）を超える場合は**元の名前の方を削る** ── 連番を削ると衝突を避けられず、拡張子を削ると別の種類のファイルになる。既に付いている " copy" は数え直さない（利用者が最初からその名前を付けた場合と区別が付かない）。

#### リンクは辿らない・作り直さない

再帰コピーは `main/files/copyTree.ts`。**symlink / ジャンクションに当たったらとばして数える。**

- 辿ると、**Workspace の外にある実体の中身を中へ持ち込める** ── §9.3 の抜け道そのもの
- 中を指すリンクでも、祖先を指していれば再帰が終わらない
- 作り直す形にすると、Windows では権限が要るうえ、**外を指す入口をアプリが新しく増やす**

**元そのものがリンクの場合は断る**（`link-source`）。削除・改名・移動がリンクに対して通る（リンクそのものを動かすだけで指し先には触れない。§10.2）のと矛盾しない ── 違うのは、コピーだけが中身を持ってくる操作である点。

**とばしたことは黙らせない。** 件数を応答の `skippedCount` に載せ、0 でなければ成功していても伝える。複製したつもりで中身が欠けている方が、断られるより悪い。リンク1つで全体を断らないのは、それをすると `node_modules` を含むフォルダが複製できなくなるため。

種別の判断は `readdir` の `withFileTypes` ではなく **lstat を1件ずつ**通す。Dirent の種別は再解析ポイントの扱いがプラットフォームの実装に委ねられており、ここでの種別の判断は「リンクを辿らない」という境界そのものにあたるため、答えを1つの API に寄せる。

リンクを辿らない以上、実体のフォルダの木に循環は無い（Windows にフォルダのハードリンクは無い）。**だから深さの上限を置いていない** ── 置くと、攻撃者のいない場所に「深いと失敗する」という失敗だけが増える。

#### 途中で失敗しても片付けない

フォルダの再帰コピーは1回の fs 操作では終わらない。途中で権限や使用中に当たったらそこで止め、**作りかけはそのまま残す**（`partial`）。消しに行くと `fs.rm` が要り、Renderer から届いた要求で戻せない削除が起きる経路を1つ増やすことになる（§10.2）。

残ったものは `files:changed` の `created` として配るのでツリーに現れ、利用者が見て消せる。**作られたものを配ってから失敗を返す**のが要点で、配らないと「失敗したのに、次に開いたら何か増えている」になる。失敗の分類（権限 / 使用中 / それ以外）はそのまま持ち上げつつ、`detail` に `COPY_PARTIAL_DETAIL` を載せて「作りかけが残っている」ことを伝える ── 原因が何であれ**次の一手が同じ**（残ったものを消して、もう一度試す）ため、文言は1つにまとめられる。

移動が `EXDEV` で「コピーしてから消す」へ切り替えないのと向きは違うが、拠りどころは同じ ── **アプリが黙って中途半端な状態を作らない / 消さない。**

#### 変化は `created` 1件だけ

再帰コピーでも配るのは**コピー先に1つ現れた**という `created` 1件で、中身までは配らない。中は展開されていなければ読まれておらず、展開されていれば「読み直す ＝ 忘れる」だけで既存の読み込み経路が拾う（§10.5）。**コピー専用の更新経路を1つも作っていない**のはこのため。

元は動いていないので `renamed` にはならない。受け手（Files のツリー・Editor のタブ）はここでも1行も変えていない。

#### Renderer 側のクリップボード

`renderer/src/files/clipboard.ts` に `{ mode: 'copy' | 'cut', entry }` として持つ。持つのは relativePath だけで、**OS のクリップボードには載せない** ── 載せるには絶対パスか実体が要り、Renderer が絶対パスを持たない前提（§9.2）を崩す。

`cut` は器としては最初から持たせてあるが、**UI からは載せていない。** 貼り付け先が成立するかの問い（`findPasteRejection`）が mode で変わる（copy は同じフォルダへの貼り付けが成立し、cut は成立しない）ため、mode を持たない形にするとその分岐が呼び出し側へ漏れる。

**Session 3-6-3 で「cut は UI へ出さない」と決めた**（§10.9）。移動の主な入口はドラッグ&ドロップになり、右クリックの「移動…」は行き先が画面に出ていない場合の道として残る。ここへ cut を足すと**同じ操作への入口が3つ**になり、しかも 3 つめは「切り取り → 貼り付け」という2手で、既にある「移動… → ここへ移動」と手数も結果も同じものになる。器（`mode`）はそのまま残す ── OS のクリップボードとの受け渡し（エクスプローラから切り取って貼る）を入れるときに要る形であり、そのときは Main 側の別の経路を通す話になる。

UI は移動と同じ2手（`FileContextMenu.tsx`）。

```
右クリック →「コピー」          複製するものを控える（この時点では何も起きない）
   ↓  Files パネル上部に案内が出る／その行に点線の下線が付く
貼り付け先を右クリック →「ここに貼り付け」
```

移動との違いは3つ。**貼り付けても控えを捨てない**（元が残るので、続けて別のフォルダへ貼るのは素直な操作）。**行を薄くしない**（薄さは「ここから無くなる」の印として使っており、コピー元は残る）。**同じフォルダも貼り付け先になる**（その場で複製が1つ増える）。

「次に何かする」状態は**一度に1つだけ持つ** ── コピーを始めれば移動の途中は解け、その逆も同じ。2つ同時に持てると、フォルダを右クリックしたときに「ここへ移動」と「ここに貼り付け」が並び、案内も2行になる。Escape はどちらもやめる。

Ctrl+C / Ctrl+V は割り当てていない。**その2つが OS のクリップボードを指す約束**として広く通っており、ここで扱っているのは Files パネルの中だけの控えになるため。

### 10.9 ドラッグ&ドロップ（Session 3-6-3）

**新しいファイル操作を1つも足していない。** ここで実装したのは、Session 3-6-1 の移動と Session 3-6-2 のコピーに対する**2つめの入口**だけ。素のドラッグが移動、Ctrl を押しながらがコピーで、Windows のエクスプローラの約束（同じボリュームの中では既定が移動）に合わせてある。対象は単一のファイル / フォルダで、複数選択はまだ無い。

```
掴む                    落とす                    起きること
──────────────────────────────────────────────────────────
行（root 以外）      フォルダ行                 その中へ移動
                    ツリーの余白 / root 行      Workspace 直下へ移動
Ctrl + 同じ操作      同じ場所                   移動ではなく複製
```

#### 判定は作り直さず、そのまま呼ぶ

```
useFileDrag.ts   マウスの追跡。カーソル下の行を探す（files/ で DOM を読む唯一の場所）
   ↓ FilesDropZone
dragDrop.ts      落とせるか / どこへ落ちるか
   ↓ canMoveInto（moveTarget.ts・§10.7） / canPasteInto（clipboard.ts・§10.8）
useFilesController.ts  performMove / performCopy ── 右クリックの2手と同じ出口
```

Workspace Shell のドラッグ&ドロップ（§7.5）を「座標の解釈」「操作への翻訳」「マウスの追跡」に分けたのと同じ分け方で、**翻訳の中身は既存の関数を呼ぶだけ**にしてある。ここに規則を書き直すと、右クリックからは断られる操作がドラッグからは通る（あるいはその逆の）ずれが生まれる。mode で呼び分けているのは、**成立する範囲が移動とコピーで違う**ため（同じフォルダへのコピーは複製が1つ増えるので成立する）── その差は `findPasteRejection` が既に mode で持っている。

**Main 側の契約が最終的な正本**であることも変わらない。Renderer は realpath を持たないため、ジャンクションを挟んだ行き先が実は Workspace の外だった、という形はドロップ先の判定では見抜けない。見えている位置（relativePath）だけで決まるものをここで断り、それ以外は Main が断る（`files:move` / `files:copy` が §10.2 の手順を両方の親に通す）。実際に、ツリー上ではフォルダに見えるジャンクション（指し先は Workspace の外）へのドロップは、ハイライトが出たうえで Main に拒否される ── **Renderer が通した ＝ 許可された、ではない**ことが動作として確かめられる形になっている。

#### 落とせる場所は「フォルダ行」と「ツリーの余白」だけ

**ファイル行をその親フォルダへ読み替えない。** 読み替えると、画面で指している行と実際の行き先が違うことになり、深い階層ほど取り違えが起きる。ファイル行・状況を伝える行（「（空のフォルダ）」など）・名前を打っている行の上では、**ドロップできるように見える表示を出さない**（ハイライトは出ず、カーソルに付く小さな表示だけが薄くなる）。

ツリーの余白を Workspace root への行き先にしているのは、root 行がスクロールで見えていないときにも Workspace 直下へ戻す道を残すため。root 行そのものもフォルダ行として同じ行き先になる（root は掴めないが、行き先にはなれる ── §10.4 で「移動…」「コピー」を root に出していないのと同じ切り分け）。

**閉じたフォルダを、落とすために自動で開くことはしない。** 畳んだフォルダへ落とせば中へ入る（行き先はフォルダそのもの）。開いてから中の場所を選びたい場合は、右クリックの2手の方が確実で、そのために2手を残してある。

#### 案内は既存の要素の上に描く（要素を重ねない）

| 場所                 | 出るもの                                                     |
| -------------------- | ------------------------------------------------------------ |
| 落とせるフォルダ行   | 帯 + 枠（選択の帯より強く）                                  |
| 落とせる余白（root） | ツリーの内側に破線の枠                                       |
| 掴んでいる行         | 移動なら薄く、コピーなら点線の下線（§10.7 / §10.8 と同じ印） |
| カーソルの右下       | 「移動 / コピー」+ 名前（移動中は「Ctrl でコピー」）         |
| ツリー全体のカーソル | `grabbing` / `copy`                                          |

ガイドのために**要素を1つも重ねていない**のが要点。重ねるとそれがカーソルの下に入り、当たり判定（`elementFromPoint`）が行を見つけられなくなる。カーソルに付く小さな表示だけは重なるので、`pointer-events: none` にしてある ── これは見た目の都合ではなく、**判定が成立するための条件**にあたる。

掴んでいる行の印を §10.7 / §10.8 と同じもの（移動は薄く、コピーは下線）にしてあるのは、起きることが同じであるため。入口が違うだけで結果が同じものに、覚える印を2組作らない。

#### 座標だけは React の状態に入れない

ドラッグ中の状態（掴んでいるもの・移動 / コピー・行き先）は state に持つが、**カーソルの座標は持たない。** pointermove ごとに state を書き換えると数百行のツリーごと再描画になるため、小さな表示の位置は `useFileDrag.ts` が DOM へ直接書き込む。state が変わるのは行き先か mode が変わったときだけ（§7.5 の `isSameCandidate` と同じ考え方）。

#### ドロップの後は既存の経路に載る

移動なら `renamed`、コピーなら `created` が `files:changed` で届き、Files のツリーは変わったフォルダだけを読み直し、Editor はタブの位置を付け替える（§10.5）。**ドラッグのための更新経路は1つも作っていない** ── ビルド版の確認では、1回のドラッグ移動で読み直されたのが「元の親」と「行き先」の2つだけであることを Main 側の `readdir` の呼び出しで確かめてある（docs/DEVELOPMENT.md §4）。

#### ポインタイベントで実装する

理由は §7.5 と重なる（ドラッグ中の表示を自前で描く・キャンセルの扱いを実装差に依存させない・運ぶのが1件で `DataTransfer` が要らない）。加えて **HTML5 の Drag and Drop API は自動確認のドライバから動かせない**ため、ポインタイベントであることが「実際のマウス操作として確かめられる」ことの条件にもなっている。

- しきい値（4px）を超えるまではドラッグにしない。行のクリック（開く / 開閉）と取り違えないため
- **ドラッグの後の `click` を無視する。** 離すと click が続くため、見なければドロップと同時にファイルが開く / フォルダが開閉する
- 掴んだ時点で `setPointerCapture`。掴んだ行がドロップの結果で消えても、リスナーは window 側にあるので取りこぼさない
- Escape / `pointercancel` / ウィンドウのフォーカス喪失で、何もせず終わる。**このとき控え（コピー）や移動の途中は解かない** ── ドラッグの Escape はそのドラッグをやめるためのもので、掴み直そうとしたら控えが消えていた、にならないようにする
- Ctrl の押し下げ / 離しでも案内を作り直す（マウスを動かさずに切り替えても表示が追いつく）。実際に使われるのは**離した瞬間の位置と Ctrl の状態**で、表示のために持っていた値ではない

**画面の外への運搬は Session 3-6-8 で埋めた**（§10.14）。この節の時点では、行き先が画面の外にある場合はいったん離して掴み直すしかなかった。足したのは縁で止めたときに中身が流れることだけで、**掴む・判定する・落とす経路は1つも変えていない。**

---

### 10.10 プロジェクト全体検索 ― ファイル名（Session 3-6-4）

Files パネルから、Workspace の中を**名前で**探す。ファイルの中身に対する検索（全文検索）は Session 3-6-5 で、この節の走査・上限・取り消し・UI の上に足した（§10.11）── **この節の経路はそのまま**で、要求も応答も変えていない。

```
renderer/src/files/useFileSearch.ts     ← Renderer で検索を呼ぶ唯一の場所
   ↓  window.fluvix.files.search({ searchId, query })
preload/api/files.ts                    薄いラッパ
   ↓  IPC（files:search / files:cancel-search）
main/ipc/handlers/files.ts              基点を現在の Workspace から取り、結末を分類へ翻訳
   ↓
main/files/workspaceSearchSession.ts    今走っている検索1本の管理（取り消しの理由を集める）
   ↓
main/files/searchWorkspaceFiles.ts      root から再帰的に潜る（上限つき・取り消し可能）
   ↓
main/files/ignoredDirectories.ts        監視と共有している除外の規則
shared/files/search.ts                  上限の値と、名前の照合の規則（Main / Renderer 共通）
```

| チャンネル            | 要求                  | 応答                                                                                |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `files:search`        | `{ searchId, query }` | `{ workspaceId, searchId, query, status, matches, truncated, limit, scannedCount }` |
| `files:cancel-search` | `{ searchId }`        | `{ cancelled }`                                                                     |

#### 走査は Main、Renderer は歩かない

列挙（`files:read-directory`）を Renderer から繰り返して自前で再帰する形にしていない。そうすると、**Lazy Load のために1階層ずつにした経路が、検索という別の目的で全階層を舐める経路に化ける**（読む量が利用者の操作した範囲で止まる、という §9.4 の前提がそこで消える）。上限も取り消しも Renderer 側の都合になり、境界の検証を通る回数だけが増える。

Renderer が言えるのは検索語までで、返るのも相対位置を持つ `FileEntry`（§9.2）だけになる。**結果の型を検索専用にしていない**のは、押したときに開く経路がツリーの行とまったく同じ（`openFile({ relativePath, name })`）だからにほかならない。

#### 境界は「潜り方」で守る

起点は realpath まで解決した root ひとつだけで、そこから先は **readdir が返した名前を継ぎ足して降りるだけ**。名前に区切り文字も `..` も混ざらない以上、組み上がる位置は必ず root の下に収まる ── 相対位置を外から受け取らないため、`workspacePath.ts` の検証を通す相手そのものが無い（検証すべき入力が存在しない形にしてある）。

**リンク（symlink / ジャンクション）の中へは潜らない。** 潜れば Workspace の外にある実体を舐めることになり、結果に「中にあるはずのない位置」が混ざる。コピー（§10.8）が辿らないのと同じ線で、リンクそのものは**1件として結果に出す**（そこに在るものだから）。副産物として、リンクの輪で無限に潜る経路もここで消える。

#### 無制限に列挙しない

上限は4つ。値は `shared/files/search.ts` にあり、**Main と Renderer が同じものを見る**（画面に数を出すのは Renderer のため）。

| 上限   | 値      | 何のためか                                       |
| ------ | ------- | ------------------------------------------------ |
| 件数   | 500     | 目で追えない数を出しても、絞り込む方が早い       |
| 深さ   | 12      | 生成物・キャッシュの入れ子で実質無制限になりうる |
| 走査数 | 50,000  | `.git` / `node_modules` を外しても数万件に届く   |
| 時間   | 4,000ms | 遅いディスクでは、少ない件数でも終わらなくなる   |

件数だけでは足りない ── **一致が0件でも数十万件を舐めうる**ため、走査数と時間は「見つからないときのため」の上限にあたる。どれも失敗ではなく「ここまでしか見ていない」という事実として返し（`truncated` / `limit`）、Renderer が理由ごとに違う文言で伝える。

除外するフォルダ（`.git` / `node_modules`）は**監視（§12.1）と同じ規則を共有している**。規則そのものを `ignoredDirectories.ts` へ移し、監視側はそれを呼ぶだけにした ── 2箇所に書くと、`.git` の中の変更は届かないのに検索結果には出る、という食い違いが生まれる。除外しているのは再帰的に舐める処理だけで、ツリーで展開すれば中身は普通に見えるし、開いて編集もできる。

#### 走るのは常に1本（取り消しの構造）

同時に走らせない。検索は Workspace 全体を舐める操作で、利用者が見ている検索欄は1つ、古い結果はもう要らない。並行して走れる形にすると、上限が実質的に本数ぶん緩む。

止める理由は3つあり、集めているのは `workspaceSearchSession.ts`。

| 理由                   | 経路                                                    |
| ---------------------- | ------------------------------------------------------- |
| 新しい検索が来た       | `beginWorkspaceSearch` が古い方を必ず止める（置き換え） |
| 利用者が止めた         | `files:cancel-search`（識別子を突き合わせる）           |
| Workspace 切替 / Close | `onWorkspaceFolderChange` で進行中のものを捨てる        |

走査（`searchWorkspaceFiles.ts`）が見るのは `cancellation.cancelled` だけで、**誰が止めたかを知らない。** 見るのは readdir の直後（＝ await から戻った直後）── JavaScript は途中で割り込まれないため、取り消しの要求が届くのもその隙間しかない。

**識別子は Renderer が作る。** Main が振って応答で返す形にすると、応答が届く前 ── つまり取り消したい間 ── 呼び出し側が対象を指せない。識別子を突き合わせているので、「止めるボタンを押した瞬間に次の文字を打った」場合でも、始まったばかりの検索は止まらない。

取り消しは**失敗ではない**。`status: 'cancelled'` として、そこまでに見つけたものと一緒に返る（保存の `'stale'` と同じ扱い。§11.6）。利用者が自分で止めた場合、その時点の結果はそのまま使える。

**新しい検索は Main と Renderer の両方で古い方を無効にする。** Main だけだと古い応答が新しい結果を上書きしうるし、Renderer だけだと捨てる結果のためにディスクを舐め続ける。

#### パネルを増やさず、モードで切り替える

検索は Files パネルの中の**もう1つの見せ方**として実装した（`renderer/src/files/FilesView.tsx`）。パネルを足すと置き場所と大きさを利用者が決めることになり、「探す → 開く → ツリーで場所を確かめる」という一続きの操作が画面上の2箇所に分かれる。

**どちらも作り直さない。** `hidden` で隠すだけにしてあるため、切り替えでツリーの展開状態も検索結果も失われない ── Lazy Load で読む量を利用者の操作した範囲に留めているのに、表示の切り替えだけで全部忘れるのは筋が通らない。隠れている側は何もしない（検索は語が入るまで要求を出さず、ツリーは変化の通知を受けるだけ）。

ツリー自身は検索を知らない。持っているのは**入口**（ツールバーのボタン）と**出口**（`revealTarget` ＝ 検索結果から指された場所を見せる）の2つだけ。見せ方（祖先を開いて選ぶ）を決めるのはツリー側で、`revealEntry` は**読み込みを直接始めない** ── 祖先を開けば、Session 3-2 の「展開されたのに中身を知らないフォルダを読む」経路がそのまま拾う。

結果を押したときの分岐は1つだけ。ファイルは Editor で開き（検索モードのまま。続けて別の結果を開ける）、フォルダは Editor で開けないのでツリーへ戻って場所を見せる。

#### 状態を言い分ける

検索中・0 件・取り消し・打ち切り・失敗は、**利用者の次の一手がそれぞれ違う**。1つの「結果がありません」にまとめると、待てば出るのか、探し方が悪いのか、壊れているのかが画面から決まらなくなる。判断は `fileSearchModel.ts`（純粋・テスト対象）が持ち、文言もそこで決まる（失敗の文言だけは `filesError.ts` にある他の失敗と並べてある）。

一致した部分に印を付ける範囲は `shared/files/search.ts` の `findFileNameMatch` から出ている ── Main が「一致した」と判断した根拠と、Renderer が色を付ける範囲が同じ1つの規則になる。小文字へ畳むと長さが変わる文字（`İ`）を含む名前では、位置が保証できないので**印を付けない**（一致していること自体は変わらない）。

#### この節の範囲外

| 項目                       | 現状                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| ファイル本文の全文検索     | **Session 3-6-5 で実装**（§10.11）。別のチャンネル・別の上限として足した  |
| 検索範囲の指定（フォルダ） | 起点は常に root。足すと境界の検証の対象が1つ増える                        |
| 除外の設定                 | `.git` / `node_modules` 固定。Settings から読む形にできる（§12.8 と同じ） |
| 結果の追従                 | 結果はその時点の写し。返した後にディスクが変われば古くなる（探し直す）    |
| あいまい一致・正規表現     | 大文字 / 小文字を区別しない部分一致だけ。語は字義どおりに扱う             |

### 10.11 プロジェクト全体検索 ― 全文（Session 3-6-5）

Files パネルから、Workspace の中のファイルの**中身**を探す。§10.10 の走査・上限・取り消し・UI の上に載せてあり、**名前の検索は1行も変えていない**（値と純粋な関数だけを共有している）。

```
renderer/src/files/useFileContentSearch.ts   ← Renderer で全文検索を呼ぶ唯一の場所
   ↓  window.fluvix.files.searchContent({ searchId, query })
preload/api/files.ts                         薄いラッパ
   ↓  IPC（files:search-content / files:cancel-search）
main/ipc/handlers/files.ts                   基点を現在の Workspace から取り、結末を分類へ翻訳
   ↓
main/files/workspaceSearchSession.ts         名前の検索と**同じ**管理（走るのは常に1本）
   ↓
main/files/searchWorkspaceFileContents.ts    root から潜り、1件ずつ開いて読む
   ↓
main/files/contentMatches.ts                 文字列 → 一致の位置と preview（純粋・テスト対象）
main/files/fileContent.ts                    バイナリ判定・BOM（Editor と同じ判断）
main/files/searchQuery.ts                    検索語の規則（名前の検索と共有）
shared/files/contentSearch.ts                上限の値と結果の型（Main / Renderer 共通）
```

| チャンネル             | 要求                  | 応答                                                                                                             |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `files:search-content` | `{ searchId, query }` | `{ workspaceId, searchId, query, status, files, matchCount, searchedFileCount, scannedCount, truncated, limit }` |
| `files:cancel-search`  | `{ searchId }`        | `{ cancelled }`（**名前の検索と共有**）                                                                          |

#### なぜ別のチャンネルか

`files:search` に「中身も見る」という切り替えを足していない。理由は検索を `files:read-directory` に足さなかったのと同じで、**1回の要求の重さが別物**だから ── 名前の検索が readdir だけで済むのに対し、こちらは対象を1件ずつ開いて読む。上限も応答の形（ファイル単位のまとまり・行・桁）も共有できない。

分けたことで、Session 3-6-4 の経路は**要求も応答も型も1文字も変わっていない**。

#### 走査は分け、規則は共有する

潜り方（root だけを realpath で解き、readdir が返した名前を継ぎ足して降りる）は §10.10 と同じ考え方で、**除外の規則**（`ignoredDirectories.ts`）・**深さと走査数の上限**（`shared/files/search.ts`）・**検索語の規則**（`searchQuery.ts`。3-6-5 で `searchWorkspaceFiles.ts` から切り出して共有した）はそのまま共有している。

一方で**ループは分けた**。2つの走査は「何を集め、何で止まるか」が別物で ──

|                | 名前（§10.10）             | 中身（ここ）                     |
| -------------- | -------------------------- | -------------------------------- |
| 結果になるもの | ファイルとフォルダ         | ファイルの中の行だけ             |
| 止まる条件     | 見つけた件数               | 読んだファイル数・一致の総数     |
| リンク         | **1件として結果に出す**    | **中身を読まない**（下記）       |
| 読めないもの   | 関係ない（名前しか見ない） | バイナリ・大きすぎるものをとばす |

共通の走査へ寄せると、これらを呼び出し側から差し込む形になり、ループの外に散った条件を読んで初めて挙動が分かる状態になる。**値と純粋な関数として共有できているものは共有し、制御の流れは分ける**という切り方にした。

#### リンクは読まない

名前の検索はリンク（symlink / ジャンクション）を1件として結果に出す（そこに在るものだから）。全文検索は逆で、**リンクは中身を読まない。** 読めば Workspace の外にある実体の中身が preview に載り、Renderer へ渡ってしまう ── `readWorkspaceFile.ts` が「読むときは対象そのものの realpath を見る」と決めているのと同じ線を、こちらは「そもそも読まない」側で引いている。中へ潜らないのは名前の検索と同じ。

#### 読まないもの

| 対象                     | 理由                                                      |
| ------------------------ | --------------------------------------------------------- |
| `.git` / `node_modules`  | 監視・名前の検索と同じ除外（`ignoredDirectories.ts`）     |
| symlink / ジャンクション | 外の実体の中身を持ち込まない（上記）                      |
| 大きすぎるファイル       | **Editor で開ける上限と同じ値**（下記）                   |
| バイナリ                 | 判定は Editor と同じ（`fileContent.ts` の `looksBinary`） |

どれも失敗にせず、黙ってとばす。**探せなかったものを1件ずつ数えて見せる意味が無い**（利用者が知りたいのは、見つかったものと、全部を見たかどうかだけ）。

1ファイルの上限を `FILES_FILE_MAX_BYTES`（2 MB）と**同じ値にしてある**のが要点で、別にすると「見つかったのに開けない」か「開いて Ctrl+F では見つかるのに全体検索に出てこない」のどちらかが必ず起きる。**Editor で開けるものを探す**と決めておけば、その食い違いが構造的に生まれない。

#### 上限は6つ

深さ・走査数は名前の検索と共有し、残りは全文検索のもの（`shared/files/contentSearch.ts`）。

| 上限              | 値          | 何のためか                                                          |
| ----------------- | ----------- | ------------------------------------------------------------------- |
| 一致の総数        | 1,000       | 名前（500）より多い。1行が1件になるため、500 では数ファイルで尽きる |
| 1ファイルの件数   | 50          | 巨大な1ファイルが総数を使い切ると、他のファイルの一致が出ない       |
| 読むファイル数    | 2,000       | 「名前を見た数」と「開いて読んだ数」は費用が2桁違う                 |
| 1ファイルの大きさ | 2 MB        | Editor で開ける上限と同じ（上記）                                   |
| 時間              | 6,000ms     | 名前（4,000ms）より長い。1件ごとに読み込みが挟まるため              |
| 深さ / 走査数     | 12 / 50,000 | §10.10 と同じ値（潜り方が同じなら別の数を持つ理由が無い）           |

打ち切りはすべて失敗ではなく「ここまでしか見ていない」という事実として `truncated` / `limit` で返す。理由は6つ（`matches` / `files` / `scanned` / `time` / `depth` / `file-matches`）あり、**利用者の次の一手が違うので言い分ける**。走査を止めた理由が無いときだけ、弱い理由（`depth` → `file-matches`）を出す ── 「そこに在るのに探していない」の方が「見つけたものの一部を出していない」より効くため、深さを先に見る。

1ファイル内で打ち切ったことは、そのファイルの `truncated` としても返る（画面では `50 件以上`）。

#### 一致の位置と preview

照合は**1行ずつ**（`contentMatches.ts`）。全体を探してから行番号を数える形にすると、行の数え方（`\r\n`）が2箇所に現れる。行・桁はどちらも**1始まり**で、Monaco と同じ数え方 ── 受け渡しのたびに ±1 する箇所を作らない。

大文字 / 小文字は区別しない。ただし位置まで返すため、畳み方に注意が要る。`toLowerCase()` は文字数が変わることがある（`İ`）ので、

- 畳んでも長さが変わらない行 … 畳んだ行の上で `indexOf`（ほぼすべての行がこちら）
- 変わる行 … 生の行の上を1文字ずつ切り出して畳んで比べる（位置は正確）

と分けている。**ずれた位置を返すよりは見つけない**（`findFileNameMatch` が印を付けないのと同じ判断）。

`preview` は一致の周辺を切り出したもの（前 24 文字・全体 200 文字まで、切った側に `…`）。圧縮された JavaScript のように1行が数十万文字のファイルがあり、行をそのまま返すと IPC で運ぶ量も描く量もその1行で決まる。制御文字は**1文字を1文字へ**空白に置き換えるため、`previewColumn`（preview の中での位置）はそのまま使える ── Renderer は印を付ける位置を**探し直さない**。

#### 取り消しと「走るのは1本」

`workspaceSearchSession.ts` を名前の検索と**共有している**。走ってよい検索は名前・全文を通じて常に1本で、新しい検索を始めた時点で古い方は必ず止まる ── **モードを切り替えて検索し直した瞬間に、前のモードの検索が止まる**のもこの1本化から来ている。分けると、2つの検索が同時にディスクを舐め、上限が実質2本ぶんに緩む。

取り消しのチャンネルも共有（識別子の作り方が同じで、走っているのが1本なら区別する必要が無い）。Renderer 側の識別子だけは頭文字で分けてある（`c<workspaceId>#<n>`）── 同じ番号が2つの hook から出ると、止めるつもりのない検索を止めうるため。

#### UI（モードで切り替える）

パネルも、検索の入口も増やしていない。Files パネルの検索モードの中が**ファイル名 / 全文**の2つになった。

```
[<]  [ ファイル名 | 全文 ]      FileSearch.tsx（枠。戻る手段とモードの切り替え）
     [検索欄]                   FileNameSearch.tsx / FileContentSearch.tsx
     状態の1行
     結果
```

**どちらのモードも作り直さない**（`hidden` で隠すだけ）。ツリーと検索を切り替えても状態を捨てないのと同じ形で、名前で探して見つからず全文へ切り替え、また戻る、という行き来で結果が消えない。

「名前も中身も同時に探す」形にしていないのは、結果の並べ方が2種類混ざる（名前は1行、中身はファイル単位の入れ子）うえ、上限が2つの検索ぶん緩むため。

結果は **フォルダ → ファイル → 一致** の3段で並べる。

```
src                          ← 見出し（押せない）
  App.tsx            3 件    ← 押すと最初の一致へ
    3:7  const example = 1   ← 押すとその行・桁へ
```

まとめるのは Main（走査した側）で、行に展開するのは `fileContentSearchModel.ts`（純粋・テスト対象）。**入れ子の DOM にしない**のは、上下キーの移動を「配列の隣」で決めるため（ツリーと同じ考え方）。

状態は名前の検索と同じ5分類（検索中 / 0 件 / 取り消し / 打ち切り / 失敗）で言い分ける。0 件の文言だけは変えてある（「一致するファイルはありません」ではなく「一致するテキストはありません」）── 探した対象が違うため。

#### Editor へのジャンプ

結果を押すと、**ツリー・名前検索と同じ `openTab`** を通ってファイルが開く（`openFileAt`）。既に開いているファイルなら2枚目のタブは作られず、そのタブが手前に出て位置だけが動く。

位置は「開く操作」に混ぜず、**依頼として持つ**（`editor/editorReveal.ts`）。

```
FilesView.openMatch → openFileAt → openTab（既存のタブなら activate）
                                 → pendingReveal { relativePath, line, column, length, token }
                                        ↓ 中身が届いて Monaco に Model が載った時点で
MonacoEditor         → setSelection + revealPositionInCenterIfOutsideViewport → consumeReveal
```

- **タブの状態にしない**：タブが持つのは開いている間ずっと正しいことで、位置の依頼は1回きり。タブに載せると、切り替えて戻るたびに同じ場所へ引き戻される
- **開いた直後には飛べない**：新しいタブは `loading` から始まる。依頼として置いておけば、「新しく開いた」「既に開いていた」を区別せずに同じ1つの経路で飛べる
- 適用する effect は Model を載せる effect の**後**に宣言してある（React は宣言順に走るため、`Model を載せる → 飛ぶ` の順が保たれる）
- 行・桁は Renderer から見れば境界の外の値なので `validatePosition` で Model の範囲に収める（アプリの外でファイルが短くなっていても壊れない）
- テキストとして出せないファイル（binary / too-large / 失敗）は Monaco に載らないため、依頼は `useEditorTabs` 側で捨てる
- 一致した範囲はそのまま**選択状態**にする（preview に付けた印と同じ範囲になり、飛んだ先で探し直さずに済む）。既に見えている位置ならスクロールしない

#### この節の範囲外

| 項目                       | 現状                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| 置換 / 一括置換            | 検索は読むだけ。書く側は `files:write-file` の経路（§11.6）に載せる形になる |
| 正規表現 / あいまい一致    | 大文字 / 小文字を区別しない部分一致だけ。語は字義どおりに扱う               |
| 検索フィルター（拡張子等） | 要求は検索語だけ。足すなら契約と走査の両方に条件が増える                    |
| 検索範囲の指定（フォルダ） | 起点は常に root（§10.10 と同じ理由）                                        |
| Git 連携検索 / AI 検索     | DESIGN.md の将来項目。走査の入口が別のもの（index・履歴）になる             |
| 複数行にまたがる語         | 照合は1行ずつ。改行を含む語は `INVALID_REQUEST` として断る                  |
| UTF-8 以外の文字コード     | UTF-8 として読む（§12.5）。Shift_JIS のファイルは一致しない                 |
| 結果の追従                 | その時点の写し。返した後にディスクが変われば古くなる（探し直す）            |

### 10.12 ファイル種類別のアイコン（Session 3-6-6）

一覧の視認性のための表示層の変更。**IPC も契約もデータ構造も1つも変えていない** ── 増えたのは Renderer の中の判定1つ（`files/fileIcon.ts`）と、その答えを描く SVG（`FileTreeIcons.tsx`）だけになる。

#### データを変えずに、名前から決める

`FileEntry`（§9.2）にアイコンの欄を足していない。種類は名前から Renderer 側でその場で分かるもので、Main が運ぶ理由が無い ── 運べば「今ディスクにあるものの写し」だったはずの型が表示の都合を持ち始め、アイコンを1つ増やすたびに IPC の応答が変わる。

**入口は名前1つ**にしてある（`FileEntry.extension` から引く形にしていない）。全文検索の結果は `FileEntry` を持たずファイル名しか無い（§10.11）ため、extension を要求すると、そこだけが自前で拡張子を切り出すことになる。

#### 判定と描画を分ける

| 場所                | 責務                                                | 依存                      |
| ------------------- | --------------------------------------------------- | ------------------------- |
| `files/fileIcon.ts` | 名前 / 種別 → `FileIconId`（2つの対応表と優先順位） | なし（テスト対象）        |
| `FileTreeIcons.tsx` | `FileIconId` → SVG（`FILE_ICON_SHAPES`）            | React（JSX を返すだけ）   |
| `files.css`         | `FileIconId` → 色                                   | `styles/theme.css` の変数 |

`fileTreeModel.ts`（並び）と `FileTree.tsx`（描画）を分けてあるのと同じ分担で、判定だけが React にも DOM にも依存しない形で残る（`editor/monaco/language.ts` が Monaco を import しないのと同じ理由）。`FILE_ICON_SHAPES` は `Record<FileIconId, …>` なので、種類を足して絵を足し忘れると型エラーになる。

#### 表は2つに分け、名前が先に効く

```
1. 名前そのもの（小文字で完全一致）   package.json / .gitignore / Dockerfile / README.md …
2. 拡張子（小数点なし・小文字）       ts / tsx / js / jsx / json / html / css / md / py / cs / 画像 / txt …
3. どちらにも無ければ無地のアイコン
```

- **混ぜない。** 1つの表にすると `README.md` を「md の例外」として拡張子の表に書くことになり、`md` の行を読んでも何が起きるか分からなくなる
- **名前が先。** `package.json` は JSON でもあるが、そのプロジェクトでの意味は「パッケージの定義」の側にある。逆順にすると名前の表は一度も効かない
- **完全一致だけ。** `Dockerfile.dev` のような派生形を拾おうとすると「前方一致か / 区切りはどこか」という規則が増え、それは拾えなかった名前が出るたびに揺れる
- **先頭のドットは拡張子ではない。** `.gitignore` の拡張子は `gitignore` ではない（`language.ts` と同じ規則）。複数のドットを含む名前（`app.test.ts`）は最後のドットから後ろだけを見る
- **フォルダに種類の表を当てない。** フォルダは開いているかどうかだけで決まる（`Dockerfile` という名前のフォルダにクジラが付かない）。フォルダ名ごとの専用アイコン（`src`・`node_modules`）は持たない ── 足すなら3つめの表になる

#### ツリーと検索で同じ判定を通る

呼ぶのは `FileTree.tsx` / `FileNameSearch.tsx` / `FileContentSearch.tsx` の3箇所で、**どれも `fileIcon.ts` の関数を呼ぶだけ**。判定を描く側に書くと、同じファイルがツリーでは TypeScript なのに検索結果では無地、という食い違いが入口ごとに生まれる（開く経路を1つに保っているのと同じ考え方。§10.11）。

検索結果のフォルダには展開状態が無いため、`expanded` は省略できる（＝閉じたフォルダとして描かれる）。

#### 見た目で決めていること

- **大きさは種類によらず 14px。** 行の高さ（22px）もインデントも展開の三角の位置も変わらない。**種類が分からないファイルでも必ず何かを描く**ので、名前の左が空いて行ごとに文字の位置がずれることも起きない
- **外部アセットを持たない。** その場で描く SVG のままで、CSP（`default-src 'self'`）は1文字も緩めていない。アイコンフォントも画像も増えない
- **色は補助であって、唯一の手掛かりにしない。** 種類はまず絵の形が示す。色が主になるのは形が同じ組（`.tsx` / `.jsx`）だけで、そこは TypeScript / JavaScript の系統色に揃えてある
- **全部には色を付けない。** テキストと種類不明のファイルは無彩色のまま。全部に色が付くと色そのものが情報を持たなくなる（一覧が色の並びになり、種類のある行が沈む）
- 値は `styles/theme.css` の `--fx-file-icon-*` に置く。彩度は識別色（DESIGN.md §3）と同じく低く保ち、面ではなく細い線にだけ乗せる
- 名前を打っている最中の行（作成 / 改名）は種類別にしない。1文字ごとに絵が変わると、打っている名前ではなくアイコンに目が行く

#### この節の範囲外

| 項目                             | 現状                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| フォルダ名ごとのアイコン         | `src` / `node_modules` / `.git` などは持たない（3つめの表になる） |
| 名前の派生形（`Dockerfile.dev`） | 完全一致だけを見る（上記）                                        |
| アイコンテーマの切り替え         | 表と色は固定。差し替えるなら `FILE_ICON_SHAPES` ごと切り替える形  |
| Editor のタブのアイコン          | 同じ関数を呼べば足せる。今回は Files パネルの中だけ               |

---

### 10.13 横長時のカラム表示（Session 3-6-7）

Files パネルは Dock / Split / Resize で形が変わる（DESIGN.md §3）。左右に置けば縦長、画面下部に置けば横長になり、**同じツリーがどちらでも最適とは限らない**。横長のときにフォルダ階層を左から右へ展開する見せ方を足した。

```
Project | src | renderer | files
```

**表示方式が増えただけで、Files は1つのまま。** 新しい Main 側の API も、2つめのデータモデルも作っていない。

#### 何を共有し、何が違うのか

| もの                                            | ツリー | カラム | 実体                                           |
| ----------------------------------------------- | ------ | ------ | ---------------------------------------------- |
| `FileEntry` / `relativePath`                    | 同じ   | 同じ   | `shared/files`（§9.2）                         |
| 読み込み済みの中身（`directories`）・展開状態   | 同じ   | 同じ   | `useFileTree.ts`（§9.4）                       |
| Lazy Load の経路                                | 同じ   | 同じ   | 「展開されたのに中身を知らないフォルダを読む」 |
| 作成 / 改名 / 削除 / 移動 / コピー / D&D / 開く | 同じ   | 同じ   | `useFilesController.ts`                        |
| 状況を伝える行・名前の入力欄                    | 同じ   | 同じ   | `FileRows.tsx`                                 |
| フォルダ1つの中身を行にする関数                 | 同じ   | 同じ   | `fileTreeModel.ts` の `directoryRows()`        |
| 並べ方                                          | 縦     | 横     | `FileTree.tsx` / `FileColumns.tsx`             |
| フォルダを押したとき                            | 開閉   | 右の列 | 上記2つの唯一の違い                            |

#### 層の分け方

Session 3-6-6 までは `FileTree.tsx` が状態も操作も描画も持っていた。表示方式が2つになったので、**同じものを2箇所に書かない**ために3つへ割った。

```
useFilesController.ts   状態と操作（何が起きるか）      ← ツリーとカラムが共有する
FilesExplorer.tsx       器（ツールバー・帯・メニュー・確認・ドラッグの表示）
FileTree.tsx            縦に並べる + キーボード
FileColumns.tsx         横に並べる + キーボード
```

`fileTreeModel.ts`（行の並び）と `FileTree.tsx`（描画）の分担をもう一段進めた形で、`layout/` と `shell/` の関係（§7）と同じ考え方になる。**器を表示方式で変えていない**のも要点で、作成の入口も移動の途中を伝える帯も失敗の帯も、どちらでも同じ場所に出る。

#### カラムの状態は「一番右のフォルダ」1つだけ

列の配列を持たない。持つのは `activeDirectory` で、そこから root までの祖先をたどれば列が決まる（`filesColumnsModel.ts` の `columnDirectories()`）。

```
activeDirectory = 'src/renderer/files'
  → ['', 'src', 'src/renderer', 'src/renderer/files']
```

この形にすると、**「別のフォルダを選んだら、それより右の古い列は捨てる」が処理ではなく導出になる。** 列を配列で持つと選び直すたびに右側を切り詰める処理が要り、切り詰め忘れると画面に古い階層が残る。

- カラムを開くことは**そのフォルダを展開すること**として表す（`openDirectory`）。読み込みは既存の1本の経路が拾うため、カラム表示のための読み込みを1つも足していない
- ツリーへ切り替えると、同じ場所が開いた状態で見える（展開を共有しているため）
- 逆向き（ツリー → カラム）は**選んでいるものを起点にする** ── ツリーの展開は枝分かれした集合で、そこから1本の道は決まらない
- 途中のフォルダが消えたら、読み直した結果（`not-found`）から**開ける場所まで戻す**（`clampActiveDirectory()`）。削除の操作から直接畳まないので、アプリの外での削除も同じ経路で畳まれる

#### 表示方式の決め方（提案と選択を分ける）

パネルの形は利用者がいつでも変えられるため、**形から決まる方**と**利用者が選んだ方**を1つの値に混ぜない（`filesLayoutMode.ts`）。

```
auto     … パネルの形に任せる（起動直後。まだ何も選んでいない）
explicit … 利用者が選んだ。以降、形が変わってもこちらが勝つ
```

混ぜると、カラムで見たいから選んだのにパネルを細くした拍子にツリーへ戻り、戻すとまた次のリサイズで変わる ── 選んだことが残らない。

しきい値には**遊び**を持たせてある（入る条件を厳しく、出る条件を緩く）。同じ値にすると、パネルの境界を掴んで動かしている間に 1px ごとに表示方式が入れ替わる。

| 判断           | 条件                                           |
| -------------- | ---------------------------------------------- |
| カラムを勧める | 幅 520px 以上 **かつ** 横 / 縦が 1.6 倍以上    |
| ツリーへ戻す   | 幅 440px 未満 **または** 横 / 縦が 1.2 倍未満  |
| 据え置く       | 上記の間、および幅か高さが 0（描かれていない） |

#### ResizeObserver は Files パネルの器1つだけ

観測するのは `FilesPanel` の `.fx-files-panel` 1箇所（`useFilesLayout.ts`）。行にもカラムにも張らない ── 中身に張ると開いた行の数だけ観測対象が増える。

**リサイズで state を書き換えない。** 観測した px は ref に置き、state として持つのは `'tree' | 'columns'` の**提案1つ**だけ。しきい値の遊びがあるため、この値が変わるのはドラッグ1回につき多くて数回になる。**ファイルツリーのデータはこれに一切触られない**（`directories` も `expanded` も作り直されない）。

#### 選んだことはパネルより長く生きる

パネルを Dock / Split で動かすとレイアウトの木の中で位置が変わり、`FilesPanel` は React に作り直される。選択をパネルの中に持つと**運んだだけで消える**ため、選択だけを Shell の外側（`FilesViewProvider`）に置いた。

| 状態                         | 置き場所                                          | 寿命                             |
| ---------------------------- | ------------------------------------------------- | -------------------------------- |
| 選んだ表示方式               | `FilesViewProvider`（App 直下）                   | アプリが動いている間             |
| パネルの形の観測と提案       | `useFilesLayout`（パネルの中）                    | パネルと同じ（動かせば測り直す） |
| 開いているカラム・選択・展開 | `useFilesController`（Workspace の `key` の内側） | Workspace が変わるまで           |

Workspace が切り替わると、古い Workspace の選択も開いていたカラムも React が破棄する（§9.6）。表示方式だけは残る ── それは**パネルの見え方**であって Workspace の持ち物ではない。

#### ドラッグ&ドロップは面ごとに行き先を持つ

判定（`dragDrop.ts`）も追跡（`useFileDrag.ts`）も Session 3-6-3 のものをそのまま使う。行の探し方（`.fx-file-row` と `data-relative-path`）は表示方式で変わらないため、器を1つ預けるだけで動く。

変えたのは**余白の行き先**で、`'tree-root'` を `'surface'`（受け持つフォルダを持つ）に一般化した。`data-drop-surface` を持つ一番内側の要素が答えるため、表示方式ごとの分岐が判定側に入らない。

| 面                         | 余白の行き先                               |
| -------------------------- | ------------------------------------------ |
| ツリーの器                 | Workspace root                             |
| カラムの中身               | そのカラムのフォルダ                       |
| カラムの外側（右端の余白） | 行き先にしない（どのフォルダでもないため） |

**移動 / コピーの後は行き先を見せる。** ツリーでは行き先を展開していたが、カラムでは「行き先の列が出ていない」が同じ状態にあたるので、`activeDirectory` を行き先にする ── どちらも「どこへ行ったのかが画面から分かる」ための同じ判断になる。

#### スクロール

- 全体は**横**（`.fx-files__columns`）、カラムの中は**縦**（`.fx-file-column__body`）。縦を器に持たせると、右のカラムを下まで見るために左のカラムまで一緒に流れる
- 右端のカラムまで送るのは **`activeDirectory` が変わったときだけ**。行が届くたび・選択が動くたびに送ると、左のカラムを見ている間に画面が横へ動く
- カラムの幅は固定（208px）。中身に合わせて伸ばすと、深い階層へ入るたびに左のカラムの幅が変わり、さっき押した行の位置が動く

#### キーボード

ツリーと語彙を揃える。変わるのは上下左右の意味だけで、決定 / 改名 / 削除は同じ。

| キー          | ツリー        | カラム                       |
| ------------- | ------------- | ---------------------------- |
| ↑ / ↓         | 前後の行      | 同じカラムの中の前後の行     |
| →             | 開く / 中へ   | 開く / 右のカラムへ          |
| ←             | 閉じる / 親へ | 左のカラムの、このフォルダへ |
| Enter / Space | 決定          | 決定                         |
| F2 / Delete   | 改名 / 削除   | 改名 / 削除                  |

ARIA は両方とも `tree`。カラムでは列の位置が階層なので `aria-level` に列の番号を入れ、右のカラムを開いているフォルダに `aria-expanded` を立てる（ツリーの「展開中」と同じ旗を、`directoryRows()` の `isOpen` で切り替えている）。

#### この節の範囲外

| 項目                      | 現状                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| カラムの幅の変更          | **Session 3-6-8 で実装**（§10.14）。列ごとではなく1つの幅        |
| 表示方式の保存            | **Session 3-6-8 で実装**（§10.14）。`files-settings.json`        |
| プレビュー列（Finder 風） | 一番右にファイルの中身を出す列は持たない（それは Editor の仕事） |
| カラムでの複数選択        | ツリーと同じく単一のまま                                         |

---

### 10.14 Files の仕上げ（Session 3-6-8）

Session 3-6-1 〜 3-6-7 で足した機能そのものは変えず、**使い続けたときに引っかかる3つ**を埋めた回。新しい操作も、新しい見せ方も増えていない。

| 埋めたもの                 | Session 3-6-7 までの状態                       | どこに書いたか                              |
| -------------------------- | ---------------------------------------------- | ------------------------------------------- |
| 見え方が次の起動に残らない | 選んだ表示方式はアプリを閉じると忘れる         | `files-settings.json` と `settings:*-files` |
| カラムの幅が変えられない   | 208px 固定                                     | 同じ文書の `columnWidth`                    |
| 画面の外へ運べない         | 行き先が見えていないと、離して掴み直すしかない | `filesAutoScroll.ts` と `useFileDrag.ts`    |

#### 見え方は「パネルの見え方」であって Workspace の持ち物ではない

保存するのは**表示方式（auto / tree / columns）とカラムの幅**の2つだけで、Workspace ごとには持たない。開いているフォルダを切り替えても、選んだ見え方は変わらないのが正しい ── 選択も展開も Workspace と一緒に捨てられるが（§9.6）、見え方はそれらと別のものにあたる（§10.13「選んだことはパネルより長く生きる」の延長で、今回それが**アプリの起動より長く**なった）。

```
FilesViewProvider.tsx           選んだ表示方式と幅の正本。ここだけが読み書きする
files/filesSettings.ts          保存形式との変換・幅の上下限（React も IPC も知らない）
shared/settings/filesSettings.ts  ディスクに置く形
main/store/filesSettingsDocument.ts  形として読めるかの検証
main/store/filesSettings.ts     保存先（files-settings.json）
```

読み書きを Provider に置いたのは、**そこが見え方の正本だから**にほかならない。使う側（`useFilesLayout` / `FileColumns`）に置くと、パネルの数だけ保存の口ができる。読むのは起動時に1度だけで、**読み終わるまで保存を許さない**（先に許すと既定値で上書きした後に読み込みが届き、起動のたびに選択が消える。§12.4 の Auto Save と同じ形）。

#### 「選んでいない」も保存する

`auto`（パネルの形に任せる）を、保存しないことでは表さない。保存が無いことを auto とみなすと、**カラムを選んでから auto へ戻したことが次回に伝わらない**（前回の explicit がそのまま残る）。3つの値のうちの1つとして書く。

知らない mode（アプリのダウングレード）と桁外れの幅は、読む側が既定と上下限へ落とす。Main が見るのは「後で解釈できる形か」まで ── §12.4 と同じ分担で、二重に解釈すると「どちらが正しいか」が生まれる。

#### カラムの幅は列ごとに持たない

掴んで変えられるのは1つの値で、全部の列が同じ幅になる。列ごとに持たない理由は表示の好みではなく、**列が導出だから**にある（§10.13）── 列は `activeDirectory` からその都度導かれ、選び直すたびに顔ぶれが変わる。列ごとの幅を持たせると、その幅が「どの列のものだったか」を保てる場所がどこにも無い。

- 掴み手は列の縁に重ねた数 px の帯（`.fx-file-column__resize`）。Dock の掴み手（§7.6）と同じ作りで、**見た目は 1px の線のまま掴める幅だけを広く取る**
- 動かし方も同じで、**開始時の幅 + 累計移動量**で計算する（前回の結果へ足し込まない）。丸めと上下限での頭打ちが積み重ならず、下限まで詰めた後にカーソルを戻せばそのまま追従する
- 上下限（160px 〜 480px）は `filesSettings.ts` の `clampColumnWidth` が持ち、**ドラッグと保存の読み書きの両方が同じ関数を通る**。片方だけに掛けると、掴んでは止まるのに保存ファイルを直接書けば通る、という食い違いが生まれる
- 幅は CSS 変数（`--fx-file-column-width`）1つを器へ載せて効かせる。列ごとに style を書くと、掴んで動かしている間に列の数だけインラインスタイルが書き換わる
- 中身に合わせて自動で伸ばすことは**相変わらずしない**。変えるのは利用者だけで、深い階層へ入っても左の列の幅は動かない

掴み手にも `data-drop-surface` を持たせてある。ドラッグ中のファイルが境目に重なった数 px だけ落とせなくなると、**落とせたり落とせなかったりする帯**が列と列の間にできるため。

#### 自動スクロールは「どれだけ動かすか」と「どこへ当てるか」を分ける

```
filesAutoScroll.ts   縁からの距離 → 1フレームで動かす量（純粋関数・テスト対象）
useFileDrag.ts       いつ回すか・どの要素に当てるか
```

dragDrop.ts（落とせるか）と useFileDrag.ts（追跡）の分け方をそのまま踏襲している。

- **フレームで回す**（pointermove では回さない）。カーソルを縁で止めたまま流れ続ける必要があり、動きの通知に紐づけると止めた瞬間に流れが止まる
- ドラッグが成立してから回し始める（掴んだだけでは回さない）。クリックのつもりの操作で中身が流れないため
- **器の中にいる間だけ動かす。** 外はそもそも落とせない場所で（`findZone`）、そこで中身が流れると、隣のパネルへカーソルを運んだだけでツリーが動く
- **縁に近いほど速い**（帯に入った時点で最低 1px）。一定の速さにすると、行き過ぎるか遅すぎるかのどちらかになる
- 動かす要素は**軸ごとに別々に探す。** カーソルの下から器まで遡り、その向きへスクロールできる最初の要素に当てる ── ツリーでは縦が器そのもの、カラム表示では縦がカラムの中・横が器になる。**器の名前で分岐しない**ので、表示方式の分岐がここに入らない
- 動かした後は**行き先を求め直す。** カーソルが止まったまま下の行が変わるため、求め直さないと案内が流れる前の行を指したまま残る

#### この節の範囲外

| 項目                           | 現状                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| 幅をキーボードで変える         | 掴み手はポインタだけ（Dock の掴み手 §7.6 と同じ扱い）        |
| 列ごとの幅                     | 上記のとおり持たない。持つなら列に安定した識別が要る         |
| ツリーの横方向の自動スクロール | ツリーは横に流れない（行は幅に収めて省略する。§9.5）         |
| 複数選択とその Drag            | 対象は今も単一のファイル / フォルダ1つ                       |
| ツリー外との Drag & Drop       | エクスプローラから落とす、は Workspace の境界を通す別の話    |
| 見え方以外の Files の設定      | 除外フォルダ・並び順などは持たない（設定画面と一緒に考える） |

---

## 11. Monaco Editor

Session 3-4 の成果物。§10.3 で用意したタブの上に、実際のコード編集を載せる（DESIGN.md §4）。

**既存の経路は変えていない。** Files でファイルを選ぶ → `files:read-file` で中身を読む → タブが持つ → Editor が出す、という §10 の流れはそのままで、最後の「出す」だけが `pre` から Monaco になった。保存（`files:write-file`）はその経路に**同じ作法で1本足したもの**で、Files 側にも Workspace 側にも変更は無い。

### 11.1 何をどこで決めるか

Monaco は大きく、DOM もワーカーも要求する。**どこまでが Monaco の話か**を先に切っておかないと、言語判定やタブの管理まで Monaco 抜きでは触れなくなる。

| 判断                          | 場所                             | Monaco への依存    |
| ----------------------------- | -------------------------------- | ------------------ |
| 拡張子 → 言語 id              | `editor/monaco/language.ts`      | **無し**（文字列） |
| Auto Save の設定              | `editor/autoSave.ts`             | **無し**           |
| どのファイルを開いているか    | `editor/editorTabsModel.ts`      | **無し**           |
| Model / 未保存 / 見ていた位置 | `editor/monaco/documentStore.ts` | **型だけ**         |
| Worker・テーマ・言語サービス  | `editor/monaco/monacoSetup.ts`   | 有り               |
| Model の作り方・エディタの器  | `editor/monaco/MonacoEditor.tsx` | 有り               |
| いつ保存するか                | `editor/useEditorSession.ts`     | 無し               |

Monaco の**実体**を import しているのは下2つだけで、そこは `MonacoEditor.tsx` から遅延して読み込まれる（§11.3）。上4つは Vitest（node 環境）から読める。

### 11.2 Worker と CSP

このセッションで一番慎重に決めた箇所。STEP 1 の CSP（`worker-src 'self'`）を**緩めずに**Monaco の Worker を動かす。

Monaco が Worker を作る経路は2つあり、**片方だけが CSP に触れる**。

| 経路                              | Monaco の既定                               | CSP          |
| --------------------------------- | ------------------------------------------- | ------------ |
| 言語ごとの Worker（ts / json 等） | `new Worker(new URL('…', import.meta.url))` | 問題なし     |
| Editor 本体の Worker              | **`URL.createObjectURL(new Blob([…]))`**    | blob: が要る |

後者は NLS（翻訳文言）をグローバルへ埋め込むための起動用スクリプトを blob として作るもので、そのまま使うと `worker-src 'self'` では起動できない。

**`MonacoEnvironment.getWorker` を定義すると、この経路は丸ごと迂回される。** Monaco 側（`standalone/browser/services/standaloneWebWorkerService.js`）が blob を作る前にこちらを呼び、返した Worker をそのまま使うため、blob を作るコードには到達しない。

```
editor/monaco/monacoSetup.ts
  self.MonacoEnvironment = { getWorker: (_, label) => … }
         ↓ label で振り分ける
  Vite が ?worker としてバンドルした Worker（out/renderer/assets/*.worker-*.js）
```

決めていること:

- **`undefined` を返さない。** 返すと Monaco は「用意が無かった」とみなして blob の経路へ落ちる。知らない label（Monaco の更新で増えるもの）は Editor 本体の Worker として扱う
- **Worker はアプリにバンドルしたものだけ。** 外部 CDN を指す `getWorkerUrl` は使わない。配布ビルドでは `file://`、開発時は dev server（同一オリジン）から読まれる
- **`worker.format: 'es'`**（`electron.vite.config.ts`）。Monaco の Worker は ES Module で、既定の iife では TypeScript サービスのような分割を含むものを出力できない

結果として、`index.html` の CSP は STEP 1 のまま1文字も変えていない。実機でも `blob:` の Worker は1つも作られず、CSP 違反は出ていない（docs/DEVELOPMENT.md §4）。

### 11.3 Monaco をいつ読み込むか

`EditorDocumentView.tsx` が `React.lazy` で `MonacoEditor.tsx` を読む。理由は2つあり、どちらもこの1行で満たされる。

- **起動を Monaco の大きさに引きずられない。** 起動時のチャンクは 261KB、Monaco は 3.9MB。Workspace を開いてテキストファイルを選ぶまで要らない
- **Panel Registry を辿るだけで Monaco が読み込まれない。** レイアウトの純粋なロジックを試すテスト（node 環境）は Registry → `EditorPanel` → `EditorWorkArea` → `EditorDocumentView` と辿り着く。Monaco は読み込まれた時点で `window` を触るため、静的に import すると DOM を使っていないテストが環境の都合で落ちる（`api/fluvix.ts` が読み込み時に `window` を見ない理由と同じ）

そのため `documentStore.ts` も **`import type` だけ**で Monaco を参照し、Model の作り方は関数として受け取る（`EditorModelFactory`）。ストアの持ち主は EditorProvider で、アプリの起動と同時に作られるため、ここで実体を import すると遅延の意味が無くなる。分担としても素直で、**ストアは持ち物の管理、Monaco の作法は器の側**になる。

言語ごとの構文定義（Monarch）は Monaco 自身が動的 import で読む。C# を開くまで C# のトークナイザは読まれない。

### 11.4 言語判定

`editor/monaco/language.ts`。拡張子（小数点なし・小文字）から Monaco の言語 id を引くだけの純粋な関数で、**Monaco を import しない**（§11.1）。

| 言語       | 拡張子                                |
| ---------- | ------------------------------------- |
| typescript | `ts` `tsx` `mts` `cts`                |
| javascript | `js` `jsx` `mjs` `cjs`                |
| json       | `json` `jsonc`                        |
| html       | `html` `htm`                          |
| css        | `css`                                 |
| markdown   | `md` `markdown`                       |
| python     | `py` `pyw` `pyi`                      |
| csharp     | `cs` `csx`                            |
| plaintext  | `txt`、および**知らない拡張子すべて** |

- **TSX / JSX に別の id は無い。** Monaco の作りで `.tsx` は `typescript`、`.jsx` は `javascript`。JSX 構文を読むかどうかは TypeScript サービスの設定（`monacoSetup.ts` の `jsx: Preserve`）が決める
- **知らない拡張子は Plain Text へ落とす。** 開けないにはしない。色が付かないだけで、編集も検索も保存もできる方がよい
- **先頭のドットは拡張子ではない**（`.gitignore`）。ファイル名そのものを見る規則を足すときに、判断が2箇所に分かれないようにする

DESIGN.md §4 が v1 の対応言語としているのは JavaScript / TypeScript・Python・C# の3つ。ここに並ぶそれ以外（JSON / HTML / CSS / Markdown）は、設定ファイルや README として**必ず同じプロジェクトの中にある**もの。

**言語サービスは Monaco 標準の範囲に留めている。** TypeScript の意味解析（semantic）は切ってある ── Monaco が内蔵する TypeScript は tsconfig も node_modules も見ないため、実際のプロジェクトでは `Cannot find module './foo'` のような**本当ではない赤線**でファイル全体が埋まる。構文解析（syntax）は1ファイルの中で完結し指摘が常に正しいので残す。型に基づく指摘・定義へ移動・Rename は LSP の担当。

JSON の `enableSchemaRequest` は明示的に false。true だと `$schema` の URL を Renderer から直接取りに行く。CSP が止めるとはいえ、**止められる前提の実装を残さない**。

### 11.5 Model の管理（Editor Tab との分担）

**タブと Model は別の層で、同一性の基準が違う。**

| 層                        | 持つもの                                            | 同一性       |
| ------------------------- | --------------------------------------------------- | ------------ |
| `editorTabsModel.ts`      | どのファイルを開いていて、どれが手前か、印を出すか  | タブ id      |
| `monaco/documentStore.ts` | 中身・Undo 履歴・カーソル・スクロール・保存済みの版 | relativePath |

タブの同一性を id で持つのは、リネームされても同じタブであり続けるため（§10.3）。中身の同一性を**位置**で持つのは、同じファイルを2通りの経路から開いても編集内容が2つに分かれてはいけないため。`useEditorSession.ts` がこの2つを噛み合わせる唯一の場所で、やっていることは3つしかない（dirty の伝達 / タブを閉じたら Model も捨てる / Workspace が変わったら全部捨てる）。

**エディタは1つ、Model は開いた数だけ。** タブを切り替えたら `setModel` で差し替える（VS Code と同じ形）。

```
MonacoEditor（1つ）
   └── setModel(…)  ← タブを切り替えるたびに差し替わる
         documentStore が持つ Model（ファイルの数だけ）
```

この形にすると、編集内容と **Undo / Redo 履歴が Model 側に付く**ので切り替えても消えず、タブが増えてもエディタのインスタンスは増えない。カーソル・選択・スクロール位置だけは Model ではなくエディタ側の状態なので、離れる前に `saveViewState` で控えて戻ったときに復元する。

**Model の持ち主は EditorProvider（Workspace Shell の外側）。** エディタ本体が持つと、View メニューで Editor パネルを閉じただけで未保存の編集が消える。

```
EditorProvider          ← Model の持ち主（Workspace が変わるまで生きる）
  └── WorkspaceShell
        └── Editor パネル
              └── MonacoEditor  ← 器。閉じても Model は残る
```

決めていること:

- **同じ位置に Model を2つ作らない。** `acquire` は既にあればそれを返し、**中身を入れ直さない**（入れ直すと、タブを切り替えて戻っただけで編集が捨てられる）。読み直しは `release` してから `acquire`
- **Model の URI には通し番号を挟む**（`fluvix://workspace/<n>/<relativePath>`）。改名では鍵だけを付け替えて Model を使い続けるため古い名前の URI が残ることがあり、位置だけから URI を作ると「改名の後に同じ名前のファイルが作られた」場合に衝突する（Monaco は同じ URI の Model を2つ作れず例外になる）。鍵が relativePath であることは変わらない
- **タブを閉じたら Model も捨てる。** 残すと、閉じたはずのファイルの未保存の編集が開き直したときに戻ってくる
- **改行は開いたときの形に固定する**（`setEOL`）。保存で書き戻すのは `model.getValue()` ＝ その改行で連結した文字列なので、ここが「CRLF のファイルが CRLF のまま保存される」の実体になる

`files:changed`（§3.3）はタブ側と Model 側が**それぞれ独立に**購読する。改名なら鍵を付け替え、削除なら（未保存でなければ）捨てる。互いを知らないため、送る側（Files の操作・ファイル監視）は受け手が増えても変わらない。中身の変更（`modified`）だけは、取り込むのにディスクを読み直す必要があるため `useEditorSession.ts` が受ける（§12.3）。

### 11.6 保存

チャンネルが1つ増えた。root を指定する引数を持たないのは他と同じ。

| チャンネル         | 要求                                      | 応答                                              |
| ------------------ | ----------------------------------------- | ------------------------------------------------- |
| `files:write-file` | `{ relativePath, content, baseRevision }` | `{ workspaceId, relativePath, status, revision }` |

```
Ctrl+S / Auto Save
   ↓  relativePath
documentStore.readForSave        中身 + 版番号 + 前回ディスクで見た版
   ↓
window.fluvix.files.writeFile    Preload の薄いラッパ
   ↓  IPC（files:write-file）
main/ipc/handlers/files.ts       基点を現在の Workspace から取る
   ↓
main/files/writeWorkspaceFile.ts 境界を確かめて書く
```

#### 見るのは対象自身（親ではない）

境界の確かめ方が、作成 / 改名 / 削除（§10.2）と**違う**。

| 操作 | 見る対象 | 理由                                         |
| ---- | -------- | -------------------------------------------- |
| 読む | 対象自身 | 外の実体の**中身を渡さない**                 |
| 保存 | 対象自身 | 外の実体の**中身を書き換えない**             |
| 作る | 親       | 外の実体には触れず、中のリンクを外すのが目的 |

保存は「指し先の中身を書き換える」操作なので、親だけを見ていると Workspace の中に置かれた**外を指す symlink を通して外のファイルを書き換えられる**。読む側と同じく対象自身を realpath まで解決してから境界に通す。

#### 新しいファイルは作らない

対象が無ければ `NOT_FOUND`。保存は「今開いているファイルへ書き戻す」操作で、開けた時点でそのファイルは Workspace の中にあったことが確かめられている。無い場合に作る形にすると、確かめる対象が「対象自身」と「親」の2通りに分かれ、上の表が崩れる。外から消された場合は保存が失敗し、Editor 側は未保存のまま残る（内容は失われない）。

#### 無条件には上書きしない

読み込みの応答に `revision`（`{ mtimeMs, size }`）が増えた。保存はそれを `baseRevision` として添え、Main は今ディスクにある版と食い違っていれば**書かずに** `'stale'` を返す。

- `'stale'` を IPC の失敗にしていないのは、これが**利用者に選択肢を出すべき状態**であって、要求そのものが成立していないわけではないため（binary / too-large と同じ扱い）
- mtime と size の組にしているのは、どちらか一方では取りこぼすため（同じ時刻に書き換わる / 1文字を別の1文字へ書き換える）。ハッシュにしないのは、保存のたびにファイル全体を読み直すことになるため
- **Reload / Compare / 上書き を並べた Conflict UI は Session 3-5 で実装した**（§12.3）。ここで用意した `'stale'` の受け口がそのまま入口になっている。黙って上書きする実装にしていたら、後から選択肢を差し込む場所が無かった

#### 一時ファイル経由にしない

`store/jsonStore.ts` は一時ファイルへ書いてから rename するが、こちらは利用者のプロジェクトの中身で、差し替えると元のファイルの属性（ACL・ハードリンク・監視ハンドル）を失う。「書き込み中に落ちても壊れない」より「**そのファイルであり続ける**」を採る。

#### 保存で `files:changed` を送らない

保存はツリーの形を変えない。Files パネルが持っているのは「どこに何があるか」であって中身ではない（§9.2）ため、通知すると保存のたびに親フォルダを読み直すことになり Lazy Load の意味が薄れる。

Session 3-5 でアプリの外での変更を拾う監視が入り、`WorkspaceFileChange` に `'modified'` が加わって同じ経路に載っている（§12.1）。**自分の保存はそこにも流していない** ── 監視は自分の書き込みと外部の書き込みを区別できないため、書けた位置を申告して短い間だけ黙らせる（§12.1）。

### 11.7 dirty と Auto Save

**dirty は「保存済みの版番号と今の版番号が違うか」で導く**（`model.getAlternativeVersionId()`）。中身の文字列を毎回比べる形にしないのは、比較の費用が中身の大きさに比例するため。副産物として、**打った文字を Undo で戻すと未保存が解ける**（ディスクと一致した状態へ戻ったことが版番号で表せる）。

保存の完了時に渡すのは「**取り出した時点**」の版番号。書き込んでいる間に打たれた文字は保存済みに含めない。

- 保存に成功 … `markSaved` → dirty が解け、`revision` が次の起点になる
- 保存に失敗 / `'stale'` … `markSaved` を呼ばない ＝ **dirty はそのまま**、編集内容も Model の中に残る

Auto Save（`editor/autoSave.ts`）は設定モデルだけを持ち、いつ保存するかは `useEditorSession.ts`。

| mode             | 内容                                     | Session 3-4 | Session 3-5  |
| ---------------- | ---------------------------------------- | ----------- | ------------ |
| `off`            | 自動保存しない（Ctrl+S だけ）            | 実装済み    | 実装済み     |
| `afterDelay`     | 入力が止まってから `delayMs` 後に保存    | 実装済み    | 実装済み     |
| `onFocusChange`  | タブから離れたときに保存                 | 後続        | **実装済み** |
| `onWindowChange` | ウィンドウがフォーカスを失ったときに保存 | 後続        | **実装済み** |

- **既定は必ず OFF。** 自動保存は利用者が明示的に選ぶものにする。既定で入れると「開いて眺めていたつもり」の操作がディスクに残る
- **4つの mode を最初から型に持った**（Session 3-4）ことで、Session 3-5 で残り2つを足しても保存形式は変わらなかった。真偽値で始めていたら、この段階で移行の手順が要っていた
- **afterDelay は debounce する。** 状態の通知は文字を打つたびに届くので、そのたびにタイマーを張り直す。実機でも10文字の連続入力に対して書き込みは1回だった
- 設定 UI の置き場所は Editor パネルの中（タブ列の右端）。上部バーは**レイアウトそのものを操作するもの**の場所で、パネル固有の設定を置くと §7.2 の分担が崩れる。Settings（DESIGN.md §9）が入った時点でそちらへ移す（設定の**値**は既にアプリの設定として保存されている。§12.4）

### 11.8 キーボード

Monaco が標準で持つものは**独自実装しない**。Undo（Ctrl+Z）/ Redo（Ctrl+Y・Ctrl+Shift+Z）/ 検索（Ctrl+F）/ 置換（Ctrl+H）/ 行移動（Ctrl+G）/ 全選択（Ctrl+A）/ コメント切替（Ctrl+/）/ インデント（Tab・Shift+Tab）はすべて Monaco の標準機能。

**Ctrl+S だけは Monaco ではなくウィンドウに掛けている。** Monaco は Ctrl+S に何も割り当てていないため、エディタに focus があっても keydown はウィンドウまで上がってくる。1本にしておくと、

- Files パネルに focus があるときも保存できる
- エディタ側とウィンドウ側で二重に発火する経路を作らない

ネイティブメニュー（`main/app/menu.ts`）とは競合しない。開発時のメニューは Reload / DevTools / Zoom / Quit だけで、配布ビルドではメニューを持たない。

### 11.9 Session 3-4 の範囲外

| 項目                            | 状況                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| LSP                             | 言語 id は §11.4。プロセス起動は Main、通知は §3.3。意味解析を Monaco 内蔵から LSP へ移す     |
| Conflict UI（Reload / Compare） | **Session 3-5 で実装**（§12.3）                                                               |
| 外部変更の監視                  | **Session 3-5 で実装**（§12.1）                                                               |
| Auto Save の残り2つの mode      | **Session 3-5 で実装**（§12.4）                                                               |
| Settings（設定の永続化）        | **Session 3-5 で実装**（§12.4）                                                               |
| 閉じる前の未保存の確認          | **Session 3-5 で実装**（§12.6・§12.7）                                                        |
| UTF-8 以外の文字コード          | **境界を §12.5 に整理**（BOM の保持まで対応済み。Shift_JIS / UTF-16 は後続）                  |
| Split Editor / タブの並べ替え   | `editorTabsModel.ts` に操作を足す。Model は位置で持っているため、同じ Model を2つの器に出せる |
| Minimap 等の表示設定            | `monacoSetup.ts` の `EDITOR_OPTIONS`。Settings と同時に入れる                                 |
| Formatter / ESLint 統合         | Monaco の `formatOnSave` ではなく、Main 側で実行する形（Terminal / LSP と同じ経路）           |

---

## 12. 外部変更と、失われないための仕組み

Session 3-5 の成果物。§11 で「編集して保存できる」ようになったエディタを、**実際の開発で1日使える**ところまで進める（DESIGN.md §4）。

扱っているのは、Editor が単独では成立しない3つ。

```
アプリの外でファイルが変わる   → 気づいて、追従するか選ばせる（§12.1〜§12.3）
自動で保存する                 → いつ書くかを利用者が選べる（§12.4）
未保存のまま終わろうとする     → 失う前に止める（§12.6・§12.7）
```

**Session 3-4 の構造はそのまま。** タブ（`editorTabsModel.ts`）・Model（`documentStore.ts`）・保存の経路（`files:write-file`）はどれも作り直しておらず、増えたのは「ディスク側の事実」と「その事実にどう反応するか」の2つだけ。

### 12.1 外部変更の監視

```
fs.watch（root 1つ・再帰）
   ↓  絶対パス
main/files/watchPaths.ts        相対位置へ落とし、境界の外と除外対象を捨てる
   ↓  相対位置
main/files/workspaceWatcher.ts  lstat で「今どうなっているか」を見て変化の種類を決める
   ↓  WorkspaceFileChange[]
emitIpcEvent('files:changed', { source: 'watcher', … })   ← §3.3 の既存の経路
   ↓
Files のツリー / Editor のタブ / Monaco の Model が、それぞれ独立に受け取る
```

**Renderer に filesystem の監視 API を渡していない。** 監視するのは Main で、Renderer が受け取るのは Session 3-3 から使っている `files:changed` だけ。変化1件の形（`WorkspaceFileChange`）も同じなので、**受け手は3つとも変わっていない**（増えたのは `modified` の扱いだけ）。

#### 監視は root に1つだけ

フォルダごとに watcher を張らない。展開されたフォルダの数だけハンドルが増え、深いツリーでは OS の上限に当たる。Windows の再帰監視は ReadDirectoryChangesW 1本で済むため、**開いている範囲に依存しない**。この形にしてあるので、Files Tree 全体の追従（created / deleted / renamed も同じ束で届いている）へそのまま広げられる。

#### 決めていること

- **束ねてから配る。** 1回の保存でも OS からは複数の通知が来る（rename → change、属性の更新）。120ms 束ね、位置ごとに1つの結末へ畳んでから配る
- **何が起きたかはディスクを見て決める。** OS のイベント種別だけでは「作られた」と「別のファイルが rename で被せられた」の区別が付かない。束ねた位置を `lstat` して、無ければ `deleted`、フォルダなら現れたときだけ `created`、ファイルなら `modified`（現れたなら `created` も）にする
- **`.git` と `node_modules` は見張らない**（規則は `ignoredDirectories.ts`。Session 3-6-4 で**検索と共有**した。§10.10）。外さないと `npm install` や `git` の操作1回で数万件が流れる。VS Code の既定の除外と同じ考え方で、**見えなくなるわけではない**（再読み込みで取れるし、開いて編集も保存もできる）。Session 3-8-8 で `.git` を見張るようになった後も、**この除外はそのまま**にしてある ── Git 用の監視は別の watcher・別のイベントで、この経路には1件も入ってこない（§14.15）
- **自分の操作は配らない。** アプリ自身の作成 / 改名 / 削除 / 保存でも監視は発火する。そのまま配ると1回の操作で `files:changed` が2回流れ、Files パネルが同じフォルダを2度読み直す（§10.5 の「読み直すのは親1つだけ」が崩れる）。操作した側が `noteAppFileChange` で位置を申告し、監視側が短い間だけ黙る
- **1束の上限は 500 件。** 大量コピーや checkout で Renderer を埋めない
- **落とさない。** 再帰監視が使えない OS（Linux）や root が消えた場合は、監視をやめるだけ。外部変更に自動で気づけなくなるが、Files の再読み込みと保存時の版の確認（§11.6）は従来どおり効く

#### アプリの外での改名は「消えた」「現れた」として届く

`WorkspaceFileChange` には `renamed` があるが、**監視からは出さない。** OS が伝えてくるのは片方ずつで、対応付けを推測すると別々に起きた削除と作成を1つの改名として扱う誤りが起きる。種別として持たせてあるのは、アプリの中の改名（`files:rename`）がその形で届くのと、受け手が扱いを分けられるようにするため。

#### `deleted` の種別は分からないことがある

消えた後では、それがファイルだったかフォルダだったかを確かめられない。`entryType` を `FileEntryType | null` にして、**知らないことを `'file'` と偽らない**形にしてある。種別を使う判断はどこにも無い（配下を畳むのは位置で決まる）。

### 12.2 `files:changed` の広がり方

| 項目       | Session 3-3                 | Session 3-5                                  |
| ---------- | --------------------------- | -------------------------------------------- |
| 変化の種類 | created / deleted / renamed | **+ modified**（`revision` 付き）            |
| 出どころ   | アプリの操作だけ            | **+ `source`**（`'app'` / `'watcher'`）      |
| 位置       | 相対位置                    | 相対位置（変わらず。**絶対パスは載せない**） |

`modified` に `revision`（§11.6 の `{ mtimeMs, size }`）を載せてあるのが要点。受け手はこれを「自分が最後にディスクで見た版」と突き合わせ、**同じなら何もしない。** 自分の保存でも監視は発火しうるため、これが無いと保存のたびに「外部で変更された」と誤って判断することになる（申告による抑止と合わせて二重に守っている）。

**Files パネルは `modified` で読み直さない**（`fileChanges.ts`）。ツリーが持っているのは「どこに何があるか」であって中身ではない（§9.2）ため、読み直すとビルドツールが書き込むたびに親フォルダを読むことになり Lazy Load の意味が薄れる。中身を持っているのは Editor だけなので、受け取るのもそこだけになる。

### 12.3 Conflict（食い違い）の扱い

#### 事実は Model 側、状態はタブ側

```
monaco/documentStore.ts が持つ事実          editorTabState.ts が導く状態
────────────────────────────────────────    ──────────────────────────
savedVersionId ↔ alternativeVersionId  …  dirty
externalRevision（外で書き換わった後の版） …  externalChange
missing（ディスクから消えた）            …  missing
                                              ↓
                            clean / dirty / conflict / deleted
```

**旗を並べず1つの状態にまとめてある。** `dirty` / `conflict` / `deleted` を真偽値で並べると「conflict だが dirty ではない」というあり得ない組み合わせが表現でき、印を出す側が優先順位を自分で決めることになる（場所ごとにずれる）。Workspace Shell がパネルの可視状態をレイアウトから導いている（§7.7）のと同じ考え方。

**二重管理にならないのは、タブが導かれた結果だけを持ち自分では決めないため。** Session 3-4 の `dirty: boolean` は `state: EditorTabState` に置き換わり、伝え方（`documentStore` → `relativePath` で通知 → タブが写す）はそのまま。

| 状態       | 意味                                   | 閉じるとき |
| ---------- | -------------------------------------- | ---------- |
| `clean`    | ディスクの内容と一致                   | そのまま   |
| `dirty`    | 未保存の変更がある                     | 確認する   |
| `conflict` | 未保存で、**ディスク側も変わっている** | 確認する   |
| `deleted`  | 未保存で、**ディスクから消えている**   | 確認する   |

**未保存でなければ `conflict` にも `deleted` にもしない。** 失うものが無い状態で選択肢を出しても、できることが「読み直す」しかない。

#### 未保存でなければ、黙って取り込む

`modified` を受けたとき、`useEditorSession.ts` が未保存かどうかで分ける。

| 状態       | 扱い                                                              |
| ---------- | ----------------------------------------------------------------- |
| 未保存なし | ディスクを読み直して**中身だけ差し替える**                        |
| 未保存あり | 食い違いとして控える。Reload / Compare / Overwrite は利用者が選ぶ |

取り込みは `documentStore.replaceContent` で、**タブも Model も作り直さない。** 作り直すと、タブが React から見て別物になり（開き直しと同じ見え方）、Undo 履歴が消え、言語サービスがファイルを開き直す。差し替えなら、どれも起きない。

見ていた場所を保つため、全体を1回の編集として置き換え、その前後でカーソル・選択・スクロール位置を控えて戻す。編集として適用しているので **Undo で戻せる**（意図せず消えた編集をその場で取り返せる）。エディタ本体の参照は `MonacoEditor.tsx` がストアへ預ける（持ち主は器の側のまま）。

#### 3つの選択肢

未保存があるときは**アプリが片方を選ばない。** どちらが要るかを知っているのは利用者だけで、しかも間違えると取り返せない。

| 選択    | 何が起きるか                        | 失うもの       |
| ------- | ----------------------------------- | -------------- |
| Reload  | ディスクの内容を取り込む            | Editor の変更  |
| Compare | 2つを並べて見る（何も変えない）     | なし           |
| 上書き  | Editor の内容でディスクを書き換える | ディスクの変更 |

- **押す前に何を失うかが分かる**（ボタンの説明文）。「押してから気づく」形にすると、Compare を挟む意味が薄れる
- **エディタは差し替えず、上に足す。** 選択肢のためにエディタを隠すと、利用者が自分の変更を見られないまま選ぶことになる
- **上書きは `baseRevision: null`** で送る（§11.6 の確認を明示的に飛ばす）。Workspace 境界の検証はそのまま通る
- **気づいた経路で見え方を変えない。** 監視で気づいても、保存しようとして `'stale'` で気づいても、同じ1つの欄（`externalRevision`）に入り、同じ場所に同じ選択肢が出る

#### Compare は Monaco の Diff Editor

`MonacoDiffEditor.tsx`。**Monaco の実体を import するので遅延して読み込む**（Conflict になるまで要らない）。差分の計算は Editor 本体の Worker が行うため、CSP まわりの前提は §11.2 のまま変わらない（追加の Worker も外部通信も増えない）。

- **読み取り専用。** 直すのは元のエディタで行う。編集可能にすると保存の入口が2つになる
- **Model は借りない。** 比べるためだけの Model を作り、この器と一緒に捨てる。借りると、閉じたときに開いているファイルの Model まで捨てうる
- **開くたびに読み直す。** 控えておくと、閉じて開き直したときに「もう古くなっている中身」を今ディスクにあるものとして見せることになる

### 12.4 Auto Save と設定の永続化

4つの mode がすべて動く（Session 3-4 は `off` / `afterDelay` の2つ）。

| mode             | いつ保存するか                                 | 実装場所                   |
| ---------------- | ---------------------------------------------- | -------------------------- |
| `off`            | 自動保存しない（Ctrl+S だけ）                  | —                          |
| `afterDelay`     | 入力が止まってから `delayMs` 後                | 状態の通知で debounce      |
| `onFocusChange`  | 別のタブへ移ったとき（**離れたタブ**を保存）   | `activeTab` の前後を比べる |
| `onWindowChange` | ウィンドウがフォーカスを失ったとき（全部保存） | `window` の `blur`         |

- **設定モデルと動作を分ける。** `autoSave.ts` が持つのは「どんな設定がありうるか」「境界から来た値をどう読むか」「保存形式とどう行き来するか」だけで、いつ保存するかは `useEditorSession.ts`。前者は React も Monaco も IPC も知らない（Vitest でそのまま試せる）
- **既定は必ず OFF。** 保存された設定が読めなかった場合も OFF へ落ちる
- **`onFocusChange` は「エディタから focus が外れたとき」ではない。** それだと Files パネルをクリックしただけで書き込まれる。ツリーを辿るのは編集の一部で、「編集をやめた」ことを意味しない
- **Conflict と削除済みは自動で保存しない。** 自動保存が外部の変更を黙って上書きするのが、この機能で一番避けたいこと。自動で書くのは `dirty`（＝ただの未保存）のときだけ
- **`delayMs` は mode を切り替えても持ち回す。** 戻ったときに待ち時間まで既定へ戻らないようにするため

#### 保存先

```
useEditorSession（設定の持ち主）
   ↓  変わった / 起動した
window.fluvix.settings          Preload の薄いラッパ
   ↓  IPC（settings:load-editor / settings:save-editor）
main/ipc/handlers/settings.ts   文書として妥当かを検証
   ↓
main/store/editorSettings.ts    %APPDATA%/Fluvix Nexus/editor-settings.json
```

用途ごとに API を切る方針（§5）に従い、レイアウト・Workspace とは別ファイル・別チャンネルにしてある。**Renderer は保存先を知らない**（パスもファイル名も引数に無い）。検証の分担もレイアウト（§7.8）と同じで、Main は「後で解釈できる形か」まで、意味（mode として成立するか）は Renderer が決める。

**読み込みが終わるまで保存を許さない。** 先に許すと、既定値で上書きした後に読み込みが届き、起動のたびに設定が OFF へ戻る。

Session 3-6-8 で足した Files の見え方（`settings:load-files` / `settings:save-files`）も、Session 3-7-5 で足した Terminal の見え方（`settings:load-terminal` / `settings:save-terminal`）も、この形をそのまま写している ── **同じチャンネルへ項目を足していない**のが要点で、理由は §10.14 / §13.4。

3つとも同じ形になったことで、設定を1つ増やす手順も決まった形になる。

| 足すもの                         | 置き場所                                             |
| -------------------------------- | ---------------------------------------------------- |
| ディスクに置く形（型と上限だけ） | `shared/settings/<用途>Settings.ts`                  |
| 形として読めるかの検証           | `main/store/<用途>SettingsDocument.ts`（テスト対象） |
| 保存先（`<用途>-settings.json`） | `main/store/<用途>Settings.ts`                       |
| 読み書きの対                     | `settings:load-<用途>` / `settings:save-<用途>`      |
| 値の意味（既定・範囲・丸め方）   | その機能の Renderer 側                               |

**アプリ全体の Settings 画面はまだ無い**（DESIGN.md §9）。値の持ち主はどれも機能の側にあるので、画面を作るときに移るのは「並べる場所」だけになる。

### 12.5 文字コード

**読み書きはどちらも UTF-8 前提。** それ以外のテキストは「開けるが化ける」ではなく**開かない**（UTF-16 は NUL が並ぶため binary として落ちる。§9 の判定）。化けた内容を編集して保存できる状態を作らないため。

**BOM だけは形として保つ。** Windows のツール（メモ帳・PowerShell の一部）は UTF-8 に BOM を付ける。読むときに落とすだけだと、保存した瞬間に BOM が消えて**開いて保存しただけで差分が出る**。そこで「BOM が付いていたか」を `FileEncoding`（`'utf8'` / `'utf8-bom'`）として1件の属性で持ち回り、保存で同じ形に書き戻す。中身の文字列そのものには BOM を含めない（Monaco の1行目の先頭に見えない文字が入る）。

```
readWorkspaceFile   バイト列 → encoding + 中身（BOM を落とす）
   ↓  応答に encoding
EditorDocument / documentStore   そのまま持ち回すだけ
   ↓  保存の要求に encoding
writeWorkspaceFile  中身 + encoding → バイト列（BOM を足す）
```

**広げるときに増えるのは2箇所だけ。** `fileContent.ts`（バイト列 → 文字列）と `writeWorkspaceFile.ts`（文字列 → バイト列）で、`FileEncoding` に `shift_jis` / `utf16le` を足す形になる。Renderer 側は「読んだときの encoding を保存にそのまま返す」以上のことをしないため、文字コードを選べるようにする段階でも Editor の経路は変わらない。変換表を持つ大きなライブラリは、実際に必要になるまで入れない。

改行（`FileLineEnding`）とまったく同じ持ち回し方にしてあるのは、どちらも「開いたときの形を保つ」という同じ目的のため。

### 12.6 失われるものがある操作に、確認を1本で挟む

続けると何かが失われる操作は4つある。

- Editor のタブを閉じる
- Workspace を閉じる（上部バー / Files の root 行の ×）
- 別の Workspace へ切り替える
- ウィンドウを閉じる / アプリを終了する

**確認をそれぞれの入口に書かない。** 書くと入口が増えるたびに保護が抜ける。§10.4 で「閉じる入口が増えても後片付けは増えない」形にしたのと同じ考え方で、確認も分ける。

```
失われるものを持つ側（EditorProvider / TerminalProvider）
   ↓  registerSource：この操作で何が失われるか / 保存で救えるか
UnsavedChangesProvider   確認の器（App の一番外）
   ↑  confirmDiscard：この操作を続けてよいか
失わせる側（WorkspaceFolderProvider / ウィンドウを閉じる）
```

Provider を**両方より外側**に置くことで、失われるものを持つ側と失わせる側が互いを知らないまま同じ確認を通せる。実際 Session 3-7-4 で Terminal の「実行中のプロセスがある」が加わったときに増えたのは、`registerSource` する側と文面の分岐だけになる（§13.9）。

```
App.tsx
└── UnsavedChangesProvider     確認の器
      └── WorkspaceFolderProvider   どの Workspace か
            └── EditorProvider      開いているタブ（未保存を申告する）
                  └── TerminalProvider    動いているシェル（実行中を申告する・§13.9）
                        └── FilesViewProvider   Files の表示方式として選んだ方（§10.13）
                              └── WorkspaceShell
```

#### 失われるものは1種類ではない（Session 3-7-4）

申告には**種別**が付く（`LossKind`）。文面と選べる道が種別で変わるためで、混ぜると「実行中のターミナルを保存しますか」になる。

| 種別               | 誰が申告するか   | いつ失われるか                 | 保存で救えるか |
| ------------------ | ---------------- | ------------------------------ | -------------- |
| `unsaved-file`     | EditorProvider   | 上の4つすべて                  | 救える         |
| `running-terminal` | TerminalProvider | **ウィンドウを閉じるときだけ** | 救えない       |

**どの操作で失われるかは、持ち主に判断させる。** `listLosses(action)` が操作の種類を受け取るのはこのためで、Terminal は Workspace の切り替えでも Workspace を閉じても何も失わない（§13.8）。器の側に「Terminal は切り替えでは消えない」と書くと、その知識が持ち主と器の2箇所に置かれる。

**申告は非同期にしてある。** Editor は自分の状態を見れば答えられるが、Terminal は OS に聞かないと分からない（§13.9）。確認が出るのは操作の瞬間なので、その場で聞いて、その場の答えで判断する。聞いている間も「確認の最中」として扱う ── そうしないと、往復の隙に2つ目の操作が同じ確認をすり抜ける。

文面の組み立て（種別の組み合わせ → 題・本文・ボタンの言葉）は `lossMessage.ts` に切り出してテストで固定してある。**同じ器で違うことを言う**以上、言い間違いは確認そのものを逆に働かせる ── 実行中のターミナルしか無いのに「保存されていない変更があります」と出れば、身に覚えのない警告として読み飛ばされる。

#### 答える単位が違うので、器は2つ

| 場面                       | 器                         | 尋ね方                                |
| -------------------------- | -------------------------- | ------------------------------------- |
| Editor のタブ1枚を閉じる   | `TabCloseConfirm.tsx`      | このファイルを保存するか              |
| Terminal のタブ1枚を閉じる | `TerminalCloseConfirm.tsx` | このターミナルを終わらせるか（§13.9） |
| Workspace / 終了           | `UnsavedChangesDialog.tsx` | まとめてどうするか                    |

1枚のときに一覧を出すと大げさで、複数のときに1枚ずつ尋ねると押し続けることになる。選択肢の意味（Save / Don't Save / Cancel）と見た目は揃えてある（`unsaved.css` を共有）。

#### 決めていること

- **保存できたときだけ続ける。** Save を選んでも Conflict や書き込みの失敗で保存されなければ**閉じない**。閉じてしまうと「保存を選んだのに失われた」になる
- **走っている書き込みの結果を流用しない。** 同じファイルへの書き込みは重ねられないが、待っている側へ走っているものの結果を返すと、**その書き込みの最中に打った文字が保存されていないのに「保存済み」と判断される**。ファイルごとに順番待ちにして、前が終わってから中身を取り直す（`saveFile`）
- **失うものが無ければ尋ねない。** 確認を出すこと自体が目的ではない
- **既定は「キャンセル」**（初期 focus）。Enter を押した勢いで内容が失われない側を既定にする（`DeleteConfirm.tsx` と同じ）
- **必ず失敗する選択肢を出さない。** ディスクから消えたファイルにも、実行中のターミナルにも「保存」を並べない
- **一度に1つだけ。** 確認が出ている間（申告を集めている間も含む）は次の確認を受け付けず、その場で「続けない」を返す
- **確認は Renderer の中で出す。** ネイティブの `dialog.showMessageBox` を使うと、Main が Renderer の事情（何が未保存か・どのタブが動いているか）を知ることになる
- **申告を集められなければ続けない。** 失われるものが無いとは言えない状態で進めると、この経路が守ろうとしているものを失う

#### 削除されたファイルのタブは残る

外部から削除されたとき、**未保存のタブは閉じない**（`deleted` として残す）。保存されていない内容はそのタブの中にしか無く、閉じると利用者が一度も選んでいないのに失われるため。未保存でないタブは従来どおり閉じる（残しても中身はディスクにあったものと同じ）。

タブ側（`editorTabsModel.ts`）と Model 側（`documentStore.ts`）は互いを知らないまま同じ判断をする ── どちらも「未保存か」だけを見ているため、結果が揃う。

Editor の内容を別の場所へ書き戻す道（Save As）は Session 3-6 以降。今は「ここにだけ残っている」ことが分かる状態までで、内容は失われない。

### 12.7 ウィンドウを閉じる / アプリを終了する

「閉じるか」を決めるのは Main、「未保存があるか」を知っているのは Renderer（§1 の責務表）。どちらかに寄せずに済ませるため、**閉じる操作を Main が握ったまま、判断だけを尋ねる**。

```
× / Alt+F4 / app.quit()
   ↓  'close'
main/windows/closeGuard.ts   preventDefault して window:close-requested を送る
   ↓
Renderer                     'deciding' を返してから利用者に尋ねる
   ↓  window:respond-close
closeGuard.ts                'allow' なら「もう尋ねない」印を付けて改めて close()
```

**終了も各ウィンドウの 'close' を通る**ため、同じ1本の経路でウィンドウの × とアプリ終了の両方を捕まえられる。close を止めれば終了そのものも取り消される（Electron の作法）ので、「終了処理と保存確認が別々に走って競合する」状態にならない。

#### 閉じられなくならないこと

Renderer が応答できない状態（読み込み前・スクリプトが止まっている・クラッシュした）はありうる。**返事が来ないまま閉じられなくなる方が、未保存を1回取りこぼすより悪い**ため、出口を3つ用意してある。

1. 受け取ったという返事（`'deciding'`）が来るまでの時間に上限を置く（4秒）
2. Renderer が死んでいる / 死んだら、確認を挟まずに閉じる（`render-process-gone`）
3. 尋ねている最中にもう一度閉じようとされたら、**同じ確認を送り直す**（イベントを取りこぼした Renderer が追いつけるように）

上限が「利用者が選ぶ時間」ではないのが要点。選んでいる最中に閉じてしまうと、確認を出した意味が無い。`'deciding'` を受け取った時点で上限は外し、そこから先は待ち続ける。

`requestId` を突き合わせるのは、前回の確認への遅れた返事で今のウィンドウが閉じてしまわないようにするため。どのウィンドウからの返事かは Renderer に言わせない（registry が送信元のウィンドウを検証して渡す）。

#### 保証できない場合

次のケースでは、この経路が走らない（走っても OS が待たない）ことがある。**完全な保証は原理的にできない。**

- OS のシャットダウン / サインアウト / 再起動
- タスクマネージャなどからの強制終了（`taskkill /F`）
- Main プロセスのクラッシュ、電源断
- Renderer プロセスのクラッシュ（この場合は確認を挟まずに閉じる ── 上の 2）

そのため Auto Save（§12.4）を利用者が選べるようにしてある。既定を OFF にしている以上、「未保存のまま強制終了すれば失われる」ことは避けられない。

### 12.8 Session 3-5 の範囲外

| 項目                                | 状況                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Save As（削除されたファイルの救出） | タブは `deleted` として残る（§12.6）。保存先を選ぶ UI と、`files:create` を通す経路が要る   |
| アプリの外での改名の対応付け        | 監視からは delete + create で届く（§12.1）。対応付けるならサイズ・内容の突き合わせが要る    |
| 監視の除外設定                      | `ignoredDirectories.ts` の表を Settings（§12.4）から読む形にする（検索と共通・§10.10）      |
| Shift_JIS / UTF-16                  | `FileEncoding` に足し、`fileContent.ts` と `writeWorkspaceFile.ts` の2箇所を増やす（§12.5） |
| 文字コードを選び直す UI             | 上と同時。読み込みの応答に候補を載せるか、開き直しの要求に encoding を足す                  |
| Settings 画面                       | 設定の**値**は既にアプリの設定として保存されている。並べる場所を作るだけ（DESIGN.md §9）    |
| Files Tree の完全な追従             | created / deleted は既に届いている。ツリー側で「追加された行を選択状態にする」等は後続      |
| Conflict の3方向マージ              | Compare は読み取り専用（§12.3）。編集できる差分は Git の解決 UI と同時に考える              |

---

## 13. Terminal（シェルのセッション）

Session 3-7-1 / 3-7-2 / 3-7-3 / 3-7-4 / 3-7-5 の成果物。DESIGN.md §3「Terminal パネル」と §6「Claude Code 連携」の第一段階にあたる。

Files / Editor が「Workspace の中のファイルを読み書きする」機能だったのに対し、Terminal は **Main が長命な子プロセスを持つ最初の機能**になる。要求のたびに始まって応答で終わる処理ではなく、一度立てたら利用者が終わらせるまで生き続け、その間ずっと出力を出し、アプリが終わるときには確実に片付ける必要がある。この形は LSP（サーバ1本）と DAP（デバッグ対象）がそのまま踏襲する。

```
Renderer                        Main
  terminal:list-shells ─────→   shellCommand.ts   この環境で起動できる行はどれか
  ←──── shells[]                                  （名前と available だけ）
  terminal:create      ─────→   shellCommand.ts   行 → 実行ファイル（%SystemRoot% / PATH から解決）
    { shellId, size }           §8 の Workspace   どこで起動するか
                                node-pty spawn
  ←──── session.id
  terminal:write       ─────→   pty.write         打鍵をそのまま流す
  terminal:resize      ─────→   pty.resize
  ←──── terminal:data           outputCoalescer   束ねてから配る（§3.3 のイベント経路）
  ←──── terminal:exit
  terminal:list-busy   ─────→   childProcesses.ts 子プロセスを持つシェルはどれか（§13.9）
  ←──── busySessionIds[]                          （終わらせる前に尋ねるかの判断）
  terminal:dispose     ─────→   pty.kill
```

### 13.1 境界は「プロセスの中身」ではなく「起動の入口」にある

Files は「Workspace の外へ出られないこと」を、**相対位置しか受け取らない**ことで担保している（§9.3）。Terminal に同じ手は使えない。起動したシェルの中で `cd ..` を止めることに意味は無いし、止めれば道具として成立しないためで、**Terminal は定義上 Workspace の外へ出られる。**

そこで守る場所を1つ内側へずらしてある。

| 決めるもの                     | 誰が決めるか                         | Renderer から指定できるか       |
| ------------------------------ | ------------------------------------ | ------------------------------- |
| 表にどんな行があるか           | `main/terminal/shellCommand.ts` の表 | **できない**                    |
| 行の中身（実行ファイル・引数） | 同上                                 | **できない**                    |
| どの行を起動するか             | Renderer（`shellId`）                | できる（閉じた集合の値1つだけ） |
| どこで起動するか               | 今の Workspace（§8）                 | **できない**                    |
| 大きさ                         | Renderer が測った値（丸められる）    | できる                          |
| 何を流すか                     | 打鍵・貼り付け（加工しない）         | できる                          |

`terminal:create` の要求に入っているのは大きさと `shellId` だけで、実行ファイルの欄も引数の欄も作業ディレクトリの欄も無い。`workspace-folder:open` が「ダイアログを出して」としか言えない（§8.4）のと同じ形で、ここも「**この行の**ターミナルを1つ」としか言えない。**入口さえ Renderer から指定できなければ、「Renderer からの要求で任意の場所の任意の実行ファイルが動く」という形は作られない。**

Session 3-7-2 でシェルを選ばせる入口を作ったが、**境界の性質は変えていない。** 渡るのは `'default' | 'node' | 'claude-code'` という閉じた集合の値で（`shared/terminal/shell.ts`）、知らない値は Main が断る。Renderer が指すのは表の**行**であって、起動されるものではない。

既定のシェルの id が `'powershell'` ではなく `'default'` なのも同じ線の上にある。「その OS の既定のシェル」という行が1つあるだけで、それが Windows で PowerShell に、Unix 系で `$SHELL` に解決されるのは Main の表の都合になる ── shared にも Renderer にも「Windows なら PowerShell」という知識が出てこない（DESIGN.md §8）。

### 13.2 PATH で解決しない

`powershell.exe` とだけ書くと、解決に使われるのは起動時の PATH と**作業ディレクトリ**になる。作業ディレクトリは利用者が開いた Workspace で、その中に `powershell.exe` が置かれていることは十分にありうる（clone してきたリポジトリの中身は、この時点ではただのファイルでしかない）。「フォルダを開いただけ」が「そのフォルダの中の実行ファイルが動く」になっては困る。

そこで `%SystemRoot%` から絶対パスを組み立てる。System32 配下は Workspace の中身によって変わらない場所であり、ここを起点にする限り**開いたフォルダの中身が起動されるものに影響しない**（`shellCommand.test.ts` がこの性質を直接確かめている）。

`%SystemRoot%` が無い環境では名前だけに落とす。落としてでも起動できる方が「ターミナルが使えない」より良いが、それは異常な環境での最後の手段であって既定の経路ではない。

#### PATH を「辿る」ことと、PATH に「任せる」ことは違う

Session 3-7-2 で足した Node / Claude Code は System32 には居ない。置き場所を決めるのは利用者で、それを知っているのは PATH だけになる。それでも実行ファイル名だけを node-pty へ渡すことはしない ── 上とまったく同じ理由で、cwd の中身が起動されうるため。

**PATH はこちらで辿り、実体を確かめてから絶対パスを渡す。**

| すること                       | しないこと                             |
| ------------------------------ | -------------------------------------- |
| PATH の項目を順に見る          | 実行ファイル名だけを渡して OS に任せる |
| 絶対の項目だけを使う           | `.` や `bin` のような相対の項目を使う  |
| 実体（`existsSync`）を確かめる | 在ることを前提に spawn して失敗を見る  |

相対の項目を飛ばすのが要点にあたる。PATH に `.` が入っている環境は珍しくなく、拾ってしまえば「フォルダを開いただけ」が「そのフォルダの `node.exe` が動く」になる ── §13.2 が守っている性質を、自分で壊すことになる。

見つからなければその行は「この環境には無い」として選択肢から外れる（`available: false`）。Node も Claude Code も入っていない PC はふつうにあり、**表にあることと起動できることは別**になる。

#### `.cmd` は直接起動できない

npm が入れる `claude` は Windows では `claude.cmd`（バッチ）で、CreateProcess はバッチを直接実行できない。`cmd.exe /c <絶対パス>` で包むが、**その `cmd.exe` も `%SystemRoot%` から組み立てる**（PATH に任せない）。包む相手は PATH から実体を確かめた絶対パスなので、ここでも開いたフォルダの中身は起動されるものに影響しない。

`%SystemRoot%` が読めない環境では、この行は**選択肢から外す**（既定のシェルのように名前だけへ落とさない）。落とすと「PATH と cwd から解決される cmd.exe」になり、この表が守っている性質そのものが崩れる。Claude Code が選べなくなるだけで、既定のシェルは使える。

### 13.3 Electron の中で動いていることを子プロセスへ持ち出さない

ターミナルは Main Process の子として起動するため、何もしなければ Electron が自分のために立てた環境変数をそのまま受け継ぐ。

| 変数                   | 引き継ぐと起きること                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ELECTRON_RUN_AS_NODE` | ターミナルから起動した Electron アプリが**素の Node として立ち上がる**。`require('electron')` が文字列を返して落ちる |
| `NODE_OPTIONS`         | このアプリのために付けた起動オプションが、無関係な node へ効く                                                       |

1つめは、**このアプリで Electron アプリを開発する利用者が最初に踏む**類のもので、しかも落ちるのは相手のアプリなので原因がターミナル側にあると気づきにくい。「開いたターミナルは、素の PowerShell を開いたときと同じように振る舞う」を満たすために落とす（`terminalEnvironment.ts`）。

足すのは `TERM` だけ。環境変数はそこから起動されるすべてに効くため、増やすほど「素のシェルと違う場所」になる。

### 13.4 大きさは断らずに丸める

他の入力（ファイル名・相対位置）は規則に合わなければ**断る**が、大きさは丸める（`shared/terminal/size.ts`）。違いは**利用者がその値を指したかどうか**にある。

- ファイル名 … 利用者が打ったもの。勝手に直すと、指したものと違うものを触る
- 大きさ … 画面から測ったもの。利用者は 0 行を指していない

パネルが畳まれている間・まだ描かれていない間は 0 が測られる。それを失敗として返すと、**畳んだだけでターミナルが壊れる。** 数として読めないもの（文字列・NaN）だけは丸めようが無いので断る。

正規化を shared に置いてあるのは、Renderer が測った大きさと Main が ConPTY へ渡す大きさが食い違うと、**改行の位置が画面と実際でずれる**ため（fileName.ts と同じ理由）。

#### 測るのは器、決めるのは xterm（Session 3-7-3）

大きさの単位は文字数であってピクセルではない。器の px から桁数を出せるのは**実際の文字の幅を知っている xterm だけ**なので、測ること自体は FitAddon（`screen.fit()`）に任せ、Renderer 側が決めるのは「いつ測り直すか」だけになる。きっかけは4つある。

| きっかけ               | 何が起きたか                                           | 拾う場所                     |
| ---------------------- | ------------------------------------------------------ | ---------------------------- |
| 器が現れた             | パネルを開いた / 別の場所へ動かした / タブを切り替えた | `TerminalSurface` の effect  |
| 器の大きさが変わった   | Dock / Split / 境界のドラッグ / ウィンドウのリサイズ   | `ResizeObserver`             |
| 文字の大きさが変わった | 器は同じまま、入る桁数だけが変わる（下記）             | `fontSize` を見る別の effect |
| セッションが立ち直った | 立て直しの要求に最初の大きさが要る                     | `restart` の呼び出し側       |

**Shell の側から「大きさが変わった」を伝える経路は作らない。** 観測するのは器1か所だけで、Monaco の `automaticLayout`・Files の `useFilesLayout` と同じ形になる。パネルの置き場所は自由に変わるため、伝える側を作ると置き方が増えるたびに伝え忘れが生まれる。

3つめだけは `ResizeObserver` では拾えない ── 器のピクセルは1つも変わっていないため、effect を分けてある。

**測り直しは次のフレームまで待つ。** `ResizeObserver` のコールバックの中で `fit()` を呼ぶと、その中で xterm が自分の DOM を組み替える ＝ **観測している最中に観測対象を変える**ことになり、境界をドラッグしている間ずっと `ResizeObserver loop completed with undelivered notifications` が出る。`requestAnimationFrame` 1つに束ねると、何度鳴っても1フレームにつき1回で足りる（描画はそれ以上細かくならない）。

Main へ送るのはさらに絞る ── 文字数に直して**前回と同じなら送らない**（`isSameTerminalSize`）。器は1px 変わるたびに鳴るが、桁数が変わらないことがほとんどで、そのたびに ConPTY を作り直させる理由が無い。

#### 表示の設定 ― フォントとスクロールバック（Session 3-7-3 / 永続化と設定 UI は 3-7-5）

端末の見え方としてアプリが決めているものは `renderer/src/terminal/terminalDisplay.ts` の1箇所に集めてある。

| 何               | 値                            | 変えられるか                                |
| ---------------- | ----------------------------- | ------------------------------------------- |
| フォント         | Editor / Files と同じ等幅     | いいえ（等幅でないと桁が狂う）              |
| 文字の大きさ     | 既定 13px（8〜32px）          | **はい**（Ctrl + `+` / `-` / `0`・設定 UI） |
| 行の高さ         | 1.2                           | いいえ                                      |
| スクロールバック | 既定 5000 行（500〜50000 行） | **はい**（設定 UI）                         |

**shared ではなく Renderer に置く。** 大きさ（桁数・行数）は Main と Renderer が同じ答えを見る必要があるため shared にあるが（§13.4）、文字の大きさとスクロールバックは **IPC を1度も渡らない** ── 前者はピクセルの話で、Main が受け取るのは桁数と行数だけ。後者は Renderer 側のメモリの話にほかならない。Main が知る必要の無いものを shared へ置くと「shared にあるのだから Main も見てよい」が後から生える。

保存形式（`shared/settings/terminalSettings.ts`）だけが shared にあるのは、それが**ディスクに置く形**であって見え方の意味ではないため（Editor / Files と同じ扱い。§12.4）。Main はその形しか見ず、8〜32px に収まっているかは見ない。

**文字の大きさもスクロールバックも全部のタブで同じ。** タブごとに持つと、切り替えるたびに見え方が変わることになる。ストア（`terminalScreenStore.ts`）が今の値を覚えていて、**後から作られる画面にも同じ値が渡る** ── 新しく開いたタブだけ既定のまま、が起きない。

**端末の打鍵を横取りすることになる。** 端末は打鍵をそのまま渡すのが約束（§13.1）なので、横取りする組み合わせは少ないほどよい。それでも3つ取っているのは、Session 3-7-3 の時点で文字の大きさを変える入口が他に無かったため。設定 UI ができた後も打鍵は残している ── 端末を触っている手を止めずに変えられることに意味があり、**どちらも同じ1つの値を変える**（打鍵で変えた値は設定 UI にもそのまま出る）。どれを取るかの判断は `terminalDisplay.ts` の純粋な関数に置いてあり、**横取りの範囲が広がっていないことをテストで固定してある**（`Ctrl+C` / `Ctrl+D` などが通ること）。

xterm 側の窓口は `attachCustomKeyEventHandler`（false を返すとシェルへ流れない）を使う。器の `onKeyDown` で拾わないのは、xterm が textarea 上で打鍵を組み立てており、**どこまで外へ漏れるかが xterm の実装都合になる**ため。

開発時のネイティブメニューからズームの3項目を外してあるのはこの割り当てのため（`app/menu.ts`）。Electron のズームは**メニュー項目のアクセラレータ**として効くので、置いておくと開発中だけ Ctrl + `+` / `-` / `0` が端末へ届かない（配布ビルドはメニューを持たない）。

#### 見え方の設定と永続化（Session 3-7-5）

層の分け方は Files の見え方（§10.14）をそのまま写している。

```
terminalDisplay.ts        既定値・範囲・丸め方（React も IPC も知らない）
terminalSettings.ts       実行時の設定 ↔ 保存形式の変換（同上）
useTerminalSettings.ts    いつ読み、いつ書くか
useTerminalTabs.ts        読んだ値を画面（terminalScreenStore）へ配る
TerminalSettingsMenu.tsx  変えるための入口（Terminal のタブ列の ⚙）
shared/settings/terminalSettings.ts  ディスクに置く形
main/store/terminalSettingsDocument.ts  形として読めるかの検証
main/store/terminalSettings.ts       保存先（terminal-settings.json）
```

- **器（Provider）を増やしていない。** Files は見え方のために `FilesViewProvider` を足したが、それは選択がパネルの中にあり、パネルを動かすと消えたためだった（§10.14）。Terminal の持ち主（`TerminalProvider`）は Session 3-7-1 の時点で Workspace Shell の外側にあるので、そこへ載せれば同じ寿命が得られる ── 寿命の同じ Provider を2つ並べない
- **設定 UI はパネルの中、値はパネルの外。** ⚙ は Terminal のタブ列にあるが、押した先が読み書きするのは Context 越しの値になる。パネルは Dock で動かせるため、ここに持つと置き場所を変えただけで文字の大きさが戻る
- **丸める関数は1つ。** 設定 UI に打ち込まれた値も、ディスクから読んだ値も、ディスクへ書く値も `clampTerminalFontSize` / `clampTerminalScrollback` を通る。通り道が分かれると「UI では止まるのに、保存ファイルを直接書けば通る」が生まれる（`clampColumnWidth` と同じ線。§10.14）
- **読み込みが終わるまで保存を許さない。** 先に許すと既定値で上書きした後に読み込みが届き、起動のたびに 13px へ戻る（§12.4 と同じ）
- **読めなくても端末は開く。** 壊れた JSON も、範囲の外の値も既定（13px / 5000 行）へ落ちる。項目ごとに落とすので、片方が読めなくてももう片方は活きる

**打ち込んでいる途中の値で端末を変えない。** 欄の中身は打っている間ずっと変わるため、1文字ごとに反映すると `1200` と打つ途中の `1` が丸められ（500 行）、**打ち終わる前に画面が作り替えられる。** 欄は自分の下書きを持ち、Enter か欄から離れたときに確定する。確定した値は丸めた結果をそのまま欄へ書き戻す（効かなかった入力を残さない）。

**スクロールバックの上限（50000 行）はメモリから決めている。** 出力の量に比例して Renderer のメモリが伸び、タブごとに1本ぶん持つ（`TERMINAL_MAX_SESSIONS` = 8）。減らす向きに変えると、溢れた行はその場で捨てられる（xterm 側の挙動）── 遡れる量を自分で減らしたのだからそれ自体は筋が通っており、そうなることだけを設定 UI に書いてある。

**開く面の器を1段引き上げた。** 設定 UI は「ボタンの真下に開くが、項目は並ばない」形で、`DropdownMenu` が持っていた開閉と閉じ方（項目の選択 / 外側のクリック / Escape / ウィンドウの blur）だけを `ui/Popover.tsx` へ移し、`DropdownMenu` はその上に項目を描くものになった。**振る舞いの塊を写して増やさない**ためで、写すと次に閉じ方を1つ直すときに直す場所が2つになる。

### 13.5 出力は束ねる。ただし間引かない

`terminal:data` は §3.3 のイベント経路に載る3つめの用途だが、**扱いが1つだけ違う。**

```
files:changed   束ねて、畳んで、上限で間引く（MAX_CHANGES_PER_BATCH）
terminal:data   束ねるだけ。畳まないし、間引かない
```

ファイルの変化は「同じ位置に3回起きた」を1回に畳んでよく、多すぎれば捨ててよい ── 受け手は結局そのフォルダを読み直すので、正しい状態に追いつける。ターミナルの出力にその性質は無い。**1回きりで、順番に意味があり、落とした分を後から取り戻す手段が無い**（消えた文字の分だけ画面が壊れる）。

したがって `outputCoalescer.ts` の上限は「捨てる基準」ではなく「**待たずに送る基準**」になる。送る条件は2つで、短い時間（16ms・打鍵の反響が遅れて見えない範囲）と、溜まった長さ（64KB・大量出力でメモリを溜め込まない）。時間だけだと1回あたりが際限なく太り、長さだけだと1文字打った反響がいつまでも出ない。

### 13.6 セッションと画面は、パネルより長く生きる

パネルは View メニューから閉じられ（§7.7）、Dock で動かせば React から見て作り直される。ここで消えてはいけないものが2つある。

| もの                 | 持ち主                               | 消えると                             |
| -------------------- | ------------------------------------ | ------------------------------------ |
| シェルのプロセス     | Main（`terminalSessions.ts` の表）   | パネルを動かすたびにシェルが切れる   |
| 画面（xterm と DOM） | Renderer の `terminalScreenStore.ts` | 動かすたびにスクロールバックが消える |

前者は Main が持っているので自然に守られる。**後者が Editor の Model と同じ問題**にあたるため、置き場所も同じにしてある ── ストアの持ち主は `TerminalProvider`（Workspace Shell の外側。App.tsx）で、パネルの中ではない。

xterm は `open(parent)` で渡された要素の中に DOM を組み立てるため、パネルを動かすたびに作り直すと画面が消える。そこで**自前の要素を1つ持ち、それを器から器へ付け替える**。`terminal.open()` を呼び直さないのがこの形の要点になる。

id が2つ出てくるのも寿命の違いによる。

| id           | 誰が発番 | いつまで生きるか                                 |
| ------------ | -------- | ------------------------------------------------ |
| `terminalId` | Renderer | 画面が要る間（シェルが終わって立て直しても同じ） |
| `sessionId`  | Main     | そのシェルのプロセスが動いている間               |

Editor がタブ id（発番したもの）と relativePath（中身の同一性）を分けているのと同じ形で、`exit` と打って立て直したときに**画面はそのままでプロセスだけが変わる**のが自然なため、画面の鍵にセッションを使わない。

**応答より先に届く出力を捨てない。** `terminal:create` の応答が返るより先にシェルは喋る（PowerShell は起動直後にプロンプトを出す）。その一瞬の間、Renderer は「その sessionId がどの画面のものか」を知らない。出力は読み直せないため、結び付くまでの分はストアが預かり、`bind` で流し込む。これは Editor には無かった事情にあたる ── ファイルの中身は後から読み直せるが、出てしまった文字は取り戻せない。

### 13.6.1 複数タブ（Session 3-7-2）

並びを持つのは Renderer だけ。Main の表（`sessions` Map）もストア（`terminalId` が鍵）も Session 3-7-1 の時点で複数を持てる形にしてあったため、増えたのは Renderer 側の3つになる。

```
terminalTabsModel.ts   並びの規則（React 非依存・テスト対象）
useTerminalTabs.ts     セッションの生き死に・出力・大きさ（1つ → 並び）
TerminalTabs.tsx       タブ列と、開く入口
```

**器は1つのまま。** タブごとに器を並べて隠す形にはしていない ── 隠れている器は大きさが 0 になり、出す / 隠すたびに測り直しが要る。ストアは元々「自前の要素を器から器へ付け替える」形（§13.6）なので、タブの切り替えはその経路をそのまま使う。付け替えの後片付け（前のタブの要素を外す）が Session 3-7-2 で増えた1行にあたる ── 前は器ごと React に捨てられていたので外す必要が無かった。

**手前に出ていないタブは器を持たない。** したがってシェルが立つのは、そのタブが一度手前に出てからになる（開いた時点では `idle`）。開いたタブは必ず手前に出るため、実際には開いた直後に立つ。

#### 状態として持つものと、ref に置くもの

| 何                                  | どこ            | 変わると             |
| ----------------------------------- | --------------- | -------------------- |
| status / 表示名 / 終了コード        | state（描く）   | タブの見た目が変わる |
| sessionId / 起動中か / 最後の大きさ | ref（描かない） | 何も描き替わらない   |

`sessionId` を state に置かないのは、**画面へ流す宛先を引くため**だけに要るもので、変わっても描き直す必要が無いため（出力を画面へ渡すのは購読側の仕事で、React を通らない）。置くと、シェルを立て直すたびにタブ列ごと描き替わる。

#### 上限の数え方が Main と違う

`TERMINAL_MAX_SESSIONS`（8）は本来「同時に動くプロセスの数」の歯止めで、終わったタブはプロセスを持たない。それでも Renderer 側ではタブの枚数で数えている ── タブ列そのものも無限には伸びてほしくないため。数え方が違うぶん**Renderer の側が厳しくなる**ので、緩い側に倒れることはない（断るのは常に Main。UI は迂回されうる）。

### 13.7 CSP を1文字も緩めていない

xterm は既定の描画（DOM ベース）で Worker も blob も使わないため、Monaco のときのような迂回（§11.2 の `MonacoEnvironment.getWorker`）は要らない。CSS は `@xterm/xterm/css/xterm.css` を import してアプリにバンドルし、外部からは取りに行かない。実行時に注入される style は `style-src 'unsafe-inline'` で既に許してあり、これは STEP 1 の CSP コメントが最初から見込んでいたもの。

WebGL の addon は入れていない。速くはなるが、このアプリが出す量では違いが出ないうえ、描画まわりの不具合の切り分けが増える。

xterm 本体は **`React.lazy` で遅延読み込みする**（Monaco と同じ2つの理由。§11.3）。Terminal パネルを開くまで読み込まれず、Panel Registry を辿るだけのテスト（node 環境）からも読み込まれない。ビルド成果物でも `TerminalSurface-*.js`（約 330KB）として独立した chunk に分かれる。

### 13.8 Workspace が変わっても終わらせない（Session 3-7-3）

シェルの作業ディレクトリは起動時に決まり、**後から動かす手段は無い**（中で `cd` するのは利用者であってアプリではない）。ここは Session 3-7-1 から変わっていない。Session 3-7-3 で改めたのは、そこから何を導くかになる。

| 対象                     | 切り替えた後                                      |
| ------------------------ | ------------------------------------------------- |
| 既に動いているセッション | **そのまま。** cwd は起動したフォルダのまま       |
| これから立てるセッション | 今開いているフォルダで起動する（決めるのは Main） |

Session 3-7-1 / 3-7-2 では切り替えのたびに全部片付けていた（Editor がタブを捨てるのに揃えていた）。**Editor のタブと違い、ここで捨てるのは動いている OS のプロセスにほかならない。** ビルド・dev server・Claude Code の対話は、フォルダを見に行く操作1つで消えてよいものではなく、捨てたものは開き直しても戻らない。「開いていないフォルダを指したターミナルが残る」ことは受け入れ、**残っている事実を隠さずタブに出す**方を選んである。

そのため Main 側はこの切り替えを購読しない。`terminalSessions.ts` が「今のフォルダ」を読むのは**起動のときだけ**で、切り替えでする仕事が無い（ファイル監視 §12.1 が購読を持つのと対照的）。

Renderer 側に残るのは「**Workspace が開かれたときにタブが1枚も無ければ1枚置く**」ことだけになる。切り替えのたびに足さないのは、開いた覚えのないターミナルが増えるのを避けるため ── 新しいフォルダで1本要るなら `＋` で開き、そのとき起動するのは今開いているフォルダにほかならない。

#### 食い違いはタブに出す

タブは「どの Workspace で**起動したか**」を持つ（`terminalTabsModel.ts` の `workspaceId`）。今開いているものと違えば、名前の前に印（⌂）を1つ足し、全体は `title` で読めるようにする。

見た目が同じままだと、そこで `npm run build` と打った結果が**どちらのプロジェクトのものか分からない。** 持つのは id だけで、パスも表示名も入っていない（§13.1 の「Renderer へ OS の場所を渡さない」を崩さない）ため、**どのフォルダかまでは出せない。** 立て直せば今のフォルダの id に変わる ── 新しいセッションは今開いているフォルダで起動するため。

#### 片付けるのは2つの場合だけ

| きっかけ          | 何が起きるか                                          |
| ----------------- | ----------------------------------------------------- |
| タブの × で閉じた | そのセッションを終わらせ、画面も捨てる                |
| アプリが終わる    | すべて終わらせる（`app/lifecycle.ts` の `will-quit`） |

**アプリの終了時に片付けるのは必須にあたる。** ウィンドウが閉じても消えるのは Renderer だけで、プロセスは Main の持ち物のまま残る ── 片付けないと、ターミナルで立てた dev server がアプリの終了後もポートを掴み続ける。

Session 3-7-3 の時点ではどちらも**黙って終わらせていた。** 切り替えが対象から外れたぶん、確認を挟む相手はこの2つに絞られ、Session 3-7-4 でその2つに確認が入っている（§13.9）。

### 13.9 終わらせる前に尋ねる（Session 3-7-4）

片付ける2つの場合（§13.8）に確認を挟む。**Session 3-7-1 から残っていた最後の「黙って」**がここにあたる。

```
タブの ×        → 実行中なら確認（TerminalCloseConfirm.tsx）
アプリの終了    → 実行中なら確認（§12.6 の器へ申告して出す）
Workspace の切替 → 何も失われない。尋ねない（§13.8）
```

#### 何を実行中と見なすか

**そのシェルが子プロセスを持っているか**、それだけを見る（`childProcesses.ts`）。

| 状態                         | 子プロセス       | 判定         |
| ---------------------------- | ---------------- | ------------ |
| プロンプトで待っている       | 1つも居ない      | 実行中でない |
| `npm run build` / dev server | その実行ファイル | 実行中       |

ConPTY はシェルの中で何が起きているかを教えてくれない。画面に流れた文字から「まだ終わっていないか」を当てにいく道もあるが、それは**プロンプトの見た目を推測すること**にほかならず（利用者は自由にプロンプトを変えられる）、外れれば「動いているものを黙って殺す」か「何も無いのに毎回尋ねる」のどちらかになる。だから推測せず、OS に聞く。

見るのは**直接の子だけ**で足りる。`npm run build` の下の node も、その下の tsc も、辿れば必ずシェルの直接の子を1つ経由する ── 孫が居て子が居ない形は作れない。

聞き方は `Get-CimInstance Win32_Process -Filter 'ParentProcessId=… OR …'` を1回。**問い合わせはセッションごとではなく1回**で、8本開いていても OS へ聞くのは1度になる。PowerShell は `%SystemRoot%` から絶対パスで指す（§13.2 と同じ理由。PATH に任せない）。

#### 分からないときは尋ねる側に倒す

PowerShell が見つからない・応答が返らない・出力が読めない、はどれも起こりうる。`childProcesses.ts` は「子が居なかった」と「分からなかった」を型で分けて返し（`known` / `unknown`）、`terminalSessions.ts` が後者を**生きているセッション全部**として扱う。混ぜて空配列を返すと、分からなかったことが「何も動いていない」として伝わり、動いているビルドが確認なしで死ぬ。

#### 渡すのはセッションの id だけ

`terminal:list-busy` の応答に載るのは id の並びだけで、pid も実行ファイル名も入っていない（§13.1 の線）。要求には**欄そのものが無い** ── どのセッションについて聞くかを Renderer に言わせず、Main が自分の表を見て答える。

利用者に伝えたいのは「閉じると失われるものがある」という一点で、その一点に名前は要らない。何が動いているかは端末の画面そのものに出ている。

#### 代償は 0.4 秒

OS へ聞く往復ぶん、× を押してから閉じるまでに間が空く（実測 425〜453ms）。**実行していないタブを閉じるときにも通る**ため、ここは常に払うことになる。

その間はそのタブの × を押せない見た目にしてある（押しても何も起きない時間を、押せるように見せない）。待ちの画面は出さない ── 0.4 秒に器を1枚挟むと、閉じるたびに一瞬ちらつく。

立っていないタブ（`idle` / `exited` / `failed`）は OS のプロセスを持たないので、聞かずにそのまま閉じる。

#### アプリの終了は既存の経路に載る

`window:close-requested` → Renderer が `'deciding'` を返す → 確認、という §12.7 の流れは変わっていない。上限（4秒）は `'deciding'` の時点で外れるため、その後に OS へ聞く時間が挟まっても閉じられなくなることはない。

### 13.10 native モジュールを持つ最初の依存

`@lydell/node-pty` は本家 `node-pty` の再配布で、**現在のプラットフォーム向けの prebuilt だけ**を入れる（Windows では ConPTY のみ。winpty は含まれない）。Electron 43（ABI 148）でリビルド無しに読み込めることを実機で確認済み。

これがこのプロジェクトで最初の `dependencies`（＝配布物に同梱される依存）になる。`externalizeDepsPlugin` により Main のバンドルからは external 扱いのままなので構成は変わらないが、**exe 化（DEVELOPMENT.md §6）では `node_modules` を成果物に含める必要が出る。**

xterm（`@xterm/xterm` / `@xterm/addon-fit`）は Renderer にバンドルされるため `devDependencies` に置く（monaco-editor と同じ扱い）。

### 13.11 Session 3-7-5 の範囲外

| 項目                                 | 状況                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 何が実行中かを名前で出す             | 応答に載るのは id だけ（§13.9）。名前を渡すと、それを指して止める API が欲しくなる                      |
| Windows 以外での「実行中」の判定     | `ps` の呼び方が OS ごとに違う。今は分からない扱い＝毎回尋ねる側に倒れる（v1 は Windows・§13.9）         |
| 0.4 秒を待たずに答える               | 定期的に聞いて控える形にすると、確認の瞬間の答えではなくなる。native モジュールを入れる道もある         |
| フォントの種類・行の高さの設定       | 固定値のまま。等幅でないフォントを選べると、画面と ConPTY の折り返しが食い違う（§13.4）                 |
| 「＋」で開くシェルの既定を選ぶ       | 既定は OS の既定シェル（`default` の行）。選ぶのは `⌄` からで、設定としては持たない                     |
| 端末の配色（テーマ）の設定           | ANSI 16色はシェルとその中の CLI のもの。アプリが決めているのは地の色だけ（`xtermSetup.ts`）             |
| アプリ全体の Settings 画面           | Terminal の設定は Terminal のタブ列に置いた。並べ直すのは画面を作るとき（§12.4）                        |
| タブごとに違う文字の大きさ           | 全部のタブで同じ。切り替えるたびに文字の大きさが変わるのは道具として落ち着かない                        |
| 別フォルダのタブに、その名前を出す   | 印（⌂）だけ。名前を出すには Renderer が Workspace の表示名を持つ必要がある（§13.1 の線）                |
| 動いているターミナルの cwd を移す    | **手段が無い**（ConPTY は cwd を変えられない）。中で `cd` するのは利用者であってアプリではない          |
| タブの並べ替え / 名前の変更          | 並びは開いた順のまま。掴んで動かす経路も、名前を上書きする欄も持たない                                  |
| タブの復元（起動し直しても残る）     | セッションは OS のプロセスで、保存できるのは「何を開いていたか」まで。見え方（§13.4）とは別の文書になる |
| シェルの行を増やす（WSL / Git Bash） | `shellCommand.ts` に行を1つ足すだけ。解決の仕方（PATH / レジストリ）が行ごとに違う                      |
| イベントの宛先を絞る                 | `terminal:data` は今も全ウィンドウへ配られる。独立ウィンドウ化のときに最初に見直す相手になる            |
| 検索・選択のコピー / 貼り付け        | xterm の addon か、自前の経路。OS クリップボードは Main 側の別の話（§10.14 の表と同じ線）               |
| 分割（1パネルの中で上下に2本）       | レイアウトは Workspace Shell が持つ。Terminal の中に別の分割を作らない                                  |

---

## 14. Git（Workspace をリポジトリとして扱う）

DESIGN.md §3 の GitHub パネルが最終的に答えるのは「①変更確認 → ②コミットメッセージ → ③Commit & Push」だが、その手前に先に決まっていなければならない問いが1つある ── **今開いている Workspace で、そもそも Git 操作を始められるのか。**

Session 3-8-1 で置いたのはその**土台**（git の実行基盤とリポジトリ検出）だけで、Session 3-8-2 でその上に①（変更ファイルの一覧）を載せ、Session 3-8-3 でその一覧に**手を伸ばせる**ようにし（Stage / Unstage。§14.10 / §14.11）、Session 3-8-4 で②と③の前半（Commit。§14.12）を、Session 3-8-5 で③の残り（Push / Pull / Commit & Push。§14.13）を足した。Session 3-8-6 で足したのは、その3つとは並びの違うもの ── **どのブランチの上でそれを行うか**（一覧・切り替え・作成。§14.14）になる。Session 3-8-7 では**新しい機能を1つも足さず**、ここまでの6つを利用者が実際に通す1本の流れ（Status → Stage / Unstage → Commit → Push / Pull → ブランチの作成・切り替え）として production ビルド版で通し、ドキュメントの記録を実装に合わせて揃えた（確認の内訳は [DEVELOPMENT.md](DEVELOPMENT.md) §4）。

Session 3-8-8 で足したのは、ここまでのどれとも並びが違う ── **アプリの外で起きた Git の変化に、手を触れずに追いつくこと**（`.git` の監視。§14.15）になる。3-8-7 までは「調べるのは呼ばれたときだけ」で通していたが、内蔵 Terminal（§13）から `git add` / `git commit` / `git switch` を叩けるようになった時点で、その前提は**同じアプリの中で**崩れている。

Session 3-8-9 で足したのは、一覧の**中身**に手が届くようになること（差分と破棄。§14.16）── ここまでの一覧は「何が変わったか」までで、**どう変わったか**を見る手立ても、その1行だけを**やめる**手立ても無かった。この2つは同じ行の上に並ぶが性質は正反対で、片方は何も変えず、もう片方は Git 機能で唯一、利用者の書いたものを消す。

Session 3-8-10 で足したのは、ここまでの**手前**にあったもの2つ ── まだリポジトリではないフォルダをリポジトリにすること（`git init`）と、そのリポジトリを GitHub へ出すこと（§14.17）になる。3-8-1 でどちらも「やらないこと」として置いていたのは、DESIGN.md §3 が5つ（初期化 → 初回 Commit → 作成 → remote → Push）を一続きに書いていて、途中で止まると片付けられない状態が残るためだった。3-8-10 の答えは**一続きにしない**の側で、`git init` はそれだけで終わる操作にし、公開は後ろの3つだけを1本にしたうえで**途中経過を覚えず実状態から毎回組み立て直す**形にしてある。repository を作る相手は差し替え可能な境界（`github:*` という別のドメイン）として切り出した。

```
Renderer          git:get-repository（要求は void）
                  git:init（要求は void・§14.17）
                  git:stage / git:unstage（要求は相対位置1つ、またはグループの区別）
                  git:commit（要求はメッセージ1つ・§14.12）
                  git:push / git:pull（要求は void・§14.13）
                  git:commit-and-push（要求はメッセージ1つ・§14.13）
                  git:list-branches（要求は void・§14.14）
                  git:switch-branch / git:create-branch（要求は名前1つ・§14.14）
                  git:get-file-diff（要求は位置1つ + グループ1つ・§14.16）
                  git:discard（要求は位置1つ + グループ1つ・§14.16）
   ↓
Main handler      handlers/git.ts        読み取りは確かめる値が無い／書き込みは値を1つだけ確かめる
   ↓
Main domain       git/gitRepository.ts   噛み合わせ（読み取り）
                  git/gitInit.ts         噛み合わせ（初期化・§14.17）
                  git/gitStage.ts        噛み合わせ（書き込み・§14.11）
                  git/gitCommit.ts       噛み合わせ（Commit・§14.12）
                  git/gitSync.ts         噛み合わせ（Push / Pull / Commit & Push・§14.13）
                  git/gitBranches.ts     噛み合わせ（ブランチの一覧 / 切り替え / 作成・§14.14）
                  git/gitDiff.ts         噛み合わせ（差分・§14.16）
                  git/gitDiscard.ts      噛み合わせ（破棄・§14.16）
   ├── git/gitQueue.ts         走るのは常に1本（§14.11）
   ├── git/gitOperationResult.ts 応答の形（書き込み操作で共有・§14.12）
   ├── git/gitCommands.ts      引数を組み立てられる唯一の場所
   ├── git/runGit.ts           git を実行する唯一の場所（cwd は現在の Workspace）
   ├── git/gitExecutable.ts    git 本体を PATH から辿る
   ├── git/gitPathspec.ts      pathspec として通してよい形か（純粋・§14.10）
   ├── git/gitOutput.ts        出力の読み取り / パスの比較 / ブランチの一覧（純粋・§14.14）
   ├── git/gitStatusOutput.ts  status --porcelain=v2 の読み取り（純粋・§14.8）
   ├── git/gitBlob.ts          ls-files / ls-tree の読み取り・object 名の検査（純粋・§14.16）
   └── git/gitFailure.ts       stderr の分類（純粋）

Main event      git/gitWatcher.ts        `.git` を見張る（Session 3-8-8・§14.15）
   ├── git/gitWatchPaths.ts     拾う名前か（純粋・§14.15）
   └── git/gitChangeSchedule.ts いつ配るか（純粋・§14.15）
   ↓
Renderer        `git:changed` → `files:changed` と同じタイマーへ合流（§14.15）
```

GitHub への公開だけは**別のドメイン**として切ってある（§14.17）── 相手がネットワークの向こうのサービスで、動かす実行ファイル（`gh`）も認証も git とは別のものになる。

```
Renderer          github:get-status（要求は void）
                  github:publish（要求は名前1つ + 公開範囲）
   ↓
Main handler      handlers/github.ts     名前は shared の同じ関数を通す／公開範囲は閉じた集合
   ↓
Main domain       github/publishRepository.ts       噛み合わせ（gitQueue の枠の中で動く）
   ├── github/githubRepositoryPublisher.ts  差し替え可能な境界（設計判断 12）
   └── github/ghRepositoryPublisher.ts      GitHub CLI を動かす実装
```

**読み取りのチャンネルは1本のまま増やしていない。** 変更ファイルの一覧は `ready` の中身として返る（§14.8）── ブランチ名と一覧を別々に問い合わせる形にすると、画面の上下が別の瞬間の写しになり、ブランチを切り替えた直後に前のブランチの一覧が新しいブランチ名の下に並びうる。**操作ごとに1本ずつ切る**という §14.2 の規則は書き込む操作に対するもので、同じ画面を組み立てるための読み取りを分けにいく理由にはならない。

その規則どおり、Session 3-8-3 で増えたのは `git:stage` と `git:unstage` の**2本**になる。1本にまとめて「どちらか」を引数で持たせない ── Stage は作業ツリーの姿を index へ写す操作、Unstage は index だけを戻す操作で、いつか片方の意味でもう片方が動く形を作らない。Session 3-8-4 で増えたのも `git:commit` の1本だけで、**何を Commit するかを要求に載せていない**のが Stage / Unstage との違いになる（§14.12）。

Session 3-8-5 で増えた3本のうち2本は、**要求が `void` に戻る**（§14.13）── ネットワークへ出る操作でこそ相手の名前を渡したくなるが、remote 名もブランチ名も refspec も欄そのものを作っていない。3本目の `git:commit-and-push` を「Renderer から2本を続けて呼ぶ」で済ませていないのは、順番待ちが**1回の要求ごとに枠を取る**ため ── その2回の間に別の操作が挟まると「Commit したものを送った」と言えなくなる。

Session 3-8-9 で増えた2本には、**位置1つに加えてグループ1つ**が載る（§14.16）── 一覧は同じファイルを2つのグループに並べることがあるため（§14.8）、位置だけでは「どちらの行を押したのか」が決まらない。読み取りの `git:get-file-diff` を `git:get-repository` に相乗りさせていないのは `git:list-branches` と同じ理由で、**見られているのは1行を選んだ一瞬だけ**にあたる。書き込みの `git:discard` を `git:unstage` と分けてあるのは、あちらが index だけを戻すのに対しこちらが**作業ツリーを消す**ためで、同じチャンネルに区別を引数として持たせるといつか片方の意味でもう片方が動く。

Session 3-8-6 で増えた3本のうち2本には、**初めてブランチ名が載る**（§14.14）。3-8-5 で「名前で指せる形にしない」と決めたのは Push / Pull の**送り先**についてで、切り替え先は事情が違う ── 利用者が一覧から選んだそのものであり、他に指しようが無い。載るのは名前だけで、`--force` も `--merge` も start point も欄そのものを作っていない。読み取りの1本（`git:list-branches`）だけは `git:get-repository` に相乗りさせていない ── 変更ファイルの一覧と違い、**見られているのは面を開いている一瞬だけ**で、相乗りさせると保存のたびにブランチを数え直すことになる（§14.14）。

### 14.1 git 本体を PATH に任せない

`git` とだけ書いて `execFile` に渡すと、Windows の CreateProcess は**作業ディレクトリを先に見る**。Git の作業ディレクトリは利用者が開いた Workspace そのもので、その中に `git.exe` が置かれていることは十分ありうる（clone してきたリポジトリの中身は、この時点ではただのファイルでしかない）。「フォルダを開いて Git パネルを見た」が「そのフォルダの中の実行ファイルが動く」になっては困る。

Terminal が Node / Claude Code に対して引いたのと同じ線で、**PATH はこちらで辿り、実体を確かめてから絶対パスを渡す**。相対の項目（`.` や `bin`）は飛ばす。

規則そのものは `main/platform/executablePath.ts` へ寄せ、Terminal と Git が同じ実装を共有する。2箇所に書くと、片方だけ「相対の項目も拾う」ように直された時点で、その経路からだけ作業ディレクトリの中身が起動されるようになる（Session 3-8-1 での唯一の既存コードの変更がこの切り出しにあたる。`shellCommand.ts` の振る舞いは変わっていない）。

**PATH に居ないこともある。** Git for Windows のインストーラには「Git Bash からのみ使う（PATH に入れない）」という選択肢があり、それを選んだ PC では git は入っているのに PATH からは見つからない。PATH で見つからなかったときだけ、`%ProgramFiles%` などの**環境変数から組み立てた絶対パス**を当たる（`Git\cmd\git.exe`。隣の `bin\git.exe` は Git Bash 用なので指さない）。ここでも「名前だけに落とす」ことはしない。

**解決の結果は覚えない。** 利用者はアプリを開いたまま Git を入れることがあり、控えると「入れたのに使えない」が起動し直すまで続く（Terminal のシェル一覧と同じ理由）。

### 14.2 Renderer から任意の git を実行できる形を作らない

これが Session 3-8-1 の核心にあたる。

`git:get-repository` の**要求は `void`** で、コマンド名も引数も作業ディレクトリも渡す欄が無い。Terminal では「表のどの行か」（`TerminalShellId`）を渡せるようにしたが（§13.1）、Git ではその必要すら無く、Renderer が言えるのは「今の Workspace について調べて」までになる。

**なぜ git の引数を外から渡させてはいけないか。** `git` は引数だけで任意のプログラムを起動できる。

```
git -c core.pager=<任意のコマンド> log
git -c alias.x=!<任意のコマンド> x
git --exec-path=<任意のフォルダ> ...
```

つまり「git の引数を渡せる API」は、実質「任意のコマンドを実行できる API」にほかならない。Files が絶対パスを受け取らないのと同じく、**危ないものを弾くのではなく、渡せる欄そのものを作らない。**

引数を組み立てられるのは `main/git/gitCommands.ts` だけで、`runGit` はそこが作った `GitCommand` しか受け取らない。**`runGit` は作業ディレクトリも引数に取らない** ── 現在の Workspace を正本から自分で読む。受け取る形にすると、呼び出し側が増えるたびに「どこで実行するか」を決める場所が増え、いずれ Renderer から届いたパスがそこへ入る（`terminalSessions.ts` が cwd を受け取らないのと同じ形）。

シェルは通さない（`execFile` を使い、`shell` は既定の false のまま）。通すと引数が文字列として再解釈され、`&` や `|` を含む値が別のコマンドとして走りうる ── ブランチ名やファイル名にそういう文字は実際に入る。

**Session 3-8-2 以降で操作を足すときも、チャンネルは操作ごとに1本ずつ切る。** 要求に載るのはその操作に固有の値（commit メッセージ・Workspace root からの相対位置・ブランチ名）だけで、git の引数そのものは載せない。値は必ず独立した1つの引数として渡し、`--` の後ろへ置く（`-` で始まるブランチ名・ファイル名は実在する）。

### 14.3 アプリが呼ぶ git にだけ渡す環境変数

Terminal の `terminalEnvironment.ts` とは目的が違う。あちらは「素の PowerShell を開いたときと同じに見えること」を目指すが、こちらは**アプリが黙って呼ぶプロセス**なので「利用者を待たせない」ことを優先する。

| 変数                    | 何のために                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `GIT_TERMINAL_PROMPT=0` | 端末が付いていないため、尋ねようとされると待ち続ける。尋ねる代わりに即座に失敗させる        |
| `GIT_OPTIONAL_LOCKS=0`  | 読み取りのために `.git/index.lock` を取らない。利用者自身の `git commit` を横から邪魔しない |
| `LC_ALL=C`              | 失敗の文章の言語を固定する（§14.6 の分類と対になっている）                                  |

`ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` は Terminal と同じく落とす。git 自身は node を起動しないが、**フックと credential helper は利用者が用意した任意のプログラム**で、その中に node が居ることは珍しくない。

利用者自身が設定した `GIT_*`（`GIT_SSH_COMMAND` など）は消さない ── 消すと、意図して変えた振る舞いがアプリの中でだけ違うことになる。

`GIT_TERMINAL_PROMPT=0` は Session 3-8-1 の `rev-parse` には要らないが、先に決めてある。Push / Pull（Session 3-8-5）でこれが無いと、認証未設定の PC で Git パネルが固まる ── 設計判断 7（credential.helper 未設定時は強行せず案内する）は「固まらない」が前提になっている。

### 14.4 Workspace root がリポジトリ root でなければ操作しない

判定の順に意味がある。

```
1. Workspace はあるか              → 無ければ調べる先が無い
2. rev-parse --show-toplevel       → リポジトリか / その root はどこか
3. root は Workspace root と同じか → 違えば操作しない
4. HEAD はどこを指しているか        → ブランチ / detached
```

**3 を 4 より先に置く。** root が食い違う状態でブランチ名だけ出すと、画面には Git が使えるように見えて、実際には**見えていないファイルまで Commit / Push の対象**になる。Files に出ていない変更が変更ファイル一覧に並ぶことになり、利用者から見て何を送ったのか分からない。だから「使えるかどうか」を先に確定させてから中身を聞く。サブフォルダ側のリポジトリを勝手に選ぶこともしない。

**Renderer へ渡すのはリポジトリの名前だけで、その絶対パスは渡さない。** 渡せば、それを指して開き直させる API が欲しくなる（Files が絶対パスを渡さない §9.2 と同じ線）。開き直すのは利用者がフォルダ選択ダイアログで行う。

**「同じ場所か」の判定は厳密一致ではない。** git は区切りを常に `/` で返し、Workspace root は OS の表記で持つ。Windows のパスは大文字小文字も区別しない。ここを厳密一致にすると、リポジトリ root を開いているのに必ず食い違い、Git パネルが何もできなくなる。文字列としての正規化は `gitOutput.ts`（純粋・テスト対象）が持ち、symlink / ジャンクションを解いた比較だけを `gitRepository.ts` が足す（`realpath` に触れた時点でテストで固定できなくなるため）。

**ブランチ名は `symbolic-ref --quiet --short HEAD` で読む。** `rev-parse --abbrev-ref HEAD` ではなく、というのは、**1つも commit が無いリポジトリ（`git init` 直後）でも答えが返る**ため。HEAD は最初から `refs/heads/main` を指していて、その先がまだ無いだけになる。`--quiet` を付けてあるので detached HEAD では何も言わずに 1 で終わり、それは失敗ではなく「ブランチの上に居ない」という答えとして扱う。

detached を「ブランチ名の欄に commit を出す」形にしていないのは、**利用者が次に取る行動が違う**ため。ブランチの上に居れば Commit はそのブランチに積まれるが、detached ではどこにも属さない commit になる。

### 14.5 いつ調べ直すか

Main は状態を覚えない。`describeGitRepository()` は呼ばれたときに毎回調べるだけで、Main から状態を押し出す経路は無い（Session 3-8-8 で `.git` を見張るようになった後も、そこから流れるのは**「調べ直して」という合図1つ**で状態そのものではない。§14.15）。

調べる契機は次のとおり。

| 契機                     | 実装での現れ方                                                  |
| ------------------------ | --------------------------------------------------------------- |
| Git パネルを出した       | `useGitRepository` が動き出す時点（パネルを畳めば状態も消える） |
| Workspace の切り替え     | `workspace.id` が変わったら調べ直す                             |
| 利用者の手動更新         | バーの再取得ボタン                                              |
| 作業ツリーのファイル変化 | `files:changed`（Session 3-8-2 で追加）                         |
| `.git` の変化            | `git:changed`（Session 3-8-8 で追加。§14.15）                   |
| Stage / Unstage の後     | **操作の応答に載って届く**（Session 3-8-3 で追加。§14.11）      |
| Commit の後              | **操作の応答に載って届く**（Session 3-8-4 で追加。§14.12）      |

**`files:changed` は Session 3-8-2 で購読するようになった。** 3-8-1 で購読していなかったのは、出していたのがブランチ名だけで、それは作業ツリーのファイルが変わっても動かないためになる。変更ファイルの一覧が入ったことで事情が変わった ── 保存するたび、ファイルを1つ作るたびに一覧は変わり、**手で更新しない限り古いままの一覧は「変更したのに出てこない」という形で嘘をつく。**

そこで拾えるのは作業ツリー側だけになる。`.git` の中は `files:changed` の対象外なので（§12.1 の除外規則）、`git add` も `git commit` も `git switch` もこの経路には載らない ── **Session 3-8-7 まで手動の更新が要ったのはそのため**で、Session 3-8-8 で足した `git:changed` がその残り半分を運ぶ（§14.15）。

**2つを Renderer 側で同じタイマーへ合流させる**（`useGitRepository.ts`）。変化は 0.4 秒だけ束ねてから1回調べる ── 別々のタイマーに分けると、`git commit` のように両方が同時に動く操作で読み直しが2回走り、しかも1回目は「index は空になったが作業ツリーはまだ」という途中の写しになりうる。

**手動の更新は残してある。** 監視は失敗しうる（再帰監視が使えない OS・権限が無い・ネットワークドライブ）し、失敗しても Git パネルは立っているべきものにあたる ── 自動で追いつかない環境で、押す先が1つも無い形にしない。

**変化の中身は見ない。** 「この変化なら一覧は変わらない」を Renderer 側で先回りして決めると、その判断が git の判断と食い違ったときに一覧が古いまま止まる。

状態は Shell の外側へ持ち上げていない。Terminal（`TerminalProvider`）や Editor（`EditorProvider`）が外に居るのは**パネルより長く生きる必要のあるもの**（OS のプロセス・未保存の Model）を抱えているためで、Git が持っているのは調べ直せば済む写しでしかない。パネルを畳めば消え、開けば調べ直す ── それがそのまま「パネルを出したときに調べる」という契機になっている。

問い合わせている間に Workspace は切り替わりうるため、応答には `workspaceId` が載る（§12.2 と同じ理由）。突き合わせずに書き込むと、切り替え直後に前の Workspace のブランチ名が一瞬出る。追い越しは通し番号で捌く ── 「実行中なら弾く」形にすると、切り替えが実行中に起きたときに次の問い合わせが始まらないまま止まる。

### 14.6 生の stderr を Renderer へ渡さない

git の失敗の説明は開発者向けの英文で、複数行にわたり、`hint:` の付いた助言まで混ざる。そのまま UI に出すと、利用者が読むのは「何かに失敗した英語の文章」でしかない。

そこで**分類するのは Main**（`gitFailure.ts`）で、Renderer へ渡るのは分類だけになる。元の文章は Main のログへ残す（`IpcErrorPayload` の `detail` と同じ分担）── 開発中に原因を追う手段まで失う理由は無い。

分ける基準は「**利用者の次の一手が変わるか**」。次の一手が同じものを分けても、UI に同じ案内が2つ並ぶだけになる。

| 分類                            | 利用者の次の一手                                                            |
| ------------------------------- | --------------------------------------------------------------------------- |
| `dubious-ownership`             | `git config --global --add safe.directory` で信頼する（Windows で最も多い） |
| `no-work-tree`                  | bare リポジトリ。clone した作業用のフォルダを開く                           |
| `permission-denied`             | フォルダのアクセス許可を確認する                                            |
| `timeout`                       | もう一度試す                                                                |
| `unreadable-output` / `unknown` | もう一度試す / ログを見る                                                   |

**知らない文章は `unknown` に倒す。** 近そうな分類へ寄せると、間違った直し方を案内することになる。

分類が英文を当てにできるのは、アプリが呼ぶ git にだけ `LC_ALL=C` を渡しているため（§14.3）。この2つは対になっていて、片方だけ変えると分類が環境ごとに割れる。

**「リポジトリではない」は失敗の表に入れていない。** それは `rev-parse` に対する正常な答えの1つ（未初期化のフォルダを開いている）であって、失敗ではない。同じ表に混ぜると、状態と失敗の区別が溶ける。

### 14.7 失敗を IpcResult の失敗にしない

Git が入っていない・リポジトリではない・root が食い違う ── どれも `IpcError` にせず、応答の中の**状態**として返す。汎用のエラー文言（`api/result.ts` の対応表）に丸められると、Git パネルが「何をすればよいか」を出せなくなるため（`workspace-folder:open` の取り消しを失敗にしていないのと同じ理由）。

**Git が入っていない PC でアプリが落ちる理由にもしない**（設計判断 6）。使えないのは Git パネルだけで、Files / Editor / Terminal はそのまま動く。

Git パネルが出す案内はほとんどが**利用者に直せる状態**を指しているため、文言はすべて「次の一手」とセットにしてある。理由だけを出して終わると、利用者から見て「壊れている」と区別が付かない。未初期化のフォルダに `git init` のボタンを出さない代わりに、どうすれば始められるかを書いてあるのもこのためになる（設計判断 1）。

### 14.8 変更ファイルの一覧を読む（Session 3-8-2）

Git パネルの①（変更確認）にあたる。Main が読むのは1回の `git status` で、Renderer へ渡るのは**分類された一覧だけ**になる。

```
git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=normal
```

引数の1つ1つに理由がある（`main/git/gitCommands.ts`）。

| 引数                       | 何のために                                                               |
| -------------------------- | ------------------------------------------------------------------------ |
| `--no-optional-locks`      | 読むだけで `.git/index.lock` を取らない（利用者自身の git を邪魔しない） |
| `--porcelain=v2`           | 機械が読むための形。人向けの出力と違い、git の版で文言が変わらない       |
| `--branch`                 | ブランチ・upstream・ahead / behind の見出し行が付く                      |
| `-z`                       | 区切りを NUL にする。**名前が引用符で包まれなくなる**（下記）            |
| `--untracked-files=normal` | 未追跡はフォルダ単位でまとめる。`all` だと `node_modules` で数万行になる |

#### `--no-optional-locks` は、Session 3-8-8 で意味が1つ増えた

3-8-2 で置いた時点の理由は「利用者自身の `git commit` を横から邪魔しない」だけだった。`.git/index` を見張るようになった今、この指定は**監視が成立する前提**そのものになっている。

`git status` は既定で、読んだついでに index の stat キャッシュを書き戻す（`.git/index` の更新）。`.git/index` を見張りながらこれを許すと、

```
.git/index が変わった → git:changed → git status → .git/index が変わった → …
```

という輪ができ、**アプリが自分の読み取りで自分を呼び戻し続ける。** `--no-optional-locks`（サブコマンドより前に置く git 本体の引数）と `GIT_OPTIONAL_LOCKS=0`（§14.3）はどちらもこの書き戻しを止めるため、読み取りは index を**読むだけ**で終わる。片方が外れても効くよう二重に掛けてあるのは 3-8-2 からの形のままで、**そこへ手を入れると輪が生まれる**という理由が新しく足された、という関係になる。

書き込む操作（Stage / Commit / 切り替え）はもちろん index を書くので、応答で状態を返した後に `git:changed` が1回届く。それは読み直し1回で終わる ── **読み直しが次の変化を生まない**ため（実測: アプリ自身の Stage 1回に対して `git:changed` は1本。[DEVELOPMENT.md](DEVELOPMENT.md) §4）。

**`-z` が効いているのは区切りだけの話ではない。** これが無いと git は「変わった名前」を引用符で包み `\303\251` のようにエスケープして返す（`core.quotepath`）── 日本語のファイル名は必ず化け、それを解くコードをこちら側に持つことになる。`-z` なら生のバイト列がそのまま返り、**解く処理そのものが要らなくなる**（空白・引用符・改行を含む名前も同じ理由で通る）。

**読み替えは Main に閉じる。** `XY` の2文字も、`1` / `2` / `u` / `?` のレコード種別も、`R100` のスコアも Renderer へは渡らない（`shared/git/status.ts` が持つのは分類だけ）。porcelain の版が変わっても直すのは `gitStatusOutput.ts` 1つで済む。

読み取りで外せない判断が3つある。

- **`2`（rename / copy）のレコードだけが、その中に NUL を1つ含む。** 元の path が次のフィールドとして続くため、区切りで割っただけでは1件が2件に見える ── rename が「新しいファイル」と「知らない path の行」に化ける
- **`XY` は2つの答えを持つ。** `X` が index 側、`Y` が作業ツリー側で、`MM` のファイルは staged と unstaged に**1件ずつ**並ぶ。1行に畳むと、片方だけを戻す操作（Session 3-8-3 の Unstage）が行の上で表せない
- **知らない形は「読めなかった」に倒す。** 途中まで読めた分を返さず `unreadable-output` にする ── 黙って1件欠けた一覧は、案内が出るより危険にあたる（利用者はそれを「変更のすべて」として読む）

**衝突（unmerged）は staged / unstaged と別のグループにしてある。** 解決するまで Stage も Unstage も意味を持たないため、同じ場所に並べると成立しない操作を勧めることになる。

**path の形も確かめてから通す。** git が返すのはリポジトリ root からの相対位置（区切りは `/`）で、Workspace root ＝ リポジトリ root のときしか一覧を出さない（§14.4）ため、それはそのまま Files / Editor の relativePath になる。それでも `..` を含む形・`/` で始まる形・`.git` の中は受け付けない ── clone してきたものの中身はこの時点ではただのデータでしかなく、**境界の判断を「git は変な path を返さない」という前提に預けない**（実際に開くときの検証は `main/files/workspacePath.ts` が独立に行うので、ここは二重の1枚目にあたる）。

### 14.9 一覧の見せ方（Renderer）

**Git 専用のファイルの開き方を作らない。** 行から開くのは `openFile({ relativePath, name })`（§12.2）で、Files のツリーの行・カラムの行・検索結果とまったく同じ入口になる。別の経路を作ると、「タブが2枚できる」「未保存の確認が効かない」といった差が Git から開いたときだけ現れる。同じ形にできるのは、Main から届く path が Workspace root からの相対位置だからにほかならない（§14.8）。

**開けないものは button にしない。** 削除されたファイルと未追跡のフォルダは「今は押せない」のではなく**押す先が無い**ため、`disabled` の button ではなく `span` にしてある。開ける条件は `gitChanges.ts`（純粋・テスト対象）が1箇所で持つ ── 行を描く側の if に散らすと、削除された行だけ押せてしまう形が生まれる。

**Session 3-8-2 の段階で押せたのは2つだけ**（再取得と、行を押してファイルを開く）。Stage / Unstage / Commit / 破棄のボタンは1つも置いていなかった ── 押しても何も起きないボタンや半分だけ効く操作を先に並べると、利用者はそれを「壊れている」と受け取る（3-8-1 で `git init` のボタンを出さなかったのと同じ判断）。3-8-3 で足したのも、その原則どおり**本当に効くものだけ**になる（§14.11）。3-8-4 の Commit も同じで、押せない条件（ステージ済みが無い / メッセージが空 / 他の Git 操作が動いている）は**理由の一言と一緒に**出す（§14.12）。

**並べ替えを持たない。** git が返した順（path 順）のまま出す。一覧は数秒ごとに読み直されうるため、種類ごとにまとまっていることより**並びが動かないこと**の方が効く（押そうとしていた行が入れ替わらない）。

グループの順は「利用者が次に触るもの」から並べてある ── 競合 → ステージ済みの変更 → 変更 → 未追跡のファイル。上から下へ読むと Commit に近い順になり、DESIGN.md §3 の並び（設計判断 2）とも揃う。空のグループは出さない。

**記号だけに意味を預けない。** 行頭の記号は `git status` の短い形と同じ字（`M` / `A` / `D` / `R` / `C` / `T` / `?` / `!`）で、端末で見ている字と揃う。色は補助でしかなく、種類の言葉は読み上げにも hover にも渡している。

**upstream が無いときは欄そのものを出さない。** 「0 / 0」で表すと、同期済みと**比べる相手が無い**が同じ表示に潰れる。upstream はあるが差が分からない（ref が手元に無い）場合も 0 とは書かない。

### 14.10 pathspec は path ではない（Session 3-8-3）

Stage / Unstage で初めて、**Renderer から届いた値が git の引数に入る**。ここが Session 3-8-3 でいちばん気を遣った場所になる。

Files が受け取る相対位置と、git へ渡す値は**同じ文字列でも意味が違う**。git が受け取るのは pathspec ＝「対象を選ぶ式」で、次のように働く。

| 値              | Files での意味     | git（pathspec）での意味                        |
| --------------- | ------------------ | ---------------------------------------------- |
| `a*.txt`        | その名前のファイル | **glob。** 他のファイルまで巻き込む            |
| `:(exclude)src` | その名前のファイル | **魔法。** path ですらない（除外の指定）       |
| `:/`            | その名前のファイル | 魔法（リポジトリ root からの指定）             |
| `` （空文字）   | Workspace root     | **すべてに近い。** 1件のつもりが全件になりうる |
| `dir`           | そのフォルダ       | その下**すべて**（前方一致）                   |

判断は2段構えにしてある。

**1. 通してよい形かを確かめる**（`main/git/gitPathspec.ts`・純粋・テスト対象）。土台には Files と**同じ関数**（`normalizeWorkspaceRelativePath`。§9.3）を使う ── 「Workspace の中の相対位置か」という問いは同じもので、2箇所に書けば片方だけ直された時点でその経路からだけ外へ出られる（`executablePath.ts` を Terminal と Git で共有しているのと同じ理由）。その上に git の分だけを足す。

- **空文字を受け付けない**（Files では root を指す正常な値だが、pathspec では「1件」ではない）
- **先頭の `:` を名指しで弾く**（`normalizeWorkspaceRelativePath` は別の理由で `:` を弾くが、その理由が無くなった日に穴が空かないよう、こちらでも確かめる）
- **`.git` の中を弾く**（git 自身も拒むが、拒み方は版によって変わる。読み取り側の `gitStatusOutput.ts` と対になる）
- **C0 制御文字を弾く**（Windows では作れない名前で、ログにも UI にも壊れた形で出る）

**2. 弾けないものは、意味の側を止める。** `*` `?` `[` を含むファイル名は POSIX では実在しうるため、弾くと**一覧には出るのに永久に Stage できないファイル**が生まれる。代わりに git 本体の引数で解釈そのものを切る。

```
git --literal-pathspecs add -- <pathspec>
```

`--` と `--literal-pathspecs` は役割が違い、**片方だけでは足りない。**

| 仕掛け                | 止めるもの                                          |
| --------------------- | --------------------------------------------------- |
| `--`                  | 値が**オプション**として読まれること（`-lead.txt`） |
| `--literal-pathspecs` | 値が**魔法や glob**として読まれること（`a*.txt`）   |

これは §14.2 の「危ないものを弾くのではなく、渡せる欄そのものを作らない」を、**渡さざるを得ない値**に対して適用した形にあたる。値を疑い続けるのではなく、値が値でしかない状態を作る。

前後に空白のある名前（`notes.txt `）を `trim` しないことも Files と同じ（§10.2）── 判定は写しに対して行い、git へ渡すのは生の文字列に揃えた形になる。日本語・空白・引用符・先頭 `-`・glob に見える名前は、実際の git に対するテスト（`gitStageRepository.test.ts`）で1件ずつ固定してある。

### 14.11 Stage / Unstage（Session 3-8-3）

#### 1つの仕事は「読む → 動かす → 読み直す」

```
1. 今の状態を読む      → 操作できるか / 対象は何か
2. git を動かす        → add / reset / rm --cached
3. もう一度状態を読む  → 応答に載せる（成功でも失敗でも）
```

**1 と 3 で同じ読み取り経路を使う**（`gitRepository.ts`）。対象を決めた一覧と、操作の後に画面へ出す一覧が同じところから出てくるため、「画面に出ているもの」と「実際に Stage されたもの」が食い違わない。

**応答に操作後の状態を載せる**ので、Renderer は続けて `git:get-repository` を呼ばない。2回に分けると、その間に挟まった別の変化を「押した操作の結果」として出すことになる。**失敗でも読み直す** ── 失敗の後に古い一覧を残すと、利用者から見て「押したのに何も変わらない」になり、本当の状態が分からなくなる。

#### 走る git は常に1本（`gitQueue.ts`）

読み取りだけだった 3-8-2 までと違い、index に書き込む操作は同時に走れない（`.git/index.lock` の取り合いで、片方が理由も無く失敗する）。

**ボタンを `disabled` にするだけでは足りない。** Renderer 側の抑止が止められるのは「同じ行の二度押し」までで、別の行の操作や、`files:changed` から始まる自動の読み直しは止まらない。順番を決めるのは git を動かす側 ＝ Main になる。

**弾かずに並ばせる。** 「走っている間は断る」形にすると、押したのに何も起きない（しかもいつ押せるのか分からない）が起きる。並べておけば押した順に必ず効く。

束ねる単位は「1回の git」ではなく**1つの仕事**にしてある ── `runGit` の中で待たせると、上の 2 と 3 の間に割り込まれる。その代わり、枠の中から順番待ちを呼んではいけない（`describeGitRepository` が待つ版、`readGitRepositoryOutcome` が待たない版）。

#### 何を Stage するかは、Main が読んだ状態から決める

要求に載るのは「ファイル1件」か「どのグループか」だけで、**path の配列は載らない**（載せた瞬間、任意の複数 path を渡せる欄になる）。グループの中身は Main がその場で読み直した一覧から決める ── 押すまでの間に消えたファイルや、競合に変わったファイルを巻き込まないためでもある。

**`git add -u`（作業ツリー全体）は使わない。** あれは衝突しているファイルまで index に載せる ＝ **黙って「解決済み」にする**。画面では競合を別のグループに分けてある（§14.8）のに、「変更のすべて」を押したら競合まで解決された、という食い違いを作らない。

pathspec は Windows のコマンドラインの上限（32767 文字）に収まるよう分けて渡す。分けた2回目で失敗すれば途中まで進んだ状態になるが、**3 の読み直しでその姿がそのまま画面に出る**ので嘘にはならない。

#### Unstage は HEAD の有無で経路を分ける

| 状態               | 実行するもの                        | なぜ                                                   |
| ------------------ | ----------------------------------- | ------------------------------------------------------ |
| commit がある      | `git reset --quiet HEAD -- <path>`  | index だけを HEAD の中身へ戻す（作業ツリーに触らない） |
| まだ commit が無い | `git rm --cached --force -- <path>` | HEAD が無いので「戻す先」も無い。index から取り除く    |

**初回 commit 前に `reset` / `restore --staged` を通さない。** git の版によっては `fatal: could not resolve 'HEAD'` で断られる（手元の 2.54 では `reset` が通り、`restore` は断られた）── いちばん人が触る場面で、結果を git の版に委ねない。`rm --cached` なら戻り先は「未追跡」になり、それは初回 commit 前の利用者の期待とも合う。

`--force` を付けても**作業ツリーのファイルは消えない**（`--cached` が付いている限り git が触るのは index だけ）。外れるのは「index の中身が作業ツリーとも HEAD とも違うときは念のため断る」という安全弁の方で、ここではそれが邪魔になる（Stage した後にもう一度書き換えたファイルで、Unstage だけが断られる）。

HEAD があるかどうかは `rev-parse --verify --quiet HEAD` で確かめる。`symbolic-ref` の結果から判断しない ── あれは commit がまだ無くてもブランチ名を答える（§14.4）ため、「ブランチの上に居る」と「commit がある」は別の問いになる。

**rename では元の位置も一緒に戻す。** index の上で rename は「元の削除」と「新しい位置の追加」の2つで、新しい位置だけを戻すと**削除だけが Stage に残る** ── 画面では1行だったものを戻したのに、別の1行が残る。copy（`C`）では元が変わっていないので、対象は新しい位置だけになる。

#### 失敗は、状態としては返さない

`GitFailureReason`（§14.6）と別に `GitOperationFailureReason` を持つ。**出す場所が違う**ためで、あちらは Git パネル全体を案内の画面へ差し替える分類、こちらは**一覧を出したまま上に1行だけ添える**分類になる。同じ型にすると、`no-work-tree` のように操作の失敗としては起こりえないものまで混ざる。

| 分類                  | 次の一手                                                           |
| --------------------- | ------------------------------------------------------------------ |
| `index-locked`        | 他の git（端末の `git commit` など）を終えてやり直す               |
| `path-not-found`      | 対象が消えた / 既に外れていた。一覧を見直す                        |
| `nothing-to-do`       | グループが空になっていた（押しても何も起きない、を黙って通さない） |
| `not-ready`           | Workspace が閉じた・リポジトリでなくなった                         |
| `permission-denied`   | フォルダのアクセス許可を見る                                       |
| `timeout` / `unknown` | もう一度試す / ログを見る                                          |

**`IpcResult` の失敗になるのは、要求そのものが壊れている場合だけ**（pathspec として通せない値・知らないグループ名）。それは利用者に起こることではなく Renderer 側の不具合なので、`INVALID_REQUEST` として返す。生の stderr を渡さない方針は 3-8-1 のまま（分類するのは Main の `gitFailure.ts`）。

#### UI（Renderer）

**押せるのは、グループから決まる操作だけ。** 行に置く操作を「その行がどのグループに居るか」から決める（`gitChanges.ts`・純粋・テスト対象）── 行の `kind` から決めると、同じ `modified` でも staged なら外す側・unstaged なら載せる側、という判断をもう一度どこかで持つことになる。

| 場所                   | 置くもの                                                        |
| ---------------------- | --------------------------------------------------------------- |
| 変更 / 未追跡 の行     | `＋`（Stage）                                                   |
| ステージ済み の行      | `−`（Unstage）                                                  |
| 変更 / 未追跡 の見出し | 「すべて Stage」                                                |
| 競合 の行・見出し      | **置かない**（解決するまで両方とも成立しない）                  |
| ステージ済み の見出し  | **置かない**（すべて Unstage は Commit の中身を丸ごと空にする） |

競合の行に `disabled` のボタンを置かないのは、開けないものを button にしていない（§14.9）のと同じ判断にあたる ── 「今は押せない」ではなく「押す操作が無い」。

アイコンは Files と同じ描き方（その場で描く SVG・`currentColor`・16 の viewBox）にしてある。CSP を1文字も緩めないためで、置き場所だけはドメインの中（`git/GitIcons.tsx`）にした ── 共有するのは描き方であって、Files のアイコンの表に Git の操作を混ぜない。

**止めるのは押した対象だけ。** 処理中でもパネル全体は生きている（1件の Stage で一覧ごと押せなくすると、続けて何件も Stage するという普通の使い方が1件ずつ待つ作業になる）。二重の要求は目印の集合で止め、**state と ref の両方に持つ** ── state だけだと、描き直しを待つ間に届いた2つ目が古い写しを見て通る。

### 14.12 Commit（Session 3-8-4）

Git パネルの②（コミットメッセージ）と③の前半にあたる。増えたチャンネルは `git:commit` の**1本**で、要求に載るのは利用者が書いた文章だけになる。

#### 何を Commit するかは、要求に載らない

```
git commit --quiet --cleanup=whitespace --file=-
```

pathspec も `-a` も付いていない。つまり **対象は index の中身そのもの**で、Renderer から「このファイルを Commit」と言える欄が無い（`shared/ipc/contracts/git.ts`）。欄を作ると、画面に「ステージ済み」として出ているものと、実際に Commit されるものが別々に決まりうる。

この形がそのまま、Session 3-8-4 でいちばん守りたい保証になっている。

| 状態                    | Commit した結果                                    |
| ----------------------- | -------------------------------------------------- |
| staged `A`              | **`A` だけが commit に入る**                       |
| unstaged `B`            | そのまま残る（index に無いため）                   |
| untracked `C`           | そのまま残る（index に無いため）                   |
| `A` を Stage 後に再編集 | Stage した時点の中身が入り、続きは unstaged に残る |

実際の git に対して `gitCommitRepository.test.ts` で1件ずつ固定してある。

#### 利用者が書いた文章は、引数ではなく標準入力から渡す

Stage / Unstage で引数に入ったのは **位置**（pathspec）だったが、Commit で入るのは **文章**になる。これはコマンドラインに載せない。

`execFile` はシェルを通さない（§14.2）ので、引数に載せてもそれ自体で別のコマンドが走ることは無い。それでも標準入力を選ぶのは、引数に載せると**別々の配慮が4つ同時に要る**ため。

| 引数に載せると要る配慮                       | 標準入力なら |
| -------------------------------------------- | ------------ |
| Windows のコマンドラインの上限（32767 文字） | 関係が無い   |
| 複数行が1つの引数として渡るか                | 関係が無い   |
| `-x` で始まる文章がオプションと読まれないか  | 関係が無い   |
| プロセス一覧・監査ログへの写り込み           | 載らない     |

pathspec で「弾くのではなく、値が値でしかない状態を作る」（§14.10）としたのと同じ形にあたる。危ない使われ方を1つずつ潰すのではなく、使われる経路そのものを無くす。

`runGit` に足したのは `input` の1つで、**実行ファイル・引数・作業ディレクトリを受け取らない**という線は動いていない（`main/git/runGit.ts`）。git が読む前に終わったときの EPIPE は握り潰す ── それは「git を動かせなかった」ではなく、その git の終了コードで既に分かっていることになる。

#### `--cleanup=whitespace` を明示する

git の後始末の既定は「編集させるかどうか」で変わる（編集させるなら `strip`、させないなら `whitespace`）。さらに `commit.cleanup` の設定でも変わる。**版や設定で変わるものを既定に任せない。**

`strip` が効くと `#` で始まる行が黙って消え、`#123 の修正` のようなメッセージが**空になって Commit が失敗する。** `whitespace` が落とすのは前後の空行と行末の空白だけで、それは `normalizeGitCommitMessage` が渡す前に落としている分と重なる ── 入力した文字列がそのまま記録される。

#### メッセージの規則は shared に1つだけ置く

|        |                                                    |
| ------ | -------------------------------------------------- |
| 場所   | `shared/git/commitMessage.ts`（純粋・テスト対象）  |
| 拒む   | 空 / 空白だけ / 10,000 文字超 / NUL などの制御文字 |
| 通す   | 改行・タブ・日本語・引用符・`#`・先頭の `-`        |
| 揃える | CRLF と CR を LF へ / 前後の空白を落とす           |

`fileName.ts`（§9.3）と同じ立ち位置になる ── Renderer は入力中にその場で「まだ押せない」を出す必要があり、1文字打つたびに IPC を往復させるわけにはいかない。2箇所に書けば、片方だけ直された日に「ボタンは押せるのに Main が弾く」が生まれる。

**同じ関数を使うことと、検証を Renderer へ委譲することは別の話。** Main は受け取った文字列を必ずこの関数へ通してから git を触り（`main/ipc/handlers/git.ts`）、通せない値は `INVALID_REQUEST` として返す ── Renderer 側でボタンが押せなくなっている以上、ここへ届くのは Renderer の不具合であって利用者に起こることではない。

改行を残しているのは、Commit メッセージが「要約 + 空行 + 本文」という形を取りうるため。**渡し方が標準入力なので、許すために特別な配慮が要らない。**

#### 押す前に分かることは、押した後に git へ聞かない

1つの仕事は Stage / Unstage の「読む → 動かす → 読み直す」に **1つ挟まった**形になる（`main/git/gitCommit.ts`）。

```
1. 今の状態を読む   → Commit できる状態か / ステージ済みは何件か
2. 名乗りを確かめる → git var GIT_AUTHOR_IDENT
3. git commit       → メッセージは標準入力から
4. もう一度読む     → 応答に載せる（成功でも失敗でも）
```

1 と 2 で分かることを git commit に聞かないのは、**聞くと hook が先に走る**ため。通らないと分かっている Commit のために、リポジトリの lint やテストを動かすことになる。

| 押す前に分かること      | どこで                                 | 分類                   |
| ----------------------- | -------------------------------------- | ---------------------- |
| 競合が残っている        | 1 で読んだ一覧（`changes.conflicted`） | `unresolved-conflicts` |
| ステージ済みが1件も無い | 1 で読んだ一覧（`changes.staged`）     | `nothing-to-do`        |
| 名乗りが決まっていない  | 2（`git var GIT_AUTHOR_IDENT`）        | `identity-missing`     |

**空の Commit を作る経路は持たない**（`--allow-empty` は使わない）。押したのに何も起きないの別の形にあたる。

#### 名乗りはアプリが決めない

`user.name` / `user.email` が決まっていなければ Commit は失敗として案内するだけで、**Fluvix Nexus 側から設定することはしない。** 名乗りはリポジトリの履歴に永久に残るもので、アプリが推測した値を黙って刻むと利用者は後から直せない。設定の UI も持たない（Session 3-8-4 の範囲外）。

実 git で確かめた挙動が2つある。

- `user.email` を外すと、git はホスト名から作った宛先（`…@host.(none)`）を**自分で断る**
- `user.name` を外しただけでは、git は OS の情報から名前を作れてしまう（空文字にすると `empty ident name` で断る）

どちらも `git var GIT_AUTHOR_IDENT` が 128 で終わる形になり、commit を動かす前に分かる。

#### hook は迂回せず、終わり方の形で見分ける

`--no-verify` は使わない。リポジトリが置いた決まりごとをアプリが黙って外すことになるためで、その代わりに **hook が走る分だけ待ち時間の上限を別に持つ**（`GIT_COMMIT_TIMEOUT_MS` = 2分。他の git は 10 秒のまま）。lint やテストを丸ごと動かす hook は珍しくなく、10 秒で諦めるとそういうリポジトリでは Commit が必ず時間切れになる。

分類は難しい。実 git で確かめたところ、**hook が Commit を止めたとき git 自身は何も言わない** ── 出るのは hook 自身の出力だけで、黙って落ちる hook なら stderr も空になる。つまり文言の表で当てにいく相手が居ない。

代わりに終わり方を見る（`classifyGitCommitFailure`）。

| 終わり方                       | 分類                                          |
| ------------------------------ | --------------------------------------------- |
| `fatal:` を書いて 128 で終わる | git 自身の理由（名乗り / 競合 / lock / 権限） |
| `fatal:` を書かずに 1 で終わる | `hook-rejected`                               |

**Stage / Unstage とは別の分類関数にしてある。** 同じ stderr でも読み方が違う ── あちらは git 自身の文章だけだが、Commit の stderr には**利用者が置いた任意のプログラムの出力**が混ざる。hook の出力に `permission denied` という語が出てきても、それは git がそう言ったこととは違う（`fatal:` が行頭に無い限り、権限の案内は出さない）。

hook の出力そのものは Renderer へ渡さない（生の stderr を渡さない方針の中で、もっとも当てにならないものにあたる）。詳細は Main のログに残る。

#### UI（Renderer）

入力欄とボタンは**一覧の下**に置く。上から下へ「①何が変わったか → ②何と書くか → ③押す」と読める形で、VS Code のように入力欄を一覧の上へ持ってくる形へは寄せていない（DESIGN.md 設計判断 2）。

**Commit 欄は変更が無くても出したままにする。** 変更があるときだけ現れる形にすると、ファイルを1つ保存した瞬間に画面の下半分が生えてきて、一覧の位置まで動く。

押せる条件は `gitChanges.ts`（`toGitCommitReadiness`・純粋・テスト対象）が1箇所で決め、**押せない理由の一言も一緒に返す** ── 条件が3つあるため、`disabled` の式を JSX に直接書くと理由を添える場所が無くなり、薄いボタンだけが並ぶ。

| 状態                        | Commit ボタン | 添える一言                 |
| --------------------------- | ------------- | -------------------------- |
| ステージ済みが無い          | disabled      | 変更をステージするよう促す |
| メッセージが空              | disabled      | **出さない**（下記）       |
| メッセージが長すぎる / 不正 | disabled      | 直すべきところを出す       |
| 他の Git 操作が動いている   | disabled      | なし                       |
| 上記以外                    | enabled       | なし                       |

**空欄には理由を出さない。** 何も書いていない欄の下に「入力してください」と出しても、増えるのは文字だけになる。出すのは「書いたのに押せない」場合だけにしてある。

**Commit だけは、他の操作が動いている間も押せなくする。** 行の `＋` / `−` は押した対象だけを止める（§14.11）が、Commit の中身は「ステージ済み」の**全体**で、走っている Stage / Unstage はまさにその全体を書き換えている最中にあたる ── 押せてしまうと「画面に出ている一覧を Commit した」と言えなくなる。

**競合が残っているかは Renderer では見ない。** 競合の間 git は commit を作らないが、その判断は git の側にあり、こちらで先回りして真似ると2箇所に規則が生まれる。押した結果は `unresolved-conflicts` として一覧の上に出る。

**成功したときだけ入力欄を空にする。** 失敗のときに消すと、書いた文章が失われたうえで「もう一度書いてやり直してください」と言うことになる ── 名乗りが未設定・hook が止めた・競合が残っている、はどれも文章とは無関係な理由で、直したうえで**同じ文章のまま**押し直せる必要がある。応答が Workspace の切り替えで捨てられた場合も「通らなかった」側に倒す（`useGitRepository.ts`）。

入力欄は `<textarea>`（複数行）で、`Ctrl + Enter` でも Commit できる。Enter だけを割り当てないのは本文の改行と衝突するため。残り文字数は上限に近づいたときにだけ出す ── 常に出していると、要約1行を書くだけの場面でも数字が目に入る。

#### 応答の形は Stage / Unstage と共有する

「操作の後に必ず状態を読み直し、成功でも失敗でもその新しい状態を応答に載せる」という決めごとは、2つめの利用者ができた時点で `main/git/gitOperationResult.ts` へ寄せてある。2箇所に書くと、片方だけ直された日に「Commit のときだけ失敗すると古い一覧が残る」といった差が生まれる。

**読み直しが失敗しても、操作の結末は書き換えない。** Commit は通ったのに直後の読み取りだけが失敗した、という場合に「Commit に失敗した」と出すと、利用者は**同じ commit をもう1つ積む**ことになる。

### 14.13 Push / Pull / Commit & Push（Session 3-8-5）

Git パネルの③の後半にあたる。増えたチャンネルは3本（`git:push` / `git:pull` / `git:commit-and-push`）で、**そのうち2本は要求が `void`** になる。

#### ネットワークへ出る操作でこそ、渡せる欄を作らない

remote 名・ブランチ名・refspec は1つも渡せない。Renderer が言えるのは「今のブランチを送って」「取り込んで」だけで、相手を決めるのはリポジトリの設定になる。

```
git:push               要求は void
git:pull               要求は void
git:commit-and-push    要求は Commit と同じメッセージ1つだけ
```

名前で指せる形にすると、**画面に出ているブランチとは別のものへ送れる欄**になり、押した人から見て何が起きたのか分からなくなる。Stage で「渡せるのは値1つ」（§14.10）、Commit で「文章1つ」（§14.12）と絞ってきた線の、いちばん外側にあたる。

**Main の側でも名前を組み立てていない。** 使っているのは git 自身に解かせる記法だけになる。

| 使う記法                | 何を指すか                           |
| ----------------------- | ------------------------------------ |
| `@{upstream}`           | そのブランチの追跡先（設定が指す先） |
| `push.default=upstream` | 追跡先へ送る（2回目以降）            |
| `push.default=current`  | 今のブランチと同じ名前で作る（初回） |

ブランチ名を文字列として作らない限り、`-` で始まる名前も、空白や日本語を含む名前も、引数として解釈される経路そのものが無い ── pathspec で「値が値でしかない状態を作る」（§14.10）としたのと同じ形になる。

#### `push.default` を明示するのは、既定が条件付きだから

引数を省いた `git push` の相手は `push.default` で変わり、既定の `simple` は「upstream と**同じ名前**のときだけ送る」という条件が付く。手元の `feature` が `origin/main` を追っている設定では、`simple` は送らずに断る ── 追跡先があるのに Push だけできない、という形になる。

`upstream` に固定すると、送り先は常にそのブランチの追跡先そのものになり、**画面の `↑2` が指している差と、実際に送るものが一致する。**

初回（追跡先がまだ無い）だけ `current` + `--set-upstream` を使う。同じ1回の中で追跡先まで作るのは、**送れたのに次から送れない**を作らないため ── 追跡先が付かないまま送ると、画面の `↑ ↓` は次も出ないままになる。「初回だけ別のボタン」にもしない（どちらを押すかを利用者が先に判断することになる）。

#### `git pull` は使わない

Pull は `fetch` → `merge --ff-only` の2つに分けてある。

| 分ける理由                                                                                             |
| ------------------------------------------------------------------------------------------------------ |
| `pull` は `pull.rebase` の設定で merge にも rebase にもなる。**同じボタンが PC ごとに違う履歴を作る**  |
| 分ければ**どちらで失敗したか**が分かる。届かなかったのか、届いたが取り込めなかったのかで次の一手が違う |

**`--ff-only` に固定し、早送りできないときは取り込まずに断る。** merge commit を作るか rebase するかは履歴の形を決める判断で、リポジトリの流儀によって答えが違う ── アプリが黙って選ぶと、利用者が意図していない形の履歴が残り、後から直すのは難しい。断ったときに失われるものは無い（git は上書きせずに断る）。

`--prune` も付けていない。手元の remote-tracking ref を**消す**操作が混ざることになり、「取ってくる」ボタンが何かを消すのは押した人の予想から外れる。

#### 認証：待たせずに、持たない（設計判断 7）

アプリが呼ぶ git には端末が付いていないため、認証を尋ねられると待ち続ける。それを止める仕掛けが2つあり、**片方だけでは足りない。**

| 仕掛け                                 | 何を止めるか                                       |
| -------------------------------------- | -------------------------------------------------- |
| `GIT_TERMINAL_PROMPT=0`（§14.3）       | git 自身が**端末から**尋ねること                   |
| `credential.interactive=false`（新規） | credential helper が**自前のウィンドウ**を出すこと |

Windows の既定の helper（Git Credential Manager）は端末ではなくウィンドウを出すため、環境変数では止まらない。`credential.interactive=false` を渡すと helper は覚えている資格情報だけを答え、無ければ黙って諦める ── つまり Fluvix Nexus からの Push / Pull は必ず次のどちらかに落ちる。

```
覚えている   → そのまま通る（利用者は何もしなくてよい）
覚えていない → 即座に auth-required として返る（数分固まらない）
```

**Fluvix Nexus 自身は認証情報を持たない。** 尋ねればどこかへ持つことになり、保管の設計（暗号化・失効・複数ホスト）はアプリ1つ分の話で、しかも OS と Git が既に持っている仕組みと二重になる。案内するのは「Terminal パネルで一度 push / pull して credential helper に覚えさせる」で、その後はアプリからも通る。

#### 押す前に分かることは、ネットワークへ出る前に分ける

Commit で名乗りを先に確かめている（§14.12）のと同じ形だが、こちらの方が効く ── 相手のサーバー次第で数十秒待たされた末に、手元の理由で失敗するのを避けられる。

| 押す前に分かること   | どこで                         | 分類                   | Push | Pull |
| -------------------- | ------------------------------ | ---------------------- | ---- | ---- |
| ブランチの上に居ない | 読んだ状態（`head`）           | `not-on-branch`        | ○    | ○    |
| 追跡先が無い         | 読んだ状態（`upstream`）       | `no-upstream`          | ―    | ○    |
| 競合が残っている     | 読んだ状態（`conflicted`）     | `unresolved-conflicts` | ―    | ○    |
| 送る commit が無い   | 読んだ状態（`upstream.ahead`） | `nothing-to-do`        | ○    | ―    |
| commit が1つも無い   | `rev-parse --verify HEAD`      | `nothing-to-do`        | ○    | ―    |
| remote が1つも無い   | `git remote`                   | `no-remote`            | ○    | ―    |

Push で「追跡先が無い」を止めないのは、それが**初回の Push そのもの**だから。逆に Pull では止める ── どこから受け取るかが決まっておらず、アプリが remote を推測して選ぶと意図しない相手から取り込むことになる。

`ahead === null`（差が分からない）では止めない。分からないことを「無い」として扱わない（§14.8）。

#### 失敗の分類は、操作ごとに別の関数

同じ transport を通っても、**起こりうる結末の集合が違う。**

| 関数                      | 起こること                                    | 起こらないこと                   |
| ------------------------- | --------------------------------------------- | -------------------------------- |
| `classifyGitPushFailure`  | 断られた / 認証 / ネットワーク / 送り先が無い | ―                                |
| `classifyGitFetchFailure` | 認証 / ネットワーク / 送り先が無い            | **断られた**（相手は拒まない）   |
| `classifyGitMergeFailure` | 枝分かれ / 作業ツリー / 競合 / lock           | **ネットワーク**（もう通らない） |

順番にも意味がある。

- **認証をネットワークより先に見る。** 403 は `unable to access '<URL>': ...` に包まれて出るため、先にネットワーク側で当たると「回線を確認してください」という的外れな案内になる
- **`remote rejected` を `rejected` より先に見る。** 保護ブランチの拒否は「rejected」を含むが、次の一手は正反対にあたる

| 断られ方                     | 分類              | 次の一手                             |
| ---------------------------- | ----------------- | ------------------------------------ |
| non-fast-forward             | `push-rejected`   | **Pull**（隣のボタンにそのまま在る） |
| 保護ブランチ / `pre-receive` | `remote-rejected` | 何度 Pull しても送れない             |

`remote:` で始まる行はサーバーが書いた任意の文章にあたる。生の stderr を渡さない方針（§14.6）はそのままで、Renderer へ行くのは分類だけになる。

#### Commit & Push は1本の IPC

`git:commit` の後に `git:push` を呼ぶ形にはしていない。順番待ち（§14.11）は**1回の要求ごとに枠を取る**ため、その2回の間に別の操作が挟まりうる ── 挟まると「Commit したものを送った」と言えなくなる。1本にすれば、Commit・Push・状態の読み直しがまるごと1つの枠に入る。

```
1. 今の状態を読む       → ready か
2. Push の土台を見る    → ブランチの上に居るか / remote があるか（Commit しても変わらないもの）
3. Commit               → git:commit とまったく同じ手順（runGitCommitStep）
4. Push                 → 2 で読んだ状態から、初回かどうかを決める
5. もう一度読む         → 応答に載せる
```

2 を 3 より先に置いているのが要点になる。**通らないと分かっている Push のために commit を積まない。** 逆に「送るものがあるか」は見ない ── Commit すれば必ず1件増える。

#### 途中で止まったら `partly-applied`

Commit は通ったのに Push が通らなかった、は普通に起こる（認証・ネットワーク・remote 側の拒否）。これを `failed` に丸めない。

| 丸めると起こること                                                                                         |
| ---------------------------------------------------------------------------------------------------------- |
| 利用者は「Commit も失敗した」と読む → **同じ内容をもう一度 Commit する** → 履歴に同じ commit が2つ積まれる |

**Commit を取り消して失敗に揃えることもしない**（`reset --soft` は使わない）。Push が通らない理由のほとんどは手元と無関係で、そのたびに履歴を巻き戻すのは利用者が頼んでいない取り消しにあたる。しかも戻す操作そのものが失敗しうる。Commit はそのまま残し、Push だけを押し直せばよい。

Renderer 側では `partly-applied` を**「入力欄を空にしてよい」側**として扱う ── その文章は既に履歴に記録されているため、欄に残すと同じ内容をもう一度 Commit しかねない。出す1行は「Commit は完了しましたが、Push できませんでした。◯◯」と、**済んでいることを先に**伝える形にしてある。

#### 待ち時間の上限は3つになった

| 定数                     | 値   | 何のために                                       |
| ------------------------ | ---- | ------------------------------------------------ |
| `GIT_COMMAND_TIMEOUT_MS` | 10秒 | 即答するはずの読み取りが返ってこない場合の逃げ道 |
| `GIT_COMMIT_TIMEOUT_MS`  | 2分  | **利用者の hook が走る**（lint / テスト）        |
| `GIT_NETWORK_TIMEOUT_MS` | 2分  | **相手のサーバーを待つ**（fetch / push）         |

後ろの2つは同じ数字だが、理由が違うので別の定数にしてある（片方を変えたいときにもう片方まで動かない）。`merge --ff-only` はネットワークを使わないため Commit 側を使う ── `post-merge` hook が走りうる、つまり「利用者のプログラムが動く」方の理由にあたる。

上限そのものを外さないのは、**返ってこない相手が実在する**ため。順番待ちは1本なので、握られている間は Stage も Commit も動かない。

#### UI（Renderer）

Commit 欄の**下**へ積む。上から下へ「①何が変わったか → ②何と書くか → ③Commit / Commit & Push → 送る・受け取る」と読める並びのままで、DESIGN.md 設計判断 2（足すのは下へ）を動かしていない。

**Pull を Push の左に置く。** Push が断られたときの次の一手が Pull になるため、「先に Pull してください」と出たときに目が右から左へ戻らずに済む。

押せる条件は `gitChanges.ts`（純粋・テスト対象）が1箇所で決め、理由も一緒に返す。ただし **Commit と理由の置き場所が違う** ── Commit の一言は入力欄の下に出せるが、横に並ぶ小さなボタンには文章を置く場所が無いため、そちらは `title` と `aria-label` に渡している。

| ボタン        | 押せない条件                                                    |
| ------------- | --------------------------------------------------------------- |
| Push          | ブランチの上に居ない / 差が 0 / 他の Git 操作が動いている       |
| Pull          | ブランチの上に居ない / 追跡先が無い / 他の Git 操作が動いている |
| Commit & Push | Commit が押せない条件そのまま / ブランチの上に居ない            |

**Pull は `behind` の値では止めない。** それは前回 fetch した時点の写しでしかなく、0 で止めると新しい変更を取りに行く手段そのものを塞ぐことになる（Pull の半分は fetch にあたる）。

**Commit & Push は Commit の条件をそのまま引き継ぐ**（`toGitCommitReadiness` の結果を渡す）── 同じ条件を2箇所で組み立てると、片方だけ直された日に「Commit は押せないのに Commit & Push は押せる」が生まれる。

remote の有無・commit の有無は Renderer では見ない。押した結果として Main が答える ── こちらで先回りして真似ると、2箇所に規則が生まれる（§14.12 で「競合が残っているかは Renderer では見ない」としたのと同じ判断）。

#### 実物に対して固定してあること

`gitSyncRepository.test.ts` は remote を**同じ PC の bare リポジトリ**にしてある。git にとってそれは他の remote と変わらず、`push` / `fetch` / `merge --ff-only` は同じ経路を通る ── 変わるのは transport だけになる。回線が無くても、資格情報が1つも無くても、次を実物に対して固定できる。

- 初回の Push が追跡先まで作ること
- 追跡先と違う名前のブランチでも送れること（`push.default=upstream` が効いている）
- remote 側が先に進んでいるときに `push-rejected` になり、**remote が1文字も変わらない**こと
- 枝分かれでは取り込まず、**手元の HEAD が動かない**こと
- 作業ツリーの書きかけが上書きされないこと
- Commit & Push が途中で止まったとき、**commit が残ったまま** `partly-applied` になること
- Push できない土台（remote が無い / detached）では、**commit を積まずに**断ること

認証とネットワークの失敗だけはここでは作れない（相手が要る）。そちらは文言の分類として `gitFailure.test.ts` が固定してある。

### 14.14 ブランチの一覧 / 切り替え / 作成（Session 3-8-6）

ここまでの3つ（Stage / Commit / Push）は「①変更確認 → ②コミットメッセージ → ③Commit & Push」という**1本の流れ**の上に並んでいた。Session 3-8-6 が足したのはその流れの上ではなく、**その流れをどのブランチの上で行うか**にあたる。だから画面でも、下へ積むのではなく上のバーの中に置いてある（それまで文字だけだったブランチ名を、押せる場所にした）。

増えたチャンネルは3本で、**そのうち2本に初めてブランチ名が載る。**

```
git:list-branches    要求は void
git:switch-branch    要求は名前1つ
git:create-branch    要求は名前1つ
```

#### 名前を載せる／載せないの線は、動いていない

§14.13 では「remote 名もブランチ名も渡す欄を作らない」と決めた。ここで名前が載るのは、その線を緩めたからではない ── **指しているものが違う。**

| どちらの名前か              | 欄  | なぜ                                                                             |
| --------------------------- | --- | -------------------------------------------------------------------------------- |
| Push / Pull の**送り先**    | 無  | 設定が既に持っている。名前で指せると「画面に出ているものとは別のところへ送れる」 |
| 切り替え / 作成の**行き先** | 有  | **利用者が一覧から選んだ／打ったそのもの**で、他に指しようが無い                 |

載るのは名前だけで、git の `switch` が受け取れる他のものは欄そのものを作っていない。

| 作らない欄                      | なぜ                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `--force` / `--discard-changes` | 作業ツリーの書きかけを黙って捨てる                               |
| `--merge`                       | 書きかけを切り替え先へ持ち込み、**競合を作りうる**               |
| `--detach` / `--orphan`         | ブランチから降りる／履歴を持たない枝を作る。切り替えの口ではない |
| start point（どの commit から） | 「切り替え」と「別の場所から作る」が1つの口に混ざる              |
| 削除 / rename                   | 戻せない操作。確認の形と一緒に設計する（§14.15）                 |

#### 名前は「形」と「置き方」の両方で守る

ブランチ名は、このアプリで**初めて引数としてコマンドラインに載る外来の値**になる（Commit メッセージは標準入力、pathspec は `--` の後ろだった）。守り方は pathspec と同じ二重構えにしてある ── 片方が外れた日に破れる形にしない。

| どこで                     | 何を                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `shared/git/branchName.ts` | 名前の**形**（空白・制御文字・`~^:?*[]` ・`"<>                        | `・`..`・`@{`・先頭の `-`・`.lock` 終わり・`HEAD`） |
| `main/git/gitCommands.ts`  | 名前の**置き方**（必ず単独の引数として、`--end-of-options` の後ろへ） |

形の規則は **Renderer と Main が同じ関数を通す**（`commitMessage.ts` と同じ理由 ── 2箇所に書くと「ボタンは押せるのに Main が弾く」が生まれる）。git より厳しくしてあるのは、ref の実体が `.git/refs/heads/<name>` というファイルで、**Windows で作れない名前**を通すと「作れそうに見えて分類しにくい形で失敗する」ため。

逆に、**リポジトリの中身を見ないと決まらないこと**（同じ名前が既にあるか・大文字小文字だけが違う名前・`a` と `a/b` の衝突）はここでは見ない。答えるのは git で、結末は `branch-exists` として返る。

#### `git checkout` ではなく `git switch`

`checkout` は**1つのコマンドが2つの仕事**を持つ ── ブランチの切り替えと、ファイルの取り戻し（`git checkout <path>`）にあたる。どちらとして読むかは渡した名前が何に当たるかで決まるため、`main` という名前のファイルがある状態で `git checkout main` を動かすと、**切り替えたつもりで作業ツリーの書きかけが消える**ことが起こりうる。`switch` は pathspec を取らないので、その取り違えが起こる余地そのものが無い。

Unstage で `restore`（2.23 以降）を避けて `reset` を選んだ（§14.11）のとは逆の判断に見えるが、決め方は同じ「起こしてはいけないことから決める」になる ── **あちらは代わりの手段が同じくらい安全**だったのに対し、こちらは代わりの手段が上記の危うさを持つ。git 2.23 より古い環境ではブランチ操作だけが失敗として返る（パネルが黙って壊れることは無い）。

`--no-guess` を渡してあるのが、**「ローカルブランチだけ」を担保している引数**になる。既定の `git switch <name>` は、その名前のローカルブランチが無いと remote-tracking branch を探して**手元にブランチを作り、追跡先まで設定する** ── 一覧に出していないものが、名前を渡しただけで生えることになる。

作成は `switch --create` の**1回**で作って切り替える。2回（`branch` → `switch`）に分けると、1つめが通って2つめが通らなかったときに「作られたのに切り替わっていない」状態が残り、その後の Commit が意図しないブランチに積まれる。始点は常に HEAD なので、**detached HEAD からでも作れる**（Push が detached で断るのとは対照的に、こちらは塞がない ── そこから抜け出す手立てになる）。

なお `--create` だけは `--end-of-options` を使わない。名前が位置引数ではなく**オプション自身の引数**だからで、挟むと名前が始点として読まれて `invalid reference` になる（実際に確かめた）。オプションの引数は次の1つをそのまま取るため、`-x` のような名前でもオプションとしては読まれない（これも確かめた）。

#### 切り替えてよいかを決めるのは git（アプリは確認を挟まない）

「未保存の変更があります。切り替えますか？」は**出さない。** 出すと、アプリが「切り替えると失われる」と判断したことになるが、その判断は git 自身が持っている ── `--force` も `--merge` も渡していないので、失われるものがあるときは git が断る。

| アプリが重ねて尋ねると                                                                  |
| --------------------------------------------------------------------------------------- |
| **通るはずの切り替えを止める。** 切り替え先が触らないファイルの書きかけは、そのまま残る |
| **尋ねた後で git に断られる。** 押した人から見ると、アプリが二度手間を作っただけになる  |

Editor の未保存の中身（まだファイルになっていないもの）は、そもそも git から見えない ── 切り替えても消えず、タブに残ったままになる。失われるものがある操作に確認を挟む（§12.6）のは**こちらが消す側に回るとき**で、ここはそうではない。

切り替えた後、Files と Editor は**既存の追従の仕組み**（監視 → `files:changed`。§12.1 / §12.2）でそれぞれ追いつく。Git パネルからファイルの変化を配る、という逆向きの経路は作っていない。

#### 押す前に分かることは、git を動かす前に分ける

| 押す前に分かること           | どこで                     | 分類                   | 切り替え | 作成 |
| ---------------------------- | -------------------------- | ---------------------- | -------- | ---- |
| 今そこに居るブランチを選んだ | 読んだ状態（`head`）       | `nothing-to-do`        | ○        | ―    |
| 競合が残っている             | 読んだ状態（`conflicted`） | `unresolved-conflicts` | ○        | ―    |

**一覧では今のブランチも選べる**（印は付く）。選べなくすると、「今どこに居るか」を確かめるために開いた面で、いちばん見たい行だけが薄くなる ── 押しても git は動かず、`nothing-to-do` として返る。

作成の側に事前の判断が1つも無いのは、**手元の状態から分かる「作れない理由」が無い**ため（同じ名前があるかは git にしか分からず、detached HEAD でも書きかけがあっても作れる）。

#### 一覧は `git:get-repository` に相乗りさせない

変更ファイルの一覧は `ready` の中身として返している（§14.8）が、ブランチの一覧は別のチャンネルにしてある。分けている理由は**見られている時間の違い**になる。

```
変更ファイル … パネルが開いている間ずっと出ている
ブランチ     … 選ぶ面を開いた、その一瞬だけ
```

相乗りさせると、ファイルを保存するたび（`files:changed` からの読み直し）にブランチを数え直すことになる ── 誰も見ていない一覧のために git を1回多く起動し続ける形にあたる。

逆に、**開くたびに必ず取り直す**のはこちら側の決めごとになる。`.git` の監視（§14.15）が配るのは「状態が変わった」という合図までで、ブランチの一覧はそこにも相乗りさせていない ── 覚えておいた一覧を出すと「さっき作ったブランチが無い」が起きる。

一覧そのものは `for-each-ref` で読む（`git branch` は**人向け**の出力で、印と字下げが混ざり、detached HEAD では「ブランチではない行」まで並ぶ）。`refs/heads/` に絞ってあるので remote-tracking branch も tag も混ざらず、区切りは `%00`（`%(HEAD)` 自身が空白を出すため、空白では区切りと値の区別が消える）。

**上限は 500 件で、git 自身に掛ける**（`--count`）。数千行を受け取ってから捨てる形にしないためで、上限より1つ多く求めることで「切ったかどうか」も同じ1回で分かる。切ったときは**黙って捨てず**、面の中でそう伝える ── 出ていないものがあることを言わずに済ませると、利用者は「消えた」と読む。

#### 待ち時間の上限は4つになった

| 定数                      | 値   | 何のために                                             |
| ------------------------- | ---- | ------------------------------------------------------ |
| `GIT_COMMAND_TIMEOUT_MS`  | 10秒 | 即答するはずの読み取りが返ってこない場合の逃げ道       |
| `GIT_COMMIT_TIMEOUT_MS`   | 2分  | **利用者の hook が走る**（lint / テスト）              |
| `GIT_NETWORK_TIMEOUT_MS`  | 2分  | **相手のサーバーを待つ**（fetch / push）               |
| `GIT_CHECKOUT_TIMEOUT_MS` | 2分  | **作業ツリーを実際に書き換える**（＋ `post-checkout`） |

4つめを別に立てたのは、他の3つと理由が違うため ── 切り替えではファイル数・ウイルス対策ソフト・ネットワークドライブのどれもが効いてきて、10 秒では大きなリポジトリで必ず時間切れになる。しかも時間切れは**途中まで書き換えた作業ツリー**を残す（プロセスを殺すため）ので、他のどの操作の時間切れよりも直しにくい。ブランチの**一覧**はこれを使わない（即答する読み取りなので既定のまま）。

#### UI（Renderer）

開く器は `ui/Popover`（閉じ方が3つ＋ウィンドウが焦点を失ったとき）で、`ui/DropdownMenu` は使わない ── 面の中に**入力欄**（新しいブランチ名）が入るため、役割は `menu` ではなく `dialog` にあたる（Terminal の設定 UI と同じ形）。

一覧と作成を**1つの面**に置いてあるのは、「切り替える」と「作って切り替える」が利用者から見て同じ場面で選ぶことだから ── 行き先が既にあるかどうかは、一覧を見て初めて決まる。別の面に分けると、開いて「無かった」と分かってから閉じて別のところを押し直すことになる。

| 押せる条件（`gitBranches.ts` が1箇所で決める） |                                                             |
| ---------------------------------------------- | ----------------------------------------------------------- |
| 一覧の行                                       | 他の Git 操作が動いていなければ押せる（**今のブランチも**） |
| 作成                                           | 名前の形が通り、かつ他の Git 操作が動いていない             |

理由の置き場所は Commit 欄と同じ「欄の下の1行」にしてある（Push / Pull のように hover へ逃がさない）── 打っている最中の人が、指を止めずに読めるため。**通ったときだけ**入力欄を空にして面を閉じるのも Commit 欄と同じ判断で、失敗のときに消すと、打った名前が失われたうえで「もう一度」と言うことになる。

#### 実物に対して固定してあること

`gitBranchRepository.test.ts` は本物の git に対して次を確かめる（remote が要る回だけ、同じ PC の bare リポジトリを相手にする）。

- 書きかけが**上書きされない**こと（git が断り、ファイルも HEAD も動かない）
- 切り替え先が触らないファイルの書きかけ・未追跡のファイルは、**切り替えても残る**こと
- 同じ名前で作ろうとしても**既存のブランチが1文字も動かない**こと
- remote-tracking branch の名前では**手元にブランチが増えない**こと（`--no-guess`）
- 今のブランチを選んでも git を動かさないこと（`nothing-to-do`）
- detached HEAD からでも作れて、ブランチへ戻れること
- 一覧が上限で切られ、切られたことが分かること（ref は `update-ref --stdin` で一度に作る）

### 14.15 `.git` を見張る（Session 3-8-8）

3-8-7 までの Git は「呼ばれたときだけ調べる」で通していた。その前提が崩れるのは外部の端末ではなく、**このアプリの中**にあたる ── 内蔵 Terminal（§13）で `git add` と打った利用者にとって、隣のパネルが古いままなのは「同じアプリなのに伝わっていない」という形で見える。

```
fs.watch（.git 1つ・再帰）
   ↓  .git からの相対位置
main/git/gitWatchPaths.ts     許可した名前だけを通す（`.lock` と `objects/` は捨てる）
   ↓
main/git/gitChangeSchedule.ts いつ配るかを決める（束ねる・遅れすぎない・暴れない）
   ↓
emitIpcEvent('git:changed', { workspaceId })              ← §3.3 の既存の経路
   ↓
useGitRepository が `files:changed` と同じタイマーへ合流させ、`git:get-repository` を1回
```

#### `files:changed` に混ぜず、Git 専用の watcher を1本足す

理由は3つある。

1. **見る場所が逆。** `files:changed` は `.git` を**除外することで**成り立っている（§12.1）。同じ経路に載せるにはその除外に穴を開けることになり、Files のツリーと Editor が `.git` の中の位置を受け取り始める
2. **運ぶものが違う。** `files:changed` が運ぶのは「どの位置がどうなったか」（`WorkspaceFileChange`）で、`.git/index` が書き換わったことに当てはまる相対位置は存在しない
3. **桁が違う。** 1回の `git commit` で `.git` の中には数百件の書き込みが起き、その大半は `objects/`。同じ束に入れると、Files 側の上限（1束 500 件）をこの watcher が食い潰す

#### 運ぶのは `workspaceId` だけ

**何が変わったかは載せない。** `.git` の中の位置は Renderer にとって意味を持たず、意味に翻訳できるのは git 自身だけになる。受け手がすることは常に1つ（`git:get-repository` を呼び直す）で、**ブランチ名と変更ファイルの一覧はその1回の応答に揃って載る**（§14.4 で読み取りのチャンネルを1本に留めた形が、そのままここで効いている）。半分だけ新しい画面 ── ブランチ名は新しいのに一覧は前のブランチのもの ── を作らない形が、このイベントを「合図1つ」に留める理由でもある。

#### 拾う名前を数え上げる（許可制）

`.git` の中は1回の操作で数百から数万の書き込みが起きる。「ノイズを列挙して外す」形にすると、知らない名前が増えるたびに漏れ、その1つが `git status` の連射に化ける。そこで**拾う側を数え上げてある**（`gitWatchPaths.ts`。純粋・テスト対象）。

| 拾う                                                                     | 何が変わったか                      |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `HEAD`                                                                   | どのブランチの上に居るか            |
| `index`                                                                  | ステージの中身                      |
| `packed-refs` / `config`                                                 | まとめられた ref / 追跡先などの設定 |
| `MERGE_HEAD` `CHERRY_PICK_HEAD` `REVERT_HEAD` `REBASE_HEAD` `BISECT_LOG` | 途中で止まっている操作              |
| `refs/**` `rebase-merge/**` `rebase-apply/**` `sequencer/**`             | ref と、続きのある操作の状態        |

捨てるものにも理由がある。

- **`.lock` は必ず先に捨てる。** git はどの書き込みでも「`x.lock` を作る → 書く → `x` へ rename する」を通る。ロック側を拾うと1回の書き込みが2回の変化として届き、しかも**まだ何も変わっていない時点**で読みに行くことになる（本体は必ず別のイベントとして届くので、捨てて落ちるものは無い）
- **`objects/**` は桁が違う。** 通すと、1回の commit / fetch で束ねの上限に張り付いたまま `git status` が回り続ける
- **`logs/**`（reflog）は二重。** `HEAD` / `refs/` と必ず一緒に動く
- **`ORIG_HEAD` / `FETCH_HEAD` / `COMMIT_EDITMSG` も二重。** 状態が変わった瞬間に一緒に書かれるが、それ自体は状態ではない
- **知らない名前は捨てる。** 捨てて困るのは「その変化に気づくのが手動更新まで遅れる」ことだけで、それは 3-8-7 までと同じにしかならない

#### 3つの線で挟んで配る

`gitChangeSchedule.ts`（純粋・テスト対象）が持つのは時刻の計算1つだけになる。

| 線                       | 値    | 無いとどうなるか                                      |
| ------------------------ | ----- | ----------------------------------------------------- |
| 静まるまで待つ           | 250ms | 1回の commit で `git status` が何度も走る             |
| 最初の変化からの上限     | 1s    | `git checkout` の間じゅう配られず、画面だけが前のまま |
| 前に配ってからの最小間隔 | 500ms | `git fetch` の最中に1秒ごとの連射になる               |

上限より**最小間隔を優先する** ── 上限は「遅れないため」の線、間隔は「暴れないため」の線で、押し寄せている最中に遅れを取り戻しても出てくるのは同じ連射でしかない。Renderer 側でさらに 0.4 秒束ねる（§14.5）ため、利用者から見た遅れは最大で 0.65 秒になる。

#### 読み取りが自分を呼び戻さないこと

`.git/index` を見張るということは、**アプリ自身の `git status` が index を書き換えたらそこで無限に回る**ということでもある。回らないのは、読み取りに `--no-optional-locks` と `GIT_OPTIONAL_LOCKS=0` を掛けてあるためになる（§14.8 / §14.3）。この2つは 3-8-2 から「利用者自身の git を邪魔しない」ために置いてあったもので、Session 3-8-8 で**監視が成立する前提**という意味が1つ増えた。

#### `.git` がまだ無い Workspace

`git init` するまで見張る先が無い。そこだけ **Workspace root を浅く**（再帰なし）見張り、`.git` が現れたら本来の監視へ切り替える。root を再帰で見張らないのは、それが `files:changed` の担当そのものだから ── 同じ木を2本の再帰監視で見張ると、Windows の ReadDirectoryChangesW のバッファを二重に使うことになる。浅い監視で拾うのも `.git` ただ1つで、それ以外の変化は捨てる（Git ではないフォルダで保存するたびに git を起動しない）。

#### 決めていること

- **Workspace の切り替えでは、前の watcher を必ず閉じてから次を張る**（`files:changed` の watcher と同じ形）。閉じ忘れると、前の Workspace の `.git` の変化が新しい `workspaceId` で配られる。束ねている最中に切り替わった分も配らない ── 受け手も `workspaceId` を突き合わせて捨てるが、切り替わった後の通知をそもそも作らない方が素直（§9.6）
- **監視が落ちたら、1度は張り直す。** `.git` がフォルダごと消えれば `workspace-root` の浅い監視へ落ち、次の `git init` を待てる。ただし**張り直しては落ちるを繰り返さない**よう、回数に上限（5）を置く
- **張れなくてもアプリを止めない。** 再帰監視が使えない OS・権限が無い・ネットワークドライブ ── どれも「自動で気づけなくなる」だけで、更新ボタンと、操作の応答に載る状態は従来どおり効く（§14.5）
- **ブランチの一覧は相乗りさせない。** 見られているのは面が開いている一瞬だけで、相乗りさせると `.git` が動くたびにブランチを数え直すことになる（§14.14）

### 14.16 差分の表示と破棄（Session 3-8-9）

3-8-1 〜 3-8-8 で置いたのは「今どうなっているか」と「それをどう進めるか」だった。3-8-9 で足すのは、その一覧の**中身**に手が届くようになること ── 1行の変更を**見る**（差分）と、1行の変更を**やめる**（破棄）の2つになる。

この2つは同じ行の上に並ぶが、性質は正反対にあたる。**片方は何も変えず、もう片方は Git 機能で唯一、利用者の書いたものを消す。**

#### patch を渡さず、中身2つを渡す

`git diff` の出力（unified diff）を Renderer へ渡す形にはしない。渡すのは「左に出す中身」と「右に出す中身」の2つの文字列だけになる（`shared/git/diff.ts`）。

- **生の git の出力を渡さない**という 3-8-1 の線に触れる。patch にはヘッダ（`diff --git a/... b/...`）もモードもスコアも index 行も、git の記法がそのまま載る
- 渡した先で**もう一度解析が要る。** Monaco の Diff Editor が受け取るのは2つの中身であって patch ではない ── patch を渡すと、Renderer 側に「patch を当てて元の中身を復元する」という2つ目の実装が生まれる
- patch は**差分アルゴリズムの結果**で、`diff.algorithm` / `diff.context` / `textconv` などリポジトリの設定で形が変わる。中身2つを渡せば、どう並べて見せるかは Monaco が一貫して決める

#### 何と何を比べるかは、押した行が決める

同じファイルが2つのグループに並ぶことがある（`git add` した後にもう一度書き換えた状態。§14.8）。だから要求に載るのは位置1つと**グループ1つ**で、位置だけでは「どちらの行を押したのか」が決まらない。

| グループ  | 左（変更の前）        | 右（変更の後）   |
| --------- | --------------------- | ---------------- |
| staged    | HEAD の中身           | index の中身     |
| unstaged  | index の中身          | 作業ツリーの中身 |
| untracked | 空（まだ Git に無い） | 作業ツリーの中身 |

種類による例外が3つと、リポジトリの状態による例外が1つある。

- 追加（staged の `added`）… 左は空（HEAD に相手が居ない）
- 削除 … 右は空（相手が居ない）。**行そのものは Editor で開けないが、差分は出す** ── むしろ開けない行でこそ、何が消えたのかを確かめたい
- rename / copy … 左は **`originalPath`** の HEAD の中身。変更後の位置で訊くと HEAD に見つからず、「全部が追加された」差分になる
- **初回 commit 前**（HEAD がまだ無い）… staged の左は常に空。ここを失敗に倒すと、`git init` した直後のリポジトリで差分が1件も出せない

競合（`conflicted`）は対象外にしてある。「前」と「後」が2組（ours / theirs）あり、**2つの中身を並べる形そのものが当てはまらない**（Stage / Unstage を置いていないのと同じ理由。§14.8）。

#### 位置は最後まで pathspec のまま、object 名は git が作ったものだけ

`git show HEAD:<path>` / `git cat-file blob :<path>` のような**組み合わせた1つの引数**は作らない。作ると、Renderer から来た位置が `:` や `^` を含む revision 表記の一部として読まれる余地が生まれ、3-8-3 で「値が値でしかない状態」にしたところ（§14.10）が崩れる。

代わりに2段にしてある。

1. 位置を **pathspec のまま**渡して（`--` の後ろ + `--literal-pathspecs`）、git に object 名を答えさせる（`ls-files --stage` / `ls-tree -r`）
2. その object 名で大きさと中身を取りに行く（`cat-file -s` / `cat-file blob`）

2段目の引数に載るのは **git 自身が作った 40 〜 64 桁の16進**だけで、外から来た値は1文字も入らない。引数に載る直前で `isGitObjectName` をもう一度通してあるのも、3-8-3 で pathspec に二重の備えを置いたのと同じ形になる（`main/git/gitBlob.ts`）。

往復が1回増えるが、差分は「1行を選んだ一瞬」にしか走らないため、その代償は一覧の側には出ない。

**`--textconv` / `--filters` / `--ext-diff` は付けない。** どれもリポジトリの設定に書かれた任意のプログラムを起動する指定で、差分のために `.gitattributes` の中の実行ファイルが走る形にはしない。

#### 出せないものは、失敗ではなく理由として返す

バイナリ・2MB 超・見つからない。どれも `IpcResult` の失敗にしない（§14.7 と同じ線）── 利用者の次の一手が理由ごとに違い、「表示できません」に丸めると出せなくなる。

**大きさの上限は Editor で開ける上限と同じ値**（`FILES_FILE_MAX_BYTES`）にしてある。差分の側だけが大きいものを開けると、「Git パネルからは見えるのに、Editor では開けない」が起きる ── そのファイルを直しに行く先が無い。

作業ツリー側の読み取りは **files ドメインの `readWorkspaceFile` をそのまま通る。** Workspace の境界の確認・symlink の追跡・大きさの上限・バイナリの判定・BOM の扱いが、Editor でそのファイルを開いたときとまったく同じになる。

#### 改行は LF に均す

Windows の git は checkout のときに改行を CRLF へ直す（`core.autocrlf`）。index の中身（LF）と作業ツリーの中身（CRLF）をそのまま並べると、**1行も書き換えていないファイルが全行変更として出る。**

git 自身は正規化した後の中身で「変わったかどうか」を決めているので、一覧に出ている「変わっている」と揃えるにはこちらも均した中身で見せる必要がある。代わりに**改行だけの違いは差分として出ない** ── その1点は失うが、全行が真っ赤になるより実態に近い。

#### 差分は Editor のタブにしない

読み取り専用のオーバーレイとして、Git パネルの一覧の**上に重ねる**（`renderer/src/git/GitDiffOverlay.tsx`）。

- **タブは「編集して保存するもの」の置き場所**になっている。読み取り専用のものが同じ列に混ざると、閉じるときの確認（§12.6）も未保存の印も「このタブには当てはまらない」という例外を1つずつ持つ
- **Auto Save の相手が増える。** 保存が触るのは documentStore が持つ Model だけで（§11.7）、差分の Model はそこに登録されない ── タブにすると、その線を「タブなのに登録されないもの」として跨ぐ
- 差分は**一覧の隣で見るもの**にあたる。行を押す → 見る → 隣の行を押す、という往復がパネルを跨がずに済む

面ごと差し替えず重ねているのは、差し替えると閉じたときにどこを見ていたか（スクロール位置・開いていたグループ）が失われるため。重なる基準は Git パネルの器なので、隣のパネルの上には出ない。

**部品は Conflict の Compare と同じもの**（`editor/monaco/MonacoDiffEditor.tsx`）を使う。3-8-9 でその部品から用途の名残（`diskContent` / `editorContent`）を外し、受け取るのを `original` / `modified` の2つだけにしてある ── 何を左に出しているかを言葉にするのは呼ぶ側の仕事で、器の中に用途ごとの分岐を持たせると3つ目の呼び出し元で必ず増える。高さも呼ぶ側が決める（Conflict は固定、Git は面の残り全部）。

#### 破棄は、グループごとに行うことがまるごと違う

| グループ  | 何をするか                                     | 戻せるか         |
| --------- | ---------------------------------------------- | ---------------- |
| unstaged  | `git restore --worktree`（index は動かさない） | 戻せない         |
| untracked | OS のごみ箱へ送る（files ドメイン）            | ごみ箱から戻せる |

**`git clean` は使わない。** `.gitignore` の対象まで巻き込みうるうえ、**ごみ箱を経由しない。** まだ一度も Git に入っていないファイルは、消してしまうと**どこにも写しが無い** ── Files パネルの削除がごみ箱へ送っている（完全削除の経路を持たない。§10.2）のに、Git パネルの破棄だけが取り返しのつかない消し方をするのは筋が通らない。消す経路そのものが `deleteWorkspaceEntry` を通るので、境界の確認も名前の判断も失敗の分類も Files から消したときと同じになる。

**`reset --hard` も使わない。** あれは指した1件ではなく作業ツリー全体を戻す。

`git restore` に `--staged` を渡さないので、この1回で起きるのは「作業ツリーが index の中身になる」だけ ── **index は1バイトも動かない。** `git checkout --` ではなく `git restore` なのは、`checkout` が同じ書き方で「ブランチを切り替える」にもなるため（§14.14 で `switch` を選んだのと同じ理由）。消える側の操作でこそ、コマンド名で意味が1つに決まる方を選ぶ。

#### 破棄に渡せないもの

- **`staged`。** 「ステージ済みの変更を破棄」は実際には2つの操作（index を戻す ＋ 作業ツリーを戻す）で、押した人から見て失われるものが1回で2段になる。**先に Unstage してもらう** ── そうすれば「index を戻した」と「作業ツリーを戻した」が別々の1回として画面に出る
- **`conflicted`。** 何に戻すのかが ours / theirs / merge base の3つに分かれる
- **グループの「すべて」。** Stage には「変更のすべて」があるが、破棄には置いていない ── Stage の押し間違いは Unstage で戻せるが、こちらは戻せる先が無い
- **未追跡のフォルダ1件。** 一覧では `node_modules/` のように1行にまとまる（§14.8）。通すと、押した人から見て1行だったものが数万件の削除になる。行にボタンを出さないだけでなく、**Main も届いた対象を確かめて断る**

#### 動かす前に、対象が今もそのグループに居るか確かめる

Stage / Unstage と同じく、**Renderer が抱えていた一覧は信じない**（§14.11）。押すまでの間に端末で `git add` されていれば、その行はもう「変更」ではない ── 古い一覧のまま走らせると、ステージ済みの内容を作業ツリーごと巻き添えにする。差分の側でも同じ確認を通り、そちらでは「もう存在しない組み合わせの差分」を作らないために効く。

#### 未保存の Editor タブがあるファイルは破棄させない

判断は **Renderer が持つ。** Main は「どのファイルが開かれているか」を持たず、その一覧を IPC で配ると、Git の操作のためだけに Editor の状態を Main が持つことになる。押せる場所の側で止める方が層が増えない。

「保存してから破棄」にはしない ── **書きかけをディスクへ書いてから消す**ことになり、何も救われない。黙って破棄するのも駄目で、Editor 側は未保存のまま残り、次に保存した瞬間に破棄したはずの中身が書き戻る。止めたうえで次の一手（保存する / タブを閉じる）を出す。

確認の面では、その場合**押せるボタンそのものを出さない。** disabled のボタンを添えないのは、押せない理由が「今は忙しい」ではなく「先に別のことをする必要がある」だから ── 待っても押せるようにはならない（一覧の競合の行に操作を置いていないのと同じ判断。§14.11）。

#### 確認を挟むのは、Git ではこの1つだけ

Stage / Unstage も Commit も Push も、押しても失われるものが無い（あるいは失われるなら git が断る）。確認は**押した人にしか止められないもの**に限ってある（§12.6）。

文言はグループで割れる ── 未追跡は「ごみ箱に移動します／ごみ箱から元に戻せます」、変更は「ステージ済みの内容に戻します／この変更は元に戻せません」。**同じ文言で済ませると、片方に必ず嘘をつく。** 未追跡で「元に戻せません」と出すのは要らない怖さを作り、変更で「戻せます」と出すのは取り返しのつかない誤りにあたる。

器は Files の削除確認と同じ形（初期 focus はキャンセル、Esc と背景で閉じる）だが、**クラスは共有していない** ── 共有するのは描き方であって置き場所ではない（`GitIcons.tsx` と同じ判断）。

#### 目印は Stage / Unstage と同じ

破棄の「処理中」の鍵は、その行の Stage / Unstage とまったく同じ `path:<位置>` にしてある（`renderer/src/git/gitChanges.ts`）。分けると「破棄している最中に、その同じ行を Stage できる」形になり、走る git 2本がどちらの順で当たるかで結果が変わる。

#### 破棄した後は、既存の追従に載る

応答に**破棄した後の状態が丸ごと載る**のは他の書き込み操作と同じ（`finishGitOperation`）。作業ツリーの側は監視（`files:changed`）が拾い、`.git` が動いていれば `git:changed` も届く ── **どちらも 3-8-2 / 3-8-8 で置いたものがそのまま効く**ので、破棄のための配り方は1つも足していない（ブランチの切り替えで Files と Editor が追いつくのと同じ形。§14.14）。

#### 待ち時間の上限

差分も破棄も既定の `GIT_COMMAND_TIMEOUT_MS`（10 秒）を使う。ネットワークにも hook にも触れず、`checkout` のように作業ツリーを丸ごと入れ替えることもないため、3-8-5 / 3-8-6 で足した長い上限は要らない。

### 14.17 `git init` と GitHub への公開（Session 3-8-10）

DESIGN.md §3 は「初回のみ『GitHub に公開』ボタンから、Git 初期化 → 初回 Commit → GitHub リポジトリ作成 → remote 設定 → Push までを案内・自動化する」と書いている。3-8-10 で実装したのはその5つのうち**初期化**と**後ろの3つ**で、しかも**一続きの1本にはしていない。**

```
git:init            まだリポジトリではない → リポジトリにする（それだけで終わる）
（初回 Commit）     アプリは作らない。利用者が普段どおり Commit 欄から積む
github:publish      repository を作る → origin を設定する → 初回 Push
```

#### 一続きにしないことが、この節の設計そのもの

3-8-1 で初期化を見送った理由は「途中まで自動でやって止まると、利用者が自分で片付けられない中途半端なリポジトリが残る」だった。3-8-10 の答えは**その5つを1本にする**ではなく、**1本にしない**の側になる。

- **`git init` はそれだけで終わる。** 初回 Commit も `.gitignore` も remote も作らない。押した後に公開を促しもしない ── Git は GitHub のためだけのものではなく、初期化した時点で Commit / Branch / Diff / Stage / 破棄はすべて使えるようになる（そこが終点の人が居る）
- **初回 Commit を自動化しない。** 最初の commit に何を含めるかは利用者の判断で、`.gitignore` を書く前に全部入りの commit が履歴の1つめとして永久に残るのは後から直しにくい。`user.name` をアプリが決めない（§14.12）のと同じ判断になる
- **`.gitignore` を生成しない。** 何を無視するかは言語もツールも人も選ぶ話で、アプリが「とりあえずの1つ」を置くと、それが正本のように残る

残った3つ（作る → remote → Push）だけは1本にしてある。**その3つは、途中で止まると利用者が直しにくい**（GitHub に repository があるのに手元は何も知らない状態が残る）ためで、Commit & Push を1本にしたのと同じ判断になる（§14.13）。

#### 途中経過を覚えず、実状態から毎回組み立て直す

公開が途中で止まることは普通に起こる（認証・ネットワーク）。そこで「どこまで進んだか」をアプリが覚える形にすると、覚えたものと実際が食い違ったときに**食い違ったまま次が走る** ── 端末で `git remote add` した・GitHub 側で repository を消した、はどちらも起こる。

押されるたびに読み直すのは Git の実状態2つだけになる。

| 読むもの                    | 分かること             | 飛ばすもの          |
| --------------------------- | ---------------------- | ------------------- |
| `hasRemote`（§14.4 の状態） | remote が既にあるか    | 作成と `remote add` |
| `rev-parse --verify HEAD`   | commit が1つでもあるか | （無ければ断る）    |

つまり **repository は作られたが Push が通らなかった**という状態から、同じボタンをもう一度押せば Push だけが走る。永続化するものは1つも無い。

#### `hasRemote` を `ready` に載せた

remote があるかどうかは、Git パネルが開いている間ずっと**画面を決めている**（remote が無ければ公開の入口を出し、あれば Push / Pull だけを出す）。別の問い合わせに分けると一覧やブランチ名と別の瞬間の写しになり、「公開の入口と Push が同時に出ている」画面がありうる ── ブランチの一覧を `ready` に入れなかった（§14.14）のとは逆向きの、しかし同じ基準（見られている時間）による判断になる。

**名前も URL も載せない。** 載るのは有無だけで、remote を名前で指せる操作は1つも無い（§14.13）。代償として状態を読むたびに `git remote` が1回増えるが、その1回は Push が押される前に払っていたもの（`listRemotes`）をそのまま前へ移しただけで、合計は増えていない。

#### repository を作る相手を、差し替えられる境界にする

公開の3つのうち**外の世界に触れるのは最初の1つだけ**で、残りは手元の git になる。その1つを `GitHubRepositoryPublisher`（`main/github/githubRepositoryPublisher.ts`）として切り出してある。

```
publishRepository.ts  ── 噛み合わせ（読む → 確かめる → 作る → remote → Push → 読み直す）
   └── GitHubRepositoryPublisher   checkAvailability() / createRepository()
        └── ghRepositoryPublisher  GitHub CLI を動かす実装（今のところ唯一）
```

境界にしてあることで3つが同時に成り立つ。

- **GitHub CLI が唯一の道ではなくなる。** OAuth を自前で持つ・GitHub の API を直接叩く・別のサービスを相手にする、のどれになっても入れ替わるのはこの実装1つで、git 側の手順は1行も変わらない
- **公開の流れをネットワーク無しで確かめられる。** テストは「作った」と言って同じ PC の bare リポジトリを返す実装に差し替える ── remote の設定と初回 Push は本物の git が動くので、順序・再開・`partly-applied` が実物に対して固定できる（`publishRepository.test.ts`）
- **gh の都合が噛み合わせに染み出さない。** 引数・出力の読み方・失敗の文言はすべて実装の内側で、外から見えるのは「作れた / 作れなかった（分類つき）」だけになる

差し替える口（`setGitHubRepositoryPublisher`）は Main の中にしか無い。**Renderer から実装を指す欄はどこにも無い** ── あれば「どのプログラムに公開させるか」を外から選べる欄になる。

#### なぜ GitHub CLI なのか（設計判断 7 の続き）

repository を作るには GitHub の資格情報が要る。自前で OAuth を持つと**アプリが token を保管する**ことになり、暗号化・失効・複数アカウントの設計がアプリ1つ分増える ── しかも利用者の PC には同じものを持った道具が既にあることが多い。3-8-5 で git の資格情報を持たないと決めたのとまったく同じ理由になる。

代償は「gh が入っていなければ公開できない」ことで、**アプリが勝手に入れることはしない。** 出すのは案内と、利用者が自分で打てる1行（`winget install --id GitHub.cli`）だけになる。実行ファイルの解決を覚えていないため（`githubExecutable.ts`）、入れた直後にもう一度押せばそのまま通る。

#### `github:*` を新しいドメインとして切る

ここまでの `git:*` が相手にしていたのは PC の中のフォルダ1つだけで、公開は初めて外へ出る ── 実行ファイルも認証も別のものになる。同じドメインに混ぜると次の2つが起きる。

- **git ドメインの前提が変わる。** 「git が入っていれば使える」だったものに gh のログイン状態が混ざり、GitHub を使わない人の Commit / Branch / Diff にまで別の失敗が現れうる
- **差し替えの単位が消える。** 相手が GitHub 以外になったとき、チャンネル1本と実装1つで済む形が保てない

```
Renderer      github:get-status（要求は void）
              github:publish（要求は名前1つ + 公開範囲）
   ↓
Main handler  handlers/github.ts    名前は shared の同じ関数を通す／公開範囲は閉じた集合
   ↓
Main domain   github/publishRepository.ts   噛み合わせ（gitQueue の枠の中で動く）
   ├── github/githubRepositoryPublisher.ts  差し替え可能な境界
   ├── github/ghRepositoryPublisher.ts      gh を動かす実装
   ├── github/githubCommands.ts             gh の引数の表（組み立てられる唯一の場所）
   ├── github/runGitHubCli.ts               gh を実行する唯一の場所（cwd は現在の Workspace）
   ├── github/githubExecutable.ts           gh 本体を PATH から辿る（§14.1 と同じ規則）
   ├── github/githubEnvironment.ts          gh へ渡す環境変数（git 用の表を土台にする）
   ├── github/githubOutput.ts               作られた repository の URL の読み取り（純粋）
   └── github/githubFailure.ts              gh の stderr の分類（純粋）
```

**渡せる欄は2つだけ。** repository 名（`shared/github/repositoryName.ts` を通った形）と公開範囲（`private` / `public`）で、gh のコマンド名も引数も作業ディレクトリも要求に欄そのものが無い ── `gh` は `--template` / `gh alias` / `GH_*` で任意の振る舞いを持ちうるため、「gh の引数を渡せる API」は git のとき（§14.2）と同じく**実質「任意のコマンドを実行できる API」**になる。

**remote の URL は Renderer へ渡らない。** gh が出した URL は Main の中だけで `git remote add origin` の引数になる。リポジトリ root の絶対パスを渡していない（§14.4）のと同じ線で、名前は利用者が自分で打ったものが画面にそのまま在る。

#### 名前は「形」で守る

repository 名は `gh repo create <name>` の**位置引数**になる。ブランチ名では `--end-of-options` の後ろに置く（§14.14）という置き方の備えがあったが、gh の側にはそれが版をまたいで確かとは言えない ── そこで**形の方を、記号が1つも通らないところまで狭めてある**（英数字と `-` `_` `.` だけ、先頭の `-` / `.` も弾く）。オプションとして読まれうる文字列そのものが作れない。

GitHub 自身はもう少し寛容（日本語の名前も作れる）だが、**作れたのに URL では別の文字列になる**名前を、初めて公開する人の最初の1回に勧める理由が無い。名前は後から GitHub 側で変えられる。

規則を置く場所は shared で、Renderer は入力中に、Main は受け取った後に**同じ関数**を通す（Commit メッセージ・ブランチ名と同じ分担。§14.12）。

#### GitHub 側に何も生成させない

`gh repo create` に `--add-readme` / `--gitignore` / `--license` / `--template` を渡していない。README を1つ作らせるだけで**手元が持たない commit が remote に載り**、その直後の初回 Push が必ず non-fast-forward で断られる（§14.13 の `push-rejected`）── 公開の1回目でいちばん起こしてはいけない結末にあたる。

`--source` / `--push` / `--remote` も渡さない。渡すと **gh が自分で `git` を探して起動する**ことになり、どの git が動くかを Main が決められなくなる（§14.1 の線の外側へ出る）。往復は1回増えるが、git を動かすのは常にこちらの表からにする。

#### 初回 Push だけ、credential helper の対話を許す

3-8-5 で `credential.interactive=false` を必ず付けると決めた（§14.13）のは、**利用者が頼んでいない場面**でアプリの裏に認証ウィンドウが出て、見つけられないまま数分固まるのを避けるためだった。

公開の初回 Push はそこが違う ── 押した人は今まさに「GitHub に公開する」と言ったところで、**認証を求められることを予期できる唯一の場面**になる。ここで helper を黙らせると、GitHub CLI でログインを済ませた人が初回 Push だけ `auth-required` で断られ、「Terminal で1度 push してください」と案内されることになる（アプリの中で完結すると言った手順が、最後の1歩だけ外に出る）。

**外すのはこの1回だけ**で、以降の Push / Pull は従来どおり対話を止めたまま動く。`GIT_TERMINAL_PROMPT=0`（§14.3）も外していない ── 端末の付いていない子プロセスに文字入力を待たせることには、この場面でも意味が無い。出てよいのは helper 自身のウィンドウだけになる。

待ち時間の上限も専用のものにしてある（`GIT_INTERACTIVE_PUSH_TIMEOUT_MS` ＝ 5分）。**待っている相手が人**で、二段階認証を1つ挟むと2分では足りない。それでも上限を外さないのは、順番待ちが1本（§14.11）で、握られている間は Stage も Commit も動かないため。

#### 途中で止まったら `partly-applied`（済んでいるものを名乗る）

3-8-5 では `partly-applied` を返しうるのが Commit & Push だけだったため、文言の側が「Commit は完了しましたが」を決め打ちできた。3-8-10 で2つめの利用者ができ、**済んでいるものが違う**（repository が作られた）── そこで結末に `completed` を載せ、前半の1文をそこから決める形にした。

| 止まった場所                        | 返るもの                                              | 次の一手                     |
| ----------------------------------- | ----------------------------------------------------- | ---------------------------- |
| repository は作れた / Push が駄目   | `partly-applied`（`github-repository`）＋ Push の理由 | Push ボタン（remote は在る） |
| repository は作れた / remote が駄目 | `partly-applied`（`github-repository`）＋ `no-remote` | 端末で `git remote add`      |
| repository が作れなかった           | `failed`（`github-repository-exists` など）           | 別の名前・gh のログイン      |

**作った repository を消して失敗に揃えることはしない。** 頼まれていない取り消しであり、しかも消す操作そのものが失敗しうる（commit を戻さないのと同じ判断。§14.13）。

#### 押す前に分かることは、外へ出る前に分ける

detached HEAD（`not-on-branch`）と、commit が1つも無い（`no-commit`）は手元だけで分かる。分かるものを相手に聞きにいかないのは Push と同じ形だが（§14.13）、こちらは**断ったときに GitHub 側へ誰も使わない空の repository が残る**ため、より効く。

`no-commit` を `nothing-to-do` と分けてあるのは、次の一手がはっきり別だから ── あちらは「押した意味が無かった」で、こちらは「先にすることがある」になる。

#### UI（Renderer）

```
まだリポジトリではない  案内 ＋「Git リポジトリにする」＋「もう一度確認する」
   └── 押すと確認（Workspace 名つき）→ git:init
remote がまだ無い       Push / Pull の下に「GitHub に公開」（畳んである）
   └── 開くと gh の状態 ＋ repository 名 ＋ 公開範囲（既定は private）
remote がある           公開の入口ごと消える（Push / Pull だけが並ぶ）
```

- **初期化に確認を1枚挟む。** 失われるものは無い（§12.6 の対象ではない）が、Git パネルはドッキングで自由に置けるため**パネルの中に Workspace の名前が出ているとは限らない** ── 思っていたのと別のフォルダがリポジトリになるのが、この操作で起こりうる唯一の取り違えになる。尋ねるのは「このフォルダでよいか」1つだけ
- **案内にボタンを出すかどうかは、文言を決める場所が一緒に決める**（`gitRepositoryMessage.ts` の `action`）。画面の側の if で足すと、文言と押せるものが別々の場所で決まる
- **公開の面は畳んである。** 名前の欄を常に広げておくと、公開する気の無い人の画面に居座る ── remote を持たないリポジトリで Commit / Branch / Diff を使い続けるのは普通の使い方にあたる
- **開くたびに gh を確かめる**（`github:get-status`）。覚えておいた答えを出すと、gh を入れた直後・ログインした直後に「見つかりません」のままになる ── そこがいちばん起こりやすい場面になる。ブランチの一覧を開くたびに取り直す（§14.14）のと同じ形
- **既定は private。** 押し間違いが「世界中から見える」になる側を、既定にも選択肢の1つめにもしない。あとから GitHub 側で公開に変えられるが、一度出たものは戻せない
- **repository 名の初期値は Workspace 名から作る**（使えない字のかたまりを `-` にまとめ、それでも通らなければ空にする）。打った名前を勝手に変えるのとは違う ── 変えているのはこちらが提案した初期値で、欄に結果が見えている

#### 実物に対して固定してあること

`gitInitRepository.test.ts` と `publishRepository.test.ts` が、本物の git に対して次を確かめている（gh は差し替えた実装で、ネットワークにも GitHub にも触れない）。

- `git init` が初期ブランチ名をアプリから決めず、commit も `.gitignore` も remote も作らないこと
- 既にリポジトリなら作り直さないこと・リポジトリの中のサブフォルダでは初期化しないこと
- 公開が「作る → remote → Push」の順で通り、追跡先まで設定されること
- **commit が無い / detached HEAD では、外に物を作らずに断る**こと
- Push だけが通らなかったとき、`partly-applied` として返し **remote は残す**こと
- **remote が既にあれば作り直さず、続きの Push だけを行う**こと（`origin` を上書きしない）

### 14.18 Session 3-8-1 〜 3-8-10 の範囲外

| 項目                                             | 状況                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 複数ファイルの任意選択                           | Stage は「1件」か「グループのすべて」だけ。任意の複数を渡せる欄は作らない（§14.11）                                  |
| すべて Unstage                                   | 置いていない。Commit の中身を丸ごと空にする操作で、押し間違いの代償が釣り合わない                                    |
| 強制 Push（`--force` / `--force-with-lease`）    | 欄そのものを作っていない。他人の commit を消しうる操作で、押し間違えたときに戻せない（§14.13）                       |
| 自動 merge / rebase（Pull）                      | `--ff-only` 固定。どちらを選ぶかはリポジトリの流儀で決まり、アプリが黙って決めてよいことではない（§14.13）           |
| Push / Pull / 切り替えの取り消し                 | 持たない。動いている git を途中で止める手段（キャンセル）は後続のセッションで、Terminal の終了確認と同じ形で設計する |
| remote の追加 / 切り替え / 一覧                  | remote を指せる欄は作らない。`origin` を作るのは公開の一部としてだけで、名前も URL も渡せない（§14.17）              |
| 特定のブランチ / tag だけを Push                 | 送るのは常に「今のブランチ」。refspec を渡せる欄は作らない（§14.13）                                                 |
| Push / Pull の進捗表示                           | 「動いている」までで、何 % かは出していない。`--porcelain` も使わず、結末は終了コードで決める（§14.13）              |
| amend / sign / author / date の変更              | 欄そのものを作っていない。履歴に永久に残るものを Renderer から書き換えられる形にしない（§14.12）                     |
| `--no-verify`（hook の迂回）                     | 持たない。リポジトリが置いた決まりごとをアプリが黙って外すことになる（§14.12）                                       |
| 空の Commit（`--allow-empty`）                   | 持たない。押したのに何も起きない、の別の形にあたる（§14.12）                                                         |
| Commit テンプレート / 専用エディタ               | 入力欄は `<textarea>` 1つ。改行は通るが、書式を用意する側には回らない                                                |
| Commit メッセージの AI 生成                      | 走査の入口が別のもの（差分の中身）になるため、別の経路として設計する                                                 |
| Git identity の設定 UI                           | 未設定なら失敗として案内するだけ。**アプリからは設定しない**（§14.12）                                               |
| ブランチの削除 / rename                          | 置いていない。削除は**戻せない**操作で、確認の形（§12.6）と一緒に設計する（§14.14）                                  |
| remote-tracking branch からのブランチ作成        | 一覧にも載せず、名前を渡しても作らない（`--no-guess`）。remote を指せる欄と一緒に設計する（§14.14）                  |
| 一覧に無いブランチへ名前で切り替える             | 切り替え先は**一覧から選んだものだけ**。上限を超えた分は Terminal パネルで扱う（§14.14）                             |
| 切り替え時の自動 stash / merge（`--merge`）      | 渡さない。切り替えてよいかを決めるのは git 自身で、アプリはその判断を上書きしない（§14.14）                          |
| 別の commit からブランチを作る（start point）    | 欄そのものを作っていない。選ぶための画面（履歴）と一緒でなければ意味を持たない（§14.14）                             |
| ブランチの追跡先を設定する（`--track`）          | 渡さない。始点は HEAD で、追跡先を付けるかはリポジトリの設定の領分になる（§14.14）                                   |
| 初回 Commit の自動化                             | しない。最初の commit に何を含めるかは利用者の判断で、履歴の1つめは後から直しにくい（§14.17）                        |
| `.gitignore` の生成 / テンプレート               | 置かない。何を無視するかは言語もツールも人も選ぶ話で、アプリの「とりあえずの1つ」が正本のように残る（§14.17）        |
| 初期ブランチ名を選ぶ                             | 素の `git init` に任せる。`init.defaultBranch` を設定した人の意図をアプリの中でだけ上書きしない（§14.17）            |
| 所有者（Organization）を選んで公開               | 欄そのものを作っていない。ログインしているアカウントの下に作る ── 選ばせるなら「どこに作られたか」を出す画面と一緒に |
| 説明文 / トピック / README の設定                | 渡す欄が無い。GitHub 側でいつでも書ける（README を作らせると初回 Push が必ず断られる。§14.17）                       |
| 既にある repository を選んで remote にする       | しない。同じ名前があれば断る（`github-repository-exists`）── 別名で作り直すことも上書きもしない（§14.17）            |
| 公開の取り消し（repository の削除）              | 持たない。作った repository を消す口は、公開の失敗時にも用意していない（§14.17）                                     |
| 作った repository を開く / URL を出す            | URL は Main の中だけに留める。Renderer へ渡すと、それを指して何かを頼む欄が欲しくなる（§14.4 と同じ線）              |
| GitHub Enterprise / 別ホストへの公開             | 相手は github.com に固定。選べるようにするなら「どこへ公開するか」の画面と一緒に設計する（§14.17）                   |
| GitHub CLI 以外の経路（自前の OAuth）            | 持たない。token を保管する設計がアプリ1つ分増える。差し替えるなら境界の実装1つで済む形にしてある（§14.17）           |
| GitHub CLI の自動インストール                    | しない。出すのは案内と winget の1行だけ（§14.17）                                                                    |
| 認証情報の保存                                   | アプリ自身では持たない。git は credential.helper、GitHub は gh に任せる（設計判断 7・§14.17）                        |
| `.git` の中身を Renderer へ渡す                  | `git:changed` が運ぶのは `workspaceId` だけ。何が変わったかは載せない（§14.15）                                      |
| Main から Git の**状態**を push                  | 押し出すのは「調べ直して」という合図までで、状態そのものは要求と応答で運ぶ（§14.15）                                 |
| 監視の除外を Settings から変える                 | `.git` の中で拾う名前は固定の表（§14.15）。`ignoredDirectories.ts` と同じく、設定から読む形は後                      |
| submodule / worktree の `.git` を追う            | `modules/` も `worktrees/` も拾わない。どちらも「Workspace root ＝ リポジトリ root」の前提から外れる（§14.15）       |
| サブフォルダのリポジトリを自動で選ぶ             | 選ばない。root が食い違えば操作しない（§14.4）                                                                       |
| worktree / submodule / sparse checkout           | どれも「Workspace root ＝ リポジトリ root」という前提から外れる。別の設計が要る                                      |
| ステージ済みの破棄（1回で index も作業ツリーも） | 置いていない。**先に Unstage** してもらう ── 1回で失われるものが2段になる（§14.16）                                  |
| グループごとの一括破棄 / すべて破棄              | 置いていない。Stage の押し間違いは Unstage で戻せるが、破棄には戻せる先が無い（§14.16）                              |
| 未追跡のフォルダ1件の破棄                        | 断る。1行に見えて中身は数万件になりうる。行にも出さず、Main も届いた対象を確かめて断る（§14.16）                     |
| `git clean` / `reset --hard`                     | 使わない。前者はごみ箱を経由せず、後者は指した1件より広い範囲を戻す（§14.16）                                        |
| 差分の中からの編集 / 行単位の Stage              | Diff Editor は読み取り専用。直すのは元のエディタで行う ── 保存の入口を2つにしない（§14.16）                          |
| 履歴の2点を比べる（`HEAD~1` など）               | rev を渡せる欄そのものが無い。走査の入口が別のもの（commit の連なり）になり、履歴の画面と一緒に設計する（§14.16）    |
| 差分の `--textconv` / `--ext-diff`               | 付けない。どちらもリポジトリの設定にある**任意のプログラム**を起動する指定にあたる（§14.16）                         |
| 競合しているファイルの差分 / 破棄                | 対象外。「前」と「後」が2組（ours / theirs）あり、2つの中身を並べる形そのものが当てはまらない（§14.16）              |
| 改行だけの違いを差分として出す                   | 出せない。左右とも LF に均してある ── 均さないと `core.autocrlf` の環境で全行が変更として出る（§14.16）              |
| Merge Conflict 解決 UI                           | 衝突は**別のグループとして出す**ところまで（§14.8）。Stage / Unstage / 差分 / 破棄も置かず、Commit は git が断る     |
| 履歴 / Graph / stash / rebase / tag              | 走査の入口が別のもの（commit の連なり）になるため、別の経路として設計する                                            |
| GitHub の API（Issues / PR / Actions）           | git の実行とは別のドメイン（ネットワークと認証が絡む）                                                               |
