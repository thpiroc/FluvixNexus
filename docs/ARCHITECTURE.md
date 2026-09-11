# アーキテクチャ

> 対象: Session 5-13（STEP 5 LSP Closing）完了時点の実装 ＋ Session 6-2（STEP 6 DAP lifecycle foundation）
> 最終更新: 2026-09-10

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
│   │       └── settings.ts        アプリの設定の永続化（section 単位。§12.4）
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
│   │   ├── gitOutput.ts               出力の読み取り・パスの比較・ブランチの一覧・履歴（同上・テスト対象・§14.4・§14.14・§14.19）
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
│   │   ├── gitBranches.ts             ブランチの一覧 / 切り替え / 作成 / 削除 / rename の噛み合わせ（§14.14・§14.22）
│   │   ├── gitRemoteBranches.ts       remote-tracking の一覧 / そこからの作成の噛み合わせ（§14.27）
│   │   ├── gitRemotes.ts              remote の一覧 / 追加 / 削除 / URL 変更 / rename の噛み合わせ（§14.24・§14.25）
│   │   ├── gitStash.ts                退避（push / pop / drop）の噛み合わせ（§14.23）
│   │   ├── gitConflict.ts             競合を解決済みにする噛み合わせ（§14.26）
│   │   ├── gitHistory.ts              commit の履歴の噛み合わせ（§14.19）
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
│   │   ├── jsonFile.ts       JSON ファイル1つの読み書き（Electron 非依存・原子的な差し替えと間引き）
│   │   ├── jsonStore.ts      userData 配下への JSON 永続化（保存先の決定とログ）
│   │   ├── windowBounds.ts   ウィンドウ状態の検証（Electron 非依存・テスト対象）
│   │   ├── windowState.ts    ウィンドウ状態の保存と復元
│   │   ├── workspaceLayoutDocument.ts  レイアウト文書の検証（Electron 非依存・テスト対象）
│   │   ├── workspaceLayout.ts          レイアウトの保存先（userData 配下）
│   │   ├── workspaceFolderDocument.ts  Workspace 文書の検証（Electron 非依存・テスト対象）
│   │   ├── workspaceFolder.ts          Workspace の保存先（userData 配下）
│   │   ├── settingsSections.ts         section / key ごとの検証（Electron 非依存・テスト対象・§12.4）
│   │   ├── settingsMigration.ts        schemaVersion の移行の入口（同上・§12.4）
│   │   ├── settingsDocument.ts         設定文書の検証と組み立て（同上・§12.4）
│   │   ├── legacySettings.ts           旧 3 ファイルからの取り込み（同上・§12.4）
│   │   ├── settingsStore.ts            settings.json の読み書き（フォルダを受け取る・テスト対象・§12.4）
│   │   └── settings.ts                 設定の保存先（userData 配下・§12.4）
│   ├── logger/index.ts       Main 側のログ出力
│   └── platform/
│       ├── index.ts          OS 依存判定の抽象化
│       └── executablePath.ts PATH の辿り方（Terminal と Git が共有・テスト対象・§13.2・§14.1）
├── preload/
│   ├── index.ts              contextBridge での公開
│   ├── theme.ts              保存済み Theme を最初の描画より前に `<html>` へ当てる（§16.5）
│   ├── language.ts           保存済み Language を最初の描画より前に `<html>` へ当てる（§17.6）
│   ├── ipc/invoke.ts         Main を呼ぶ唯一の経路
│   ├── ipc/subscribe.ts      Main からのイベントを受ける唯一の経路（§3.3）
│   └── api/                  ドメインごとの薄いラッパ（env / system / workspace / workspaceFolder / files / terminal / settings）
├── renderer/
│   ├── index.html            CSP を含む唯一の HTML
│   └── src/
│       ├── main.tsx / App.tsx    エントリ。App は Provider と Workspace Shell を置くだけ
│       ├── api/fluvix.ts        window.fluvix を参照する唯一の場所
│       ├── api/result.ts        IpcResult の扱いと、エラーコード → **翻訳キー**の対応表（§17.4）
│       ├── styles/
│       │   ├── theme.css        Dark / Light の色と間隔の変数（**色の実体はここだけ**・§16.2）
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
│       │   ├── gitBranches.ts         ブランチの一覧 → 面に並べる形・作れる名前か（React / DOM 非依存・テスト対象・§14.14・§14.22）
│       │   ├── gitRemoteBranches.ts   remote の枝 → 面に並べる形・空のときの言い分け（React / DOM 非依存・テスト対象・§14.27）
│       │   ├── gitHistory.ts          履歴 → 面に並べる形・日時の言い方（React / DOM 非依存・テスト対象・§14.19）
│       │   ├── useGitRepository.ts     状態の保持・いつ調べ直すか（`files:changed` / `git:changed` の合流）・Stage / Unstage / Commit / Push / ブランチ / 差分 / 破棄 / 履歴 の実行（§14.5・§14.11・§14.12・§14.14・§14.15・§14.16・§14.19・§14.27）
│       │   ├── GitView.tsx             何を出す状態か（ブランチ / 一覧 / 案内 / 操作 / Commit 欄 / 差分の面 / 履歴の面・§14.9・§14.11・§14.12・§14.16・§14.19）
│       │   ├── GitBranchMenu.tsx       ブランチを選ぶ / 作る / 消す / 改名する面と、remote の枝から作る段（ui/Popover の中身・§14.14・§14.22・§14.27）
│       │   ├── gitDiff.ts             差分の面に出す言葉・開ける行か（React / DOM 非依存・テスト対象・§14.16）
│       │   ├── GitDiffOverlay.tsx      一覧の上に重なる読み取り専用の差分（§14.16）
│       │   ├── GitHistoryOverlay.tsx   一覧の上に重なる読み取り専用の履歴（§14.19）
│       │   ├── GitDiscardConfirm.tsx   破棄の確認（§12.6・§14.16）
│       │   ├── GitInitConfirm.tsx      `git init` の確認（Workspace 名つき・§14.17）
│       │   ├── githubPublish.ts        公開の面に出す言葉・公開できるか（React / DOM 非依存・テスト対象・§14.17）
│       │   ├── GitHubPublishForm.tsx    GitHub に公開する面（畳んである・§14.17）
│       │   ├── GitIcons.tsx            Stage / Unstage / 差分 / 破棄 のアイコン（Files と同じ描き方・§14.11・§14.16）
│       │   └── git.css
│       ├── i18n/               画面の文言（Localization。§17）
│       │   ├── locales/en.ts          英語の辞書（**キーの正本**。型はここから導く・§17.2）
│       │   ├── locales/ja.ts          日本語の辞書（既定の言語・§17.2）
│       │   ├── locales/types.ts       辞書 → 翻訳キーの union（§17.2）
│       │   ├── messages.ts            辞書 → `t`（埋め込み値の差し替え・§17.3）
│       │   ├── languageSettings.ts    Language ↔ 保存形式の変換（React / DOM 非依存・テスト対象・§17.5）
│       │   ├── documentLanguage.ts    `<html>` への当て方と読み取り（§17.6）
│       │   ├── context.ts             Context の定義（`language` / `setLanguage` / `t`）
│       │   └── LanguageProvider.tsx   Renderer 全体へ配る器（App の一番外・§17.5）
│       ├── commands/           実行できる操作の表（Command。§18.1〜§18.3）
│       │   ├── commandIds.ts          command id の閉じた集合（§18.1）
│       │   ├── types.ts               descriptor と category、画面に出す名前の決め方（§18.1・§18.2）
│       │   ├── registry.ts            descriptor の表（`Record<CommandId, …>`・§18.1）
│       │   ├── commandCategoryLabels.ts カテゴリ → 表示名（内部 id と表示名を分ける・§18.2）
│       │   ├── context.ts             実行時の handler 表の型（§18.3）
│       │   ├── CommandProvider.tsx    handler の表を持つ器（state ではなく ref・§18.3）
│       │   └── useCommand.ts          所有者が自分の handler を載せる hook（§18.3）
│       ├── keybindings/        打鍵を command へ繋ぐ（§18.4〜§18.6）
│       │   ├── chord.ts               打鍵1つの表し方（`event.code` 基準・React / DOM 非依存・テスト対象・§18.4）
│       │   ├── when.ts                効く条件（閉じた6つの AND・同上・§18.5）
│       │   ├── resolve.ts             rule の並び → 効く割り当ての表（後勝ち・同上・§18.4）
│       │   ├── defaults.ts            既定の割り当て7件（**v1 が rule を作る唯一の場所**・§18.4）
│       │   ├── dispatch.ts            打鍵 → command（確認ダイアログの裏では走らせない・同上・§18.5）
│       │   ├── shortcutRows.ts        registry ＋ 割り当て → 一覧の行（同上・§18.6）
│       │   ├── context.ts             Context の定義（効いている割り当てと、条件の申告）
│       │   ├── useWhenFlag.ts         条件を1つ申告する hook（§18.5）
│       │   └── KeybindingProvider.tsx window の keydown を1本だけ張る器（§18.5）
│       ├── settings/           設定を読み書きする段取り（§12.4）と Settings 画面（§15）
│       │   ├── useSettingsSection.ts  section 1つを持ち、いつ読み・いつ書くかを決める
│       │   ├── settingsCatalog.ts     何が、どのカテゴリに、どの順で並ぶか（React 非依存）
│       │   ├── SettingsOverlay.tsx    それをどう描き、どの setter へ繋ぐか
│       │   ├── KeyboardShortcutsView.tsx 打鍵の一覧（**読むだけ**。値を持たない・§18.6）
│       │   └── settings.css
│       ├── theme/              アプリ全体の見た目（Theme。§16）
│       │   ├── appearanceSettings.ts  Theme と保存形式の行き来（React / DOM 非依存・テスト対象）
│       │   ├── themeTokens.ts         theme.css の変数から Monaco / xterm の色を作る（§16.3）
│       │   ├── documentTheme.ts       `<html>` への当て方と読み取り
│       │   ├── useAppearance.ts       Theme の正本（値と、変える口）
│       │   ├── context.ts             Context の定義
│       │   └── ThemeProvider.tsx      Renderer 全体へ配る器（App の一番外）
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
    ├── git/                   リポジトリの状態・HEAD・失敗の分類・変更ファイルの一覧・操作の対象と結末・Commit メッセージの規則・ブランチの一覧と名前の規則・commit の履歴（§14）
    ├── github/                公開範囲・GitHub CLI の状態・repository 名の規則（§14.17）
    ├── settings/             アプリ設定の保存形式（section の閉じた集合と文書の形。§12.4）
    ├── language/             Language の名前・既定・落とし先と、初期描画用の受け渡し（§17.1）
    └── theme/                Theme の名前・既定・落とし先と、初期描画用の1色（§16.1）
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

| ファイル                | 内容                                | 検証（Electron 非依存）            | 保存を決める場所           |
| ----------------------- | ----------------------------------- | ---------------------------------- | -------------------------- |
| `window-state.json`     | ウィンドウのサイズ・位置・最大化    | `store/windowBounds.ts`            | `store/windowState.ts`     |
| `workspace-layout.json` | Workspace レイアウト（§7.8）        | `store/workspaceLayoutDocument.ts` | `store/workspaceLayout.ts` |
| `workspace-folder.json` | 最後に開いていたフォルダ（§8.5）    | `store/workspaceFolderDocument.ts` | `store/workspaceFolder.ts` |
| `settings.json`         | アプリの設定（section ごと。§12.4） | `store/settingsDocument.ts`        | `store/settings.ts`        |

**設定は1ファイル・section 分けにする**（Session 4-3A）。Session 3-5 〜 3-7-5 では用途ごとに1ファイル・2チャンネルを足していた（`editor-settings.json` / `files-settings.json` / `terminal-settings.json`）。用途ごとに API を切る方針（§5）に従ったものだったが、3つ並んだ時点で分かったのは**増えていたのが設定ではなく同じ形の写しだった**ことにほかならない ── 方針が守りたかったのは「Renderer が保存先を選べないこと」で、それは section を閉じた集合にすれば同じだけ守れる。増えるのはファイルでもチャンネルでもなく `SettingsSectionId` になった。

旧3ファイルは `settings.json` が無いときだけ読み、取り込んだ後も**消さない**（戻れる道を残す。`store/legacySettings.ts`）。

共通の作法は `jsonFile.ts`（ファイルの読み書き）と `jsonStore.ts`（保存先の決定）が持つ。

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
| 別名で保存（書き出す先）             | Renderer から渡せない。決めるのはネイティブの保存ダイアログだけ（§12.9）                           |
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

アプリの設定は Session 4-3A で `settings:load` / `settings:save-section` の2本に集約した（§12.4）。用途ごとにチャンネルを足していた形（`settings:load-editor` …）をやめたのは、**方針が守りたかったのが「Renderer が保存先を選べないこと」だったから**で、それは section を閉じた集合（`SettingsSectionId`）にすれば同じだけ守れる ── 保存要求は section 名で値の型が決まる判別可能なユニオンで、Main 側でも既知の section・既知の key かを必ず確かめる。**「名前と JSON を渡すと保存される」汎用 API にはしない**という線は、チャンネルの数ではなくここで守られている。

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
| Monaco Editor                      | **§11 / §12 として実装済み**（Worker・Model 管理・言語判定・保存・別名で保存・外部変更・Conflict・Auto Save）                                                                                     |
| LSP                                | 言語 id は `editor/monaco/language.ts` が決める（§11.4）。サーバのプロセス起動は Main（`platform/` に OS 依存部分）、通知は §3.3 の経路                                                           |
| Files                              | **§9 / §10 として実装済み**（列挙・読み込み・作成 / 改名 / 移動 / コピー / 削除・保存・外部変更の追従・検索）                                                                                     |
| Settings（設定の永続化）           | **§12.4 として実装済み**（`settings:load` / `settings:save-section`）。設定を足すなら section か key を増やす。画面は後続                                                                         |
| Terminal                           | **§13 として実装済み**（node-pty は Main・作業ディレクトリは §8・出力は §3.3 の経路）。複数タブは同じ表に足す                                                                                     |
| Git / GitHub パネル                | **§14 として実装済み**（git の実行基盤・検出・一覧・Stage / Unstage・Commit・Push / Pull・ブランチ・`.git` の監視・差分と破棄・`git init` と GitHub への公開）。増やすときは操作ごとに1本ずつ切る |
| GitHub パネルの独立ウィンドウ化    | セキュリティガードは webContents 単位、IPC は送信元ウィンドウを `IpcContext` で受け取れる。イベントは全ウィンドウへ届く（§3.3）                                                                   |
| DAP                                | **§20 として設計確定（Session 6-0）**し、Session 6-1 で Main 内の DAP wire / adapter process / catalog foundation を追加。Renderer / preload IPC と Debug Session 本体はまだ無い                  |
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
| 表示方式の保存            | **Session 3-6-8 で実装**（§10.14）。保存先は §12.4               |
| プレビュー列（Finder 風） | 一番右にファイルの中身を出す列は持たない（それは Editor の仕事） |
| カラムでの複数選択        | ツリーと同じく単一のまま                                         |

---

### 10.14 Files の仕上げ（Session 3-6-8）

Session 3-6-1 〜 3-6-7 で足した機能そのものは変えず、**使い続けたときに引っかかる3つ**を埋めた回。新しい操作も、新しい見せ方も増えていない。

| 埋めたもの                 | Session 3-6-7 までの状態                       | どこに書いたか                              |
| -------------------------- | ---------------------------------------------- | ------------------------------------------- |
| 見え方が次の起動に残らない | 選んだ表示方式はアプリを閉じると忘れる         | `settings.json` の `files` section（§12.4） |
| カラムの幅が変えられない   | 208px 固定                                     | 同じ文書の `columnWidth`                    |
| 画面の外へ運べない         | 行き先が見えていないと、離して掴み直すしかない | `filesAutoScroll.ts` と `useFileDrag.ts`    |

#### 見え方は「パネルの見え方」であって Workspace の持ち物ではない

保存するのは**表示方式（auto / tree / columns）とカラムの幅**の2つだけで、Workspace ごとには持たない。開いているフォルダを切り替えても、選んだ見え方は変わらないのが正しい ── 選択も展開も Workspace と一緒に捨てられるが（§9.6）、見え方はそれらと別のものにあたる（§10.13「選んだことはパネルより長く生きる」の延長で、今回それが**アプリの起動より長く**なった）。

```
FilesViewProvider.tsx           選んだ表示方式と幅の正本
files/filesSettings.ts          保存形式との変換・幅の上下限（React も IPC も知らない）
settings/useSettingsSection.ts  いつ読み、いつ書くか（Session 4-3A で3箇所から集約）
shared/settings/sections.ts     ディスクに置く形（`files` section）
main/store/settingsSections.ts  key ごとに読める形かの検証
main/store/settings.ts          保存先（settings.json）
```

正本を Provider に置いたのは、**そこが見え方の持ち主だから**にほかならない。使う側（`useFilesLayout` / `FileColumns`）に置くと、パネルの数だけ保存の口ができる。読むのは起動時に1度だけで、**読み終わるまで保存を許さない**（先に許すと既定値で上書きした後に読み込みが届き、起動のたびに選択が消える）── その段取りは Session 4-3A で `useSettingsSection.ts` へ移した（§12.4）。Editor / Terminal と一字一句同じだった部分にあたる。

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

| 判断                           | 場所                             | Monaco への依存    |
| ------------------------------ | -------------------------------- | ------------------ |
| 拡張子 → 言語 id               | `editor/monaco/language.ts`      | **無し**（文字列） |
| Auto Save の設定               | `editor/autoSave.ts`             | **無し**           |
| どのファイルを開いているか     | `editor/editorTabsModel.ts`      | **無し**           |
| Model / 未保存 / 見ていた位置  | `editor/monaco/documentStore.ts` | **型だけ**         |
| Worker・テーマ・言語サービス   | `editor/monaco/monacoSetup.ts`   | 有り               |
| Theme の色（`theme.css` から） | `theme/themeTokens.ts`           | **無し**（§16.3）  |
| Model の作り方・エディタの器   | `editor/monaco/MonacoEditor.tsx` | 有り               |
| いつ保存するか                 | `editor/useEditorSession.ts`     | 無し               |

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

Session 4-3A で、設定の保存先は `settings.json` 1つになった。

```
useEditorSession / FilesViewProvider / useTerminalSettings   値の持ち主
   ↓
renderer/src/settings/useSettingsSection.ts   いつ読み、いつ書くか（3箇所で共通）
   ↓
window.fluvix.settings          Preload の薄いラッパ
   ↓  IPC（settings:load / settings:save-section）
main/ipc/handlers/settings.ts   既知の section・既知の key かを検証
   ↓
main/store/settings.ts          %APPDATA%/Fluvix Nexus/settings.json
```

```json
{
  "schemaVersion": 1,
  "sections": {
    "editor": { "autoSaveMode": "afterDelay", "autoSaveDelayMs": 1000 },
    "files": { "viewMode": "columns", "columnWidth": 240 },
    "terminal": { "fontSize": 15, "scrollback": 5000 }
  }
}
```

**Renderer は保存先を知らない**（パスもファイル名も引数に無い）。加えて**書ける先は閉じた集合**で、`settings:save-section` の要求は section 名で値の型が決まる判別可能なユニオンになる ── 任意の名前・任意の JSON を渡す口は無い（§5）。検証の分担はレイアウト（§7.8）と同じで、Main は「後で解釈できる形か」まで、意味（mode として成立するか・上下限）は Renderer が決める。

**読み込みが終わるまで保存を許さない。** 先に許すと、既定値で上書きした後に読み込みが届き、起動のたびに設定が既定へ戻る。Session 3-5 / 3-6-8 / 3-7-5 では3箇所に同じ写しがあり、**間違え方も3通りあった** ── `useSettingsSection.ts` にまとめてある。

#### 壊れていても、壊れたところだけを捨てる

| 壊れている場所          | 失われるもの           |
| ----------------------- | ---------------------- |
| 文書全体（JSON でない） | すべて（既定で始まる） |
| `schemaVersion`         | すべて                 |
| `sections`              | すべて                 |
| 1つの section           | その section だけ      |
| 1つの key               | その key だけ          |

旧形式は入れ子（`{ autoSave: { mode, delayMs } }`）で all-or-nothing だったため、`delayMs` が1つ壊れているだけで Editor の設定が丸ごと既定へ戻っていた。section の中を**平らにした**のはこのためで、読む側が key ごとに独立して落とせる（`store/settingsSections.ts`）。

**知らない section・知らない key は捨てずに書き戻す。** 新しい版で足した設定が、古い版で一度起動しただけで消えるのを避けるため。逆に **Renderer から届いた知らない key は保存しない** ── ディスクにある未知の値は新しい版が書いたものでありうるが、Renderer から届く未知の値は契約に無い値でしかない。

#### 版と、旧ファイルからの移行

`schemaVersion` は「現在 / 古い / 新しすぎる / 読めない」を区別する（`classifySettingsSchemaVersion`）。古い版は `store/settingsMigration.ts` の入口を通す（**段はまだ1つも無い**。現在の版が 1 で、それより古い版が存在しないため）。新しすぎる版は既知の key だけを読み、知らない内容を書き戻す ── これは「**既にある key の意味は版をまたいで変えない。変えるときは新しい key 名にする**」という約束の上に成り立っている。版を上げるのは構造を変えるときだけ。

旧3ファイル（`editor-settings.json` / `files-settings.json` / `terminal-settings.json`）は **`settings.json` が無いときだけ**読み、読める設定だけを取り込んでその場で1度書く（`store/legacySettings.ts`）。1つが壊れていても他は移り、key 単位でも同じ。**旧ファイルは消さない**（戻れる道を残す）。壊れた `settings.json` があるときは旧ファイルへ戻らない ── 壊れているのは「この形式のファイルが既にある」ということで、そこへ古い内容を混ぜると利用者が最後に選んだ設定より古いものが復活しうる。

#### 設定を1つ増やす手順

| 足すもの                       | 置き場所                                                |
| ------------------------------ | ------------------------------------------------------- |
| section の名前（増やすとき）   | `shared/settings/sections.ts` の `SETTINGS_SECTION_IDS` |
| ディスクに置く形（key の型）   | `shared/settings/sections.ts` の `Stored*Settings`      |
| key ごとの検証                 | `main/store/settingsSections.ts` の表（テスト対象）     |
| 値の意味（既定・範囲・丸め方） | その機能の Renderer 側                                  |
| 読み書きの段取り               | `renderer/src/settings/useSettingsSection.ts`（共通）   |

**中身が決まっていない section を先に作らない** ── 空の section は「まだ何も無い場所」をディスクに残すだけになる。`git`・`workspace` などはこの形で入る。

**Session 4-4 の `appearance`（Theme）がその最初の実例にあたる**（§16.6）。予告どおり、増えたのはファイルでもチャンネルでもなく **section 1つと key 1つ**で、IPC も Preload の口も Main の検証の仕組みも1行も変わっていない。旧ファイルを持たない最初の section でもあり、旧ファイルの集合は `SettingsSectionId` の部分集合として切ってある（`LegacySettingsSectionId`）── 同じ集合のままにすると、section を足すたびに存在しない旧ファイルの名前を決めさせられる。

**アプリ全体の Settings 画面は Session 4-3B で入った**（§15）。予告どおり、移ったのは「並べる場所」だけで、値の持ち主はどれも機能の側にある。設定の変更を別ウィンドウへ知らせる仕組み（`settings:changed`）は今も無い ── 単一の Renderer が Context で同期できており、独立ウィンドウが要るようになった時点で考える。

#### 読み込みが返るまでの値には、既定でないものが入りうる（Session 4-4）

`useSettingsSection` の初期値は「読み込みが終わるまでの値」で、Auto Save・Files・Terminal はそこに**既定**を置いている。**Theme だけは違う。** 既定（Dark）を置くと、Light を選んでいる人の起動が必ず一度 Dark を通るため、`<html>` に当たっている値 ── Main が同じ `settings.json` から読んで、IPC より早い経路で届けたもの ── から読む（§16.5）。二重の正本にはならない（読み込みが返れば同じ値に落ち着く）。

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
| Save As（削除されたファイルの救出） | **Session 4-2 で実装**（§12.9）                                                             |
| アプリの外での改名の対応付け        | 監視からは delete + create で届く（§12.1）。対応付けるならサイズ・内容の突き合わせが要る    |
| 監視の除外設定                      | `ignoredDirectories.ts` の表を Settings（§12.4）から読む形にする（検索と共通・§10.10）      |
| Shift_JIS / UTF-16                  | `FileEncoding` に足し、`fileContent.ts` と `writeWorkspaceFile.ts` の2箇所を増やす（§12.5） |
| 文字コードを選び直す UI             | 上と同時。読み込みの応答に候補を載せるか、開き直しの要求に encoding を足す                  |
| Settings 画面                       | 設定の**値**は既にアプリの設定として保存されている。並べる場所を作るだけ（DESIGN.md §9）    |
| Files Tree の完全な追従             | created / deleted は既に届いている。ツリー側で「追加された行を選択状態にする」等は後続      |
| Conflict の3方向マージ              | Compare は読み取り専用（§12.3）。編集できる差分は Git の解決 UI と同時に考える              |

### 12.9 別名で保存（Save As。Session 4-2）

STEP 4 の最初の実装。閉じるのは**アプリの中に1つだけ残っていた「押した先で内容が必ず失われる」経路**で、機能を増やすことがねらいではない。

外から消されたファイルのタブは `deleted` として残り、中身も残る（§12.6）。しかし書き戻す先が無いため保存できず、`files:write-file` は対象の実体を確かめる以上どうやっても通らない（§11.6）。閉じる前の確認はその事実を `unsavable` として正しく表示していた ── 「ディスク上から削除されています」と出したうえで、**捨てる以外の選択肢を出せなかった。**

#### 12.9.1 行き先を決めるのは利用者、書くのは Main

```
Renderer  中身 + 文字コード + ダイアログを開く位置の助言（Workspace 相対）
   ↓  files:save-as
Main      1. 中身を確かめる（文字列か・上限を超えないか）      ← ダイアログより先
          2. ネイティブの保存ダイアログを出す                  ← 行き先が決まる
          3. 選ばれた場所へ書く
          4. そこが Workspace の中か外かを決める
   ↓
Renderer  中なら相対位置と版、外なら null（絶対パスは載らない）
```

**要求に保存先が無いことが、この経路の境界そのもの。** `workspace-folder:open` と同じ形で、Renderer が言えるのは「ダイアログを出して」までに留まる（§8.4）。助言の `suggestedRelativePath` は `normalizeWorkspaceRelativePath` を通すため Workspace の外を指せず、指したところで利用者が選び直さない限り何も書かれない。

**この口だけが Workspace の外へ書ける。** 根拠は Renderer が渡した値ではなく「**Main が出したダイアログで利用者が選んだ**」という事実にあり、そこを信頼境界にしている。したがって絶対パスを受け取る引数を足さないこと ── 足した時点で、これは「Renderer から任意の場所へ書ける口」になる。

**断るなら選ばせる前に断る。** 中身の検証と助言の正規化はダイアログより先に済ませる。選んでから断ると、利用者は保存先を選ぶ手間を無駄にしたうえで、何が悪かったのかをダイアログの外で知ることになる。

#### 12.9.2 `writeWorkspaceFile.ts` を広げず、別の関数として切る

| 経路                          | 相手                 | 確かめること                         |
| ----------------------------- | -------------------- | ------------------------------------ |
| `files/writeWorkspaceFile.ts` | 今開いているファイル | 実体が Workspace の中か / 版が同じか |
| `files/saveFileAs.ts`         | 利用者が選んだ場所   | 中身が書けるものか / 中か外か        |

1本にまとめると、**同じ関数が要求の中身によって別の検証を通る**ことになる。境界の話は「どちらの検証を通ったか」が一目で分かる形に保つ。

`saveFileAs.ts` は Electron に依存しない（ダイアログを出すのは `ipc/handlers/files.ts`）。`store/windowBounds.ts` と `store/windowState.ts` を分けているのと同じ理由で、混ぜると判断のある部分がまるごとテストの外へ出る（`saveFileAs.test.ts`）。

**中か外かは実体（`realpath`）どうしで比べる。** 片方だけを解くと、Workspace root 自体が symlink 越しに開かれている場合に中にあるものを外と判定する。逆に、中に見えて実体が外にある symlink も外として扱う。組み立てた相対位置はもう一度 `normalizeWorkspaceRelativePath` を通す ── その位置は次の Ctrl+S で `files:write-file` へ渡るので、**同じ場所に着かなければ意味が無い。**

#### 12.9.3 タブが追従するのは Workspace の中だけ

Editor の同一性は全層が `relativePath` で成立している（タブ・Model・読み書き・監視）。Workspace の外のファイルを開いたまま保存し続けられるタブにするには、タブ同一性の第2の種類・Main 側の絶対パス台帳・外部ファイル用の版管理・監視対象外の扱いが要る。**そこまでは Session 4-2 の範囲に入れていない。**

| 保存先                               | 書き込み   | タブ             | 未保存 / 削除済みの印 |
| ------------------------------------ | ---------- | ---------------- | --------------------- |
| Workspace の中（空き）               | 成功       | **保存先へ移る** | 解ける                |
| Workspace の中（自分自身）           | 成功       | 移動にならない   | 解ける                |
| Workspace の中（別タブが開いている） | 成功       | 移らない         | 解かない              |
| Workspace の外                       | 成功       | 移らない         | 解かない              |
| 取り消し                             | 何もしない | 移らない         | 変えない              |

**移せない場合でも、書けた事実は取り消さない。** 内容は利用者が選んだ場所に確かに出ている。それでも印を解かないのは、**このタブが指している位置にはまだその中身が無い**ため ── 解くと「保存したのに、次に開いたら古い」が起きる。

書けたのにタブが動かない場合があるので、**成功しても黙らない**（`saveAsMessage.ts`）。文はどの結末でも「保存しました」から始める ── 「移らなかった」側から書き始めると、保存そのものが失敗したように読める。

**保存先が別のタブに開かれていたら移さない。** 移せば同じ位置のタブが2枚並び（`openTab` が守っている一意性が別の入口から崩れる）、相手を閉じれば、そこに未保存の変更があるとき**利用者が一度も選んでいないのに失う**。書き込み自体は行う ── 利用者はダイアログで選び、上書きなら OS の確認も通しているので、書かない方が指示に反する。相手のタブは既存の外部変更の経路（`files:changed` の `modified`）で追従し、未保存なら Conflict として残る（§12.3）。そのために Save As は変化を自分で配る（新規なら `created`、上書きなら `modified`）。

#### 12.9.4 移す順番

```
documents.rename    Model の鍵を移す（Undo 履歴を保つ）
tabs.moveTab        タブの位置と名前を差し替える
tabs.setDocument    読み込んだときの中身を、今書き出したもので揃える
documents.markSaved 未保存と「消えていた」を解く
tabs.setTabState    2つの層が揃ってから、状態を写す
```

**Model が先。** タブの位置が変わった時点で器（`MonacoEditor.tsx`）が新しい位置の Model を取りに来るため、先にタブを動かすとそこには Model が無く、**読み込んだ時点の中身から作り直された Model** が載る（＝編集が消える）。

`documents.rename` は状態を知らせない。**その瞬間だけは2つの層の位置がずれている**（Model は移り、タブはまだ元の位置）ため、知らせると移す前のタブへ移した後の状態が届く。揃えるのは2つをつなぐ側（`useEditorSession.ts`）の仕事。

言語は器が位置に合わせ直す（`monaco.editor.setModelLanguage`）。Model を作り直さない以上、作られたときの言語のまま残るため ── `notes.txt` を `notes.md` として保存し直しても色が付かない、が起きる。**アプリの外での改名にも同じだけ効く**（同じ経路を通る）。

#### 12.9.5 ここで直した、印が出なくなる不具合

Session 4-2 で見つかったもので、**別名で保存より前からあった。**

`documentStore` の中身の変化の購読が `acquire` の引数（位置）を閉じ込めていたため、位置を付け替えた後も**古い位置**を知らせ続けていた。知らせる相手（タブ）の鍵も位置なので、そこにはもうタブが居らず通知は捨てられる ── **打っても未保存の印が出ないタブ**ができていた。印が出ないだけで中身は未保存のままなので、閉じる前の確認（§12.6）にも並ばず、そのまま閉じれば黙って失われる。

起きるのは位置を付け替えるすべての経路で、**アプリの外でファイル / フォルダが改名されたとき**（§12.1）も同じだった。

直し方は、位置を entry 自身に持たせ、購読はそれを読む形にしたうえで、鍵の付け替えを `rekey` の1箇所に寄せた（Map の鍵と entry の位置が必ず一緒に動く）。`isDirty` を見るだけでは掴めない ── そちらは Map を直に引くため動いていた ── ので、テストは**通知の側**を見る（`documentStore.test.ts`）。

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

保存形式（`shared/settings/sections.ts` の `terminal` section）だけが shared にあるのは、それが**ディスクに置く形**であって見え方の意味ではないため（Editor / Files と同じ扱い。§12.4）。Main はその形しか見ず、8〜32px に収まっているかは見ない。

**文字の大きさもスクロールバックも全部のタブで同じ。** タブごとに持つと、切り替えるたびに見え方が変わることになる。ストア（`terminalScreenStore.ts`）が今の値を覚えていて、**後から作られる画面にも同じ値が渡る** ── 新しく開いたタブだけ既定のまま、が起きない。

**端末の打鍵を横取りすることになる。** 端末は打鍵をそのまま渡すのが約束（§13.1）なので、横取りする組み合わせは少ないほどよい。それでも3つ取っているのは、Session 3-7-3 の時点で文字の大きさを変える入口が他に無かったため。設定 UI ができた後も打鍵は残している ── 端末を触っている手を止めずに変えられることに意味があり、**どちらも同じ1つの値を変える**（打鍵で変えた値は設定 UI にもそのまま出る）。どれを取るかの判断は `terminalDisplay.ts` の純粋な関数に置いてあり、**横取りの範囲が広がっていないことをテストで固定してある**（`Ctrl+C` / `Ctrl+D` などが通ること）。

xterm 側の窓口は `attachCustomKeyEventHandler`（false を返すとシェルへ流れない）を使う。器の `onKeyDown` で拾わないのは、xterm が textarea 上で打鍵を組み立てており、**どこまで外へ漏れるかが xterm の実装都合になる**ため。

開発時のネイティブメニューからズームの3項目を外してあるのはこの割り当てのため（`app/menu.ts`）。Electron のズームは**メニュー項目のアクセラレータ**として効くので、置いておくと開発中だけ Ctrl + `+` / `-` / `0` が端末へ届かない（配布ビルドはメニューを持たない）。

#### 見え方の設定と永続化（Session 3-7-5）

層の分け方は Files の見え方（§10.14）をそのまま写している。

```
terminalDisplay.ts        既定値・範囲・丸め方（React も IPC も知らない）
terminalSettings.ts       実行時の設定 ↔ 保存形式の変換（同上）
useTerminalSettings.ts    見え方の正本と、変えるための入口
settings/useSettingsSection.ts  いつ読み、いつ書くか（Session 4-3A で3箇所から集約）
useTerminalTabs.ts        読んだ値を画面（terminalScreenStore）へ配る
TerminalSettingsMenu.tsx  変えるための入口（Terminal のタブ列の ⚙）
shared/settings/sections.ts     ディスクに置く形（`terminal` section）
main/store/settingsSections.ts  key ごとに読める形かの検証
main/store/settings.ts          保存先（settings.json）
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

Session 4-4 で Theme に追従するようになったが、CSP まわりの前提は1つも変わっていない。地・文字・カーソル・選択の色は `theme.css` の変数から作って `terminal.options.theme` へ渡すだけで（§16.3）、外部から取りに行くものも、新しく注入される style の種類も増えていない。

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

Session 3-8-11 で足したのは、ここまでのどれとも相手が違う ── **既に記録された commit の連なりを読むこと**（履歴。§14.19）になる。3-8-9 までが相手にしていたのは今の作業ツリーと index（これから記録するもの）で、初めて**過去**の側を出す。読むだけの面で、そこから動かせる git は `log` の1本しか無い ── revert も cherry-pick も reset も置いていない（§14.18）。

Session 3-8-12 で足したのは、その履歴の**中身**になる ── 並んだ1行を開いて、その commit で何が変わったかを見る（変更ファイルの一覧とその差分。§14.20）。3-8-9 が「一覧の1行の中身」を出したのと同じ関係が、履歴の側でも1段深くなった形にあたる。ここで初めて **rev が境界を渡る**（履歴の要求は `void` だった）が、渡るのは履歴の行が持っていた短い hash だけで、通る形は 16進 4〜40 桁に限ってある。**マージ commit は対象外**にした ── 親が2つ以上あると「どちらと比べるか」が決まらず、git 自身も既定では答えを出さない（理由は面にそのまま出す）。書き込みの口は1つも増えていない。

Session 3-8-13 で足したのは、その履歴の面から**初めて git を書き込みで動かすこと** ── 並んだ1行を始点にブランチを作る（§14.21）。新しい機能というより、3-8-6 で「欄そのものを作っていない」としていた start point が、**選ぶための画面が出来上がったことで初めて意味を持った**もので、チャンネルも `git:create-branch` のままになる（増えたのは要求の欄1つ）。

Session 3-8-15 で足したのは、**3-8-5 の時点から文言だけが案内していた行き先** ── 退避（stash。§14.23）になる。`local-changes-blocked` は最初から「Commit するか**退避して**からお試しください」と書いていたが、後半だけがアプリの中に無かった。ここで初めて**指した先がひとりでに変わる値**を相手にする（`stash@{N}` は名前ではなく上から数えた位置で、1つ避ければ全部がずれる）── したがって pop / drop は、押された瞬間にその位置を解いて hash と突き合わせてから git を動かす。3-8-6 の「自動 stash は渡さない」は1文字も動かしていない。

Session 3-8-14 で足したのは、3-8-6 のブランチの面に残っていた2つ ── **削除と rename**（§14.22）。ここで初めて、ブランチを相手にする操作が `git switch` ではなく `git branch` を動かす ── 前者は作業ツリーをまるごと書き換えるが、後者が書き換えるのは ref 1つで、押した人の書きかけには何も起こらない。したがって待ち時間の上限も失敗の分類の表もそこで分かれ、削除だけが Git で**2つめの確認**を持つことになる（1つめは破棄。§14.16）。

Session 3-8-16 で足したのは、**3-8-10 が開けたままにしていた穴** ── remote の管理（§14.24）になる。remote が1つも無いリポジトリに在ったのは「GitHub に公開」（新しく**作る**側）だけで、既にどこかに在る repository へ繋ぎたい人はアプリの外へ出るしかなかった。ここで 3-8-5 からの「remote を指せる欄を作らない」を**1箇所だけ**緩める ── 足す / 消すは名前で指せるようにし、**送る / 受けるの要求は `void` のまま**にしてある（増えたのは登録簿を編集する口で、送り先を選ぶ口ではない）。同時に、このアプリで唯一 **git に任意のプログラムを起動させうる値**（remote の URL。`ext::sh -c …` は今の git が受け取る）が境界を渡ることになるため、通す形は3つに絞り、Renderer へ返すのは URL ではなく**表示用のラベル**にしてある。

Session 3-8-17 で足したのは、3-8-16 が登録簿に置かなかった**書き換える2つ** ── URL の変更と rename（§14.25）になる。実物に当たって分かったのは、3-8-16 が2つに書いた理由が**片方は当たり、もう片方は逆だった**ことにあたる ── `set-url` は本当に危ない（変わるのは設定の1行だけで、手元の remote-tracking ref は前の送り先のまま残り、画面の `↑ ↓` はもう別の相手と比べた数になる）が、`rename` は git が追跡先も `pushDefault` も全部追随させるため**失われるものが1つも無い**（remove + add より安全にあたる）。したがって確認を挟むのは前者だけで、それが Git で**5つめの確認**、かつ**失われるものが1つも無い唯一の確認**になる。そして remote で初めて「押す前に分かる絶対に通らない理由」が1つできる ── 大文字小文字だけの rename で、`git remote rename` に `--force` が無く**途中まで適用したまま落ちる**ため、3-8-14（ブランチでは `--force` を立てて通した）とは逆に、git を動かす前に断つ。

Session 3-8-18 で足したのは、**3-8-2 から在った「競合」グループに初めて付く操作**になる（§14.26）── 解決し終えたことを Git へ伝える1手にあたる。それまで競合の行にできたのはエディタで開くことだけで、**利用者はアプリの中で直せるのに、直したと伝える手段が無かった** ── その間アプリは3箇所（Commit の断り・退避が押せない理由・pop の結末）で「解決してください」と言っていた。3-8-15 / 3-8-16 と同じ「自分の言葉が指す先を埋める」形で、しかも**その状態はアプリ自身が作れる**（3-8-19 までは `stash pop` が競合を生む唯一の経路で、3-8-20 のマージが2つめの ── そして本来の ── 入口になった）。足したのが1手で済んだのは前後が既に出来ていたためで、3方向マージのエディタは作っていない ── エディタは 3-8-2 から在り、解決後の Commit は 3-8-4 の引数のまま**マージ commit を作って MERGE_HEAD を消す**（実物で確かめてある）。**Stage とは別の操作**にしてあるのがこの回のいちばん大きな決めごとで、動く git は同じ `git add` でも index の3段を1段に畳む操作は「後で Unstage で戻せる」ものではない（`reset` は競合を復元しない）。

Session 3-8-19 で足したのは、**3-8-6 が「別途設計する」と書いて残していた1つ** ── remote-tracking branch から手元にブランチを作ることになる（§14.27）。3-8-6 はローカルブランチだけを一覧に載せ、`--no-guess` で git の推測（名前を打つと remote から生える）まで止めていた ── その判断は撤回しないまま、**別の一覧**として足したのがこの回の形になる。同じ配列に混ぜると「押したら何が起きるか」が行ごとに変わるため、面の3段目に畳んで置き、そこでは**押しても切り替わらない**（ローカル名を確かめる欄が開くだけ）。3-8-16 が remote の**登録簿**を編集する口を開けたのに対し、こちらは**その登録簿が持ってきた ref を指す**初めての口にあたる ── したがって新しい問いが1つ増える：**渡された名前が本当に `refs/remotes/` の下に在るか。** 名前の形の検証（`normalizeGitBranchName`）では答えられないもので（`origin/x` という名前のローカルブランチは作れる）、Main が git に確かめる ── 確かめないと、ローカルブランチ名を渡して「ローカルを追うローカルブランチ」を作れてしまう（git は `branch.<名前>.remote=.` を書いて通す。実物で確かめてある）。そしてこの回で初めて、**同じ名前が埋まっていることを git を動かす前に断る** ── 上書き（`--force`）も、先に消すことも、既にあるブランチへの自動切替もしない（3-8-13 / 3-8-14 の線に、3つめの「押した人が指していないものを相手にしない」が加わる）。一覧は fetch しないので**最後に取得した時点の写し**で、そのことは面にそのまま書く。

Session 3-8-20 で足したのは、**3-8-18 が「口が無い」と書き残していた2つ** ── マージの開始と中止になる（§14.28）。3-8-18 は競合の**出口**（解決済みにする）を置いたが、そこへ至る入口はアプリの中に1つしか無かった（退避を戻したときの競合）── つまり**競合の出口だけを持っていて、入口を持っていなかった**ことになる。この回の中心は新しい画面ではなく**引数を固定すること**にあたる ── `merge --quiet --no-edit --ff --no-autostash` の4つはどれも git の既定と同じ値だが、**書かないと PC ごとの設定（`merge.ff` / `merge.autoStash`）で振る舞いが変わる**（`git pull` を使わないと決めた §14.13 と同じ理由。3つとも実物で確かめてある）。相手は**ローカルブランチだけ**に限り、名前の形の検証だけでは足りないので `branch --list` で `refs/heads/` に在ることを確かめてから動かす ── `git merge` はタグも hash も remote-tracking ref もそのまま受け取るため。競合した結末は `failed` ではなく **`partly-applied`（`completed: 'merge'`）** で返す ── git は自動でマージできた分を既に書き込んでおり、丸めると利用者は押し直して「未解決のファイルがあります」で行き止まる。その先は1手も足していない（競合のグループは 3-8-2、解決は 3-8-18、Commit は 3-8-4 のまま）。「マージの途中か」は `rev-parse --verify MERGE_HEAD` で **git に聞く** ── 「競合している行があるか」からは導けない（解決後もコミットするまで途中のままで、逆に `stash pop` の競合では途中ではない）。中止（`merge --abort`）は `reset --hard` を使わない ── **開始前から在った変更は残し、解決中に書いた内容だけを戻す**ためで、後者があるので押す前に確認を挟む。

Session 3-8-22A で足したのは、**新しい領域ではなく 3-8-1 〜 3-8-21 を1本の流れとして使ったときに引っかかる4つ**になる（§14.30）── 取ってくるだけの口（`git fetch --prune`。3-8-5 から `fetch` は在ったが Pull の中でしか走らず、追跡先が無いブランチでは 3-8-19 の一覧を新しくする手立てが1つも無かった）、途中の Git 操作の検出と禁止（3-8-20 の `merging` を merge / rebase / cherry-pick / revert の4つへ広げ、**何を通さないかの表を shared に置いて Main と Renderer が同じものを読む**）、マージ commit の既定メッセージ（3-8-20 が残していた白紙の Commit 欄）、そして競合の形（`DD` だけは作業ツリーにファイルが無く、そこだけ「押しても開けない行」が残っていた）。3-8-7 と同じ「機能を広げない回」だが、**見つかった穴を塞ぐところまで**行っている点が違う。実物に2つ教わった回でもある ── `REBASE_HEAD` は rebase が完了しても消えない（ref で判定していたらパネルが永久に「rebase の途中」になっていた）、`git stash push` は解決し終えたマージを通してしまう（「git が断るから任せてよい」が成り立たない）。

```
Renderer          git:get-repository（要求は void）
                  git:init（要求は void・§14.17）
                  git:stage / git:unstage（要求は相対位置1つ、またはグループの区別）
                  git:commit（要求はメッセージ1つ・§14.12）
                  git:push / git:pull（要求は void・§14.13）
                  git:fetch（要求は void・§14.30.1）
                  git:commit-and-push（要求はメッセージ1つ・§14.13）
                  git:list-branches（要求は void・§14.14）
                  git:list-commits（要求は void・§14.19）
                  git:get-commit-detail（要求は短い hash 1つ・§14.20）
                  git:get-commit-file-diff（要求は短い hash と位置1つ・§14.20）
                  git:switch-branch（要求は名前1つ・§14.14）
                  git:create-branch（要求は名前1つ + 始点の短い hash か null・§14.14 / §14.21）
                  git:delete-branch（要求は名前1つ・§14.22）
                  git:rename-branch（要求は名前2つ・§14.22）
                  git:merge-branch（要求は名前1つ・§14.28）
                  git:abort-merge（要求は void・§14.28）
                  git:get-merge-message（要求は void・§14.30.3）
                  git:list-remote-branches（要求は void・§14.27）
                  git:create-tracking-branch（要求は ref 名1つ + ローカル名1つ・§14.27）
                  git:get-file-diff（要求は位置1つ + グループ1つ・§14.16）
                  git:get-conflict-diff（要求は位置1つ・§14.29）
                  git:discard（要求は位置1つ + グループ1つ・§14.16）
   ↓
Main handler      handlers/git.ts        読み取りは確かめる値が無い／書き込みは値を1つだけ確かめる
   ↓
Main domain       git/gitRepository.ts   噛み合わせ（読み取り）
                  git/gitInit.ts         噛み合わせ（初期化・§14.17）
                  git/gitStage.ts        噛み合わせ（書き込み・§14.11）
                  git/gitCommit.ts       噛み合わせ（Commit・§14.12）
                  git/gitSync.ts         噛み合わせ（Push / Pull / Commit & Push・§14.13）
                  git/gitFetch.ts        噛み合わせ（Fetch・§14.30.1）
                  git/gitMergeMessage.ts 噛み合わせ（マージの既定メッセージ・§14.30.3）
                  git/gitBranches.ts     噛み合わせ（ブランチの一覧 / 切り替え / 作成・§14.14）
                  git/gitMerge.ts        噛み合わせ（マージの開始 / 中止・§14.28）
                  git/gitHistory.ts      噛み合わせ（commit の履歴・§14.19）
                  git/gitDiff.ts         噛み合わせ（差分・§14.16）
                  git/gitConflictDiff.ts 噛み合わせ（競合の ours / theirs・§14.29）
                  git/gitDiscard.ts      噛み合わせ（破棄・§14.16）
   ├── git/gitQueue.ts         走るのは常に1本（§14.11）
   ├── git/gitOperationResult.ts 応答の形（書き込み操作で共有・§14.12）
   ├── git/gitCommands.ts      引数を組み立てられる唯一の場所
   ├── git/runGit.ts           git を実行する唯一の場所（cwd は現在の Workspace）
   ├── git/gitExecutable.ts    git 本体を PATH から辿る
   ├── git/gitPathspec.ts      pathspec として通してよい形か（純粋・§14.10）
   ├── git/gitOutput.ts        出力の読み取り / パスの比較 / ブランチの一覧 / 履歴 / remote の枝（純粋・§14.14・§14.19・§14.27）
   ├── git/gitStatusOutput.ts  status --porcelain=v2 の読み取り（純粋・§14.8）
   ├── git/gitBlob.ts          ls-files / ls-tree の読み取り・object 名の検査・競合の段と形（純粋・§14.16・§14.29）
   ├── git/gitDiffSide.ts      片側を object から読む（上限 / バイナリ / 改行。3種の差分で共有・§14.16）
   └── git/gitFailure.ts       stderr の分類（純粋）

Main event      git/gitWatcher.ts        `.git` を見張る（Session 3-8-8・§14.15）
   ├── git/gitWatchPaths.ts     拾う名前か（純粋・§14.15）
   └── git/gitChangeSchedule.ts いつ配るか（純粋・§14.15）
   ↓
Renderer        `git:changed` → `files:changed` と同じタイマーへ合流（§14.15）
                履歴を開いている間は、`git:changed` だけをもう1本購読する（§14.19）
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

Session 3-8-6 で増えた3本のうち2本には、**初めてブランチ名が載る**（§14.14）。3-8-5 で「名前で指せる形にしない」と決めたのは Push / Pull の**送り先**についてで、切り替え先は事情が違う ── 利用者が一覧から選んだそのものであり、他に指しようが無い。載るのは名前だけで、`--force` も `--merge` も欄そのものを作っていない（start point だけは Session 3-8-13 で作成の側にだけ増えた。§14.21）。読み取りの1本（`git:list-branches`）だけは `git:get-repository` に相乗りさせていない ── 変更ファイルの一覧と違い、**見られているのは面を開いている一瞬だけ**で、相乗りさせると保存のたびにブランチを数え直すことになる（§14.14）。

Session 3-8-11 で増えた1本は、**また要求が `void` に戻る**（§14.19）── rev も件数も並べ替えも絞り込みも渡す欄が無く、返るのは常に「今の HEAD からさかのぼった 100 件」になる。ここは欄を作りたくなる場所で（別のブランチの履歴・特定のファイルの履歴・作者で絞る）、そのどれもが `git log` へ値を渡す形になる ── 見ているブランチを変える手立ては既にあり（上のバーで切り替える）、切り替えれば履歴もそのブランチのものになる。読み取りだが `git:get-repository` に相乗りさせていないのは `git:list-branches` と同じ理由で、**見られているのは履歴を開いている間だけ**にあたる。

Session 3-8-12 で増えた2本で、**初めて rev が要求に載る**（§14.20）。3-8-1 から一度も開かなかった欄がここで1つだけ開くのは、commit 1件を開くには「どれを」を言うしかないためになる ── ただし開くのはそこまでで、通す形は **16進 4〜40 桁**に限ってある（`HEAD~5` も `main@{1}` も `:/要約` も `<hash>:<path>` も通らない。`main/git/gitCommitHash.ts`）。つまり「rev を渡せる欄」ではなく**履歴に出した行を指すための欄**で、打ち込む場所がどこにも無い以上、一覧に出ていない commit を指す手立ては作れない。値は `--end-of-options` の後ろの独立した1つの引数として渡り、位置は最後まで pathspec のままになる。差分の1本を `git:get-file-diff` と分けてあるのは、あちらが `group`（今の作業ツリーのどの段か）で相手を決めるのに対しこちらは rev で決めるためで、1本にすると片方だけが意味を持つ欄が2つ並ぶ。

Session 3-8-15 で増えた4本のうち、値が載るのは2本だけになる（§14.23）。載るのは**位置と短い hash の2つ**で、片方だけでは足りない ── `stash@{N}` は名前ではなく上から数えた位置で、一覧を出してから押すまでの間に1つ避けられれば別の退避を指す。hash を通す関数は commit の詳細とまったく同じ（`normalizeGitCommitHash`。**退避も commit** にあたる）で、入口を分けると「詳細では開けないが、退避としては指せる」hash が生まれる。位置の側は、このアプリで**初めて数を確かめる欄**になる（`stashIndexField`）── ここまで確かめてきたのは全部文字列の形だった。残る2本（一覧と退避そのもの）は要求が `void` に戻る。

Session 3-8-16 で増えた3本のうち、値が載るのは2本になる（§14.24）。追加が**1つの要求に外来の値を2つ運ぶ2つめ**にあたる（1つめは 3-8-14 の rename）── ただしあちらの2つが同じ規則を通ったのに対し、こちらの2つは性質そのものが違う。**名前は境界を往復する値**（一覧の行に載り、削除の要求に載る）で、**URL は Renderer → Main へ1回だけ流れる値**になる（一覧には載らない）。URL がこのアプリで初めて「渡せる欄を作らないと機能が成り立たないのに、値自身が実行の経路を持つ」ものにあたるため、通す形は `https://…` / `ssh://…` / `user@host:path` の3つに決め打ちしてある ── 知らない形は、危なくなくても通さない。残る1本（一覧）は要求が `void` に戻り、**返るものにも URL は無い**。

Session 3-8-17 で増えた2本は、**値の種類を1つも増やしていない**（§14.25）── URL の変更が運ぶのは追加とまったく同じ「名前と URL」で、rename が運ぶのは 3-8-14 と同じ「名前2つ」になる。通す関数も既にあるものをそのまま使う（`normalizeGitRemoteName` / `normalizeGitRemoteUrl`）── 入口を分けると「追加では通らないが変更では通る URL」「元の名前としては通るが新しい名前としては通らない」が生まれ、`ext::sh -c …` を断っている根拠がその日に半分になる（`git remote set-url x "ext::sh -c whoami"` も `git remote rename --end-of-options up2 -x` も、git はそのまま受け取る）。`git:add-remote` に「既にあれば上書き」を足して1本にしないのは `git:stage` / `git:unstage` と同じ判断で、増えたのは今回も**登録簿を編集する口**だけになる ── `git:push` / `git:pull` の要求は今も `void` のままにあたる。

Session 3-8-21 で増えた1本には、**位置1つだけ**が載る（§14.29）── 3-8-9 の差分と違い `group` は載らない（対象は必ず競合のグループの行で、他から押せる場所が無い）。既にある `git:get-file-diff` に混ぜていないのがこの回の決めごとで、**位置1つを渡して中身2つが返る**形は同じでも、左右の意味が違う ── あちらは前 → 後（時間の向きがある）で、こちらは ours / theirs（向きが無い）になる。混ぜると答えの意味が要求によって変わるチャンネルが1本でき、`GitFileDiff.kind` が競合の行でだけ意味を失う。**段（stage）を渡せる欄も作っていない** ── 返るのは常に stage 2 と stage 3 の1組で、base を含む3方向は別のチャンネルと別の面として設計する。読み取りなので `git:get-repository` には相乗りさせず、理由は 3-8-9 とまったく同じ**「見られているのは1行を選んだ一瞬だけ」**になる。

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

| 作らない欄                      | なぜ                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `--force` / `--discard-changes` | 作業ツリーの書きかけを黙って捨てる                                              |
| `--merge`                       | 書きかけを切り替え先へ持ち込み、**競合を作りうる**                              |
| `--detach` / `--orphan`         | ブランチから降りる／履歴を持たない枝を作る。切り替えの口ではない                |
| 削除 / rename                   | `switch` のオプションではない。**別のコマンド**として 3-8-14 で足した（§14.22） |

**start point（どの commit から）だけは、Session 3-8-13 で作成の側にだけ足した**（§14.21）。3-8-6 で作らなかったのは「切り替え」と「別の場所から作る」が1つの口に混ざるためで、そこは変えていない ── 足したのは `git:create-branch` の要求だけで、`git:switch-branch` には今も欄が無い。値が入るのは履歴の行から作ったときだけになる。

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

競合（`conflicted`）は 3-8-9 の時点では対象外にしてあった。「前」と「後」が2組（ours / theirs）あり、**2つの中身を並べる形そのものが当てはまらない**（Stage / Unstage を置いていないのと同じ理由。§14.8）。

**Session 3-8-21 でその診断に答えが出た** ── 器を増やすのではなく**組を1つに決める**（stage 2 と stage 3 を並べ、merge base は出さない）。競合の行にも差分ボタンが出るが、行き先は**別のチャンネル**（`git:get-conflict-diff`）で、`GitDiffGroup` に競合は今も混ざらない（§14.29）。破棄の側は対象外のままになる（何に戻すかが決まらない）。

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

#### 確認を挟むのは、Git ではこれが1つめ（3-8-14 で2つ・3-8-15 で3つになった）

Stage / Unstage も Commit も Push も、押しても失われるものが無い（あるいは失われるなら git が断る）。確認は**押した人にしか止められないもの**に限ってある（§12.6）。

3-8-9 の時点ではこれが唯一だったが、3-8-14 でブランチの削除が2つめ（§14.22）、3-8-15 で退避を捨てることが3つめになる（§14.23）。**3つの重さは同じではない** ── いちばん重いのは3つめで、捨てた退避の中身はどのブランチからも辿れなくなる（削除が通るのはマージ済みのときだけなので commit は残る）。以下の表は最初の2つを比べたものになる。

| 何を消すか        | 破棄（3-8-9）                | ブランチの削除（3-8-14）                        |
| ----------------- | ---------------------------- | ----------------------------------------------- |
| 失われるもの      | **利用者が書いた中身**       | 枝の**名前**とその reflog                       |
| commit は消えるか | ―                            | 消えない（`-d` はマージ済みのときしか通らない） |
| 文言              | 「元に戻せません」と言い切る | 「コミットが失われます」とは**書かない**        |

言い方を揃えないのがここでの要点にあたる ── 削除で「コミットが失われます」と出すと嘘になり、しかも**本当に失われる場面（破棄）の警告まで軽く読まれる。** 確認の文言は、出す回数が増えるほど1つ1つの重さを正しく書き分ける必要がある。

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

### 14.18 Session 3-8-1 〜 3-8-22A の範囲外

| 項目                                                  | 状況                                                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 複数ファイルの任意選択                                | Stage は「1件」か「グループのすべて」だけ。任意の複数を渡せる欄は作らない（§14.11）                                                                               |
| すべて Unstage                                        | 置いていない。Commit の中身を丸ごと空にする操作で、押し間違いの代償が釣り合わない                                                                                 |
| 強制 Push（`--force` / `--force-with-lease`）         | 欄そのものを作っていない。他人の commit を消しうる操作で、押し間違えたときに戻せない（§14.13）                                                                    |
| 自動 merge / rebase（Pull）                           | `--ff-only` 固定。どちらを選ぶかはリポジトリの流儀で決まり、アプリが黙って決めてよいことではない（§14.13）                                                        |
| Push / Pull / 切り替えの取り消し                      | 持たない。動いている git を途中で止める手段（キャンセル）は後続のセッションで、Terminal の終了確認と同じ形で設計する                                              |
| Push / Pull の送り先を選ぶ                            | 選べない。要求は今も `void` で、決めるのはリポジトリの設定になる ── 3-8-16 / 3-8-17 で増えたのは**登録簿を編集する口**だけ（§14.24 / §14.25）                     |
| `git://` / `http://` / ローカルのパスの remote        | 登録できない。通す形は3つだけで、**知らない形は危なくなくても通さない**。変更（`set-url`）でも同じ（§14.24 / §14.25）                                             |
| 認証情報を含む URL（`https://<token>@…`）             | 断る。通すと、アプリが利用者の token を `.git/config` へ平文で書くことになる（設計判断 7・§14.24）                                                                |
| remote の URL を Renderer へ渡す                      | 渡さない。一覧に載るのは**表示用のラベル**だけで、そこから URL は組み立て直せない ── 3-8-17 の変更の欄も**空から始まる**（§14.25）                                |
| 一覧に「今どれが使われているか」を出す                | 出さない。出すと、その隣に「これを使う」を置きたくなる ── 3-8-5 からの線を一覧の側からも崩さない（§14.24）                                                        |
| remote を足した直後の fetch（`--fetch`）              | 渡さない。追加した1回で起きることを「設定に1行増える」だけに保つ（§14.24）                                                                                        |
| 大文字小文字だけの remote の rename                   | 通さない。git は**途中まで適用したまま落ちる**（`--force` に当たる引数が無い）── 動かす前に断る（§14.25）                                                         |
| `set-url` の後の remote-tracking の掃除               | しない。`--prune` を渡すと ref を消す操作が変更に混ざり、削除との境目が消える ── 残った ref は次の Pull で揃う（§14.25）                                          |
| `set-url --push` / `--add` / `--delete`               | 置いていない。一覧が載せるのは fetch 側1つで、1つの remote に URL を複数持たせる形を表せない（§14.25）                                                            |
| remote の一括削除 / 一括 rename / `remote prune`      | 置いていない。渡せるのは1件で、複数を渡せる欄は作らない（Stage の「任意の複数」と同じ線。§14.24 / §14.25）                                                        |
| URL の変更 / rename の取り消し                        | 持たない。打ち直せば戻せる ── アプリが前の値を覚えておく形にはしない（§14.25）                                                                                    |
| 特定のブランチ / tag だけを Push                      | 送るのは常に「今のブランチ」。refspec を渡せる欄は作らない（§14.13）                                                                                              |
| Push / Pull の進捗表示                                | 「動いている」までで、何 % かは出していない。`--porcelain` も使わず、結末は終了コードで決める（§14.13）                                                           |
| amend / sign / author / date の変更                   | 欄そのものを作っていない。履歴に永久に残るものを Renderer から書き換えられる形にしない（§14.12）                                                                  |
| `--no-verify`（hook の迂回）                          | 持たない。リポジトリが置いた決まりごとをアプリが黙って外すことになる（§14.12）                                                                                    |
| 空の Commit（`--allow-empty`）                        | 持たない。押したのに何も起きない、の別の形にあたる（§14.12）                                                                                                      |
| Commit テンプレート / 専用エディタ                    | 入力欄は `<textarea>` 1つ。改行は通るが、書式を用意する側には回らない                                                                                             |
| Commit メッセージの AI 生成                           | 走査の入口が別のもの（差分の中身）になるため、別の経路として設計する                                                                                              |
| Git identity の設定 UI                                | 未設定なら失敗として案内するだけ。**アプリからは設定しない**（§14.12）                                                                                            |
| 強制削除（`branch -D`）                               | 欄そのものを作っていない。そこにしか無い commit を到達不能にする ── 断って Terminal へ案内する（§14.22）                                                          |
| 名前を奪う rename（`branch -M`）                      | 既定では渡さない。相手が**自分自身**だと確かめられた1点（大文字小文字だけの改名）でだけ立てる（§14.22）                                                           |
| ブランチの一括削除 / マージ済みをまとめて消す         | 置いていない。渡せるのは名前1つで、複数を渡せる欄は作らない（Stage の「任意の複数」と同じ線。§14.22）                                                             |
| 一覧に「マージ済みか」を出す                          | 載せない。載せると一覧を開くたびに git へ聞くことが増える ── 基準を持つのは git で、断られたら理由が返る（§14.22）                                                |
| commit が1つも無いリポジトリのブランチを改名          | 手立てが無い。unborn では ref が1つも無く、一覧が空になる（行が無ければ ✎ も無い。§14.22）                                                                        |
| rename に合わせて追跡先を付け替える                   | しない。`branch.<新名>.merge` は古い remote 側の名前を指したまま残る ── remote を指せる欄を作らない線のまま（§14.22）                                             |
| remote branch の削除 / rename                         | 対象外。一覧に出ていないものは指せず、削除は他人に影響してサーバー側で戻せない（§14.22）                                                                          |
| ブランチの削除 / rename の取り消し                    | 持たない。消えた名前を戻す手立ては reflog の中にあり、それを読む画面は無い（§14.22）                                                                              |
| remote-tracking branch を1つの一覧に混ぜる            | 混ぜない。押したら何が起きるかが行ごとに変わる ── 3-8-19 は**別のチャンネル・別の一覧**として足した（§14.14 / §14.27）                                            |
| 一覧を開く前の fetch                                  | しない。開くたびにネットワークへ出る形にしない ── 出るのは最後に取得した時点の写しで、そのことを面に書く（§14.27）。**取得そのものは §14.30.1 の Fetch で押せる** |
| remote-tracking の掃除（`fetch --prune`）             | **§14.30.1 の Fetch に含めた**。§14.27 が否定したのは「一覧を**開く**操作に消す働きを混ぜること」で、押したときだけ消える形とは矛盾しない                         |
| Fetch の相手を選ぶ（`--all` / remote 名）             | 選べない。相手は今のブランチの remote のまま ── `--all` は**名前を1つも見ていない相手の ref を消す**ことになる（§14.30.1）                                        |
| rebase / cherry-pick / revert を始める・終わらせる    | 置いていない。§14.30.2 で足したのは**検出と禁止だけ**で、`--continue` も `--abort` も持たない ── 行き先は Terminal になる                                         |
| 途中の操作を出す先（帯以外）                          | 出さない。ステータスバーにも Files にも出さない ── 出すのは Git パネルの帯1箇所で、そこに次の一手が書いてある（§14.30.2）                                         |
| `bisect` の途中の検出                                 | 見ない。書き込みを止める必要がある4つ（merge / rebase / cherry-pick / revert）と違い、**index も作業ツリーも競合状態にしない**（§14.30.2）                        |
| remote-tracking へ直接切り替える（detached）          | 置いていない。名前を付けずに移る形は持たず、指した先に**名前を付けて**移る（§14.21 と同じ線。§14.27）                                                             |
| 追跡しない作成（`--no-track`）                        | 欄そのものを作らない。追跡しない作成は `git:create-branch` が既にその形で、この口の意味は追跡先が付くことそのものになる（§14.27）                                 |
| 追跡先の後付けの変更（`branch --set-upstream-to`）    | 置いていない。追跡先は作るときに決まり、後から付け替える口は持たない ── remote を指せる欄を作らない線のまま（§14.27）                                             |
| 同名があるときの上書き / 削除 / 自動切替              | しない。git を動かす前に `branch-exists` で断る ── 同じ名前の**別物**であることは普通に起こる（§14.27）                                                           |
| `origin/HEAD` を一覧に出す / 始点にする               | どちらもしない。既定のブランチを指す**別名**で、追うと remote 側の既定が変わった日に追跡先が黙って移る（§14.27）                                                  |
| remote-tracking branch の一括取り込み                 | 置いていない。渡せるのは1件で、複数を渡せる欄は作らない（Stage の「任意の複数」と同じ線。§14.27）                                                                 |
| 一覧に無いブランチへ名前で切り替える                  | 切り替え先は**一覧から選んだものだけ**。上限を超えた分は Terminal パネルで扱う（§14.14）                                                                          |
| 切り替え時の自動 stash / merge（`--merge`）           | 渡さない。決めるのは git 自身で、判断は上書きしない ── **手で押す退避は §14.23 で別に足した**（§14.14）                                                           |
| ブランチの追跡先を設定する（`--track`）               | 渡さない。始点はどちらの場合もローカルの commit で、追跡先を付けるかはリポジトリの設定の領分になる（§14.14）                                                      |
| ブランチを**作るだけ**（切り替えない）                | 置いていない。作成は常に `switch --create` の1回で、作れば必ずそこへ移る（§14.21）                                                                                |
| 履歴から**切り替える**（detached HEAD を作る）        | 置いていない。commit を指して移る手立ては持たず、指した先に**名前を付けて**移る（§14.21）                                                                         |
| 始点を打ち込む欄 / 履歴に無い commit を始点に         | 渡せるのは履歴の行が持っていた短い hash だけ。3-8-12 の線をそのまま保つ（§14.21）                                                                                 |
| ブランチを別の commit へ付け替える（`--force`）       | 欄そのものを作っていない。元の枝がどこにあったかを見失わせる ── 同じ名前は `branch-exists` で断る（§14.21）                                                       |
| 初回 Commit の自動化                                  | しない。最初の commit に何を含めるかは利用者の判断で、履歴の1つめは後から直しにくい（§14.17）                                                                     |
| `.gitignore` の生成 / テンプレート                    | 置かない。何を無視するかは言語もツールも人も選ぶ話で、アプリの「とりあえずの1つ」が正本のように残る（§14.17）                                                     |
| 初期ブランチ名を選ぶ                                  | 素の `git init` に任せる。`init.defaultBranch` を設定した人の意図をアプリの中でだけ上書きしない（§14.17）                                                         |
| 所有者（Organization）を選んで公開                    | 欄そのものを作っていない。ログインしているアカウントの下に作る ── 選ばせるなら「どこに作られたか」を出す画面と一緒に                                              |
| 説明文 / トピック / README の設定                     | 渡す欄が無い。GitHub 側でいつでも書ける（README を作らせると初回 Push が必ず断られる。§14.17）                                                                    |
| 既にある repository を選んで remote にする            | しない。同じ名前があれば断る（`github-repository-exists`）── 別名で作り直すことも上書きもしない（§14.17）                                                         |
| 公開の取り消し（repository の削除）                   | 持たない。作った repository を消す口は、公開の失敗時にも用意していない（§14.17）                                                                                  |
| 作った repository を開く / URL を出す                 | URL は Main の中だけに留める。Renderer へ渡すと、それを指して何かを頼む欄が欲しくなる（§14.4 と同じ線）                                                           |
| GitHub Enterprise / 別ホストへの公開                  | 相手は github.com に固定。選べるようにするなら「どこへ公開するか」の画面と一緒に設計する（§14.17）                                                                |
| GitHub CLI 以外の経路（自前の OAuth）                 | 持たない。token を保管する設計がアプリ1つ分増える。差し替えるなら境界の実装1つで済む形にしてある（§14.17）                                                        |
| GitHub CLI の自動インストール                         | しない。出すのは案内と winget の1行だけ（§14.17）                                                                                                                 |
| 認証情報の保存                                        | アプリ自身では持たない。git は credential.helper、GitHub は gh に任せる（設計判断 7・§14.17）                                                                     |
| `.git` の中身を Renderer へ渡す                       | `git:changed` が運ぶのは `workspaceId` だけ。何が変わったかは載せない（§14.15）                                                                                   |
| Main から Git の**状態**を push                       | 押し出すのは「調べ直して」という合図までで、状態そのものは要求と応答で運ぶ（§14.15）                                                                              |
| 監視の除外を Settings から変える                      | `.git` の中で拾う名前は固定の表（§14.15）。`ignoredDirectories.ts` と同じく、設定から読む形は後                                                                   |
| submodule / worktree の `.git` を追う                 | `modules/` も `worktrees/` も拾わない。どちらも「Workspace root ＝ リポジトリ root」の前提から外れる（§14.15）                                                    |
| サブフォルダのリポジトリを自動で選ぶ                  | 選ばない。root が食い違えば操作しない（§14.4）                                                                                                                    |
| worktree / submodule / sparse checkout                | どれも「Workspace root ＝ リポジトリ root」という前提から外れる。別の設計が要る                                                                                   |
| ステージ済みの破棄（1回で index も作業ツリーも）      | 置いていない。**先に Unstage** してもらう ── 1回で失われるものが2段になる（§14.16）                                                                               |
| グループごとの一括破棄 / すべて破棄                   | 置いていない。Stage の押し間違いは Unstage で戻せるが、破棄には戻せる先が無い（§14.16）                                                                           |
| 未追跡のフォルダ1件の破棄                             | 断る。1行に見えて中身は数万件になりうる。行にも出さず、Main も届いた対象を確かめて断る（§14.16）                                                                  |
| `git clean` / `reset --hard`                          | 使わない。前者はごみ箱を経由せず、後者は指した1件より広い範囲を戻す（§14.16）                                                                                     |
| 差分の中からの編集 / 行単位の Stage                   | Diff Editor は読み取り専用。直すのは元のエディタで行う ── 保存の入口を2つにしない（§14.16）                                                                       |
| 履歴の2点を比べる（2つの commit を選ぶ）              | 選べる欄そのものを作っていない。**渡せる rev は常に1つ**で、比べる相手はその親に固定される（§14.20）                                                              |
| 差分の `--textconv` / `--ext-diff`                    | 付けない。どちらもリポジトリの設定にある**任意のプログラム**を起動する指定にあたる（§14.16）                                                                      |
| 競合しているファイルの差分                            | **3-8-21 で実装済み**（stage 2 と stage 3 を並べる別のチャンネル）── 3-8-9 は「並べる形が当てはまらない」として外していた（§14.16 / §14.29）                      |
| 競合しているファイルの破棄                            | 対象外のまま。**何に戻すかが決まらない**（ours / theirs / merge base の3つ）── 戻す先を選ばせる画面と一緒に設計する（§14.16）                                     |
| 改行だけの違いを差分として出す                        | 出せない。左右とも LF に均してある ── 均さないと `core.autocrlf` の環境で全行が変更として出る（§14.16）                                                           |
| 3方向マージのエディタ                                 | 置いていない。解決はエディタで行い、アプリが持つのは**解決し終えたと Git へ伝える**1手だけになる（§14.26）                                                        |
| 競合の ours / theirs の差分                           | **3-8-21 で実装済み**（3-8-18 / 3-8-20 が「候補」として残していたもの）── 器は 3-8-9 の2ペインのまま（§14.29）                                                    |
| 競合の3方向（base を含む）Diff                        | 置いていない。Diff Editor が受け取るのは2つの中身で、3つ並べるには面も部品も別に要る ── 別のチャンネルと別の面として設計する（§14.29）                            |
| ours / theirs を作業ツリーへ採る（`checkout --ours`） | 置いていない。**利用者が書きかけた解決内容を上書きする** ── 3-8-18 が取り消しを置かなかったのと同じ側にあたる（§14.29）                                           |
| 差分の面からの「解決済みにする」                      | 置いていない。面は読み取り専用のまま ── 同じ操作の入口が2つになり、押せる条件を2箇所で説明することになる（§14.26 / §14.29）                                       |
| rename の競合3行を1つに束ねる                         | 置いていない。「どの3行が同じ1つの出来事か」は `status` の出力から読めない（git は3件として返す。§14.29）                                                         |
| `REBASE_HEAD` / `CHERRY_PICK_HEAD` を読む             | 読まない。ours / theirs の意味づけを増やせるが、そこまで足しても「どれでもない競合」（`stash pop`）は残る ── 中立の表現が受け皿になる（§14.29）                   |
| 競合しているファイルの検索 / 絞り込み                 | 置いていない。競合の行は一覧の1グループのままで、そこに絞り込みの欄は作らない（§14.29）                                                                           |
| submodule の競合の差分                                | 出さない。mode `160000` は blob ではなく commit を指す ── `unsupported-target` として明示的に返す（§14.29）                                                       |
| 競合の解決の取り消し                                  | 持たない。`reset` は競合を復元せず、`checkout --merge` は書いた解決内容を上書きする ── どちらも取り消しにならない（§14.26）                                       |
| マージを始める / やめる                               | **3-8-20 で実装済み**（ブランチの行から取り込み、パネルの帯から中止）── 3-8-19 まで口が無かった（§14.28）                                                         |
| マージの戦略（`-X ours` / `-X theirs`）               | 渡さない。競合を**自動で潰す**もので、書いた人の中身が黙って消えうる（§14.28）                                                                                    |
| `--no-ff` / `--squash` / `--no-commit`                | 選ぶ欄を作らない。履歴の形を決める判断で、リポジトリの流儀によって答えが違う ── 早送りできるなら早送りする（§14.28）                                              |
| `--allow-unrelated-histories`                         | 渡さない。無関係な2つの履歴が1つの枝に混ざり、戻すには merge commit を reset することになる（§14.28）                                                             |
| remote-tracking branch を直接マージする               | 置いていない。相手はローカルブランチだけ ── 取り込むには §14.27 で手元に作るか、Pull を使う（§14.28）                                                             |
| マージ commit を作った後の取り消し（`reset`）         | 持たない。作った後に戻す口はアプリに無く、行き先は Terminal パネルになる（§14.28）                                                                                |
| 複数ブランチの一括マージ                              | 置いていない。渡せるのは1件で、複数を渡せる欄は作らない（Stage の「任意の複数」と同じ線。§14.28）                                                                 |
| マージのメッセージを打つ（`-m`）                      | 欄そのものを作らない。merge commit の文面は git の既定（`Merge branch 'x'`）に任せる（初期ブランチ名と同じ線。§14.28）                                            |
| 競合の一括解決                                        | 置いていない。渡せるのは1件で、複数を渡せる欄は作らない（Stage の「任意の複数」と同じ線。§14.26）                                                                 |
| 競合したファイルの破棄                                | 対象外のまま。**何に戻すかが決まらない**（ours / theirs / merge base の3つ）── 差分の側は 3-8-21 で答えが出た（§14.29）                                           |
| 退避に名前を付ける（`-m`）                            | 欄そのものを作らない。名乗りは git が付ける（`WIP on <branch>: …`）── 初期ブランチ名と同じ線（§14.23）                                                            |
| 未追跡も退避する（`-u` / `-a`）                       | 渡さない。1行に見えて中身が数万件になりうるものを作業ツリーから消す（§14.16 の破棄と同じ事情。§14.23）                                                            |
| 残したまま戻す（`stash apply`）                       | 置いていない。「戻す」の口を2つにすると、一覧に残るかが押し方次第で変わる（§14.23）                                                                               |
| 段まで戻す（`stash pop --index`）                     | 渡さない。戻ると unstaged として並ぶ ── Stage は一覧の `＋` で1回で戻せる（§14.23）                                                                               |
| 退避の中身を見る（`stash show`）/ 差分                | 置いていない。指し方（`stash@{N}`）が hash ではなく、§14.20 の経路にそのままは載らない（§14.23）                                                                  |
| 退避からブランチを作る（`stash branch`）              | 置いていない。§14.21 の「始点」と混ざる ── 履歴の行から作る形とは別の問いになる（§14.23）                                                                         |
| 一括で捨てる（`stash clear`）/ 部分退避（`-p`）       | 置いていない。渡せるのは1件で、後者は対話が始まる（ブランチの一括削除・行単位の Stage と同じ線。§14.23）                                                          |
| 捨てた退避を戻す                                      | 持たない。`git fsck --unreachable` で拾える間は残るが、それを読む画面は無い（§14.23）                                                                             |
| 退避を「どのブランチのものか」で絞る                  | `refs/stash` は1つで、どのブランチで避けたものも同じ列に並ぶ ── 作らないのではなく在りようが無い（§14.23）                                                        |
| Graph（枝の線）/ rebase / tag                         | 履歴は 3-8-11 で**読むところまで**（§14.19）。線を引くには全部の親と並べ方が要り、他の2つは履歴を書き換える                                                       |
| 100 件より前の履歴（続きを読む / 期間で絞る）         | 置いていない。**どこまで読んだか**を覚える状態が1つ増える。それより前は Terminal パネルの `git log` で見る（§14.19）                                              |
| 履歴の絞り込み（ファイル / 作者 / 語）                | 欄そのものを作っていない。pathspec も正規表現も `git log` へ渡す値になる（§14.19）                                                                                |
| 別のブランチ / rev の履歴                             | rev を渡せる欄は作らない。見るブランチを変える手立ては上のバーの切り替えそのものになる（§14.19）                                                                  |
| マージ commit の変更ファイル / 差分                   | 出さない。親が2つ以上あると**どちらと比べるか**が決まらず、git 自身も既定で答えない。理由を面に出す（§14.20）                                                     |
| 500 件より多い変更ファイル（続きを読む）              | 置いていない。**どこまで読んだか**を覚える状態が1つ増える。それより先は Terminal の `git show --stat`（§14.20）                                                   |
| commit の中の1ファイルの履歴を辿る                    | 置いていない。`--follow` も pathspec も `git log` へ渡す値になる（§14.19 の絞り込みと同じ線）                                                                     |
| 履歴からの revert / cherry-pick / reset / amend       | 1つも置いていない。履歴の面から動く書き込みは `switch --create` の1つだけで、**失われるものが無い**もの（§14.21）                                                 |
| 完全な commit hash を Renderer へ渡す                 | 渡さない。出すのは短い方だけで、詳細を頼むときに渡るのもその短い方になる（§14.19・§14.20）                                                                        |
| commit の中からファイルを開く / 復元する              | 置いていない。開けるのは差分（読み取り専用）までで、過去の中身を作業ツリーへ書き戻す口は無い（§14.20）                                                            |
| committer / メール / 本文 / 署名の検証                | 載せない。画面に出ないものを 100 件ぶん IPC の向こうへ運ばない（§14.19）                                                                                          |
| 書いた人の timezone での日時表示                      | 出すのは**見ている人の時計**での日時だけ。1行に2つの時刻を並べない（§14.19）                                                                                      |
| GitHub の API（Issues / PR / Actions）                | git の実行とは別のドメイン（ネットワークと認証が絡む）                                                                                                            |

### 14.19 commit の履歴（Session 3-8-11）

ここまでの Git 機能が相手にしていたのは、どれも**今の作業ツリーと index**（＝これから記録するもの）だった ── 変更の一覧・差分・Stage・Commit・破棄。3-8-11 で初めて**既に記録された側**を出す。

性質がいちばん違うのは、**この面から変えられるものが1つも無い**ことになる。動かす git は `log` の1本だけで、revert も cherry-pick も reset も amend も置いていない（§14.18）。したがって `GitOperationResult` も `pending` の目印も要らず、押せる条件も押せない理由も無い ── 3-8-3 以降ずっと出てきた「押せるか / なぜ押せないか」（`GitActionReadiness`）が、この機能にだけ1つも現れない。

#### 渡せる欄をまた1つも作らない

要求は `void`。rev も件数も並べ替えも絞り込みも欄そのものが無く、返るのは常に「今の HEAD からさかのぼった 100 件」になる。

ここは**欄を作りたくなる場所**にあたる ── 別のブランチの履歴を見る・特定のファイルの履歴だけを見る・作者で絞る。どれも `git log` へ値を渡す形になり、その値は rev（`HEAD~5`）でも pathspec でも正規表現（`--author=`）でもありうる。3-8-1 で決めたとおり、**危ないものを弾くのではなく渡せる欄そのものを作らない**（`shared/ipc/contracts/git.ts`）。

見ているブランチを変える手立ては既にある ── 上のバーで切り替えれば、履歴もそのブランチのものになる（実 git で確かめてある。[DEVELOPMENT.md](DEVELOPMENT.md) §3）。

`git log` に固定で足しているのは3つで、どれも**外から来ない**。

| 引数                         | 理由                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `--max-count=<上限 + 1>`     | 上限は `GIT_COMMIT_HISTORY_LIMIT`（アプリ自身の定数）。1つ多く求めるのは**切れたと分かる**ため |
| `--no-decorate`              | `log.decorate` の設定で出力が変わりうる余地を残さない                                          |
| `-c log.showSignature=false` | 設定から `gpg` の起動を促されうる項目を先に打ち消す（`--textconv` を付けない §14.16 と同じ線） |

#### 出力の読み方は `for-each-ref` と同じ形にした

書式は `%h%x00%an%x00%at%x00%P%x00%s`。**欄の区切りは NUL** で、行の区切りは改行になる（`%s` は commit メッセージの1行目だけなので、改行は入らない）。目に見える文字を区切りにすると、その文字を含む要約で名乗りや日時の列がずれる ── 実 git に日本語・空白・`|`・`--force` を含む要約を書かせて確かめてある。

**要約は最後の欄に置く。** そこだけが「何が入っているか分からない値」で、後ろに欄を足さない限り、区切りの数え間違いが起こらない。

日時に `%ad` ではなく **`%at`（epoch 秒）** を使うのは、`%ad` の形がリポジトリの設定（`log.date`）で変わるためになる ── PC ごとに違う形の文字列が画面に出ることになり、しかも相対表示（「3分前」）を作るには受け取った側で日時へ戻すことになる。

読めない行（欄が足りない・hash の形ではない・日時が数として読めない）は**その行だけ落とす。** 1行のために履歴全体を失敗にすると、他の 99 件を見る手立てまで消える（ブランチの一覧と同じ判断・§14.14）。逆に、**要約が空の行は落とさない** ── `--allow-empty-message` で作られた commit は実在し、消すとその1件だけ順番が飛ぶ。

#### commit が1つも無いことを、失敗にしない

`git log` は HEAD の指す先が無いと**非0で終わる**。そのまま `failed` にすると、`git init` した直後のリポジトリで「履歴を取得できませんでした」と出ることになる ── 正しくは「まだ commit がありません」で、次の一手はこの面ではなく下の Commit 欄にある。

そこで、動かす前に `hasGitHeadCommit()` で分けて **`ready` の空**として返す。この関数は Unstage（§14.11）と Push（§14.13）が既に使っているもので、「まだ commit が無い」という同じ問いに別の判定を新しく置いていない。

#### 載せているのは、その行に出るものだけ

| 載せる                    | 載せない                                             |
| ------------------------- | ---------------------------------------------------- |
| 短い hash（`%h`）         | 完全な hash（40桁）── 指して何かを頼む先が無い       |
| 要約（`%s`）              | 本文（`%b`）── 一覧の1行に収まらない                 |
| author の名前（`%an`）    | メール / committer / 署名の検証                      |
| author の日時（`%at`）    | 書いた人の timezone / 変更されたファイルの一覧 / tag |
| 親の**数**（`%P` の個数） | 親の hash                                            |

`GitLocalBranch` が名前と印しか持たないのと同じ考え方で、**画面に出ないものは載せない**（100 件ぶんを誰も読まないまま IPC の向こうへ運ばない）。

例外に見えるのが `parentCount` で、これだけは数そのものが画面に出ない ── 出るのは「マージ」という1語になる。それでも `isMerge: true` にしていないのは、**どこで決めたのかが Main の中に隠れる**ため。境界を渡るのは git が答えた事実（親がいくつか）で、それを「マージ」と呼ぶかどうかは画面の側の判断にあたる（`renderer/src/git/gitHistory.ts`）。

#### 上限は 100 件で、切ったことを言う

履歴は**上限を置かなければ際限が無い**唯一の一覧になる（変更ファイルは作業ツリーの大きさで、ブランチも数千で頭打ちになる）。100 件は「今いる場所からさかのぼって眺める」ぶんとして十分に多く、IPC を1回で渡すには十分に小さい。

**黙って切らない。** 切れていることを `truncated` として返し、面の下にそう出す（一覧の上に置くと、開くたびに一番上に現れて読みたい行の位置がずれる）。100 件はよく使うリポジトリなら数週間ぶんでしかないため、ブランチの一覧より切れやすい ── 言わずに済ませると「それより前が消えた」と読まれる。

**続きを読む欄は作っていない**（§14.18）。足すと「どこまで読んだか」を覚える状態が1つ増え、その状態は `git:changed` で取り直すたびに整合を取り直すことになる。

#### 日時は、本文が相対で hover が絶対

履歴を開いた人がまず知りたいのは「**どれくらい前か**」で、`2026/08/25 20:04` からその答えを出すには今の日時を思い出して引き算することになる。逆に「いつだったか」を正確に知りたい場面もあり、そちらは `title`（hover）と読み上げに渡してある ── 1行に両方を並べると、100 行ぶんの日時が二重に並ぶ。

- 相対は 分 → 時間 → 日 → 月 → 年 と粗くしていく（時間が経つほど「いつ」の解像度が要らなくなる）
- **未来の日時を「前」と言わない。** commit の日時は書いた人の PC の時計で記録されるため、ずれた時計から来た commit はこちらの「今」より後になりうる（「これから」と出す）
- 絶対は `toLocaleString()` に任せず、**桁の揃った1つの形**（`YYYY/MM/DD HH:mm`）に固定する ── 任せると同じ画面が PC ごとに `8/25/2026` にも `25/08/2026` にもなり、縦に並んだ 100 行で位置がずれる

「今」は**届いた一覧ごとに1つだけ**決める（行ごとに `Date.now()` を読むと、1行目と 100 行目で基準がずれる）。

#### 開いている間だけ、`git:changed` で追いつく

取り直す契機がブランチの一覧（§14.14）と1つだけ違う。

| 面       | 取り直す契機                                        |
| -------- | --------------------------------------------------- |
| ブランチ | 開いた瞬間に1回だけ（開いて選んで閉じるまでが一瞬） |
| 履歴     | 開いた瞬間 ＋ **開いている間の `git:changed`**      |

履歴は開いたまま端末で `git commit` することがあり、そのとき出たままの一覧は**さっき積んだ commit が無い**という形で嘘をつく。かといって閉じている間まで追い続けると、誰も見ていない一覧のために `git log` を動かし続けることになる ── だから購読を張るのは開いている間だけにしてある。

購読するのは **`git:changed` だけ**で、`files:changed` には乗らない（作業ツリーのファイルをいくら書き換えても履歴は1行も変わらない）── リポジトリの状態の読み直しが2つを合流させている（§14.15）のとは、そこが違う。束ねる間（400ms）は同じにしてある。

自動の取り直しでは **`loading` へ戻さない。** 戻すと、端末で commit するたびに面が白くなり、読んでいた場所を見失う ── 開いた瞬間の1回だけが「取得しています…」から始まる。

#### 面は差分と同じ器にした

重ねる・`Esc` と `×` で閉じる・面の中にだけ理由を出す。どれも 3-8-9 で差分に対して決めたことで（§14.16）、履歴で変える理由が無い ── **同じ場所に出て同じ閉じ方をする**方が、覚えることが増えない。どちらの面もパネルを覆うため、2つが同時に開くことは起こらない。

行は `button` にしない（押す先が無い）。**押せる形のものを置いて何も起きない**より、初めから押せない形で出す ── 開けない変更の行を `span` にしてあるのと同じ判断になる（§14.9）。

### 14.20 commit 1件の詳細（Session 3-8-12）

3-8-11 で出したのは commit の**連なり**（100 件の行）で、そこから先へ進む道は無かった ── 行は押せず、開ける先も無い。3-8-12 で足したのは、その1行を開いて**この commit で何が変わったか**を見ることになる。

3-8-9 との関係がそのまま当てはまる。あちらは「変更ファイルの一覧の1行の中身」を出し、こちらは「履歴の1行の中身」を出す ── どちらも**一覧の隣で1段深く入る**もので、新しい機能というより既にある一覧の奥行きにあたる。

#### 開く rev は、履歴に出した行が持っていた短い hash

3-8-1 から3-8-11 まで、rev が境界を渡ったことは一度も無い（`listCommitHistory` は rev を**書かない**ことで HEAD から辿らせている）。詳細では「どれを開くか」を言うしかないので、ここで欄が1つだけ開く。

開いたのはそこまでで、次の4つは変えていない。

| 決めごと                    | どうしてあるか                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| 通る形は**16進 4〜40 桁**   | `HEAD~5` / `main@{1}` / `:/要約` / `<hash>:<path>` / `@{-1}` は、どれも書けない形にしてある    |
| 大文字を通さない            | `%h` が返すのは常に小文字。直してまで通すと「画面に出ていた文字列」以外が入口になる            |
| 独立した1つの引数として渡す | `--end-of-options` の後ろ。`<hash>:<path>` のような**組み立て**は1つも作らない                 |
| 打ち込む欄を作らない        | 渡せるのは履歴の行が持っていた文字列だけ ── 一覧に無い commit を指す手立てが形の上で存在しない |

規則そのものは `main/git/gitCommitHash.ts` が持ち、`main/ipc/handlers/git.ts` が通す。**危ないものを弾くのではなく、通る形を1つに決める**という 3-8-3 の pathspec と同じ構えになる。

#### マージ commit は対象外にした

親が2つ以上ある commit では、**どちらの親と比べるか**が決まらない。git 自身も既定では答えを出さず（`git diff-tree <merge>` は何も出力せずに 0 で終わる）、出させるには「1つめの親と比べる」「全部の親と比べた合成」のどちらかを**こちらが選ぶ**ことになる ── どちらを選んでも、画面に出た一覧は「この commit で変わったもの」とは違う意味を持つ。

したがって `merge` は失敗ではなく**答えの1つ**として返し、その理由を面に出す。

- 履歴の行の側では、マージだけ **`button` にしない**（押せる形で出して断らない。§14.9 と同じ判断）
- 押せない理由は**一覧につき1つ**だけ下に出す ── 行ごとに出すと、100 行のうち 30 行がマージなら同じ1文が 30 回並ぶ
- 文言は定数1つ（`GIT_MERGE_COMMIT_NOTICE`）で、一覧の下と面の中が同じことを言う
- 「非対応」ではなく**「決まらない」**と書く ── 手を抜いたのではないことが伝わらないと、利用者は「そのうち直る」と読む

Main 側でも親の数を確かめ直す（境界の外から来た要求が Renderer の写しどおりとは限らない）。決めているのはどちらも `parentCount >= 2` という**git が答えた同じ事実**になる。

#### `git show --name-status` ではなく `diff-tree --raw`

`--name-status` が返すのは種類と位置だけで、**中身を取りに行くための object 名が載らない。** 載らないと、差分の側で `<hash>^:<path>` を組み立てるか `ls-tree` をもう2回動かすことになり、前者は 3-8-9 で作らないと決めた形（位置が revision 表記の一部として読まれる余地）にあたる。

`--raw` は1件に**両側の mode と object 名**まで載せてくる。

```
:100644 100644 <前の object> <後の object> M<NUL>path<NUL>
:100644 100644 <前の object> <後の object> R100<NUL>元<NUL>先<NUL>
```

つまり差分の2段目に載る引数は、**git 自身がこの1回で答えた object 名**になる（3-8-9 の `ls-files --stage` / `ls-tree` と同じ性質）。40 桁の 0 は「その側に相手が居ない」（追加の前側・削除の後側）として読む側で null に倒す ── 0 の並びも16進として通ってしまうため、落とさないと `cat-file` に渡る。

固定で足しているのは次の8つで、どれも**外から来ない**。

| 指定             | なぜ                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `--no-commit-id` | commit の hash の行を出さない（欲しいのは変更の行だけ）                  |
| `--no-abbrev`    | object 名を省略させない。**省略されると `cat-file` に渡せない**          |
| `-r`             | フォルダで畳まず、ファイル1件ずつ出す                                    |
| `-z`             | 位置に改行が入っていても1件を取り違えない（`status` と同じ理由）         |
| `--find-renames` | rename を1件として出す。plumbing の既定は「消えた＋足された」の2件になる |
| `--root`         | 親を持たない commit（履歴の1つめ）を、全部が追加された差分として出す     |
| `--no-textconv`  | 設定に書かれた**任意のプログラム**を起こさせない（3-8-9 と同じ線）       |
| `--no-ext-diff`  | 同上（外部 diff プログラム）                                             |

`--find-renames` を明示しているのは、rename 検出の既定が設定（`diff.renames`）で変わるためになる ── 付けておけば、PC ごとに「rename が1件に見えたり2件に見えたり」しない。名乗りの側（`show --no-patch`）でも `log.showSignature` と `log.decorate` を先に閉じてあり、これは 3-8-11 と同じ構えになる。

#### object 名は境界を渡さない

詳細の応答に載るのは、位置・種類・元の位置の3つだけになる（`GitCommitFileChange`）。mode 2つと object 名2つは **Main の中だけ**で使う ── 500 件ぶんの 40 桁を誰も読まないまま IPC の向こうへ運ぶ意味が無く、3-8-11 の「画面に出ないものは載せない」がそのまま当たる。

代わりに、差分を求められたときは `diff-tree` を**もう1回動かし直す**。commit は書き換わらないので答えは同じで、ここでの読み直しは「古い一覧を信じない」ためではなく**object 名を運ばないため**にある（作業ツリーの差分（§14.16）が読み直すのとは理由が違う）。

中身を読む処理そのものは 3-8-9 と**同じ1本**に切り出してある（`main/git/gitDiffSide.ts`）── 大きさを先に訊く・上限は Editor で開ける上限と同じ・バイナリの判定は files ドメインと同じ・改行は LF に均す、の4つが commit の差分でもそのまま効く。相手が4つめ（作業ツリー / index / HEAD ／ **commit の tree**）に増えたときに読み方を2つ置くと、そこから食い違い始める。

submodule（mode 160000）は**一覧には出し、差分では `unsupported-target`** にする。中身は blob ではないので `cat-file blob` は失敗するが、一覧から消すと `git show --stat` に出る件数と画面の件数が食い違う。

#### 上限は 500 件

`diff-tree` には「何件まで」を言う指定が無い（`log` の `--max-count` にあたるものが無い）ため、読んだ側で切る。

500 にしてあるのは、履歴の 100 件より**明らかに多い**必要があるためになる ── 普段の commit は数件から数十件で、100 で切ると「大きめの1回」が頻繁に切られる。一方で 500 件を超える commit を縦に読む人は居らず、そこから先は Terminal パネルの `git show --stat` の領分になる。切れたことは黙らず、一覧の下に断りとして出す（履歴・ブランチと同じ形）。

差分を探すときだけは上限を渡さない ── 切る位置が2箇所にあると、片方だけ直された日に「一覧には出たのに差分では見つからない」が起こる。

#### 面は3枚にしない

差分（3-8-9）と履歴（3-8-11）は、どちらもパネルを覆う面だった。詳細を3枚目として重ねず、**履歴の面の中身を入れ替える**形にしてある。

- 重なりが3枚になると、`Esc` が何を閉じるのかを利用者が数えることになる
- 詳細は履歴の**中の1件**で、履歴と並ぶものではない

戻る道（`←`）は閉じる（`×`）と**反対の端**に置く ── 同じ側に並べると、1段戻るつもりで面ごと閉じることが起きる。

差分だけは、その上にもう1枚重なる（commit の中の1ファイルを押したとき）。面は 3-8-9 のものをそのまま使い、`GitDiffRequest` を union にして入口を分けてある ── 変わるのは3つだけで、見出しの右に短い hash が出ること・左右のラベルが「親のコミット / このコミット」になること・中身の取り先が別のチャンネルになること。面を2つに分けなかったのは、閉じ方・重なり方・読み込み中の見え方まで二重に持つことになるためになる。

#### `Esc` は、開いた順を1つずつほどく

履歴の面と差分の面は、どちらも `window` で `Esc` を待っている。3-8-11 までは2つが同時に開くことが無かったため問題にならなかったが、3-8-12 では**差分が履歴の上に重なる** ── そのままだと1回の `Esc` で2枚とも閉じる。

`stopPropagation` では止まらない（**同じ `window` に付いた2つの購読は、どちらも呼ばれる**）。したがって、上に何か重なっている間は下の面が**購読そのものを張らない**形にしてある（`suspended`）── 「無視する」のではなく、居ないのと同じにする。

結果として `Esc` は次の順にほどける。実機で1回ずつ確かめてある（[DEVELOPMENT.md](DEVELOPMENT.md) §4）。

| 今見ているもの        | `Esc` で起きること |
| --------------------- | ------------------ |
| commit の中の差分     | 差分だけが閉じる   |
| ブランチを作る欄      | 欄だけが畳まれる   |
| commit の変更ファイル | 履歴の一覧へ戻る   |
| 履歴の一覧            | 面が閉じる         |

重なりの順は DOM の並びで決めてある（どちらも `z-index: 20`）── `GitView.tsx` で差分を履歴の**後ろ**に置いている。

2段目（ブランチを作る欄）は Session 3-8-13 で増えた。**面は増えていない** ── 一覧の行の下に開く欄で、`suspended` の仕組みも要らない（同じ `useEffect` の中で先に見るだけになる。§14.21）。

#### 詳細は、開いたら読み直さない

履歴の一覧は `git:changed` で追いつく（§14.19）が、詳細はそこに乗らない ── **記録された commit の中身は変わらない。** 変わりうるのは「その commit がまだ在るか」だけで、消えていれば次に開いたときに `not-found` が出る。開いている間ずっと `diff-tree` を動かし続ける形にはしない。

Workspace が切り替わったときは閉じる（履歴と同じ）。短い hash は**リポジトリごとの値**で、切り替え先に同じ 7 桁が実在することもありうる ── 閉じないと、別のリポジトリの commit をその hash のまま読みに行く形が残る。

### 14.21 履歴の commit からブランチを作る（Session 3-8-13）

3-8-11 と 3-8-12 で作った履歴の面は、**そこから変えられるものが1つも無い**ものだった ── 動かす git は `log` / `show --no-patch` / `diff-tree` / `cat-file` の4つで全部読み取りで、3-8-3 以降ずっと出てきた「押せるか / なぜ押せないか」がこの機能にだけ現れない、と §14.19 に書いた。

3-8-13 で足したのは、その面から動く**書き込み1つ**になる ── 並んだ行を始点にブランチを作る。

#### 保留の理由が、2つ前のセッションで消えていた

3-8-6（ブランチの作成）の時点で、start point は §14.18 にこう書かれていた。

> 別の commit からブランチを作る（start point）｜欄そのものを作っていない。**選ぶための画面（履歴）と一緒でなければ意味を持たない**

保留していた項目の中で、**理由が「画面が無いから」だったのはこれだけ**になる（他はどれも「渡せる欄を作らない」「戻せない操作だから」という判断そのもの）。その画面は 3-8-11 と 3-8-12 で出来上がった ── したがって 3-8-13 で行うのは、新しい判断ではなく**保留の解除**にあたる。

#### 増えたのは要求の欄1つで、チャンネルは増えない

`git:create-branch` はそのままで、`CreateGitBranchRequest` に `startPoint` が付く。切り替え（`git:switch-branch`）には付けない ── §14.14 が「切り替えると別の場所から作るを1つのチャンネルに混ぜない」と書いたとおりで、混ぜると「切り替えたつもりで新しいブランチが増える」形が生まれる。

`string | null` にしてあり、**省略可（`?`）にしていない。** 省略できると、始点を渡し忘れた要求が「今の場所から作る」として静かに通り、押した行とは違う場所にブランチが生える。「HEAD から作る」は欄が無いことではなく、`null` という**答え**になる。

| どこから     | `startPoint` | git へ渡る引数                                           |
| ------------ | ------------ | -------------------------------------------------------- |
| バーの「＋」 | `null`       | `switch --quiet --create <name>`                         |
| 履歴の行     | 短い hash    | `switch --quiet --create <name> --end-of-options <hash>` |

#### 通る形も、確かめる関数も 3-8-12 と同じ

境界を渡るのは履歴の行が持っていた短い hash だけで、規則は `main/git/gitCommitHash.ts`（16進 4〜40 桁）── `commitHashField` と `branchStartPointField` は**同じ関数**を通す。入口を2つに分けると、「詳細では開けないが、ブランチの始点にはできる」hash が生まれる。

打ち込む欄は相変わらずどこにも無い。`HEAD~5` も `main@{1}` も `<hash>:<path>` も書けず、**画面に出ている行を指すための欄**であることは 3-8-12 のまま変わらない。

#### `--end-of-options` は名前の**後ろ**

3-8-6 では「`--create` は必ず最後に置く」と書いていた ── 位置引数が1つも無かったためになる。3-8-13 でその後ろに置けるものが1つできたので、言い直しが要る。

`git switch -c <new> [<start-point>]` の `<new>` は `--create` が自分の引数として受け取る値で、**位置引数ではない。** したがって名前の手前に `--end-of-options` を挟むと、名前が始点として読まれて `invalid reference` になる（3-8-6 で確かめてある）。名前の**後ろ**に置く分には、始点だけがその後ろの位置引数になる（3-8-13 で一時リポジトリに対して確かめた）。

#### マージ commit も始点にできる

3-8-12 で差分を断ったのは、親が2つ以上あると**どちらの親と比べるか**が決まらないためだった。始点にはその問いが無い ── 比べるのではなく**その1点から始める**だけで、親がいくつあっても指す先は1つに決まる。

したがって画面では、同じ行の中に「押せないもの（行そのもの＝変更ファイル）」と「押せるもの（⑂＝ブランチ）」が並ぶ。並んでよいのは、押せない理由が一覧につき1つ下に出ていて（`GIT_MERGE_COMMIT_NOTICE`）、そこに書いてあるのが**変更ファイルを出せない**という限られた話だからになる。「マージだから何もできない」ではないことが、⑂ が立っていることそのもので伝わる。

#### 同じ文言を、別のものとして読む

git は「切り替え先のブランチが無い」ときも「始点の commit が解けない」ときも `invalid reference: <値>` としか言わない。それでも**次の一手は違う**（ブランチの一覧を開き直す / 履歴を開き直す）ため、分類を分けてある（`commit-not-found`）。

git の側に区別が無い以上、分けられるのは**どちらのコマンドを組み立てたかを知っている側**だけになる ── Commit / Push / fetch / merge / branch で分類の関数を分けてあるのと同じ形で、`classifyGitCreateBranchFailure` が1つ増えた。始点を渡さなかったときはこの関数を通さない（`invalid reference` が出る余地そのものが無く、通すと起こりえない分類が結果に混ざる）。

40 桁の hash を渡したときだけ、git の言い方が `unable to read tree (<hash>)` に変わる。`classifyGitFailure` 側の `unable to read` は**権限**として読んでいるため、表は共有していない。

#### 断られたら、ブランチも作られない

始点を渡した作成は、3-8-6 までと違って**作業ツリーの中身を書き換える**（始点の内容へ移るため）。書きかけがそれで消えるなら git が断る ── `local-changes-blocked` で、これは切り替え（§14.14）とまったく同じ判断にあたる。**アプリは確認を挟まない**（切り替えてよいかを決めるのは git 自身）という線もそのまま。

このとき ref だけが残ると「押したのに切り替わっていないブランチ」が一覧に増える。`switch --create` は作るのと移るのを1回で行うため、断られれば ref も作られない ── 実物で確かめてある（`gitBranchRepository.test.ts`）。作成と切り替えを2回に分けない理由（§14.14）が、3-8-13 でいちばん効くところになる。

始点が解けるかどうかを**先に確かめない**のも同じ考え方で、欲しいのは「作れたか」だけなので `switch --create` の結末がそのまま答えになる ── 先に確かめると git を2回動かしたうえ、確かめてから作るまでの隙間を自分で作ることになる（3-8-12 の詳細が先に解いているのは、**親の数を知る必要がある**ためで、目的が違う）。

#### 面は増やさず、行の下に開く

§14.20 の「面は3枚にしない」をそのまま保つ。⑂ を押すと、**押した行のすぐ下**に名前の入力欄が開く。

- 別の面を重ねると、`Esc` でほどく数が1つ増え、しかも「どの commit から作るのか」が画面から離れる
- 行の下なら、始点はそのまま真上に出ている
- 欄は一度に1つだけ（行ごとに開けると、打ちかけの名前が複数残り、どれを作ろうとしていたのかが押す瞬間まで決まらない）

`Esc` は 欄 → 詳細 → 面 の順にほどける。欄をいちばん先に見るのは、それがいちばん後に開いたものだからになる ── 欄は一覧の上でしか開かないので、詳細と同時に立つことは無い。

欄が開いているかどうかは**面の側が持つ**（フックではない）。書き換えるものが1つも無い画面の状態で、面を閉じれば一緒に消えてよい ── 差分と詳細がフックに在るのは、中身を IPC で取りに行くためになる。

#### 失敗の理由は、面の中にも出す

パネル本体にも `failure` は出る（§14.16 と同じ場所）が、履歴の面が**パネルを覆っているためそこは読めない。** 押した場所の近くに出すという 3-8-3 からの形を保つには、欄の下にもう1箇所要る。

出すのは**その欄から押した1回の結末**だけにしてある。パネル全体の `failure` を渡すと、履歴を開く前に失敗していた Push の理由が、ブランチを作ろうとしただけの人の目の前に出る ── そのため、フックは `createBranchFromCommit` から `GitOperationOutcome` をそのまま返す（バーの「＋」は「通ったか」だけで足りるので `boolean` のまま）。

目印（`GIT_CREATE_BRANCH_OPERATION_KEY`）は2つの入口で**同じ**にしてある。同じ操作で、同時に2つ走ってよいものが無い。

#### 通ったら、履歴の面を閉じる

作った先へ切り替わるため、開いたままの履歴は**もう別のブランチのもの**になる（新しいブランチは始点の commit を指しており、そこから先の行は一覧から消える）。閉じずに取り直すと、押した行より新しい行が黙って消えることになり、「作れたのか」と「何かが失われたのか」が同じ動きに見える。

失敗のときは閉じない ── 理由（面の中に出るもの）を読む前に消えることになる。打った名前もそのまま残す（同じ名前が既にあった場合、直すのは名前の一部だけで済むことが多い。§14.14 と同じ判断）。

### 14.22 ブランチの削除 / rename（Session 3-8-14）

3-8-6 でブランチの面を作ったとき、**そこに置かなかった操作が2つ**あった ── 削除と rename になる。§14.14 の「作らない欄」の表に「戻せない操作。確認の形と一緒に設計する」と書いてあったのがそれで、3-8-14 で足したのはその2つにあたる。

#### `switch` ではなく `branch` を動かす、最初のブランチ操作

3-8-13 まで、ブランチを相手にする操作が動かしていた git は `switch` の1本だけだった（切り替えも作成も）。3-8-14 の2つは `git branch` を動かす ── この違いは名前の話ではなく、**書き換える相手が違う。**

|                      | 切り替え / 作成（`switch`）      | 削除 / rename（`branch`） |
| -------------------- | -------------------------------- | ------------------------- |
| 作業ツリー           | まるごと書き換わる               | **1バイトも動かない**     |
| index                | 書き換わる                       | 動かない                  |
| 書き換わるもの       | ファイル                         | ref 1つ（と reflog）      |
| `post-checkout` hook | 走る                             | 走らない                  |
| 待ち時間の上限       | `GIT_CHECKOUT_TIMEOUT_MS`（2分） | 既定（10秒）              |

上限を分けたのは、2分を掛ける理由（ファイル数・ウイルス対策ソフト・ネットワークドライブ）がこちらには1つも効かないためになる ── 即答するはずの操作に2分を掛けると、本当に返ってこなくなった場合の逃げ道がその分だけ遠くなる。実装も別の関数に分けてある（`runBranchCommand` / `runBranchRefCommand`。`main/git/gitBranches.ts`）。

失敗の分類の表も分けた（`classifyGitDeleteBranchFailure` / `classifyGitRenameBranchFailure`）。Commit / Push / fetch / merge / 始点つきの作成で分けてきたのと同じ形で、**起こりうることが重ならない** ── 削除に「書きかけが邪魔をした」は無く、rename に「マージ済みか」は無い。表を共有すると、どちらでも起こりえない分類を互いに持ち込むことになる。

#### 増えたチャンネルは2本で、要求に載るのは名前だけ

```
git:delete-branch    要求は名前1つ
git:rename-branch    要求は名前2つ（どれを / 何に）
```

`git:rename-branch` が、**1つの要求に外来の値を2つ載せる初めての形**になる。ここまで境界を渡ってきた値は必ず1要求に1つだった（pathspec 1つ・メッセージ1つ・ブランチ名1つ・hash 1つ）。2つとも同じ `normalizeGitBranchName` を通す（`branchNameField` / `branchNewNameField`）── 入口を分けると「元の名前としては通るが、新しい名前としては通らない」形が生まれ、コマンドラインに並ぶ2つの値に別々の備えが掛かることになる。

作らなかった欄は次の3つで、どれも 3-8-5 以降の線をそのまま延ばしたものになる。

| 作らない欄                    | なぜ                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `--force`（`-D`。強制削除）   | そこにしか無い commit を到達不能にする。戻すには reflog から hash を探すことになる |
| `--force`（`-M`。名前を奪う） | 行き先に居る別のブランチを黙って消す（3-8-13 で `-C` を断ったのと同じ）            |
| 「確認したか」の欄            | 確認を通した証を引数に載せると、**載せなければ確認を飛ばせる**形になる             |

#### 元の名前も要求に載せる（「今のブランチ」に頼らない）

git は `git branch -m <新名>` の1引数形も受け取る（今のブランチを改名する）が、**その形は使わない。** 使うと「どの枝を改名するのか」が要求にもコマンドにも書かれず、押してから git が動くまでの間に HEAD が変わっていた場合に**画面で選んだのとは別のブランチが改名される。** 一覧の行から押す操作である以上、対象は常に名指しする ── 今のブランチを改名するときも同じ2引数形を通る。

#### 押す前に分かることは、git を動かす前に分ける

§14.14 で切り替えに当てた形をそのまま当てる。ただし**当たる表が違う。**

| 押す前に分かること           | どこで               | 分類                   | 切り替え | 削除 | rename |
| ---------------------------- | -------------------- | ---------------------- | -------- | ---- | ------ |
| 今そこに居るブランチを選んだ | 読んだ状態（`head`） | `nothing-to-do`        | ○        | ―    | ―      |
| 今そこに居るブランチを消す   | 読んだ状態（`head`） | `branch-checked-out`   | ―        | ○    | ―      |
| 同じ名前へ改名しようとした   | 要求の2つの値        | `nothing-to-do`        | ―        | ―    | ○      |
| 競合が残っている             | 読んだ状態           | `unresolved-conflicts` | ○        | ―    | ―      |

競合を削除 / rename で見ないのは、**git が気にしないため**になる ── 見ると、通るはずの操作をアプリの都合で止めることになる（切り替えを重ねて尋ねない、と決めたのと同じ理由の裏返し）。

**マージ済みかどうかは、押す前には分からない。** 基準（HEAD か、そのブランチの追跡先か）を持つのは git で、一覧にも載せていない（`shared/git/branch.ts`）── 載せると、一覧を開くたびに git へ聞くことが増える。したがってこれは数少ない「押してみないと分からない結末」になり、確認の文言もそう書いてある（「削除を中止します」）。

#### 今そこに居るブランチは、行は押せて ✕ は押せない

一覧の行そのもの（切り替え）は今のブランチでも押せる（§14.14 ── 押しても git は動かず `nothing-to-do` で返る）。**✕ だけはそうしない。**

| 違い                                                           |
| -------------------------------------------------------------- |
| 行 … 押しても**何も起きない**（待てば意味を持つ日も来る）      |
| ✕ … 押しても**絶対に通らない**（待っても押せるようにならない） |

破棄で「止まっている場合は押せる場所を出さない」としたのと同じ判断だが、こちらは**消すのではなく押せない状態にして理由を添える** ── 消すと行ごとにボタンの数が変わり、名前の右端の位置が揃わなくなる。

Main の側でも同じことを見る（`head.kind === 'branch' && head.name === name`）。git も同じ文言で断るが（`used by worktree at ...`）、押す前に分かることを git に聞かない、という線をここでも保つ ── pathspec とブランチ名を「形」と「置き方」の両方で守っているのと同じ二重の構えになる。git 側に落ちるのは**別の worktree で使われている**場合で、次の一手は同じなので分類は1つにしてある。

#### `-D` を持たないことが、いちばん現れる場所

`git branch -d` が断るのは「HEAD にも追跡先にもマージされていない」ブランチで、そこには**そのブランチからしか辿れない commit** がある。`-D` はそれを到達不能にする。

このアプリは `-D` を持たない。断り（`branch-not-merged`）の文言で `-D` を**案内もしない** ── 持っていないものを勧めると「どこにあるのか」を探させることになるためで、行き先は hook に断られたときと同じく Terminal パネルになる。

> このブランチにしか無いコミットがあるため削除できません。先にマージするか、内容を確認のうえ Terminal パネルの git branch -D をご利用ください。

**「断りの文が出た」ことは、ref が残っていることを何も言わない。** ここは実物に対して確かめてある（`gitBranchRepository.test.ts` / production ビルドの実機確認）── 分類の文言だけを見ていると、いちばん壊れやすいところが素通りする。

#### 大文字小文字だけの改名だけ、`--force` を立てる

Windows（と既定の macOS）では `refs/heads/feature` と `refs/heads/Feature` が**同じファイル**になるため、素の `--move` は `a branch named 'Feature' already exists` で断る（実物で確かめた）。

だが、そのとき「既にある」と指されているのは**改名しようとしているブランチ自身**であって、別のブランチではない ── つまり `-M` が消す相手は自分自身になり、`-M` を避ける理由（相手を黙って消す）がこの1点だけ当てはまらない。

立てる条件は2つで、**どちらも満たさなければ立たない。**

1. 綴りが大文字小文字だけ違う
2. **行き先の綴りちょうどのブランチが実在しない**

2つめを確かめられなかったとき（git が動かなかった・非0で終わった）は false に倒す ── 分からないまま `--force` を立てると、確かめられなかった一回だけ他人のブランチを消しうる。倒しておけば、最悪でも「大文字小文字だけの改名が断られる」で済む。

#### `show-ref --verify` では確かめられない

2つめの確認に `git show-ref --verify refs/heads/Feature` は使えない ── `feature` しか無い Windows でも**成功を返す**（確かめた）。ref の実体がファイルで、その参照がファイルシステム越しに行われるためになる。

代わりに `git branch --list --format=%(refname:short) --end-of-options <name>` を1回動かす。突き合わせの相手は**保管されている名前**で、loose ref（ディレクトリを列挙して得た正式な綴り）でも packed-refs（テキストの行）でも比較は大文字小文字を区別する ── どちらの保管形でもそうなることを確かめてある。出力が空なら「その綴りのブランチは無い」で、終了コードは 0 のまま。

`for-each-ref` を使わなかったのは、そちらのパターンが**完全な refname**（`refs/heads/<name>`）で書く必要があり、外から来た名前に固定の接頭辞を**繋いだ1つの引数**を作ることになるため ── 3-8-12 で `<hash>^` や `<hash>:<path>` を作らないと決めたのと同じ線で、名前は最後まで独立した1つの引数のままでいられる方を選んだ。一覧を読むのに `git branch` を使わない（§14.14）のはあちらが人向けの出力だからで、`--format` で欄を自分で決めているここには当てはまらない。

これを動かすのは**大文字小文字だけの違いだったときの1回だけ**で、毎回の rename で git を1回増やしてはいない。

#### rename では何も失われない（だから確認しない）

変わるのは ref の名前だけで、commit も作業ツリーも index も動かない。**今そこに居るブランチも改名でき**、git が HEAD を追随させ、未コミットの変更もそのまま残る（実物で確かめてある）── 応答に載る状態で、上のバーの表示がそのまま新しい名前に変わる。

したがって確認は挟まない。確認を出すこと自体が目的ではない（§12.6）。

#### remote 側は動かない ── rename の後の Push は古い名前へ向かう

rename で `branch.<新名>.remote` / `branch.<新名>.merge` は引き継がれるが、**`merge` は古い remote 側の名前を指したまま残る**（実物で確かめた）。Push は `push.default=upstream` で動かしているので（§14.13）、rename の後に Push すると**改名前の名前の remote branch へ向かう。**

追跡先を付け替える欄は作っていない ── remote を指せる欄を作らない、という 3-8-5 からの線にあたる。これは黙って変わってよいことではないので、**実物のテストで固定してある**（`branch.<新名>.merge` が `refs/heads/<旧名>` を指していること）。remote branch そのものの削除・改名も対象外で、前者は他人に影響してサーバー側で戻せず、後者は git にその操作自体が無い（削除して新しい名前で push するしかない）。

#### commit が1つも無いリポジトリの改名は、手立てが無い

git 自身は unborn なブランチの改名を受け付ける（`git branch -m <新名>` が通る。確かめた）。だがこのアプリでは**そこへ届く道が無い** ── unborn では ref が1つも無く、一覧が空になる（§14.14）。行が無ければ ✎ も無い。

これは塞いだのではなく、**行から押す形にした結果そうなっている**もので、範囲外の表にもそう書いてある。

#### 面は増やさず、行の下に開く（3-8-13 と同じ形）

削除の確認も rename の入力欄も、**押した行のすぐ下**に開く。

`GitDiscardConfirm` のような重なる器にしなかったのは、**Popover が外側の pointerdown で閉じる**ため ── 確認している最中に一覧が消えることになる。行の下なら対象はそのまま真上に出ていて、`Esc` でほどく数も1つで済む。3-8-13 が「面は3枚にしない」として履歴の行の下に欄を開いたのと、判断も形も同じになる。

**開けるのは一度に1つだけ。** 行ごとに開けると、打ちかけの名前が複数残り、どれを確定しようとしていたのかが押す瞬間まで決まらない。

行そのものの作りは 3-8-6 から変わった ── 全幅の `<button>` 1つだったものが、`<div>` の器の中に3つのボタン（切り替え / ✎ / ✕）が並ぶ形になる。ボタンの中にボタンは置けないためで、いちばん広いところが切り替えのまま残る。✎ と ✕ は**常に出しておく**（hover で現れる形にしない）── 現れる形にすると、一覧を目で追っているだけの人には操作があること自体が伝わらない。

#### `Esc` は開いた順に1つずつほどく

```
Esc（行の下が開いている） … そこだけを畳む
Esc（一覧を見ている）     … 面を閉じる
```

同じ `window` に付いた2つの購読は `stopPropagation` を挟んでもどちらも呼ばれるため、**器の側が購読そのものを張らない**形にした（`Popover` の `escapeSuspended`）── 履歴の面が差分に重なられている間に使っている `suspended` とまったく同じ構えになる。器は「中で何かが開いているか」を自分では知りえないので、その状態は面の側（`GitBranchMenu`）が持ち、器へ渡す。

外側のクリックとウィンドウの焦点喪失では**今までどおり閉じる。** どちらも「この面から離れた」という意思表示で、ほどく順の話ではない。

#### 通っても面を閉じない

切り替えと作成は通ったら閉じる（行き先へ移ったので、その面はもう別のブランチのものになる）。削除と rename は**移らない** ── 溜まった枝を続けて片付けられるように開いたままにする。

そのぶん、**通った後は一覧を取り直す**必要がある。応答に載るのは操作後の**リポジトリの状態**で、ブランチの一覧はそこに含まれない（3-8-6 からの分担）。§14.14 の「開くたびに必ず取り直す」に、ここで1つ足される。

```
開いた瞬間           … 取り直す（3-8-6）
通った操作の直後     … 取り直す（3-8-14）
git:changed が来た   … 取り直さない（3-8-8 のまま）
```

3つめが変わっていないのが要点にあたる ── 誰も見ていない一覧を保存のたびに数え直さない、という判断はそのままで、取り直すのは**自分が変えたと分かっている1回**だけになる。

失敗のときは取り直さない。押した行がその場に残っていないと、出ている理由がどれについてのものか分からなくなる。

行の下が開いたまま一覧が入れ替わったときは、**その行が消えていれば畳む**（削除が通った・rename で名前が変わった）。畳まないと、どの行にも属さない確認だけが宙に浮いて残る。

#### 失敗の理由は、面の中にも出す

3-8-13 と同じ理由になる ── パネル本体にも `failure` は出るが、ブランチの面がそこを覆っている。したがってフックは `GitOperationOutcome` をそのまま返し（`deleteBranch` / `renameBranch`）、面はその**1回の結末だけ**を行の下に出す。パネル全体の `failure` を渡すと、面を開く前に失敗していた Push の理由が、ブランチを消そうとしただけの人の目の前に出ることになる。

切り替え（`switchBranch`）が結末を返さないままなのは、通ったことが画面そのもの（バーの名前）に出るからで、そこは 3-8-6 のまま変えていない。

#### 実物に対して固定してあること

`gitBranchRepository.test.ts` に 3-8-14 で加えたものは、3-8-6 / 3-8-13 と**確かめたいことが裏返る** ── あちらが「書きかけが失われないこと」だったのに対し、こちらは**断られたときに1つも消えていない / 動いていないこと**になる。

- 未マージのブランチは断られ、**ref も指す先もそのまま残る**（`-D` を持たないことの実体）
- 今チェックアウトしているブランチは、git を動かす前に断る（ref も HEAD も無傷）
- 行き先が実在する rename は断り、**相手のブランチが1文字も動かない**（`-M` を渡さないことの実体）
- 大文字小文字だけの改名は**通る**（`--force` の使いどころが1点であること）
- 削除も rename も、未コミットの変更を消さない
- 今のブランチを改名すると HEAD が追随する
- HEAD ではなく**追跡先**にマージ済みでも `-d` は通る（基準を持つのが git であることの記録）
- rename の後、`branch.<新名>.merge` は古い remote 側の名前を指したまま残る

### 14.23 退避（stash）（Session 3-8-15）

3-8-5 の時点から、Git パネルはこう案内していた。

> 作業ツリーの変更が上書きされるため実行できませんでした。**Commit するか退避して**からお試しください。

この文言（`local-changes-blocked`。`renderer/src/git/gitChanges.ts`）は Pull（§14.13）とブランチの切り替え（§14.14）の両方から出る。前半（Commit）は 3-8-4 でアプリの中に在ったが、**後半（退避）だけが端末に丸投げのまま**だった。3-8-15 で足したのはそこになる。

#### 3-8-6 の判断は1つも撤回していない

§14.14 の「作らない欄」の表には、今も次の行が在る。

| 作らない               | なぜ                                                          |
| ---------------------- | ------------------------------------------------------------- |
| 切り替え時の自動 stash | 切り替えてよいかを決めるのは git 自身。その判断を上書きしない |

3-8-15 が足したのは**自動ではない退避**で、押すのは利用者になる。「git の判断をアプリが黙って上書きする」ことと「利用者が明示的に避ける」ことは別のもので、前者は今も無い ── 切り替えの前に勝手に stash することはしない。

#### 動く git は3種類で、待ち時間の上限がそこで分かれる

3-8-14 で `switch` と `branch` の2種類になったところに、もう1段の切り分けが入る。

| 何を動かすか | 何を書き換えるか       | 上限                             |
| ------------ | ---------------------- | -------------------------------- |
| `stash list` | 何も（読み取り）       | 既定（`GIT_COMMAND_TIMEOUT_MS`） |
| `stash push` | **作業ツリーまるごと** | `GIT_CHECKOUT_TIMEOUT_MS`        |
| `stash pop`  | **作業ツリーまるごと** | `GIT_CHECKOUT_TIMEOUT_MS`        |
| `stash drop` | reflog の1件だけ       | 既定                             |

`runStashWorktreeCommand` と `runStashRefCommand` に分けてあるのは、3-8-14 が `runBranchCommand` と `runBranchRefCommand` を分けたのとまったく同じ判断になる ── 即答するはずの操作に2分を掛けると、本当に返ってこなくなった場合の逃げ道がその分だけ遠くなる。

#### 番号は動く ── ここだけが、これまでのどの指し方とも違う

| 何を指すか | 指し方      | 指した先はひとりでに変わるか         |
| ---------- | ----------- | ------------------------------------ |
| ブランチ   | 名前        | 変わらない                           |
| commit     | 短い hash   | 変わらない                           |
| 退避       | `stash@{N}` | **変わる**（上から数えた位置のため） |

退避を1つ作れば全部が1つずつ後ろへずれ、1つ捨てても同じだけ前へ詰まる（実物で確かめてある。`gitStashRepository.test.ts`）。したがって「一覧を出してから押すまで」の間に端末で `git stash` を1回打たれると、**画面で選んだのとは違う退避が pop / drop される。**

対処は2段になる。

1. **面を開いている間は `git:changed` で追いつく**（履歴と同じ。`useGitRepository.ts`）── そもそも古い一覧を出さない
2. **押された瞬間に、その位置を解いて hash と突き合わせる**（`resolveStashEntry`）── 合わなければ git を動かさずに `stash-not-found` で断る

2 は 3-8-14 が `--force` を立てる前に「相手は自分自身か」を `branch --list` で確かめたのと同じ構えで、**戻せない操作の直前にもう一度だけ確かめる**ことになる。確かめられなかったとき（git が動かなかった・非0で終わった）は false に倒す ── 最悪でも「一覧を開き直してください」で済む。

突き合わせは**完全な hash に短い hash を前方一致で当てる**（`showStashObject` は `rev-parse --verify --quiet`）。短い形どうしを等しさで比べないのは、短縮の桁数がリポジトリの大きさで変わるためになる ── 一覧を読んだ時点と押した時点で桁が変わると、変わっていないものを「変わった」と読む。

#### `stash@{N}` を組み立てる ── 3-8-12 の線に対する、唯一の例外

3-8-12 で `<hash>^` も `<hash>:<path>` も作らないと決め、3-8-14 で `refs/heads/<name>` を作らないために `for-each-ref` ではなく `branch --list` を選んだ。境界を渡った値を他の文字と繋いで引数にしない、という線になる。

`stashReference`（`gitCommands.ts`）はそれを破る。通してよい理由は1つだけで、**繋ぐ相手が文字列ではなく数**だからにあたる。

```
stashIndexField（main/ipc/handlers/git.ts）が通すのは
  数であること / 安全な整数 / 0 以上・GIT_STASH_LIMIT 未満
        ↓
  10進の数字以外の文字が入る余地が無い
        ↓
  `stash@{N}` に、引数として読み替えられる形が1つも作れない
```

危ういのは「外から来た**文字列**を繋ぐこと」であって、繋ぐ操作そのものではなかった、という切り分けになる。加えて git 側に「番号だけを渡す」形は無く（`stash@{N}` が唯一の指し方）、組み立てを避けるなら**退避を指す手立てそのものが無くなる。**

それでも `--end-of-options` の後ろに置くのは他と同じ ── 形が固定でも、置き方の備えを1つだけ外す理由が無い。

#### 退避するものが無いことは、終了コードからは分からない

`git stash push` は退避するものが無くても `No local changes to save` と言って**0 で終わる**（実物で確かめてある）。したがって呼ぶ側が動かす前に分ける（`findStashPushBlockingState`）── 分けなければ、押すたびに「退避しました」と出たうえで一覧に何も増えないことになる。

数えるのは staged と unstaged の2つだけで、**未追跡は数えない** ── `-u` を渡していないため、git にとって未追跡しか無い状態は「何も無い」のと同じになる。画面の側も同じ2つで押せるかを決めており（`toGitStashPushReadiness`）、Main はその二重の備えになる。

commit が1つも無いリポジトリでは `hasGitHeadCommit`（履歴・Unstage・Push と同じ関数）で分けて `no-commit` を返す。分からなかった場合（null）は**そのまま動かす** ── 履歴が `failed` に倒したのは「空の履歴として出すと嘘になる」ためだったが、こちらは動かせば git が答えを出す（`NO_INITIAL_COMMIT_NEEDLES` が拾う）。

#### pop の競合だけ、stdout が分類に関わる

3-8-1 から、終了コードが非0のときに読むのは stderr だけだった（生の stderr は境界を越えず、分類だけが渡る。§14.6）。pop はそこを1箇所だけ外す。

| pop の終わり方           | 終了コード | stderr                             | stdout                      | 退避   |
| ------------------------ | ---------- | ---------------------------------- | --------------------------- | ------ |
| 通った                   | 0          | 空                                 | 状態の要約                  | 消える |
| **競合した**             | 1          | **空**                             | `CONFLICT (content): …`     | 残る   |
| 作業ツリーが上書きされる | 1          | `… would be overwritten by merge:` | `The stash entry is kept …` | 残る   |

競合の知らせが stderr に1文字も出ないのは、**merge の結果が失敗ではない**ためになる。したがって順番は「stderr の分類 → 当たらなければ stdout」で、逆にはできない ── 下2つはどちらも stdout に `The stash entry is kept …` を出すため、そちらを合図にすると取り違える。

**`--quiet` を渡さないのはこの1本だけ**（`popStashEntry`）。渡すと `CONFLICT` の行ごと消え、上の2つを見分ける手立てが無くなる（実物で確かめてある）。

見分けそのものは `readStashPopConflict`（`gitOutput.ts`。純粋・テスト対象）が持ち、`gitStash.ts` はそれを呼ぶだけになる。

#### 競合した pop は、3つめの `partly-applied` になる

先の2つ（Commit & Push・公開。§14.13 / §14.17）はどちらも「手元は変わったのに、**外へ出す**ところで止まった」だった。こちらはネットワークが1度も出てこない ── それでも同じ形にするのは、**丸めたときに起こることが同じ**だからになる。

```
failed に丸める → 利用者は「何も起きなかった」と読む → もう一度 pop を押す
                → 作業ツリーには既に競合の印が書き込まれている
                → 今度は「上書きされる」として断られるだけ
```

`completed: 'stash-apply'` の文言は**退避が残っていることを先に言う**（`describeGitPartialStep`）。git が競合した pop で退避を捨てないことは実物で確かめてあり、文言はその事実に寄りかかっている。

競合そのものを見せる面は**1つも作っていない** ── 3-8-2 から在る「競合」グループがそのまま受ける（実機で確かめてある）。Merge Conflict の解決 UI が対象外であること（§14.18）は動かない。

#### 面は、履歴と同じ器にする

| 何を                 | どこに                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| 一覧を開く入口       | 上のバー（履歴の隣）                                                         |
| 一覧                 | パネルを覆う面（`.fx-git__stash-overlay`。大きさも重なりも履歴・差分と同じ） |
| 「作業ツリーを退避」 | 面の**下**（ブランチの面が一覧の下に作成欄を置いたのと同じ位置）             |
| 捨てる確認           | 押した行の**すぐ下**（3-8-13 / 3-8-14 と同じ形）                             |

ブランチの面（`ui/Popover`）にしなかった理由は2つある。

- **行の下に確認が開く。** Popover は外側の pointerdown で閉じるため、確認している最中に一覧が消える（§14.22 が行の下に開く形を選んだのと同じ問題だが、あちらは1行が1段で済んだ）
- **バーごと覆う。** 面が出ている間は「履歴」も「退避」も押せる場所が無く、**2つが同時に開くことが起こりえない** ── したがって履歴が差分に対して持っている `suspended`（§14.20）が要らない

`Esc` は 行の下 → 面 の順に1つずつほどける。

#### 番号は画面に出さない

`stash@{0}` の 0 は上から数えた位置で、並び順そのものになる。一覧に出すと、読む人はそれを「その退避の名前」として受け取るが、次に1つ避けた瞬間に全部が別の数になる ── 出さずに、押した瞬間に hash と一緒に渡すだけにしてある（`gitStash.test.ts` が「行に出すものの中に番号が無いこと」を固定している）。

代わりに出すのは git が付けた名乗り（`%gs`。`WIP on main: 1a2b3c4 要約`）で、**分解して並べ直さない** ── 退避に名前を付ける欄を作っていない以上、ここに出るのは git が決めた1つの文字列が正本になる。結果としてブランチ名が文の中に現れるが、それは名乗りの一部であって、こちらが「退避したブランチ」という欄を作ったわけではない。

#### 増えた口は4本

| チャンネル         | 要求             | 動く git                   |
| ------------------ | ---------------- | -------------------------- |
| `git:list-stashes` | `void`           | `stash list`               |
| `git:stash-push`   | `void`           | `stash push`               |
| `git:stash-pop`    | 位置 + 短い hash | `rev-parse` → `stash pop`  |
| `git:stash-drop`   | 位置 + 短い hash | `rev-parse` → `stash drop` |

読み取りの1本を `git:get-repository` に相乗りさせていないのは `git:list-branches` / `git:list-commits` と同じ理由で、**見られているのは面を開いている間だけ**になる。

pop と drop を1本にして「捨てるかどうか」を引数に持たせないのは、`git:stage` と `git:unstage` を分けてあるのと同じ判断にあたる ── 1本にすると、いつか片方の意味でもう片方が動く。

hash を通すのは commit の詳細・ブランチの始点とまったく同じ `normalizeGitCommitHash`（**退避も commit**）で、入口を分けない ── 分けると「詳細では開けないが、退避としては指せる」hash が生まれる。位置の側は、このアプリで**初めて数を確かめる欄**になる（`stashIndexField`）。

#### 実物に対して固定してあること

`gitStashRepository.test.ts` で確かめたいのは、3-8-6 / 3-8-13 の「失われないこと」とも 3-8-14 の「消えていないこと」とも違う ── **指した1件が、指したとおりであること**になる。

- 退避すると tracked の変更が HEAD の状態へ戻り、**未追跡は残る**（`-u` を渡していないことの実体）
- 未追跡しか無いときは git を動かさず `nothing-to-do`（`No local changes to save` は 0 で終わる）
- commit が1つも無いリポジトリでは `no-commit` で、退避も作られない
- 競合が残っている間は git を動かさずに断る
- index に載せた変更は、戻ると **unstaged** になる（`--index` を渡していないことの実体）
- **pop が競合すると `partly-applied` になり、退避は一覧に残る**
- 上書きされる pop は `local-changes-blocked` で、作業ツリーも一覧も1文字も動かない
- **drop すると、それより後ろの番号が繰り上がる**（同一性を確かめる理由そのもの）
- **番号がずれていたら、pop も drop も git を動かさずに断る**（突き合わせが効いていること）
- 退避 → 切り替え → 戻す が通る（`local-changes-blocked` の出口になっていること）

**上限（100 件）だけは、確かめる相手を移してある。** 退避を 101 件作るには `git stash push` を 101 回呼ぶことになり、実測で 9 秒かかる ── しかも退避には ref をまとめて作る手立てが無い（同じ commit を `stash store` で何度積んでも、`git stash list` は同じ commit を1件としか数えない。確かめた）。切り方そのものは `gitOutput.test.ts` が純粋な関数として固定済みなので、実物には「git が `--max-count` を守るか」だけを、本番と同じ `listStashEntries()` の引数を小さい上限で通して聞いている。`git branch` を 500 回呼ばずに `update-ref --stdin` でまとめたのと同じ判断になる。

### 14.24 remote の管理（Session 3-8-16）

3-8-5 から 3-8-15 まで、このアプリには **remote を指せる欄が1つも無かった。** 送り先を決めるのはリポジトリの設定で、Renderer が名前で指せる形にすると「画面に出ているブランチとは別のものへ送れる欄」になる ── それが Push / Pull の要求を `void` に保ってきた理由だった（§14.13）。

3-8-16 でその線を**1箇所だけ**緩める。

|               | 3-8-15 まで                                         | 3-8-16                               |
| ------------- | --------------------------------------------------- | ------------------------------------ |
| 足す / 消す   | できない（`origin` を作るのは公開の一部としてだけ） | **名前で指せる**                     |
| 送る / 受ける | 指せない（要求は `void`）                           | **指せない（要求は `void` のまま）** |

つまり増えたのは**登録簿を編集する口**であって、「どこへ送るか」を選ぶ口ではない。この2つを分けている限り、3-8-5 の判断は1つも撤回していないことになる。

#### 3-8-10 が開けたままにしていた穴

remote が1つも無いリポジトリでパネルの下に在ったのは「GitHub に公開」だけだった ── **新しく作る**側の入口しか無く、既にどこかに在る repository へ繋ぎたい人はアプリの外（端末の `git remote add`）へ出るしかなかった。`no-remote` の文言が「Terminal パネルで」と案内していたのは、そこに行き先が無かったためになる。

3-8-16 で塞ぐのはその穴で、公開と置き換えるものではない ── 公開は「作る」、こちらは「繋ぐ」で、責務は分けたままにしてある（下記）。

#### URL は、このアプリで唯一「git に任意のプログラムを起動させうる値」になる

3-8-1 で引いた線は「**git の引数を渡せる欄を作らない**」だった。`git` は `-c core.pager=…` や `-c alias.x=!sh` で任意のプログラムを起動できるためで、以降どのセッションでも渡せる値は「位置」「名前」「hash」「数」に限ってきた。

remote の URL はその線の**唯一の例外**にあたる ── 欄を作らなければ機能そのものが成り立たないのに、URL 自身が実行の経路を持つ。

```
git remote add evil "ext::sh -c whoami"
```

これは今の git（2.54 で確かめた）が**そのまま受け取る。** 追加した時点では何も起きず、以降の fetch / push でその文字列がシェルとして走る ── つまり素通しにすれば、この欄は**時間差で発火する任意コマンド実行の欄**になる。

#### だから、弾くのではなく通す形を決め打ちにする

pathspec で「危ないものを弾くのではなく、値が値でしかない状態を作る」としたのと同じ構えを、ここでは**許可する形の列挙**として置く（`shared/git/remoteUrl.ts`）。

| 通す                            | 例                                           |
| ------------------------------- | -------------------------------------------- |
| `https://[host][:port]/path`    | `https://github.com/octocat/Hello-World.git` |
| `ssh://[user@]host[:port]/path` | `ssh://git@github.com:2222/o/r.git`          |
| `user@host:path`（scp 形式）    | `git@github.com:octocat/Hello-World.git`     |

通さないものには**危なくないものも含まれる**（`git://`・`http://`・`file://`・ローカルのパス）。それでも通さないのは、「知らない形は通さない」を判断の余地なく言えることの方が、対応する形が増えることより効くため ── 例外を1つ作った時点で、次の例外を断る根拠が「なんとなく危なそう」になる。

scp 形式で `user@` を**必須**にしてあるのは、Windows のパスと見分けが付かないため（`C:/repos/x` は「ホスト `C` の path `/repos/x`」とも読める）。この1つの条件が、ローカルのパスと `ext::sh -c …` の両方をまとめて落としている。

#### 認証情報を URL に載せさせない

`https://<token>@github.com/o/r.git` は実在する使い方だが、これも断る（`credentials`）── 通すと、**アプリが利用者の token を `.git/config` へ平文で書く**ことになる。設計判断 7（アプリは認証情報を持たない）は「アプリのどこにも溜めない」であって、「アプリが別の場所へ書くのはよい」ではない。

`ssh://git@host/…` の `git@` は利用者名であって認証情報ではないため通す（`:` を含む形 ── つまりパスワード付き ── だけを断る）。断り方を `unsupported-scheme` と分けているのは、次の一手が「打ち直す」ではなく「認証の部分を消す」になるため。

#### Renderer へ渡すのは、URL ではなく表示用のラベル

remote の URL は**リポジトリ root の絶対パスと同じ性質**を持つ（§9.2）── 渡せば、Renderer がそれを指して何かを頼みたくなる。しかも上のとおり、URL は git に任意のプログラムを起動させうる値になる。

そこで一覧に載るのは名前と**ラベル**だけにしてある（`shared/git/remote.ts`）。

```
https://ghp_secrettoken@github.com/octocat/Hello-World.git
  → github.com/octocat/Hello-World
```

落ちるのは scheme・認証情報・port・末尾の `.git` の4つで、**残った文字列から URL は組み立て直せない。** 作るのは Main（`main/git/gitRemoteLabel.ts`）で、**shared には置いていない** ── 置くと Renderer も同じ関数を持つことになり、「逆はできない」と言い切る根拠がその関数の中身に移ってしまう。名前の規則（`remoteName.ts`）と URL の規則（`remoteUrl.ts`）を shared に置いてあるのとは、そこが分かれる。

したがって URL は **Renderer → Main へ1回だけ流れる値**で、往復しない ── 削除の要求に載るのも名前だけになる。

#### ラベルが相手にするのは、アプリが追加したものだけではない

`remoteUrl.ts` が通す形は3つだが、リポジトリには端末から追加されたものが在りうる ── 追加できない形だからといって、一覧から消すことはできない（**見えない remote が Push の送り先になっている**、という形を作らない）。

| 出るもの         | 相手                                                   |
| ---------------- | ------------------------------------------------------ |
| `host/path`      | 読める形（scheme は問わない ── どうせ落とす）          |
| `ローカルのパス` | ローカルを指すもの。**場所そのものは出さない**（§9.2） |
| `不明な形式`     | 読めないもの（`ext::sh -c …` がここへ落ちる）          |

空欄にしないのは、空の行が「読み込みに失敗した行」と見分けが付かないため（`GitStashEntry.subject` と同じ判断）。

#### 名前の規則は、ブランチ名と1点だけ違う

`.` を断る。remote 名は `remote.<名前>.url` という**設定のキーの真ん中**に入るため、`.` が入ると読み書きの境目が動く ── `git remote add a.b <url>` は通るが、その後の `git config remote.a.b.url` がどこを指すのかは打った人にも見分けが付かない。**作れるが、後から扱えない名前**を作らせない。

残りはブランチ名と同じ規則を**書き写して**ある（同じ関数を使い回さない）── 実体が違い、片方に規則が増えた日にもう片方が黙って変わる形にしないため（3-8-14 で削除と rename の失敗の表を分けたのと同じ判断）。

#### `--end-of-options` だけでは足りない、初めての場所

ブランチ名では `--end-of-options` と「先頭の `-` を弾く」の二重にしていたが、そこでは片方でも足りていた。remote では**本当に片方では足りない。**

```
git remote add --end-of-options -x https://github.com/o/r.git   → 通る（-x という remote ができる）
git remote remove -x                                            → error: unknown switch `x'
```

実物で確かめてある。`--end-of-options` が守るのは「引数として解釈されない」ことだけで、**扱えない名前が生まれること**は止めない ── アプリからも端末からも消しにくい remote が残る。だから形の側でも弾く。

逆に、既にそうなっている remote を消せるようにするために `removeRemote` は `--end-of-options` を置いてある（置かないと、その名前はアプリからも消せない）。

#### `set-url` を持たない ── `remote-exists` はその判断の現れ

`git remote add` は名前が既にあれば**失敗する。** それがここで欲しい振る舞いになる ── 足すつもりで押したら送り先が入れ替わっていた、という形を作らない。

同じ判断を 3-8-10 の公開でも取っている（`addOriginRemote` の冒頭）。URL を変える口は 3-8-16 の範囲外で、消して足し直すのとは別の設計が要る（消すと追跡先まで消えるため。下記）。

> **Session 3-8-17 で足した。** 別の1本（`git:set-remote-url`）にしてあり、`git:add-remote` の振る舞いは1文字も変わっていない ── 危なかったのは上書きできることではなく**黙って上書きされること**で、押す前に「今どこを指していて、これからどこを指すか」を見せればその理由は解ける（§14.25）。

#### `github:publish` と別の口にしてある

どちらも最終的には `git remote add` を動かすが、混ぜない。

|              | `github:publish`（3-8-10）                                    | `git:add-remote`（3-8-16）             |
| ------------ | ------------------------------------------------------------- | -------------------------------------- |
| する         | GitHub に repository を**作る** → `origin` を設定 → 初回 Push | 既にあるものを**登録する**             |
| 名前         | 固定（`origin`）                                              | Renderer から来る                      |
| URL          | GitHub が返したもの                                           | Renderer から来る                      |
| ネットワーク | 出る（作る・送る）                                            | **出ない**                             |
| 動かす表     | `addOriginRemote`（引数固定）                                 | `addRemote`（`--end-of-options` 付き） |

1本にすると、「公開」の口から任意の URL を渡せることになる ── `addOriginRemote` が Renderer 由来の値を1つも受け取らない、という 3-8-10 の保証がそこで消える。**動かす git が同じでも、受け取る値の出どころが違えば表も分ける。**

#### 削除で消えるのは3つ ── そのうち1つが確認の理由になる

`git remote remove` が消すもの（実物で確かめてある）。

- `remote.<名前>.*`（URL と fetch の refspec）
- `refs/remotes/<名前>/*`（手元の remote-tracking ref）
- **`branch.*.remote` / `.merge`**（その remote を追っていたブランチの追跡先）

**commit は1つも失われない。** 到達できなくなる ref は remote-tracking だけで、それは同じ URL で足し直せば次の fetch で戻る。

それでも確認を挟むのは3つめのためになる ── 追跡先が消えると、画面の `↑2 ↓1` が消え、Push が「初回の Push」（`--set-upstream`）に戻る。押した人が予想していないことにあたる。Git で確認を挟む4つめで、**この4つの中ではいちばん軽い**（破棄 §14.16 → ブランチの削除 §14.22 → 退避を捨てる §14.23 → ここ）── だから文言も「失われます」とは書かず、「コミットは失われません。同じ URL で登録し直せます」まで書く。盛ると、本当に戻せない場面の警告まで軽く読まれる。

#### 追っているブランチが在っても、止めない

3-8-14 でチェックアウト中のブランチの削除を止めたのは、**git が必ず断る**ものだったから（押しても絶対に通らない）。こちらは git が通すもので、しかも「追跡先が消えるのは承知のうえで消したい」は普通の使い方にあたる ── 止めると、**消したいのに消せない remote** が生まれる。

結果として、この機能には**押す前に分かる「絶対に通らない理由」が1つも無い**（3-8-14 / 3-8-15 と違うところ）。同じ名前があるかも、その remote が在るかも、手元の設定を見ないと分からない ── 答えるのは git になる。

#### 一覧に「今どれが使われているか」を出さない

出せはする（`branch.<名前>.remote` を読めばよい）が、出さない ── 出すと、その隣に「これを使う」を置きたくなる。3-8-5 から引いている「送り先を名前で指せる欄を作らない」線を、一覧の側からも崩さない。この層が読むのは remote の名前と URL だけで、branch の設定は見ない。

#### 相乗りさせないのは、これで4つめ

`GitRepositoryState.ready` が持っているのは今も **`hasRemote`（有無だけ）** で、3-8-10 から1文字も動かしていない ── あちらはパネルが開いている間ずっと「公開の入口を出すか」を決めている値になる。

一覧はブランチ（§14.14）・履歴（§14.19）・退避（§14.23）と同じ側で、**見られているのは面を開いている間だけ**にあたる。相乗りさせると、ファイルを保存するたびに `git remote --verbose` を1回起動することになる。

追いつき方は**退避と同じ側**（開いている間だけ `git:changed` を購読する）── 端末で `git remote add` を打つことがあり、そのとき出たままの一覧は「さっき足したものが無い」という形で嘘をつく。ただし退避と違い、**古い一覧が押し間違いにはならない** ── remote は位置ではなく名前で指すため、名前が在ればそれは同じ remote になる。

#### 上限を git に掛けられない、初めての一覧

`for-each-ref`（`--count`）・`log`（`--max-count`）・`stash list`（`--max-count`）と違い、**`git remote` に件数を切る指定は無い。** したがって「上限より1つ多く求めて、切れたかを知る」形が取れず、上限は読む側で掛ける（`readRemoteEntries`）── 上限を超える名前が現れた時点で `truncated` を立てて読むのをやめる。数え方が違うだけで、返すものは他の一覧と同じになる。

remote は普通1つか2つなので、この差が実際に効くことは無い。それでも上限（100 件。履歴・退避と同じ数）を置くのは、**IPC を渡る配列の長さがリポジトリ次第で決まる形にしない**ためになる。

#### 出力は1件につき2行来る

```
origin<TAB>https://github.com/o/r.git (fetch)
origin<TAB>https://github.com/o/r.git (push)
```

同じ名前が2回出るので、**先に出た方（fetch）だけを採る。** `git remote set-url --push` で push 側だけを変えている人が居ても、載せるのは fetch 側1つになる ── push 側だけを変える口をアプリが持っていない以上、2つ並べても読む人にできることが無い。

区切りは TAB で、末尾の ` (fetch)` / ` (push)` は**末尾から**落とす ── URL の側には空白が入りうる（`ext::sh -c whoami` のような値が端末から追加されていることがある）ため、空白で切ると値の途中で切れる。remote 名に TAB は入らない（git が禁じ、こちらも弾いている）ので、名前の側に何が入っていても読み分けられる。

#### 増えた口は3本

| チャンネル          | 要求       | 応答                                     |
| ------------------- | ---------- | ---------------------------------------- |
| `git:list-remotes`  | `void`     | `ListGitRemotesResponse`（名前とラベル） |
| `git:add-remote`    | 名前 + URL | `GitOperationResponse`                   |
| `git:remove-remote` | 名前       | `GitOperationResponse`                   |

追加が**1つの要求に外来の値を2つ運ぶ2つめ**になる（1つめは 3-8-14 の rename）。あちらは「どれを」と「何に」で2つとも同じ規則を通ったが、こちらの2つは性質そのものが違う ── 名前は境界を往復し、URL は一方向にしか流れない。したがって規則も別のファイルになる。

名前を通す関数は追加と削除で**同じ**にしてある（`remoteNameField`）── 入口を分けると「足せるが消せない名前」が生まれる。

#### UI（Renderer）

置き場所は**上部バーの「リモート」**で、履歴・退避の隣になる。3つとも「①変更 → ②メッセージ → ③Commit / Push の一続きの上に無いもの」で、開くのは面にあたる。

**`hasRemote` に関わらず、常に同じ場所に在る。** remote が無いときだけ出す形にすると、押す場所がリポジトリの状態で動くことになる ── remote が1つも無い人にとっても「ここが接続する場所」であることは変わらない。

それとは別に、Push / Pull の下（公開のボタンの隣）に **「既存のリポジトリに接続する」** の導線を置いてある。remote が無い人がいちばん長く見ているのはその位置で、そこに「もう1つの選び方」が無いと公開が唯一の道に見えるため。見た目は控えめにしてある（ボタンではなく1行の文）── 2つを同じ大きさで並べると、どちらを押すかを先に決めさせることになる。

面は退避と同じ器で、一覧の下に追加の欄を置く（`GitRemoteOverlay.tsx`）。**入力欄が2つ並ぶ初めての面**になるので、押せない理由も名前 → URL の順で出す ── 打っている人の目は上から下へ動き、URL の問題を先に出すと同じ場所を読み直すことになる。削除の確認は行の下に開き、`Esc` は開いた順に1つずつほどく（3-8-14 / 3-8-15 と同じ形）。

#### `no-remote` の文言を整理した

3-8-10 の時点では2つ書いていた ──「GitHub に公開」と、端末での `git remote add`。3-8-16 で後者の道もパネルの中に在るため、**端末への案内は落とす** ── 出せる行き先が2つになった以上、3つ並べると「どれを押せばよいか」を先に判断させることになる。

並びは「繋ぐ → 作る」にしてある。この文が出るのは Push / Pull を押した後で、**送り先があるつもりだった人**が読む ── その人にとって近いのは、既に在るものへ繋ぐ側になる。

#### 実物に対して固定してあること

`gitRemoteRepository.test.ts` で確かめたいのは、3-8-14 の「消えていないこと」とも 3-8-15 の「指したとおりであること」とも違う ── **何が消えるか**と、**git が受け取ってしまう値を、こちらが受け取らないこと**になる。

- remote が1つも無くても `git remote --verbose` は 0 で終わり、空を返す（「1件も無い」を失敗にしない根拠）
- 1件につき2行出るのを1件として読む／fetch と push で URL が違っても fetch 側1つ
- 追加してもネットワークへ出ない（届かない URL でも通る・remote-tracking ref が増えない）
- 追加しても**追跡先は付かない**（`branch.<名前>.remote` が増えない）
- 同じ名前を2度足すと `remote-exists` で断り、**先にあった URL は1文字も変わらない**
- 削除すると、設定・remote-tracking ref・**追跡先**の3つが消える
- 削除しても **commit は1つも失われない**（確認の文言の根拠そのもの）
- 無い remote を消そうとすると `remote-not-found` で、**他の remote は1つも消えない**
- **git は `ext::sh -c …` を remote として受け取る**が、`normalizeGitRemoteUrl` は断る
- **git は `--end-of-options` の後ろの `-x` を名前として受け取る**が、`normalizeGitRemoteName` は断る
- `--end-of-options` を置かないと、その remote は消せない（置いてあれば消せる）
- 認証情報つきの URL が既に在っても、境界を渡るのはラベルだけ（token が応答に載らない）
- Workspace root がリポジトリ root でなければ一覧しない（git 自身はサブフォルダでも答える）

**上限（100 件）は、確かめる相手を移してある**（3-8-15 と同じ判断）── 切り方そのものは `gitOutput.test.ts` が純粋な関数として固定済みで、実物には「本番の引数（`listRemoteUrls()`）が出す形が、その関数の読める形か」だけを聞いている。

### 14.25 remote の URL の変更 / rename（Session 3-8-17）

3-8-16 は remote の**登録簿**を作った（一覧・追加・削除）。そこで意図的に置かなかったのが、既にある1行を**書き換える**2つになる。

| 3-8-16 が書いた理由                                                                                  | 実物で確かめた結果                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `set-url` … 黙って上書きすると、送り先が入れ替わったことに誰も気づかないまま Push が別のところへ飛ぶ | **そのとおりで、しかも記述より悪い**（下記）                       |
| rename … 追跡先まで書き換わる ── 消して足し直すのとは別の設計が要る                                  | 「別」だったが**易しい側に別**だった。git が全部追随させる（下記） |

3-8-17 で足したのはこの2つで、**増えたのは今回も「登録簿を編集する口」だけ**になる ── `git:push` / `git:pull` の要求は今も `void` で、3-8-5 の「送り先を名前で指せる欄を作らない」は 3-8-17 でも撤回していない。

#### `set-url` が書き換えるのは1行だけ ── 危ないのはそこではなく「残るもの」

`git remote set-url` の実測（git 2.54。`gitRemoteRepository.test.ts` が固定している）。

```
set-url 前:  remote.origin.url=<bare>   ## main...origin/main [ahead 1]
set-url 後:  remote.origin.url=https://github.com/o/unrelated.git
             ## main...origin/main [ahead 1]   ← まったく同じ表示
```

変わるのは `remote.<名前>.url` の**1行だけ**で、次の3つは1つも動かない。

- `remote.<名前>.fetch`（refspec）
- `refs/remotes/<名前>/*`（**前の送り先から取ってきた commit を指したまま**）
- `branch.*.remote` / `.merge`（追跡先）

つまり削除（§14.24）とは正反対で、**失われるものが1つも無い代わりに、古いものが残る。** 送り先を丸ごと別のサーバーへ向けても画面の `↑1` はそのままで、それは**もう別の相手と比べた数**になる ── 3-8-16 が言った「誰も気づかない」は、気づかないどころか**画面が積極的に嘘をつく**状態だった。

#### だから、上書きを断つのではなく「黙って」を断つ

3-8-16 が断ったのは上書きできること自体ではなく、それが黙って起きることだった。したがって解き方は**押す前に見せる**になる ── Git で確認を挟む**5つめ**で、この5つの中で**失われるものが1つも無い唯一の確認**にあたる。

| #   | 確認                     | 失われるもの                   |
| --- | ------------------------ | ------------------------------ |
| 1   | 破棄（§14.16）           | 書きかけの中身                 |
| 2   | ブランチの削除（§14.22） | そこにしか無い commit への名前 |
| 3   | 退避を捨てる（§14.23）   | 退避の中身                     |
| 4   | remote の削除（§14.24）  | 追跡先（commit は失われない）  |
| 5   | **URL の変更（ここ）**   | **1つも無い**                  |

出すのは2つで、**どちらも新しく境界を渡る値ではない。**

```
現在    github.com/o/old        ← 一覧の行が持っているラベル（§14.24）
変更後  https://github.com/o/new.git   ← 利用者が今その欄に打った文字列
```

3-8-16 の「URL は Renderer へ渡さない」は1文字も動いていない ── 左は既に一覧に出ているラベルで、右は Renderer が手元に持っている入力値になる。

文言が言うのは**何が消えるか**ではなく**何が残るか**にした ── 「取得済みのリモート追跡情報は前の送り先のまま残るため、次の Pull まで ↑ ↓ の数は前の送り先と比べたものになります。コミットは失われません。」これがこの操作でいちばん読まれにくいことにあたる。「危険です」とは書かない（打ち直せば戻る）── 盛ると、本当に戻せない場面の警告まで軽く読まれる。

残った ref を消しに行くことは**しない**（`--prune` を渡さない）── ref を消す操作が変更に混ざると、削除との境目が消える。次の Pull で揃う。

#### 同じ URL を渡されても `nothing-to-do` にしない

3-8-6 の「今のブランチを選んだ」は Renderer が持っている値で判定できたが、ここは違う ── 一覧に載るのはラベルだけで、**Renderer は今の URL を持っていない**。Main で判定するには `git remote get-url` を1本増やすことになり、得られるのは文言だけになる。

変わらない値で上書きしても壊れるものも失われるものも無いので、git へそのまま渡して成功として返す。**出せる警告と出せない警告の違いは、比べる相手が手元にあるかで決まる**（rename の側では「同じ名前」を押す前に言える ── 名前は行が持っているため）。

#### rename は remove + add より安全だった

`git remote rename` の実測。**必要なものを全部追随させる。**

| 追随するもの                   | 実測                                       |
| ------------------------------ | ------------------------------------------ |
| `remote.<新名>.url` / `.fetch` | 設定ごと移り、refspec の行き先も書き換わる |
| `refs/remotes/<新名>/*`        | remote-tracking ref も改名される           |
| `branch.*.remote`              | **追っていたブランチの追跡先も追随する**   |
| `remote.pushDefault`           | 指していれば、それも追随する               |

したがって rename の後も `↑2 ↓1` は消えず、Push はそのまま通る（`gitRemoteRepository.test.ts` が Push まで確かめている）── **失われるものが1つも無い。** 3-8-14 でブランチの rename に確認を置かなかったのとまったく同じ判断で、確認は挟まない。

3-8-16 の「消して足し直すのとは別の設計が要る」は正しかったが、難しい側ではなく**易しい側**に別だった ── remove + add は追跡先を失うが、rename は失わない。

**その2段をアプリの中で代用しない。** 後半が失敗すると remote が1つも無いリポジトリが残る（3-8-10 の `git init` で「一続きにしない」と決めたのと同じ事情）。

#### 大文字小文字だけの rename ── 3-8-14 と逆の答えになる1点

remote で初めて、**渡された値だけで決まる「絶対に通らない理由」**が1つできる。3-8-16 の3つ（一覧・追加・削除）には1つも無かった。

Windows では `refs/remotes/origin/…` と `refs/remotes/Origin/…` が同じファイルになるため、`git remote rename origin Origin` は落ちる ── **しかも途中まで適用したまま止まる**（実測）。

```
error: renaming remote references failed: cannot lock ref 'refs/remotes/Origin/main': ...
exit 128

remote.Origin.url=https://github.com/o/r.git          ← 改名された
remote.Origin.fetch=+refs/heads/*:refs/remotes/origin/*  ← 古いまま
branch.main.remote=origin                              ← 存在しない remote を指す
refs/remotes/origin/main                               ← 改名されていない
## main                                                ← upstream の表示が消える
```

つまり「失敗したのでやり直せる」ではなく、**1回目で壊れる。**

|              | ブランチ（3-8-14）             | remote（3-8-17）           |
| ------------ | ------------------------------ | -------------------------- |
| git の逃げ道 | `--force`（`-M`）が**ある**    | **無い**                   |
| 失敗の仕方   | 断られるだけ（何も変わらない） | **途中まで適用して止まる** |
| こちらの答え | 相手が自分自身だと確かめて通す | **git を動かす前に断る**   |

同じ問いに逆の答えを出しているのは、git が用意している逃げ道の有無がそこで分かれるためになる。中間の名前を経由する2段（`origin` → `tmp` → `Origin`）を**アプリが代わりに動かすことはしない** ── 途中で止まると利用者が自分で片付けられない状態が残る。

断り方は `unsupported-target`（`nothing-to-do` ではない ── 押した意味が無かったのではなく、この経路では行えない）。Renderer 側でも押せなくしてあり、理由には**なぜ通らないか**まで書く ── 「使えません」だけだと打ち直せば通ると読まれ、同じところを何度も試すことになる。

#### 失敗の分類は、これで4つに分かれた

表を分ける判断は 3-8-14 から変えていない（**読む相手のコマンドが違えば、片方に言い方が増えた日にもう片方が黙って変わる形にしない**）。3-8-17 で、重ならなさが1段はっきりした。

| 表                      | `remote-exists` | `remote-not-found` |
| ----------------------- | --------------- | ------------------ |
| 追加（`add`）           | ○               | ─                  |
| URL の変更（`set-url`） | ─               | ○                  |
| rename                  | ○               | ○                  |
| 削除（`remove`）        | ─               | ○                  |

**rename にだけ両方がある**（ブランチの rename と同じ形）。git の言い方と終了コードは実物で確かめてある。

```
error: remote other already exists.   … 3   （rename / add）
error: No such remote: 'nope'         … 2   （rename / remove）
error: No such remote 'nope'          … 2   （set-url ── コロンが無い）
```

**`cannot lock ref` はどの表でも読まない。** 大文字小文字だけの rename で出る stderr は `.lock` / `Another git process seems to be running` と読めるため、素直に分類すると `index-locked`（＝他の git を閉じてやり直せば通る）という**嘘の案内**になる ── 実際は何度やり直しても通らず、しかもその時点で既に壊れている。その組み合わせは手前で断ってあるのでここへは落ちてこないが、`unknown` に倒れることをテストで固定してある（断つ側を外した日に嘘の案内が黙って出ないように）。

#### 増えた口は2本

| チャンネル           | 要求              | 応答                   |
| -------------------- | ----------------- | ---------------------- |
| `git:set-remote-url` | 名前 + URL        | `GitOperationResponse` |
| `git:rename-remote`  | 名前 + 新しい名前 | `GitOperationResponse` |

`git:add-remote` に「既にあれば上書き」を足して1本にはしない ── 3-8-16 が `remote-exists` で断ると決めた振る舞いがそこで消える。`git:stage` と `git:unstage`、`git:delete-branch` と `git:rename-branch` を分けてあるのと同じ判断になる。

**通す関数は1つも増やしていない。** URL の変更は追加とまったく同じ2つ（`normalizeGitRemoteName` / `normalizeGitRemoteUrl`）を通り、rename は名前2つとも `normalizeGitRemoteName` を通る（`remoteNewNameField`）── 入口を分けると「追加では通らないが変更では通る URL」「元の名前としては通るが新しい名前としては通らない」が生まれる。`git remote set-url x "ext::sh -c whoami"` も `git remote rename --end-of-options up2 -x` も git は受け取ってしまう（どちらも実物で確かめてある）。

#### UI（Renderer）

面も入口も増やさない。増えたのは**行の中の操作2つ**で、1行に3つ並ぶ形になる ── ブランチの行（切り替え / rename / 削除）とまったく同じ形にあたる。

```
origin   github.com/octocat/Hello-World          [🔗] [✎] [✕]
```

並びは「変える → 変える → 消す」で、**戻せない側が端**になる。色が赤に変わるのは ✕ だけで、これもブランチの行と同じ。**行そのものは3つになっても押せないまま** ── remote を「選ぶ」操作は今も1つも無い。

3つとも押すとその場で git が動くのではなく**行の下が開く**（`aria-expanded` を持たせてあるのはそのため）。開くものは操作で違う。

| 操作        | 開くもの               | 欄の初期値                            |
| ----------- | ---------------------- | ------------------------------------- |
| 🔗 URL 変更 | 入力欄 →（押すと）確認 | **空**（今の URL が Renderer に無い） |
| ✎ 名前変更  | 入力欄（確認は無い）   | 今の名前                              |
| ✕ 削除      | 確認だけ               | ─                                     |

**URL の欄が空から始まるのは、3-8-16 の境界がそのまま効いている結果**になる ── 変える相手が分からなくならないよう、欄の上には行と同じラベルを出す（「現在の送り先: github.com/o/r」）。名前の欄が今の名前で始まるのとの違いは、**比べる相手が手元にあるか**の1点で決まる。

URL 変更の確認は**行の下の中で入力欄と置き換わる**（別の面を重ねない）── `Esc` が3段になるのを避けるためで、「やめる」で欄へ戻ると打った URL はそのまま残っている。`Esc` は 3-8-14 / 3-8-15 / 3-8-16 と同じく、行の下 → 面 の順に1つずつほどく。

#### 実物に対して固定してあること

`gitRemoteRepository.test.ts` に足したのは2つの塊で、確かめたいことが 3-8-16 とは逆向きになる ── あちらが**何が消えるか**なら、こちらは**何が変わらないか**にあたる。

- URL だけが変わり、refspec・remote-tracking ref・追跡先は1つも動かない
- **ahead / behind は変更前と同じまま残る**（確認の文言の根拠そのもの）
- 同じ URL を渡しても成功として終わる（`nothing-to-do` にしない）
- 無い remote を指すと `remote-not-found` で、**他の URL は1文字も変わらない**
- 変えると一覧のラベルも変わる（ラベルは変更後の URL から作り直される）
- rename で**設定・refspec・remote-tracking ref・追跡先・`pushDefault` の5つが追随する**
- rename の後も追跡先が生きていて、**素の `git push` が通る**
- 行き先が既にあれば `remote-exists` で、**どちらの remote も変わらない**
- 同じ名前なら git を動かさず `nothing-to-do`
- **大文字小文字だけの改名は git を動かさずに断り、半分だけ適用された痕跡が1つも無い**
- **git は `set-url` でも `ext::…` を受け取る**が、`normalizeGitRemoteUrl` は断る
- **git は `rename` の行き先として `-x` を受け取る**が、`normalizeGitRemoteName` は断る
- **git の大文字小文字だけの rename は、途中まで適用したまま落ちる**（断つ理由そのもの）

最後の1件だけ、確かめている相手が git そのものになる（3-8-16 の `ext::` / `-x` と同じ側）── **写しを相手にすると、この前提を自分で書くことになる。**

### 14.26 競合の解決（Session 3-8-18）

3-8-2 は競合を**別のグループとして出す**ところまでを作った。それから 3-8-17 まで、その行にできたのは**エディタで開くこと**だけになる（`canOpenGitChange` は競合を通す）。

つまり **利用者はアプリの中で競合を直せるのに、直したと Git へ伝える手段が無かった。**

#### アプリは3箇所で「解決してください」と言っていた

| 出どころ                     | 文言                                           | 足りなかったもの |
| ---------------------------- | ---------------------------------------------- | ---------------- |
| Commit の失敗（3-8-4）       | 競合が解決されていないため Commit できません。 | 解決する手立て   |
| 退避が押せない理由（3-8-15） | …先に解決してからお試しください。              | 同上             |
| 退避を戻した結末（3-8-15）   | …競合しました（退避は一覧に残しています）。    | 同上             |

3-8-15（「Commit するか**退避して**から」と書いていたのに退避が無かった）・3-8-16（「公開」は在るのに「接続」が無かった）とまったく同じ形にあたる ── **自分の言葉が指す先が、アプリの中に無い。**

#### しかもその状態は、アプリ自身が作れる

競合を生む経路を数えると1つしか無い。

| 経路                         | 競合するか                                              |
| ---------------------------- | ------------------------------------------------------- |
| Pull（§14.13）               | しない（`merge --ff-only` 固定）                        |
| ブランチの切り替え（§14.14） | しない（競合しそうなら git が断る）                     |
| **退避を戻す（§14.23）**     | **する**（`stash pop` は3段を作る。実物で確かめてある） |
| 端末での merge / rebase      | する（アプリの外から）                                  |

つまり **`stash pop` は、押した結果として出口の無い状態へ入れる操作だった。** 3-8-15 はその結末を `partly-applied` として正しく報告していたが、報告した先が行き止まりだったことになる。

#### 足りなかったのは1手だけ ── 前後は既に出来ていた

```
①エディタで直す        → 3-8-2 から在る（競合の行は開ける）
②解決したと Git へ伝える → ここが空いていた（3-8-18）
③Commit する           → 3-8-4 から在る
```

③が本当にそのまま繋がることは実物で確かめてある ── `commitStagedChanges` の引数（`commit --quiet --cleanup=whitespace --file=-`）は、マージの途中でも**マージ commit を作り、MERGE_HEAD を消す**（親が2つになる）。退避の競合ではマージではないので普通の commit になる（親は1つ）。

したがって **3方向マージのエディタは作っていない。** 作らなくても①③が揃っているためで、`ours` / `theirs` の差分も 3-8-18 の範囲外にした（§14.18。既存の差分の器には載るので、次の候補として残った）── **その候補は Session 3-8-21 で埋まった**（§14.29）。埋まってなお 3方向のエディタは作っていない ── 3-8-21 が足したのは**読む口**1つで、解決はいまも 3-8-2 から在るエディタで行う。

#### Stage とは別の操作にしてある ── この回のいちばん大きな決めごと

組み立てる引数は `git add -- <path>` で**まったく同じ**になる。それでも分ける。

|            | Stage（`git:stage`）                       | 解決（`git:resolve-conflict`）                     |
| ---------- | ------------------------------------------ | -------------------------------------------------- |
| 何をするか | 作業ツリーの姿を、次の Commit の中身へ写す | **index の3段（base / ours / theirs）を1段に畳む** |
| 戻せるか   | 戻せる（`−` で Unstage）                   | **戻せない**（下記）                               |
| チャンネル | `git:stage`                                | `git:resolve-conflict`                             |
| 引数の表   | `stagePaths`                               | `markConflictResolved`                             |
| 失敗の分類 | `classifyGitOperationFailure`              | `classifyGitResolveConflictFailure`                |
| 絵と言葉   | `＋` /「Stage」                            | `✓` /「解決済みにする」                            |

`github:publish` と `git:add-remote`（§14.24）、`git:add-remote` と `git:set-remote-url`（§14.25）を分けてあるのと同じ判断で、**動かす git が同じでも、意味が違えば口を分ける。**

1本にまとめると、競合の行に出したボタンが「Stage」と名乗ることになる ── そして押した人は「後で Unstage で戻せる」と読む。読んだとおりにはならない。

#### 戻せない ── だから取り消しを置いていない

実物で確かめた2つが、どちらも「取り消し」にならない。

```
git reset --quiet HEAD -- f.txt      本番の Unstage とまったく同じ引数
  → 競合は復元されない。3段が畳まれた**ただの変更**として残る

git checkout --merge -- f.txt
  → 競合は復元される。ただし**利用者が書いた解決内容が上書きされる**
```

前者を「解除」として出すと、押した人は戻ったつもりで3段を失う。後者は書いたものが消える。**戻す手立てが無いのではなく、戻したことにならない手立てしか無い。**

したがって口そのものを作らず、解決して**ステージ済みへ移った行に `−` が出ることも受け入れている** ── そこで押されるのは「その変更を Commit に含めない」であって、競合の復元ではない。行が移った時点で、それはもう普通のステージ済みの1件になる。

#### マーカーが残っていたら、git を1回も動かさない

git は**マーカーが残ったままの `add` を通し、その後の Commit も通す**（実物で確かめてある）。

```
git add f.txt            # <<<<<<< が残ったまま
git commit ...           # 通る
git show HEAD:f.txt      # <<<<<<< HEAD がそのまま記録されている
```

履歴に永久に残るものを押し間違いで作らせないので、押す前に確かめる ── 3-8-14 が大文字小文字だけの改名を確かめるために git を1回増やしているのと同じ性質にあたる。**押す前に分かることは、押す前に確かめる。**

**何がマーカーかは、こちらで決めない。** `<<<<<<<` で始まる行を自分で探すと、差分の書き方を説明した Markdown のような**正当なファイル**まで拾う。判定は git（`diff --check`）に任せ、こちらはその答えを読むだけになる。

#### 終了コードでは決められない ── 出力の行を読む理由

`--check` は2つのことを**同じ終了コード（2）**で報告する。

```
f.txt:2: leftover conflict marker     ← まだ解決し終えていない
g.txt:2: trailing whitespace.         ← 行末に空白があるだけ（解決は済んでいる）
```

終了コードだけを見ると、後者で断られる ── 押せない理由として出す文がそこで嘘になる。したがって読むのは行で、拾うのは `leftover conflict marker` で終わる行だけになる（`countLeftoverConflictMarkers`）。

`-c core.whitespace=-...` で空白の検査を切る手もあり、実際それでも終了コードは分かれる。**だが `.gitattributes` の `whitespace=` はその `-c` より強い**（実物で確かめてある）── つまりリポジトリ次第で誤検知が戻る。出力を読む形なら、どちらの設定でも答えが変わらない。

英語を読んでよい根拠は `LC_ALL=C`（§14.3）にあり、3-8-1 から stderr の分類が英語の言い回しを読んでいるのと同じ足場になる。

**マーカーが無い競合もある。** どちらも断ってはいけない。

| 競合の形                  | `--check`          | 正しい答え                                       |
| ------------------------- | ------------------ | ------------------------------------------------ |
| 内容の競合（`UU`）        | マーカーを報告する | 解決するまで断る                                 |
| 片方が削除（`UD` / `DU`） | 何も言わない       | **そのまま解決できる**（作業ツリーの中身を残す） |
| バイナリ（`UU`）          | 何も言わない       | **そのまま解決できる**                           |

#### Main は届いた対象を、読み直した状態で確かめる

3-8-9 の破棄とまったく同じ構えで、押す前に2つ見る。

1. その位置が**今も競合のグループに居るか**（`path-not-found`）
2. マーカーが残っていないか（`conflict-markers-present`）

1つめが要るのは、競合していない位置に `git add` を当てると**ただの Stage になってしまう**ためになる ── 別の口として分けた意味がそこで消える。端末で先に解決された、という形で普通に起こる。

確かめられなかったとき（git が動かなかった・想定しない終了コード）は**通さない側へ倒す** ── 分からないまま通すと、その一回だけマーカーが履歴へ入りうる。倒しておけば、最悪でも「もう一度押す」で済む。

#### 2つの「競合」の文を、別のことにする

| 分類                                 | 出るとき        | 次の一手                         |
| ------------------------------------ | --------------- | -------------------------------- |
| `unresolved-conflicts`               | Commit を押した | **この操作を押すこと**           |
| `conflict-markers-present`（3-8-18） | 解決を押した    | **エディタでマーカーを消すこと** |

同じ言葉に潰すと、押した人はどちらを直せばよいか分からないまま同じボタンを押し直す。3-8-18 で `unresolved-conflicts` の文言に「競合の行で『解決済みにする』を押してください」を足したのは、**その行き先がアプリの中に出来たから**にあたる。

#### 増えた口は1本

| チャンネル             | 要求    | 応答                   |
| ---------------------- | ------- | ---------------------- |
| `git:resolve-conflict` | 位置1つ | `GitOperationResponse` |

グループは載らない ── 対象は必ず競合のグループの行で、他から押せる場所が無い（破棄が `group` を要求するのは、同じ位置が2つのグループに並びうるため）。位置を確かめる関数は Stage / Unstage / 差分 / 破棄と**まったく同じ**（`pathspecField`）で、5つめの入口から違う規則が効くことは無い。

「確認したか」の欄も、「マーカーを確かめたか」の欄も無い ── 後者を Renderer から渡せる形にすると、**渡さなければ確かめを飛ばせる**ことになる。

#### UI（Renderer）

面も入口も増やさない。増えたのは**競合の行の右端の1つ**だけになる。

```
競合
  ! app.ts   src            ✓        ← 3-8-18 で付いた（Stage の ＋ ではない）
```

**hover しなくても見える**ようにしてあるのが他の行との違いになる（他の操作は行を指せば現れる）── 競合の行は「次に何をすればよいか」がいちばん分かりにくい行で、その1つしか無い出口を hover で探させない。

色は普通の文字の色のままで、破棄のような危険色は付けない ── **利用者が書いた中身は1文字も動かない**操作にあたる。

確認は挟まない（同じ理由）。押せない理由も無い ── マーカーが残っているかは Renderer には分からないため（作業ツリーの中身を持っていない）、断りは押した後に一覧の上の1行として出る。

#### 実物に対して固定してあること

`gitConflictRepository.test.ts` で確かめたいのは、3-8-16 / 3-8-17 の remote とはまた違う2つになる ── **git が通してしまうこと**と、**その先が繋がっていること**。

- `stash pop` の競合が3段を作る（3-8-19 まではアプリが競合を生む唯一の経路。3-8-20 でマージが加わった）
- マーカーを消して保存しても、伝えるまでは競合のまま
- 解決すると3段が1段に畳まれ、ステージ済みへ移る
- その後、**本番と同じ引数の Commit がマージを完結させる**（親が2つ・MERGE_HEAD が消える）
- 退避の競合でも、解決してそのまま Commit できる（親は1つ）
- **git はマーカーが残ったままの add と commit を通す**（`git show HEAD:f.txt` に `<<<<<<<` が入る）
- マーカーが残っていれば断り、**index は1段も動かない**
- 片方だけマーカーを消した場合も断る
- 競合していない位置は受け取らない（**ただの Stage にしない**）
- 端末で先に解決されていたら、git を動かさず断る
- 片方が削除された競合（`UD`）とバイナリの競合は、マーカーが無いのでそのまま解決できる
- `git diff --check` は**空白の誤りも同じ終了コード**で報告する（＝行を読む理由）
- **`.gitattributes` の `whitespace=` は `-c core.whitespace=` より強い**（同上）
- **`git reset HEAD` は競合を復元しない**（＝取り消しを置かない根拠）
- `git checkout --merge` は復元するが、**書いた解決内容を消す**（同上）

最後の2つだけ、確かめている相手が git そのものになる（3-8-16 の `ext::` / 3-8-17 の大文字小文字の rename と同じ側）── **写しを相手にすると、取り消しを置かない理由を自分で書くことになる。**

---

### 14.27 remote-tracking branch から手元にブランチを作る（Session 3-8-19）

3-8-6 のブランチの面は、はっきり1つのことを断っていた ── **remote-tracking branch は一覧に載せず、名前を渡しても手元に作らない**（`--no-guess`）。理由は「押したら手元にブランチが作られる」という、一覧を見ただけでは分からない副作用を1行おきに混ぜないことにあった（`shared/git/branch.ts`）。

3-8-19 はその判断を**撤回せずに、行き先だけを用意する**回になる。

#### 混ぜないまま足す（別チャンネル・別の一覧）

チャンネルを2本に分けたのは、次の3つが別々に効くためになる。

| 分けた理由        | 1本にすると                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- |
| 動かす git が違う | 面を開くたびに `for-each-ref` が**必ず2回**走る（ローカルだけ見たい人にも）        |
| 上限が別々に効く  | remote 側が 500 件あるとローカルの行が押し出され、`truncated` が何を指すか言えない |
| 押した結果が違う  | 行ごとに「切り替わる」と「欄が開く」が変わり、種別の欄で見分けることになる         |

したがって `git:list-remote-branches` と `git:list-branches` は別の1本で、応答も別の型になる（`shared/ipc/contracts/git.ts`）。

#### それでも同じ面に置く

上のバーに4つめのボタン（履歴・退避・リモートの隣）は足していない。3-8-6 が一覧と作成を1つの面に置いた理由が、そのまま3つめにも効くため ── 一覧を開いて `feature/x` が無かった人の次の問いは「じゃあ remote には在るのか」で、別の面にあると閉じて押し直すことになる。

面の並びは上から3つで、**3-8-6 からそこに在った2つの位置は動かさない。**

```
1. ローカルの一覧    押すと切り替わる（今のブランチも押せる。§14.14）
2. 新しく作る欄      今の場所から作って切り替わる
3. remote の枝の段   畳んである。開くと一覧、押すとローカル名の欄が開く
```

3 を畳んでおくのは、常に開くとローカルの一覧が長い人ほど作成欄が下へ押し出されるため ── 増えるのは見出しの1行だけになる。畳んだ側にも**件数は出す**（開かずに「在るか」が分かる方が早い）。

#### 押しても切り替わらない

この段の行を押して起きるのは、**行の下にローカル名の欄が開くこと**だけになる。3-8-6 が避けた副作用（一覧を見ただけでは分からない結果）は、ここでも作らない ── 手元にブランチが増えるのは、名前を確かめて「作成」を押した1回だけにあたる。

`aria-expanded` を持たせてあるのはそのためで、押した結果として何かが現れることを見えていない人にも同じように伝える。行に ✎ / ✕ は無い（remote branch の削除 / rename は §14.22 のまま対象外）。

#### ローカル名は「既定値を出して、変えられる」

`origin/feature/x` を押すと `feature/x` が入った欄が開く。**それでも欄にしてある**のは、同じ名前のローカルブランチが既にある人に**打ち直す以外の道が無い**ため（下記）── 決め打ちにすると、その人はこの機能を使えない。

##### 切り出すのは Main（Renderer では正しく切れない）

`origin/feature/x` から `feature/x` を切る位置は、**remote の名前の一覧を知っている側にしかない。** remote 名に `/` を入れられるためで（`shared/git/remoteName.ts` が禁じていない）、`up/stream/feature/x` の remote は `up/stream` かもしれず `up` かもしれない。

git の atom（`%(refname:lstrip=3)`）も当てにできない ── 実物では `stream/feature/x` に切る（確かめてある）。したがって Main が `git remote` の名前を**長い順**に並べ、いちばん長い接頭辞で切る（`main/git/gitOutput.ts` の `readRemoteBranches`）。Renderer へ渡るのは切った後の2つ（`name` と `branch`）で、Renderer は文字列を割らない。

#### symbolic HEAD（`origin/HEAD`）を除く

`refs/remotes/origin/HEAD` は、その remote の既定ブランチを指す**別名**にあたる。載せると、指した先が別の行（`origin/main`）と同じになる選択肢が並ぶ。

**名前では弾かない。** `%(refname:short)` は symbolic HEAD に対して `origin/HEAD` ではなく **`origin`** を返す（確かめてある）── 名前での判定はそこで既に足を取られる。判断に使うのは `%(symref)` で、これは git 自身が持っている区別になる：空でなければそれは別名で、指し先はこの一覧の別の行になる。

一覧から除いてあっても、**要求としては届きうる**（`git branch --remotes --list origin/HEAD` はパターンに一致する。確かめてある）── したがって作成の側でも同じ判断で断る。認めると、追跡先が別名を指すブランチができ、remote 側の既定が変わった日に追跡先が黙って移る。

#### 渡された名前が本当に remote の枝か、git に確かめる

この回で新しく増えた問いになる。

| 問い                                | 答えるのは                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| 名前の**形**として通るか            | `normalizeGitBranchName`（shared・Renderer と共有）                 |
| それが `refs/remotes/` の下に在るか | **git**（`branch --remotes --list`。main/git/gitRemoteBranches.ts） |

形の検証では答えられない ── `origin/x` という名前の**ローカル**ブランチは作れるので、`/` を求める検証を足しても区別にならない。そして確かめないと通ってしまう：`switch --create new --track main` を git は受け取り、`branch.new.remote=.` を書いて**ローカルを追うローカルブランチ**を作る（実物で確かめてある）。押した人が一覧から選んだのは remote の枝なので、それは指していないものにあたる。

**名前の形の話ではないものを、名前の形の検証で守ったつもりにしない** ── `shared/git/branchName.ts` が「既にある名前か」を git に答えさせているのと同じ線になる。

`for-each-ref` ではなく `branch --remotes --list` を使うのは 3-8-14 の `listExactBranch` と同じ理由で、前者のパターンは**完全な refname** で書く必要があり、外から来た名前に `refs/remotes/` を**繋いだ1つの引数**を作ることになる（3-8-12 で `<hash>^` を作らないと決めた線）。

#### 同じ名前が埋まっていたら、git を動かす前に断る

取りうる道は4つあり、**4つめを選んだ**。

| 道                          | 選ばなかった理由                                             |
| --------------------------- | ------------------------------------------------------------ |
| `--force`（`-C`）で付け替え | 元の枝がどこにあったかを見失わせる（§14.21 の線）            |
| 先に削除して作り直す        | そこにしか無い commit を巻き添えにしうる（§14.22 の線）      |
| 既にあるブランチへ切り替え  | **押したのは「作る」であって「切り替える」ではない**（下記） |
| **git を動かさずに断る**    | これにした                                                   |

3つめを選ばないのがいちばん迷うところになる ── 利用者が本当に欲しいのはたいてい「その枝で作業を始めること」で、切り替えれば済むように見える。だがその「既にあるブランチ」が**同じ名前の別物**であることは普通に起こる（手元で作った `feature/x` と remote の `origin/feature/x` は無関係でありうる）── 黙って切り替えると、押した人は remote の内容が手元に来たと思ったまま、別の枝の上で作業を始める。

次の一手は「別の名前を打つ」で、それは**同じ欄の中にそのまま在る**（だから既定値を決め打ちにしていない）。分類は 3-8-13 / 3-8-14 と同じ `branch-exists` で、画面に出る文も同じになる ── 先に返そうと git に断られようと、利用者から見て起きたことは同じにあたる。

##### 確かめてから動かすまでの間

3つの git（ローカル名の確認・始点の確認・`switch --create`）は**同じ順番待ちの枠**の中で連続して走るので、このアプリの中では間に何も挟まらない（`gitQueue.ts`）。挟まりうるのは外（端末・別のツール）で、そのときは `switch --create` 自身が断る ── **確かめは git の断りを置き換えるものではなく、押した人に近い言葉で先に返すためのもの**になる。

##### 読めなかったときにどちらへ倒すか

2つの確認で**倒す先が逆**になる。基準はどちらも「間違えたときにどちらが取り返しがつくか」で、答えが裏返る。

| 確認                 | 読めなければ              | そのとき起きること                                        |
| -------------------- | ------------------------- | --------------------------------------------------------- |
| ローカル名が空きか   | `false`（空いている扱い） | git が走り、埋まっていれば git が `branch-exists` で断る  |
| 始点が remote の枝か | `true`（在る扱い）        | git が走り、解けなければ git が `branch-not-found` で断る |

どちらも「先に返す」が効かないだけで結末は変わらない。逆に倒すと、**実際には空いている名前で作れない / 実際には在るのに見つからないと言う**という嘘が出る。

#### `--track` を明示する（既定に任せない）

始点が remote-tracking branch のとき、git は既定で追跡先を設定する（`branch.autoSetupMerge` の既定が `true`）。それでも明示するのは、**その既定が利用者の設定で消えている PC がある**ため ── `false` にしてある環境では、押した人から見て「追跡先が付く操作」が黙って付けない操作になる。この口の意味は追跡先が付くことそのものなので、リポジトリの設定に委ねない。

逆に `--no-track` は**渡す欄そのものを作らない** ── 追跡しない作成は `git:create-branch` が既にその形で、真偽の欄を作るとこの口が2つの意味を持つ。

引数の並びは `switch --quiet --create <名前> --track --end-of-options <始点>` になる。`--end-of-options` が**名前の後ろ**なのは 3-8-13 の言い直しがそのまま効くためで、名前は位置引数ではなく `--create` 自身の引数にあたる（手前に挟むと名前が始点として読まれる）。

#### ネットワークへ出ない

一覧も作成も `fetch` を1回も動かさない。開く操作が外へ出ると、開くたびに認証を求められうるうえ、「見るだけ」のつもりの1回が数十秒かかる（3-8-16 で remote の追加に `--fetch` を渡さなかったのと同じ線）。

したがって出るのは**最後に fetch / pull した時点の写し**で、**そのことを面にそのまま書く**（「最後に取得した時点の一覧です」）── 黙ると、消された枝が残って見え、増えた枝は出てこないのを「アプリが壊れている」と読まれる。切れている一覧を黙って切らない（§14.14）のと同じ判断になる。

日時は書かない ── 最後の fetch の時刻を知るには `.git/FETCH_HEAD` を読むことになり、一覧を開くたびに読むもの（と、それを運ぶ欄）が1つ増える。「取得済みのもの」と言えば、次の一手は空のときの案内と同じになる。

#### 一覧が空のとき、言うことが2つに分かれる

`refs/remotes/` が空になる理由は2つあり、**次の一手がまったく違う。**

| 理由                    | 次の一手                                     |
| ----------------------- | -------------------------------------------- |
| remote が1つも無い      | 上のバーの「リモート」から登録する（§14.24） |
| remote はあるが未 fetch | Pull するか、Terminal で `git fetch`         |

git の出力からは見分けられない（どちらも 0 で終わって何も出さない）ため、Main が**同じ問い合わせの中で** `git remote` を読んで `hasRemote` として載せる。Renderer に `repository.hasRemote` と突き合わせさせないのは、その2つが**別の瞬間の写し**になりうるためになる（`GitLocalBranch.current` を同じ読み取りから出しているのと同じ判断）。

`git remote` の答えは、既定のローカル名を切るためにも使う ── 1回の読みが2つの答えを持つ。

#### 取り直す契機は §14.14 のまま

面が開いた瞬間だけで、`git:changed` には相乗りさせない（誰も見ていない一覧を数え直さない）。1回の「開いた」で**2本が並んで走る**（Main 側では順番待ちに入るので git は1本ずつ）── 順番に待たせないのは、片方が遅れるともう片方の行まで出てこないためになる。

通し番号は**ローカルの一覧と別に持つ**（`useGitRepository.ts`）── 同じ面から同時に2本走るので、1つの番号を共有すると後から始まった方が先の答えを捨てさせる。

通った後に一覧を取り直さないのは、**面が閉じる**ため（作った先へ切り替わる）── 3-8-14 の削除 / rename が取り直すのは、あちらが面を開いたままにするからになる。

#### UI（Renderer）

| 何を               | どこが決めるか                                                               |
| ------------------ | ---------------------------------------------------------------------------- |
| 一覧の代わりの一言 | `describeGitRemoteBranchList`（空のときの言い分けを含む）                    |
| 切れている断り     | `describeGitRemoteBranchTruncation`                                          |
| いつの写しか       | `describeGitRemoteBranchFreshness`（行があるときだけ）                       |
| 行を押せるか       | `toGitRemoteBranchSelectReadiness`                                           |
| 作れるか           | `toGitTrackingBranchCreateReadiness`（名前の文言は `gitBranches.ts` と共有） |
| 配置               | `GitBranchMenu.tsx`（3段目・畳んである）                                     |

名前の問題の文言は `describeGitBranchNameProblem`（3-8-6）を**そのまま使う** ── 同じ規則に2つの言い方を持たせない。空のときに理由を言う点だけが 3-8-6 / 3-8-13 と逆になる（あちらは既定値が無く、こちらは既定値が入っているため ── 空は「利用者が自分で消した」ことにあたる）。

行の下に開く欄は、ローカルの行の ✎ / ✕ と**同じ状態**（`opened`）が持つ ── 面の中で開くものが一度に1つであることを段をまたいで担保し、`Esc` の段を増やさない。

#### 実物に対して固定してあること

`gitRemoteBranchRepository.test.ts` で確かめたいのは、3-8-6 / 3-8-13 の「**失われないこと**」とは向きが違う ── **押した人が指したものだけが相手になること**になる。

- symbolic HEAD（`origin/HEAD`）が一覧に載らない
- ローカルブランチが一覧に混ざらない（3-8-6 の裏返し）
- **remote 名に `/` が入っていても、既定のローカル名が正しく切れる**
- remote が無い / 未 fetch を `hasRemote` で言い分けられる
- 上限で切り、切ったことを言う
- 作れたときは**追跡先が必ず付く**（`branch.autoSetupMerge` を見えなくしたうえで ── `--track` の効き目そのもの）
- ローカル名を打ち替えても、追う先は変わらない
- **同名があれば git を動かさずに断り、元のブランチも追跡先も HEAD も1つも動かない**
- **ローカルブランチ名を始点に渡しても作らない**（渡せば git は通してしまう）
- **`origin/HEAD` を始点に渡しても作らない**
- 書きかけが上書きされるときは断り、**ブランチも作られない**（`switch --create` が1回で行う）
- 切り替え先が触らないファイルの書きかけは、作っても残る

最後の2つは 3-8-6 / 3-8-13 から引き継いだ形になる ── 始点が別の commit になった以上、作成もまた作業ツリーを書き換える側に回るため。

### 14.28 ブランチのマージの開始 / 中止（Session 3-8-20）

3-8-18 が「口が無い」と書き残していた2つ ── **マージを始めること**と**やめること**を足した。3-8-18 は競合の**出口**（解決済みにする）を置いたが、そこへ至る入口はアプリの中に1つしか無かった ── 退避を戻したときの競合（3-8-15）で、それは「押した結果として入ってしまう」ものだった。Pull は `--ff-only` 固定で競合せず、切り替えは競合しそうなら git が断る。つまり**枝を分けて作業する人が最後に必ず行う「取り込む」が、Terminal パネルにしか無かった**ことになる。3-8-15 / 3-8-16 / 3-8-18 / 3-8-19 と同じ「自分が閉じた道の先を、後から用意する」形にあたる。

#### 引数を固定するのが、この回の中心

動かすのは1つだけ（main/git/gitCommands.ts の `mergeBranch`）。

```
git merge --quiet --no-edit --ff --no-autostash --end-of-options <ローカルブランチ名>
```

| 引数               | なぜ                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `--quiet`          | 進捗を出さない。結末は終了コードと出力の分類で決める（他の操作と同じ） |
| `--no-edit`        | **エディタを開かせない。** 開くと git が待ち続け、上限まで返ってこない |
| `--ff`             | PC ごとの `merge.ff` に振る舞いを左右させない（下記）                  |
| `--no-autostash`   | アプリが**見えない stash** を作らない（下記）                          |
| `--end-of-options` | `-x` で始まる名前をオプションとして読ませない（他の操作と同じ）        |

**`--ff` / `--no-autostash` はどちらも git の既定と同じ値だが、書かないと PC ごとの設定で変わる。**

- `merge.ff=false` … 早送りできる場面でも merge commit が積まれる
- `merge.ff=only` … 枝分かれしていると**断られる**
- `merge.autoStash=true` … 作業ツリーを**勝手に退避してから**マージし、途中で失敗すると**利用者が作った覚えのない退避**が 3-8-15 の一覧に並ぶ

同じボタンが PC ごとに違うことをするのは、Pull で `git pull` を使わないと決めた理由（`pull.rebase` 次第で merge にも rebase にもなる。§14.13）とまったく同じにあたる。3つとも実物で確かめてある（`gitMergeRepository.test.ts`）── `--ff` は `merge.ff` の両方の設定に勝ち、`--no-autostash` は退避を1つも増やさずに `local-changes-blocked` として断る。

早送りできる場合はそのまま早送りし、**不要な merge commit を作らない。** `--no-ff` を渡す欄は作っていない（履歴の形を決める判断で、リポジトリの流儀によって答えが違う）。`-X ours` / `-X theirs` も置かない ── あれは**競合を自動で潰す**もので、書いた人の中身が黙って消えうる。

#### `mergeUpstreamFastForwardOnly`（3-8-5）と別の関数にしてある

動かすのは同じ `git merge` だが、**引数が3つとも違う。**

|            | 3-8-5（Pull）                   | 3-8-20（マージ）                   |
| ---------- | ------------------------------- | ---------------------------------- |
| 相手       | `@{upstream}`（設定が指すもの） | 一覧から選ばれたローカルブランチ名 |
| 早送り     | `--ff-only`（できなければ断る） | `--ff`（できなければ作る）         |
| 起こること | 取り込めるか断られるか          | **競合する**                       |

1つの関数に引数で振らせると、**Pull の側にうっかり merge commit を作らせる道**が1つできる。この表は「何を実行するか」を数え上げる場所なので、数えられるものだけを置く（`listLocalBranches` と `listRemoteBranches` を分けてあるのと同じ判断）。

#### 相手はローカルブランチだけ ── 名前の「形」だけでは足りない

`git merge` は**タグも commit hash も remote-tracking ref もそのまま受け取る**（実物で確かめてある）。名前の形の検証（`normalizeGitBranchName`）だけで通すと、`git merge <タグ>` が「ブランチのマージ」を名乗ったまま動くことになる。

そこで動かす前に、3-8-14 の `listExactBranch`（`branch --list`）で **`refs/heads/` にその綴りちょうどのブランチが在るか**を確かめる ── `refs/tags/` も `refs/remotes/` も hash も空を返す。3-8-19 が「渡された名前が本当に `refs/remotes/` の下に在るか」を確かめたのと同じ形の、今度はローカル側になる。

**読めなかったときに倒す先が 3-8-19 とは逆になる。** あちらは true（在る）へ倒していた ── 倒した先で git が同じ分類を返すので結末が変わらなかったため。こちらは**倒した先で結末が変わる。**

- `false` へ倒す … 「見つかりません」と言い切る。実際には在るのにマージできない、という間違いが起こりうる（次の一手「一覧を開き直す」で直る）
- `true` へ倒す … `git merge <名前>` が走る。名前が tag や hash として解ければ**ブランチではないものが取り込まれる** ── merge commit ができてしまえば、戻す口はアプリに無い

「確かめられなかった一回だけ、押していないものが履歴に入る」を避ける、という判断は 3-8-18 の競合マーカーの確認とまったく同じ形にあたる。

#### 押す前に分かることは、git を動かす前に全部見る

§14.14 からの構えをいちばん厚く効かせている場所になる。マージは**作業ツリーと index を同時に書き換える**操作で、走り出してから断られると半端な状態が残りうる。

| 先に見るもの         | 分類                   | なぜ動かす前か                                                                        |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| ブランチの上に居ない | `not-on-branch`        | detached では取り込み先が無い（git は動くが、どこにも属さない merge commit ができる） |
| 既にマージ中         | `unresolved-conflicts` | MERGE_HEAD がある。先にすることが決まっている                                         |
| 競合が残っている     | `unresolved-conflicts` | `stash pop` の競合（3-8-15）でも起こる                                                |
| 相手が今のブランチ   | `nothing-to-do`        | 画面でもその行に口を出していない（二重の備え）                                        |
| 相手が実在しない     | `branch-not-found`     | tag / hash / remote-tracking を含む（上記）                                           |

#### 競合は `partly-applied` ── 「失敗」ではなく「途中」

`{ status: 'partly-applied', completed: 'merge', reason: 'merge-conflict' }` を返す（shared/git/operation.ts）。

**丸めてはいけない理由が、先の3つ（Commit & Push・公開・`stash pop`）より強い。** 失敗に丸めると利用者はもう一度マージを押すが、MERGE_HEAD は既に在るので git は `Merging is not possible because you have unmerged files` としか言わない ── **そこから先へ進む手立てが画面のどこにも見えなくなる。**

実際に起きていることは3つあり、そのどれも `failed` では言えない。

- 自動でマージできたファイルは index に載っている（ステージ済みへ並ぶ）
- できなかったファイルは競合のグループへ並ぶ（3-8-2 からの器）
- `MERGE_HEAD` が在る ＝ 中止の口が開く

4つめの `partly-applied` だが、**そこから先に利用者がやることがある**のはこれだけになる ── 先の3つは「押し直す」で進むが、これは競合を解決して Commit することで進む。

`Already up to date` は普通の成功として返す ── それだけを区別するために git を1回増やしたり、結果の型を足したりはしない（3-8-5 の Pull と同じ判断）。

#### その先は1手も足していない

3-8-18 が「前後がどちらも出来上がっていて、真ん中の1手だけが空いていた」と書いた形の、今度は**入口の側**が埋まったことになる。実物で通してある（`gitMergeRepository.test.ts`）。

```
マージ（3-8-20）→ 競合のグループ（3-8-2）→ 解決済みにする（3-8-18）→ Commit（3-8-4）→ 完結
```

Commit は 3-8-4 の引数のまま（`commit --quiet --cleanup=whitespace --file=-`）でマージ commit を作り、MERGE_HEAD を消す。

#### 分類の表を分けた ── 同じ文言が別の意味になるため

`classifyGitMergeBranchFailure` を `classifyGitMergeFailure`（3-8-5）と別にしてある。

| 文言                                    | 3-8-5（Pull） | 3-8-20（マージ）      |
| --------------------------------------- | ------------- | --------------------- |
| `refusing to merge unrelated histories` | `diverged`    | `unrelated-histories` |
| `not something we can merge`            | `diverged`    | `branch-not-found`    |

相手が違う（`@{upstream}` と、一覧から選んだブランチ）ので**次の一手も違う** ── 同じ分類へ落とすと、片方で必ず間違った案内が出る。

**読むのは stdout と stderr を繋いだもの。** マージの競合の報告は **stdout に出る**（`--quiet` を付けても残る。実物で確かめてある）── `CONFLICT (content): …` も `Automatic merge failed; …` も標準エラーではない。stderr だけを見る他の分類と同じ形にすると、**いちばん起こる結末が `unknown` に落ちる。** そのためこの1つだけ `toGitOperationOutcome`（gitOperationResult.ts）を通さず、`runMerge` が自分で翻訳する（共通の翻訳は結末を `applied` / `failed` の2つにしか畳めず、競合はそのどちらでもない）。

順番にも意味がある ── 競合をいちばん先（`index.lock` の次）に見るのは、それだけが `partly-applied` になるため。hook を無関係な履歴より先に見るのは、hook の出力が**任意の文章**だからになる（`refusing to merge unrelated histories` と書く hook が在りうる）。

`diverged` は `--ff` を明示している以上ふつうは出ないが、表には残してある ── 出たときの結論（取り込めなかった）と次の一手は Pull と同じになる。**Renderer 側の文言はそこで直した** ── 3-8-19 まで「手元と remote が枝分かれしている」と書いていたが、3-8-20 では相手が remote とは限らない。相手を名指しせず「枝分かれしている」とだけ言う形にしてある（`branch-not-found` を 3-8-14 で3つの操作に当たる形へ直したのと同じ判断）。

#### 中止 ── `merge --abort` は `reset --hard` ではない

```
git merge --abort
```

引数が1つも無い（`--quiet` は無い。渡すと断られる）── 何を中止するかは渡さない。途中のマージは常に高々1つで、それは `MERGE_HEAD` が指している。**渡せる欄が無いということは、境界を渡った値が混ざる余地がそもそも無い**ということにあたる。

`reset --hard` を使わないのは、あれが**指した1点まで作業ツリーごと巻き戻す**もので、マージを始める前から在った変更まで消えるため（3-8-9 で `reset --hard` を使わないと決めたのと同じ線）。実物で確かめてある戻り方は次のとおり。

| 中止したとき                   | どうなるか                                           |
| ------------------------------ | ---------------------------------------------------- |
| マージを始める前から在った変更 | **残る**（追跡済みの書きかけも、未追跡のファイルも） |
| 自動でマージできていた分       | マージ前へ戻る                                       |
| **競合の解決中に書いた内容**   | **消える**（stage したものも含む）                   |

最後の1つがあるため、押す前に確認を挟む。

**`merging` が偽なら git を1回も動かさない。** `git merge --abort` は MERGE_HEAD が無ければ `fatal: There is no merge to abort (MERGE_HEAD missing).` で終わるが、それは読んだ状態だけで先に分かる（§14.14 からの構え）── `nothing-to-do` として返す。

#### 「マージの途中か」は git に聞く（`GitRepositoryState.ready.merging`）

`rev-parse --verify --quiet MERGE_HEAD` を状態の読み取りに1本足した（main/git/gitRepository.ts）。在れば 0・無ければ 1 で終わり、commit が1つも無いリポジトリでも 1 になる ── 読むのは終了コードだけで、出力（hash）は捨てる。

**Renderer 側で推測しない。** 「競合しているファイルがあるか」からは導けない。

- 競合が無くてもマージ中 … 解決し終えた直後（Commit するまで MERGE_HEAD は残る）
- マージ中でなくても競合 … `stash pop` が作る競合（3-8-15）

前者を取り違えると「解決し終えた瞬間に中止の口が消える」ことになり、後者では**マージしていないのに `merge --abort` を出す**ことになる。

`.git/MERGE_HEAD` を `existsSync` で見に行かないのは、それが**`.git` の中の置き方をアプリが知っていることにする**ためになる（`.git` がファイル1つの worktree 形式・`GIT_DIR` が別の場所、のどちらでも外れる）── リポジトリの中身を読むのは常に git を通す、という 3-8-1 からの構えを崩さない。

`ready` の中に入れてあるのは `hasRemote`（3-8-10）と同じ**「見られている時間」**の基準による ── マージ中はその間ずっと画面を決めている。別の問い合わせに分けると変更ファイルの一覧と別の瞬間の写しになり、「競合の行は消えているのに帯だけ残っている」画面がありうる。

代償は状態を読むたびに git が1回増えること。**その1回は実 git のテストに効いた** ── vitest の既定（5 秒）は 100 本を超えるテストファイルを並べたときに元から余裕が無く、この1本で足りなくなった。実 git を起動するテストファイルにだけ明示の上限（30 秒）を掛けてある（docs/DEVELOPMENT.md §4）。

#### UI ── 新しい画面を作らない

| 場所                     | 何が付いたか                                                 |
| ------------------------ | ------------------------------------------------------------ |
| ブランチの面の行         | `⤵`（今のブランチへ取り込む）── 押すと**行の下に確認**が開く |
| Git パネルの上のバーの下 | **マージ中の帯**（`merging` が真のときだけ）と、その中の中止 |

**行の `⤵` は `✎` / `✕` の手前に置いた。** いちばん右（`✕` ＝ 消す）を動かさないため ── 一覧を縦に読む人が頼りにしているのは「右端は消す側」という並びで、そこに別のものを差し込むと 3-8-14 からの押し方が変わる。

**今のブランチの行には口を出さない**（薄くもしない）。削除（`✕`）は「押しても絶対に通らない」ので薄くして理由を添えたが、マージは違う ── 自分自身を取り込むのは**操作として意味を成さない**。薄いボタンを置くと「条件が揃えば押せるもの」に見える。ただし**場所は空けたまま残す**（行ごとにボタンの数が変わると `✎` / `✕` の位置が縦に揃わなくなる）。

**確認は行の下に開く**（3-8-13 / 3-8-14 と同じ形）── 別の面にしないのは Popover が外側の pointerdown で閉じるためで、`Esc` の段数も増えない（開いているものを畳む → 面を閉じる、の2段のまま）。開始の確認は**消えるものが無いのに挟む初めてのもの**になる ── 押す場所が切り替えの行の上（1文字ぶんの距離）にあり、誤って押すと履歴に merge commit が積まれる（その取り消しはアプリが持たない）。したがって `data-variant="danger"` は付けない。

**中止はブランチの面ではなく、パネルの帯に置いた。** マージ中に面を開くと、そこに並ぶのは**今は押せない行ばかり**で、出口がその奥にあることになる。専用のマージ画面も作っていない ── マージ中に利用者がすることは既にこのパネルに在るもの（競合の行を開いて直す → 解決済みにする → Commit）で、その上に別の画面を被せるといちばん見たい一覧が隠れる。帯が足すのは「なぜ今この状態なのか」の1行と、そこから出る道1つだけになる。

帯の置き場所は**失敗の1行より下**にしてある ── あちらは**押した1回の結末**、こちらは**今の状態**で、競合したマージでは2つが同時に出る。先に読むべきなのは「押した結果どうなったか」の方になる。色は識別色の橙を**左の細い線**としてだけ使い、新しい色は足していない。

#### 通ったら面を閉じ、通らなかったら開けたままにする

| 結末             | 面             | なぜ                                                                |
| ---------------- | -------------- | ------------------------------------------------------------------- |
| `applied`        | 閉じる         | 取り込みが済めば、その面でやることはもう無い                        |
| `partly-applied` | 閉じる         | 次にすること（競合の解決 → Commit）は面の中ではなくパネル本体にある |
| `failed`         | **開けたまま** | 理由を読む前に押した行が消えないようにする（3-8-14 と同じ）         |

### 14.29 競合の ours / theirs の差分（Session 3-8-21）

§14.18 が **「Session 3-8-21 の候補」**として名指しで残していた1つを埋めた。3-8-9 は競合を差分の対象から外し、その理由を「**『前』と『後』が2組（ours / theirs）あり、2つの中身を並べる形そのものが当てはまらない**」と書いていた ── 3-8-21 の答えは器を増やすことではなく、**組を1つに決めること**になる。

その間、競合の行にできたのは2つだけだった ── エディタで開くこと（3-8-2 から）と、解決済みにすること（3-8-18 から）。つまり利用者は**マーカーが混ざった1つの中身**しか見られず、「どちらが何を書いたのか」は端末で `git show :2:<path>` を叩くまで分からなかった。3-8-15 / 3-8-16 / 3-8-18 / 3-8-19 / 3-8-20 と同じ「自分が閉じた道の先を、後から用意する」形にあたる。

#### 見せるのは stage 2 と stage 3 の2つだけ

競合中の index には3段ある。

| 段      | 何か       | 3-8-21 で    |
| ------- | ---------- | ------------ |
| stage 1 | merge base | **出さない** |
| stage 2 | ours       | 左に出す     |
| stage 3 | theirs     | 右に出す     |

**base を出さないのは、器がそこで変わるため。** Monaco の Diff Editor が受け取るのは2つの中身で、3つを並べるには面も部品も別に要る。3-8-9 から在る2ペインの器をそのまま使える範囲に留めてあり、3-way は後続のセッションへ回した ── そのとき増えるのはこの応答の欄ではなく、**別のチャンネルと別の面**になる。

段を渡せる欄も作っていない。`stage` を数字で渡せる形にすると「段を指せる API」が1つでき、答えられない組み合わせ（存在しない段）を Main が毎回弾くことになる。

#### `git:get-file-diff` と混ぜていない

位置1つを渡して中身2つが返る、という形だけ見れば同じだが、**答えの意味が要求によって変わるチャンネル**を1本作ることになる。

|                | `git:get-file-diff`             | `git:get-conflict-diff`         |
| -------------- | ------------------------------- | ------------------------------- |
| 左右の意味     | 前 → 後（**時間の向きがある**） | ours / theirs（**向きは無い**） |
| 相手の決め方   | `group` が決める                | 常に stage 2 / stage 3          |
| 応答の型       | `GitFileDiff`                   | `GitConflictFileDiff`           |
| 要求に載るもの | 位置 + グループ                 | 位置だけ                        |

`GitDiffGroup` に `conflicted` を足す形も採らなかった ── 足すと `GitFileDiff.kind`（`GitChangeKind`）が競合の行でだけ意味を失い、左右のラベルを決める `describeGitDiffSides(group, kind)` が「この組み合わせのときは別の話」を1つ抱える。`git:stage` と `git:resolve-conflict` を分けたのと同じ判断になる（§14.26）。

#### 競合の「形」は、この応答だけが持つ

`UU` / `AA` / `UD` / `DU` / `DD` / `AU` / `UA` の区別（`GitConflictShape`）は、**`GitFileChange` にも `GitChangeKind` にも載せていない。**

理由は 3-8-9 が差分を `git:get-repository` に相乗りさせなかったのとまったく同じ**「見られている時間」**になる ── 一覧はパネルが開いている間ずっと出ているが、形が要るのは1行の競合差分を開いた一瞬だけにあたる。載せると、競合が1件でもある間は**`.git` が動くたびに全件ぶんの段を読む**ことになる（§14.15）。

判定は `git status` の `XY` を読み直すのではなく、**中身を取るのにどのみち通る `ls-files --stage` の出力**から決める（main/git/gitBlob.ts）── 段の組み合わせと `XY` は1対1に対応するので、形のために git を1回も増やしていない。

| 在る段  | 形                | `XY` | 左       | 右       |
| ------- | ----------------- | ---- | -------- | -------- |
| 1・2・3 | `both-modified`   | `UU` | あり     | あり     |
| 2・3    | `both-added`      | `AA` | あり     | あり     |
| 1・2    | `deleted-by-them` | `UD` | あり     | **無し** |
| 1・3    | `deleted-by-us`   | `DU` | **無し** | あり     |
| 1 だけ  | `both-deleted`    | `DD` | **無し** | **無し** |
| 2 だけ  | `added-by-us`     | `AU` | あり     | **無し** |
| 3 だけ  | `added-by-them`   | `UA` | **無し** | あり     |

段が1つも無ければ**形を推測せず** `not-found` を返す ── 推測すると「中身が両側とも空の競合」として面が開き、`DD` と見分けが付かなくなる。

#### 片側が無い競合でも、ボタンは出す

`DD` / `AU` / `UA` / `UD` / `DU` では、片側または両側に中身が無い。それでも一覧の行には差分ボタンを出し、**開いた先で「この側にはファイルが存在しません」と読める**ようにしてある。

出さない側に倒すと、**押しても何も起きないボタン**（あるいは行によって在ったり無かったりするボタン）が生まれる ── 一覧の行は「競合」としか言わないので、**形はそこには出ていない。** どちらに無いのかを知る場所が、この面のほかに無い。

両側とも無い（`DD`）ときだけ Diff Editor そのものを出さない ── 空の欄を2つ並べても読めるものが1つも無く、帯の下の2行が答えのすべてになる。

**どちらの側に中身が在るかは `shape` から一意に決まる**ので、応答に boolean を2つ載せていない ── 載せると `shape` と食い違う組み合わせが型の上で作れる（`GitFileDiff` が左右のラベルを載せていないのと同じ判断。§14.16）。

#### submodule は `unsupported-target`

mode `160000` の段は blob ではなく commit を指すため、`cat-file blob` は失敗する。失敗として出すより「差分の対象ではない」が近い ── 3-8-9 の `ls-tree` 側が `type` を `blob` に限っているのとまったく同じ線になる（`ls-files --stage` の出力に type は無いので、見分けが付くのは mode だけ）。

片側だけが submodule でも断る。残った側だけを並べると、**もう片方が「空のファイル」に見える。**

#### 出す中身は index の段で、作業ツリーではない

**3-8-21 でいちばん取り違えやすいところ**になる。競合中の作業ツリーのファイルには `<<<<<<<` の入った**混ざった中身**が入っていて、それを左右に出すと「解決作業の途中の姿」を2回見せることになる。読むのは常に index の段で、`readGitBlobSide`（§14.16）をそのまま通る ── 上限（Editor と同じ 2MB）・バイナリの判定（先頭の NUL）・改行の均し（LF）の3つが、**どの差分でも必ず同じ**になる。

バイナリの競合が `binary` として返るのはその結果で、**失敗ではなく分類**にあたる（3-8-9 の表をそのまま使い、競合のためだけの理由は1つも足していない）。

#### 読むだけ ── `checkout --ours` / `--theirs` はこの口の先にも無い

動かす git は `ls-files --stage` と `cat-file` だけで、**リポジトリは1バイトも動かない**（実物で測ってある。`gitConflictDiffRepository.test.ts`）。

ours / theirs を作業ツリーへ採る操作は置いていない ── あれは**利用者が書きかけた解決内容を上書きする**もので、3-8-18 が「取り消し」を置かないと決めた理由（`checkout --merge` が書いた内容を消す）とまったく同じ側にあたる。

#### UI ── 面も、押す場所も、絵も同じ

| 場所     | 何が付いたか                                       |
| -------- | -------------------------------------------------- |
| 競合の行 | 差分ボタン（**他のグループと同じ位置・同じ絵**）   |
| 差分の面 | 帯の下に2行（競合の形 / 片側にファイルが無いこと） |

**別のボタンを競合の行にだけ置かない。** 一覧を縦に読む人が頼りにしているのは「左から2つめは差分」という並びで、そこだけ違うものを置くと 3-8-9 からの押し方が変わる。面も 3-8-9 / 3-8-12 と同じものを使い、閉じ方（`×` と Esc）も重なり方も変えていない ── 3つめの入口が増えただけになる。

**面の中に「解決済みにする」は置かない。** この面は読み取り専用のまま保つ（§14.16 の「差分の中からの編集をしない」線）── 置くと**同じ操作の入口が2つ**になり、押せる条件（競合マーカーが残っていないか。§14.26）を2箇所で説明することになる。解決は一覧の行のまま、Commit は 3-8-4 のままになる。

#### 左右のラベルは、マージ中だけ意味を補う

ours / theirs が何を指すかは、**その競合がどうやってできたかで変わる。**

| いつ               | ours             | theirs            |
| ------------------ | ---------------- | ----------------- |
| マージ中           | 今居るブランチ   | 取り込む側        |
| rebase 中          | **積み直す土台** | **自分の commit** |
| cherry-pick 中     | 同上             | 同上              |
| `stash pop` の競合 | 自分の変更       | 自分の変更        |

アプリが真だと言い切れるのは1つめだけになる ── `merging` は `MERGE_HEAD` が在るかそのもので、Main が git に訊いた値にあたる（§14.28）。したがってそこでだけ補う。

```
merging === true   左: 現在のブランチ（ours / stage 2）   右: 取り込み側（theirs / stage 3）
merging !== true   左: ours（stage 2）                    右: theirs（stage 3）
```

**マージ中でなければ「自分の変更 / 相手の変更」と断定しない。** `stash pop` の競合（3-8-15。アプリ自身が作れる唯一の競合）では**両方とも自分の変更**で、枝の話ですらない ── そこで「相手の変更」と書くと、画面が積極的に嘘をつく（3-8-17 で `set-url` について書いたのと同じ形）。

**`REBASE_HEAD` / `CHERRY_PICK_HEAD` は読んでいない**（3-8-21 の範囲外）。読めば rebase / cherry-pick の意味づけも出せるが、それは状態の読み取りに ref を2つ足す話で、そこまで足しても「どれでもない競合」（`stash pop`）は残る ── 中立の表現がその受け皿になる。

**段の番号（stage 2 / stage 3）は隠さない。** git の記法を Renderer へ渡さない線（§14.8）に触れて見えるが、**ここでは段そのものが見せているものの正体**にあたる ── 訳語だけを出すと、端末で `git checkout --ours` を打つ人が、画面のどちらを見ていたのか照合できない。

`merging` は**面を開いた瞬間の値**を持ち回る（`GitDiffRequest`）── 開いている間に中止されても、ラベルの意味だけが入れ替わることは無い。

#### rename の競合3行は、束ねない

改名先が食い違うと、git は**1回のマージで3行**の競合を作る（実物で確かめてある）。

```
DD f.txt     ← 元の位置（両方で消えた）
UA x.txt     ← theirs が作った先
AU y.txt     ← ours が作った先
```

3行を1つに束ねて「改名の競合」として見せる UI は 3-8-21 の範囲外にしてある ── 束ねるには「どの3行が同じ1つの出来事か」を Main が決めることになり、それは `status` の出力からは読めない（git は3件として返す）。今できるのは**3行それぞれの差分を開くこと**で、そこに出る形（両方で消えた / 片方だけが作った）が手掛かりになる。

**この形は実物に教わった。** 最初は「片方が rename・片方が削除」で `DD` が出ると書いたが、git はそれを**改名先の `DU`** として置く（元の位置に競合は残らない）── どの操作がどの段を作るかは git が決めていて、こちらの推測ではない。両方とも `gitConflictDiffRepository.test.ts` に残してある。

### 14.30 仕上げ（Fetch・途中の Git 操作・マージの既定メッセージ。Session 3-8-22A）

3-8-1 〜 3-8-21 で Git の機能そのものはひととおり揃った。3-8-22A で足したのは**新しい領域ではなく、既にあるものを1本の流れとして使ったときに引っかかる4つ**になる ── 3-8-7 が「新しい機能を1つも足さず」通した回だったのと同じ性質で、違うのはそこで見つかった穴を**塞ぐところまで**行っている点にあたる。

塞いだのは次の4つ。

```
1. 取ってくる口が無い          → git:fetch（--prune）
2. 途中の Git 操作を見ていない → GitRepositoryState.inProgress と禁止の表
3. マージの Commit 欄が白紙    → git:get-merge-message
4. 押しても開けない行が1つ     → 競合の形（conflictShape）で開く条件を決める
```

#### 14.30.1 取ってくるだけの口（`git:fetch`）

`git fetch` は 3-8-5 から在ったが、走るのは **Pull の中だけ**だった（`fetch` → `merge --ff-only`）。そして Pull は追跡先が無ければ押せない（`no-upstream`。§14.13）── **追跡先の無いブランチに居るあいだ、`refs/remotes/` を新しくする手立てがアプリの中に1つも無かった。**

これがいちばん効くのは §14.27（3-8-19）になる。あちらの一覧は「`refs/remotes/` に**既に**在るもの」で、面にも「最後に取得した時点の写し」と書いてある ── 書いておきながら、取得する口だけが無かった。3-8-15 / 3-8-16 / 3-8-18 / 3-8-20 / 3-8-21 と同じ「自分が閉じた道の先を、後から用意する」形にあたる。

**Pull との違いは、取り込まないこと。** 動くのは `refs/remotes/` の ref だけで、HEAD も index も作業ツリーも1つも変わらない（実物で確かめてある。`gitFetchRepository.test.ts`）── だから追跡先が無くても・detached HEAD でも・remote が1つも無くても通る。早送りもしない ── 取ってきた結果が上のバーの `↓1` として出るところまでがこの口の仕事で、そこから先は Pull を押す。1つのボタンが「取ってくる」と「取り込む」を兼ねると、押した人から見て履歴が動いたのかどうかが分からなくなる（`git pull` を使わない §14.13 の判断と同じ線）。

**`--prune` は、この口にだけ付けた。** 引数が1つ違うだけだが押した人の予想が違うので、`gitCommands.ts` の表も2行に分けてある。

| 呼ぶ側                             | 引数                    | 用途                         | 消えるもの                         |
| ---------------------------------- | ----------------------- | ---------------------------- | ---------------------------------- |
| Pull の中（`fetchFromRemote`）     | `fetch --quiet`         | 取り込むために取ってくる     | 無し                               |
| Fetch（`fetchAndPruneFromRemote`） | `fetch --quiet --prune` | 一覧を今の remote に合わせる | 相手から消えた remote-tracking ref |

3-8-19 が `prune` を「置いていない」と書いたのは、**一覧を開く操作に消す働きを混ぜること**への否定で、押したときだけ消える形とは矛盾しない。消えるのは追跡の写しだけで、ローカルブランチも commit も1つも失われない（実物で確かめてある）。

`--all` は付けない ── 相手は今のブランチの remote のままになる（`fetchFromRemote` と同じ）。付けると 3-8-16 で足したすべての remote に対して `--prune` が走り、**押した人が名前を1つも見ていない相手の ref を消す**ことになる。remote を選べる欄を作らない線（§14.24 / §14.25）は、「全部」という選び方に対しても同じように引いてある。

置き場所は Push / Pull と同じ並びで、左から「Fetch → Pull → Push」になる（**手前の段ほど左**）。履歴 / 退避 / リモートの3つが上のバーに在るのは、あれが「面を開く」ものだからで、Fetch は面を開かずに git が動く ── Push / Pull と同じ性質のものは同じ場所に置く。

#### 14.30.2 途中の Git 操作（`inProgress`）

3-8-20 は `MERGE_HEAD` を読んで `merging: boolean` を返していた。3-8-22A でこれを4つの状態へ広げてある。

```ts
type GitInProgressOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'
readonly inProgress: GitInProgressOperation | null
```

**真偽値を4つ並べる形にしなかった。** 同時に2つ在ることは無い（git は途中の操作があるうちに別の操作を始めさせない）ので、4つの真偽値にすると「どれも false」と「2つ true」という**起こりえない組み合わせ**を受け手が扱えることになり、そのぶんの分岐がどこかに書かれる。

##### 読み方は3つが ref、1つだけフォルダ

| 状態        | 読むもの                                                      | 完了後 |
| ----------- | ------------------------------------------------------------- | ------ |
| merge       | `rev-parse --verify --quiet MERGE_HEAD`                       | 消える |
| cherry-pick | `rev-parse --verify --quiet CHERRY_PICK_HEAD`                 | 消える |
| revert      | `rev-parse --verify --quiet REVERT_HEAD`                      | 消える |
| rebase      | `rev-parse --git-path rebase-merge / rebase-apply` の**存在** | 片付く |

**rebase だけ読み方が違うのは、実物に教わった結果になる。** 最初は4つとも揃えて `REBASE_HEAD` で読もうとしたが、**その ref は rebase が完了しても消えない**（`--continue` で完了した後も残る。`--abort` では消える）── そのまま出していたら、**1度 rebase を完了した時点から Git パネルが永久に「rebase の途中です」になり、帯が出たまま書き込みが1つも通らなくなっていた。** git 自身が見ているのは作業場所のフォルダ（`rebase-merge` / `rebase-apply`）で、どちらも `--continue` でも `--abort` でも片付けられる。

置き場所は決め打ちしない ── `.git/rebase-merge` と書くと「`.git` の中の置き方をアプリが知っていること」になる（§14.28 の `verifyMergeHead` と同じ構え）。**git に聞いて、返ってきた場所が在るかだけを見る。** `--git-path` は無くてもパスを出して 0 で終わるので、在るかどうかを決めるのは読む側になる。返るのはリポジトリ root からの**相対パス**なので、起点を Workspace root にして解く（`ready` である以上その2つは同じ場所。§14.4）。

**見つかった時点で残りを尋ねない。** マージの途中なら git は1回で済む（3-8-20 と同じ回数）。何も途中でない場合だけ4回になり、そこが状態を読むたびの増分にあたる ── どれも ref かパスを1つ確かめるだけで、作業ツリーにもネットワークにも触らない。

##### 何を通さないかは shared の表が持つ

`shared/git/inProgress.ts` に置いてある。**Main と Renderer が同じものを読む**のが要点で、2箇所に書くと「画面では押せないのに IPC は通る」（あるいはその逆）が生まれる ── `shared/files/fileName.ts` を shared へ置いたのと同じ理由になる。正本は Main のままで、Renderer 側の判定は「できない操作を見せない」ためのもの・許可の根拠ではない（Files のドラッグ&ドロップと同じ線）。

| 操作                                   | merge        | rebase / cherry-pick / revert |
| -------------------------------------- | ------------ | ----------------------------- |
| Stage / Unstage / 解決 / 破棄          | 通す         | **通さない**                  |
| Commit / Commit & Push                 | 通す         | **通さない**                  |
| Push / Fetch                           | 通す         | **通さない**                  |
| ブランチの削除 / rename / 退避を捨てる | 通す         | **通さない**                  |
| 切り替え / 作成 / remote の枝から作る  | **通さない** | **通さない**                  |
| もう1度マージ / 退避する / 戻す / Pull | **通さない** | **通さない**                  |

**マージだけが「通す」列を持つ。** アプリの中に出口があるためで（競合を解決して Commit する）、そこを止めると利用者はマージから出られなくなる ── 中止しか道が無くなる。逆に rebase / cherry-pick / revert は**始める口も終わらせる口もアプリに無い**（`--continue` も `--abort` も持たない）ので、書き込みを1つも通さない ── 出口が無いのに Stage や Commit だけを通すと、**終わらない道の途中まで案内する**ことになる。とくに rebase では HEAD が detached になっており（実物で確かめてある）、そこで Commit を通すとどのブランチにも属さない commit が積まれる。

読み取り（状態の取得・差分・履歴・各種一覧）はどれも止めない ── 何が起きているのかを確かめる手立てまで奪わない。remote の登録簿の編集（`add` / `set-url` / `rename` / `remove`）も止めない ── 書き換えるのは `.git/config` の行だけで、index も作業ツリーも HEAD も動かない。

##### 「git が断るから任せてよい」は成り立たなかった

3-8-20 が切り替えや退避を止めなかったのは「競合が残っている間は git が断る」からだった。**その理由が成り立たない一瞬がある** ── 競合を全部解決して `git add` まで済ませた状態では index がきれいなので、

- **`git stash push` は通ってしまい、`MERGE_HEAD` が黙って消える**（実物で確かめてある）
- `git switch` は git が最後まで断る（`cannot switch branch while merging`）

**どちらを通すかは git が決めていて、アプリが寄りかかれる規則になっていない。** だから両方とも手前で断つ。git が断る側も表に入れてあるのは3つの理由による ── ①git の断り方は状態ごとにばらばらで `operation-in-progress` という1つの理由に集約されない（§14.6 の「生の stderr を渡さない」）、②押した先で必ず失敗するボタンが残る（3-8-2 からの「押しても何も起きない操作を置かない」）、③git の版が変われば変わりうる。

断りは `operation-in-progress` という新しい理由で返る（`shared/git/operation.ts`）。画面の側でも押せなくしてあるので、ここへ来るのは**押した瞬間に状態が変わっていた**場合になる（端末でマージや rebase が始まった直後）。

`unresolved-conflicts` とは**別の理由**として分けてある ── あちらは「競合が残っているので前提が成り立たない」で次の一手が**解決すること**、こちらは「解決し終えていても通さない」で次の一手が**その途中の操作を終わらせること**になる。競合はあるが途中の操作が無い形（`stash pop` の競合。§14.23）では `unresolved-conflicts` のままで、その道は残してある。

##### 帯は4つを言い分ける

3-8-20 の帯は1文だった。4つの状態を出し分けるようになり、**中止の口はマージにだけ**残っている ── `merge --abort` は rebase / cherry-pick / revert を中止しないので、置けば押しても何も終わらないボタンになる。代わりに帯の文が**行き先まで出す**（「Terminal パネルで `git rebase --continue` か `git rebase --abort`」）── §14.7 の `dubious-ownership` で直し方のコマンドを出しているのと同じ判断になる。

文言と「中止の口を出すか」を決めるのは `renderer/src/git/gitInProgress.ts`（React 非依存・テスト対象）で、`GitView.tsx` が持つのは置き場所だけになる。押せないボタンの理由も同じ関数から借りる ── 帯と違う言葉で同じ状態を呼ぶと、どちらかが古くなる。理由には**次の一手まで入れてある**（3-8-20 が `toGitBranchMergeReadiness` の中で「解決して Commit するか、中止する」と書いていたことの引き継ぎ）── 理由しか無いと、利用者は「待てば押せるようになる」と読む。

3-8-20 で1箇所だけ Esc を持っていなかった中止の確認にも、ここで足してある（破棄・初期化の確認・4つの面・ブランチの面の行の下は 3-8-9 以降ずっと持っていた）。

#### 14.30.3 マージ commit の既定メッセージ（`git:get-merge-message`）

3-8-20 でマージを始められるようになり、§14.26 の解決 → §14.12 の Commit でマージを完結できるようになった。ただしその Commit だけは**利用者が文章を打たないと押せない**（`toGitCommitReadiness` は空を通さない）── 端末の `git merge` なら `Merge branch 'feature'` が既定で入るところに、アプリでは白紙が出ていた。

**`--no-edit` で git に任せる形にしなかった。** Commit の引数を分岐させ、欄が空ならメッセージを渡さない形も取れるが、それは**押す前に読めなくなる** ── 入力欄には何も出ていないのに履歴には文章が入る。§14.12 が「メッセージは標準入力へ渡す」形にしたのは、画面に出ているものがそのまま commit になるためだった。したがって渡すのは既定値だけで、Commit の経路は1本のまま変わらない。

**置き場所は git に聞いて、返ってきた場所を読む。** `.git/MERGE_MSG` と決め打ちしないのは §14.28 と同じ理由で、違うのは**中身が要る**こと（終了コードだけでは済まない）── `rev-parse --git-path MERGE_MSG` で場所を聞き、そのパス（**相対で返る**）を Workspace root から解いて読む。git ドメインで `.git` の中のファイルを読むのはここだけで、**場所を組み立てていない**ことがその条件にあたる。

**コメント行は git に落とさせる。** `MERGE_MSG` には git が書いたコメント行が入る（競合したマージなら `# Conflicts:` とその一覧）。アプリの Commit は `--cleanup=whitespace` 固定で**コメントを落とさない**ので、そのまま渡すと履歴に入る。落とす規則を自分で書かないのは、コメントの印が `#` とは限らないため（`core.commentChar`）── `git stripspace --strip-comments` に通す。

呼ぶのは**マージの途中に入った1回だけ**で、`.git` の変化では呼び直さない（§14.20 の commit の詳細と同じ形）── 取り直すたびに、書き換えている最中の入力欄を上書きする理由が生まれる。入るのは**欄が空のときだけ**で、既に書き始めていれば何も起きない。マージが終われば捨てる（次のマージで前回の文章が既定値として出ないように）。

どの段で失敗しても null で、**失敗としては返さない** ── 既定値が無いだけで Commit そのものは今までどおり打てば通る。失敗にすると、何も損なわれていないのに直し方を探させることになる。

#### 14.30.4 競合の形（`conflictShape`）

3-8-2 は `git status` の `XY`（`UU` / `AA` / `DU` …）を**捨てていた**。理由は「どの形であっても利用者が次に取る行動は同じ（解決してから Stage する）」で、その前提が1つだけ崩れる ── **`both-deleted`（`DD`）は作業ツリーにファイルが無い。**

競合の行は「フォルダでも削除でもない」ので、3-8-2 からエディタで開くボタンが出ていた。`DD` ではそこだけ**押しても開けない**（Editor に「読めませんでした」のタブが増える）── 3-8-2 から書いてきた「押しても何も起きないボタンを置かない」という線が、この1つの形でだけ破れていた。

`XY` から形を読み取って `GitFileChange.conflictShape` に載せる（**git を1回も増やさない** ── 3-8-2 の時点でも読めていた値を捨てずに持ち帰るだけ）。Renderer へ渡るのは分類だけで、`XY` の2文字は境界を越えない。

7通りは実物で全部作って確かめてある ── rename / rename の競合1回で `DD` / `AU` / `UA` が同時に出る（`gitConflictRepository.test.ts`）。**作業ツリーにファイルが無いのは `DD` だけ**で、残り6つはどちらかの側の中身が在る（「片方が削除された」形でも開ける）。

**作業ツリーのモード（`mW`）からは読まない。** porcelain v2 の unmerged レコードには作業ツリー側のモードが載っているが、**ファイルが無くても `100644` が入る**（rename / delete の競合で確かめてある）── 「開けるか」の判断には使えない。

3-8-21 の `GitConflictFileDiff.shape` と**同じ型**を使う。あちらは index の段（`ls-files -u` の 1 / 2 / 3）から導き、こちらは `XY` から導く ── 出どころは違うが、どちらも「どの段が在るか」の言い換えで、git が同じ index から作っている（7通りすべてで一致することを確かめてある）。別の型を作ると、同じ競合が一覧と差分の面で違う名前で呼ばれる。

**差分の口は `DD` でも出したまま**にしてある ── 開いた先で「どちらにも無い」と読める方が、押せないボタンより手掛かりになる（3-8-21 の判断。§14.29）。開く先が違うので、押せる条件も別々に決まる。

### 14.31 production app での統合確認（Session 3-8-22B）

3-8-22A までで Git の実装は揃い、自動テスト（vitest 115 files / 2487 passed）と実 git テスト（`*Repository.test.ts` 18本 / 396 項目）も通っていた。3-8-22B で行ったのは**実装を増やすことではなく、それを production build のアプリで実際に押すこと**になる ── 3-8-7 が Git の基本機能に対して行ったことを、STEP 3 の Git 全体に対してもう一度行った回にあたる。

測ったのは4本のスクリプト・**232 項目、全項目 PASS**（内訳は [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) §4）。相手は使い捨ての一時リポジトリ一式で、走らせるたびに `setup-fixtures.sh` から作り直す（3-8-8 / 3-8-20 で踏んだのと同じ理由 ── 1回目が commit / push / merge を進めるので、2回目は「もう競合していない」でアプリのせいに見える FAIL が出る）。

#### 14.31.1 ここでしか出ない不具合が1つ出た（退避の面への被せ忘れ）

3-8-22A は「止めるものと通すものを表で1箇所に決める」ところまでは正しく作っていた ── `shared/git/inProgress.ts` の表は網羅的にテストされ、Main 側の `guardGitInProgress` は 18 の呼び出し口すべてに入っている（`stash-push` / `stash-pop` を含む）。

抜けていたのは**画面へ届ける最後の一手**だった。`GitView.tsx` は `guard()` を上のバー・ブランチの面・行の操作・Commit 欄へ被せて回っていたが、`GitStashOverlay` へ渡す props にだけ入っていなかった。結果として実アプリでは:

- マージの途中でも「戻す」（`stash pop`）が押せる
- 競合を全部解決して「解決済みにする」まで済ませた後は、「作業ツリーを退避」（`stash push`）も押せる ── **`shared/git/inProgress.ts` が「いちばん危うい」と名指ししていた状態そのもの**

押すと Main が `operation-in-progress` で断るため、**退避が消えることも `MERGE_HEAD` が落ちることも無い**（実アプリで押して確かめた ── `stash list` も `MERGE_HEAD` も変化せず、面の中に断りが出る）。つまり守りの本体は効いていて、破れていたのは「押しても必ず失敗するボタンを置かない」（3-8-2）の側だけになる。

3-8-22B では、他の箇所とまったく同じ形で被せた ── `pushReadiness` は `withGitInProgressBlock` で包み、行の2つには `popBlocked` / `dropBlocked` を渡して行の側で包む。3つを別々に引いているのは `GitView.tsx` の他の箇所と同じ理由で、表がそれぞれに答えを持つため（マージ中は push / pop が通らず、**drop は通る**）。

**この抜け方は、被せる形を選んだことの代償にあたる。** 3-8-22A は「引数を足して回る形だと、渡し忘れた1つが静かに素通りする」として被せる形を選び、「被せていない呼び出しは `GitView.tsx` の1箇所に並ぶので見て分かる」と書いた。だが**面へ props として渡す先はその並びから外れる** ── ブランチの面（`inProgress` を丸ごと渡す）と退避の面（渡していなかった）が該当し、前者は 3-8-22A で気づかれ、後者は気づかれなかった。型でも捕まらない（props が増えていないのだから、型は通る）。捕まえたのは**実アプリで押したこと**だけになる。

#### 14.31.2 Renderer の判定が許可の根拠でないことを、実物で確かめた

マージの途中で `window.fluvix.git` の6つを Renderer から直に叩き、すべて `{ status: 'failed', reason: 'operation-in-progress' }` で返ることを測った。

```
switchBranch / createBranch / createTrackingBranch / stashPush / pull / mergeBranch
```

叩いた後に HEAD も `MERGE_HEAD` も退避も1つも動いていないことを git 側から確かめてある。§14.30.2 が「Renderer 側の判定は『できない操作を見せない』ためのもので、許可の根拠ではない」と書いた構えが、実物でそのとおりになっている。

#### 14.31.3 測るときに踏んだこと（アプリの不具合ではないもの）

**Monaco の Diff Editor は、片側に `.view-lines` を2つ持つ。** 消えた行を描くための view-zone がもう1枚入るため、`.editor.modified .view-lines` を `querySelector`（＝最初の1つ）で読むと**消えた行の側（ours の断片）**が返る ── 「右に ours が出ている」ように見えて、左右を取り違えているという読み方をしかけた。その側の `.view-lines` を全部集めていちばん長いものを本体として読むと、左に ours・右に theirs が正しく出ている。3-8-21 が同じセレクタで正しく読めていたのは DOM の並びがたまたま逆だったためで、**アプリ側は 3-8-21 から一度も変わっていない。**

**一覧の面は開いた直後に読まない。** remote / 退避の一覧は非同期に取りに行くため、開いた直後は「取得しています…」で、そこで数えると 0 件になる（アプリは正しく出している）。「取得しています」を抜けるまで待ってから読む。

**ローカルのパスは remote の URL として登録できない。** §14.24 の「知らない形は通さない」がそのとおりに効くため、Push の相手にする bare リポジトリを**画面からは足せない** ── UI の「追加」が動くことは `https://` の URL で測り、Push の相手は git 側から `set-url` で差し替えて用意した。設計どおりの拒否で、不具合ではない。

#### 14.31.4 残っている未確認（環境に起因する1点）

「GitHub に公開」の**成功する経路**は、この PC に GitHub CLI（`gh`）が入っていないため実アプリで通せていない。3-8-10 と同じ状況で、当時も gh の無い側だけを確かめている（§14.17）。

確かめてあるのは、gh が無いときの断りと `winget` の案内が出ること・公開のボタンが押せないこと・remote を足すと公開の口ごと消えることの3つになる。**アプリの中の経路としては閉じており**、残るのは gh と GitHub に触れる1本だけにあたる。

---

## 15. Settings（アプリ全体の設定画面）

Session 4-3A で設定の**保存**は `settings.json` 1つ・section 分けに揃った（§12.4）。残っていたのは**並べる場所**だけで、Session 4-3B がそれにあたる。値の持ち主・保存の段取り・IPC は1つも変えていない ── この Session で増えたのは画面と、Auto Save の待ち時間を変える口だけになる。

### 15.1 器（ウィンドウ全体に重ねる面）

Dock 対象のパネルにはしない。理由は2つ。

- **設定はどのパネルのものでもない。** Editor / Files / Terminal の3つにまたがるので、どこかのパネルの中に置くと、そのパネルを閉じた人から設定が消える
- **レイアウトを占有しない。** 見ている間だけ前に出て、閉じれば作業していた配置がそのまま残る（Dock すると、開くたびに配置が動く）

Git の差分・履歴・退避と同じ「面」の形をとる（§14.16 / §14.19 / §14.23）。違うのは敷く範囲だけで、あちらはパネルの中（`position: absolute`）、こちらは窓いっぱい（`position: fixed`）── **アプリについての面**なので、上部バーもステータスバーも覆う。

|            | Git の面   | Settings の面                          |
| ---------- | ---------- | -------------------------------------- |
| 敷く範囲   | パネルの中 | ウィンドウ全体                         |
| 持ち主     | `GitView`  | `WorkspaceShell`（レイアウトの木の外） |
| 閉じ方     | `×` / Esc  | `×` / Esc                              |
| モーダルか | 非モーダル | 非モーダル（`aria-modal="false"`）     |

**開いているかどうかは `WorkspaceShell` が持つ。** レイアウトの木には現れないので `layout` から導出できず（パネルの表示 / 非表示が導出できるのとは別のもの ── §7.7）、入口が上部バー・出す先が Shell 全体なので、その2つを知っている場所が持つことになる。保存もしない ── 次の起動で Settings が開いたまま出ることに意味が無い（これは「今している操作」であって配置ではない）。

**閉じても値は失われない。** 変えた瞬間に既存の setter へ渡り、そこから `useSettingsSection` が保存する（§12.4）── 「編集して OK で確定する」形ではないので、閉じることで捨てられるものが1つも無い。

### 15.2 入口は上部バーの1つだけ

上部バーは「レイアウトそのものを操作するもの」の場所だが（§7.2）、Workspace を開く / 閉じるが既にここにあるとおり、**アプリ全体に関わる入口**もここが引き受けている。左から Workspace → View → Layout と扱う範囲が狭いものから並び、Settings はその並びに属さない（レイアウトを何も変えない）ので、「レイアウトを初期化」と同じく余白の向こう側に置く。

入口を増やさないのが要点で、Editor の工具列にも Terminal のタブ列にも「Settings を開く」ボタンは置いていない ── 設定を開く道が2通りあると、どちらから開いたかで違う画面が出るのではないかと疑う余地が生まれる。

### 15.3 目録と、値を持つ場所を分ける

```
settings/settingsCatalog.ts     何が、どのカテゴリに、どの順で並ぶか（React 非依存）
settings/SettingsOverlay.tsx    それをどう描き、どの setter へ繋ぐか
ui/NumberField.tsx              数を1つ受け取る欄（下書きを持ち、Enter / blur で確定）
```

目録を切り出してあるのは、**「画面に何が並ぶか」だけを試せるようにするため**にほかならない。このプロジェクトのテストは Electron にも React にも DOM にも依存しない層を主対象にしており（`vitest.config.ts`）、目録をここへ出しておけば「空のカテゴリが出ていないか」「載せないと決めたものが載っていないか」を画面を起動せずに確かめられる（`settingsCatalog.test.ts`）。

**中身の無いカテゴリを作らない。** `appearance`（Theme）・`general`・`git`・`workspace`・`language`（LSP）・`debug`（DAP）は目録に無く、テストがそれを見張っている（項目を1つも持たないカテゴリは足せない）。保存側で「中身が決まっていない section を先に作らない」としているのと同じ線にあたる。

### 15.4 並ぶ5項目と、既存 UI の行き先

保存されている設定は6つあるが、画面に並ぶのは5つになる。

| カテゴリ | 項目                   | 正本                  | 既存 UI                                         |
| -------- | ---------------------- | --------------------- | ----------------------------------------------- |
| Editor   | 自動保存の方式         | `useEditorSession`    | **無し**（4-3B で Editor の工具列から移した）   |
| Editor   | 自動保存までの待ち時間 | `useEditorSession`    | **無し**（4-3B で初めて操作できるようになった） |
| Files    | 表示方式               | `FilesViewProvider`   | Files のツールバー（**残す**）                  |
| Terminal | 文字の大きさ           | `useTerminalSettings` | Terminal のタブ列の ⚙（**残す**）               |
| Terminal | さかのぼれる行数       | `useTerminalSettings` | **無し**（4-3B で ⚙ から移した）                |

**残すか移すかを分けたのは「見ながら合わせるものか」による。** Files の表示方式と Terminal の文字の大きさは、対象を見ている最中に「こちらの方が読みやすい」と思って触るもので、そのたびに画面全体を覆う面を開くのは道具として遠い（Ctrl + `+` / `-` を置いてあるのと同じ理由）。逆に自動保存の方式・待ち時間・さかのぼれる行数は、変えても目の前が動かず、一度決めたら滅多に触らない。

**Files のカラムの幅（`files.columnWidth`）は画面に載せない。** 掴んで動かして決めるもので、動かしている最中に結果が見えることがこの値のすべてにほかならない ── 画面を覆う面の中に数字の欄として置くと、閉じてから確かめることになる。操作は `FileColumns.tsx` の直接操作のまま残し、**保存基盤の上では今までどおり `files` section の key として持ち続ける**（消しても schema も変えていない）。

### 15.5 二重に持たない

**この面は設定の値を1つも持たない。** state として持つのは「今どのカテゴリを見ているか」だけで、値はすべて既存の Context / hook から読み、既存の setter へ返す。

同じ値を指す state をここに作った瞬間に、「Settings で変えたのに Files パネルが変わらない」「ツールバーで変えたのに Settings が古い値を出す」が生まれる。**片方で変えればもう片方にもその場で出るのは、二重に持っていないからにほかならない。**

器が違えば表し方は変えてよい。Files の表示方式は、ツールバーでは2つのボタン（今出ている方をもう一度押すと `auto` へ戻る）だが、Settings では3つ並べる ── 設定画面に来た人は「今どれになっているか」を確かめに来ており、**押し方でしか表せない状態は見ただけでは分からない**。変換は `filesSettings.ts`（`toFilesViewChoice` / `fromFilesViewChoice`）が持ち、どちらの器も同じ `setPreference` を通る。

### 15.6 上下限は Renderer だけを信じない

Settings の数の欄が通す `clamp` は、**保存ファイルの読み込みと同じ関数**にほかならない。

| 項目                        | 範囲          | 掛ける関数                                               |
| --------------------------- | ------------- | -------------------------------------------------------- |
| 自動保存の待ち時間          | 200〜60000ms  | `normalizeAutoSaveSettings`（`editor/autoSave.ts`）      |
| Terminal の文字の大きさ     | 8〜32px       | `clampTerminalFontSize`（`terminal/terminalDisplay.ts`） |
| Terminal のさかのぼれる行数 | 500〜50000 行 | `clampTerminalScrollback`（同上）                        |

片方だけに掛けると「欄からは入らないのに、保存ファイルを直接書けば通る」という食い違いが生まれる。丸めた結果をそのまま欄へ書き戻すのも同じ理由で、効かなかった入力が欄に残らないようにするため。

Main 側は今までどおり「数として読めるか」までしか見ない（`store/settingsSections.ts`）── 二重に解釈すると「どちらの判断が正しいか」が生まれる（§12.4）。**Session 4-3B で IPC も検証も preload の口も1つも増えていない。**

### 15.7 数の欄を1つに集めた

Session 3-7-5 では、下書きを持って Enter / blur で確定する欄は Terminal の設定 UI の中に1つしか無かった。Settings 画面が3つ並べた時点で**同じ振る舞いの欄が4つ**になる（Terminal 側にも文字の大きさが残るため）ので、`ui/NumberField.tsx` へ切り出した。

写しにしなかったのは、この欄の要点が見た目ではなく**下書きを持つこと**にあるためで、そこは写すたびに落としうる ── 1文字ごとに反映すると、`1200` と打つ途中の `1` が範囲へ丸められ、**打ち終わる前に端末が作り替えられる**。Session 4-3A で読み書きの段取りを1箇所へ集めたのとまったく同じ判断にあたる（見た目は `ui/field.css` へ、`ui/menu.css` が `DropdownMenu` を引き受けたのと同じ経緯で移した）。

### 15.8 Session 4-3B の時点で入れていなかったもの

| 項目                 | 現状                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Theme / Appearance   | **Session 4-4 で入った**（§16）。予告どおり、増えたのは section 1つと目録の1行だけ                                              |
| Language / General   | **Session 4-5A で入った**（§17）。同じく section 1つと目録の1行だけ                                                             |
| Keyboard Shortcuts   | **Session 4-7C で入った**（§18.6）。**値を持たない最初のカテゴリ**で、section は増えていない                                    |
| Workspace ごとの設定 | 入れていない。プロジェクトフォルダの中には何も書かない方針のまま                                                                |
| LSP / DAP の設定     | 入れていない。**実行ファイルのパスを Renderer から保存して Main が実行する形は作らない** ── 安全設計ごと STEP 5 / STEP 6 で行う |
| 設定の検索           | 置いていない。**Keyboard Shortcuts の一覧だけは自前の絞り込みを持つ**（27件並ぶため。§18.6）                                    |
| 既定へ戻す           | 置いていない。項目ごとに範囲と既定が説明文に出ている                                                                            |
| `settings:changed`   | 要らない（単一 Renderer が Context で同期している。§12.4）                                                                      |

**カテゴリは6つになった**（General / Appearance / Editor / Files / Terminal / Keyboard Shortcuts）。値の項目は7つで、並び順の正本は今も `SETTINGS_SECTION_IDS` にある（§18.6）。

---

## 16. Theme（アプリ全体の見た目）

Session 4-3B までの見た目は Dark 固定だった。色そのものは最初から `styles/theme.css` の1箇所に集めてあり（DESIGN.md §3）、この Session で塞いだのは**その1箇所が本当は1箇所ではなかった**ところにほかならない ── Monaco と xterm は CSS 変数を読まないため、同じ 16進数が `monacoSetup.ts` と `xtermSetup.ts` にも書き写されていた。どちらのファイルにも「theme.css と同じ値を書き写しているので、片方を変えるときは両方を直すこと」という注意書きが付いていて、**その注意書きが要ること自体が写しの証拠**だった。Theme が2つになれば写しは倍になる。

v1 は **Dark / Light の2つだけ**。System（OS 追従）は入れていない（§16.8）。

### 16.1 色の実体は1箇所、名前は shared

| 層       | Theme について知っていること                                     | 場所                          |
| -------- | ---------------------------------------------------------------- | ----------------------------- |
| shared   | 名前が2つあること・既定・読めない値の落とし先・**初期描画の1色** | `shared/theme/theme.ts`       |
| Main     | それを読んで窓の初期色を決め、Preload へ渡す                     | `main/windows/mainWindow.ts`  |
| Preload  | 最初の描画より前に `<html>` へ当てる                             | `preload/theme.ts`            |
| Renderer | **色そのもの**と、値の持ち主・変える口                           | `styles/theme.css` / `theme/` |

**色は `theme.css` にしかない。** 例外は `THEME_WINDOW_BACKGROUND` の2色だけで、これは **CSS が1行も評価されていない時点で要る値**（`BrowserWindow` の `backgroundColor`）にほかならない。写しである以上ずれうるので、`--fx-color-app-bg` と一致することはテストが見張る（`styles/themeCss.test.ts`）。

Theme の名前を shared へ置いたのは、**最初の1枚を描くのが Renderer ではない**ため。Main が「保存されているのは Light だ」と知らないと、Light を選んでいる人の起動が必ず一度 Dark を通る（§16.5）。

**Theme 状態の持ち主は Renderer のまま。** Main は同じ `settings.json` を読むだけで、書かないし、変わったことも知らない ── 正本はディスク上の1つの値と、それを載せている `useAppearance` にほかならない。

### 16.2 Dark は素の `:root`、Light は上書き

```css
:root {
  /* Dark（色36・そのうち幕1と影4） */
}
:root[data-fx-theme='light'] {
  /* Light（同じ集合を上書き） */
}
```

この置き方には2つの意味がある。

- **知らない Theme 名は自動的に Dark になる。** `data-fx-theme="solarized"` が付いていても一致する規則が無いので `:root` のまま ── 落とし先を JavaScript 側だけに頼らずに済む
- **属性が付く前の一瞬も Dark。** 属性を当てるのは Preload だが、仮にそれが動かなくても、出るのは既定の見た目であって無色の画面ではない

**Light は色をすべて設計し直したもので、Dark を薄めたものではない**（明度を反転しただけの色は白い面の上で軒並み読めなくなる）。Dark の見え方は Session 4-3B までと1つも変えていない。

上書きするのは**色だけ**。間隔・文字サイズ・タブの高さは Theme に依らない（Theme は見た目の話であって、道具の寸法の話ではない）。

| 種別         | 数  | Light での考え方                                                          |
| ------------ | --- | ------------------------------------------------------------------------- |
| 面           | 5   | 手前ほど白へ寄る。hover だけは地より暗くする（白い面では明るく＝無変化）  |
| 枠           | 2   | Dark の「地より明るい線」が、Light では「地より暗い線」になる             |
| 文字         | 5   | faint（行番号・補足）が勝負どころ。白に対して 3:1 を超える値にする        |
| パネル識別色 | 4   | 明度を落として彩度を上げる。使い方（細い線だけ）は変えない                |
| ファイル種別 | 13  | 地より暗く、本文の文字よりは薄い。形が同じ組（ts / js）は色をはっきり離す |
| Git 変更種別 | 6   | 記号1文字にしか付かないので、ファイル種別よりさらに濃く                   |
| 幕と影       | 5   | 下記                                                                      |

#### 幕と影を変数へ出した

Session 4-3B までは `rgb(0 0 0 / 45%)` が `files.css` / `git.css` / `unsaved.css` に直接書かれていた（幕が3箇所、影が4種類）。**Light ではそのまま使えない** ── 黒い面の上で 45% の黒はうっすら濃くなるだけだが、白い面の上では奥が見えない黒い板になる。Theme ごとの値にするために `--fx-color-scrim` と `--fx-shadow-*`（前に出ている度合いで4段）へ出した。

| Theme | 幕  | 影の不透明度 |
| ----- | --- | ------------ |
| Dark  | 45% | 45〜50%      |
| Light | 25% | 12〜20%      |

### 16.3 Monaco と xterm は theme.css から**生成する**

```
styles/theme.css        色の実体（Dark / Light）
   ↓ getComputedStyle
theme/themeTokens.ts    読んで、道具ごとの形へ組み立てる
   ↓                         ↓
monacoSetup.ts          xtermSetup.ts
```

`themeTokens.ts` だけが DOM に触れ、その先（`toMonacoThemeColors` / `toTerminalThemeColors`）は素の値の変換にしかならない ── だから表を1つ渡すだけで試せる（`themeTokens.test.ts`）。**Theme を1つ足すときに触るのは `theme.css` と `shared/theme/theme.ts` だけで、Monaco と xterm は何も知らないまま付いてくる。**

読めなかった変数は代替値へ落とす。そのまま渡すと Monaco はテーマの定義ごと失敗し、**1つの綴り間違いでエディタが既定の見た目へ戻る**。落ちないことと引き換えに気づけなくなるので、必要な変数が両 Theme に揃っていることはテストが見張る（`styles/themeCss.test.ts`）。

**ANSI の16色は渡さない。** シェルとその中の CLI が使う色であって、このアプリが決めるものではない（`git status` の緑や npm の警告の黄色が、他のターミナルで見たときと違う色になる）。Theme を変えて xterm 側で変わるのは地・文字・カーソル・選択の4つだけ。

Monaco のテーマ id は Theme ごとに分けない（`defineTheme` は同じ id なら差し替えになる）。分けると切り替えのたびに使われない定義が積み上がる。継承元（`vs` / `vs-dark`）だけは Theme によって変わる ── これは色ではなく Monaco の語彙なので `theme.css` には置けず、対応を `themeTokens.ts` が持つ。

### 16.4 切り替えは、値が1つ変わった結果として起きる

```
Settings の Theme を押す
   ↓
useAppearance（正本。appearance section を読み書きする）
   ↓
ThemeProvider が <html> へ data-fx-theme を当てる
   ↓                        ↓                          ↓
CSS（全部の面が即座に）  MonacoEditor の effect     useTerminalTabs の effect
                         applyMonacoTheme()         screens.applyTheme()
```

**Theme の側は道具の一覧を持たない。** Monaco も xterm も「Theme が変わった」と知らされるのではなく、`useTheme()` の値が変わったことを自分の effect で見て当て直す ── 持たせると、道具が増えるたびに Theme 側を直すことになる。

xterm への当て直しは**開いている全部の画面**へ配る（`terminalScreenStore.applyTheme`）。手前に出ていないタブも含む ── 切り替えてから別のタブへ移ったときに、そのタブだけ前の色のまま、とはならない。

#### 当てるのが effect ではない理由

React の effect は**子から先に**走る。`data-fx-theme` の代入を `ThemeProvider` の effect に置くと、

```
ThemeProvider の effect     … light にする        ← 後
  MonacoEditor の effect    … CSS 変数を読む      ← 先（まだ dark を読む）
  useTerminalTabs の effect … 同上                ← 先
```

となり、Monaco と xterm が**1つ前の Theme の色**を読む（`useLayoutEffect` でも順序は同じ）。そこで**描画の中で当てる。** 代入は冪等で、当たった時点で `getComputedStyle` は新しい値を返すため、この後に走る子の effect はどれも正しい色を読む。`<html>` の属性は React が管理していない場所なので、React の再描画と競合しない。

同じ理由で、**新しく作られる xterm の画面は自分で `<html>` から読む**（`xtermSetup.ts`）。器が現れるのは Provider の effect より先でありうるため、ストアが覚えた値を渡す形にすると、そのとき作られた画面だけ前の色になる。

### 16.5 起動時にちらつかせない

Light を選んでいる状態での起動は、素直に作ると**必ず一度 Dark を通る。** 経路が3つあり、どれも塞ぐ必要がある。

```
窓が出る（backgroundColor）    ← ① Main が保存済み Theme から決める
HTML の解析が始まる            ← ② Preload が data-fx-theme を当てる
CSS が評価される               最初から Light。Dark が出る隙が無い
React が動き出す               ← ③ 初期値を <html> から読む
settings:load が返る           同じ値に落ち着く（何も動かない）
```

| #   | 塞がないと何が出るか                                     | 塞ぎ方                                        |
| --- | -------------------------------------------------------- | --------------------------------------------- |
| ①   | Renderer が動く前の窓が黒い                              | `backgroundColor` を保存済み Theme から決める |
| ②   | CSS が最初に評価される時点で Dark                        | Preload が `<html>` へ当てる                  |
| ③   | React の最初の描画が Dark で塗り直す（読み込み後に戻る） | `useAppearance` の初期値を `<html>` から読む  |

**なぜ Preload なのか。** `<html>` に属性が付いた状態で CSS を評価させるには、HTML の解析より前に動く必要がある。Renderer の入口（`main.tsx`）は解析の後で間に合わず、`index.html` へ直接書く手も使えない ── インラインの `<script>` は CSP（`script-src 'self'`）が止める。**CSP を1文字も緩めない**（§5）まま解ける場所は Preload しか無い。

Preload が走る時点では `<html>` がまだ無い（解析はこの後）。`DOMContentLoaded` は解析が**終わった**ときで、途中で最初の描画が起きうる。`MutationObserver` で `document` の直下を見張れば、`<html>` が作られたその場で当てられる ── 中身が1つも解析されていない時点なので、属性の無い状態で描画されることが無い。

**Theme は `webPreferences.additionalArguments` で渡す。** IPC ではないのは、IPC が Renderer の動き出しを待つものであり、避けたいのがまさに「動き出すまで」の一瞬だから ── Session 4-3A の2本（`settings:load` / `settings:save-section`）はそのままで、**チャンネルは1本も増えていない。** Preload が `contextBridge` へ足すものも1つも無い。

③ は「二重の正本」ではない。あの属性は Main が同じ `settings.json` から読んで先に届けた値そのもので、読み込みが返れば同じ値に落ち着く。**属性が無い / 知らない値なら Dark**（`readDocumentTheme` が落とす）── Preload が動かなかった場合も、他の3つの設定と同じ「読めなければ既定」に戻るだけで済む。

### 16.6 保存は既存の基盤にそのまま乗る

Session 4-3A が予告していた形（「増えるのはファイルでもチャンネルでもなく section か key」）の**最初の実例**にあたる。

| 増えたもの                                            | 増えていないもの            |
| ----------------------------------------------------- | --------------------------- |
| `appearance` section（`shared/settings/sections.ts`） | IPC チャンネル（2本のまま） |
| `theme` key（`main/store/settingsSections.ts` の表）  | Preload が公開する API      |
| Settings の目録の1行                                  | Main の検証の仕組み         |
| —                                                     | CSP                         |

**Main は `theme` が文字列であることしか見ない。** `dark` / `light` のどちらかであるかを決めるのは Renderer で、アプリをダウングレードすれば知らない Theme 名が保存されている状態は普通に起こりうる（§12.4 の分担そのまま）。Main が Theme の名前を知っている場所は1つだけあるが（窓の初期色）、それは**検証ではなく描画の都合**で、読めない値でも既定の色を塗るだけで済む。

`appearance` は**旧ファイル（`<用途>-settings.json`）を持たない最初の section**でもある。旧ファイルの集合は Session 3-5 〜 3-7-5 の3つで確定していて後から増えないので、`SettingsSectionId` の部分集合として切ってある（`main/store/legacySettings.ts` の `LegacySettingsSectionId`）── 同じ集合のままにすると、section を足すたびに**存在しない旧ファイルの名前を決めさせられる。**

Settings 画面では **Appearance を末尾に置く**。前の3つ（Editor / Files / Terminal）が「その機能の見え方・振る舞い」であるのに対し、Appearance は**アプリ全体の見た目**にあたる ── 機能の並びの途中に挟むと、どの機能の話をしているのか分からない場所ができる。保存ファイルの section の並びとも揃えてある。

選択肢は `select` ではなく2つ並べたボタンにした（Files の表示方式と同じ形）。**今どちらになっているかが開いた瞬間に見える**ことが要点で、選択肢が2つしかないので並べても場所を取らない。「適用」も「OK」も無い ── Theme は結果を見て決めるもので、確定するまで見えないと選べない。

### 16.7 CSS そのものをテストする

`theme.css` は Session 4-4 から**見た目ではなく契約**を持つ。写しを無くした代わりに、変数の名前1つで Monaco と xterm が繋がっている ── 名前を変えたのに片方だけ直した、Light に1色だけ足し忘れた、という間違いは型検査にもリンタにも掛からず、画面を開くまで分からない。

`styles/themeCss.test.ts` が見張るのはその繋ぎ目だけ。

- Dark と Light が**同じ変数の集合**を持つか（色40）
- Light が Dark の値をそのまま写している色が無いか（幕と影を含む）
- Monaco / xterm が読む変数（`THEME_TOKEN_NAMES`）が両方にあるか
- 窓の初期色が `--fx-color-app-bg` と一致するか
- `monacoSetup.ts` / `xtermSetup.ts` に 16進数が**戻ってきていない**か

「その色が見やすいか」は見張らない ── それは実機で見るしかない（docs/DEVELOPMENT.md §4 が Light のコントラスト比を測っている）。

読むのに `fs` を使わず Vite の `?raw` を通しているのは、**Renderer 側の型検査に Node の型を持ち込まないため**にほかならない（`tsconfig.web.json` に `types: ["node"]` を足すと、Renderer のコードが `fs` や `process` を書いても型検査を通るようになり、「Renderer から OS へ触らせない」という前提が型の上では守られなくなる）。Vitest は既定で CSS の import を空文字へ差し替えるので、`theme.css` だけを例外にしてある（`vitest.config.ts`）。

### 16.8 今回入れていないもの

| 項目                      | 現状                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| System（OS 追従）         | 入れていない。**Theme の名前ではなく選び方**なので `THEME_IDS` には入らない ── 足すなら「何を選んでいるか」を持つ側に足す                                                            |
| Theme 切り替えの打鍵      | 入れていない。**ショートカット基盤は Session 4-7 で入ったが（§18）、Theme の切り替えには割り当てていない** ── Dark / Light の2つしか無く、切り替えは Settings の Appearance から行う |
| Accent Color              | 入れていない。パネル識別色（DESIGN.md §3）は設計の一部で、選ばせるものにしていない                                                                                                   |
| フォント / UI 密度 / Zoom | 入れていない。Terminal の文字の大きさだけが既にある（§13.4）                                                                                                                         |
| 構文ハイライトの配色      | 入れていない。Monaco の標準テーマ（`vs` / `vs-dark`）を継承したまま（§11.1）                                                                                                         |
| 高コントラストの Theme    | 入れていない。Light の27色は面に対して 3:1 以上（本文は 7:1 以上）を実機で確かめてある                                                                                               |
| `settings:changed`        | 要らない（単一 Renderer が Context で同期している。§12.4）                                                                                                                           |

---

## 17. Localization（画面の文言）

Session 4-5A で入れた仕組みで、4-5B が Files / Editor / Terminal を、4-5C が Git を移し終えている。**日本語（既定）と英語の2つ**で、画面に出る文言はすべてここを通る。

Theme（§16）と同じ形を意識して作ってある ── 「アプリ全体に1つだけある値」「押した瞬間に全所へ届く」「起動時にちらつかせない」「保存は既存の基盤にそのまま乗る」の4つが共通する。違うのは、Theme が色という**値**を配るのに対し、こちらは文言という**表**を配る点にある。

### 17.1 Language は shared、文言は Renderer

```
shared/language/language.ts     名前（'ja' / 'en'）・既定・落とし先・起動引数の受け渡し
renderer/src/i18n/locales/      文言そのもの（ja / en の2つ）
```

**名前だけを shared に置いてある。** Main は保存された値を読んで `additionalArguments` に載せる必要があり（§17.6）、Preload はそれを `<html>` へ当てる ── 3層とも「`'ja'` か `'en'` か」は知る必要がある。逆に**文言は1文字も shared に無い** ── 画面に出す言葉は Renderer だけの関心で、Main が文言を持てば「Main が UI の都合を持ち込む」ことになる（§1 の表）。

Theme の `shared/theme/theme.ts` とまったく同じ切り分けにあたる（あちらも名前だけが shared で、色は `renderer/src/styles/theme.css`）。

`normalizeLanguageId` は**知らない値を既定（`ja`）へ落とす**。ダウングレードすればこの版が知らない Language 名が保存されている状態は普通に起こりうるので、読む側が必ず通す。

### 17.2 英語の辞書が、キーの正本

型は `locales/en.ts` から導いてある。

```ts
export type TranslationMessages = WidenMessageLeaves<typeof enMessages>
export type TranslationKey = DotPath<typeof enMessages> // 'settings.title' | 'git.panel.…' | …
```

`TranslationKey` が**実際に存在するキーだけの union**になるので、綴りを間違えた `t('setting.title')` は型エラーになる。翻訳キーを値として持つ場所（`api/result.ts` の対応表・`panelLabels.ts`・`presetLabels.ts`・`commandCategoryLabels.ts`・`settingsCatalog.ts`・`commands/registry.ts`）も同じ型を使うため、**キーを消すと、それを指していた場所が全部型エラーになる。**

日本語辞書の側は「同じ形であること」を型では強制していない（`TranslationMessages` は葉を `string` に広げた形なので、キーが欠けても構造としては通りうる）。そこは実数で見張る ── `i18n/messages.test.ts` が両辞書を平らにして**キーの集合が完全に一致すること**を確かめており、片方だけに足すと落ちる。

型で全部やらないのは、辞書を1つ書き足すたびに「型を通すためのダミーの日本語」を置く形にしたくないため。**落ちてから足す方が、空文字が残るより安全**にあたる。

### 17.3 `t` は必ず引数で受け取る

文言を組み立てる関数（`gitChanges.ts`・`filesError.ts`・`lossMessage.ts` など、React にも DOM にも依存しない層）は、**`t` を必須の引数として受け取る**。モジュールの内側で既定の言語の翻訳器を作ることはしない。

```ts
export function describeChange(change: GitChange, t: TFunction): string
```

内側に既定を持つと、`t` の渡し忘れが**「English の画面でも日本語が出る」という、画面にしか現れない不具合**になる。必須引数なら型が教えてくれる。

`t` そのものは辞書を引いて `{name}` を差し替えるだけの関数で、複数形も日付の書式も持たない（`messages.ts`）。**引けなかったキーは日本語辞書へ、そこにも無ければキー文字列をそのまま返す** ── 画面が空白になるより、`git.panel.title` と出た方が原因に辿り着ける。

### 17.4 エラーコードは文言ではなく翻訳キーへ対応させる

`api/result.ts` は Main から来た `IpcErrorCode` を画面の文言に変えるが、持っているのは**文言ではなく翻訳キーの対応表**になる。

```
IpcErrorCode → TranslationKey →（呼び出し側が持っている t）→ 文言
```

Main が返す `message` は開発者向けなので UI には出さない、という Session 1-3 からの分担は変えていない。変わったのは「表示文言を決めるのは Renderer」の**決め方**だけで、対応表が文言を直接持つのをやめた。

### 17.5 値は1つ、保存は既存の基盤にそのまま乗る

`LanguageProvider` が正本で、`useSettingsSection` を通して `general` section の `language` key を読み書きする（§12.4）。**増えたのは section 1つと key 1つだけで、IPC も Preload の口も Main の検証の仕組みも1行も変わっていない** ── Session 4-4 の `appearance` とまったく同じ入り方にあたる。

`general` は「アプリ全体の基本設定」で、`SETTINGS_SECTION_IDS` の**先頭**に置いてある。Appearance を末尾に置いたのと対になる判断で、機能ごとの設定（Editor / Files / Terminal）の前が「アプリ全体の話」の場所になる。

配る値は `{ language, setLanguage, t }` の3つだけ。**文言を持つ component は1つも無い**（Theme の面が色を1つも持たないのと同じ）。

### 17.6 起動時に日本語がちらつかない

Theme と同じ考え方で塞いである（§16.5）。使っているのも同じ仕組みで、**新しいチャンネルは1本も要らなかった。**

| 経路                       | 塞ぎ方                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| CSS が最初に評価される時点 | Preload が `<html>` へ `data-fx-language` / `lang` を当てる          |
| React の最初の描画         | 読み込みが返るまでの値を、その属性から読む（`readDocumentLanguage`） |

Main は `settings.json` の `general.language` を読んで `toLanguageArgument()` で `--fx-initial-language=en` を作り、`additionalArguments` に **Theme のものと並べて**渡す（`windows/mainWindow.ts`）。Preload はそれを `process.argv` から拾って当てる（`preload/language.ts`）。

**IPC を使わないのは、IPC が Renderer の動き出しを待つものだから**にほかならない ── 避けたいのがまさに「動き出すまで」の一瞬になる。`index.html` にインラインの `<script>` を書けば同じことができるが、それは `script-src 'self'` を捨てることを意味する（§17.8 / §6）。

Theme と違い、**窓の初期色にあたるものは無い**（言語は色を持たない）ので、塞ぐ経路は Theme の3つに対して2つになる。この2つが効いていることは Session 4-8A で `dom-ready` の時点の `<html>` を読んで確かめてある（DEVELOPMENT.md §4）。

### 17.7 言語名は、その言語自身で書く

`language.ja` は**英語の辞書でも `日本語`** と書いてある。英語の画面で `Japanese` と出す形にはしていない ── 選ぶ人は「自分が読める方」を探しており、読めない言語で書かれた名前は選べない（VS Code や OS の言語設定と同じ作法）。

英語の画面を走査すると、この1件だけは日本語として残る。**残っていて正しいもの**として、Session 4-8A の検証では明示的に除外してある（DEVELOPMENT.md §4）。

### 17.8 Session 4-5 で入れていないもの

| 項目                       | 現状                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 3つめ以降の言語            | 入れていない。足すのは `LANGUAGE_IDS` に名前を1つと `locales/` に辞書1つで、他は変わらない                   |
| System（OS の言語に追従）  | 入れていない。Theme の System と同じで、**Language の名前ではなく選び方**にあたる（§16.8）                   |
| 複数形・性・語順の切り替え | 持たない。`t` は辞書を引いて `{name}` を差し替えるだけ（§17.3）                                              |
| 日付 / 数値の地域化        | 持たない。Git の履歴の日時は `gitHistory.ts` が今までどおり組み立てる（§14.19）                              |
| 辞書の遅延読み込み         | していない。2言語ぶんを最初から持つ（分ける利得より、起動時のちらつきを避ける方が重い）                      |
| Monaco / xterm の UI 言語  | 変えていない。どちらも自前の文言を持つが、**利用者の文書と端末の出力**を出す器であって、アプリの文言ではない |
| ネイティブダイアログの言語 | 変えていない。OS が決める（保存 / フォルダ選択のダイアログ）                                                 |
| CSP                        | **1文字も変えていない。** 起動時の適用が Preload 経由なのはこのため（§17.6）                                 |
| IPC / Preload の口         | **1つも増えていない。** `preload/language.ts` は Main → Preload の一方向で、Renderer から呼べる API ではない |

---

## 18. Command と Keyboard Shortcut

Session 4-7A が基盤（Command Registry・Keybinding・`when`・一覧の行）を、4-7B が Git / Files の寄与を、4-7C が Settings の一覧を入れている。

**v1 は「既定の割り当てが効く」ところまで。** 打鍵の編集・User / Workspace の割り当て・`keybindings.json` の永続化・Command Palette は入っていない（§18.8）。基盤の側はそれらを**型を変えずに受けられる形**にしてあり、そのための余地がどこに残してあるかもこの章に書く。

### 18.1 Command Registry（そういう操作がある、という表）

```
commands/commandIds.ts   id の閉じた集合（27件）
commands/registry.ts     Record<CommandId, CommandDescriptor>
```

Panel Registry（§7.3）と同じ形にしてある。

- `Record<CommandId, …>` なので**登録漏れは型エラー**になる
- object の key として**同じ id を2度書けない**
- 引くのは常にこの表を通す（`getCommandDescriptor` / `listCommands`）

**`execute(id: string)` のような汎用の入口を作らない。** 作った瞬間「アプリが持つ操作」という限定が消える ── `shared/settings/sections.ts` の section、`workspace/panels/registry.ts` の `isPanelId` と同じ作法で、外から来た文字列は必ず `isCommandId` を通す。将来 `keybindings.json` を読むようになったとき、そこに書かれた command 名の関門はこれ1つになる。

**一度決めた id は変えない。** 利用者の割り当てがディスクに残るようになったとき、id を変えると設定した打鍵が静かに効かなくなる。`git.stashPush` が「退避の面を開く」に繋がっているのにこの名前なのはそのためで、後から「確認を出してから退避する」形に育てても id はこのままにできる。

並びの正本は `COMMAND_IDS` の配列で、`listCommands()` はその順に返す。表の見た目の順序には依存しない ── 依存させると、行を足す場所で一覧の見え方が変わる。

27件の内訳は次のとおり。

| カテゴリ    | 件数 | 入った Session      |
| ----------- | ---: | ------------------- |
| `workspace` |    2 | 4-7A                |
| `editor`    |    8 | 4-7A（2）/ 5-12（6) |
| `view`      |    5 | 4-7A                |
| `settings`  |    2 | 4-7A                |
| `git`       |    7 | 4-7B                |
| `files`     |    3 | 4-7B                |

`editor` が8件あるのは、Session 5-12 で Language Server の6操作が加わったため（§19.9）。**カテゴリは1つも増えていない** ── 増えたのは既存の `editor` の行数だけで、`CommandCategory` も `COMMAND_CATEGORY_ORDER` も 4-7C のままになる。

### 18.2 内部 id と、画面に出す名前を分ける

descriptor は3つを持つ。

| 欄         | 何か                                     | 画面に出るか |
| ---------- | ---------------------------------------- | ------------ |
| `id`       | `'git.commit'`。契約であり、変えない     | ✕            |
| `title`    | `'Commit'`。開発上の識別名（英語・固定） | ✕            |
| `titleKey` | `'command.git.commit'`。翻訳キー         | ○            |

`titleKey` は **`command.<CommandId>` に1対1**で対応させてある。機械的に決まる形にしておくと、足し忘れも綴り違いも実数で拾える（`commands/commandLocalization.test.ts` が27件すべてを確かめる）。**Session 4-7C で全件を一度に入れた** ── 一部だけ埋めると `commandTitle()` が「翻訳されるものとされないものが混ざった一覧」を返し、その半端さを画面を作る側が引き継ぐ。

`title` を消していないのは、ログとテストが読むもので、画面に出るのは `commandTitle()` を通った `titleKey` の側だから。型の上で `titleKey` を任意のままにしてあるのも意図的で、必須にすると `commandTitle()` の「無ければ `title`」という分岐が死に、翻訳を持たない descriptor をテストで組み立てられなくなる。

カテゴリ（`CommandCategory`）も同じ切り分けで、`'git'` は識別子のまま、表示名は `commandCategoryLabels.ts` が翻訳キーで持つ（`workspace/panels/panelLabels.ts` と同じ形）。カテゴリ名を command 名に埋め込まない（`'Git: Commit'` にしない）のは、カテゴリを**見出しに畳む**ためで、行に埋め込むと Git だけで同じ語が7回並ぶ。

### 18.3 descriptor と handler を分ける

```
registry.ts        そういう操作がある（静的な表・React 非依存）
CommandProvider    今それを実行できるか（Map<CommandId, CommandHandler>）
```

**handler を静的な表に書くことがそもそもできない。** Git の操作は `useGitRepository()` が持ち、それが生きているのは Git パネルが開いている間だけになる。分けておくと、

- 一覧（Settings / 将来の Command Palette）は**所有者の生死に関係なく**作れる
- 所有者が居ない command は「今は実行できない」として自然に落ちる
- descriptor は React にも DOM にも依存しない（テストが素で書ける）

VS Code の `contributes.commands` と `CommandRegistry` の分担と同じにあたる。

**handler の表は `useRef` の `Map` で、React の state ではない。** state にすると command を1つ登録するたびに Renderer 全体が描き直され、登録は所有者が mount / unmount するたび（パネルを1枚動かすだけでも）走る。読むのは打鍵が届いた瞬間だけで、描画には1つも使わない。

**同じ id に2つ登録すると例外を投げる。** 後勝ちにすると「どちらが効いているか分からないまま片方が黙って死ぬ」ことになり、それは所有者が2つある（＝設計の間違い）ことを意味する。今の Shell ではその形は作れない（パネルは1 id につき1枚で、タブ群では前面のものしか mount されない）が、**守られていることと確かめないことは別**なので外していない。React の StrictMode の二重 effect は間に解除が挟まるため当たらない。

`execute` は**実行できたときだけ true** を返す。打鍵の側はこの返り値で `preventDefault()` するかを決める ── 所有者が居ない command のためにブラウザの既定を止めると、割り当てが効かないうえに何も起きない、という一番分かりにくい状態になる。

#### Git / Files の寄与（Session 4-7B）

`git/GitCommands.tsx` は**画面に何も出さない**（`null` を返す）。在るのは登録の宣言だけで、何が起きるかは `GitView` から渡ってくる関数が決める。

GitView 本体に書けないのは、GitView が関数の途中で3回 return する（取得中・案内・型の保険）ためで、**押せるかどうかの判断が計算されるのはその後**になる。hook は条件付き return より後に置けないので、本体に書くと「readiness を知らないまま登録する」か「hook の順序を壊す」かのどちらかになる。**子にすれば、置いた場所そのものが条件になる。**

これは §18.5 の `when` に `gitRepositoryAvailable` を入れなかった理由でもある ── 条件を1つ増やす代わりに、**使えないときは登録しない**で同じ効果が出る。効き方は2段ある。

1. リポジトリが使えないとき … この component ごと mount されない（GitView）
2. パネルが背面タブのとき … GitView ごと mount されない（`workspace/shell/PanelGroup.tsx`）

どちらも「今はその操作ができない」であって失敗ではない（`execute` が false を返し、打鍵は素通りする）。

**押せる条件をここで書き直さない。** 渡ってくる `*Enabled` は画面のボタンを押せなくしているのと同じ値で、ここには判断が1つも無い ── 組み立て直すと `withGitInProgressBlock` の禁止を迂回する経路ができ、「押しても必ず失敗する操作」が command として実行できることになる。

### 18.4 打鍵の表し方と、割り当ての畳み方

#### `event.code` を基準にする

| 見るもの     | 何が返るか                          | 配列を変えると |
| ------------ | ----------------------------------- | -------------- |
| `event.key`  | **入力される文字**（`'s'` / `'+'`） | 変わる         |
| `event.code` | **物理キーの位置**（`'KeyS'`）      | 変わらない     |

`Ctrl+Shift+E` を `key` で判定すると Shift が付いた時点で `'E'` になるだけでなく、配列によっては別の文字になる。**位置で見れば、US 配列でも日本語配列でも同じ物理キーを指す。** 記号の名前はその物理キーが US 配列で刻印している文字にしてあり（`Comma` → `','`）、`ctrl+,` はどちらの配列でも同じキーで効く。`key` へ落ちるのは `code` から名前を決められなかったとき（テンキー・IME 経由・未知のキー）だけ。

**既存の Terminal の打鍵はここを通らない。** `Ctrl + '+' / '-' / '0'` は `terminal/terminalDisplay.ts` が `event.key` で判定し続ける（Session 3-7-3 のまま、`=` と `_` の読み替えを持っている）。Session 4-7 では1行も触っていない（§18.8）。

#### Default / User / Workspace を、型を変えずに受ける

v1 が作る rule は `defaults.ts` の `source: 'default'` だけ。それでも `KeybindingSource` を最初から3つ持たせ、`resolveKeybindings` が**順序付きの配列を1本受け取って後勝ちで畳む**形にしてある。

```ts
resolveKeybindings(DEFAULT_KEYBINDINGS) // v1（今）
resolveKeybindings([...DEFAULT_KEYBINDINGS, ...userRules, ...workspaceRules]) // 将来
```

型も関数も呼ばれる側も1行も変わらない。逆に v1 で `source` を持たせずに作ると、後から入れるときに**保存形式と解決順の両方**が変わる。

後勝ちにする単位は「同じ打鍵 × 同じ条件」で、条件が違えば別の rule として両方残る ── `ctrl+j` が「Terminal に focus が無いとき」と「あるとき」で違う command を指すのは競合ではなく使い分けにあたる。読めなかった rule は捨てずに `invalid` として返す（**今は誰も読んでいない**。`keybindings.json` を読むようになったとき「書いたのに効かない」を見せるため）。

#### 既定の7件

| 打鍵           | command                     | 条件                                      |
| -------------- | --------------------------- | ----------------------------------------- |
| `Ctrl+S`       | `editor.save`               | **無し**（移設前と同じにするため）        |
| `Ctrl+Shift+S` | `editor.saveAs`             | `editorHasActiveTab` / `!terminalFocused` |
| `Ctrl+O`       | `workspace.openFolder`      | `!terminalFocused`                        |
| `Ctrl+,`       | `settings.open`             | `!terminalFocused`                        |
| `Ctrl+Shift+E` | `view.togglePanel.files`    | `!terminalFocused` / `!settingsOpen`      |
| `Ctrl+Shift+G` | `view.togglePanel.git`      | `!terminalFocused` / `!settingsOpen`      |
| `Ctrl+J`       | `view.togglePanel.terminal` | `!terminalFocused` / `!settingsOpen`      |

選び方は4つの規則による。

1. **既にある打鍵を1つも変えない。** `Ctrl+S` は Session 3-5 から `useEditorSession.ts` の window listener が持っていたもので、ここへ移しただけ ── 条件を付けていないのはそのため
2. **Monaco が使っている打鍵を取らない。** `Ctrl+F` / `Ctrl+H` / `Ctrl+G` / `Ctrl+/` / `Ctrl+Shift+K` などは Monaco の既定で、取ると Editor の中でそれらが死ぬ
3. **端末を触っている最中にアプリ側の操作を走らせない。** `Ctrl+J` は端末では改行（0x0A）、`Ctrl+O` は 0x0F にあたる
4. **日本語配列で同じ物理キーになるものだけ。** バッククォートの `Ctrl` 併用は入れていない ── あの位置は日本語配列では半角/全角キーで、IME の切り替えとぶつかる（Terminal の開閉は `Ctrl+J` に置いた）

`Ctrl+P` / `Ctrl+Shift+P` は**空けてある**（Command Palette の席。§18.8）。

**`editor.save` に条件が無いのは「端末の中でも保存される」という意味ではない。** 端末に focus があるとき `Ctrl+S` は `window` まで上がってこない（xterm が `stopPropagation` する）── 移設前も同じ形の listener だったので、端末の中で `Ctrl+S` が効かないのは以前からそうだったことになる。この前提は Session 4-8A で実機に測って確かめてある（DEVELOPMENT.md §4）。

### 18.5 条件（`when`）と、打鍵を受ける場所

#### 式は書けない。閉じた集合の AND だけ

VS Code の `when` は論理演算子から正規表現まで持つ式言語だが、**あれは基盤より大きいサブシステム**にほかならない。v1 では、

- 条件は `WHEN_KEYS` に載っている6つだけ
- 並べたものは AND（`['a', '!b']` は「a かつ b でない」）
- 否定は先頭の `!` 1文字だけ

`WhenClause` は「条件名、または頭に `!` を付けたもの」という**型で閉じた union** なので、綴りの間違いは型エラーになり、文字列を解析する必要が無い。足りなくなったら式パーサへ移せる（`['a', '!b']` は `'a && !b'` と1対1に対応するので、保存形式を変えずに読み替えられる）。

**読めない条件が1つでもあれば通さない（fail-closed）。** 逆にすると、綴りを間違えた条件やこの版が知らない条件を持つ rule が「条件が無いのと同じ」＝**どこでも効く**ようになり、条件を書いた意図と正反対に壊れる。

#### 6つに絞った理由と、その供給元

**条件は「誰かがその値を供給する」ことで初めて意味を持つ。** 供給元が無い条件を先に作ると、常に false（＝そのショートカットは永久に効かない）になる。

| 条件                 | 供給元                                                      |
| -------------------- | ----------------------------------------------------------- |
| `workspaceOpen`      | `useWorkspaceFolder().workspace !== null`                   |
| `editorHasActiveTab` | `useEditorContext().activeTab !== null`                     |
| `editorFocused`      | DOM（`[data-panel-body="editor"]` の中に focus があるか）   |
| `terminalFocused`    | DOM（`[data-panel-body="terminal"]` の中に focus があるか） |
| `settingsOpen`       | `WorkspaceShell` が `useWhenFlag` で申告する                |
| `modalOpen`          | DOM（`[aria-modal="true"]` が出ているか）                   |

DOM を読む3つは**React が持っていない状態**にあたる ── focus の持ち主はブラウザで、modal を出す側は6箇所に散っている（Editor / Files / Git / Terminal / Unsaved）。後者を申告制にすると6箇所を触ることになるが、`aria-modal="true"` はそれらが**既に**付けている属性で、「操作を遮る面が出ている」ことの観測できる印にほかならない ── 新しく約束を作らずに済む。

`gitRepositoryAvailable` は入れていない（§18.3 の「使えないときは登録しない」で同じ効果が出る）。`data-panel-body` をタブ側の `data-panel` と名前で分けてあるのは、`closest()` がタブを拾わないようにするため（タブは本体の器の外にある）。

#### 確認ダイアログの裏では、原則として何も走らない

`modalOpen` は他の条件と扱いが違い、**rule ごとではなく全体に掛かる**（`dispatch.ts`）。失われるものがある操作の確認が出ている間にその裏でショートカットが走ると、「何を訊かれているのか」と「今アプリが何をしたか」が食い違う。条件を書き忘れた rule が裏で走る形にしないため、既定を「走らない」にしてある。裏でも走ってよい command は `when` に `'modalOpen'` を**明示的に**書く（v1 では1つも無い）。

これは移設前の `Ctrl+S` からの**唯一の振る舞いの変化**にあたる ── 以前は確認ダイアログの裏でも保存が走っていた。

#### listener は window に1本だけ

`KeybindingProvider` が `window` の `keydown` を**1度だけ**張る。変わりうる値（効いている割り当て・Workspace / タブの状態・`execute`）はすべて ref を経由させ、listener を張り直さない。条件の申告（`setFlag`）も ref の `Map` で、state にすると Settings を開閉するたびに配下が描き直される（`CommandProvider` と同じ判断）。

置き場所は **`App.tsx` の一番内側**。Workspace と Editor の状態を読むためで、`CommandProvider`（何にも依存しない）を外側に置くのと対になる。

### 18.6 Settings の Keyboard Shortcuts 一覧（Session 4-7C）

#### v1 は読むだけ

打鍵の変更・User / Workspace の割り当て・`keybindings.json` の永続化はどれも入っていない。**行を押しても command は実行されない** ── 実行の入口は打鍵と各パネルの UI のままで、ここは一覧にほかならない（`onClick` を持つのは検索欄と、それを消す `×` だけ）。

#### 一覧はその場で組み立てる

```
listCommands()             アプリが持つ操作の全体（commands/registry.ts）
useKeybindings().entries   効いている割り当て（keybindings/KeybindingProvider.tsx）
        ↓ buildShortcutRows（純関数）
ShortcutRow[]
```

どちらも**この画面のために新しく作った口ではない** ── `entries` は Session 4-7A から `KeybindingContext` にあり、読む相手がここで初めてできた。新しい IPC も、Main / preload / shared への変更も1つも無い。目録に書き写さないのは、command を足すたびに2箇所を直すことになるため。

`useCommands().isRegistered` は**使わない。** handler の表は `useRef` の `Map` で React の state ではないので（§18.3）、描画中に読んでも変化で再描画されず必ず古い値が出る。一覧が出すのは「アプリが持つ操作の全体」であって、その瞬間に実行できるものではない ── **Git パネルを閉じていても Git の7件は並ぶ**（Session 4-8A で実機に確認）。

#### カテゴリには2種類ある

Session 4-7C まで、Settings のカテゴリは `SettingsSectionId` と ID も並びも1対1だった（どれも「保存される値の項目」を並べるものだったため）。Keyboard Shortcuts はそこから外れる**最初のカテゴリ**にあたる ── 並べるのは値の項目ではなく一覧表で、**保存するものが1つも無い**（対応する section が存在しない）。

そこでカテゴリを `kind` で分けた判別可能なユニオンにしてある。

| `kind`        | 中身                   | section      |
| ------------- | ---------------------- | ------------ |
| `'items'`     | 値の項目が並ぶ（従来） | 1対1で持つ   |
| `'shortcuts'` | 一覧表                 | **持たない** |

**1対1の約束は消えていない。** 移ったのは掛かる相手だけで、「**値カテゴリ**の並びが section の並びと一致する」は今も成り立つ（`settingsCatalog.test.ts`）。`keyboard` を末尾に置いてあるのは、値カテゴリが配列の前方にそのまま残るようにするためでもあり、値を変える場所と一覧を見る場所を混ぜないためでもある。

**`shared/settings/sections.ts` は Session 4-7C で1行も変えていない** ── 保存するものが無いので、空の `keyboard` section を切らない（§12.4 の「中身が決まっていない section を先に作らない」）。

#### 行の型は、画面が出すものより広い

`ShortcutRow` は `when` / `source` / `conflictsWith` / `isModified` も持つが、**v1 の画面はそれらを出さない。**

| 欄         | v1 で出すか | 理由                                                                  |
| ---------- | ----------- | --------------------------------------------------------------------- |
| Command    | ○           | `titleKey` 経由の翻訳                                                 |
| Category   | ○           | 見出しに畳む                                                          |
| Keybinding | ○           | 未割り当ては専用の見せ方（27件中15件が未割り当て）                    |
| When       | ✕           | `'!terminalFocused'` のような**内部の名前**をそのまま見せることになる |
| Source     | ✕           | 既定しか無い今、**全行に同じ語を並べるだけ**になる                    |
| 競合表示   | ✕           | 既定同士は競合しない                                                  |
| Reset      | ✕           | `source !== 'default'` が常に false                                   |

型から**外していない**のは、User / Workspace の割り当てが入ったとき変わるのが画面だけで済むようにするため。翻訳キー（`settings.keyboard.sources.*`）も先に置いてあるが、**まだ画面に出ていない。**

未割り当ての14件は、`defaults.ts` が「割り当ての無い command」として挙げる中核の4件（`workspace.closeFolder` / `view.togglePanel.editor` / `view.resetLayout` / `settings.close`）と、Git / Files の10件からなる。`settings.close` に打鍵を割り当てないのは **Esc が既に持っている**ためで、既存の Esc 17箇所には触らないという Session 4-7A の前提による（同じ操作の入口を二重に持たない）。

#### 持つ state は検索の文字列だけ

それも保存しない（`SettingsOverlay` が開いているカテゴリを保存しないのと同じ）── 次に開いたときに前の絞り込みが残っていると、一覧が欠けているように見える。カテゴリを列ではなく見出しにしてあるのは、27件のうち Git だけで7件あり、列にすると同じ語が7回並ぶため。機械が読む側には各行の `data-category` が残してある。

### 18.7 Session 4-7 が触っていない境界

| 境界                       | 変化                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| IPC チャンネル             | **1本も増えていない**（Command も Keybinding も Renderer 内で完結する） |
| Preload の口               | **1つも増えていない**                                                   |
| `shared/`                  | **1行も変えていない**                                                   |
| Main の検証                | **1行も変えていない**                                                   |
| CSP                        | **1文字も変えていない**                                                 |
| ディスクへの書き込み       | 無し。`keybindings.json` は**存在しない**（作る経路も無い）             |
| 既存の Esc（17箇所）       | 触っていない（§18.6）                                                   |
| Terminal の `Ctrl + ± / 0` | 触っていない（§18.4）                                                   |

Session 4-8A の production app 統合確認でこれらを実測している（DEVELOPMENT.md §4）。

### 18.8 Session 4-7 で入れていないもの

| 項目                           | 現状                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打鍵の編集                     | 入れていない。一覧は**読むだけ**（§18.6）                                                                                                                 |
| User / Workspace の割り当て    | 入れていない。`resolveKeybindings` は連結順で受けられる形にしてある（§18.4）                                                                              |
| `keybindings.json` の永続化    | 入れていない。`KeybindingRule` が保存形式そのものになっているが、**読み書きする場所がまだ無い**                                                           |
| Command Palette                | 入れていない。`Ctrl+P` / `Ctrl+Shift+P` を空けてある。descriptor と `commandCategoryLabels` は Palette も同じものを使う                                   |
| Source 列 / When 列 / 競合表示 | 出していない。型には在る（§18.6）                                                                                                                         |
| `terminal` カテゴリの command  | 入れていない。端末の打鍵は `terminalDisplay.ts` が `event.key` で受けており、registry へ移すには日本語配列の `=` / `_` の読み替えごと設計し直すことになる |
| 和音（chord sequence）         | 持たない。`KeyChord` は打鍵1つで、`Ctrl+K Ctrl+S` のような2打の連なりは表せない                                                                           |
| Mac の `cmd`                   | 解析だけは受ける（`'cmd'` は `'meta'` の別名）。Mac 対応そのものは未着手                                                                                  |
| メニューバーへの打鍵の表示     | していない（アプリケーションメニューは §2 のまま）                                                                                                        |
| Theme 切り替えの打鍵           | 置いていない。Theme は Settings の Appearance から変える（§16）                                                                                           |

## 19. Language Server（LSP）

STEP 5（Session 5-1 〜 5-12）で入れた層。**Monaco が既に持っていた「編集する器」に、その言語を本当に理解しているプログラムを繋ぐ**のが目的で、繋ぎ方そのものは Terminal（§13）が先に固めた「Main が長命な子プロセスを持つ」形をそのまま踏襲している。

| Session | 入れたもの                                                  |
| ------- | ----------------------------------------------------------- |
| 5-1     | プロセスの起動 / 停止、JSON-RPC、restart policy             |
| 5-2     | Document Synchronization（didOpen / Change / Save / Close） |
| 5-3     | Diagnostics（push）と Monaco marker                         |
| 5-4     | Settings（使う / 使わない）と Status Bar                    |
| 5-5     | Completion                                                  |
| 5-6     | Hover                                                       |
| 5-7     | Definition / References                                     |
| 5-8     | Formatting                                                  |
| 5-9     | Rename / prepareRename                                      |
| 5-10    | Python（Pyright）と server capability の読み取り            |
| 5-11    | C#（csharp-ls）                                             |
| 5-12    | Command / Keybinding からの呼び出し                         |

### 19.1 対応言語と、繋ぐ相手

| 言語                    | 拡張子                                  | Language Server            | 入手経路                  |
| ----------------------- | --------------------------------------- | -------------------------- | ------------------------- |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | typescript-language-server | npm（グローバル）         |
| Python                  | `.py` `.pyi` `.pyw`                     | pyright-langserver         | npm（グローバル）         |
| C#                      | `.cs` `.csx`                            | csharp-ls                  | dotnet tool（グローバル） |

**どれもアプリに同梱しない**（DESIGN.md §5）。入っていない PC はふつうにあり、見つからなければその言語だけが使えない状態に留める ── アプリが起動しない理由にはしない。

TypeScript と JavaScript は**1本のサーバが両方を見る**ため、`LanguageServerId` は `typescript` / `python` / `csharp` の3つになる。

表は2つに分かれていて、見ているものが違う。

| 表                                              | 何から引くか     | 何を決めるか                        |
| ----------------------------------------------- | ---------------- | ----------------------------------- |
| `main/lsp/documentLanguage.ts`                  | 拡張子           | LSP の `languageId` と担当サーバ    |
| `renderer/src/editor/lsp/serverAvailability.ts` | Monaco の言語 id | provider を登録する言語と担当サーバ |

分かれているのは**答えの集合が違う**ため（`.tsx` は Main では `typescriptreact`、Monaco では `typescript`）。同じファイルについて行き先のサーバが食い違わないことだけが要件で、そこは両方が `typescript` / `python` / `csharp` を返すことで揃っている。

### 19.2 プロセスと JSON-RPC（Main が持つ）

```
main/lsp/languageServerCatalog.ts   どの実行ファイルを、どの引数で起動するか（表）
main/lsp/languageServers.ts         起動 / 停止 / 状態の保持
main/lsp/jsonRpcConnection.ts       stdio 上の JSON-RPC（Content-Length フレーミング）
main/lsp/jsonRpcMessage.ts          1本のメッセージの読み書き
main/lsp/restartPolicy.ts           落ちたときに立て直すか
```

**起動のきっかけは「その言語の文書が開かれたこと」だけ。** Renderer に「起動して」「止めて」と言う口は無く、`window.fluvix.lsp` にプロセスを操作する関数は1つも無い（§19.8）。

catalog が守っていること:

- 実行ファイルは **PATH から解決した絶対パス**で起動する。名前だけで起動しない（cwd や PATH の順序で別のものが動く経路を作らない）
- Workspace の中は**探さない**。clone してきたリポジトリに `csharp-ls.exe` が置かれていることは十分ありうる ── 「フォルダを開いてコードを表示した」が「そのフォルダの中の実行ファイルが動く」になっては困る
- Windows で npm が置くのは `.cmd`（バッチ）で、`CreateProcess` は直接実行できない。`cmd.exe /c <絶対パス>` で包むが、**その `cmd.exe` も `%SystemRoot%` から組み立てる**（PATH に任せない）
- `--stdio` のような引数は**表の側が持つ**。呼び出し側が忘れる余地を作らない

`restartPolicy.ts` は「窓の中で数える」形。3分の窓の中で3回まで、間を 1s → 4s → 10s と伸ばして立て直し、超えたら諦める（その言語だけが使えない状態で止まる）。窓を持つのは、朝と夕方に1回ずつ落ちたサーバを「繰り返し落ちている」と数えないため。

### 19.3 Document Synchronization

Renderer の Monaco Model が正本で、Main はその写しを持たない。

```
renderer: documentStore が Model の変化を集める
        → editor/lsp/useDocumentSync.ts
        → window.fluvix.lsp.didOpen / didChange / didSave / didClose
main:     openDocuments.ts が「今どの文書が開いていて、版はいくつか」を持つ
        → textDocumentNotifications.ts がサーバへ通知する
```

**版（version）が要になる。** Renderer は Monaco の `getVersionId()` を添えて要求を出し、Main は自分が知っている版と違えば `stale` を返す ── 打っている最中に返ってきた古い答えを当てないための仕組みで、Completion / Hover / Definition / References / Formatting / Rename の6つがすべてこの1つの入口（`main/lsp/documentRequest.ts`）を通る。

Workspace が変わったときは、Main が `lsp:sync-requested` を投げて Renderer に開き直させる。Renderer が「今開いているもの」を知っている唯一の側なので、**Main が推測して復元しない**。

改名は LSP に通知が無いため、`documentStore` の鍵が動く1箇所で `didClose` → `didOpen` を起こす（Model は作り直さないので、利用者から見た Undo の連続性は切れない）。

### 19.4 capability negotiation（Session 5-10）

Session 5-9 までは相手が1本しか無く、「サーバは何ができるか」を確かめる必要がそもそも無かった。Python を足した時点でそれが崩れる。

```
typescript-language-server … documentFormattingProvider: true
csharp-ls                  … documentFormattingProvider: true
pyright-langserver         … documentFormattingProvider を出さない
```

Pyright は型検査器であって整形器ではなく、`textDocument/formatting` へ `-32601 Unhandled method` を返す。そこで `main/lsp/serverCapabilities.ts` が `initialize` の応答を読み、`documentRequest.ts` の事前確認に **「そのサーバがその機能を名乗ったか」** を1段として足した。名乗っていない機能は要求そのものを出さず `unavailable` を返す。

Renderer 側にも同じ判断の写しが1つだけある（`editor/lsp/formattingAvailability.ts` の `LSP_FORMATTING_LANGUAGE_IDS`）が、これは**無駄な往復を1つ省くためだけ**のもので、本当の判断は Main が持つ。かりにこれを通り抜けても Main が `unavailable` を返して同じ結末になる。

**Python の整形のために Black / Ruff を入れる判断はしなかった。** 言語サーバを1本足す作業に、別系統の外部ツールを1つ増やす判断を混ぜない（DESIGN.md §5）。整形 provider を Monaco に登録しないことで、Format Document は「この言語の整形器は入っていない」と言う ── 登録して何も返さない形にすると、黙って何も起きないことになる。

### 19.5 機能ごとの経路と fallback

7つの機能はすべて同じ形をしている。

```
Monaco の Action / 打鍵
  → 登録した provider（renderer/src/editor/monaco/lsp*.ts）
    → shouldUse*(languageId, statuses) で「LSP を使うか」を決める
      → window.fluvix.lsp.<機能>()  ← 型付きの口
        → Main の documentRequest.ts（6段の事前確認 + capability）
          → JSON-RPC
```

LSP が答えられなかったときの落とし先は、**言語によって違う**。

| 機能        | TypeScript / JavaScript          | Python | C#   |
| ----------- | -------------------------------- | ------ | ---- |
| Diagnostics | Monaco 内蔵の構文検査            | 無し   | 無し |
| Completion  | Monaco 内蔵（TypeScript worker） | 無し   | 無し |
| Hover       | 同上                             | 無し   | 無し |
| Definition  | 同上                             | 無し   | 無し |
| References  | 同上                             | 無し   | 無し |
| Formatting  | 同上                             | 無し   | 無し |
| Rename      | 同上                             | 無し   | 無し |

**`.py` / `.cs` を内蔵の TypeScript worker へ渡すことは決してしない。** 渡せば Python や C# の綴りを TypeScript として解析した答えが返り、Rename と Formatting では**コードが壊れる**。5つの provider すべてが `isTypeScriptWorkerLanguage()` で守ってあり、代わりが無いなら無理に代わりを作らない（Session 5-10 / 5-11 の判断）。

TypeScript 側では、LSP が答えている間は Monaco 内蔵の同じ機能を黙らせる（`monacoSetup.ts` の `setBuiltIn*Suppressed`）。同じ指摘が2本の線として出たり、同じ候補が2度並んだりしないため。**止めっぱなしにはしない** ── サーバが落ちた・終わった・Workspace が変わったときは戻す。戻さないと「Language Server が居ないのに内蔵の指摘も出ない」という、STEP 4 までより悪い状態が残る。

### 19.6 Settings と Status Bar（Session 5-4）

`settings.json` の `lsp` section が持つのは**使うか / 使わないか**だけ。

```
enabled            全体
typescriptEnabled  TypeScript / JavaScript
pythonEnabled      Python
csharpEnabled      C#
```

ここに**無いもの**が、この section の性格を決めている ── 実行ファイルのパス、引数、作業ディレクトリ、`initializationOptions` はいずれも欄が無い。path の欄を1つ足した時点で、設定ファイルは「Renderer と利用者が指定した実行ファイルが起動する場所」になる。

この section だけは**値の意味を Main も読む**（プロセスを立てる / 終わらせるのは Main の側）。同じ値を2通りに読まないため、読み方そのものを `shared/lsp/serverSettings.ts` に置いて Main と Renderer の両方が通る。無い ＝ 有効（Session 5-3 までの振る舞いを変えないため）。

Status Bar は6つの状態を出す。

| 状態           | 意味                                      |
| -------------- | ----------------------------------------- |
| 利用可能       | `initialize` が終わって答えられる         |
| 起動中…        | 起動して `initialize` の応答を待っている  |
| 未インストール | この PC に実行ファイルが見つからない      |
| 起動失敗       | 起動できた / できないに関わらず駄目だった |
| 停止中         | まだその言語の文書を開いていない          |
| 使わない       | 設定で切ってある                          |

**「有効にしてある」と「立っている」は別のこと。** 前者は設定（Renderer が持つ）、後者は `lsp:status-changed` で届く実際の状態で、2つを混ぜない。

### 19.7 Renderer 側の provider 登録

```
editor/lsp/useDocumentSync.ts   同期（常時）
editor/lsp/useDiagnostics.ts    診断（常時）
editor/lsp/useCompletion.ts     補完
editor/lsp/useHover.ts          Hover
editor/lsp/useNavigation.ts     定義 / 参照
editor/lsp/useFormatting.ts     整形
editor/lsp/useRename.ts         Rename
```

どれも `useEditorSession.ts` から呼ばれ、Workspace が開いている間だけ登録される。Monaco 本体は**遅延読み込みのまま**で、これらの hook も `import('../monaco/lsp*')` で必要になってから読む ── Panel Registry を辿るだけで Monaco が読み込まれない、という Session 3-4 以来の性質を崩さないため。

provider を登録する言語の一覧は `serverAvailability.ts` の `LSP_EDITOR_LANGUAGE_IDS` 1箇所から配る（Session 5-11）。整形だけは別の一覧を持つ ── 担当サーバがその機能を持っていない言語があるのは整形だけであるため（§19.4）。

### 19.8 Security boundary

STEP 4 から STEP 5 へ渡した境界（DESIGN.md §11 の引き継ぎ表）は、すべて維持されている。

| 渡さないもの              | どう閉じているか                                                           |
| ------------------------- | -------------------------------------------------------------------------- |
| 絶対パス                  | 要求も応答も **workspace-relative path** だけ（`main/lsp/documentUri.ts`） |
| file URI                  | URI を組み立てるのも解くのも Main の中だけ                                 |
| 実行ファイル / 引数 / cwd | catalog が持つ。設定にも IPC にも欄が無い                                  |
| 任意の JSON-RPC method    | 口は機能ごとに分かれた12個。method 名を渡す口が無い                        |
| 任意のサーバ選択          | 行き先は開いた文書の拡張子だけで決まる。`serverId` を渡す口が無い          |

`window.fluvix.lsp` の口は**16個ちょうど**（要求12 + 購読4）で、STEP 5 の間に増えていない。

```
要求: didOpen didChange didSave didClose completion hover definition references
      prepareRename rename formatting getStatus
購読: onSyncRequested onDiagnostics onDiagnosticsCleared onStatusChanged
```

Workspace の外を指す `relativePath`（`../`・`C:\...`・`/etc/passwd`・`src/../../`）は Main が `INVALID_REQUEST` で断る。`rename` の応答に載るのは workspace-relative path と `TextEdit` だけで、**ファイルの作成 / 改名 / 削除を表す欄が無い**（`shared/lsp/rename.ts`）── `workspace/applyEdit` の一般対応を入れていないのはこのためになる。

**CSP は STEP 1 から1文字も変えていない。** Renderer から `require` / `process` / `Buffer` / `module` / `electron` はいずれも `undefined` で、`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` も STEP 1 のまま。`client/registerCapability` は**拒否する**（サーバが後から能力を足す経路を開かない）── §19.10 の制約はその選択の裏返しにあたる。

### 19.9 Command / Keybinding（Session 5-12）

6操作を Command Registry（§18）へ載せてある。

| command                 | Monaco の Action                 | 既定の打鍵  |
| ----------------------- | -------------------------------- | ----------- |
| `editor.goToDefinition` | `editor.action.revealDefinition` | F12         |
| `editor.findReferences` | `editor.action.goToReferences`   | Shift+F12   |
| `editor.renameSymbol`   | `editor.action.rename`           | F2          |
| `editor.formatDocument` | `editor.action.formatDocument`   | Shift+Alt+F |
| `editor.triggerSuggest` | `editor.action.triggerSuggest`   | Ctrl+Space  |
| `editor.showHover`      | `editor.action.showHover`        | 未割り当て  |

**LSP を呼ぶ経路は1本も増えていない。** 6つの provider は Monaco の Action から既に呼ばれており、足したのは `Command → Monaco Action` の1本だけになる（`editor/lsp/editorActions.ts`）。Main は1行も変わっていない。

所有者は `ICodeEditor` を持つ `MonacoEditor.tsx`。器が mount している間だけ登録されるので、Editor パネルを閉じている・バイナリを開いている状態では表に載らず、打鍵も殺さない。

実行は `editor.focus()` → `editor.trigger()` に一本化してある。**Monaco の Action には登録の仕組みが2通りあり、`getAction()` が引けるのは片方だけ**であるため ── `revealDefinition` と `goToReferences` は `registerAction2` の側で `getAction()` が null を返す。`trigger()` は出れば `InternalEditorAction.run()`、出なければ `commandService.executeCommand()` へ落ちるので、両方を1つの呼び方で受けられる。どちらの道でも precondition（`hasDefinitionProvider` など、登録済み provider から立つ context key）は Monaco 側が見るため、**capability の判断の写しを Renderer に持たない**。

打鍵はすべて `editorFocused` を条件に持つ。Files パネルが F2 を「ファイル名の変更」に使っており、あちらは `preventDefault()` は呼ぶが `stopPropagation()` は呼ばないため window まで届く ── 条件が無いと、ツリーで F2 を押すたびにファイル名の変更とシンボル名の変更が同時に始まる。**既存側は1行も変えていない。**

Hover に打鍵を当てていないのは、Monaco の既定が `Ctrl+K Ctrl+I` の2打鍵で、この基盤が1打鍵しか扱わないため（§18.8 の「和音」）。

Diagnostics と Document Sync は Command 化していない ── 常時動いているもので、「実行する」という形を持たない。

### 19.10 既知の制約: pyright-no-file-watching

**Pyright は、エディタで開いていないファイルのディスク上の変更に気づかない。**

原因は §19.8 の選択にある。このクライアントは `client/registerCapability` を拒否しており、Pyright は `workspace/didChangeWatchedFiles` を登録できない。tsserver は自前の file watcher を持つためこの問題が出ず、Session 5-9 までは表面化しなかった。

Session 5-13 で実際に測った範囲は次のとおり。

| 状況                                         | 結果                                          |
| -------------------------------------------- | --------------------------------------------- |
| 開いていないファイルをディスク上で書き換える | 20秒以上待っても気づかない                    |
| 書き換えたファイルをエディタで開く           | 既に開いている側は更新されない                |
| 依存している側のタブを閉じて開き直す         | それでも更新されない                          |
| サーバを立て直す（Settings で OFF → ON）     | **反映される**                                |
| 同じ操作を TypeScript で行う                 | 開かなくても気づく（tsserver 固有の watcher） |

利用者から見た現れ方は、Session 5-10 が記録したとおり「Python で複数ファイルにまたがる Rename をした後、閉じていたファイルに対する古い指摘が残る」になる。

**STEP 5 では直さない。** file watching を入れるのは、監視対象の決め方・通知の間引き・Workspace の外へ出ないことの保証を同時に設計する話で、LSP を1本足す作業に混ぜる範囲ではない（DESIGN.md §12 の「STEP 5 で意図的に入れていないもの」）。回復手段（サーバの立て直し）が利用者の手元にあることは確かめてある。

### 19.11 STEP 5 で入れていないもの

| 項目                         | 現状                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Problems panel               | 入れていない。診断は Monaco の marker として出るだけ（一覧の面は持たない）              |
| Format on Save               | 入れていない。整形は明示した操作のときだけ走る                                          |
| Code Action / Quick Fix      | 入れていない。`codeActionProvider` を名乗っていない                                     |
| Signature Help               | 入れていない                                                                            |
| Semantic Tokens              | 入れていない。色は Monaco の文法定義のまま                                              |
| Inlay Hints                  | 入れていない                                                                            |
| Workspace Symbol             | 入れていない。探すのは Files の検索（§10）                                              |
| `workspace/applyEdit`        | 一般対応を入れていない。Rename の応答だけが編集を持ち、その形も `TextEdit` に限ってある |
| executable path の設定       | 入れていない（§19.8）                                                                   |
| workspace-local server 起動  | しない。Workspace の中は探さない（§19.2）                                               |
| Workspace 外のファイルを開く | しない。定義の行き先が Workspace の外なら開かない                                       |
| file watching                | 入れていない（§19.10）                                                                  |
| Python の整形器              | 入れていない（§19.4）                                                                   |
| DAP                          | STEP 6。LSP とは別のプロセス系統として設計する（§20）                                   |

---

## 20. Debug（DAP。STEP 6）

Session 6-0 で設計を確定し、Session 6-1 で Main 内の最下層（DAP message / connection、adapter process、adapter catalog）を実装し、Session 6-2 で Main-owned Debug Session lifecycle / state machine を追加し、Session 6-3 で Breakpoint（Monaco の glyph margin・保存・`setBreakpoints`）を入れ（§20.12）、Session 6-4 で実行制御（Continue / Pause / Step Over / Step Into / Step Out / Stop）を入れた（§20.13）。ここに書いていない口・欄・経路を実装側で足すときは、足す前にこの節へ戻ること。

DESIGN.md §5 の11機能（Breakpoint / Continue / Pause / Step Over / Step Into / Step Out / Stop / Variables / Call Stack / Debug Console / エラー位置へのジャンプ）を、Terminal（§13）と LSP（§19）が固めた「**Main が長命な子プロセスを持ち、Renderer は app-domain の言葉だけで話す**」形の上に載せる。

### 20.1 LSP と決定的に違う一点

LSP は「**何を起動するか**」を Renderer に相談する必要が無かった。開いた文書の拡張子だけで行き先のサーバが決まり、実行ファイル・引数・cwd は catalog（Main）が持てば足りた（§19.2・§19.8）。

デバッグは違う。**「何を、どんな引数で、どこで動かすか」は利用者にしか決められない。** ここに欄をまったく作らなければ道具にならず、そのまま欄を作れば「Renderer が指定した実行ファイルを Main が起動する場所」になる ── §19.8 で閉じた線がそこで崩れる。

そこで STEP 6 は、境界を**欄の有無**ではなく**欄の性格**で引く。

| 性格                                   | 例                                                 | どちら側 |
| -------------------------------------- | -------------------------------------------------- | -------- |
| **プログラムが何をするか**を変えるもの | 対象のファイル、プログラムへの引数、入口で止めるか | Renderer |
| **何のプログラムが動くか**を変えるもの | 実行ファイル、interpreter、adapter、cwd、探索パス  | Main     |

この1行が STEP 6 の Security boundary そのものになる。以下はすべてこの線の言い換えにあたる。

### 20.2 責務の分け方

```
Renderer                         Main
────────                         ────
Debug Profile を作る / 選ぶ
  （アプリの言葉だけ）
      │
      │ debug:start { profileId }        ← 送るのは id 1つ
      ▼
                                 profileStore      profileId → DebugProfile
                                 profileResolver   Profile → ResolvedLaunchConfiguration
                                     ├ 言語 → adapter の決定
                                     ├ adapter の実行ファイルを PATH から解決（絶対パス）
                                     ├ program の workspace-relative → 絶対パス
                                     ├ cwd = 現在の Workspace root
                                     ├ 環境の組み立て（表から）
                                     └ DAP launch request への変換
                                 adapterCatalog    何を、どの引数で起動するか（表）
                                 adapterProcess    起動 / 停止 / 片付け
                                 dapConnection     Content-Length フレーミング
                                 debugSession      状態機械（initialize → … → running）
      ▲
      │ debug:state-changed / stopped / output / breakpoints-changed（§3.3 の経路）
      │
   画面を描く
```

**Renderer はこの変換を1段も知らない。** `debug:start` に載るのは `profileId` だけで、そこから先に何が起きるかは Main の中で閉じる。

### 20.3 Debug Profile（Renderer が扱える唯一の形）

`shared/debug/profile.ts` に置く。**Renderer が読むのも書くのもこの型だけ**になる。

| 欄                    | 型                                | 誰が決めるか    | なぜ渡してよいか                                                                |
| --------------------- | --------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `profileId`           | `string`                          | **Main が発番** | Renderer が任意の id を書けると、保存領域の任意の位置を指せる形に近づく         |
| `name`                | `string`                          | Renderer        | 画面に出す名前。実行に一切関与しない                                            |
| `language`            | `'node' \| 'python' \| 'csharp'`  | Renderer        | **閉じた集合**。ここから adapter が決まる（§20.7）。`LanguageServerId` と同じ形 |
| `programRelativePath` | `string`                          | Renderer        | **Workspace 相対のみ**。検証は Files と同じ2段（§20.9）                         |
| `programArgs`         | `readonly string[]`               | Renderer        | **プログラムへの**引数。shell を通さないので語の分割も展開も起きない（§20.4）   |
| `env`                 | `Readonly<Record<string,string>>` | Renderer        | プログラムの振る舞いを変えるもの。ただし名前に制限がある（§20.9）               |
| `stopOnEntry`         | `boolean`                         | Renderer        | 入口で止めるか。何が動くかを変えない                                            |

**この7つで確定とする。** 利用者が候補として挙げた `console policy` は**入れない**（§20.9 の `runInTerminal` の判断と対になる）。

Renderer から欄そのものを作らないもの:

| 作らない欄                           | 理由                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `cwd`                                | v1 は**常に Workspace root**。欄を作れば「Renderer が指定した場所で起動する」になる   |
| `runtime` / `interpreter` / `python` | 実行ファイルの指定そのもの。PATH から解決するのは Main（§19.2 と同じ規則）            |
| `adapter*`                           | §20.4                                                                                 |
| `console`                            | 出力先は Debug Console 固定。`integratedTerminal` は `runInTerminal` を開くことになる |
| `preLaunchTask` / `postDebugTask`    | 「デバッグの前に別のものを走らせる」は、任意コマンド実行の別名にほかならない          |
| 絶対パス / file URI                  | §19.8 と同じ。組み立てるのも解くのも Main の中だけ                                    |
| `attach` 系（processId / port）      | v1 は **launch のみ**。動いているプロセスに繋ぐ形は STEP 6 の範囲外                   |
| 任意の DAP request 名                | 口は機能ごとに分かれている（§20.9）。method 名を渡す口を作らない                      |

`DebugProfileDraft` は `profileId` を持たない同じ形とし、作成 / 更新の要求はこれで受ける。

### 20.4 program args と adapter args は、別のもの

**ここを混ぜると境界が消える。** 名前が似ているだけで、行き先も持ち主も違う。

|                | program arguments                              | adapter executable / args / cwd              |
| -------------- | ---------------------------------------------- | -------------------------------------------- |
| 何に渡るか     | **デバッグ対象のプログラム**（利用者のコード） | **Debug Adapter のプロセス**（デバッガ本体） |
| 誰が決めるか   | 利用者（Debug Profile の欄）                   | **Main の catalog だけ**                     |
| 経路           | Profile → `launch` request の `args`           | `spawn()` の引数そのもの                     |
| 変えられるもの | プログラムの振る舞い                           | **何のプログラムが動くか**                   |
| Renderer の欄  | ある（`programArgs`）                          | **無い**                                     |

利用者の挙げた区別は**そのまま採用する**。理由は §20.1 の1行に還元できる ── `programArgs` をいくら変えても動くのは同じ debugpy と同じ `main.py` であり、`adapterArgs` を1語変えれば動くものが変わる。

補強として2つ:

- `programArgs` は**shell を通さない**。`spawn` の引数配列としてそのまま渡るので、`&&` も `|` も `%VAR%` も語として扱われる（§13.2 で Terminal が、§14.2 で git が採った形と同じ）
- `programArgs` は `launch` request の中に入る。**adapter のコマンドラインには一語も現れない**

### 20.5 Profile の保存

| 決めたこと            | 内容                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------- |
| 持ち主                | **Main**。Renderer はファイルにも保存先にも触れない（§5 の方針どおり）                        |
| 保存先                | `userData` 配下の `debug-profiles.json` 1つ                                                   |
| 単位                  | **Workspace ごと**。ファイルの中を Workspace の絶対パス（realpath で正規化）で引く            |
| Renderer が渡せる key | **無い**。`debug:list-profiles` の要求は `void` で、返るのは常に**現在の Workspace の分だけ** |
| 保存形式のバージョン  | レイアウト（§7.8）と同じく版を持ち、読めなければその Workspace の profile は空で起動          |

**Workspace の中（`.vscode/` や `.fluvix/`）には置かない。** 置いた瞬間、リポジトリを clone しただけで「このプロジェクトではこれが起動する」が手元に入ってくる。§19.2 が「Workspace の中は探さない」で閉じたのと同じ穴になる。

Workspace の絶対パスが key として保存ファイルに載るが、**この key が Renderer へ出ることは無い**（応答は profile の配列だけ）。

### 20.6 解決済みの形は、Main の中だけにある

型を2つに分け、**置き場所で分離を担保する**。

| 型                            | 置き場所                       | 中身                                                           | IPC に載るか |
| ----------------------------- | ------------------------------ | -------------------------------------------------------------- | ------------ |
| `DebugProfile`                | `shared/debug/profile.ts`      | §20.3 の7欄だけ                                                | **載る**     |
| `ResolvedLaunchConfiguration` | `main/debug/resolvedLaunch.ts` | adapter の絶対パス・adapter args・cwd・env・program の絶対パス | **載らない** |

`shared/` は Node 側と DOM 側の両方でコンパイルされる層で、「純粋な型と定数だけ」という制約が既にある（DEVELOPMENT.md §3）。**解決済みの形を `shared/` に置かない**というルールは、その制約の延長に置く ── `shared/debug/` に `executable` や絶対パスを表す欄が現れたら、それは設計に戻る合図になる。

`profileResolver` は `DebugProfile` を受け取り `ResolvedLaunchConfiguration` を返す純粋な関数として書く（Electron / fs 非依存・テスト対象）。§14.1 の `gitExecutable.ts`・§13.2 の `shellCommand.ts` と同じ置き方で、**STEP 6 で最もテストが効く場所**にあたる。

### 20.7 Adapter catalog（Main が持つ表）

`main/debug/adapterCatalog.ts`。守ることは `languageServerCatalog.ts`（§19.2）と**同一**とする。

- 実行ファイルは **PATH から解決した絶対パス**で起動する。名前だけで起動しない
- **Workspace の中は探さない**
- Windows の `.cmd` は `cmd.exe /c <絶対パス>` で包み、その `cmd.exe` も `%SystemRoot%` から組み立てる
- adapter の引数は**表の側**が持つ

Session 6-1 では catalog の基盤だけを置き、`node` / `python` / `csharp` の固定行を `not-integrated` として持つ。`debugpy` / `vscode-js-debug` / `netcoredbg` の実 adapter 統合は後続 Session で行う。Renderer から任意 adapter、実行ファイル、引数、cwd を指定する口は作っていない。

繋ぐ相手（**入手経路と stdio 対応は Session 6-1 で実機確認する**）:

| 言語    | Debug Adapter 候補                       | 入手経路              | 6-1 で確かめること            |
| ------- | ---------------------------------------- | --------------------- | ----------------------------- |
| Node.js | vscode-js-debug の DAP server            | 未確定（同梱しない）  | **stdio か TCP か**・入手経路 |
| Python  | `debugpy`（`python -m debugpy.adapter`） | `pip install debugpy` | 起動と `initialize` の往復    |
| C#      | `netcoredbg --interpreter=vscode`        | 配布バイナリ          | 同上。**vsdbg は使わない**    |

**vsdbg（Visual Studio の debugger）はライセンス上 Visual Studio / VS Code 以外から使えない。** C# は netcoredbg を前提とし、入手できない PC では「未インストール」に留める（LSP の csharp-ls と同じ扱い。§19.6 の状態表がそのまま使える）。

この PC の現状: **Node のみ利用可能**（Python / .NET SDK は未導入。STEP 5 Closing 時点と同じ）。Python / C# の実機確認は STEP 5 と同じく一時ディレクトリ + 起動する Electron の `env` にだけ PATH を足す形で行う（DEVELOPMENT.md §4）。

#### framing と transport を分ける

DAP のフレーミングは LSP と同じ `Content-Length` ヘッダ + JSON 本体で、違うのは中身（`seq` / `type: request | response | event`）だけになる。一方で**繋ぎ先は adapter によって stdio とは限らず、TCP のこともある**（Node の候補がまさにそれ）。

そこで 6-1 は3つに割る。

```
main/debug/dapMessage.ts      1本のメッセージの読み書き（純粋・テスト対象）
main/debug/dapConnection.ts   duplex stream の上の DAP（stdio か socket かを知らない）
main/debug/adapterProcess.ts  起動 / 停止 / どの stream を繋ぐか
main/debug/adapterCatalog.ts  Main 内部の固定 adapter catalog
main/debug/debugSessionState.ts    idle / starting / running / stopped / terminating の許可遷移
main/debug/debugSessionManager.ts  current session / generation / lifecycle cleanup の正本
main/debug/executionControl.ts     実行制御の許可 / 拒否と DAP への翻訳、Stop の段（Session 6-4）
```

`jsonRpcConnection.ts`（§19.2）が子プロセスの stdio に直接結びついているのに対し、**`dapConnection.ts` は stream を受け取る形にする**。TCP の adapter が来たときに層を作り直さずに済む唯一の分け方になる。

### 20.8 launch lifecycle

責務の順序は次で確定とする。

```
DebugProfile
  → profileResolver        （Main。§20.6）
  → adapterCatalog         （Main。§20.7）
  → adapter process start
  → initialize             request  → 応答で capability を読む（§19.4 と同じ考え方）
  → launch                 request  （応答はまだ待たない）
  → initialized            event    ← ここが合図
  → setBreakpoints         request  （§20.3 の相対パスを絶対パスへ変換して渡す）
  → configurationDone      request  （adapter が名乗っている場合のみ）
  → running
```

実装で必ず守ること:

- **`launch` の応答を「開始した」の合図にしない。** 多くの adapter は `configurationDone` の後に `launch` の応答を返す。状態機械を進めるのは **event**（`initialized` / `stopped` / `continued` / `terminated` / `exited`）であって、応答の到着順ではない
- **`configurationDone` は capability を見てから送る。** `supportsConfigurationDoneRequest` を名乗らない adapter に送ると `Unhandled method` が返る（§19.4 で Pyright の整形に対して採ったのと同じ判断）
- **`terminated` と `exited` は別の event。** 前者はデバッグセッションの終わり、後者はデバッグ対象プロセスの終わり。片方だけで片付けると orphan process が残る
- **Workspace が変わったとき・ウィンドウを閉じるときは、必ずセッションを終わらせる。** §19.2 と §13 で orphan process を残さないと決めてある

Renderer が知るのは `DebugSessionState`（`idle` / `starting` / `running` / `stopped` / `terminating`）だけで、上の10段は1つも見えない。

Session 6-2 の実装では、この lifecycle を Main 内部の `debugSessionManager.ts` が所有する。v1 の同時 Debug Session は1本だけで、2本目の start は `already-running` として拒否する。開始時には generation と sessionId を発行し、adapter から遅れて届いた event / error / close は現在の generation と一致する場合だけ扱う。これにより、古い session の callback が新しい session の状態を壊さない。

`launch` request は送るが、その応答で `running` へ進めない。`initialized` event を受け、`supportsConfigurationDoneRequest` を名乗る adapter にだけ `configurationDone` を送り、その応答後に `starting → running` とする。Breakpoint は Session 6-3 の範囲なので、Session 6-2 では実際の breakpoint 情報はまだ持たない。

stop / dispose / Workspace switch / app quit / start timeout / adapter error / adapter exit は、同じ冪等 cleanup path に入る。cleanup では `disconnect` を送れる場合だけ送り、DAP connection を dispose して pending request を `closed` にし、adapter process を kill してから `terminating → idle` に戻す。

**利用者の Stop はこの経路を使わない**（Session 6-4）。この経路は「その場で終わらせる」ためのもので、`disconnect` を書いた直後に kill する ── adapter が debuggee を終わらせる暇が無い。Stop は `terminate` → `disconnect` → kill の段を踏む別の経路を通り、最後にこの cleanup へ合流する（§20.13）。

#### セッションをまたいだ handle を通さない

`threadId` / `frameId` / `variablesReference` は adapter が配る不透明な数で、Renderer はそれを持ち回る。**Main は現在のセッションが配った handle だけを通す**（セッションごとに世代を持ち、前のセッションの handle は断る）。LSP が版（`version`）で古い要求を `stale` として断ったのと同じ仕組みを、単位をセッションに変えて置く（§19.3）。

### 20.9 Security boundary

§19.8 の表をそのまま引き継ぎ、DAP 固有の3行を足す。

| 渡さないもの                         | どう閉じているか                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| 絶対パス                             | Profile も応答も **workspace-relative path** だけ。変換は Main の中             |
| file URI                             | 組み立てるのも解くのも Main の中だけ                                            |
| adapter の実行ファイル / 引数 / cwd  | catalog が持つ。Profile にも IPC にも欄が無い（§20.4）                          |
| interpreter / runtime の実行ファイル | PATH から Main が解決する。Profile に欄が無い                                   |
| 任意の DAP request 名                | 口は機能ごとに分かれている。method 名を渡す口が無い                             |
| 任意の adapter 選択                  | 行き先は `language`（3つの閉じた集合）だけで決まる                              |
| 任意の Workspace の profile          | `debug:list-profiles` の要求は `void`。key を渡す口が無い（§20.5）              |
| **`runInTerminal`（逆方向要求）**    | **拒否する。** `initialize` で `supportsRunInTerminalRequest: false` を名乗る   |
| **Workspace 外の program**           | `programRelativePath` を Files と同じ2段（パス文字列 → realpath）で検証して断る |
| **実行を差し替える環境変数**         | 下記                                                                            |

#### `runInTerminal` を拒否する

`runInTerminal` は、**adapter が client に「このコマンドラインを実行してくれ」と頼む**逆方向の要求になる。受ければ、Main が起動するプロセスの argv を adapter が決める経路が開く ── §19.8 で `client/registerCapability` を拒否したのと同じ性格の穴にほかならない。

**代償は記録しておく。** 拒否すると、デバッグ対象は本物の端末を持たない。標準入力を待つプログラム・端末の色や大きさを見るプログラムは、Debug Console の中では同じようには動かない。§19.10（`pyright-no-file-watching`）と同じく、**選択の裏返しとして受け入れる制約**であり、不具合ではない。

#### 環境変数

`env` は Profile の欄として**持つ**。ただし**名前に制限を置く**。

- 名前は `^[A-Za-z_][A-Za-z0-9_]*$` に一致すること
- 値は文字列。Main は展開も置換も行わない（`${...}` のような変数展開の仕組みを作らない）
- **「何が読み込まれるか」を変える名前は断る**: `PATH` / `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE` / `PYTHONSTARTUP` / `PYTHONHOME` / `PYTHONPATH` / `DOTNET_STARTUP_HOOKS` / `LD_PRELOAD` / `LD_LIBRARY_PATH` / `DYLD_INSERT_LIBRARIES`
- 断る場所は**保存時と解決時の両方**（`main/debug/environmentPolicy.ts`。純粋・テスト対象）

**ここは唯一「欄を作らない」ではなく「形を検査する」を選んだ場所になる。** この設計の既定は「弾くのではなく欄を作らない」だが（§14.2）、`env` を丸ごと落とすとデバッグが道具として成立しない。欄を残す以上、**通してよい形を決める関数を対にして置く** ── `gitPathspec.ts`（§14.10）が pathspec に対して採ったのと同じ形にする。

上の名前は「プログラムの振る舞いを変える」ものではなく「**プログラムより先に何かを読み込ませる**」ものであり、§20.1 の線の向こう側にあたる。

#### 例外: Debug Console の出力は加工しない

adapter の `output` event が運ぶのは**デバッグ対象プログラム自身の出力**で、絶対パスを含むスタックトレースが普通に流れる。**これはそのまま Renderer へ渡す。**

境界に反しない理由は、この節が守っているものが「Renderer が**何を起こせるか**」であって「Renderer が**何を目にするか**」ではないため。文字列として画面に出るだけのものに、Renderer が起動できる経路は付いていない。逆に加工すれば、利用者にとって最も必要な情報が読めなくなる。

#### 切る口の一覧（STEP 6 の予定。増やすときは設計へ戻る）

```
要求(18): listProfiles createProfile updateProfile deleteProfile
          start stop continue pause stepOver stepInto stepOut
          listBreakpoints toggleBreakpoint
          getState getStack getScopes getVariables evaluate
購読(4):  onStateChanged onStopped onOutput onBreakpointsChanged
```

Session 6-0 の予定では breakpoint の口は `setBreakpoints` 1つだったが、**Session 6-3 で
2つに分けた**（17 → 18）。理由は §20.12。要点だけ言うと、**一覧を丸ごと渡す口を
作らない**ためで、`setBreakpoints` という名前も DAP の request 名と1対1に見えるので使わない。

Session 6-4 で `continue` / `pause` / `stepOver` / `stepInto` / `stepOut` / `stop` の6つが入った（チャンネルは `debug:continue` / `debug:pause` / `debug:step-over` / `debug:step-into` / `debug:step-out` / `debug:stop`）。**どれも要求が `void`** で、予定の数（18）は動いていない。`getState` / `onStateChanged` はまだ無い ── 状態を画面に出すのは Debug パネル（Session 6-8）で、それまでは制御の応答に載る `state` だけが Renderer に届く。

**プロセスを操作する口は1つも無い**（§19.2 と同じ）。`start` に載るのは `profileId` だけで、`stop` は `void` になる。

### 20.10 言語別の違いをどう持つか

`DebugProfile` は **`language` を判別子とする discriminated union の形を最初から持つ**。ただし **v1 では枝ごとの固有欄をゼロにする**。

```
共通の7欄（§20.3） + language による判別
  ↓
v1: node / python / csharp のどの枝も固有欄を持たない
将来: 実際に必要になった言語の枝にだけ欄が生える
```

こうする理由は2つ。

- **`language` はどのみち必要**（adapter を決めるのは これ1つ）。判別子として使える欄が既にあるのに、後から union へ作り替えると Renderer 側の分岐がすべて動く
- **共通 + 自由な入れ物（`Record<string, unknown>` や `languageOptions`）にはしない。** 何でも入る欄を1つ作れば、そこが `launch.json` の作り直しになる ── 通ってはいけない値の一覧をそこに書き続けることになり、§20.9 の表が意味を失う

言語を1つ足す作業は、**union に枝を1本・catalog に行を1行**で閉じる。言語ごとの `launch` request の組み立ての違いは `profileResolver` の中にあり、Renderer には現れない。

### 20.11 STEP 6 で入れないもの

| 項目                                | 判断                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `.vscode/launch.json` の読み込み    | **読まない。** Workspace の中のファイルが実行対象を決める形にしない（§20.5）                                                   |
| attach（動いているプロセスへ接続）  | 入れない。launch のみ                                                                                                          |
| `runInTerminal` / 統合端末での実行  | 入れない（§20.9）                                                                                                              |
| conditional / hit count breakpoint  | 入れない。行の breakpoint だけ                                                                                                 |
| logpoint                            | 入れない                                                                                                                       |
| Data / Function breakpoint          | 入れない                                                                                                                       |
| 変数の値の書き換え（`setVariable`） | 入れない。v1 は見るだけ                                                                                                        |
| Watch 式の永続化                    | 入れない。評価は Debug Console から                                                                                            |
| ~~breakpoint の永続化~~             | **Session 6-3 で入れた。**予告どおり §20.5 と同じ形（userData の JSON 1つを Workspace の絶対パスで引く）に載せてある（§20.12） |
| 複数セッションの同時実行            | 入れない。**同時に走るのは1本**                                                                                                |
| 子プロセスへの追従                  | 入れない                                                                                                                       |
| `cwd` の指定                        | 入れない。常に Workspace root（§20.3）                                                                                         |
| 変数展開（`${workspaceFolder}` 等） | 入れない。展開の仕組みは、書ける文字列が増える仕組みにほかならない                                                             |
| Problems panel との連携             | 入れない。診断は STEP 5 のまま（§19.11）                                                                                       |

### 20.12 Breakpoint（Session 6-3）

STEP 6 で**最初に Renderer へ面が出た**機能になる。Session 6-1 / 6-2 は Main の中だけで閉じていたが、ここで初めて Monaco・preload・IPC・保存の4つが一度に繋がる。

v1 は **行 breakpoint だけ**（条件付き・hit count・logpoint・function・data は §20.11 のまま入れない）。

#### 責務の分け方

```
Renderer                              Main
────────                              ────
Monaco の glyph margin
  editor/debug/breakpointGlyphs.ts    印の描画と click（Monaco を import しない）
  editor/debug/breakpointDecorations.ts  見た目の決め方（クラス名と翻訳キーだけ）
  debug/BreakpointProvider.tsx        今の Workspace の写し
      │
      │ debug:toggle-breakpoint { relativePath, line }    ← 載るのはこの2つだけ
      ▼
                                      ipc/handlers/debug.ts   行と相対位置を確かめる
                                      debug/breakpoints.ts    正本・保存・通知・同期
                                        ├ breakpointModel.ts   入れ替え / 重複 / 並び / verified
                                        ├ breakpointSource.ts  相対位置 → DAP の Source（絶対パス）
                                        ├ dapBreakpoints.ts    setBreakpoints 1往復の形
                                        └ breakpointSync.ts    送信と応答の読み取り
                                      store/debugBreakpoints.ts  userData の JSON 1つ
      ▲
      │ debug:breakpoints-changed（全件）
   印を描き直す
```

**Renderer は DAP を1語も知らない。** `Source` も `setBreakpoints` も `verified` の由来も Main の中で閉じる。

#### 口は2つに分けた（`setBreakpoints` という口を作らない）

Session 6-0 の口の一覧（§20.9）では breakpoint の口を `setBreakpoints` 1つと見積もっていた。実装では **`listBreakpoints` と `toggleBreakpoint` の2つ**にしてある。

| 分けた理由                      | 内容                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **一覧を渡す口を作らない**      | 配列を丸ごと渡せる口は「Renderer が保存領域を任意に書き込む口」になる。1件ずつなら検証が必ず1件ずつ通る          |
| **DAP の request 名を使わない** | `setBreakpoints` は DAP の request 名そのもので、口の名前と一致させると「method 名を渡す口」との距離が近く見える |
| **最初の1回が要る**             | 通知は変わったときにしか流れない。画面が開いた時点の状態は要求で読む（`lsp:get-status` と同じ形）                |

応答には**入れ替えた後の全件**を載せる。通知（`debug:breakpoints-changed`）と同じ形なので、受け手の処理が1つで済む。

#### 保存（§20.5 と同じ形）

| 決めたこと            | 内容                                                          |
| --------------------- | ------------------------------------------------------------- |
| 持ち主                | **Main**。Renderer はファイルにも保存先にも触れない           |
| 保存先                | `userData` 配下の `debug-breakpoints.json` 1つ                |
| 単位                  | **Workspace ごと**。ファイルの中を Workspace の絶対パスで引く |
| Renderer が渡せる key | **無い**。`debug:list-breakpoints` の要求は `void`            |
| 保存形式のバージョン  | 版を持ち、読めなければその Workspace の breakpoint は空で起動 |
| 保存する欄            | `relativePath` / `line` / `enabled` の3つだけ                 |

**`verified` は保存しない。** あれは「今動いている adapter がどう答えたか」であって breakpoint の性質ではない ── セッションが終われば忘れ、次のセッションで訊き直す。

**Workspace の中（`.vscode/` や `.fluvix/`）には置かない。** Debug Profile と同じ理由で、clone しただけで他人の印が手元に入ってくる形にしない。

読み込んだ内容も**境界の外から来た値**として扱う。1件が壊れていてもその1件だけを落とし（設定の section と同じ扱い）、`..` や絶対パスが書かれていれば `breakpointSource.ts` がそこで断る。

#### DAP へ渡すところ

```
"src/app.js" の 12 行目
  → breakpointSource.ts   D:\proj + "src/app.js" → D:\proj\src\app.js（2段の検証）
  → dapBreakpoints.ts     { source: { path, name }, breakpoints: [{ line: 12 }], lines: [12] }
  → setBreakpoints
```

守っていること:

- **検証は Files / LSP と同じ関数**（`main/files/workspacePath.ts`）。別の検証を書き起こさない
- **realpath は取らない。** LSP の URI と同じ理由で、この境界が守るのは「Renderer から任意の場所を指せないこと」にほかならない。加えて breakpoint は**まだ保存していない / 一時的に消えているファイル**にも置ける必要がある
- **ファイルごとに1通。** `setBreakpoints` はそのファイルの全件を毎回送る（差分ではない）。最後の1件を外したときは**空の配列**を送る
- **`lines` も併せて送る。** 古い adapter が `lines` しか読まないことがあり、DAP の仕様書自身が両方送ってよいとしている
- **`sourceModified` は常に false。** true にすると adapter によっては一切 verify せず、未保存のファイルで印がすべて灰色になる

#### lifecycle への差し込み

```
initialize → launch → initialized event → [ setBreakpoints ] → configurationDone → running
                                            ↑ Session 6-3 が足したのはここ1点
```

`debugSessionManager` に**仕込み（`configurationHook`）を1つ**足した。守ったこと:

- **`launch` の応答を開始の合図にしない**（§20.8）は動いていない
- **仕込みが登録されていなければ `await` を踏まない。** 踏むと `configurationDone` が1 tick 遅れ、6-3 の有無で 6-2 の lifecycle が変わってしまう
- **仕込みが失敗しても Debug Session は続く。** 印が付かないことと、走らせられないことは別のことにほかならない
- 送る口は `setBreakpoints` **1つに絞ってある**。`request(command, args)` の形にすると、Main の中に任意の DAP method を送れる場所ができる ── Renderer からは届かないが、「口は機能ごとに分かれている」は Main の内側でも保つ

セッション中の変更は `getBreakpointChannel()` から送り直す。**`running` / `stopped` のときだけ**口が返るので、起動中の同期（仕込み）と割り込まない。

応答は**世代と状態を対で見て**当てる。世代だけでは「終わった後に新しいセッションがまだ始まっていない」を、状態だけでは「新しいセッションが同じ `running` に居る」を区別できない。

#### verified / unverified

| 値      | 意味                                    | 見た目         |
| ------- | --------------------------------------- | -------------- |
| `null`  | Debug Session が無い / まだ答えが来ない | 赤い丸         |
| `true`  | adapter が「そこで止められる」と答えた  | 赤い丸         |
| `false` | adapter が「置けない」と答えた          | 中を抜いた輪郭 |

**`null` を「置けない」と同じ見た目にしない。** 走らせる前はいつも `null` で、そこを失敗の色にすると始める前から間違っているように見える。

色は `theme.css` の3変数（`--fx-debug-breakpoint*`）から引き、Dark / Light それぞれで設計した値を持つ。**Renderer 側のコードに16進数は1つも無い**（Session 4-4 の形をそのまま守る）。**色だけに意味を持たせていない** ── どの状態かは hover の説明が言葉で伝える（Git の変更種別で記号を主にしてあるのと同じ）。

Renderer へ返さないものが2つある。

| 返さないもの         | 理由                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adapter の `message` | adapter が組み立てた文字列で**絶対パスを含みうる**。§20.9 の例外（Debug Console の出力）は利用者のプログラムの出力に限った話で、adapter の内部事情はそちら側に置かない |
| adapter が動かした行 | 印の位置を動かすと**利用者が押した行と印の行がずれ**、もう一度押しても外せなくなる。ずれたことは Main のログに残す                                                     |

#### Monaco 側で守ったこと

- **`MonacoEditor.tsx` への追加は最小**（Session 6-0 の申し送り）。増えたのは器を state に載せる行と、フックを呼ぶ1行だけで、LSP の provider 登録にも decoration にも触れていない
- **フックを呼ぶ位置は一番下。** React は宣言順に effect を走らせるため、上に置くと「印を当てる → Model を差し替える」の順になり、当てた decoration が差し替えで捨てられる（decoration は Model に紐づく）。位置を見せる effect を Model の後に置いてあるのと同じ理由になる
- **Monaco の実体を import する場所を増やしていない。** 判断は `editor/debug/breakpointGlyphs.ts` に置き、Monaco は構造的部分型で受ける（`editor/lsp/editorActions.ts` と同じ形）── 副産物として、glyph margin の click も decoration の増減もファイル切替も**素のテストから試せる**
- **差分エディタ（Compare）には glyph margin を出さない。** 読むためだけの面で、印を置く相手が居ない

#### 既知の制約: 印は編集に付いて回らない

正本は Main の側で、行番号は**利用者が印を置いた行**のまま動かない。一方 Monaco の decoration は編集に合わせて自分で動くため、上に行を挿入すると画面の印だけがずれる。ずれたまま押すと**別の行に2つ目の印が付き、元の印は外せない**。

そこで、**行数が変わる編集のたびに保存された行へ置き直す**。行の挿入に印が付いて回る挙動（VS Code はこちら）は v1 では入れない ── 付いて回らせるには編集のたびに正本を書き換える経路が要り、それは印の同期を Renderer 側の編集イベントに依存させることになる。§19.10（`pyright-no-file-watching`）と同じく、**選択の裏返しとして受け入れる制約**であり不具合ではない。

### 20.13 Execution Control（Session 6-4）

Main が持つ Debug Session に、Continue / Pause / Step Over / Step Into / Step Out / Stop を足した。Renderer 側の面（ボタン・キー）はまだ無く、入ったのは **typed IPC の6つと、その裏の判断**だけになる（ボタンは Debug Toolbar の Session 6-8、キーは 6-12）。

#### 責務の分け方

```
Renderer                         Main
────────                         ────
window.fluvix.debug.stepOver()
      │
      │ debug:step-over（要求は void）  ← 載るものが1つも無い
      ▼
                                 ipc/handlers/debug.ts        チャンネル → 制御の名前（閉じた表）
                                 debug/debugSessionManager.ts control('stepOver')
                                   ├ executionControl.ts       状態で許可 / 拒否
                                   ├ スレッドの決定             止まったスレッド / threads の最初
                                   ├ executionControl.ts       stepOver → next { threadId }
                                   └ 応答を状態へ当てる         stopped → running
      ▲
      │ DebugControlOutcome { status, reason?, state }
```

**Renderer は DAP を1語も知らない。** `next` / `stepIn` への翻訳も、`threadId` の選び方も Main の中で閉じる。

#### 口は操作ごとに分けた

`debug:control { action: 'stepOver' }` のような1本の口にしなかった。欄の値が DAP の request 名と1対1に並ぶと「method 名を渡す口」との距離が縮む（§20.12 で `setBreakpoints` という名前を避けたのと同じ理由）。**要求はどれも `void`** で、何かが載って届いても Main はそれを読まない ── 制御の名前はチャンネルが決め、`threadId` は Main が決める。

#### 状態ごとの許可 / 拒否

| 状態        | Continue / Step Over / Into / Out | Pause           | Stop                           |
| ----------- | --------------------------------- | --------------- | ------------------------------ |
| idle        | `no-session`                      | `no-session`    | `no-session`                   |
| starting    | `invalid-state`                   | `invalid-state` | **通す**（`disconnect`）       |
| running     | `invalid-state`                   | **通す**        | **通す**                       |
| stopped     | **通す**                          | `invalid-state` | **通す**                       |
| terminating | `invalid-state`                   | `invalid-state` | **通す**（2回目の Stop。下記） |

- **starting で Continue / Step を通さない。** `configurationDone` を送り終える前に進めると、breakpoint の仕込み（§20.12）を追い越してプログラムが走り出しうる
- **starting で Stop を通す。** 起動が固まったとき（adapter が `initialized` を送らない）に、start timeout（60秒）まで待たせないため
- **断ったものは adapter へ何も送らない。** 断りは値として返し、IPC の失敗にはしない（Git の §14.7 と同じ）
- **同時に待つ制御は1つだけ**（`busy`）。Step Over の連打で2通目が1通目の進めた先で意味を持つかは分からない。Stop はこの制限を受けない

#### スレッドは Main が決める

DAP の `continue` / `next` / `stepIn` / `stepOut` / `pause` は `threadId` を必須とする。v1 は Renderer から受け取らず、

- Continue / Step … **最後の `stopped` event が名指したスレッド**
- Pause と、`stopped` が `threadId` を省いていた場合 … **`threads` 応答の最初のスレッド**

とする。どのスレッドを動かすかを利用者が選ぶのは Call Stack（Session 6-5）で、そのとき受け取る handle も §20.8 の世代で守る。`singleThread` / `granularity` / `targetId` は送らない（どれも capability を要し、画面に選ぶ手段が無い）。

#### 応答を状態へ当てる

| 制御            | 状態の動き                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Continue / Step | **応答で** stopped → running。DAP は `continue` などの応答に対して `continued` event を送らなくてよいと定めている |
| Step の終わり   | `stopped`（reason `step`）event で running → stopped                                                              |
| Pause           | 応答では動かさない。`stopped`（reason `pause`）event で running → stopped                                         |

**応答より先に次の `stopped` が届いたら、running へ戻さない。** DAP は「応答 → `stopped`」の順を定めているが、すぐ終わる Step では前後しうる。`stopped` を受けた回数（`stopEpoch`）を送信時と応答時で比べ、進んでいれば当てない ── 当てると、止まっているのに走っていることになる。`continued` が先に届いた場合も、もう stopped でないので当てない。

**前のセッションの応答は当てない。** 世代と「Stop を頼まれていない」を対で見る（§20.8 と同じ考え方）。答えを待っている間にセッションが入れ替わった制御は `session-ended` になる。

adapter の失敗の文言は Renderer へ返さない（`adapter-rejected` という分類だけ）。§20.12 の breakpoint と同じく、adapter が組み立てた文字列は絶対パスを含みうる。

制御の答えは10秒で `timeout` として返し、次の操作を受け付ける。**遅れて届いた答えは捨てずに当てる** ── 待つのをやめたのは Renderer への返事だけで、状態は adapter の事実に合わせるべきだから。

#### Stop: `terminate` と `disconnect` の使い分け

DAP の仕様書（Overview "Debug session end"）は、launch で立てた debuggee について2段の終わらせ方を定めている。

- `terminate` … debuggee に**穏やかに**終わるよう頼む（後片付けの機会を与える）。**debuggee は拒める** ── これだけではセッションは終わらない。`supportsTerminateRequest` を名乗る adapter にだけ送る
- `disconnect` … **無条件に**終わらせる。adapter は launch で立てた debuggee を終わらせてから自分も閉じる。`terminateDebuggee` は `supportTerminateDebuggee` を名乗る adapter にだけ載せる（仕様上、名乗らない adapter はこの欄を読まない）

これをそのまま段にした。

```
Stop（running / stopped）
  ├ terminate を名乗る ──→ terminate ─┬ terminated / exited ─→ disconnect
  │                                   ├ 失敗の応答 ─────────→ disconnect
  │                                   ├ 猶予 3 秒切れ ──────→ disconnect（debuggee が拒んだ）
  │                                   └ もう一度 Stop ──────→ disconnect
  └ 名乗らない ──────────────────────────────────────────────→ disconnect
Stop（starting） ────────────────────────────────────────────→ disconnect

disconnect ─┬ 応答 / adapter が自分で閉じた ─→ kill → idle
            └ 猶予 2 秒切れ ─────────────────→ kill → idle
```

守っていること:

- **両方を同時に投げない。** terminate の答えを待たずに disconnect を投げると debuggee の後片付けを打ち切ることになり、terminate を送る意味が無くなる。`terminated` を受けてから `disconnect` を送るのは、仕様どおり adapter 自身を閉じさせるため
- **Stop を押したセッションは、猶予の和（5秒）を上限に必ず idle へ戻る。** debuggee が terminate を拒み続けても、adapter が disconnect に答えなくても、最後は kill に落ちる
- **押した時点で terminating へ進める。** 以降の Continue / Step は断り、breakpoint の口（§20.12）も閉じる
- **Stop の返事は idle へ戻り終えてから。** 何度押しても同じ終わりを待ち、全員に同じ答えが返る
- **`disconnect` は1通だけ。** Stop の途中で Workspace の切り替え / アプリの終了（その場で終わらせる経路。§20.8）が走っても重ねて送らず、猶予のタイマーもそこで消える
- **Stop の途中で adapter が閉じた / 落ちたのは正常な終わり。** 「予期せず閉じた」として error に残さない
- adapter が自分から `terminated` / `exited` を送った場合（Stop を押していない）は、6-2 のまま**その場で片付ける**

#### orphan process について

終わり方はどれも最後に `adapterProcess.dispose()`（adapter の kill）へ落ちる。**debuggee を終わらせるのは adapter の仕事**で、Stop が `disconnect` の答えを待つのはそのためにある。一方、アプリの終了は `will-quit` の中で同期に片付けるため、`disconnect` を書いた直後に adapter を kill する（6-2 のまま）── debuggee が adapter の孫プロセスとして残るかどうかは adapter の作りに依存する。実 adapter（Session 6-10 / 6-11）を繋ぐときに、終了時に debuggee が残らないことを実機で確かめる。

#### 停止行は 6-5 へ送った

Session 6-0 の予定では「停止行」（止まった行を Editor に示す）も 6-4 に含めていた。**`stopped` event は位置を運ばない**ため、止まった行は `stackTrace` の最上段を読むまで分からない ── それは Call Stack（`getStack`）そのものになる。先取りを避け、6-5 へ移した。
