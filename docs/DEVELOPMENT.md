# 開発ガイド

> 対象: Session 7-2E（v1.0.0 公開）時点
> 最終更新: 2026-09-16

---

## 1. 必要な環境

- Node.js（`npm` 同梱）
- Windows 11（v1 の開発対象）

依存はすべて `npm install` で入る。Node.js / Python / .NET SDK 本体はアプリに同梱しない方針のため、LSP / Terminal は PC 側にインストールされたものを検出して使う。

### Language Server（STEP 5。任意）

**アプリの開発・テスト・ビルドには要らない。** 入っていない言語は Status Bar に「未インストール」と出るだけで、エディタは普通に使える（docs/ARCHITECTURE.md §19.1）。実際に動かして確かめたいときだけ入れる。

| 言語                    | 入れ方                                              | 実行ファイル                 |
| ----------------------- | --------------------------------------------------- | ---------------------------- |
| TypeScript / JavaScript | `npm i -g typescript-language-server typescript@6`  | `typescript-language-server` |
| Python                  | `npm i -g pyright`                                  | `pyright-langserver`         |
| C#                      | `dotnet tool install -g csharp-ls`（.NET SDK 必須） | `csharp-ls`                  |

いずれも **PATH から解決できること**が条件（csharp-ls だけは `~/.dotnet/tools` も見る）。Workspace の中は探さない。

**`typescript` は版を付けて入れる。** npm の `latest` は 7.x（7.0.2）になり、`tsserver.js` を含まない。`npm i -g typescript-language-server typescript` のままだと TypeScript 7 が入り、`Could not find a valid TypeScript installation` で `initialize` が断られる（Session 7-2D でインストール版に対して実測。`typescript@6` なら `ready`）。

**このリポジトリ自身を Workspace として開いても TypeScript のサーバは立たない。** `typescript` を 7.x（native preview）で pin しており、`node_modules/typescript/lib` に `tsserver.js` が無いため `initialize` が断られる。TS の LSP を実機で確かめるときは、`typescript@5` を入れた別の検証用フォルダを Workspace にすること（下記 §4）。

### Debug Adapter（STEP 6。任意）

Language Server と同じく**アプリの開発・テスト・ビルドには要らない**し、同梱もしない（docs/ARCHITECTURE.md §20.7）。

| 言語    | Debug Adapter                                    | 入手経路                                        | 状態                              | Closing で確かめた版         |
| ------- | ------------------------------------------------ | ----------------------------------------------- | --------------------------------- | ---------------------------- |
| Node.js | vscode-js-debug 1.117.0 の standalone DAP server | 公式 GitHub Release の asset を userData へ展開 | **Session 6-15B で `integrated`** | 1.117.0（Node v24）          |
| Python  | `debugpy`（`python -m debugpy.adapter`）         | `pip install debugpy`                           | **Session 6-12 で `integrated`**  | 1.8.21（CPython 3.14.7）     |
| C#      | `netcoredbg --interpreter=vscode`                | Samsung/netcoredbg の公式 release zip           | **Session 6-14 で `integrated`**  | 3.2.0-1092（.NET 8 runtime） |

3つとも Status Bar の既定は「待機中」になり、adapter が見つからないことは Start の応答（`adapter-unavailable`）と Debug パネルの案内で分かる（docs/ARCHITECTURE.md §20.17 / §20.18）。詳細な原因は `language` と閉じた集合の `cause` だけで Renderer へ返し、パスや実行ファイル名は返さない。Main 側の詳しい理由は `userData/logs/main.log` に残る（Session 7-1C）。

Node.js は **PATH のネイティブの `node.exe`** と、**pin した vscode-js-debug の配布物が userData の決まった場所にあること**が条件（docs/ARCHITECTURE.md §20.24）。debuggee も同じ node.exe で動く。v1 は `.js` / `.mjs` / `.cjs` の launch だけ。アプリは配布物を取りに行かないので、使うときだけ手で置く（Windows / PowerShell。`$env:APPDATA\Fluvix Nexus` はアプリの userData）:

```powershell
$version = '1.117.0'
curl.exe -L -o js-debug-dap.tar.gz "https://github.com/microsoft/vscode-js-debug/releases/download/v$version/js-debug-dap-v$version.tar.gz"
(Get-FileHash js-debug-dap.tar.gz -Algorithm SHA256).Hash   # AD8D04EDE9D4B75CC290FD5438A65047A06F786D04F604B6112485B36F090772
$dest = Join-Path $env:APPDATA "Fluvix Nexus\debug-adapters\js-debug-dap-v$version"
New-Item -ItemType Directory -Force $dest | Out-Null
tar.exe -xzf js-debug-dap.tar.gz -C $dest                   # → $dest\js-debug\src\dapDebugServer.js
```

- asset の SHA-256 が上と違えば展開しない。展開した木はアプリが起動のたびに tree hash（60 ファイル / `fdda8ebf…4933`）で確かめ、1バイトでも違えば Start は `adapter-unavailable` になる（理由は Main のログに `debug adapter artifact vscode-js-debug 1.117.0 is not usable (missing / invalid / hash-mismatch)` と出る）。画面には、置かれていないときと中身が違うときで別の案内（「配置されていません」/「公式の配布物と一致しません」）が出る（Session 7-1C。docs/ARCHITECTURE.md §20.18）
- 版を上げるときは `main/debug/adapterArtifact.ts` の表（版・URL・asset の SHA-256・tree hash・数・大きさ）を取り直す。tree hash の形はそのファイルの冒頭に書いてある
- npm で `js-debug` を入れる必要は無い。Workspace の `node_modules` の中のものは使わない

Python は **PATH の `python` で `import debugpy` できること**が条件（Workspace の中・相対の PATH 項目は探さない）。debuggee も同じ interpreter で動く。

C# は **PATH の `netcoredbg` と trusted `dotnet.exe` を解決できること**が条件（Workspace の中・相対の PATH 項目は探さない。`dotnet.exe` は `C:\Program Files\dotnet` → `C:\Program Files (x86)\dotnet` → PATH の順）。Debug Profile の `programRelativePath` には、あらかじめ build 済みの `.dll` を指定する（source と PDB が同じ Workspace にある build 成果物でないと breakpoint が pending のままになる）。Windows 版 netcoredbg（3.2.0-1092 / 3.1.3-1062）は Unicode path で `configurationDone` が 0x80004005 になるため、netcoredbg が直接触る adapter / dotnet / target DLL / Workspace cwd が ASCII-only である場合だけ C# Start を許可する。netcoredbg も ASCII-only のフォルダに置くこと（Windows / PowerShell）:

```powershell
curl.exe -L -o netcoredbg-win64.zip "https://github.com/Samsung/netcoredbg/releases/download/3.2.0-1092/netcoredbg-win64.zip"
(Get-FileHash netcoredbg-win64.zip -Algorithm SHA256).Hash   # 3C410A45FA502415203A94FCB88654AF65BF8E3DAC158A5527A722E7A6B9274A
Expand-Archive netcoredbg-win64.zip -DestinationPath C:\tools   # → C:\tools\netcoredbg\netcoredbg.exe（ASCII-only のフォルダ）
# C:\tools\netcoredbg を PATH に足す
```

- SHA-256 は GitHub の release asset の `digest` と同じ値。3.2.0-1092 の Windows x64 zip は 3,524,161 バイトで、`netcoredbg --version` は `NET Core debugger 3.2.0-1 (9744e1f, Release)` を返す
- アプリは netcoredbg を pin しない（js-debug と違って hash を確かめない）── PATH から解くだけなので、上の値は手で置くときの確認用

**vsdbg は使わない**（ライセンス上 Visual Studio / VS Code 以外から利用できない）。C# は netcoredbg を前提にする。

この PC の現状（Session 6-17 時点）は、システムに **Node.js と .NET の runtime（SDK 無し）** だけが入っていて、Python・debugpy・netcoredbg・.NET SDK は入っていない。Python / C# を実機で確かめるときは、STEP 5 の C# と同じく一時ディレクトリへ置き、起動する Electron の `env` にだけ PATH を足す（§4）。netcoredbg と C# の題材は ASCII-only の一時パス（`D:\fx617` のような場所）に置く ── 作業用ディレクトリ（`%TEMP%` の下）はユーザー名が Unicode のため使えない。

#### 現在揃っているもの（STEP 6 Closing + STEP 7-1D）

Debug パネル（View メニュー → Debug）に、上から Toolbar（Profile の選択と編集・Start / Continue / Pause / Step Over / Step Into / Step Out / Stop）・停止理由・Call Stack・Variables・Debug Console が並ぶ。ステータスバーに Debug の状態が1語で出る。adapter を1つでも置けば、次の流れが production build でそのまま通る（Session 6-17 で3言語とも実測。§4）。

| 操作                          | 入口                                                                                                  | 詳細                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Debug Profile の作成 / 編集   | Debug パネルの Profile editor（名前・言語・Workspace 相対の program・引数・環境変数・入口で止めるか） | docs/ARCHITECTURE.md §20.18 / §20.19 |
| Breakpoint                    | Editor の glyph margin の click / **F9**（Editor に focus）                                           | §20.12 / §20.26                      |
| Start / Continue              | Toolbar / **F5**（状態で切り替わる。command の所有者は `DebugProvider`）                              | §20.13 / §20.26 / §20.28             |
| Step Over / Into / Out / Stop | Toolbar / **F10** / **F11** / **Shift+F11** / **Shift+F5**（所有者は `DebugProvider`）                | §20.13 / §20.26 / §20.28             |
| Pause                         | Toolbar（打鍵は無い）                                                                                 | §20.13                               |
| Call Stack / 実行位置         | 止まると Editor が最上段の行を開き、印を出す。frame を押すと Variables がその frame を読む            | §20.14 / §20.21                      |
| Variables / Evaluate          | Variables の tree / Debug Console の入力欄                                                            | §20.15 / §20.16 / §20.25             |
| 例外で止まる                  | 捕まえられなかった例外（言語ごとの固定の表）                                                          | §20.21                               |

- 保存先は userData の `debug-profiles.json` / `debug-breakpoints.json`（Workspace の絶対パスで引く）。Node の js-debug 配布物は userData の `debug-adapters/` に利用者が置く。Main のログは `userData/logs/main.log` に出る。**Workspace の中には何も書かない**
- **F5 / Shift+F5 / F10 / F11 / Shift+F11 は Debug パネルの mount / unmount に依存しない**（Session 7-1A）。`DebugProvider` が Profile 選択と実行 command を持ち、Toolbar と同じ判定で登録する。F9 は Editor の器が持つので従来どおり Editor focus が条件になる
- Debug Session は同時に1本。Workspace を切り替える・アプリを閉じると、動いているセッションは終わり adapter と debuggee のプロセスも消える

Session ごとの経緯（何をどの順に入れたか）は DESIGN.md §13 / §14、構造は docs/ARCHITECTURE.md §20 にある。STEP 6 Closing 時点の既知の制約は DESIGN.md §13 と docs/ARCHITECTURE.md §20.27、現在残っている制約は DESIGN.md §14 と docs/ARCHITECTURE.md §20.28 を正とする。

Session 6-15B で **Node.js（vscode-js-debug 1.117.0）が3つ目の実 adapter** になった（docs/ARCHITECTURE.md §20.24）。PATH の `node.exe` で、userData に置いた pin 済みの `dapDebugServer.js` を socket の server として立て、root に届く `startDebugging` で primary child を張る。launch は Main が組み（`runtimeExecutable` は同じ node.exe・`sourceMaps: false`・`autoAttachChildProcesses: false`・`outputCapture: 'std'`）、`.js` / `.mjs` / `.cjs` 以外は `invalid-profile`。配布物が無い / 改変されている・node が PATH に無い（または Workspace の中にある）なら `adapter-unavailable`。条件を満たせば Profile → Start → breakpoint → Continue / Pause / Step → Call Stack / Variables / Evaluate / Debug Console → 未処理例外で停止 → Stop / 完走が実機で通る。

---

## 2. コマンド

| コマンド                | 内容                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`           | 開発起動（Vite dev server + Electron、HMR あり）                                          |
| `npm run build`         | `out/` へビルド                                                                           |
| `npm run dist`          | `build` の後に `release/` へ Windows installer を作る（公開しない。docs/RELEASE.md §5.5） |
| `npm run typecheck`     | 型検査（Main/Preload/shared と Renderer/shared を別々に）                                 |
| `npm test`              | ユニットテスト（1回実行）                                                                 |
| `npm run test:watch`    | ユニットテスト（監視）                                                                    |
| `npm run format`        | Prettier で整形                                                                           |
| `npm run format:check`  | 整形漏れの検査                                                                            |
| `npm run notices`       | `THIRD_PARTY_NOTICES.txt` を作り直す（docs/RELEASE.md §4）                                |
| `npm run notices:check` | `THIRD_PARTY_NOTICES.txt` が今の依存と一致するかの検査                                    |
| `npm run verify`        | `format:check` → `typecheck` → `notices:check` → `test` をまとめて実行                    |

依存を足す / 版を上げる / Renderer や Main で新しいパッケージを import したときは `npm run notices` を実行して、`THIRD_PARTY_NOTICES.txt` も一緒に commit する（しないと `verify` が落ちる）。

作業の区切りでは `npm run verify` と `npm run build` の両方を通すこと。

---

## 3. 品質基盤の方針

### 型検査

`tsconfig.node.json`（Main / Preload / shared）と `tsconfig.web.json`（Renderer / shared）に分かれている。shared 層が Node 側と DOM 側の両方でコンパイルされるため、shared に `NodeJS.*` や DOM の型を持ち込むとここで失敗する。この分離が「shared は純粋な型と定数だけ」というルールの担保になっている。

### テスト

Vitest を使い、**Electron に依存しない純粋なロジック**だけを対象にする。Electron の API を使う層はモックを積んでも実装の写しにしかならないため、実際に起動して確認する（次節）。

この方針を成立させるため、判断を含むロジックは Electron 依存の薄い層から切り離す。`store/windowBounds.ts`（検証ロジック・テストあり）と `store/windowState.ts`（Electron API の利用）の分け方がその例。

現在のテスト対象:

- `src/main/store/windowBounds.test.ts` — 保存値の検証、画面外判定
- `src/main/store/workspaceLayoutDocument.test.ts` — レイアウト文書のエンベロープ検証（Main が見る範囲）
- `src/main/store/workspaceFolderDocument.test.ts` — Workspace 文書の検証（Main が中身まで見る範囲）
- `src/main/store/settingsSections.test.ts` — **設定の section / key の検証**（Main が見る範囲。意味は見ない ── 知らない mode も範囲外の数も形として通し、**1つの key が壊れても他は残ること**・知らない key を書き戻すために持つこと・**Renderer からは既知の section と既知の key しか保存できないこと**）
- `src/main/store/settingsDocument.test.ts` — **設定文書の検証**（落とす単位が文書 / section / key の段階になっていること・`schemaVersion` の4通りの区別・**新しすぎる版でも既知の設定を読み、知らない内容を書き戻すこと**・migration の入口が働くこと・1つの section を保存しても他を巻き込まないこと）
- `src/main/store/legacySettings.test.ts` — **旧3ファイルからの取り込み**（読める設定だけが移ること・1つが壊れていても他は移ること・移すものが無ければ移行と数えないこと）
- `src/main/store/settingsStore.test.ts` — **`settings.json` の読み書きと移行**（実ディスク。`settings.json` が無いときだけ旧3ファイルを読むこと・移行が一度きりで終わること・`.tmp` を残さないこと・一部が壊れていても読める section が生き残ること）
- `src/main/workspaceFolder/folderPath.test.ts` — rootPath の正規化・受け付けない値・表示名の導出
- `src/main/files/workspacePath.test.ts` — **Workspace 境界の検証**（`..` / 絶対パス / ドライブ相対 / `:` / NUL / 長さ / 前方一致 / **利用者が指した名前を変形しないこと**）
- `src/main/files/mutateWorkspaceEntry.test.ts` — **作成 / 改名 / 削除**（実在するものを操作できるか・境界・ジャンクション。下記のとおりここだけ実ディスクを使う）
- `src/main/files/deleteObstacle.test.ts` — **ごみ箱へ送れなかった理由の判定**（errno の読み替え・フォルダの中まで探す・`EBUSY` を `EPERM` より優先する・リンクを開かない・探す量の上限）
- `src/main/files/watchPaths.test.ts` — **監視から来たパスの扱い**（相対位置への変換・境界の外・除外・配下の畳み込み）
- `src/main/files/searchWorkspaceFiles.test.ts` — **Workspace 全体の走査とファイル名検索**（部分一致 / 大小の無視・深さと件数と走査数と時間の上限・除外フォルダ・**リンクの中へ潜らないこと**・取り消し。実ディスクを使う）
- `src/main/files/workspaceSearchSession.test.ts` — **今走っている検索1本の管理**（新しい検索が古い検索を止めること・**古い識別子で今の検索を止めないこと**・切り替えでの破棄）
- `src/main/files/entrySort.test.ts` — ファイルツリーの並び順（フォルダが先・名前順・数値順・安定性）
- `src/main/files/fileContent.test.ts` — バイナリ判定・改行の検出・**文字コード（BOM の検出と書き戻し）**
- `src/main/platform/executablePath.test.ts` — **PATH の辿り方**（相対の項目を使わないこと・前の項目が勝つこと・ドライブ相対を絶対と見なさないこと。Terminal と Git が共有する）
- `src/main/git/gitExecutable.test.ts` — **git 本体の解決**（名前だけに落とさないこと・PATH に無い Git for Windows を既定のインストール先から見つけること・**環境変数が相対を指しても使わないこと**）
- `src/main/git/gitEnvironment.test.ts` — **git へ渡す環境変数**（入力待ちを起こさないこと・読み取りでロックを取らないこと・**利用者自身の `GIT_*` を消さないこと**）
- `src/main/git/gitOutput.test.ts` — **git の出力の読み取り**（区切り文字 / 大小 / 末尾の違いを吸収すること・**サブフォルダを root と混同しないこと**・16進でない commit を読まないこと・ブランチの一覧を印から読むこと・**上限で切ったことを伝える**こと・読めない行だけを落とすこと・**退避では番号が読めない行を丸ごと落とし、他の行の番号をずらさない**こと（並び順から数えると、1行落ちただけで別の退避を指すことになる）・**pop の競合を stdout から見分け、「退避が残った」だけを言う出力を競合と読み違えない**こと・**remote では1件につき2行来る出力を1件として読み、fetch と push で URL が違っても fetch 側1つを採る**こと（末尾の印は空白ではなく末尾から落とす ── URL に空白が入りうる）・**`diff --check` では競合マーカーの行だけを数え、空白の誤りを数えないこと**（同じ終了コードで来るため、終了コードでは決められない。path に `:` や空白や日本語が入っていても数えられるよう、末尾の言い回しだけを見る））
- `src/main/git/gitStatusOutput.test.ts` — **`status --porcelain=v2 -z` の読み取り**（staged / unstaged / untracked / rename / copy / 削除 / 衝突・**日本語 / 空白 / 引用符 / 改行を含む名前**・upstream と ahead / behind・**知らない形を途中まで読んだ結果として返さないこと**・Workspace の外を指す path を受け付けないこと）
- `src/main/git/gitStatusRepository.test.ts` — **本物の git に対する読み取り**（一時リポジトリを作って実際に `git status` を動かす。下記のとおりここも実ディスクを使う）
- `src/main/git/gitFailure.test.ts` — **stderr の分類**（所有者・作業ツリー・権限を見分けること・**知らない文章を近い分類へ寄せないこと**・「リポジトリではない」を失敗の表に入れないこと・書き込み操作の分類では `index.lock` を pathspec より先に採ること・**Commit では終わり方の形で hook を見分けること**（`fatal:` 無しの 1 は hook）・hook の出力に混ざった `permission denied` を git の権限エラーにしないこと・**ブランチでは作業ツリーの理由を「見つからない」より先に採ること**（断り方に名前が入る）・worktree の断りを「同じ名前がある」と読み違えないこと・**始点を渡した作成だけが `invalid reference` を「commit が無い」として読むこと**（切り替えでは「ブランチが無い」── git は同じ文しか言わないので、分けられるのはどちらのコマンドを組み立てたかを知っている側だけ）・40 桁のときの `unable to read tree` も同じ側へ倒すこと・**退避では3つの表を分けること**（drop は作業ツリーに触らないので「上書きされる」を読まない・pop の競合は stderr が空なのでこの表からは分からない）・**remote では4つの表を分けること**（追加にしか「既にある」は無く、削除と URL の変更にしか「見つからない」は無く、**rename にだけ両方がある**・大文字小文字だけの rename で出る `cannot lock ref … .lock` を **`index-locked` と読み違えないこと**（読むと「他の git を閉じてやり直せば通る」という嘘の案内になる ── 実際は何度やっても通らず、その時点で既に壊れている））・**競合の解決の表を Stage の表と分けること**（`conflict-markers-present` は**git の失敗ではない**のでこの表からは返らず、pathspec の「見つからない」も読まない ── 対象は必ず index に3段で載っているもの））
- `src/main/git/gitBlob.test.ts` — **`ls-files --stage` / `ls-tree` の読み取り**（衝突している位置（stage 1 / 2 / 3）から**通常の差分の中身を選ばない**こと・位置に改行やタブが入っていても1件を取り違えないこと・求めた位置と違う行を返さないこと・submodule（`commit`）を blob として読まないこと・**競合の段を段として読み、番号を名前（base / ours / theirs）に変えること**・**段の在り方だけで競合の形が決まること**（`UU` / `AA` / `UD` / `DU` / `DD` / `AU` / `UA` に1対1で対応し、`status` の `XY` を読み直さない）・**段が1つも無ければ形を推測しないこと**（推測すると「両側とも空の競合」として `DD` と見分けが付かなくなる）・mode `160000` を submodule と見分けること）
- `src/main/git/gitConflictDiffRepository.test.ts` — **本物の git から読む競合の ours / theirs**（下記の実ディスクの例外）
- `src/main/git/gitPathspec.test.ts` — **pathspec として通してよい形か**（日本語 / 空白 / 引用符 / 先頭 `-` / glob に見える名前を**通す**こと・絶対パス / `..` / 空文字 / `:` の魔法 / `.git` の中 / 制御文字を**弾く**こと・Windows の上限を超えないよう分けても1件も落とさないこと）
- `src/main/git/gitQueue.test.ts` — **走るのは常に1本**（前が終わるまで次を始めないこと・積んだ順に走ること・**失敗した仕事の後ろも走る**こと）
- `src/main/git/gitStageRepository.test.ts` — **本物の git に対する Stage / Unstage**（一時リポジトリを作って実際に `git add` / `reset` / `rm --cached` を動かす。下記の実ディスクの例外）
- `src/main/git/gitBranchRepository.test.ts` — **本物の git に対するブランチの一覧 / 切り替え / 作成**（一時リポジトリを作って実際に `git switch` を動かす。**書きかけが上書きされないこと**・切り替え先が触らないファイルの書きかけと未追跡のファイルが残ること・同じ名前で既存のブランチが動かないこと・**remote-tracking の名前で手元にブランチが増えないこと**・今のブランチを選んでも git を動かさないこと・detached HEAD からの作成と復帰・上限で切れること・**始点を渡した作成**（指した commit の上に作られること・マージ commit と履歴の最初の commit も始点にできること・始点が解けないときに `commit-not-found` になりブランチが増えないこと・**書きかけが上書きされるなら断り、そのときブランチも作られないこと**）。下記の実ディスクの例外）
- `src/main/git/gitSyncRepository.test.ts` — **本物の git に対する Push / Pull / Commit & Push**（同じ PC の bare リポジトリを remote にして実際に `git push` / `fetch` / `merge --ff-only` を動かす。初回の Push が追跡先まで作ること・送るものが無いときの `nothing-to-do`・**remote が先に進んでいるときの `push-rejected`**・枝分かれでは**取り込まない**こと・関係の無い書きかけが残ること・**Push が断られても commit は残る**こと・Push できない土台（remote が無い / detached）では**commit を積まずに**断ること。下記の実ディスクの例外）
- `src/main/git/gitCommitRepository.test.ts` — **本物の git に対する Commit**（一時リポジトリを作って実際に `git commit --file=-` を動かす。**staged だけが入ること**・混在（staged / unstaged / untracked）・初回 Commit・日本語 / 引用符 / 改行 / `#` で始まるメッセージがそのまま記録されること・名乗り未設定・hook の失敗・同時の Git 操作。下記の実ディスクの例外）
- `src/main/git/gitWatchPaths.test.ts` — **`.git` の中で拾う名前か**（`HEAD` / `index` / `refs/**` / 途中で止まっている操作の目印を**拾う**こと・`.lock` と書き込み途中の一時ファイルを**必ず捨てる**こと・`objects/**`（1回の commit で数百件）と `logs/**`（reflog は二重）を捨てること・**知らない名前は捨てる**こと・OS の区切りを揃え、`.git` の外を指す形を通さないこと）
- `src/main/git/gitChangeSchedule.test.ts` — **いつ配るか**（最後の変化から 250ms 束ねること・**最初の変化から 1 秒で必ず配る**こと（`git checkout` の間じゅう配られない形にしない）・**前に配ってから 500ms は空ける**こと（上限より間隔を優先する）・どの組み合わせでも負の待ち時間を返さないこと）
- `src/main/ipc/errors.test.ts` — 例外から IPC の失敗形への正規化
- `src/shared/files/fileName.test.ts` — **名前として受け付ける形**（区切り文字 / 記号 / 制御文字 / 予約デバイス名 / 末尾のドット / 長さ）と、**既に在るものを指せる形**（作成向けの規則を当てないこと）
- `src/shared/files/relativePath.test.ts` — 相対位置の親・配下の判定・改名時の読み替え
- `src/shared/files/search.test.ts` — **名前の照合の規則**（大小を区別しない部分一致・字義どおりに扱うこと・**印を付ける位置が保証できない名前では返さないこと**）
- `src/renderer/src/api/result.test.ts` — IpcResult の取り出しと UI 文言の網羅
- `src/renderer/src/files/filesError.test.ts` — **失敗を利用者向けの文言へ変える部分**（次の一手が違う失敗が同じ文言に潰れていないこと・**開発者向けの文字列が UI に漏れていないこと**）
- `src/renderer/src/workspace/layout/tree.test.ts` — レイアウトの木の探索・正規化・検証
- `src/renderer/src/workspace/layout/operations.test.ts` — Dock / Split 操作（React 非依存の部分）
- `src/renderer/src/workspace/layout/resize.test.ts` — サイズ操作と最小サイズの計算
- `src/renderer/src/workspace/layout/panelVisibility.test.ts` — パネルの表示 / 非表示と、再表示時の戻り先
- `src/renderer/src/workspace/layout/presets.test.ts` — プリセットの定義（正規形・id の重複）
- `src/renderer/src/workspace/dnd/dockGuide.test.ts` — カーソル位置から DockZone を決める判定
- `src/renderer/src/workspace/dnd/dropTarget.test.ts` — DockZone → DockTarget の翻訳、ドロップ可否、ドロップからレイアウトまでの一連
- `src/renderer/src/workspace/persistence/layoutDocument.test.ts` — 保存形式との往復、壊れた保存データの扱い、schemaVersion
- `src/renderer/src/workspace/persistence/restoreLayout.test.ts` — 復元したノード id と、その後の発番の衝突
- `src/renderer/src/files/fileTreeModel.test.ts` — ツリーの状態から行の並びを導く部分（未取得・読み込み中・空・打ち切り・失敗・名前の入力中）
- `src/renderer/src/files/fileChanges.test.ts` — 変化から読み直す範囲を導く部分（**Lazy Load を崩さないこと**）
- `src/renderer/src/files/nameEditState.test.ts` — 名前の入力欄が受け付ける操作（**確定に失敗した後に固まらないこと**）
- `src/renderer/src/files/moveTarget.test.ts` — 移動先になれるフォルダの判断（自分自身 / 子孫 / 今いるフォルダ・**前方一致するだけの別フォルダを巻き込まないこと**）
- `src/renderer/src/files/clipboard.test.ts` — コピーの控えと貼り付け先の判断（**mode で成立範囲が変わること**）
- `src/renderer/src/files/dragDrop.test.ts` — ドロップ先 → 移動 / コピーの行き先（**既存の判定に繋がっていること**・ファイル行を親へ読み替えないこと・余白が Workspace root になること）
- `src/renderer/src/files/fileSearchModel.test.ts` — **検索の状態の見せ方**（検索中 / 0 件 / 取り消し / 打ち切り / 失敗が**同じ文言に潰れていないこと**）
- `src/renderer/src/files/fileIcon.test.ts` — 名前 / 種別からアイコンの種類を決める判定（名前の表が拡張子より先に効くこと・フォルダに種類を当てないこと）
- `src/renderer/src/files/filesColumnsModel.test.ts` — **カラム表示の列の並び**（activeDirectory から導くこと・**右側を捨てる処理を持たないこと**・1つのカラムがツリーと同じ関数を通ること・消えたフォルダから右を畳むこと）
- `src/renderer/src/files/filesLayoutMode.test.ts` — **表示方式の決め方**（横長でカラムを勧めること・**利用者が選んだ方がリサイズで上書きされないこと**・しきい値の遊びで往復しないこと）
- `src/renderer/src/files/filesSettings.test.ts` — **Files の見え方の保存形式との往復**（選んだ表示方式と幅が失われないこと・**「パネルの形に任せる」も保存されること**・知らない mode と桁外れの幅の落とし先）
- `src/renderer/src/files/filesAutoScroll.test.ts` — **ドラッグ中の自動スクロールの量**（真ん中では動かないこと・**器の外では動かないこと**・縁に近いほど速く上限を超えないこと・狭い器で近い縁が勝つこと）
- `src/renderer/src/editor/editorTabsModel.test.ts` — タブの操作（重複しない・active の導出・改名 / 削除への追従・**未保存のタブは消えても閉じない**・状態の伝達）
- `src/renderer/src/editor/editorTabState.test.ts` — **タブの状態の導き方**（clean / dirty / conflict / deleted の優先順位・未保存でなければ選択肢を出さないこと）
- `src/renderer/src/editor/monaco/language.test.ts` — **拡張子から Monaco の言語を決める判定**（対応する全拡張子・大文字・知らない拡張子・先頭のドット）
- `src/renderer/src/editor/autoSave.test.ts` — Auto Save の設定モデル（既定が OFF・4つの mode・待ち時間の上下限・**保存形式との往復**）
- `src/renderer/src/terminal/terminalDisplay.test.ts` — 端末の見え方の値（**横取りする打鍵が増えていないこと**・文字の大きさとさかのぼれる行数の丸め方）
- `src/renderer/src/terminal/terminalSettings.test.ts` — **Terminal の見え方の保存形式との往復**（範囲の外は読むときも書くときも丸めること・**読めない値だけが既定へ落ちること**）
- `src/renderer/src/git/gitChanges.test.ts` — **変更ファイルの一覧の見せ方と、行に置く操作**（グループの順と空のグループを出さないこと・件数・**開けないもの（削除 / フォルダ）を押せる形にしないこと**・rename で元の位置を出すこと・upstream が無いことと同期していることを同じ表示にしないこと・**操作をグループから決めること**（競合には置かない / ステージ済みに「すべて Unstage」を置かない）・同じファイルの Stage と Unstage が同じ目印になること・失敗の理由すべてに文言があること・**Commit が押せる条件3つ**（ステージ済み / メッセージ / 他の Git 操作）と、押せない理由の一言・空欄には理由を出さないこと・残り文字数を上限に近づくまで出さないこと・**競合の行の操作が Stage でも Unstage でもないこと**（4つのグループがそれぞれ違う操作になる）・**その名前に「Stage」が入らないこと**（入ると「後で Unstage で戻せる」と読まれるが、戻せない）・**2つの「競合」の文が別のことを言うこと**（Commit の断りは「解決済みにする」を指し、マーカーの断りは `<<<<<<<` とエディタを指す）・解決の目印が同じ位置の他の操作と同じ鍵になること）
- `src/renderer/src/git/gitBranches.test.ts` — **ブランチを選ぶ面の中身**（**今のブランチも押せる**こと（印だけが違う）・他の Git 操作が動いている間は押せないこと・取得中に「ありません」と出さないこと・**切れていることを黙って隠さない**こと・空欄には理由ではなく何が起きるかを出すこと・**既にある名前かどうかを Renderer では見ない**こと・名前の問題すべてに違う文言があること・**履歴の行から作る欄はバーの「＋」と違う文言になる**こと（空欄でも始点だけは言う・始点として受け取るのは hash だけで、マージかどうかを見る手立てを持たないこと））
- `src/renderer/src/git/gitStash.test.ts` — **退避の面の中身**（取得中に「ありません」と出さないこと・1件も無いときの案内が同じ面の中を指すこと・**切れていることを黙って隠さない**こと・**未追跡しか無いときは「退避する」を押せない**こと（`-u` を渡していないため押しても何も起きない）とその理由が未追跡に触れること・競合が残っている間は押せないこと・**行に出すものの中に番号が無い**こと（並び順は退避を1つ増やせば全部ずれる）・**戻す / 捨てるが作業ツリーの状態を受け取らない**こと（通るかを決めるのは git）・捨てる確認が「完全に失われる」と書かず「アプリからは取り消せません」と書くこと）
- `src/renderer/src/git/gitRemotes.test.ts` — **remote の面の中身**（取得中に「ありません」と出さないこと・1件も無いときの案内が同じ面の中を指すこと・**切れていることを黙って隠さない**こと・**押せない理由を名前 → URL の順に出す**こと（打っている人の目は上から下へ動く）・両方が空のときだけ理由を言わないこと・**通らない URL の断り文に使える3つの形が全部書かれている**こと・認証情報つきの URL だけ別の文になること（次の一手が「打ち直す」ではなく「認証の部分を消す」）・**削除に押す前の「絶対に通らない理由」が無い**こと・確認が「コミットは失われません / 登録し直せます」と書き、盛らないこと・**URL の変更が追加とまったく同じ理由で断ること**（断る理由の文字列まで一致 ── ずれた時点で片方の欄だけが通す形が生まれる）・変更の確認が**ラベルと打った URL を別々に持つ**こと（現在の側に `https://` も `.git` も出ない）と「前の送り先」「コミットは失われません」を書き「失われます」とは書かないこと・**大文字小文字だけの rename が押せない**こと（ブランチとは逆）とその理由に**なぜ通らないかまで書かれている**こと・rename の行き先も追加と同じ規則で断ること）
- `src/shared/git/remoteName.test.ts` — **remote 名の規則**（ブランチ名とほぼ同じだが、**`.` を弾く**こと（`remote.<名前>.url` という設定のキーの真ん中に入るため）・**先頭の `-` を弾く**こと（`--end-of-options` だけでは扱えない名前が生まれる）・`origin` を予約語にしないこと・`/` 入りを通すこと）
- `src/shared/git/remoteUrl.test.ts` — **remote の URL の規則**（通すのは `https://…` / `ssh://…` / `user@host:path` の**3つだけ**であること・**`ext::…` を弾く**こと（Git に任意のコマンドを走らせる実在の経路）・`git://` / `http://` / `file://` / ローカルのパスも**危なくなくても弾く**こと・**認証情報を含む URL を別の理由で弾く**こと・ホストや path の欠けを弾くこと・文字列でない値を弾くこと）
- `src/main/git/gitRemoteLabel.test.ts` — **URL → 表示用のラベル**（スキーム・認証情報・ポート・末尾の `.git` が落ちること・**ラベルから URL を組み立て直せない**こと・ローカルのパスは場所を出さずに言うこと・`ext::…` を「ローカルのパス」と読み違えないこと・空欄を返さないこと）
- `src/shared/git/branchName.test.ts` — **ブランチ名の規則**（空 / 上限の境界と超過 / 空白 / 制御文字 / `~^:?*[]` / `"<>|` を**弾く**こと・`..` / `@{` / `/` の位置 / `.lock` 終わり / **先頭の `-`** / `HEAD` を弾くこと・日本語や `feature/x` を**通す**こと・前後の空白だけを落とし**中の空白は落とさない**こと・文字列でない値を弾くこと）
- `src/shared/git/commitMessage.test.ts` — **Commit メッセージの規則**（空 / 空白だけ / 上限の境界と超過 / NUL と制御文字を**弾く**こと・改行 / タブ / 日本語 / 引用符 / `#` を**通す**こと・CRLF を LF へ揃えること・前後の空白を落としても途中の空行は残すこと・文字列でない値を弾くこと）
- `src/renderer/src/git/gitRepositoryMessage.test.ts` — **Git パネルの文言**（どの状態にも次の一手が書かれていること・**git の生の英文が UI に漏れていないこと**・detached をブランチ名として出さないこと）
- `src/renderer/src/settings/settingsCatalog.test.ts` — **Settings 画面に何が並ぶか**（Editor / Files / Terminal / Appearance がこの順であること・**Appearance が末尾であること**・カテゴリの並びが保存側の section の並びと一致すること・**中身の無いカテゴリが1つも無いこと**・まだ作らないと決めたカテゴリ（`general` / `git` / `workspace` / `language` / `debug`）が紛れ込んでいないこと・**載せないと決めた `files.columnWidth` が並んでいないこと**・目録の section 名が保存側の閉じた集合と食い違っていないこと）
- `src/renderer/src/settings/settings.integration.test.ts` — **Settings 画面の統合テスト**（既定で始まる → 6項目を変える → 閉じて開き直す → 再起動、を1本で通す。**ツールバー / ⚙ から変えても Settings から変えても同じ値になること**・1項目を変えても他を巻き込まないこと・方式を切り替えても待ち時間が持ち回されること・**Settings で表示方式を変えてもカラムの幅が失われないこと**・上下限へ丸まった結果がそのまま保存されること・知らない値が保存されていても既定を出すこと・**Theme を往復させても他の5項目が動かないこと**・知らない Theme 名がディスクへ残らないこと・**保存された値 / Preload への引数 / 実行時の値が同じ落とし先を通ること**）
- `src/renderer/src/settings/SettingsOverlay.dom.test.ts` — **Settings 画面の実際の描画と操作**（下記の jsdom の例外。トップバーから開く・カテゴリ切り替え・`×` と Esc で閉じる・6つの操作 UI が既存 setter へ繋がること・**Files ツールバー ↔ Settings / Terminal の ⚙ ↔ Settings が双方向に同期すること**・**Theme を選ぶとその場で `<html>` に当たり保存されること**・知らない Theme 名が保存されていても Dark で出ること・**読み込みが返る前でも Preload が当てた Theme を塗り直さないこと**（起動時のちらつき））
- `src/shared/theme/theme.test.ts` — **Theme の名前と、起動時に3層を通る経路**（選べるのは Dark / Light の2つだけ・**知らない値がすべて Dark へ落ちること**・Main → Preload の受け渡し（`--fx-initial-theme`）が往復すること・引数の並びのどこにあっても見つかること・渡って来なければ Dark になること）
- `src/renderer/src/theme/appearanceSettings.test.ts` — **Theme と保存形式の行き来**（保存が無ければ Dark・知らない名前は読むときも**書くときも**落ちること・往復して同じものへ戻ること）
- `src/renderer/src/theme/themeTokens.test.ts` — **CSS 変数から Monaco / xterm の色を作る部分**（`theme.css` の値がそのまま行くこと・読めなかった変数でも**色として不正にならない**こと・Theme ごとに Monaco の継承元が変わること・**ANSI 16色を渡していないこと**）
- `src/renderer/src/styles/themeCss.test.ts` — **`theme.css` そのものの検証**（Dark と Light が同じ変数の集合を持つこと（色40）・**Light が Dark の値をそのまま写している色が無いこと**（幕と影を含む）・Monaco / xterm が読む変数が両方にあること・窓の初期色が `--fx-color-app-bg` と一致すること・**`monacoSetup.ts` / `xtermSetup.ts` に 16進数が戻ってきていないこと**。§16.7）
- `src/renderer/src/workspace/workspace.integration.test.ts` — **STEP 2 全体の統合テスト**（下記）

Files の検証（`main/files/workspacePath.ts`）は Electron にも fs にも依存しない形に切り出してある。symlink による脱出だけはパス文字列では判断できないため、realpath を取ってから同じ関数へ通す側（`readWorkspaceDirectory.ts` / `readWorkspaceFile.ts` / `mutateWorkspaceEntry.ts`）が担う。

#### 例外: 実ディスクを触るテスト（Session 3-5.1 / 3-6-2 / 3-6-4 / 3-6-5 / 3-8-2 / 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-9 / 3-8-10 / 3-8-11 / 3-8-12 / 3-8-13 / 3-8-14 / 3-8-15 / 3-8-16 / 3-8-17 / 3-8-18 / 3-8-19 / 3-8-20 / 3-8-22A / 4-3A / 7-1C）

「純粋なロジックだけを対象にする」方針に対する例外が25ある ── `mutateWorkspaceEntry.test.ts`（作成 / 改名 / 移動 / 削除）、`copyTree.test.ts`（再帰コピー）、`searchWorkspaceFiles.test.ts`（Workspace 全体の走査）、`searchWorkspaceFileContents.test.ts`（全文検索の走査）、`gitStatusRepository.test.ts`（本物の git の出力）、`gitStageRepository.test.ts`（本物の git への Stage / Unstage）、`gitCommitRepository.test.ts`（本物の git への Commit）、`gitSyncRepository.test.ts`（本物の git への Push / Pull）、`gitBranchRepository.test.ts`（本物の git へのブランチ操作）、`gitDiffRepository.test.ts`（本物の git から読む差分）、`gitDiscardRepository.test.ts`（本物の git に対する破棄）、`gitInitRepository.test.ts`（本物の git での初期化）、`publishRepository.test.ts`（本物の git での公開の一連）、`gitHistoryRepository.test.ts`（本物の git から読む履歴）、`gitCommitDetailRepository.test.ts`（本物の git から読む commit 1件の中身）、`gitStashRepository.test.ts`（本物の git に対する退避）、`gitRemoteRepository.test.ts`（本物の git に対する remote の管理）、`gitConflictRepository.test.ts`（本物の git に対する競合の解決）、`gitRemoteBranchRepository.test.ts`（本物の git での remote の枝からの作成）、`gitMergeRepository.test.ts`（本物の git に対するマージの開始 / 中止）、`gitConflictDiffRepository.test.ts`（本物の git から読む競合の ours / theirs）、`gitInProgressRepository.test.ts`（本物の git での途中の操作の検出と禁止。Session 3-8-22A）、`gitFetchRepository.test.ts`（本物の git への fetch。同）、`settingsStore.test.ts`（`settings.json` の読み書きと、旧3ファイルからの取り込み。Session 4-3A）、`logFile.test.ts` の `nodeLogFileSystem`（一時フォルダでのログの書き出しと世代。Session 7-1C）。確かめたいのがパスの文字列処理ではなく **「実際にそこに在るものを操作できるか」** だからで、モックしたファイルシステムでは何も確かめられない ── 判定と実体がずれることこそが Session 3-5.1 で直した不具合の中身だった。`aux.ts` や末尾に空白を持つ名前を Windows がどう扱うかは実装ではなく OS が決めるため、写しを相手にするとその答えを自分で書くことになる。

どれも一時フォルダを Workspace root に見立てる（`settingsStore.test.ts` だけは userData に見立てる ── 保存先をフォルダで受け取る形にしてあるのは、実際の `%APPDATA%` に触れずに確かめられるようにするため）。走査（検索）のテストでは、深い階層・大量ファイル・除外フォルダ・**外を指すジャンクション**を実際に作って、リンクの中へ潜っていないことを「指し先の中身が結果に出ていないこと」で確かめる ── 「潜らないつもり」を実物で確かめるため。上限（件数 / 深さ / 走査数）は引数で差し替えて小さくし、時間の上限だけは `now` を差し替えて固定する（実時間に依存させると、速いマシンでは通り遅いマシンでは落ちるテストになる）。

全文検索（Session 3-6-5）でも同じ形を採る。こちらで実ディスクでしか確かめられないのは、**バイナリを読み飛ばすこと**・**大きすぎるファイルを開かないこと**・**Workspace の外を指すリンクの中身が preview に載らないこと**の3つ ── どれも「読んだ結果」で決まるため、写しの fs では何も言えない。外に置いたファイルの中身（`needle in the outside file`）が結果に現れないことを、実際にリンクを張って確かめている。

**Git（Session 3-8-2）でも同じ形を採る。** `gitStatusOutput.test.ts` は「この文字列をこう読む」を固定するが、それだけでは**git が本当にその文字列を出すのか**を誰も確かめていない ── 渡している引数（`--porcelain=v2 --branch -z --untracked-files=normal`）がどんな出力になるかを決めるのは実装ではなく git だからで、写しを相手にするとその答えを自分で書くことになる。実物でしか確かめられないのは、`-z` を渡しても rename が1件として返ること・未追跡のフォルダが中身ではなくフォルダ1件として返ること・**日本語のファイル名が引用符で包まれずに返ること**の3つになる。一時フォルダに `git init` してから、本番と同じ `showWorkingTreeStatus()` の引数と、本番と同じ `resolveGitExecutable` で辿った git を使う（自分用のコマンドを組み立てると、確かめているものが本番と別になる）。git が入っていない環境ではその塊ごと飛ばす。

**書き込む側（Session 3-8-3）は、さらに実物でしか確かめられない。** `gitPathspec.test.ts` が固定するのは「この値を通すか」までで、**通した値を git がどう受け取るか**は誰も確かめていない。日本語・空白・引用符・先頭 `-`・glob に見える名前は、どれも「渡し方を1つ間違えると別のものが Stage される」形の値になる。実物で見ているのは次の6つ。

- 先頭が `-` のファイル名が**オプションとして読まれない**こと（`--` が効いている）
- `a[1].txt` を指したときに `a1.txt` まで巻き込まないこと（`--literal-pathspecs` が効いている）
- **初回 commit 前でも Unstage できる**こと（HEAD を前提とする経路を通っていない）
- rename を Unstage すると**元の位置の削除も一緒に戻る**こと
- 「変更のすべて」が**競合しているファイルを巻き込まない**こと（衝突は実際に merge を失敗させて作る）
- 同じ瞬間に始めた2つの操作が、index の取り合いで失敗しないこと

呼ぶのは本番の `applyGitStage` / `applyGitUnstage` で、その下の `runGit` / `gitCommands` / `gitPathspec` / `gitQueue` はすべて本番のものが動く。**差し替えるのは2つだけ** ── `electron`（logger が `app.isPackaged` を見るため）と、現在の Workspace（一時リポジトリを指させるため）。ここを増やすと、確かめているものが本番と別になっていく。

**Commit（Session 3-8-4）でも同じ形で、実物でしか確かめられないものがさらに増える。** `commitMessage.test.ts` が固定するのは「この文字列を通すか」までで、**通した文字列を git がどう記録するか**は誰も確かめていない。実物で見ているのは次の7つ。

1. **staged だけが commit に入る**こと（unstaged / untracked を巻き込まない・Stage 後に再編集した続きも巻き込まない）
2. 標準入力から渡したメッセージが `git log` にそのまま出ること（日本語・引用符・改行・先頭 `-`・絵文字）
3. `#` で始まるメッセージが**消えない**こと（`--cleanup=whitespace` が効いている）
4. 初回 Commit（HEAD がまだ無い）が通常とまったく同じ経路で通ること
5. 名乗りが無いときに **commit を作らずに** 失敗すること
6. hook が止めたときに `hook-rejected` になり、通る hook なら Commit が成功すること
7. 同じ瞬間に始めた Commit と Stage が、index の取り合いで失敗しないこと

**この塊だけは、その PC の git 設定を見えなくしてから走らせる。** `user.email` を外したときの挙動は「外した先に何も無い」ときにしか確かめられず、開発者の PC には `--global` の名乗りが入っているのが普通で、リポジトリ側を外しただけでは git はそちらへ落ちる（実際にそうなった）。`GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` を実在しないパスへ向けると、git はその設定を空として扱う ── 名乗りだけでなく `commit.gpgsign` / `core.hooksPath` / `commit.template` のような、結果を変えうる設定もまとめて外れる。

**Push / Pull（Session 3-8-5）では、相手が要る操作を相手ごと用意する。** remote は**同じ PC の bare リポジトリ**にしてある ── git にとってそれは他の remote と変わらず、`push` / `fetch` / `merge --ff-only` は同じ経路を通る（変わるのは transport だけ）。この形なら、回線が無くても資格情報が1つも無くても次の7つを実物に固定できる。

1. 初回の Push が**追跡先まで作る**こと（`--set-upstream`）と、2回目以降はその追跡先へ送ること
2. 送る Commit が無いときに `nothing-to-do` として返る（git を動かさない）こと
3. remote 側が先に進んでいるときに `push-rejected` になること
4. Pull が `fetch` → `merge --ff-only` として動き、**枝分かれでは取り込まない**こと（手元が1文字も変わらない）
5. 取り込みと関係の無い書きかけが残ること・上書きされる場合は `local-changes-blocked` として断ること
6. **Commit & Push が Push で止まったとき、commit が残ったまま `partly-applied` になる**こと（もう一度 Commit させない）
7. Push できない土台（remote が無い / detached HEAD）では、**commit を積まずに**断ること

**認証とネットワークの失敗だけは、ここでは作れない**（相手が要る）。そちらは文言の分類として `gitFailure.test.ts` が固定し、実際の振る舞いは production 実機での確認（§4）に回している。

**ブランチ（Session 3-8-6）で実物に確かめさせるのは、「失われないこと」になる。** 切り替えは、このアプリが git に頼む操作の中で唯一**作業ツリーの中身をまるごと書き換える**もので、しかもアプリ側は確認を挟まない（切り替えてよいかを決めるのは git 自身）。その判断に委ねてよいかどうかは、文言の分類では何も言えない。実物で見ているのは次の7つ。

1. 切り替え先が触るファイルに書きかけがあるとき、**git が断り、ファイルも HEAD も1文字も動かない**こと
2. 切り替え先が触らないファイルの書きかけと、未追跡のファイルは**切り替えても残る**こと（確認を挟まない判断が、普通の使い方を止めていないこと）
3. 同じ名前で作ろうとしても、**既にあるブランチが動かない**こと（`--force` を渡していない）
4. remote-tracking branch の名前を渡しても、**手元にブランチが増えない**こと（`--no-guess` が効いている）
5. 今のブランチを選んだときに git を動かさないこと（`nothing-to-do`）
6. detached HEAD からでも作れて、ブランチへ戻れること
7. 一覧が上限（500 件）で切られ、切られたことが分かること

**Session 3-8-13 では、この塊にファイルを1つも足していない**（例外は 15 のまま）── 増えたのは同じ `gitBranchRepository.test.ts` の中の「始点を渡す」で、確かめる相手が同じ `applyGitCreateBranch` だからになる。ここで実物にしか確かめられないのは次の4つ。

1. `switch --create <name> --end-of-options <hash>` という**並びが通る**こと（名前の手前に `--end-of-options` を挟むと、名前が始点として読まれる。3-8-6 で確かめた側）
2. マージ commit と、履歴の最初の commit も始点にできること（3-8-12 の差分が断ったのとは判断が違う）
3. 始点が解けないときの git の言い方が、短い hash では `invalid reference`、40 桁では `unable to read tree` になること
4. **書きかけが上書きされるなら断り、そのとき ref も作られない**こと ── `switch --create` が作るのと移るのを1回で行うことの現れで、ここが崩れると「押したのに切り替わっていないブランチ」が一覧に増える

**Session 3-8-14 でも、この塊にファイルは1つも増えていない**（例外は 15 のまま）── 削除と rename を確かめる相手も同じ `gitBranchRepository.test.ts` になる。ただし**確かめたいことが裏返る。** 3-8-6 / 3-8-13 が「書きかけが失われないこと」だったのに対し、こちらは**断られたときに1つも消えていない / 動いていないこと**にあたる。実物にしか確かめられないのは次の6つ。

1. 未マージのブランチは断られ、**ref も指す先もそのまま残る**こと（`-D` を持たないという判断の実体。断りの文が出たことは、ref が残っていることを何も言わない）
2. 行き先が実在する rename は断り、**相手のブランチが1文字も動かない**こと（`-M` を渡していない）
3. **大文字小文字だけの改名が通る**こと ── Windows では素の `--move` が「既にある」と断るので、`--force` の使いどころが1点だけであることを実物で押さえる
4. 削除も rename も、**未コミットの変更を消さない**こと（確認の文で「未保存の変更があります」と言わない根拠）
5. 今のブランチを改名すると **HEAD が追随する**こと
6. rename の後、`branch.<新名>.merge` が**古い remote 側の名前**を指したまま残ること（対象外にした判断を、黙って変わった日に気づけるようにする）

**Session 3-8-15 では、この塊にファイルが1つ増える**（例外は 16 になった）── `gitStashRepository.test.ts`。ここで確かめたいことは、3-8-6 / 3-8-13 の「書きかけが失われないこと」とも 3-8-14 の「断られたときに消えていないこと」とも違い、**指した1件が指したとおりであること**になる。

退避を指す `stash@{N}` は名前ではなく**上から数えた位置**で、1つ避ければ全部が1つずつ後ろへずれる ── その振る舞いを決めるのは実装ではなく git で、取り違えると押した人が見ていない退避が消える（戻せない）。実物にしか確かめられないのは次の 10 個。

1. 退避すると tracked の変更が HEAD の状態へ戻り、**未追跡は残る**こと（`-u` を渡していないことの実体）
2. 未追跡しか無いときは git を動かさず `nothing-to-do` になること（`No local changes to save` は **0 で終わる**ので、終了コードからは分からない）
3. commit が1つも無いリポジトリでは `no-commit` になり、退避も作られないこと
4. 競合が残っている間は git を動かさずに断ること
5. index に載せた変更が、戻ると **unstaged** になること（`--index` を渡していないことの実体）
6. **pop が競合すると `partly-applied` になり、退避が一覧に残る**こと ── 競合の知らせは **stderr に1文字も出ず stdout に出る**ため、ここが崩れると「何も起きなかった」と出して押し直させることになる
7. 上書きされる pop は `local-changes-blocked` で、作業ツリーも一覧も1文字も動かないこと（6 との取り違えを止める）
8. **drop すると、それより後ろの番号が繰り上がる**こと（hash を一緒に渡す設計そのものの根拠）
9. **番号がずれていたら、pop も drop も git を動かさずに断る**こと（突き合わせが効いていること）
10. 退避 → ブランチ切り替え → 戻す が通ること（3-8-5 から文言だけが案内していた出口になっていること）

**上限（100 件）だけは、確かめる相手を移してある。** 退避を 101 件作るには `git stash push` を 101 回呼ぶことになり、実測で 9 秒かかった ── しかも退避には ref をまとめて作る手立てが無い（同じ commit を `git stash store` で何度積んでも、`git stash list` は同じ commit を1件としか数えない。確かめた）。切り方そのものは `gitOutput.test.ts`（`readStashEntries`）が純粋な関数として固定済みなので、実物には**「git が `--max-count` を守るか」だけ**を、本番と同じ `listStashEntries()` の引数を小さい上限で通して聞いている。`git branch` を 500 回呼ばずに `update-ref --stdin` でまとめたのと同じ判断になる。

この塊も `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` を実在しないパスへ向けてから走らせる（`stash.showIncludeUntracked` / `stash.showPatch` はどれも開発者の PC に入っていておかしくなく、確かめている振る舞いそのものを変えうる）。

**Session 3-8-16 でも、この塊にファイルが1つ増える**（例外は 17 になった）── `gitRemoteRepository.test.ts`。ここで確かめたいことは、3-8-14 の「断られたときに消えていないこと」とも 3-8-15 の「指したとおりであること」とも違い、**何が消えるか**と、**git が受け取ってしまう値をこちらが受け取らないこと**の2つになる。

2つめがこの塊の中心にあたる。`git remote add x "ext::sh -c whoami"` を**今の git がそのまま受け取る**ことも、`git remote add --end-of-options -x <url>` が `-x` という名前の remote を**実際に作ってしまう**（そしてその後 `git remote remove -x` はオプションとして読まれ、消せなくなる）ことも、決めるのは実装ではなく git になる ── 写しを相手にすると、shared の規則が要る理由そのものを自分で書くことになる。実物にしか確かめられないのは次の 13 個。

1. remote が1つも無くても `git remote --verbose` は 0 で終わり、空を返すこと（「1件も無い」を失敗にしない根拠）
2. 1件につき2行（fetch / push）来るのを1件として読むこと
3. fetch と push で URL が違っても、載るのは fetch 側1つであること
4. 追加してもネットワークへ出ないこと（届かない URL でも通り、remote-tracking ref が増えない）
5. 追加しても**追跡先は付かない**こと（`branch.<名前>.remote` が増えない ── 付くのは Push が通ったときだけ）
6. 同じ名前を2度足すと断られ、**先にあった URL が1文字も変わらない**こと（`set-url` を持たないことの実体）
7. 削除すると、設定・remote-tracking ref・**その remote を追っていたブランチの追跡先**の3つが消えること
8. 削除しても **commit は1つも失われない**こと（確認の文言が「コミットは失われません」と書ける根拠）
9. 無い remote を消そうとすると断られ、**他の remote は1つも消えない**こと
10. **git は `ext::sh -c …` を remote として受け取る**が、`normalizeGitRemoteUrl` は断ること
11. **git は `--end-of-options` の後ろの `-x` を名前として受け取る**が、`normalizeGitRemoteName` は断ること
12. `--end-of-options` を置かないとその remote は消せず、置けば消せること
13. 認証情報つきの URL が既に在っても、境界を渡るのは**ラベルだけ**であること（トークンが応答に載らない）

**上限（100 件）は、3-8-15 と同じ判断で相手を移してある。** ただし理由が1つ違う ── `git remote` には**件数を切る指定がそもそも無い**（`--count` も `--max-count` も持たない）ので、「git が上限を守るか」という問い自体が立たない。切り方は読む側（`readRemoteEntries`）にあり、それは `gitOutput.test.ts` が純粋な関数として固定済みなので、実物には**「本番の引数（`listRemoteUrls()`）が出す形が、その関数の読める形か」だけ**を聞いている。

この塊も `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` を実在しないパスへ向けてから走らせる ── とくに `url.<base>.insteadOf` は開発者の PC に入っていておかしくなく、**登録した URL そのものを書き換えうる**。

**Session 3-8-17 では、この同じファイルに2つの塊を足す**（例外の数は 17 のまま ── ファイルは増えない）。確かめたいことは 3-8-16 と**逆向き**になる ── あちらが「何が消えるか」なら、こちらは**「何が変わらないか」**にあたる。実物にしか確かめられないのは次の 14 個。

1. `set-url` で **URL だけが変わる**こと
2. `set-url` は refspec・remote-tracking ref・追跡先を**1つも動かさない**こと
3. `set-url` の後も **ahead / behind が変更前と同じまま残る**こと（＝もう別の相手と比べた数。確認の文言の根拠そのもの）
4. `set-url` が commit も作業ツリーも動かさず、`hasRemote` も変えないこと
5. `set-url` がネットワークへ出ないこと（届かない URL でも通り、remote-tracking ref が増えない）
6. **今と同じ URL を渡しても成功として終わる**こと（`nothing-to-do` にしない ── Renderer は今の URL を持たない）
7. 無い remote を指すと断られ、**他の remote の URL は1文字も変わらない**こと
8. 変えると一覧の**ラベルも変わる**こと（ラベルは変更後の URL から作り直される）
9. rename で**設定・refspec・remote-tracking ref・追跡先・`remote.pushDefault` の5つが追随する**こと
10. rename の後も追跡先が生きていて、**remote 名を指さない素の `git push` が通る**こと（remove + add との決定的な違い）
11. rename の行き先が既にあれば断られ、**どちらの remote も1つも変わらない**こと
12. rename で同じ名前を渡すと **git を動かさず** `nothing-to-do` になること
13. **大文字小文字だけの改名は git を動かさずに断り、半分だけ適用された痕跡が1つも無い**こと
14. **git は `set-url` でも `ext::…` を受け取り、`rename` の行き先として `-x` も受け取る**が、shared の規則はどちらも断ること

**13 の根拠として、git 自身の壊れ方も固定してある。** `git remote rename origin Origin` を remote-tracking ref が在る状態で走らせると、Windows では `cannot lock ref` で落ちるうえ **`remote.Origin.url` だけが書かれた状態で止まる**（refspec も ref も古い名前を指したまま残る）── つまり「失敗したのでやり直せる」ではなく1回目で壊れる。これも決めるのは実装ではなく git なので、写しを相手にすると**アプリが手前で断つ理由そのものを自分で書くことになる**（3-8-16 の `ext::` / `-x` と同じ側）。

**Session 3-8-18 では、この塊にファイルが1つ増える**（例外は 18 になった）── `gitConflictRepository.test.ts`。確かめたいことは remote の2回（3-8-16 / 3-8-17）とはまた違い、**git が通してしまうこと**と、**その先が繋がっていること**の2つになる。

1つめが「アプリが手前で断る」理由そのものにあたる。`git add` はマーカーが残ったままでも通り、その後の Commit も通る ── つまり `<<<<<<< HEAD` が**履歴に永久に残る**。2つめは「3方向マージのエディタを作らない」という判断の根拠で、解決した後の Commit が 3-8-4 の引数のまま**マージ commit を作って MERGE_HEAD を消す**ことを確かめてある。どちらも決めるのは実装ではなく git なので、写しを相手にすると自分でその答えを書くことになる。実物にしか確かめられないのは次の 15 個。

1. `stash pop` の競合が index に3段を作ること（**アプリが競合を生む唯一の経路**。Pull は `--ff-only` 固定で競合せず、切り替えは競合しそうなら git が断る）
2. マーカーを消して保存しても、伝えるまでは3段のまま残ること
3. 「解決済みにする」で3段が1段に畳まれ、ステージ済みへ移ること
4. その後、**本番と同じ引数の Commit がマージを完結させる**こと（親が2つになり、MERGE_HEAD が消える）
5. 退避の競合ではマージではないため、普通の commit（親が1つ）になること
6. **git はマーカーが残ったままの add と commit を通す**こと（`git show HEAD:f.txt` に `<<<<<<<` が入る）
7. マーカーが残っていれば断り、**index が1段も動いていない**こと
8. 片方のマーカーだけ消した場合も断ること
9. 競合していない位置を受け取らないこと（**ただの Stage にしない**）
10. 押すまでの間に端末で解決されていたら、git を動かさず断ること
11. 片方が削除された競合（`UD`）はマーカーが無く、そのまま解決できること
12. バイナリの競合もマーカーが無く、そのまま解決できること
13. `git diff --check` が**空白の誤りも同じ終了コードで報告する**こと（＝終了コードでは決められず、出力の行を読む理由）
14. **`.gitattributes` の `whitespace=` が `-c core.whitespace=` より強い**こと（＝空白の検査を切る手が当てにできない理由）
15. **`git reset HEAD` が競合を復元しない**こと（3段が畳まれたただの変更として残る）と、`git checkout --merge` は復元するが**書いた解決内容を消す**こと（＝取り消しを置かない根拠）

この塊も `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` を実在しないパスへ向けてから走らせる ── とくに `merge.conflictStyle`（`diff3` / `zdiff3`）は開発者の PC に入っていておかしくなく、**マーカーの行数そのものを変える**。

**Session 3-8-19 では、この塊にファイルが1つ増える**（例外は 19 になった）── `gitRemoteBranchRepository.test.ts`。確かめたいことの向きが、3-8-6 / 3-8-13 の「**失われないこと**」とは違う ── **押した人が指したものだけが相手になること**になる。3-8-6 が `--no-guess` で閉じた口を 3-8-19 で開ける以上、開けた口が指せる範囲を実物で閉じておく必要があるため。実物にしか確かめられないのは次の 13 個。

1. symbolic HEAD（`origin/HEAD`）が一覧に載らないこと（`%(refname:short)` が `origin/HEAD` ではなく **`origin`** を返すので、名前では弾けない）
2. ローカルブランチが一覧に混ざらないこと（3-8-6 の「remote-tracking が載らない」の裏返し）
3. **remote 名に `/` が入っていても、既定のローカル名が正しく切れる**こと（git の `%(refname:lstrip=3)` は `up/stream/feature/x` を `stream/feature/x` に切ってしまう）
4. remote が1つも無い場合と、remote はあるが未 fetch の場合を `hasRemote` で言い分けられること（git の出力はどちらも空）
5. 上限（500 件）で切り、切ったことを言うこと
6. 作れたときに**追跡先が必ず付く**こと（`branch.autoSetupMerge` を見えなくしたうえで ── `--track` を明示している効き目そのもの）
7. ローカル名を打ち替えても、追う先が変わらないこと
8. **同名のローカルブランチがあれば git を動かさずに断り、元のブランチの ref も追跡先も HEAD も1つも動かない**こと
9. **ローカルブランチ名を始点に渡しても作らない**こと（渡せば git は受け取り、`branch.<名前>.remote=.` を書いて通してしまう）
10. **`origin/HEAD` を始点に渡しても作らない**こと（`branch --remotes --list` のパターンには一致するため、要求としては届きうる）
11. 無い remote-tracking branch を指したら `branch-not-found` になること
12. 書きかけが上書きされるときは断り、**ブランチも作られない**こと（`switch --create` が1回で行う）
13. 切り替え先が触らないファイルの書きかけは、作っても残ること

9 と 10 がこの回の要点にあたる ── **git が受け取ってしまう値を、こちらが受け取らない**（3-8-16 の `ext::` / `-x` と同じ側）。写しを相手にすると、始点を git に確かめる理由そのものを自分で書くことになる。

6 のために `branch.autoSetupMerge` を見えなくするのは、3-8-6 の塊が同じ設定を見えなくしていたのと**理由が逆**になる ── あちらは「付いてしまわないこと」を守るためで、こちらは「明示したから付くこと」を測るためにあたる。

**`git branch --list --format=... --end-of-options <name>` が大文字小文字を区別すること**は、loose ref と packed-refs の両方で確かめてある（`git pack-refs --all` の前後で同じ問いを投げる）── `show-ref --verify` はどちらでも成功を返してしまい、この確認には使えない。

7 の ref は `git update-ref --stdin` で**一度に**作る ── `git branch` を 500 回呼ぶと、確かめたいこと（上限の扱い）に対して待ち時間が釣り合わない。この塊も `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` を実在しないパスへ向けてから走らせる（`checkout.defaultRemote` / `branch.autoSetupMerge` はどれも開発者の PC に入っていておかしくなく、確かめている振る舞いそのものを変えうる）。

**Session 3-8-20 では、この塊にファイルが1つ増える**（例外は 20 になった）── `gitMergeRepository.test.ts`。確かめたいことの向きは 3-8-19 の「押した人が指したものだけが相手になること」に、もう1つ**「PC ごとの設定に振る舞いを左右されないこと」**が加わる ── `merge.ff` / `merge.autoStash` はどちらも開発者の PC に入っていておかしくなく、**同じボタンの結果を変える**。写しを相手にすると、`--ff` / `--no-autostash` を明示した理由そのものを自分で書くことになる。実物にしか確かめられないのは次の 18 個。

1. 早送りできるときは早送りすること（**merge commit を作らない**）
2. 枝分かれしていれば merge commit を1つ作ること（親が2つ）
3. `--no-edit` があるのでエディタ待ちにならないこと（`core.editor` に「入力を待ち続けるもの」を置いて確かめる ── 外れていれば返ってこない）
4. 競合すると `partly-applied` / `completed: 'merge'` / `merge-conflict` になること
5. 競合した行が 3-8-2 の「競合」グループに並ぶこと
6. **自動でマージできたファイルがステージ済みへ入る**こと（＝「何も起きなかった」ではないことの中身）
7. そのとき `merging` が真になること（MERGE_HEAD がある）
8. **3-8-18 の解決 → 3-8-4 の Commit でマージが完結する**こと（merge commit ができ、MERGE_HEAD が消える）
9. 作業ツリーの変更がマージを妨げるとき `local-changes-blocked` になり、書きかけがそのまま残ること
10. **staged の変更が妨げるときも安全に断る**こと（git は終了コード 2 と `Merge with strategy ort failed.` を返す ── `unknown` に落ちない）
11. detached HEAD は **git を動かす前に** `not-on-branch` で断ること
12. 実在しないブランチが `branch-not-found` になること
13. **tag をブランチとして受け取らない**こと
14. **commit hash をブランチとして受け取らない**こと
15. **remote-tracking ref をブランチとして受け取らない**こと
16. `merge.ff=false` でも `--ff` が勝つこと（早送りのまま ── 余計な merge commit を作らない）
17. `merge.ff=only` でも `--ff` が勝つこと（枝分かれしていても merge commit を作れる）
18. `merge.autoStash=true` でも `--no-autostash` が勝つこと（**隠れた退避を1つも作らない**）

13〜15 がこの回の要点にあたる ── **git が受け取ってしまう値を、こちらが受け取らない**（3-8-16 の `ext::`・3-8-19 の始点と同じ側）。`git merge` はタグも hash も remote-tracking ref もそのまま受け取るので、名前の**形**だけを見て通すと「ブランチのマージ」を名乗ったまま別のものが取り込まれる。15 の ref は `git update-ref refs/remotes/origin/feat feat` で置く ── remote を繋がずに「一覧に出る名前」だけを作れる。

16〜18 は**この塊だけが `GIT_CONFIG_GLOBAL` を無効にしたうえで、リポジトリの側に設定を入れて**確かめる ── 他の塊が「設定を見えなくする」のに対し、こちらは見えなくしたうえで**わざと効かせて、それでも勝つこと**を測る。

8 は 3-8-18 の `applyGitResolveConflict` と 3-8-4 の `applyGitCommit` を**本番のまま**通す ── 「3-8-20 で足したのは開始と中止の2手だけ」という判断の根拠そのものになるため、写しに置き換えるとその主張が確かめられない。

中止の側で確かめるのは4つで、うち1つがこの回の確認のいちばん核心にあたる ── **開始前から在った作業ツリーの変更は残り、解決中に書いた内容（stage したものを含む）は消える。** 2つを同じ1回で確かめておかないと、確認の文言（`describeGitAbortMergeWarning`）がどちらか片方の嘘になる。残りは MERGE_HEAD が消えること・マージ前のファイルの内容へ戻ること・**マージ中でなければ git を1回も動かさずに `nothing-to-do`** になることになる。

**Session 3-8-21 でも、この塊にファイルが1つ増える**（例外は 21 になった）── `gitConflictDiffRepository.test.ts`。確かめたいことの向きは、3-8-20 の「PC ごとの設定に振る舞いを左右されないこと」ともまた違う ── **どの操作が、index にどの段の組み合わせを作るのか**になる。

競合の形（`UU` / `AA` / `UD` / `DU` / `DD` / `AU` / `UA`）を決めているのは git 自身で、こちらの推測ではない。写しを相手にすると、**自分で書いた前提を自分で確かめる**ことになる ── とくに `DD`（両方で削除）と `AU` / `UA`（片方だけが作った）は、「そんな状態が本当に起こるのか」自体が実物でしか言えない。実物にしか確かめられないのは次の 14 個。

1. 内容の競合（`UU`）で、左に ours・右に theirs の中身がそのまま出ること
2. その中身が**作業ツリーの中身とは違う**こと（`<<<<<<<` の入った混ざった中身ではない）
3. `AA`（両方が追加）には base の段が無く、それでも両側に中身があること
4. `UD`（theirs が削除）では**右が空**になり、失敗にはならないこと
5. `DU`（ours が削除）では**左が空**になること
6. 改名先が食い違うと `DD` / `UA` / `AU` が**同時に**現れること（1回のマージで3行）
7. `DD` では両側とも空、`UA` / `AU` では片側だけが空になること
8. 「片方が rename・片方が削除」は `DD` ではなく**改名先の `DU`** になること
9. バイナリの競合が `binary` として返ること（失敗にしない）
10. submodule（mode `160000`）の競合が `unsupported-target` として返ること
11. 競合していない位置は `not-found` になること（差分の口が別なことの裏取り）
12. 解決済みにした後、同じ位置が `not-found` になること（段が1段に畳まれる）
13. `merge --abort` の後も `not-found` になること
14. **差分を読んでも、index の段も作業ツリーも1バイトも動かないこと**

**8 は、このセッションで実際に推測が外れたところになる。** 最初は「片方が rename・片方が削除すれば元の位置が `DD` になる」と書いてテストを置き、空振りした ── git はそれを**改名先に `DU` として置く**（元の位置に競合は残らない）。`DD` が本当に出るのは**改名先どうしが食い違ったとき**で、そこでは3行が同時に現れる。外れた側も答えの側も両方テストに残してある。

**14 が 3-8-21 の線そのもの**にあたる。`checkout --ours` / `--theirs` を置かないと決めた以上、この経路がリポジトリを動かさないことは「置かなかった」ではなく**測れる**ものになる ── 段の中身・`status` の出力・`MERGE_HEAD` の3つを、差分を読む前後で突き合わせる。

**submodule の競合を作るには、2つの落とし穴を越える必要がある。** 1つめは `git submodule add` が同じ PC のパスを既定で断ること（CVE-2022-39253）で、**local config に書いても効かない** ── clone を行う子プロセスへ引き継がれないため、`-c protocol.file.allow=always` を引数で渡す。2つめは submodule 側の2つの commit を**枝分かれさせる**ことで、一直線に積むと片方がもう片方の子孫になり **git が勝手に早送りして競合しない**（これも空振りして気づいた）。どちらもテストの準備でだけ立てるもので、本番の引数の表には1つも入らない。

**Session 3-8-22A では、この塊にファイルが2つ増える**（例外は 23 になった）── `gitInProgressRepository.test.ts` と `gitFetchRepository.test.ts`。ここで確かめたいことは 3-8-16 の「何が消えるか」とも 3-8-20 の「アプリが引数で決めたこと」とも違い、**アプリが手前で断つ理由が本当に在るのか**になる。実物にしか確かめられないのは次の 25 個（検出と禁止で 16・fetch で 9）。

途中の操作の検出と禁止（`gitInProgressRepository.test.ts`）:

1. `MERGE_HEAD` があるあいだ `inProgress` が `merge`
2. rebase が止まっているあいだ `inProgress` が `rebase`（HEAD は detached）
3. **rebase が完了すると `REBASE_HEAD` は残るのに、途中ではなくなる**
4. rebase を中止すると `REBASE_HEAD` も消える（消え方が2通りある）
5. cherry-pick が止まっているあいだ `inProgress` が `cherry-pick`
6. revert が止まっているあいだ `inProgress` が `revert`
7. **解決し終えた（index がきれいな）マージでも `inProgress` は `merge` のまま**
8. 逆に `stash pop` の競合では、競合があっても `inProgress` は null
9. **そこで git は `stash push` を通してしまう**（＝アプリが手前で断つ理由）
10. 一方 `switch` は git が最後まで断る（**退避とは振る舞いが違う**）
11. アプリの `switch` / `create-branch` / `stash push` / `pull` は `operation-in-progress` として断り、ref も退避も1つも増えない
12. **Stage / 解決 / Commit は断らない**（マージの出口に要る手）── 通せばマージ commit（親が2つ）ができて `MERGE_HEAD` が消える
13. fetch はマージの途中では通り、rebase の途中では断る
14. rebase の途中では Stage も Commit も解決も断り、HEAD が1mm も動かない
15. rebase を終えれば、また通るようになる
16. マージ commit の既定メッセージが読め、コメント行が落ちている

fetch（`gitFetchRepository.test.ts`）:

17. remote に増えた枝が、手元の `refs/remotes/` に現れる
18. **`--prune` で、相手から消えた枝が手元の一覧からも消える**
19. ローカルブランチと commit は1つも失われない（消えるのは追跡の写しだけ）
20. **HEAD も index も作業ツリーも動かない**（取り込まない）
21. **追跡先が無いブランチでも通る**（Pull が断る条件が当てはまらない）
22. detached HEAD でも通る
23. remote が1つも無くても失敗にしない
24. 取ってきた結果が `behind` として状態に出る
25. Workspace が閉じられていれば git を動かさない

**9 と 3 がこの回の要点にあたる。** どちらも書く前の見立てを実物が否定したもので、写しを相手にしていたら気づけなかった。

- **9**：3-8-20 は「競合が残っている間は git が断る」を根拠に切り替えと退避を止めていなかった。だが解決し終えた一瞬は index がきれいで、そこでは `git stash push` が通り `MERGE_HEAD` が黙って消える。**これが無いと 3-8-22A の禁止表は過剰な用心にしか見えない。**
- **3**：4つを揃えて `REBASE_HEAD` で読もうとしていた。**その ref は rebase が完了しても消えない**（`--abort` では消える）── そのまま出していたら、1度 rebase を完了した時点から Git パネルが永久に「rebase の途中です」になり、書き込みが1つも通らなくなっていた。読むのは git 自身が見ている作業場所のフォルダ（`rebase-merge` / `rebase-apply`）に改めた。

**10 は逆向きの記録になる。** 切り替えは git が最後まで断った ── それでも手前で断つのは、①断り方を1つに揃えるため（`operation-in-progress`）、②押した先で必ず失敗するボタンを残さないため、③**どちらを通すかは git が決めていて版で変わりうる**ため。

確認の要領（この回で分かったもの）:

- **「途中かどうか」は ref だけで測らない。** 4つのうち3つ（`MERGE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD`）は完了時に git が消すが、`REBASE_HEAD` だけ残る。**同じ形に見えるものを揃えて書く前に、4つとも完了後の状態まで測る。**
- **rebase / cherry-pick / revert の fixture は素の git で作る。** アプリはこの3つを始められない（始める機能を持たない）ので、端末から始めたものをアプリが見つける、という実際の経路と同じ形になる。
- **`rebase --continue` はエディタを開く。** テストの中では開く相手が居ないので `-c core.editor=true` を渡す ── アプリはこの経路を持たないため、本番の引数の表には1つも入らない。
- **競合の7通りは rename / rename で3つまとめて作れる。** `DD` / `AU` / `UA` が1回のマージで同時に出る（`AA` は「両方が同じ位置を足す」で別に作る）── そして **`DD` だけが作業ツリーにファイルを持たない**ことが、`canOpenGitChange` を直した理由そのものになる。
- **`git status` の `mW`（作業ツリー側のモード）は「ファイルが在るか」を言わない。** 無くても `100644` が入る（rename / delete の競合で確かめた）── 形（`XY`）の側で判断する。

#### 例外: DOM を触るテスト（Session 4-3B）

実ディスクとは別の種類の例外が1つある。`SettingsOverlay.dom.test.ts` だけは jsdom（`@vitest-environment jsdom` をファイル冒頭の docblock で指定）で React を実際に描く。**Settings 画面で確かめたいことが「値が2箇所から同じ1つを指しているか」だから**にほかならない ── 値のモデルだけを見ても、Context の繋ぎ方を1本間違えれば「Settings で変えたのに Files パネルが変わらない」は起きるし、それは型でも捕まらない（props が増えていないのだから型は通る。Session 3-8-22B で退避の面に `inProgress` を渡し忘れていたのと同じ抜け方にあたる）。IPC（`api/fluvix`）だけは `vi.mock` で差し替える ── Electron をテストへ持ち込まない線は変えていない。

DOM を使うのはこの1本だけに留める。**ここで見るのは繋ぎ方であって、見た目ではない** ── 描画そのものの確認は実機（次節）に任せる方針は変わらない。

#### 実 git を起動するテストの待ち時間（Session 3-8-20 で明示した）

3-8-20 で状態の読み取りに `rev-parse --verify MERGE_HEAD` が**1本増えた**（§14.28）。1回の書き込み操作は前後で状態を読み直すので、増えるのは操作あたり2本になる ── そのぶん実 git の塊が全体で1割ほど遅くなり、**vitest の既定（5 秒）で落ちるテストが出た。**

落ちたのは重い塊（Push / Pull・退避）で、**単独では通り、110 本のテストファイルを並べたときだけ落ちる** ── つまり既定の 5 秒に元から余裕が無く、この1本で足りなくなったことになる（プロセスの起動そのものが Windows では重い）。

そこで**実 git を起動するテストファイルにだけ**明示の上限を掛けてある。

```ts
const REAL_GIT_TIMEOUT_MS = 30_000

describeWithGit('applyGitMergeBranch', { timeout: REAL_GIT_TIMEOUT_MS }, () => { … })
```

**vitest.config.ts の既定は動かさない。** 全体へ広げると、純粋なロジックのテスト（95 本ほど）まで 30 秒待つことになる ── あちらは 5 秒で落ちてくれた方がよく、本当に返ってこなくなったことに早く気づける。速さを確かめるテストではないので、上限は「固まったと分かる」までの長さで足りる。

**hook は `#!/bin/sh` のスクリプトで置ける**（Git for Windows は付属の sh で走らせる）。`exit 1` で止める hook、何も言わずに落ちる hook、`sleep` で遅い hook の3つを作れば、分類・迂回しないこと・待ち時間の上限のすべてが確かめられる。

**Session 3-8-22A で、状態の読み取りはさらに最大3本増えた**（§14.30.2）── 途中の操作を4つまで順に尋ねるためで、**見つかった時点で止まる**ので増えるのは「何も途中でないとき」だけになる（マージの途中なら 3-8-20 と同じ1本）。上限（30 秒）は動かしていない ── 3-8-20 で決めた理由（本当に返ってこなくなったことに気づけるまで）がそのまま当てはまる長さで、実測でも実 git の塊は 20 秒前後に収まっている。

**差分（Session 3-8-9）で実物に確かめさせるのは、「どの側を、どこから取るか」になる。** `gitBlob.test.ts` が固定するのは「この出力をどう読むか」までで、**git が実際にどの出力を返すか**は誰も確かめていない ── 差分ではそこが答えのほとんどを占める。実物で見ているのは次の6つ。

1. グループごとの表（staged は HEAD と index、unstaged は index と作業ツリー、untracked は空と作業ツリー）が**種類ごとに正しい**こと ── rename の左が**元の位置**の中身になること、削除の右が空になること、追加の左が空になること
2. **初回 commit 前**（HEAD がまだ無い）でも staged の差分が出せること
3. 同じファイルが2つのグループに並んでいるとき、**押した行ごとに違う差分**が返ること（`MM` の状態を作って、両方を取る）
4. `core.autocrlf` が効いている環境で、**1行も書き換えていないのに全行変更として出ない**こと
5. バイナリ・2MB 超が、失敗ではなく理由として返ること（**index 側と作業ツリー側の両方**で ── 経路が別）
6. 衝突しているファイルが、どのグループにも居ないこと（差分を出す対象にならない）

**破棄（Session 3-8-9）で確かめるのは、「消えたか」ではなく「消えなかったものが残っているか」になる。** これは Git 機能で唯一、利用者の書いたものが消える操作にあたる。実物で見ているのは次の5つ。

1. 「変更」を破棄しても **index が1バイトも動かない**こと（`git restore --worktree` に `--staged` を渡していないことの現れ。`git show :<path>` で index の側を直接読む）
2. 押した1件の外側（隣のファイル・`.gitignore` の対象・隣の未追跡）に手が出ないこと
3. 未追跡が **git ではなくごみ箱**へ行くこと（`git clean` を使っていない）
4. 未追跡の**フォルダ1件**が、数万件の削除に化けないこと
5. 押すまでの間にグループが変わっていたら、**git を動かさない**こと（端末で `git add` された後に「変更」の行を押した場合）

**初期化と公開（Session 3-8-10）では、外の世界だけを差し替える。** `git init` の側は他と同じで、実物に確かめさせるのは「git が実際に何を作るか」になる ── 初期ブランチ名をアプリから渡していないこと（その PC の `init.defaultBranch` がそのまま効く）、**commit も `.gitignore` も remote も作られない**こと、既にリポジトリなら作り直さないこと、リポジトリの中のサブフォルダでは初期化しないこと。

公開の側は事情が1つ違う ── 相手が GitHub になる。そこで **repository を作る側だけを差し替える**（`setGitHubRepositoryPublisher`）。差し替えた実装がすることは1つで、同じ PC に bare リポジトリを作ってその場所を「remote の URL」として返すだけになる。git にとってそれは他の remote と何も変わらないため、`remote add` と `push --set-upstream` は**本番と同じ経路**を通る（`gitSyncRepository.test.ts` が Push / Pull で bare な remote を使っているのと同じ形）。

こうすると、GitHub CLI が入っていない PC でも・回線が無くても、次を実物に対して固定できる。

1. 公開が「作る → remote → Push」の順で通り、**追跡先まで設定される**こと
2. commit が無い / detached HEAD では、**外に物を作らずに断る**こと（作る側が1度も呼ばれないことで測る）
3. 同じ名前が既にあるときに remote を設定しないこと
4. Push だけが通らなかったとき、`partly-applied` として返し **remote は残す**こと（続きを Push ボタンからやり直せる）
5. **remote が既にあれば作り直さず、続きの Push だけを行う**こと（`origin` を上書きしない）

gh そのものの振る舞い（引数・出力の読み方・失敗の文言）は、この塊の外で純粋なテストとして固定してある ── 逆に言えば、**gh を実際に動かすテストは1つも無い。** ネットワークと利用者のアカウントに触れるものは、production 実機での確認（§4）に回している。

**履歴（Session 3-8-11）で実物に確かめさせるのは、「git が実際に何を返すか」になる。** `gitOutput.test.ts` が固定するのは「この文字列をこう読む」までで、**git が本当にその文字列を出すのか**は誰も確かめていない ── 書式（`%h%x00%an%x00%at%x00%P%x00%s`）をどう解釈するかを決めるのは実装ではなく git だからで、写しを相手にするとその答えを自分で書くことになる。実物で見ているのは次の6つ。

1. **commit が1つも無いリポジトリで、失敗にならない**こと（`git log` はそこで非0で終わる ── 空の `ready` として返るのは、動かす前に HEAD を確かめているため）
2. 要約に空白・記号・日本語・**空**が入っても、名乗りや日時の欄がずれないこと
3. マージ commit の親が **2** として返ること（`%P`）
4. 日時が**リポジトリの設定に振り回されない**こと（`log.date` を立てても `%at` は epoch のまま）
5. 上限（100）で切られ、切られたことが `truncated` で分かること
6. **rev を渡していない**こと ── ブランチを切り替えると、履歴もそちらのものになる

5 だけは commit を 101 件積む必要があり、ブランチ（`update-ref --stdin`）のように1回の git へまとめる手立てが commit には無い ── `--allow-empty` を回数ぶん動かすため、**その1件だけ待ち時間の上限を延ばしてある**（約6秒かかる）。

**commit 1件の中身（Session 3-8-12）でも同じ形を採る。** `gitOutput.test.ts`（`readCommitFileChanges`）が固定するのは「この塊をこう読む」までで、**git が本当にその形を出すのか**は誰も確かめていない ── `--raw` の欄の並びも、`-z` の区切り方も、`--find-renames` が rename を1件に畳むことも、決めるのは実装ではなく git になる。実物で見ているのは次の7つ。

1. `--raw` の1件から**両側の object 名**が取れること（差分がそこから読める ── 省略されていたら `cat-file` に渡せない）
2. `--find-renames` で rename が**1件**として返ること（付けなければ「消えた＋足された」の2件に割れる）
3. `--root` で、**履歴のいちばん最初の commit** が全部追加として返ること（付けなければ何も出力されない）
4. マージ commit が `merge` として返ること ── `diff-tree` は**何も出さずに 0 で終わる**ので、親の数で分けていなければ「変更が1件も無い commit」に見える
5. 短い hash を渡して commit が**解けること**と、解けないとき・rev 表記が来たときに `not-found` になること
6. 上限（500）で切られ、切られたことが `truncated` で分かること
7. submodule（mode 160000）が**一覧には出て、差分では `unsupported-target`** になること

6 は 503 件のファイルを作る必要があり、**その1件だけ待ち時間の上限を延ばしてある**（30 秒）。7 は `update-index --cacheinfo 160000,...` で gitlink を仕込む ── 本物の submodule を用意すると clone が要り、ネットワークに触れる。

**ごみ箱だけは差し替える。** `shell.trashItem` を本物で呼ぶと、実行するたびにごみ箱が汚れる ── `mutateWorkspaceEntry.test.ts` と同じく、**呼ばれた絶対パスを記録して実体を消す**偽物を置く。記録が残るので「ごみ箱を通ったこと」自体もそのまま確かめられる（`git clean` に切り替わっていれば記録が空になる）。

書き換え側（`mutateWorkspaceEntry.test.ts`）で Electron に触れるのは `shell.trashItem` の1つだけを差し替える（ごみ箱へ入れる代わりに、リンクなら外し、それ以外は消す）。モックが薄く済むのは、この層が Electron をほとんど使っていないため。ジャンクション（Windows では管理者権限なしで作れる）を使った境界の確認も同じファイルに置いてあり、作れない環境ではその塊だけ飛ばす。

**名前の規則（`shared/files/fileName.ts`）と相対位置の扱い（`shared/files/relativePath.ts`）は shared にある。** shared は原則として型と定数だけを持つが、この2つは Main と Renderer が同じ答えを見る必要がある純粋な文字列の判断で、2箇所に書くと片方だけ直された時点でずれる（理由は ARCHITECTURE.md §10.1）。テストもそこに置いてある。

**Renderer の IPC 入口（`api/fluvix.ts`）は読み込み時に `window` を見ない。** Panel Registry から辿れる範囲に IPC を呼ぶパネル（Files）が入ったため、レイアウトの純粋なロジックを試すテスト（node 環境）からもこのモジュールが読み込まれる。読み込むだけで落ちる形にしておくと、IPC を呼んでいないテストまで環境の都合で書けなくなる。

**Monaco も同じ理由で遅延して読み込む。** Monaco は読み込まれた時点で `window` を触るため、`EditorDocumentView.tsx` から静的に import すると Registry を辿るテストが軒並み落ちる。`React.lazy` にしてあるのと、`monaco/documentStore.ts` が `import type` だけで Monaco を参照しているのはこのため（ARCHITECTURE.md §11.3）。Monaco 本体の組み込み（Worker・テーマ・Model の差し替え）は起動確認で見る。

#### 統合テスト（Session 2-7）

層ごとの単体テストは各ディレクトリの隣にあるが、それだけでは「繋いだ瞬間に壊れる」種類の不具合（ノード id の衝突、正規形の崩れ、保存 → 復元で落ちる情報）が見つからない。そこで **Dock → Drag & Drop → Split → タブ順 → activePanel → 閉じる → 再表示 → Resize → 保存 → 再起動 → 復元 → 再操作 → 初期化 → 再起動** を1本の流れとして通すテストを `workspace.integration.test.ts` に置く。

- 1操作ごとに `findLayoutProblems` が空であること（正規形）とパネルの重複が無いことを確かめる
- 「再起動」は保存形式の JSON 往復として表す。Renderer から Main を参照できない（層の分離）ため、Main が見るエンベロープの検証は `src/main/store/workspaceLayoutDocument.test.ts` が受け持つ
- 異常な保存データ（未対応 schemaVersion / 不正 PanelId / 不正 DockNode / 重複 PanelId / 空の PanelGroup / 極端に小さい size）については、**失敗した後も通常の操作と保存がそのまま続くこと**を見る。何を失敗とみなすか自体は `persistence/layoutDocument.test.ts` の担当

ドラッグ&ドロップは「座標の解釈（`dnd/dockGuide.ts`）」「操作への翻訳（`dnd/dropTarget.ts`）」「マウスの追跡（`dnd/usePanelDrag.ts`）」に分かれている。前2つは DOM を持たない純粋関数なのでここでテストし、実際にマウスを動かす必要がある3つめは次節の起動確認で見る。

境界のリサイズも同じ分け方で、判断（`layout/resize.ts` と `layout/constraints.ts`）はここでテストし、ポインタの追跡（`resize/useSplitResize.ts`）は起動確認で見る。

レイアウトの永続化も同じで、形式の変換と検証（`persistence/layoutDocument.ts` / `persistence/restoreLayout.ts` / `store/workspaceLayoutDocument.ts`）はここでテストし、実際に書き込まれて次回起動で戻ることは起動確認で見る。

#### Breakpoint（Session 6-3）

DAP の周りは 6-1 / 6-2 と同じ分け方で、**Electron も子プロセスも使わない層**だけをここで見る。

- `src/shared/debug/breakpoint.test.ts` — 行として受け取れる値・同一性・並び・取り出し
- `src/main/debug/breakpointModel.test.ts` — **入れ替え / 重複 / 上限 / adapter の答えの当て方**（同じ位置を続けて押しても増えないこと・上限に達していても外せること・**Renderer へ返る形に adapter の文言と動かされた行が載らないこと**・送った順で verified を当てること・数が合わない答えで前半まで捨てないこと・セッションが終われば忘れること）
- `src/main/debug/breakpointSource.test.ts` — **相対位置 → DAP の `Source`**（`..` / 絶対パス / ドライブ相対 / 代替データストリーム / NUL / UNC を断つこと・**まだ存在しないファイルにも印を置けること**・`Source.path` が URI ではないこと）
- `src/main/debug/dapBreakpoints.test.ts` — `setBreakpoints` の要求と応答（`breakpoints` と `lines` の両方を載せること・`sourceModified` が常に false・**壊れた応答・`verified` を省いた応答・数の食い違いで落ちないこと**）
- `src/main/debug/breakpointSync.test.ts` — 1ファイルぶんの送信（失敗 / 切断 / 壊れた応答を「答えが無かった」に畳むこと）
- `src/main/debug/debugSessionBreakpoints.test.ts` — **lifecycle への差し込み**（`initialized` の後・`configurationDone` の前であること・仕込みが失敗しても running まで進むこと・**仕込みが無ければ 6-2 の順序が1 tick も変わらないこと**・口が `running` / `stopped` のときだけ返ること・前のセッションの口が `closed` を返すこと）
- `src/main/store/debugBreakpointsDocument.test.ts` — **保存ファイルの検証**（エンベロープが読めなければ文書ごと捨てる・**1件が壊れても他は残る**・重複を畳む・件数と Workspace 数の上限・古い Workspace から落ちること）
- `src/renderer/src/editor/debug/breakpointDecorations.test.ts` — 印の見え方（**`null` を「置けない」と同じ見た目にしないこと**・16進数の色を持たないこと・文言ではなく翻訳キーを返すこと）
- `src/renderer/src/editor/debug/breakpointGlyphs.test.ts` — **glyph margin の面**（左クリック / glyph margin 以外では何も起きないこと・印の増減・**ファイル切替で当て直すこと**・行数が変わる編集の後に置き直すこと・捨てると購読も decoration も残らないこと）

**Monaco は読み込まない。** 叩く相手を構造的部分型で受けているため、偽のエディタで glyph margin の click も decoration の増減も通せる（`editor/lsp/editorActions.ts` と同じ形）。実際に Monaco の帯が出て押せることは起動確認で見る。

**実 adapter との往復はここに置かない。** Session 6-3 の確認では、DAP を話す小さな Node スクリプトを一時的に adapter として立て、`initialize → launch → initialized → setBreakpoints → configurationDone → running` を本物の子プロセスと本物の `Content-Length` フレーミングで通した（結果は §4）。リポジトリのテストは 6-1 / 6-2 と同じく spawn を差し替えた形のままにしてある。

#### Execution Control（Session 6-4）

- `src/main/debug/executionControl.test.ts` — **状態ごとの許可 / 拒否の表**（idle は `no-session`、starting / terminating は全部 `invalid-state`、running は Pause だけ、stopped は Continue / Step だけ）・**閉じた集合の外の名前を通さないこと**・app-domain の名前 → DAP の command（`stepOver` → `next` など）・`threadId` の読み取り・`terminateDebuggee` を名乗る adapter にだけ載せること・**Stop の段の決め方**（terminate を名乗れば terminate、名乗らなければ / starting なら disconnect、2回目は disconnect、disconnect 中は待つだけ）
- `src/main/debug/debugSessionControl.test.ts` — Manager を通した**実行制御と Stop**
  - 6つの制御がそれぞれ正しい DAP request と `threadId` になり、running ↔ stopped が動くこと
  - `busy`（答え待ちの間の2通目）・**応答より先に次の `stopped` が届いたら running へ戻さないこと**・`continued` が先に届いても二重に遷移しないこと・adapter の失敗の文言が結末に載らないこと・`timeout` の後に遅れた答えを当てること
  - **stale generation**（前のセッションへ送った制御の答えが、新しいセッションを動かさないこと・前のセッションのスレッドを使い回さないこと）
  - Stop の各段（disconnect のみ / terminate → terminated → disconnect / **2回目の Stop で disconnect へ** / terminate の失敗 / debuggee が拒んだまま猶予切れ / disconnect に答えない adapter の kill / Stop 中に adapter が閉じる・落ちる / starting 中の Stop で `configurationDone` を送らないこと）
  - **cleanup との競合**（Stop の途中で Workspace 切り替え / アプリ終了が走っても `disconnect` は1通・タイマーが次のセッションへ漏れないこと）・6-2 の「adapter が自分で終わった」経路が変わっていないこと・terminating 中は breakpoint の口が閉じること
  - **本物の子プロセス**（stdio の mock adapter）で pause → step ×3 → continue → pause → Stop を通し、adapter が受け取った request の列と、adapter のプロセスが消えたことを確かめる
- `src/preload/api/debug.test.ts` — **preload が経路だけであること**（6-4 時点の9関数に、6-5 の `listCallStack` / `onCallStackChanged` が足されたこと・6つの制御は何を渡されてもチャンネル名だけを送ること）。`electron` の `ipcRenderer.invoke` 1つだけを差し替える

#### Call Stack（Session 6-5）

- `src/main/debug/dapThreads.test.ts` — `threads` 応答の検証（複数 thread・壊れた body / id / name を落とすこと）
- `src/main/debug/stackFrameSource.test.ts` — stack frame source の安全化（Workspace 内の絶対パス / file URI → `relativePath`、Workspace 外 / missing / malformed / NUL は `unavailable`）
- `src/main/debug/dapStackTrace.test.ts` — `stackTrace` 応答の検証（line / column の正の整数だけを通すこと・壊れた frame を落とすこと・`sourceReference` を Renderer 形へ出さないこと）
- `src/main/debug/callStack.test.ts` — stopped → threads → stackTrace → snapshot、multiple threads、continued / running / adapter error / exit / terminated / exited / Workspace switch / cleanup で clear、stale session generation / stop generation の破棄
- `src/main/debug/debugSessionCallStack.test.ts` — Manager を通した Call Stack channel（stopped の間だけ開くこと・次の停止で古い channel が閉じること・本物の stdio mock adapter で stopped → threads → stackTrace → continue → clear が通ること）
- `src/renderer/src/debug/callStackNavigation.test.ts` — frame 選択が `EditorContext.openFileAt` に `relativePath` / line / column だけを渡し、Workspace 外 frame を開かないこと
- `src/renderer/src/debug/CallStackView.dom.test.ts` — Call Stack 表示と frame ボタンの有効 / 無効、開けない source の表示

6-6 Variables は `getDebugCallStackFrameHandle()` から現在の Workspace・session generation・stop generation・stopped state と一致する frame だけを受け取る。Scopes / Variables 自体は Session 6-5 では実装していない。

#### Variables / Scopes（Session 6-6）

- `src/main/debug/dapVariables.test.ts` — `scopes` / `variables` 応答の正規化（入れ子・`variablesReference = 0`・named / indexed の数・壊れた Scope / Variable / 応答・`presentationHint` を閉じた集合へ畳むこと・`evaluateName` / `memoryReference` / 位置参照 / `Scope.source` を Renderer 形へ出さないこと・上限より先を読まないこと・値の制御文字と長さ）、`supportsVariablePaging` を名乗る adapter にだけ `start` / `count` を載せること
- `src/main/debug/variables.test.ts` — handle 表（有効な handle・未知の handle・**生の `variablesReference` を拒否**・stale session generation / stop generation / Workspace / frame・Call Stack snapshot の差し替えで無効・handle の上限）、lifecycle（stopped の間だけ・running / terminating / idle で clear・新しい stopped・Workspace switch・応答が返る前に再開 / 次の停止 / Workspace switch が起きたら handle を発行しないこと）
- `src/main/debug/debugSessionVariables.test.ts` — Manager を通した Variables channel（stopped の間だけ開くこと・次の停止 / `continued` / cleanup で古い channel が閉じること・paging capability の読み取り）と、**本物の stdio mock adapter** で initialize → launch → initialized → setBreakpoints → configurationDone → stopped → threads → stackTrace → scopes → variables → 入れ子 → continue → 次の停止（同じ番号の再利用）で古い handle が `stale` になり adapter へ届かないこと
- `src/main/ipc/handlers/debug.test.ts` — `debug:list-scopes` / `debug:list-variables` の形の検査（正の整数でない `frameId`・文字列でない `handle` は INVALID_REQUEST、`frameId` / `handle` 以外を Main の処理へ渡さないこと）
- `src/preload/api/debug.test.ts` — `listScopes` / `listVariables` が `frameId` / `handle` 以外を送らないこと、setVariable / memory を名乗る関数が無いこと（関数の数は 6-6 時点で13。Closing 時点のテストは22を確かめる）
- `src/renderer/src/debug/callStackSelection.test.ts` — 既定の frame（止まった thread の最上段）、選択を snapshot の版に結び付けること
- `src/renderer/src/debug/variablesTreeModel.test.ts` — lazy expansion・閉じても控えること・empty / truncated / unavailable・遅れた応答を当てないこと
- `src/renderer/src/debug/VariablesView.dom.test.ts` — Scope / Variable 表示、入れ子の展開 / 折り畳み、loading / empty / unavailable、snapshot の差し替えで clear・遅れた応答を捨てること、frame 選択への追従、ARIA tree とキーボード
- `src/renderer/src/debug/CallStackView.dom.test.ts` — 6-5 の「Workspace 外 frame を開かない」を保ったまま、**押せる（選べる）が開かない**形に変えた（6-5 では disabled）。選択中の frame の `aria-current`

#### Debug Status（Session 6-9）

- `src/shared/debug/status.test.ts` — セッションの状態 × adapter の有無の重ね方（動いていれば adapter を見ない・`unavailable` は idle の上だけ）、閉じた集合が6語だけで `failed` / `paused` のような別名を持たないこと
- `src/main/debug/sessionStatus.test.ts` — 起動時は配らないこと・**payload が1語だけ**であること・同じ tick の変化を1本にまとめてその時点の状態を送ること・同じ語を続けて送らないこと・公開するのが読む関数と配り始める関数だけであること・既定が `idle`（Session 6-12 で python 行が統合されたため。6-9〜6-11 は `unavailable`）
- `src/main/debug/adapterCatalog.test.ts` — `hasIntegratedDebugAdapter`（統合された行が無ければ false、1行でもあれば true。出荷状態は python が統合されているので true）
- `src/main/ipc/handlers/debug.test.ts` — `debug:get-status` が要求に何が載っていても読まず、`{ status }` だけを返すこと
- `src/preload/api/debug.test.ts` — `getStatus` が何を渡されてもチャンネル名だけを送ること（関数の数は 6-9 時点で17）
- `src/renderer/src/debug/debugStatusLabels.test.ts` — 6語すべてに日英の言葉があること・言い回しが重ならないこと・**`stopped` を Paused / 一時停止中 と書き、Stopped / 停止中 と書かないこと**
- `src/renderer/src/debug/DebugStatusItem.dom.test.ts` — 最初の1回を読む・通知で置き換わる・**先に届いた通知が遅れた読み込みに勝つ**・読めなければ何も出さない（既定の語を作らない）・**閉じた集合の外の語やパスを描かない**・押せない・表示言語の切り替えに追従する・外すと購読も外れる

#### Debug Profile / `debug:start`（Session 6-10）

- `src/shared/debug/profile.test.ts` — 言語が閉じた集合であること、id は Main の発番の形（`dp-<小文字の uuid>`）だけを通すこと
- `src/main/debug/environmentPolicy.test.ts` — §20.9 の10個を**大文字小文字を問わず**断ること（`Path` / `node_options`）・名前の形・大文字小文字だけ違う重複・値の NUL / 長さ / 件数・`__proto__` が prototype を変えないこと・adapter のプロセスの環境から `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` を落とすこと
- `src/main/debug/profileValidation.test.ts` — **6欄から作り直す**こと（`cwd` / `runtimeExecutable` / `adapter` / `console` / `preLaunchTask` / `processId` が消える）・値を trim しないこと・欄ごとの理由（絶対パス / UNC / `..` / ドライブ相対 / file URI / NUL / root そのもの・禁じた環境変数・言語の集合）
- `src/main/debug/programPath.test.ts` — **実ディスク**で2段を確かめる（Workspace 内のファイル → realpath・外を指すジャンクションは保存時も起動時も `outside-workspace`・中を指すリンクは通る・無いファイルは保存時は通り起動時は `not-found`・root が消えたとき・文字列の段で断ったら realpath を呼ばないこと）
- `src/main/debug/profileResolver.test.ts` — 解決済みの形全体・**`programArgs` が adapter のコマンドラインに一語も現れないこと**（§20.4）・profile の env が adapter のプロセスへ入らないこと・profile に付いた余計な欄が効かないこと・解決時にもう一度断ること（禁じた環境変数 / 絶対パス / 外を指す実体 / 無いファイル）・`not-integrated` の行と PATH に無い adapter と相対の PATH 項目で `adapter-unavailable`・**adapter のプロセスの cwd が Workspace の外で、プログラムの cwd は Workspace root のままであること**（cwd が Workspace root / 大小違いの realpath / Workspace の中 / 相対 / 空なら `adapter-unavailable`。Session 6-12）・**出荷状態の python 行が `python -m debugpy.adapter` と `type: debugpy` / `subProcess: false` に解けること**・**出荷状態の csharp 行が `netcoredbg --interpreter=vscode` と `type: coreclr` / `stopAtEntry` / `user-unhandled` / `waitForLaunchResponseBeforeConfiguration` に解けること**・profile に `python` / `subProcess` / `justMyCode` / `debuggerPath` / `pipeTransport` を載せても launch に届かないこと・python 以外の言語に `subProcess` が載らないこと
- `src/main/debug/adapterCatalog.test.ts` — `resolveDebugAdapterExecutable`（出荷状態の node 行は PATH の `node.exe` へ解け `.cmd` の shim を包まない（Session 6-15B）・python 行は PATH の `python.exe` へ解ける（Session 6-12）・csharp 行は PATH の `netcoredbg.exe` へ解ける（Session 6-14）・`.exe` を直接・`.cmd` を `%SystemRoot%` の cmd.exe で包む・`%SystemRoot%` が無ければ名前だけの cmd.exe に落とさない・相対の PATH 項目を辿らない・表の名前が区切りを含めば解かない）
- `src/main/debug/debugProfiles.test.ts` — id を Main が発番し draft の id / 余計な欄を使わないこと・今の Workspace の分だけを返し key を載せないこと・書いた直後の一覧が控えから読めること・保存時の検証（外を指すリンクを含む）・上限・別の Workspace の id を更新 / 削除 / 起動できないこと・起動に解決済みの形（adapter の cwd は Main が渡す Workspace の外のフォルダ）が渡り応答が `started` だけであること・動いている間は解決せずに断ること・起動時の再検証・spawn の文言を応答に載せないこと
- `src/main/store/debugProfilesDocument.test.ts` — エンベロープが壊れていれば文書ごと捨てる・**保存時と同じ検証で1件だけを落とす**（発番の形でない id / 絶対パス / `..` / 禁じた環境変数）・余計な欄を落とす・id の重複・Workspace の上限
- `src/main/ipc/handlers/debug.test.ts` — 5本の登録・`debug:start` が `profileId` 以外を読まないこと・形の壊れた id / object でない `profile` は INVALID_REQUEST で Main の処理へ届かないこと
- `src/preload/api/debug.test.ts` — 22関数になったこと・`start` が `profileId` だけ、編集が `profile` / `profileId` だけを送ること

#### Debug Toolbar / Profile editor（Session 6-11）

- `src/renderer/src/debug/debugToolbarModel.test.ts` — status ごとの Toolbar button matrix・Profile form ↔ draft の変換・`programArgs` を shell 文字列として扱わないこと・safe な message key への変換
- `src/renderer/src/debug/DebugToolbar.dom.test.ts` — Profile selector が名前と言語だけを表示すること・raw path / adapter 情報を描画しないこと・Start が `profileId` だけを渡すこと・create / update / delete・validation failure・unavailable・accessibility・Command Registry の登録条件
- `src/renderer/src/commands/registry.test.ts` / `commandLocalization.test.ts` — `debug.*` command と debug category の登録・日英の command 名（6-11 で10件、6-16 で12件）
- `src/renderer/src/settings/KeyboardShortcuts.dom.test.ts` — Debug command が Keyboard Shortcuts 一覧に並ぶこと（6-11 時点ではすべて未割り当て。6-16 で6件に打鍵が付いた）

#### Exception Stop / Current Execution Location（Session 6-13）

- `src/main/debug/stopInfo.test.ts` — `stopped` の reason を閉じた集合へ畳むこと（breakpoint / step / pause / entry / exception・breakpoint の種類違い・unknown・壊れた body）・`exceptionInfo` の読み取り（実 debugpy の形・壊れた応答・知らない breakMode）・`details.stackTrace` / `source` を読まないこと・読めないときに stopped event の `text` / `description` へ落ちること・**絶対パス / file URI / UNC / POSIX のパスを伏せ、Workspace の中は相対位置へ直すこと**（Python の repr の二重区切りを含む）・1行への畳みと上限
- `src/main/debug/dapExceptionBreakpoints.test.ts` — adapter が名乗った filter との積だけを送ること・`default: true` を当てにしないこと・名乗らない / 表が空なら送らないこと
- `src/main/debug/debugSessionExceptions.test.ts` — `setExceptionBreakpoints` が `setBreakpoints` の後・`configurationDone` の前であること・filter が無ければ 6-12 の順序が変わらないこと・断られても running まで進むこと・待っている間の Stop で `configurationDone` を送らないこと・stopped listener と Call Stack の口に理由が載ること（壊れた body は unknown）・`exceptionInfo` の口が名乗る adapter の stopped 中だけ開き、次の停止 / `continued` / `exited` で閉じること
- `src/main/debug/callStack.test.ts` — loading / stopped の snapshot に理由が載ること・例外のときだけ `stackTrace` の後に `exceptionInfo` を1回読むこと・未対応 / 壊れた / 断られた応答で stopped event の値へ落ちること・別の停止の口を使わないこと・**古い停止の答えを publish しないこと**・`thread` event の読み直しで通し番号を進めず再要求しないこと・新しい停止で通し番号が進むこと・running / terminating / idle / Workspace 切り替えで理由が消えること・Workspace 外の最上段でも理由が残ること・配る snapshot に絶対パスが載らないこと
- `src/main/debug/profileResolver.test.ts` / `debugProfiles.test.ts` — python の表が `['uncaught']`、csharp の表が `['user-unhandled']` で起動へ渡ること・profile に載せた filter が効かないこと
- `src/renderer/src/debug/executionLocation.test.ts` — 実行位置が止まった thread の最上段であること・停止ごとに1回だけ追うこと（同じ停止の読み直し / loading / idle / Workspace 外）
- `src/renderer/src/editor/debug/executionLineDecorations.test.ts` / `executionLineGlyphs.test.ts` — current / selected の印・ファイルごとの出し分け・同じ行に重ねないこと・loading / idle で空になること・色を持たないこと・breakpoint とは別の decorations collection を持つこと・同じ内容なら Monaco に触れないこと・ファイル切替で当て直すこと・dispose で残らないこと
- `src/renderer/src/debug/DebugStopReasonView.dom.test.ts` / `debugStopReasonLabels.test.ts` / `ExecutionLocationFollower.dom.test.ts` / `CallStackView.dom.test.ts` — 理由ごとの日英の言葉（Paused / 一時停止中。Stopped と書かない）・例外の型名 / メッセージ / breakMode・文字列として描くこと・停止ごとに1回だけ `openFileAt` を呼び、下の段を選んでも引き戻さないこと・Call Stack の「実行位置」と選択の区別

#### Socket DAP / Child Session Foundation（Session 6-15A）

- `src/main/debug/adapterTransport.test.ts` — ready の合図（行が揃ってから当てる・`port` だけを読む・loopback 以外 / port 0 / 範囲外で ready にしない・名前付きグループ `port` 必須・`g` / `y` フラグでも同じ答え・溜める上限）
- `src/main/debug/dapStartDebugging.test.ts` — 通す形（launch・root と同じ type・target の id）と作り直した4欄・捨てた欄の数・名前の制御文字と長さ、断る形（壊れた body・attach・未知の request / type・target の id の欠落 / パス / 長さ / 型・禁じた23欄それぞれ・大文字小文字違い・prototype の欄・`__proto__`）
- `src/main/debug/dapConnection.test.ts` — **答える口が無ければ `startDebugging` も従来どおり断る**・受けたら本文の無い成功応答・断りの文言・判断が例外を投げても失敗応答で読み進める・**口があっても `runInTerminal` と任意の逆方向 request は断る**
- `src/main/debug/socketDebugAdapter.test.ts` — **本物の子プロセスと本物の TCP**（一時フォルダに書いた小さな DAP server）で、接続 → 子の接続 → dispose でプロセスが消えること・ready の timeout・接続拒否・ready 前の exit・存在しない実行ファイル。偽のプロセスで、接続先が 127.0.0.1 だけ・接続までの送信を溜める・loopback 以外を名乗ったら繋がない・**kill で終わらなければ SIGKILL・猶予内に終われば送らない**・子の socket が閉じても adapter は終わらない・root の socket の error で kill・stdio の adapter に `openConnection` が無い。**Session Manager を本物の socket adapter に繋いで** root → `runInTerminal` / 不正な `startDebugging` の拒否 → 正しい `startDebugging` → 子の設定 → stopped → threads / scopes / variables / evaluate / continue → Stop の順を server 側の記録で確かめ、プロセスの終了と Main 側の TCP socket の数が元に戻ることまで見る（Workspace switch / アプリ終了も同じ）
- `src/main/debug/debugSessionChildSessions.test.ts` — 偽の adapter で root / child: 子を受けないセッションに答える口が渡らないこと・子の lifecycle の順と作り直した構成・**breakpoint が root の窓と子の窓で送られ、子の設定中は breakpoint の口が null**・例外 filter を子が名乗るときだけ送ること・**子の設定が root の running を待つこと**・ready 前の子の event を溜めて当てること・断る形（attach / 未知の type / 壊れた body / cwd / runtimeExecutable / target の欠落 / 重複 / stdio / 接続を開けない / Stop 中）・**実行制御と Call Stack / Variables / Evaluate / exceptionInfo が子へ行き root へ行かない**こと・子が primary の後の root の実行 event を捨てること・切り替えで root の停止の口が `closed` になること・片付け（子の `terminated` / `exited`・root の `terminated`・子の接続の close・adapter の error・子の設定の timeout / 失敗・Stop・答えない子の Stop・Workspace switch・アプリ終了）・前のセッション / 閉じた子からの遅れた event を捨てること
- `src/main/debug/callStack.test.ts` / `variables.test.ts` / `evaluate.test.ts` — **thread id / frame id / `variablesReference` が別の接続と重なっても通さない**（世代も停止も同じまま口の接続だけが変わった場合を含む）・答えを待つ間に接続が変わったら publish / handle 発行をしない・evaluate の handle が接続に閉じること・別の接続の exceptionInfo の口を使わないこと
- `src/main/debug/profileResolver.test.ts` / `debugProfiles.test.ts` — 行が持たなければ `transport` / `childSessions` の欄ごと載らない・行の transport と子セッションの方針（type は言語の表）がセッションまで届く・Profile の欄からは作れない・出荷状態の python / csharp / node 行が変わっていないこと

#### Node.js Debug Adapter（Session 6-15B）

- `src/main/debug/adapterArtifact.test.ts` — **実ディスク**で: pin した表（版 1.117.0・公式 release asset の URL と SHA-256・MIT・入り口・tree の数と大きさ）・置き場所が userData の下で版ごと・**tree hash を実装を呼ばずに書き下した manifest と一致すること**・無い（`missing`）・1バイト変更 / 追加 / 削除 / 移動（同じ中身・数・大きさ）/ 入り口が木に無い（`hash-mismatch`）・**root と木の中のジャンクションを辿らない**（`invalid`）・表より大きな木は中身を読む前に止まる・読めない / root がファイル（`invalid`）
- `src/main/debug/adapterCatalog.test.ts` — 出荷状態の node 行（`node` + artifact + `0 127.0.0.1` + socket + `__pendingTargetId` + root の output を stdout / stderr に）・**実 js-debug の ready の行から port を読み、loopback 以外を名乗れば ready にしない**
- `src/main/debug/profileResolver.test.ts` — 出荷状態の node 行が `node.exe <verified entry> 0 127.0.0.1` と launch 構成（`runtimeExecutable` = 同じ node.exe・`sourceMaps: false`・`outFiles: []`・`autoAttachChildProcesses: false`・`outputCapture: 'std'`・`uncaught`・子セッションの方針）に解けること・`.js` / `.mjs` / `.cjs` / 大文字の拡張子を通し、`.ts` / `.mts` / `.cts` / `.json` / 拡張子なしは `invalid-profile` で**配布物を確かめもしない**こと・配布物が `missing` / `invalid` / `hash-mismatch` / 入り口が Workspace の中なら `adapter-unavailable`・**Workspace の中の node.exe（絶対の PATH 項目・realpath が中）/ `.cmd` の shim だけ / PATH に無い**で `adapter-unavailable`・Profile の `runtimeExecutable` / `runtimeArgs` / `runtimeVersion` / `sourceMaps` / `outFiles` / `autoAttachChildProcesses` / `outputCapture` / `request: attach` / `port` / `__workspaceFolder` が launch に届かないこと・python に node の欄が載らないこと
- `src/main/debug/debugProfiles.test.ts` — 起動のたびに配布物を確かめ、入り口を server の引数の前に置くこと・使えない3通りで何も起動せず、応答に置き場所 / hash の語が載らないこと
- `src/main/debug/debugSessionChildSessions.test.ts` — **ready の子の `terminated` / `exited` で terminating に進み、Continue を断り、root の stderr を Debug Console へ流し、root の `terminated` で子 → root → server を片付けること**（error のログを出さない）・root が終わらなければ猶予で片付けること・待つ間の子の接続 / adapter の close を終わり方として扱うこと・待つ間の Stop が同じ終わりを待つこと・設定中の子の `terminated` は即座に片付けること・**`supportsTerminateRequest: false` の子へ Stop が `disconnect`（`terminateDebuggee: true`）を直接送ること**・root の `output` を表の category だけ通すこと（子を受ける前の `console` / `telemetry` / category なし / `important` を落とし、子の `console` は通す）・表に欄が無ければ / root だけのセッションでは全部通すこと・**thread id 0 の `thread` / `stopped` で Pause / Continue が子へ `threadId: 0` 付きで届くこと**
- `src/main/debug/dapThreads.test.ts` / `callStack.test.ts` / `ipc/handlers/debug.test.ts` — **thread id 0 と frame id 0（実 js-debug の振り方）を通し、frame 0 に handle が発行されること**・負 / 小数 / 安全でない整数は従来どおり断ること（production 確認で見つけた不具合の回帰）
- `src/main/debug/console.test.ts` — `telemetry` の output を Debug Console へ出さないこと（js-debug の `js-debug/dap/operation`・debugpy）

#### Evaluate（Session 6-7）

- `src/main/debug/dapEvaluate.test.ts` — 要求が式・Main が確かめた frame id・翻訳した文脈の3欄だけであること・式を加工しないこと・`variablesReference` を Renderer 形から切り離す（無い / 読めない値は 0 ＝ 葉）・空の結果を保つ・知らない presentationHint を `other` に畳む・値の制御文字と長さ・空 / 読めない型を落とす・文脈の表が閉じた集合を覆うこと
- `src/main/debug/evaluate.test.ts` — 呼び手が名指した frame で評価する・**結果の reference を 6-6 と同じ handle 表に載せ、`listVariables` で展開できる**・Scope と handle 番号を共有しない・葉 / 表が一杯なら handle 無しで答える・Workspace が無い / 今の Call Stack に無い frame は送る前に断る・Workspace 外の frame でも評価する・**Continue / 次の停止 / Workspace 切り替え（通知の前を含む）/ セッションの入れ替え / 終了の後に届いた答えを捨てる**・adapter の失敗の文言を Main のログにだけ残す・答えない adapter の `timeout` と、その後に届いた答えに handle を発行しないこと・DAP の command / adapter / パスを Renderer へ出さない・別の接続の frame / handle を通さない（6-15A）
- `src/main/debug/debugSessionEvaluate.test.ts` — Evaluate の口が stopped の間だけ開き、次の停止 / 終了で閉じ、Variables の口とは別であること
- `src/main/debug/variables.test.ts` / `src/renderer/src/debug/variablesTreeModel.test.ts` — evaluate の結果を同じ表へ登録すること・Scope から始まらない入口（`flattenVariablesSubtree`）
- `src/main/ipc/handlers/debug.test.ts` / `src/shared/debug/evaluate.test.ts` / `src/preload/api/debug.test.ts` — 3欄以外を送らないこと・形の壊れた要求（空の式・長さ・NUL・`frameId`・閉じた集合の外の文脈）が INVALID_REQUEST
- `src/renderer/src/debug/EvaluateView.dom.test.ts` — 6-7 の単独の Evaluate の面（Closing 時点で Debug パネルに mount されていないが、テストはコンポーネントと一緒に残っている。docs/ARCHITECTURE.md §20.16）

#### Debug Console（Session 6-8）

- `src/main/debug/console.test.ts` — stdout を Workspace 相対の source 付きで畳み、生の DAP の欄を載せないこと・Workspace 外の source を unavailable にして絶対パスを出さないこと・壊れた body と長い文字列の上限・今の Workspace へ送り、セッションの終わりを system の1行で知らせること・`telemetry` を出さないこと（6-15B）
- `src/renderer/src/debug/DebugConsoleView.dom.test.ts` — 入力を safe な `repl` の evaluate で評価すること・止まって frame を選ぶまで入力を disabled に保つこと・**今の Workspace の出力だけを描き、Workspace 切り替えで消すこと**・履歴を保ったまま Clear で entry だけを消すこと・結果の handle を Variables の API で展開し、生の handle を描かないこと・評価の失敗を error の entry として出すこと
- `src/main/debug/debugSessionManager.test.ts` / `src/preload/api/debug.test.ts` — output の listener と `onConsoleEntry` の経路

#### C#（netcoredbg。Session 6-14）

- `src/main/debug/profileResolver.test.ts` — 出荷状態の csharp 行が `netcoredbg --interpreter=vscode`（adapter の cwd は Workspace の外）に解けること・Profile に載せた C# 固有の設定を運ばないこと・PATH に netcoredbg が無ければ `adapter-unavailable`・target が build 済み DLL でなければ `invalid-profile`・**netcoredbg から見える path のどれかが ASCII-only でなければ `adapter-unavailable`**
- `src/main/debug/adapterCatalog.test.ts` — csharp 行が PATH の `netcoredbg.exe` へ解けること
- `src/main/debug/dapBreakpoints.test.ts` / `breakpointModel.test.ts` — **後から届く `breakpoint` event** の verified と source path を読むこと・adapter の文言を `setBreakpoints` の応答と同じ上限で切ること・`removed` と壊れた event を読まないこと・source と line で当てる（adapter が動かした行にも、line が無くてもそのファイルに1件だけなら当てる）・曖昧な event は当てないこと
- `src/main/debug/debugSessionBreakpoints.test.ts` — adapter から後で届いた breakpoint event を購読できること
- `src/main/debug/debugSessionControl.test.ts` — `thread` event で覚えたスレッドへ Pause を送ること
- `src/main/debug/debugSessionManager.test.ts` — `launch` の応答を待ってから設定の窓へ進む互換フラグ
- `src/main/debug/dapStackTrace.test.ts` — netcoredbg が返す frame id 0 を保つこと

#### Debug Command / Keybinding（Session 6-16）

- `src/renderer/src/keybindings/defaults.test.ts` — F5 / Shift+F5 / F9 / F10 / F11 / Shift+F11 を持つこと・F9 は Editor に focus があるときだけ・実行制御は端末と Settings の背面で走らせないこと
- `src/renderer/src/commands/registry.test.ts` / `commandLocalization.test.ts` — Profile と実行制御と breakpoint の12件と日英の名前
- `src/renderer/src/debug/DebugToolbar.dom.test.ts` — **`debug.startOrContinue` が idle では Start、stopped では Continue を既存の操作として呼ぶ**こと
- `src/renderer/src/debug/DebugToolbar.dom.test.ts`（Session 7-1A 以降） — `DebugProvider` が Profile 選択と実行 command を Debug パネルの mount / unmount より長く持ち、Toolbar は Panel 内の表示と Profile editor に寄ること
- `src/renderer/src/editor/debug/breakpointGlyphs.test.ts` — カーソルのある行を入れ替えの対象にすること・Model / 位置が無い / 範囲外の行では何もしないこと
- `src/renderer/src/settings/KeyboardShortcuts.dom.test.ts` / `src/renderer/src/keybindings/shortcutRows.test.ts` — 40件が1つ残らず出ること・割り当てのある18件が打鍵を出し、22件が未割り当てとして出ること・Debug の12件と既定の打鍵・言語を切り替えても40件・7グループのまま

**「Debug パネルが前面のタブのときにだけ F5 / Shift+F5 / F10 / F11 / Shift+F11 が効く」は Session 6-17 時点の production 実測記録**で、Session 7-1A 以降の現在仕様では解消済み。現在は `DebugProvider` が所有者になるため、unit test は Provider と Toolbar の分担を固定する。

#### Debug adapter の案内 / ログファイル（Session 7-1C）

- `src/main/debug/profileResolver.test.ts` / `debugProfiles.test.ts` / `ipc/handlers/debug.test.ts` — `adapter-unavailable` が言語と閉じた集合の `cause` を持つこと（node: PATH に無い / `.cmd` の shim だけ / 相対の PATH 項目だけ / Workspace の中 / 実体が中 / 配布物が無い / 形が違う / hash が違う / 入り口が中、python: PATH に無い、csharp: netcoredbg が無い / dotnet が無い / netcoredbg が Workspace の中 / ASCII 以外のフォルダ / ASCII 以外の Workspace、全言語: cwd が Workspace の中 / catalog の行が別言語 / not-integrated）・**応答にパス / 実行ファイル名 / 配布物の語が載らないこと**
- `src/renderer/src/debug/debugToolbarModel.test.ts` — 言語 × cause → 案内の key・その言語で起こらない組み合わせは言語ごとの総合の案内・閉じた集合の外（知らない言語 / `toString`）は安全な1文へ落ちること
- `src/main/logger/logRedaction.test.ts` — ドライブ（空白 / `/` 区切り / Unicode のユーザー名）/ UNC / `\\?\` / file URI / POSIX / Python repr のパスを**断片も残さず**伏せる・引用符の後ろの文章と details の区切りは残す・URL / 相対パス / 普通の語を伏せない・URL の userinfo / GitHub token / Bearer / `password=` / `API_KEY=` を伏せる・制御文字で行を偽装させない・上限で切っても切れ目のパスを伏せる・Error は name / code / message だけ・object を辿らない
- `src/main/logger/logFile.test.ts` — 最初の1行で作り、見出しは1度だけ・置き場所が null / 空 / 相対 / 例外なら**何も触らない**（テストの mock で `logs/` を作らない）・上限の手前で1世代へ回す・前回が上限なら新しいファイルから / 未満なら追記・書けない / フォルダを作れないとき1度だけ知らせて以後は書かず投げない・**実ディスク**で入れ子のフォルダを作り、回したあとも両方が上限以内

### 整形

Prettier（`.prettierrc.json`）。設定は既存のコードスタイル（セミコロンなし・シングルクォート・100 桁）に合わせてあり、導入時のコード変更は整形のみ。エディタ側にも同じ設定が効くよう `.editorconfig` を置いている。

### Lint（未導入）

ESLint は**現時点では導入できない**。本プロジェクトは TypeScript 7.0 を使っているが、`typescript-eslint` の対応範囲が `>=4.8.4 <6.1.0` であり、`.ts` を解析するパーサ自体が入らないため。無理に `--force` で入れても解析結果が信用できない。

代わりに、`tsc --noEmit`（`strict` 有効）と Prettier で、型と書式は担保している。`typescript-eslint` が TypeScript 7 に対応した時点で導入を再検討する。

---

## 4. 実際に起動して確認する

自動確認には `playwright-core` の `_electron` を使う。プロジェクトには検証用の依存を追加せず、作業用ディレクトリ側に入れる。

```js
import { _electron as electron } from 'playwright-core'

const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron.exe',
  args: ['<プロジェクトルート>']
})
const win = await app.firstWindow()
```

注意点:

- **`ELECTRON_RUN_AS_NODE` を必ず外すこと。** この環境変数が設定されていると Electron が素の Node として起動し、`require('electron')` が文字列を返して起動に失敗する。アプリ側の不具合ではない。空文字の代入では不十分で、完全に unset する必要がある（`env -u ELECTRON_RUN_AS_NODE ...`）。
- dev 側を driver から動かす場合、`electron-vite dev` は自前で Electron を起動してしまう。Renderer だけを Vite で配信し、`ELECTRON_RENDERER_URL` を渡した Electron を別途起動する。このとき **`electron.vite.config.ts` の renderer と同じエイリアス（`@shared` / `@renderer`）を持つ設定を用意すること。** 素の `vite src/renderer` では `@shared/*` が解決できず起動しない。
- CSP の確認は**ビルド後のアプリ**で行う（開発時は Vite の注入タグが meta より前に入るため）。

STEP 1 完了時点では、以下を自動確認済み。

- ビルド版: ウィンドウ生成、Renderer 描画、preload API の公開範囲、IPC の成功 / 失敗経路、Node・Electron の非露出、webPreferences、権限の既定拒否、外部遷移と `window.open` の拒否、CSP 違反なし、単一インスタンス、ウィンドウ状態の保存 / 復元（サイズ・位置・最大化・画面外・破損ファイル）
- dev 版: dev server からの読み込み、IPC、React Fast Refresh、HMR の WebSocket、開発メニュー、同一オリジンの遷移許可と外部遷移の拒否

Session 2-1（Workspace Shell）では、ビルド版で以下を追加確認済み。

- 領域の描画（left / center / bottom、パネルが無い right は非描画）、レイアウトが持つサイズ値と実際の占有幅の一致、パネルの配置とタブ、タブ切り替えと識別色の追従、ステータスバー経由の IPC、Node・Electron の非露出、ウィンドウ全体のスクロールなし、console エラー / CSP 違反なし

Session 2-2（Dock / Split）では、開発確認用の仮 UI（`LayoutDevBar`。Session 2-3 で削除）から操作を呼ぶ形で以下を確認済み。

- ビルド版（34項目）: 初期配置（Files / Editor / Git / Terminal）と木の形、パネルの別領域への移動と空になった領域の消滅、水平 / 垂直の分割と等分、固定サイズの領域を分割したときに外側の大きさが保たれること、同じ向きの親に入れ子を作らないこと、何も起きない移動が選べないこと、初期レイアウトへの復帰、STEP 1 のセキュリティ前提（Node / Electron の非露出・API の公開範囲・IPC・CSP）
- dev 版（6項目）: 同じ操作が dev でも動くこと、**開発ビルドのレイアウト検査（`findLayoutProblems`）が一度も報告しないこと**、Fast Refresh、console エラーなし

レイアウト検査は開発ビルド専用で、`import.meta.env.DEV` により配布ビルドからは丸ごと落ちる（ビルド成果物に文言が含まれないことを確認済み）。

Session 2-3（ドラッグ&ドロップ）では、実際にマウスを動かす形（`mouse.down` → `mouse.move` → `mouse.up`）で以下を追加確認済み。ビルド版 46項目 / dev 版 47項目（dev はロード元の確認が1項目多い）、いずれも全項目 PASS。

- ドラッグ中の表示: 受け入れられる領域にだけガイドが出ること（自分しか入っていない領域には出ない）、運んでいるパネルの識別色が使われること、狙っている方向の強調、プレビューの範囲が中央 = 領域全体 / 左 = 左半分になること、ドラッグ中はレイアウトが変わらないこと
- ドロップ: 中央 → タブ化（落としたパネルが手前に出る）、左 / 右 / 上 / 下 → その側への分割と、新しい領域が等分になること、タブが2枚ある領域からその領域自身の外へ引き出せること
- 後片付け: 空になった領域が木から消えること、残った領域が空いた場所を引き継ぐこと、操作を重ねてもパネルが1枚ずつしか存在しないこと
- 拒否・キャンセル: Escape でキャンセルするとレイアウトが変わらないこと、自分の領域へのドロップが何も起こさないこと、既にその領域にあるパネルの中央ドロップが拒否として表示されること
- 従来の動作: タブのクリックによる切り替え、ウィンドウ全体がスクロールしないこと、STEP 1 のセキュリティ前提、console エラーなし、**dev 版でレイアウト検査が一度も報告しないこと**

Session 2-4（境界のリサイズ）では、掴み手を掴んで動かす形で以下を追加確認済み。ビルド版 55項目 / dev 版 56項目、いずれも全項目 PASS。

- 掴み手: 境界の数だけ出ること、row の境界が `col-resize` / column の境界が `row-resize` になること、`role="separator"` と向き、太さが設定値（6px）と一致すること
- リサイズ: Files / Editor（左右）、Editor / Git（左右）、Editor / Terminal（上下）で、掴んだ2つだけが動き合計が変わらないこと、無関係な領域が動かないこと
- 最小サイズ: Files が共通の下限 140px で止まること、中央の Editor が上書きした下限（幅 320px / 高さ 140px）を保つこと、Terminal が高さ 64px で止まること、入れ子の split でも中の領域から下限が決まること、下限に達した後さらに狭くする向きへは動かないこと
- 入れ子: ドロップで生まれた入れ子の境界をリサイズできること、その外側の大きさ（220px）が変わらないこと、入れ子ができた後も外側の境界を動かせること
- 他の操作との共存: リサイズ後にドラッグ&ドロップできること、ドロップ後もリサイズした幅が保たれること、領域が減れば掴み手も減ること
- キャンセル: Escape と `pointercancel` で開始前のサイズに戻ること、状態が残らないこと、直後に続けてリサイズできること
- ウィンドウサイズ: 縮めても px 指定の領域が幅を保ち、可変領域が伸縮を引き受けること（横スクロールが出ない）、狭いウィンドウでもリサイズと下限が同じように働くこと、戻しても破綻しないこと
- 初期レイアウトへ戻すと元のサイズ（240 / 280 / 220）に復元されること
- 従来の動作: タブ切り替え、STEP 1 のセキュリティ前提、console エラーなし、**dev 版でレイアウト検査が一度も報告しないこと**

Session 2-5（パネルの表示管理・レイアウトプリセット）では、タブの × と View / Layout メニューを実際に押す形で以下を追加確認済み。ビルド版 49項目 / dev 版 50項目、いずれも全項目 PASS。

- UI: すべてのタブに閉じる操作が付くこと、上部バーの並び（View / Layout: Default / レイアウトを初期化）、View メニューに Registry の全パネルが出ること、チェック状態と role（`menuitemcheckbox` / `menuitemradio`）、Escape でメニューが閉じること
- 閉じる → 再表示: Files / Terminal / Git のそれぞれで、閉じるとレイアウトから消え他の3枚は残ること、**閉じても View メニューには残る（Registry からは消えない）**こと、再表示すると位置も大きさ（240 / 280 / 220）も初期配置と一致すること
- 領域の後片付け: 領域の最後の1枚を閉じても空の領域が残らず、残った領域が場所を引き継ぐこと、すべて閉じても壊れず空の領域が1つ残ること、その状態で戻し方の文言が出ること、空から1枚ずつ戻すと初期の配置が組み上がること
- 他の操作との共存: ドラッグ&ドロップ後に閉じられること、配置が変わった後でも閉じたパネルが近い位置へ戻ること、**再表示したパネルをそのままドラッグ&ドロップできること**、リサイズ後に閉じても大きさが保たれること、再表示してもリサイズした幅が保たれること、**再表示後もリサイズできること**
- プリセット: 配置を変えると「変更あり」が出て初期化ボタンが押せること、Default へ戻すと形・位置・大きさが初期状態と一致すること、戻すと「変更あり」が消えること、Layout メニューからの適用でも同じ結果になること
- 重複: 閉じる / 再表示を繰り返しても PanelId が重複しないこと
- 従来の動作: タブのクリックによる切り替え、タブが複数ある領域では閉じても領域が残り他のタブが手前に出ること、ウィンドウ全体がスクロールしないこと、STEP 1 のセキュリティ前提、console エラーなし、**dev 版でレイアウト検査が一度も報告しないこと**

Session 2-6（レイアウトの保存 / 復元）では、**アプリを終了して起動し直す**形で以下を確認済み。ビルド版 71項目 / dev 版 17項目、いずれも全項目 PASS。

- 保存先: 初回起動で `userData` 配下に `workspace-layout.json` が作られること、`schemaVersion` / `presetId` / DockNode の木を持つこと、**プロジェクトフォルダには書かれない**こと
- 復元: Files の幅、Terminal の高さ、Drag & Drop で移した配置、タブの並びと activePanelId、閉じたパネル、再表示したパネルが、いずれも再起動後に元どおりになること。複数の変更が同時に保たれること
- 初期化: 「レイアウトを初期化」の後に再起動しても Default のままで、古い配置が復活しないこと。「変更あり」の表示も復活しないこと
- フォールバック: JSON として壊れている / 空ファイル / 不正な DockNode 構造 / 知らない PanelId / 負の size / 未来の schemaVersion / 移行手順の無い古い schemaVersion のいずれでも、落ちずに Default で起動し、保存ファイルが正常な内容に直ること。理由が console に残ること
- 取りこぼし: 変更した直後（間引きの待ち時間より早く）に終了しても保存され、次回起動で復元されること
- セキュリティ: 公開 API が `env` / `system` / `workspace` の3つで、`workspace` は `loadLayout` / `saveLayout` の2つだけであること。汎用のファイル API が無いこと。壊れた文書の保存が `INVALID_REQUEST` で拒否され、拒否されても画面が壊れないこと
- dev 版: 復元直後・正規化を要する保存データ・フォールバックのいずれでも**レイアウト検査（`findLayoutProblems`）が一度も報告しない**こと、復元したレイアウトをそのままドラッグ&ドロップできること（ノード id の予約が効いていること）

Session 2-7（STEP 2 全体の統合確認）では、個別機能ではなく**実際の利用フロー**を1本の連続した操作として通した。ビルド版 55項目 / 異常系 82項目 / dev 版 28項目、いずれも全項目 PASS。

- 統合操作（ビルド版 55項目）: Default で起動 → Files の幅を変更 → Terminal の高さを変更 → Git を別領域へ Drag & Drop → Files を Dock / Split → PanelGroup 内のタブ順を変更 → activePanel を変更 → Terminal を閉じる → 再表示 → さらに Resize → 終了 → 再起動 → **変更したレイアウトがそのまま復元されること**（領域の矩形・タブの並び・activePanel・掴み手の数まで一致）→ 復元後に再度 Drag & Drop / Resize できること → Default へ戻す → 再起動 → Default のままであること
- 異常系（82項目）: 壊れた JSON / 保存途中で切れた JSON / 空ファイル / 配列 / 未来の schemaVersion / 移行手順の無い schemaVersion / 不正 PanelId / 不正 DockNode（kind・direction・children・空の split）/ 負の size / 数値でない size / 文字列でないノード id / layout がオブジェクトでない / 桁違いに大きい文書 のいずれでも **Default Layout で起動し、その後も操作でき、保存ファイルが正常な内容に直る**こと。重複 PanelId・空の PanelGroup・全パネルを閉じた状態・極端に小さい size は Default へ落とさず整えて復元し、いずれも行き止まりにならないこと（0px の領域も掴み手から広げ直せる）。保存ファイルの位置にディレクトリを置いて**読み込みと保存の両方を失敗させても**、Default で起動して操作が続き、失敗が Main のログに残ること
- dev 版（28項目）: 同じ流れが dev でも動くこと、**その間レイアウト検査（`findLayoutProblems`）が一度も報告しないこと**、正規化を要する保存データ（重複・空の領域・ずれた activePanelId・同じ向きの入れ子 split）を読み込んだ後もそのまま操作できること、フォールバックの理由が console に残ること

Session 3-1（Workspace / プロジェクトフォルダ）では、フォルダを開く → 切り替える → 閉じる → 再起動、という利用の流れを通した。ビルド版 97項目 / dev 版 18項目 / ネイティブダイアログまわり 10項目、いずれも全項目 PASS。

- 未選択の状態: 上部バーとステータスバーが未選択を示すこと、Editor に Welcome が出ること、保存ファイルがまだ作られないこと、Workspace メニューに「閉じる」が並ばないこと
- 開く: 上部バーにフォルダ名・ステータスバーに絶対パスが出ること、Welcome が消えて Editor がフォルダ名を出すこと、ダイアログが**呼び出し元ウィンドウに対してモーダル**で1回だけ開くこと、`openDirectory` として開くこと、2回目以降は直前の Workspace が初期表示になること
- 保存: `userData` 配下に `workspace-folder.json` が作られ、`schemaVersion` / `id` / `rootPath` / `displayName` / `openedAt` を持つこと、**`exists` は保存されない**こと、**プロジェクトフォルダには書かれない**こと
- 切り替え・取り消し・閉じる: 別フォルダへ切り替わり保存も追従すること、取り消しでは何も変わらずエラーも出ないこと、閉じると未選択に戻り保存内容も `null` になること、閉じた状態は再起動後も維持されること
- 復元: 再起動で前回のフォルダ（名前・パスとも）に戻ること
- 消えたフォルダ: 保存されたフォルダを削除して再起動すると、落ちずに未選択で起動し、**見つからなかったパスを Welcome が伝える**こと、そのまま開き直せて警告が消えること
- 壊れた保存ファイル（8種）: JSON として壊れている / 空ファイル / 配列 / 未来の `schemaVersion` / rootPath が相対パス / rootPath が数値 / 項目が欠けている / 桁違いに長い rootPath のいずれでも、未選択で起動して操作が続き、保存ファイルが正常な内容に直ること
- セキュリティ: 公開 API が `env` / `system` / `workspace` / `workspaceFolder` の4つで、`workspaceFolder` は `getCurrent` / `open` / `close` の3つだけであること。汎用のファイル API が無いこと。Node / process / electron が露出しないこと
- STEP 2 の回帰: 4つのパネルが並ぶこと、View メニューで閉じて戻せること、**Workspace を切り替えてもレイアウトが変わらない**こと、レイアウトが別ファイルに保存され続けること
- ネイティブダイアログ（スタブを使わない確認）: 実際にダイアログが開くこと、表示中も画面が生きていて「処理中…」が出ること、モーダル中は親ウィンドウが操作不可になること、開いている間に押し直してもダイアログが2枚開かないこと
- dev 版: 同じ流れが dev でも動くこと、**その間レイアウト検査（`findLayoutProblems`）が一度も報告しないこと**、壊れた保存ファイルの後もそのまま操作できること

Session 3-2（Files ファイルツリー基盤）では、Workspace を開く → 展開する → 切り替える → 閉じる、というツリーの利用の流れを通した。ビルド版 78項目 / dev 版 15項目、いずれも全項目 PASS。

- 初期状態: Workspace 未選択なら Files は初期状態（開く入口だけ）で、**フォルダを1つも読みに行かない**こと
- 表示: root 行に Workspace 名が出ること、直下がすべて並ぶこと、フォルダが先でそれぞれ名前順（`item2` → `item10`）であること、ファイルとフォルダがアイコンで区別されること、階層が `aria-level` とインデントに出ること
- **Lazy Load**: 5100 件のフォルダを持つ Workspace を開いても `readdir` が **1回（root だけ）**であること、未展開のフォルダの中身が DOM に無いこと、展開すると**そのフォルダだけ**が読まれること、深い階層も1階層ずつ読むこと（6階層で6回）
- 展開 / 折りたたみ: 展開 → 折りたたみ → 再展開ができ、再展開では読み直さない（読み込み済みを保つ）こと、6階層の深さまで辿れること
- 選択: ファイル / フォルダのどちらも選べること、選択は常に1つで `aria-selected` に出ること、フォルダの選択が展開を伴うこと
- 上限: 5100 件のフォルダが 5000 件で打ち切られ、打ち切ったことが伝わること、折りたたむと 5000 行が消えること
- **Workspace 境界**（19種）: `..` / `../outside` / `..\outside` / `docs/../../outside` / `./../outside` / 絶対パス（`C:\…` / `C:/…` / `/…` / `\…` / UNC）/ ドライブ相対（`C:docs`）/ 代替データストリーム（`README.md:stream`）/ NUL / 桁違いに長い相対位置 のすべてが `INVALID_REQUEST`、存在しないフォルダが `NOT_FOUND`、**ジャンクションで Workspace の外を指すフォルダが `PERMISSION_DENIED`** で拒否されること。拒否された要求で**Workspace の外を `readdir` していない**こと、応答に絶対パスが含まれないこと
- エラー: 外を指すフォルダを開こうとしても落ちず Files パネル内のエラー行になり再試行が出ること、削除されたフォルダが再読み込みでツリーから消えること、**Workspace ごと消えても落ちず**にエラー表示になり、戻せば再試行で復帰すること
- 幅が狭いとき: 長いファイル名でも行がパネルの幅を超えないこと、Files パネルにもウィンドウ全体にも横スクロールが出ないこと、長い名前が省略表示になること
- 切り替え / 閉じる: 別 Workspace へ切り替えると root 行・中身とも入れ替わり**前の Workspace の内容も展開状態も残らない**こと、読むのは新しい root だけであること、閉じると初期状態に戻ること、Files パネルの入口から開き直せること
- キーボード: ArrowUp / ArrowDown / Home で移動できること、Tab の対象が1行だけ（roving tabindex）であること
- セキュリティ: 公開 API が `env` / `system` / `workspace` / `workspaceFolder` / `files` の5つで、`files` は `readDirectory` だけであること。汎用のファイル API が無いこと。Node / process / electron が露出しないこと
- STEP 2 の回帰: 4つのパネルが並ぶこと、console エラー / CSP 違反が無いこと
- dev 版: 同じ流れが dev でも動くこと、Workspace 外の拒否が dev でも同じであること、**再起動して復元した Workspace のツリーがそのまま出て操作できる**こと、**その間レイアウト検査（`findLayoutProblems`）が一度も報告しない**こと

Session 3-3（Files 基本操作・Editor 連携基盤）では、**Workspace を開く → ファイルを開く → 作る → 名前を変える → 消す**という開発作業の流れを1本として通した。動作の流れがビルド版 59項目 / dev 版 61項目、Workspace 境界が各 36項目、いずれも全項目 PASS。

- Editor で開く: Files でファイルを選ぶとタブが作られ**中身と relativePath が出る**こと、同じファイルを再度開いてもタブが重複せず**中身を読み直さない**こと、複数ファイルが別タブになること、タブを切り替えられること、閉じられること
- 開けないファイル: バイナリは中身を出さずに理由を出すこと、CRLF のファイルが CRLF として読まれること
- 作成: 右クリックメニューから新規ファイル / 新規フォルダを作れること、ツリーに現れること、実際にディスクへ作られること
- 名前の検証（入力中）: 区切り文字（`a/b.ts`）・Windows の予約名（`CON`）・空白のみが**その場で拒否**され、Enter が確定しないこと、Escape でやめられること
- 同名衝突: `CONFLICT` として伝わること、入力欄が閉じないこと、**既存ファイルが上書きされていない**こと
- リネーム: ツリー上のインライン編集であること（初期値が今の名前）、ツリーとディスクの双方に反映されること、**開いているファイルのリネームにタブが追従する**こと
- 削除: 確認が出ること、ごみ箱であることが伝わること、キャンセルで削除されないこと、確定でディスクから消えツリーとタブからも消えること、フォルダは確認文が変わり中身の数が出ること、中身ごと消えること
- **ジャンクションの削除**: リンクだけが消え、**指し先（Workspace の外）の中身は残る**こと
- **Lazy Load を崩さない**: 作成 / 改名 / 削除のいずれの後も `readdir` が**変更された親フォルダ1回だけ**であること（全再帰しない）
- **Main → Renderer のイベント**: `files:changed` が届くこと、payload が型付き契約どおり（`workspaceId` + `changes`）であること、**Electron の event オブジェクト（`sender` / `ports`）が Renderer へ渡っていない**こと、購読の戻り値が解除の関数であること、`ipcRenderer` が露出していないこと
- root の扱い: メニューが新規のみ（改名・削除を出さない）こと、API から root を削除 / 改名 / ファイルとして開こうとしても `INVALID_REQUEST` になること
- キーボード: F2 でリネームを始められて確定まで通ること、Delete で確認が出ること、Escape で閉じられること
- 切り替え: 別 Workspace へ切り替えるとツリーもタブも入れ替わること、**前の Workspace のファイルを操作できない**（`NOT_FOUND`）こと、実際に残っていること
- セキュリティ: 公開 API が5ドメインのままで `files` が6つ（`readDirectory` / `readFile` / `create` / `rename` / `remove` / `onChanged`）だけであること、Node / process / electron が露出しないこと
- STEP 2 の回帰: 4つのパネルが並ぶこと、横スクロールが出ないこと、console エラー / CSP 違反が無いこと、**dev 版でレイアウト検査が一度も報告しない**こと

Files パネルの root 行に「Workspace を閉じる」（×）を足した分は、ビルド版 / dev 版とも 30項目 PASS。

- 表示: root 行にだけ × が出ること、`title` / `aria-label` が「Workspace を閉じる」であること、hover でカーソルが pointer になること
- 閉じる: Workspace が未選択になり、**Files Tree が消え / Editor のタブも残らず / Welcome へ戻る**こと
- **実フォルダ・ファイルが1つも消えていない**こと（`readdirSync` で中身を突き合わせ、ファイルの内容も確認）
- 保存内容: `workspace-folder.json` の `lastWorkspace` が `null` になること（Session 3-1 の Close 処理を通っている証拠）、**再起動しても未選択のまま**で「前回のフォルダが見つからない」という誤った理由を出さないこと、そのまま開き直せること
- 長い名前: 86文字のフォルダ名でも × が行の中に収まり幅を保つこと、Workspace 名の側が省略されること、その状態で実際に押して閉じられること
- 誤発火しないこと: × のクリックが**行の開閉として発火していない**こと（開き直した root が展開済みであることで確認）、**Enter で押しても行の決定へ抜けない**こと

Workspace 境界（各 36項目）は、**読む側だけでなく書き換える側にも同じ検証が効いていること**を確かめた。

- 13種の脱出（`..` / `../outside` / `..\outside` / `docs/../../outside` / `./../outside` / `src/../../outside/secret.txt` / 絶対パス（`C:\…` / `C:/…` / `/…` / UNC）/ ドライブ相対（`C:docs`）/ 代替データストリーム / NUL）を、**`readDirectory` / `readFile` / `create` / `rename` / `remove` の5経路すべて**へ渡して拒否されること
- **名前として渡す脱出**（`../evil.txt` / `..\evil.txt` / `sub/evil.txt` / 絶対パス / `..`）が `INVALID_REQUEST` になり、Workspace の外に何も作られないこと
- **ジャンクション経由**の列挙 / 読み込み / 作成 / 1階層深い位置への作成 / 改名 / 削除がすべて `PERMISSION_DENIED` で、外の中身が一切変わらないこと
- 拒否された要求で **Workspace の外を `readdir` していない**こと
- 成功した応答に**絶対パスが含まれない**こと
- 契約から外れた要求（名前が無い / 種別が `device` / パスが数値 / 要求そのものが undefined / 名前がオブジェクト）がすべて拒否されること

Session 3-4（Monaco Editor 本実装）では、**ファイルを開く → 編集する → 切り替える → 保存する**という編集作業の流れを1本として通した。動作の流れがビルド版 / dev 版とも 66項目、境界とセキュリティが各 51項目、いずれも全項目 PASS。

- 言語判定と構文ハイライト（9種）: `.ts` / `.tsx` / `.js` / `.json` / `.md` / `.py` / `.cs` がそれぞれの言語として開き**色分けされる**こと、`.txt` と知らない拡張子（`.zzz`）が Plain Text になり色分けされないこと
- 複数タブ: 開いたぶんだけタブが並ぶこと、タブを切り替えられること
- **状態の維持**: 切り替えて戻っても**編集内容・カーソル位置・スクロール位置**が残ること
- Undo / Redo: Ctrl+Z で戻せること、**戻してディスクと一致したら未保存の印が消える**こと、Ctrl+Y と Ctrl+Shift+Z のどちらでもやり直せること、やり直すと印が戻ること
- Monaco 標準機能: Ctrl+F（検索）/ Ctrl+H（置換）/ Ctrl+G（行移動）/ Ctrl+A（全選択）/ Ctrl+/（コメント切替・もう一度で解除）/ Tab・Shift+Tab（インデント）
- 保存: Ctrl+S で保存され印が消えること、**ディスクに書き込まれる**こと、**書き込みは1回だけ**であること、変更が無ければ Ctrl+S を連打しても書き込まないこと、**CRLF のファイルが CRLF のまま保存される**こと
- **保存失敗**: 書けない状態（読み取り専用）では**未保存の印が残り**、理由が画面に出て、ディスクの内容が変わらないこと、書けるようになれば同じ操作で保存できること
- Auto Save: **初期設定が OFF** であること、未実装の mode を並べないこと、OFF では自動保存されず印が残ること、`afterDelay` では自動で保存され印が消えること、**10文字を連続で打っても書き込みは1回**（debounce されている）であること
- binary / too-large: どちらも**Monaco へ渡さない**こと（`.fx-editor__monaco` が存在しない）、binary は理由を、too-large は**ファイルサイズと上限**を出すこと
- **Worker**: 起動した Worker が Editor 本体 / TypeScript / JSON の3種で、**すべてアプリにバンドルされたもの**（配布ビルドは `file://`、dev は dev server）であること、**`blob:` の Worker が1つも作られない**こと
- CSP 違反・console エラーが無いこと（Monaco の find widget が Escape で出す `aria-hidden` の警告だけが残る。Monaco 側の挙動）

境界とセキュリティ（各 51項目）は、**保存にも読む側・作る側と同じ検証が効いていること**を確かめた。

- 16種の脱出（`..` / `../outside/...` / `..\outside\...` / `src/../../outside/...` / `./../outside/...` / 絶対パス（`C:\…` / `C:/…` / `/…` / UNC）/ ドライブ相対（`C:src/...`）/ 代替データストリーム / NUL / 桁違いに長い相対位置 / 空文字）を `writeFile` へ渡して拒否されること、**ジャンクション経由（`linkToOutside/secret.txt` とリンク自身）が `PERMISSION_DENIED`** になること
- **Workspace の外のファイルが1バイトも書き換わっていない**こと（実ファイルの内容を突き合わせ）、拒否された要求で **Workspace の外へ `writeFile` していない**こと（Main 側の `fs/promises.writeFile` を記録）
- 契約から外れた要求（中身が数値 / 中身が無い / パスが数値 / パスが無い / 要求そのものが undefined / フォルダを指す）がすべて拒否されること、**上限（2MB）を超える中身**が `INVALID_REQUEST` になり、拒否された後もファイルの中身が元のままであること
- **外部変更（stale）**: アプリの外で書き換えられたファイルは Ctrl+S で**上書きされない**こと、理由が画面に出ること、未保存の印が残ること、「上書きして保存」を選べば保存できること
- タブを閉じると Model も捨てられ、**開き直しても未保存の編集が復活しない**こと
- **Workspace 切り替え**: タブも Monaco も残らないこと、切り替え後に**旧 Workspace のファイルへ保存できない**（`NOT_FOUND`）こと、旧 Workspace のファイルが書き換わっていないこと、**自動保存が有効な状態で切り替えても旧 Workspace を書き換えない**こと
- **Workspace の × で閉じる**: タブが残らず Welcome へ戻ること、**閉じるときに未保存の内容が書き込まれない**こと、開き直しても旧 Model の編集が残っていないこと
- 公開 API が5ドメインのままで `files` が7つ（`writeFile` が増えただけ）であること、Node / process / electron / Buffer が露出しないこと、**Monaco をグローバル（`window.monaco`）へ置いていない**こと
- STEP 2 の回帰: パネルが並ぶこと、横スクロールが出ないこと、console エラー / CSP 違反が無いこと、**dev 版でレイアウト検査（`findLayoutProblems`）が一度も報告しない**こと

Session 3-5（Editor 実用機能・外部変更監視）では、**アプリの外でファイルが変わる**という前提を加えたうえで編集の流れを通した。ビルド版が 57 + 36 + 43 = 136項目、dev 版が 21項目、いずれも全項目 PASS。

外部変更・Conflict（ビルド版 57項目）:

- **clean なファイルの外部変更**: Editor へ反映されること、反映後も clean のままであること、**タブも Monaco も作り直されない**こと、**カーソル位置が保たれる**こと
- **dirty なファイルの外部変更**: Conflict になること、タブから Conflict が分かること、Reload / Compare / 上書き の3つが並ぶこと、**編集内容が失われない**こと、**自動で上書きされない**こと
- **Compare**: Diff Editor が出ること、左にディスク側・右に Editor 側の変更が出ること、読み取り専用であること、閉じられること
- **Reload**: ディスクの内容になること、未保存が解けること、Conflict の帯が消えること
- **保存直前の外部変更**: Ctrl+S で上書きされないこと、未保存が残ること、理由が出ること
- **上書き**: Editor の内容でディスクが書き換わること、clean に戻ること、**その後も通常の保存ができる**こと（版の起点が更新されている）
- **外部削除**: 落ちないこと、**未保存のタブは残り「削除済み」になる**こと、編集内容が残ること、**clean なタブは閉じる**こと、外部で作られたファイルがツリーに出て開けること
- **Workspace 外のイベントを拾わない**: Workspace 内の変更だけが届くこと、外に置いたファイルの変更が届かないこと、**payload に絶対パスが混ざらない**こと、`source` が `watcher` として届くこと、Electron の event オブジェクトが渡っていないこと
- セキュリティ: 公開 API が7ドメイン（`window` / `settings` が増えただけ）、**`files` は従来どおり7つで監視 API は増えていない**こと、`settings` が2つ、`window` が2つ（**閉じる手段は無い**）だけであること、Node / process / electron / Buffer / monaco が露出しないこと

Auto Save・設定の永続化・文字コード（ビルド版 36項目）:

- **4つの mode がすべて並ぶ**こと、初期値が `off` であること
- `off`: 自動保存されず印が残ること、Ctrl+S では保存されること
- `afterDelay`: 入力が止まったら保存されること、**10文字の連続入力で書き込みは1回**であること
- `onFocusChange`: 編集直後は保存されないこと、**タブを離れると保存される**こと
- `onWindowChange`: タブを移っただけでは保存されないこと、**ウィンドウを離れると開いている未保存がすべて保存される**こと
- 永続化: `userData` 配下に `editor-settings.json` ができること、`schemaVersion` / mode / delay を持つこと、**プロジェクトフォルダには書かれない**こと、**再起動後も設定が維持される**こと、UI にも復元されること
- 壊れた設定ファイル: 落ちずに起動し、既定（OFF）で始まり、その後の保存で正常な内容に直ること
- **UTF-8 BOM**: BOM 付き・CRLF として開くこと、**保存しても BOM と CRLF が保たれる**こと、**BOM 無しのファイルに BOM が足されない**こと

未保存の保護（ビルド版 43項目）:

- **タブを閉じる**: 確認が出ること、3つの選択肢が並ぶこと、**初期 focus がキャンセル**であること、Escape でも取り消せること
- Cancel: 閉じないこと、未保存も編集内容も残ること
- Save: 保存して閉じること、ディスクに書き込まれること
- Don't Save: 保存せず閉じること、ディスクが変わらないこと、**開き直しても未保存の内容が復活しない**こと
- **Save が成立しない場合は閉じない**: Conflict のタブで Save を選ぶと閉じずに理由が出ること、ディスクが書き換わらないこと、キャンセルすると Conflict の選択肢へ戻れること
- 削除済みのタブ: **必ず失敗する「保存」を出さない**こと、破棄して閉じられること
- **Workspace を閉じる**: 確認が出ること、複数の未保存ファイルが並ぶこと、何をしようとしているかが分かること、キャンセルで閉じずタブも残ること
- **Workspace を切り替える**: 確認が出ること、キャンセルで変わらないこと、「すべて保存」で保存してから切り替わること
- **アプリを終了する**: `app.quit()` でも確認が出ること、キャンセルで終了が取り消されて操作を続けられること、**ウィンドウの close でも同じ確認が出る**こと、保存を選べば保存してから閉じること

dev 版（21項目）: 同じ流れが dev でも動くこと（外部変更・Conflict・Compare・上書き・afterDelay・onWindowChange・外部削除・タブと Workspace の確認）、**その間レイアウト検査（`findLayoutProblems`）が一度も報告しない**こと、CSP 違反が無いこと。

**dev では Compare を開いたときに `no diff result available` が1回出る。** 開発ビルドの React.StrictMode が effect を意図的に2回走らせる（mount → cleanup → mount）ため、1回目の Model が捨てられた後に Monaco の差分計算が戻ってきて、Monaco 側がそこを null 検査せずに投げる（`diffProviderFactoryService.js`）。**配布ビルドでは出ない**（StrictMode の二重呼び出しは React の開発ビルドだけ。ビルド版の確認でも一度も出ていない）し、2回目の mount が作った Model で差分は正しく表示される。こちらから止める手立ては無い（計算を始めるのも取り消すのも Monaco の中）ため、find widget の `aria-hidden` 警告と同じく**開発時の既知の挙動**として扱う。切り分けは「Compare を開いたまま待つ」だけで付く（閉じなくても出るので、後片付けの問題ではない）。

Session 3-5.2（Files 削除エラー分類の改善）では、**ごみ箱へ送れない状況を実際に作って**、出てくる文言を読んだ。ビルド版 5項目 / dev 版 4項目、いずれも全項目 PASS。

- **使用中のファイル**: 他プロセスが排他で開いているファイルの削除が「他のアプリで使用されている可能性があります。閉じてからもう一度削除をお試しください」になること、**ファイルが消えていない**こと
- **中身が使用中のフォルダ**: フォルダ自身は開けても、**中の1ファイルが掴まれていれば同じ文言になる**こと（理由の位置まで探しに行けていること）
- **権限が無いファイル**: ACL で拒否したファイルを削除するとシェルの昇格ダイアログが出て、**閉じた後に**「このファイル / フォルダを削除する権限がありません」になること
- **末尾に空白を持つ名前**（Session 3-5.1 の回帰）: 渡さずに断ること、**隣の `trailing.txt` が巻き込まれていない**こと
- 回帰: 普通のファイルの削除がこれまでどおり成功し、ツリーから消えること

dev 版（4項目）: 使用中のファイル / 中身が使用中のフォルダ / 通常の削除 / 末尾空白の4つが**ビルド版と同じ文言になる**こと。

Session 3-6-1（Files のファイル移動）では、右クリック →「移動…」→ 行き先のフォルダを右クリック →「ここへ移動」を実際のマウス操作として通した。ビルド版 / dev 版とも 31項目、いずれも全項目 PASS。

- メニューの出し分け: ファイル / フォルダに「移動…」が出ること、**移動を始める前は「ここへ移動」を出さない**こと、移動中は「移動…」を出さないこと、移動先になれない場所でも「移動をやめる」は必ず出ること
- **成立しない移動先を出さない**: 今いるフォルダ（`same-parent`）にも、**自分自身の中のフォルダ**（`into-self`）にも「ここへ移動」が並ばないこと
- 移動: ファイルが別フォルダへ動きディスクに反映されること、**移動先が自動で開かれ動かしたものが選ばれている**こと、案内が消えること、動かす行に印が付くこと
- フォルダの移動: **中身ごと動く**こと、**開いていたタブが新しい位置へ追従する**こと（`src/lib/util.ts` → `docs/lib/util.ts`）
- Workspace root: 移動先になること、root へ動かせること
- 同名衝突: 「移動先に同じ名前のファイル / フォルダが既にあります」と**行き先の話だと分かる文言**になること、**両方の中身が無事**であること（上書きしていない）、**失敗しても移動をやめず**別の行き先を選び直せばそのまま通ること
- やめる: Escape で移動をやめられること
- 境界: 11種の脱出（`..` / `../outside` / `../../secret.txt` / `docs/../../outside` / 絶対パス（`C:\…` / `C:/…` / `/…` / UNC）/ ドライブ相対 / 代替データストリーム / NUL）を、**動かす側と行き先の両方**へ渡して拒否されること、Workspace の外に何も現れていないこと
- **UI が出さない要求を API から直接叩く**: 自分自身 / その配下への移動が `INVALID_REQUEST` + `detail: destination-inside-source` になること（Renderer 側の出し分けをすり抜けても Main が断る）、そのとき何も壊れていないこと、ファイルの中への移動が拒否されること
- 同じフォルダへの移動が**成功として返り、中身も変わらない**こと（`already-exists` にしない）
- セキュリティ: `files` API が8つ（`move` が増えただけ）であること、Node / require が露出しないこと、Renderer で例外が出ていないこと

Session 3-6-2（Files のコピー / ペースト）では、右クリック →「コピー」→ 貼り付け先を右クリック →「ここに貼り付け」を実際のマウス操作として通した。**ビルド版 31項目 / dev 版 32項目 + API 直叩き 17項目、いずれも全項目 PASS。** UI のシナリオはビルド版と dev 版で同じものを走らせている（同じ結果になることが確かめたいことなので、2つ書かない）。

- メニューの出し分け: ファイル / フォルダに「コピー」が出ること、**控えが無いうちは「ここに貼り付け」を出さない**こと、控えがある間は「コピー」「移動…」を出さないこと、貼り付け先になれない場所でも「コピーをやめる」は必ず出ること
- **成立しない貼り付け先を出さない**: 自分自身にも自分の中のフォルダにも「ここに貼り付け」が並ばないこと。**ただし今いるフォルダには出る**（移動と違い、そこが複製の操作そのものになる）
- コピー: 別フォルダへ複製されディスクに反映されること、**元が手つかずで残る**こと、コピー先が自動で開かれできたものが選ばれること、コピー元の行に印が付くこと（**移動のように薄くはしない**）
- **貼り付けても控えを残す**こと（続けて別の場所へ貼れる）
- 同名衝突: 上書きせず `example copy.txt` → `example copy 2.txt` と名前が変わること、**元も先も中身が無事**であること
- フォルダの再帰コピー: 中身ごと複製されること、**空のフォルダも作られる**こと、深い階層が保たれること
- リンク: フォルダの中のジャンクションが**とばされ、件数が画面に出る**こと、指し先の中身がコピー先に現れないこと、**リンクそのもののコピーは断られる**こと、Workspace の外の実体が無事であること
- コピー元が消えた後の貼り付けが「対象が見つかりません」になること、**失敗しても控えを解かない**こと
- やめる: Escape とメニューの「コピーをやめる」の両方で解けること、**移動を始めると案内が1行だけになる**こと（2つの「次に何かする」状態を同時に持たない）
- 回帰: 移動（3-6-1）・作成 / 改名 / 削除（3-3）がそのまま動くこと
- **UI が出さない要求を API から直接叩く**（17項目）: 11種の脱出を**コピー元とコピー先の両方**へ渡して拒否されること、自分自身 / その配下へのコピーが `INVALID_REQUEST` + `detail: destination-inside-source` になること、リンクが `detail: source-is-link` になること、リンクの中 / リンクの中のものが `PERMISSION_DENIED` になること、ファイルの中・root 自身・存在しないものが断られること、成功の応答が `entry` と `skippedCount` を持つこと
- セキュリティ: `files` API が9つ（`copy` が増えただけ）であること、Node / require が露出しないこと、Renderer で例外が出ていないこと

確認の要領（コピー特有のもの）:

- **ジャンクションは `fs.symlinkSync(target, path, 'junction')` で作れる**（管理者権限は要らない）。ファイルを指す symlink は開発者モードが要るため、作れなければその項目だけ飛ばす。
- **「とばした件数」は成功の表示**なので `.fx-files__error` ではなく `.fx-files__pending[data-copy-skipped]` を見る。失敗と混ぜて数えると、成功しているのに失敗したように読める。
- **同じフォルダに貼り直す確認では、控えが残ることを利用する。** 貼り付けのたびに「コピー」からやり直すと、控えを残す振る舞いの方を確かめ損ねる。
- **フォルダの中の行を右クリックする前に、そのフォルダを開く。** Lazy Load なので、畳んだままでは行そのものが DOM に無い（`data-expanded` を見てから開く）。

Session 3-6-3（Files パネル内のドラッグ&ドロップ）では、行を掴んでフォルダ / ツリーの余白へ落とす操作を実際のマウス操作として通した。**ビルド版 64項目 / dev 版 59項目、いずれも全項目 PASS。** UI のシナリオはビルド版と dev 版で同じものを走らせ、差の5項目は Main 側の `readdir` を数える確認（`app.evaluate` が要るため CDP 接続の dev 版では走らせられない）。

- Move: ファイル → フォルダ、フォルダ → フォルダ（中身ごと）、深い階層（4段）へ、空フォルダへ落とせること。いずれもディスクに反映され、行き先が自動で開かれること
- Copy: Ctrl を押しながらで**元が残る**こと、コピー先に同名があれば `dup copy.txt` として作られること
- **root への Drop**: ツリーの**余白**へ落として Workspace 直下へ動くこと、**root 行**へ落としても同じ結果になること
- ガイド: 落とせるフォルダ行に `data-drop` が付くこと、余白ではツリーに `data-drop-root` が付き**行には付かない**こと、掴んでいる行に `data-dragging`（move / copy）が付くこと
- **落とせない場所ではハイライトを出さない**: 自分自身・自分の子孫フォルダ・今いるフォルダ（move）・ファイル行・「（空のフォルダ）」の案内行。いずれも `data-drop` も `data-drop-root` も付かず、離しても**何も起きず失敗も出ない**こと
- **Ctrl の切り替え**: マウスを動かさずに Ctrl を押すと同じフォルダがハイライトされ（copy なら成立する）、離すと消えること。押した状態で離すと `main copy.ts` ができること
- 同名衝突（move）: 「移動先に同じ名前のファイル / フォルダが既にあります」が出て、**両方が無事**であること
- **ジャンクション**（Workspace の外を指す）: ツリーではフォルダに見えるのでハイライトは出るが、**Main が拒否**すること、Workspace の外に何も持ち出されていないこと ── Renderer の判定が許可の根拠ではないことの確認
- キャンセル: Escape で案内（ハイライトと小さな表示）が消え、そのまま離しても動かないこと
- 回帰: **ドラッグしていないクリックは今もファイルを開く / フォルダを開閉する**こと、**ドロップした行は開かれない**こと（離した後の click を飲んでいる）、ドラッグ移動でも **Editor のタブが新しい位置へ追従する**こと、右クリックの移動（3-6-1）とコピー / 貼り付け（3-6-2）がそのまま通ること
- **Lazy Load**（ビルド版のみ）: 1回のドラッグ移動で読み直されるのが「元の親」と「行き先」の2つだけであること、コピーでは「コピー先」だけであること
- ガイドが当たり判定を奪わないこと: カーソルに付く小さな表示の `pointer-events` が `none` であること

確認の要領（ドラッグ特有のもの）:

- **ポインタイベントで実装しているので、`mouse.down` → `mouse.move` → `mouse.up` がそのまま判定に入る。** ただし**しきい値（4px）を超える最初の1回**を必ず入れること。超えないままカーソルを運ぶと、ドラッグではなくクリックとして終わる。
- **Ctrl は `keyboard.down('Control')` で押したままにする。** Playwright は以降のマウスイベントに修飾キーを載せるため、`ctrlKey` を見る実装がそのまま動く。**押し下げ / 離しだけで案内が変わることも確かめられる**（マウスを動かさずに `readGuide` を読む）。
- **余白の座標は「一番下の行の下」から作る。** ツリーの中央を狙うと行の上になる。行と案内行の矩形の最大値を取り、その下 8px を使う（余白が無ければその項目は成立しないので、空きの大きさも記録する）。
- **案内は離す前に読む。** `mouse.up()` の後では state が消えている。`data-drop` / `data-drop-root` / `.fx-file-drag` は掴んでいる間にまとめて読む。
- **Editor のタブ追従は、実際にそのファイルを開いてから確かめる。** 「開いたつもりの別のファイル」を動かすと、タブが増えも変わりもせず**追従の失敗と区別が付かない**（この確認で一度取り違えた）。
- **`data-relative-path` を行から読む。** `title` 属性は root 行だけ絶対パスになるため、行き先の照合には使えない。

Session 3-6-4（プロジェクト全体検索① 走査 + ファイル名）では、専用の Workspace を作って検索を UI から通した。**ビルド版 30項目 / dev 版 8項目、いずれも全項目 PASS。** 確認用の Workspace には、深い階層（15 段）・大量ファイル（1,200 件）・`.git` / `node_modules`・特殊文字と長い名前・日本語名・**Workspace の外を指すジャンクション**を並べてある。

- 通常検索: 部分一致で見つかること、**大文字 / 小文字を区別しない**こと（`TargetFile.ts` を `target` でも `TARGETFILE` でも引けること）、一致部分に印が付くこと
- 深い階層: 10 段目のファイルが見つかり、**上限（12 段）より下（15 段目）は出ない**こと。そのとき「深い階層は検索していません」が案内に出ること
- 大量ファイル: 1,200 件の中から 500 件で打ち切られ、**上限の数（500）が文言に出る**こと
- 除外: `.git` の中と `node_modules` の中が1件も出ないこと
- **Workspace 外への脱出防止**: ジャンクションの指し先にある `OUTSIDE-SECRET-target.txt` が結果に出ないこと。**リンクそのものは1件（フォルダとして）出る**こと
- 特殊文字 / 長い名前 / 日本語: `my target (final) [v2].txt` を `(final)` で（正規表現として解釈せず字義どおりに）、200 文字の名前、`設計メモ-target.md` を `メモ` で引けること
- 絶対パスを渡していないこと: 結果の `data-relative-path` にドライブレターで始まるものが1つも無いこと
- 状態の区別: 0 件が「一致するファイルはありません」として出ること、打ち切りが件数と理由の両方で伝わること
- **検索キャンセル**: 走っている検索を `files:cancel-search` で止められること（応答が `cancelled` で返る）
- **連続検索**: 2本続けて投げると、**先の1本が `cancelled`・後の1本が `completed`** になること（走るのは常に1本）
- **古い識別子での取り消しは、今の検索を止めない**こと（止める操作と次の入力が前後しても、始まったばかりの検索が消えない）
- 結果クリック → Editor Open: タブが開くこと、**開いた後も検索モードのまま**であること、dev 版では Monaco に中身が出るところまで
- ツリーへ戻れること、戻ったときに**開いた場所の祖先が開かれて選択されている**こと
- 行き来しても**検索語も結果もツリーの展開状態も残る**こと（どちらも作り直していない）
- Workspace 切替 / Close: どちらも進行中の検索が `cancelled` になること
- 回帰: Files Tree の Lazy Load（畳んで開き直すと読み直す）と、ツリーからのファイルオープンがそのまま通ること

確認の要領（検索特有のもの）:

- **「探し終わったか」は `.fx-search__status` の `data-status` で待つ。** 結果の行が増えるのを待つ形にすると、0 件の検索が待てない（行が1つも増えないことと、まだ探していることの区別が付かない）。
- **取り消しと連続検索は Renderer から API を直接叩いて確かめる。** 確認用の Workspace は数千件で、UI から「中止」を押す前に終わってしまう ── 確かめたいのは**取り消しの経路そのもの**なので、`window.fluvix.files.search(...)` の Promise を持ったまま `cancelSearch` を呼び、応答の `status` を見る。
- **Workspace 切替 / Close も同じ形で確かめる。** 走っている検索を残したまま `workspaceFolder.open()` / `close()` を呼び、その検索が `cancelled` で返ることを見る。画面の追従はここでは見ない（Renderer の写しは UI 経由でないと更新されない。§4 の既知事項）。
- **reveal の後にツリーの展開を確かめるときは、既に開いていることを見込む。** 検索結果を押すと祖先が開かれるため、`data-expanded` を見ずに行を押すと**畳む操作**になる（この確認で一度取り違えた）。
- **モードの切り替えは `hidden` で見る。** 両方が DOM に残る作りなので、「表示されているか」は `.fx-files-view__pane` の `hidden` で判断する（要素の有無では判断できない）。

Session 3-6-5（プロジェクト全体検索② 全文検索）では、同じ要領で **ビルド版・dev 版の両方**を通した。**全項目 PASS。** 確認用の Workspace には、複数階層のソース・日本語を含むテキスト・**バイナリ**・`.git` / `node_modules`・Workspace の外を指すリンクを置き、上限の確認だけ一時的にファイルを足して行った。

- 通常の全文検索: `example` が4ファイル7件として、**フォルダ → ファイル → 一致**の3段で並ぶこと。一致部分に印が付くこと
- 位置: 一致の行に `3:7` のように**行:桁**が出て、それが Editor の行番号と一致すること
- 除外・読み飛ばし: `.git` / `node_modules` の中と、**バイナリ**（`example` を含む `.bin`）が1件も出ないこと
- 日本語 / Unicode: `検索対象` で2ファイルが引け、**桁が文字数で正しいこと**（`// 日本語の検索語テスト: 検索対象` の 16 桁目）
- Editor ジャンプ: 結果を押すとタブが開き、**押した行がカーソル行になり、一致した語が選択されている**こと
- **タブを重複させないこと**: 同じファイルの別の一致を押しても**タブが増えず**、位置だけが動くこと。別のファイルなら増えること
- 上限（1ファイル）: 60 件ある語で **50 件で止まり**、ファイル行に `50 件以上`、案内に「1ファイルにつき 50 件まで」が出ること
- 上限（総数）: 1,200 件ある語で **1,000 件（25 ファイル）で止まり**、上限の数が文言に出ること
- 状態の区別: 0 件が「一致する**テキスト**はありません」として出ること（名前の検索の「一致するファイルはありません」と言い分けている）
- モードの往復: ファイル名 ⇄ 全文を行き来しても、**どちらの結果も消えない**こと
- 回帰: ファイル名検索（3-6-4）、外部変更の監視（アプリの外で作ったファイルがツリーに出る）、Lazy Load、右クリックからのリネーム / 削除、ツリーからのオープン、編集 → Ctrl+S でディスクに書けること

確認の要領（全文検索特有のもの）:

- **飛んだ先の行は Monaco の `.active-line-number` で読む。** カーソル位置を DOM から直接読む手段は無いが、行番号の余白には現在行の印が付く。選択されているかは `.selected-text` の有無で分かる。
- **タブが増えていないことは、押す前後の件数で見る。** 「同じファイルなら増えない」は、増えた場合と見分けが付く形（前後の差）でしか確かめられない。
- **上限の確認はファイルを一時的に足して行う。** 既定の上限（1,000 件 / 2,000 ファイル）は普通の Workspace では当たらない。60 件を1ファイルに、40 件 × 30 ファイルを別フォルダに置けば、1ファイルの上限と総数の上限を別々に踏める（確認後に消す）。
- **検索モードは前回のまま開く。** 結果を捨てない作りなので、確認スクリプトは `[data-active]` を見てから切り替える（決め打ちで押すと逆のモードへ移る）。
- **結果は debounce（400ms）＋走査のぶん待つ。** 名前の検索（200ms）より長く、読み込みも挟まる。語を入れ替えた直後に読むと、**前の語の結果を読んでしまう**（この確認で一度取り違えた）。

**権限が無い対象では、`shell.trashItem` が Windows の昇格ダイアログ（「ファイル アクセスの拒否」）を出して待つ。** 利用者が答えるまで Promise は解決しない ── アプリ側から止める手立ては無く（ダイアログを出すのはシェル）、利用者から見れば「OS が確認を出している」ので不具合ではないが、**自動確認では固まって見える**。分類が走るのは利用者がそれに答えた後になる。

確認の要領:

- **排他ロックは PowerShell から作る。** Node には他プロセスの排他ロックを作る手段が無い（`fs.open` は共有モードで開く）。`Start-Process powershell -Command "$fs=[System.IO.File]::Open('<path>','Open','ReadWrite','None'); Start-Sleep -Seconds 3600"` で掴んだままにし、**掴めたことを確かめてから**アプリを動かす（起動が間に合わないと、ロック無しの状態を確かめて「成功した」ことになる）。ロックには寿命があるので、確認を挟むたびに掴み直す。
- **権限が無い対象は `icacls <path> /inheritance:r /deny "<user>:(F)"` で作り、確認後に必ず戻す。** 戻し忘れると後片付け（`rm -rf`）まで失敗する。昇格ダイアログはアプリプロセスの MainWindow ではないため、`Get-Process` の `MainWindowTitle` では見つからない ── `EnumWindows` でトップレベルを総なめして `WM_CLOSE` を送る。
- **Monaco の画面を読むときは2つ注意する。** `.view-line` の **DOM の順序は行の順序ではない**（Monaco は行の DOM を使い回して `top` で並べる）ので、必ず `style.top` で並べ替える。また空白は **U+00A0（non-breaking space）** として描かれるため、素の空白に戻してから比較する。どちらも「入力が反映されていない」ように見える偽の失敗を作る。
- **構文ハイライトは待ってから見る。** 言語ごとのトークナイザは動的 import で後から届くため、Model を作った直後は全体が既定色（`mtk1`）のまま。`.view-line span[class^="mtk"]` の種類が2つ以上になるのを待つ。
- **Undo は「未保存の印が消えるまで」押す。** Monaco は打鍵をいくつかの Undo Stop に区切るため、1回の Ctrl+Z で全部が戻るとは限らない。回数の上限だけを見張る形にすると、Monaco 側の区切り方に依存しない確認になる。
- **Worker は `window.Worker` を差し替えて記録する。** Monaco が読み込まれる**前**（＝最初のファイルを開く前）に差し替えれば、起動した Worker の URL がすべて残る。`blob:` を使っていないことは、この記録で直接確かめる（CSP エラーが出ないことは「たまたま起きなかった」と区別が付かない）。
- **保存の回数は Main 側の `fs/promises.writeFile` を差し替えて数える。** debounce が効いているか・拒否された要求で本当に書いていないかは、応答ではなく実際の書き込みで見る（`readdir` を記録する Session 3-2 の要領と同じ）。
- **Workspace を開くのは UI から行う。** `window.fluvix.workspaceFolder.open()` を直接叩くと Main 側の正本だけが変わり、Renderer の写し（`WorkspaceFolderProvider` の state）は更新されないため、画面は未選択のまま動かない。
- **dev 版は `electron-vite dev` の dev server へ繋ぐ。** 自前の Vite 設定で renderer を配信すると、`/@fs/` 配下のフォントが index.html にフォールバックして Monaco のアイコンフォントが壊れる（アプリ側の不具合ではない）。`npx electron-vite dev` を起動したまま `ELECTRON_RENDERER_URL=http://localhost:5173` を渡した Electron を別に立てる。`--user-data-dir` が別なら単一インスタンス制御にも掛からない。
- **Lazy Load は DOM ではなく `readdir` の呼び出しで確かめる。** Main 側で `process.mainModule.require('fs/promises').readdir` を差し替えて呼び出し先を記録する（`import { readdir } from 'fs/promises'` はビルド後も呼び出し時にモジュールオブジェクトのプロパティを引くため、この差し替えが実装側にも効く）。「画面に出ていない」ことと「読んでいない」ことは別なので、後者を直接見る。Workspace の外に触れていないことの確認も同じ記録で行う。
- **Workspace 外への脱出は、UI ではなく Renderer から直接 API を叩いて確かめる。** `win.evaluate(() => window.fluvix.files.readDirectory({ relativePath: '..' }))` の形。UI から出せない要求こそが確かめたい対象のため。
- **symlink の代わりにジャンクションを使う。** Windows で `fs.symlinkSync(target, path, 'junction')` は管理者権限が要らない。境界の検証（realpath まで解決してから判定）はどちらでも同じ経路を通る。
- **ジャンクションの削除は「リンクだけが消えたか」で確かめる。** 「拒否されること」を確かめる項目とは別に、**指し先の中身が残っていること**を実ファイルで見る。境界の検証は親フォルダに対して行うため（ARCHITECTURE.md §10.2）、ここが意図どおりかはドキュメントの読み合わせではなく実際の削除でしか確認できない。
- **Workspace の外に何も作られていないことは、fs で直接数える。** API が拒否を返したことと、何も起きなかったことは別。脱出を試した後に `readdirSync` で外側のフォルダの中身を突き合わせる。
- **外部変更はドライバ側の Node から普通に書く。** 監視を確かめるのに特別な仕掛けは要らない ── `writeFileSync` / `unlinkSync` で Workspace の中を書き換え、束ねの時間（120ms）＋反映を見込んで 1.5 秒ほど待ってから画面を読む。**「アプリの外」を本当にアプリの外から起こす**のがこの確認の要点で、IPC を叩いて再現すると監視そのものを試したことにならない。
- **onWindowChange は `window.dispatchEvent(new Event('blur'))` で起こす。** ドライバからウィンドウのフォーカスを外す手段が無いため。実装が listen しているのはこのイベントそのものなので、経路としては同じものを通る。
- **アプリ終了の確認は `app.evaluate(({ app }) => app.quit())` で起こす。** ウィンドウの × は `BrowserWindow.getAllWindows()[0].close()` で、どちらも同じ 'close' を通ることをそれぞれ確かめる。**確認をキャンセルした後もウィンドウが生きていること**まで見ないと、「止められた」ことの確認にならない。
- **保存を選んで閉じた後は `win` に触らない。** ウィンドウが実際に閉じるため、その後の `waitForTimeout` はドライバ側の例外になる。`win.waitForEvent('close')` を先に張り、以降はディスクだけを読む。
- **BOM はバイト列で見る。** 文字列で読むと BOM が見えない（多くの API が黙って落とす）。`readFileSync` の先頭3バイトが `239,187,191` かどうかで確かめる。
- **Auto Save の書き込み回数も Main 側の `fs/promises.writeFile` を数える**（Session 3-4 と同じ要領）。「保存された」ことと「何回書いたか」は別で、debounce が効いているかは後者でしか分からない。
- **イベント経路は Renderer 側で受け取った payload をそのまま検査する。** `window.fluvix.files.onChanged` で配列に溜め、`sender` / `ports` / `preventDefault` が含まれていないことを見る。「Preload で剥がしているつもり」を実物で確かめるため。
- **ネイティブのフォルダ選択ダイアログはドライバから操作できない。** `app.evaluate(({ dialog }) => { dialog.showOpenDialog = … })` で差し替えて駆動する。`import { dialog } from 'electron'` は同じオブジェクトを参照するため、この差し替えがハンドラ側にも効く。差し替えた関数の中で引数を記録しておくと、モーダルの親ウィンドウと `properties` / `defaultPath` もそのまま確認できる。応答を遅らせれば、開いている間の二重押しも確かめられる。
- **本物のダイアログを開く確認は最後に行い、プロセスごと終了させる。** ドライバからは閉じられないため、`app.process().pid` を `taskkill /F /T` する。
- **`--user-data-dir` で保存先を隔離する。** Electron の起動引数としてそのまま渡せる（`args: [ROOT, '--user-data-dir=<一時ディレクトリ>']`）。利用者の実データを汚さずに済み、初回起動の状態からやり直せる。保存ファイルを壊す確認もこのディレクトリに対して行う。
- **復元を待ってから測る。** 復元中は枠だけを描く（`.fx-workspace[data-restoring]`）。`.fx-workspace:not([data-restoring])` を待ってから DOM を読む。
- **閉じる前に間引きの時間を置く。** Renderer 400ms + Main 400ms のため、変更から 1 秒ほど待ってから閉じると、終了時の取りこぼし経路に依存せずに確認できる（その経路自体は別項目で確認する）。
- `electron-vite build --mode development` では **dev の Renderer にならない**（`import.meta.env.DEV` は false のまま）。レイアウト検査を効かせた確認をするには、Renderer を Vite dev server で配信して `ELECTRON_RENDERER_URL` を渡した Electron を起動する（§4 冒頭の方法）。

ポインタイベントで実装しているため、`mouse.move` の座標がそのまま判定に入る。HTML5 の Drag and Drop API と違い、ドライバから素直に再現できる。

**矩形を基準に座標を組み立てる確認では、測った直後に掴むこと。** 起動直後はウィンドウ状態の復元でウィンドウサイズが変わり、dev 版では Vite の依存の再最適化でページが再読み込みされる。どちらも直前に取った矩形を古いものにするため、離れた場所で測った座標で掴むと隣の要素（タブ列など）を掴んでしまい、別の操作として成立してしまう。確認スクリプト側では、
（1）起動後にウィンドウサイズを固定して落ち着くまで待つ、
（2）掴む位置は掴む直前に DOM から取る、
（3）掴めたこと（`data-resizing`）を確かめてから動かす、
の3点で防いでいる。

**タブを掴むときは `.fx-panel-tab__label` を掴むこと。** Session 2-5 でタブに閉じるボタンが入ったため、タブ全体の矩形の中央が × に当たることがある。当たると、ドラッグのつもりの操作がパネルを閉じる操作になる。

**掴み手は split の id ではなく「両隣に何が居るか」で選ぶこと。** 初期レイアウト以外のノード id は発番されるもの（`dock-N`）で、操作のたびに変わる。連続した操作を通す確認では `data-split-id` を当てにできないため、掴み手の `previousElementSibling` / `nextElementSibling` に目的のパネルが含まれているかで探す。この形にしておくと、木がどう組み変わっても同じ書き方で境界を指せる。

Session 3-6-7（Files の横長時のカラム表示）では、**dev 版 44項目 / production ビルド版 6項目、いずれも全項目 PASS。** 確認用の Workspace には、深い階層（`src/renderer/files/deep/deeper/deepest`）・空のフォルダ・移動先のフォルダ・種類別アイコンが付く名前（`package.json` / `README.md`）を置いた。

- 表示方式の自動判定: 左ドック（240 × 675）ではツリー、**画面下部へ横長にドック（1634 × 320）すると自動でカラム**になること。右ドックへ戻すとツリーへ戻ること（いずれもまだ選んでいない状態）
- 利用者の選択: ツールバーで選ぶと `explicit` になり、**置き場所を変え続けても（下 → 左 → 右）表示方式が変わらないこと**。選択中のボタンをもう一度押すと「形に合わせる」状態へ戻ること
- カラムの操作: 階層の分だけ列が増えること（root から7列）、辿っている道に印が付くこと、**浅いフォルダを選び直すと右の列が消えること**、ファイルを選んでも列が増えないこと
- スクロール: 全体が横スクロールできること、**新しい右端の列が見えていること**、カラムの内側が縦スクロールであること、横長では複数列（5列）が同時に見えていること
- 共有の確認: ツリーで開いていた場所をカラムが引き継ぐこと（**読み直しが起きない**）、種類別アイコンが同じこと、作成の入力欄が作成先のカラムに出ること
- ドラッグ&ドロップ: **カラムをまたいで**行をフォルダ行へ落として移動できること、案内が出ている行と行き先が一致すること、**カラムの余白へ落とすとそのカラムのフォルダへ移る**こと（余白が光ること）
- 回帰（ツリー）: Lazy Load（開いていないフォルダを読まないこと）、右クリックからの改名 / 削除、ドラッグでの移動、Ctrl+ドラッグでのコピー（元が残ること）、種類別アイコン、ファイルを押すと Editor で開くこと
- 回帰（検索）: ファイル名検索 → 結果から Editor で開けること → **戻ると、その場所がカラムでも見えていること**。production 版では全文検索（`needle` が2ファイル）
- 回帰（Workspace）: **カラム表示から Workspace を閉じられること**（左端のカラムの見出しの ×）

確認の要領（カラム表示特有のもの）:

- **カラムの操作は「横長に置いた状態」で確かめる。** 240px の細いパネルでカラムを出すと、左の列が横スクロールで画面の外に出る（`getBoundingClientRect().x` が負になる）。そこへドロップしようとすると、製品ではなく確認の条件が原因で失敗する。パネルをドックし直してから通すこと。
- **パネルを動かす確認の前に、保存されたレイアウトを消すこと。** レイアウトは自動保存されるため、前回の確認でドックした形のまま次が始まる（`workspace-layout.json` を消してから起動する）。アプリの終了より先に消すと、終了時に書き戻されて残る。
- **F2 / Delete はドライバからは不安定。** 行そのものが focus を持つ前提（roving tabindex）だが、ファイルを押した直後は Monaco が focus を取りに来る。確認したいのは操作が通ることなので、右クリックメニュー（`.fx-file-menu__item[data-action]`）から通す。
- **検索欄は「見えている方」を掴む。** 名前 / 全文の両方を持ったまま切り替える作りなので、`.fx-search__input` は2つある（`:visible` で絞る）。
- **playwright の後片付けはアプリを閉じる。** `connectOverCDP` した接続がプロセス終了時に閉じられると Electron ごと終了するため、確認スクリプトを走らせるたびに起動し直す前提で書く。

Session 3-6-8（Files の仕上げ）では、**production ビルド版 16項目、全項目 PASS。** 確認したいことが「アプリを閉じて開き直しても残るか」なので、1本のスクリプトの中で**起動 → 操作 → 終了 → 再起動**まで通している。

- 見え方の保存: 起動直後は `files-settings.json` が無いこと（未保存＝既定で始まる）、カラムを選ぶと `mode: 'columns'` として書かれること、**起動し直すとカラム表示で始まること**（細いパネルなら本来ツリーを勧める形でも、選んだ方が勝つ）、「パネルの形に任せる」へ戻すと `mode: 'auto'` として書かれること
- カラムの幅: 境目を掴んで動かすと幅が変わること（160 → 220px）、変えた幅が保存されること、**下限（160px）で止まること**、**起動し直すと同じ幅で始まること**
- 自動スクロール（カラム）: 溢れているカラムの下の縁でカーソルを止めると、**動かさなくても流れ続けること**、離すと止まること
- 自動スクロール（ツリー）: 一番下のファイルを掴んで上の縁で止めると先頭まで流れ、**そこで現れたフォルダへそのまま落として移動できること**（結果は実ディスクの `readdir` で確認）

確認の要領（この回で分かったもの）:

- **掴み手の位置は掴む直前に測り直す。** カラムの掴み手は列の右の縁にあり、幅を変えるたびに動く。細いパネル（240px）では、広げた瞬間に掴み手が**横スクロールの先へ隠れる** ── 前に測った座標で掴むと、何も起きないまま「幅が変わらない」という偽の失敗になる。上下限を確かめるときは、**掴み手が画面に残る向き（狭める側）から先に**通すのが確実。
- **カラム表示では root は行ではなくカラムの見出しに出る。** Workspace が開いたことを `.fx-file-row__name` だけで待つと、カラム表示で始まった起動では永遠に待つ。`.fx-file-column__name` も見ること。
- **自動スクロールは「止めたまま待つ」ことでしか確かめられない。** `mouse.move` を刻んで縁へ運ぶと、動かした分と流れた分の区別が付かない。縁へ運んだ後は**座標を1回も動かさずに**待ち、その間に `scrollTop` が動くことを見る。
- **落ちた結果はディスクで見る。** 画面の行が消えた / 増えたは、読み直しの途中でも同じに見える。`readdir` で移動先と元の両方を突き合わせる。

Session 3-7-1（Terminal の基盤）では、**production ビルド版 25項目、全項目 PASS。** シェルは OS のプロセスなので、画面だけでなく**プロセスが本当に居なくなったか**まで確かめている（`Get-CimInstance Win32_Process`）。

- 起動と描画: Terminal パネルが出ること、遅延読み込みの器（`[data-testid="terminal-surface"]`）が付くこと、xterm が DOM を組み立てること（`.xterm-screen`）、バーにシェル名（`PowerShell`）が出ること
- 出力の経路: プロンプトが描かれること（Main → Renderer のイベント経路）、**cwd が Workspace になっていること**（`PS D:\DEV\PROJECTS\Fluvix Nexus>`。Renderer は cwd を指定していない）
- 入力の経路: `echo` を打って**シェルが返した行が画面に出る**こと（打った行と結果の2つが出る）
- 環境変数: シェルの中で `$env:ELECTRON_RUN_AS_NODE` が**空である**こと（引き継いでいない）
- パネルを動かす: Terminal タブを Files パネルへドロップした後も、シェルが動き続け、**スクロールバックが残り**、そのまま打てること
- パネルを閉じて戻す: タブの × で閉じている間も**シェルが動き続ける**こと（pid で確認）、View メニューから戻すと**スクロールバックが残っている**こと、**シェルが増えていない**こと、戻した後も打てること
- 終了と立て直し: `exit` で「終了しました（コード 0）」が出ること、**終わっても画面が読み返せる**こと、「新しいターミナル」で立て直せること
- Workspace の切り替え: 切り替えると**古いシェルが片付けられる**こと（pid が消える）、新しい Workspace を cwd として立ち上がること、**画面が引き継がれない**こと ── **この扱いは Session 3-7-3 で改めた**（切り替えでは終わらせない）。今の振る舞いは 3-7-3 の項を見ること
- Workspace 未選択: パネルが「Workspace が開かれていません」と開く入口だけを出すこと
- 終了時の後始末: アプリを閉じると**シェルが残らない**こと。シェルの中で長く動く子プロセス（`ping -t`）を立てた状態で閉じても、**その子まで道連れになる**こと（1秒以内）

確認の要領（この回で分かったもの）:

- **`powershell.exe -NoLogo` をコマンドラインで検索すると、検索している PowerShell 自身が引っかかる。** `Get-CimInstance ... -like '*-NoLogo*'` の条件文字列そのものがコマンドラインに載るため、確認スクリプトが自分を「アプリが残したシェル」として数える。**起動の前後で pid の集合を比べる**か、コマンドラインの完全一致で絞ること。この回では最初「終了後にシェルが残っている」という偽の失敗が出た。
- **プロセスは kill してすぐには消えない。** `app.close()` の直後に数えると、まだ落ちきっていないものが残って見える。数秒のポーリング（消えるまで待つ）で確かめる。
- **画面の中身は `.xterm-rows` の `textContent` で読める。** 打った行とシェルが返した行の両方が出るため、`echo FOO` の結果を待つときは **`FOO` が2回以上**現れることを条件にする（1回だと打った時点で通ってしまう）。
- **上部バーの Workspace メニューは `.fx-topbar__workspace` ではない。** そちらは名前を出す `span` で、メニューは `.fx-topbar__button`（ラベル `Workspace`）の方。
- **node-pty は Electron 用のリビルドが要らないことを先に確かめた。** アプリに載せる前に、素の Electron で `require` → `spawn` → 入力 → 出力 → `kill` までを通す最小のスクリプトを走らせている（Electron 43 / ABI 148 で prebuilt がそのまま読めた）。native モジュールを組み込むときは、UI を書く前にこの確認を通すのが安い。

Session 3-7-2（複数タブとシェルの選択）では、**production ビルド版 51項目、全項目 PASS**（本体 44 + Claude Code の起動 7）。Session 3-7-1 で確かめた1本ぶんの振る舞いが、タブが増えても変わらないことに重点を置いている。

- 既定のタブ: 起動すると1枚だけ開き、`PowerShell` として running になること、打ったコマンドの結果が出ること
- シェルの選択: `⌄` のメニューに `PowerShell` / `Node` / `Claude Code` が並ぶこと（**この PC に実際に入っているものだけ**）
- Node のタブ: 開くと手前に出て running になること、Node として動くこと（`console.log` の結果）、**PowerShell 側の出力が混ざらないこと**
- Claude Code のタブ: `cmd.exe /c claude.cmd` の経路で起動し、**画面に TUI が出ること**（`cmd.exe` のエラーになっていないこと）
- タブの切り替え: 行き来しても**それぞれのスクロールバックが残る**こと、器が指しているのが手前のタブであること、戻った後もそのタブへ打てること
- パネルを閉じて戻す: タブは2枚のまま・どちらも running のまま・手前のタブも変わらないこと、画面も残ること
- タブを閉じる: タブが減り、残ったタブが手前になること、**閉じたタブのシェルが本当に消えること**（`Get-Process powershell` の増減）
- 終了と立て直し: `exit` で `exited` になりタブに終了コードが出ること、**終わっても画面が読み返せる**こと、立て直すと**同じ行のシェル**（Node）で始まり画面はそのままであること
- 最後の1枚: 閉じると案内だけになり画面の器が消えること、`＋` で既定のシェルが開き直せること
- 上限: 8枚まで開けること、達したら `＋` が押せなくなり選ぶ入口も出ないこと
- 終了時の後始末: 8本のシェルを開いた状態でアプリを閉じても**1本も残らない**こと

確認の要領（この回で分かったもの）:

- **画面の中身を待つ条件は「計算した結果」にする。** 端末には打った行もそのまま出るため、`Write-Output MARKER` で `MARKER` を待つと**打った瞬間に通ってしまう**。`Write-Output ("MARKER" + "_ONE")` のように、実行されて初めて `MARKER_ONE` という並びになる形にすると、シェルが本当に返したことだけを見られる。
- **プロセスの増減は「アプリを立てる前」を基準にする。** 立てた後に数えると、既定のタブのシェルが基準に混ざり、終了後の確認が甘くなる。数える側の PowerShell 自身も数に入るが、前後で同じだけ入るので増減は正しく出る。
- **Claude Code の確認は起動までで止める。** 起動すると信頼の確認（`1. Yes, I trust this folder`）が出るので、**画面に何か出たこと**と `cmd.exe` のエラー（`is not recognized as ...`）でないことを見て、その場でタブを閉じる。一時フォルダを Workspace にしておくと、確認の副産物がプロジェクトへ残らない。
- **タブは `data-*` で読む。** `.fx-terminal-tab[data-terminal-id]` / `data-active` / `data-status` を並べて取れば、枚数・手前・状態が1回の `$eval` で揃う。表示名だけを見ると「終了 0」のような添え書きと区別が付かない。

Session 3-7-3（表示・リサイズ基盤）では、**production ビルド版 21項目、全項目 PASS。** 一時フォルダに `wsA` / `wsB` を作り、`wsA` で起動してから `wsB` へ切り替えている。

- 起動と入出力（3-7-1 / 3-7-2 の回帰）: プロンプトが出ること、cwd が開いている Workspace（`wsA`）であること、打ったコマンドの結果が出ること
- ウィンドウのリサイズ: 幅 1500 → 880 で **ConPTY の桁数が 204 → 117 へ追従する**こと（`$Host.UI.RawUI.WindowSize.Width` で読む）
- 文字の大きさ: `Ctrl + =` ×4 で 13px → 17px になること、それに合わせて**桁数が 117 → 95 へ減る**こと、`Ctrl + 0` で 13px に戻ること
- 横取りの範囲: `Ctrl + C` が端末側へ届き、入力中の行が中断されること
- **Workspace の切り替え**: `wsB` へ切り替えても、動いていたターミナルが**終わらない**こと・画面が残ること・打てること・**cwd が `wsA` のまま**であること
- タブの増減: 切り替えでタブが増えも減りもしないこと、そのタブに**別のフォルダの印**（`data-foreign="true"` と `title` の「別のフォルダで起動」）が付くこと
- 切り替え後に開いたタブ: `＋` で開いた2枚目の **cwd が `wsB`** であること、印が付くのは古い方だけであること、**後から開いたタブも同じ文字の大きさ**であること
- タブの往復: 1枚目へ戻ってもセッションが続いていること、cwd が `wsA` のままであること、**起動直後の出力まで遡れる**こと
- 終了時の後始末: 2つの Workspace のシェルが混在した状態でアプリを閉じても**1本も残らない**こと

確認の要領（この回で分かったもの）:

- **ConPTY の桁数はシェルに聞く。** DOM から桁数を数えると「xterm がそう描いた」ことしか分からない。`$Host.UI.RawUI.WindowSize.Width` を打たせれば、**Main が `pty.resize` を通したか**まで含めて1つの数で確かめられる。
- **`win.setSize` は最大化中と最小幅で黙って効かない。** 前回の確認が最大化のまま `window-state.json` を残していると、リサイズの確認がまるごと空振りして PASS も FAIL も出ない。`unmaximize()` してから**最小幅（800）より広い値で**動かすこと。確認の前に大きさを決め打ちで揃えるのが早い。
- **cwd はプロンプトから読まない。** 器を細くすると長いパスが折り返し、`PS ...>` が1行に収まらなくなる。`'CWD:' + (Split-Path -Leaf (Get-Location))` のように**短い印を出させて**読む。
- **xterm の font-size は `.xterm` ではなく `.xterm-rows` に付く。** 上の要素を測ると、変わっていても 13px のままに見える（それで「PASS しているのに何も起きていない」形になる）。
- **スクロールバックは1画面だけ見ても確かめられない。** `.xterm-viewport` の `scrollHeight` も当てにならないので、**ホイールで少しずつ遡りながら各画面を集めて**繋げたものを見る。
- **`window-state.json` は預かって戻す。** ウィンドウの大きさを動かす確認は、終了時にその大きさを保存させる ── 利用者の環境に確認の副産物が残る。

Session 3-7-4（実行中プロセスの確認）では、**production ビルド版 15項目、全項目 PASS。** 実行中かどうかは OS のプロセスの話なので、画面だけでなく**子プロセスが本当に残っていないか**まで確かめている（`Get-CimInstance Win32_Process -Filter "Name='PING.EXE'"`）。

- 実行していないタブ: `＋` で開いた2枚目を閉じると、**確認が出ずに**そのまま閉じること
- 実行中のタブ: `ping -t 127.0.0.1` を走らせた状態で × を押すと確認が出ること、そこに何のターミナルかが出ること
- キャンセル: タブが残ること・**`ping` も残っている**こと
- 終了時の確認: 実行中があるとアプリを閉じようとしたときに確認が出ること、題が「実行中のターミナルがあります」であること
- 選べる道: **「保存」が並ばない**こと、続ける側のボタンが「終了する」であること、一覧にタブの位置と「実行中のコマンドがあります」が出ること
- 終了のキャンセル: ウィンドウが残ること・`ping` も残っていること
- 「終了する」: アプリが終わり、**`ping` もシェルも1本も残らない**こと
- 実行していない状態での終了: 確認が出ずにそのまま終わること

確認の要領（この回で分かったもの）:

- **「動いている」の確認は OS に聞く。** 画面に `ping` の出力が出ていることは、そのプロセスが**生きている**ことを意味しない（出力は残る）。`Get-CimInstance Win32_Process -Filter "Name='PING.EXE'"` の件数で見ると、確認をキャンセルしたときに本当に残っているかまで1つの数で分かる。
- **終了の確認は `BrowserWindow.close()` から駆動する。** `app.close()`（Playwright 側）は待ち方が変わるため、`app.evaluate` で `BrowserWindow.getAllWindows()[0].close()` を呼ぶ方が、確認が出た状態で止めて調べられる。キャンセルした後にもう一度呼べば、同じ確認をもう一度出せる。
- **往復の実測は `page.evaluate` から測る。** `window.fluvix.terminal.listBusy()` を5回続けて呼ぶと 425〜453ms で、クリックの反応時間（866ms）とは別に**経路そのものの時間**が分かる。文書に書く数はこちらにする。

Session 3-7-5（Terminal の表示設定と永続化）では、**production ビルド版 30項目、全項目 PASS。** 起動 → 設定 → 終了 → 起動し直し → 設定ファイルを壊してもう一度起動、までを**1本のスクリプト**で通している（`_electron.launch` は `app.close()` の後にもう一度呼べる）。

- 既定: 文字の大きさが 13px であること、設定 UI に `13` / `5000` が出ること、Escape で面が閉じること
- 設定 UI から変える: 20px にすると画面の文字が 20px になること、**範囲の外（999）は 32px へ丸められ、欄にも `32` が書き戻る**こと、行数を `1000` にできること
- 全タブへの反映: `＋` で開いた2枚目も 20px であること、タブを行き来しても変わらないこと
- ConPTY への伝わり方: 文字を大きくすると桁数が **106 → 69** に減ること（`$Host.UI.RawUI.WindowSize.Width`）
- さかのぼれる行数: 1500 行を出したとき、5000 行の設定では**その最初（L17。細かく読めば L1）まで**遡れ、1000 行にすると **L498 まで**（＝ 1500 − 1000）で止まること、それより古い出力（`TAB1MARK`）が残っていないこと
- 永続化: `terminal-settings.json` が `{"schemaVersion":1,"display":{"fontSize":20,"scrollback":1000}}` になること、**開き直しても 20px / 1000 行**であること、開き直した後も 1000 行で止まること
- 壊れた設定: `{ this is not json` を置いて起動しても端末が開き、既定（13px / 5000）で始まり、打てること。次に保存すると**そのファイルが書き直される**こと
- 回帰: 3-7-1（シェルが起動して打てる）・3-7-2（2枚目は別の画面、戻ると出力が残る）・3-7-3（Ctrl + `=` / `0`）・3-7-4（実行中のタブの確認・キャンセル・閉じる）
- console エラー / pageerror なし

確認の要領（この回で分かったもの）:

- **打鍵と設定 UI が同じ値を見ていることは、両方から読んで確かめる。** `Ctrl + =` を2回押した後に ⚙ を開くと欄が `15` になっている ── 画面の見た目だけを見ると、別々の値を持っていても気づけない。
- **`.xterm-viewport` の `scrollHeight` では遡れる量を測れない。** xterm 6 では表示ぶんと同じ値になり、5000 行でも 1000 行でも「5」しか返らない（それで**両方 PASS する**という最悪の形になる）。実際に遡って、そこに何が残っているかで見ること。
- **ホイールは1イベント約2行で、`deltaY` を大きくしても変わらない。** 回数で稼ぐしかないので、`mouse.wheel` を 100回まとめて送ってから1回読む（1行ずつ読むと数分かかる）。**読むのは飛び飛びになる**ので、そこで得た「一番古い行」は実際より少し新しい（L17 と出るが、細かく読めば L1 まで戻れる）。設定が効いているかは **5000 と 1000 の対比**（L17 と L498）で足りるため、そこは追わない。
- **ホイールを詰めて送り続けると、稀に "Target page, context or browser has been closed" で止まる。** 落ちているのはアプリではない ── 同じ 1400回を単独で送る確認では、アプリは最後まで生きたまま（`page.on('crash')` も console エラーも無し、exit code 0）で L1 まで遡れた。25回ごとに 40ms ほど息継ぎを入れると起きなくなる。**「アプリが落ちた」と読む前に、単独で再現するか確かめること。**
- **設定ファイルは確認の前に消し、後で消す。** 前回の値から始まると「既定で始まる」を確かめられず、残したままだと利用者の環境に確認の副産物が残る。`workspace-folder.json` も預かって戻す。

Session 3-8-1（Git 実行の土台とリポジトリ検出）では、**production ビルド版 29項目、全項目 PASS。** Workspace ごとにアプリを起動し直す形で、6つの状況を通した（`_electron.launch` は `app.close()` の後にもう一度呼べる）。

- 正常なリポジトリ root: Git パネルに案内ではなくブランチ欄が出ること、ブランチ名が `main` であること、再取得ボタンがあり押しても同じ答えが返ること
- Git 未初期化のフォルダ: 「まだ Git リポジトリではありません」が出ること、**`git init` の案内が書かれている**こと、ブランチ欄が出ないこと、「もう一度確認する」があること
- リポジトリのサブフォルダ（`<project>/src`）: 「リポジトリ『Fluvix Nexus』の一部です」として扱われること、**「Git 操作は行いません」が伝わる**こと、ブランチ欄が出ないこと
- Git が見つからない環境（PATH から git を外し、`%ProgramFiles%` 等を空フォルダへ向けて起動）: **アプリが落ちないこと**、「Git が見つかりませんでした」と次の一手が出ること
- commit が1つも無いリポジトリ（`git init` 直後）: **ブランチ名（`main`）が出る**こと（`symbolic-ref` を使っている理由がここに出る）
- detached HEAD: ブランチ名ではなく `detached HEAD（098cb9e）` として出ること
- Renderer に任意 Git command の経路が無いこと: `window.fluvix.git` のキーが `getRepository` **1つだけ**、`getRepository.length` が **0**（引数を取らない）、`window.require` / `window.process` が無いこと、**引数（`{args:['-c','core.pager=calc.exe','log'], command:'status', cwd:'C:\\Windows'}`）を混ぜて呼んでも Main は無視して同じ答えを返す**こと
- console エラー / pageerror なし（6回の起動すべて）

確認の要領（この回で分かったもの）:

- **「渡せないこと」は、渡してみて確かめる。** 契約で `request: void` にしてあっても、それは型の話でしかない。実際に引数を積んで `getRepository()` を呼び、応答が変わらないことまで見て初めて「Renderer から任意の git を実行できない」と言える。
- **Git が無い環境は、環境変数を差し替えて作れる。** `_electron.launch({ env })` で `PATH` を `System32` だけにし、`ProgramFiles` / `ProgramW6432` / `ProgramFiles(x86)` / `LOCALAPPDATA` を空フォルダへ向ければ、Git をアンインストールせずに `git-unavailable` の経路を通せる（`gitExecutable.ts` が当たる場所と対になっている）。
- **detached HEAD と「commit が無い」は、その場でリポジトリを作って確かめる。** scratchpad に `git init` して、commit 前 → commit → `checkout --detach` の順に進めれば、3つの HEAD の形を1本のスクリプトで通せる。
- **サブフォルダの確認にはプロジェクト自身が使える。** `<project>/src` を Workspace にすれば、リポジトリ root と食い違う状態がそのまま作れる（`nested` の名前がプロジェクト名になることまで見える）。
- `workspace-folder.json` を書き換えて**起動時の復元**で Workspace を開かせる形は Session 3-5.1 から変えていない。確認の後は `{"schemaVersion":1,"lastWorkspace":null}` に戻す。

Session 3-8-2（変更ファイルの一覧）では、**production ビルド版 56項目、全項目 PASS。** 状況ごとにアプリを起動し直す形で、6つのリポジトリを通した（1本目 36項目 / 2本目 20項目）。

- いろいろな状態を1つに詰めたリポジトリ: **Git パネルの一覧が実際の `git status` と一致する**こと（下記）、グループが「ステージ済み → 変更 → 未追跡」の順に並ぶこと、各グループの件数が行数と一致すること
- 種類ごとの見え方: rename が **1件**として並び「old-name.txt から」が出ること（元の名前が別の行として並ばないこと）、削除が `D` で並び**押せない**こと、`git add` した後にもう一度書き換えたファイルが staged と unstaged に**1件ずつ**並ぶこと、未追跡フォルダがフォルダ1件として並び押せないこと
- 名前: **日本語のファイル名が壊れない**こと（`日本語のファイル.txt`）、空白を含む名前がそこで切れないこと（`with space/read me.txt` → 名前 `read me.txt` / 場所 `with space`）
- ファイルを開く: 行を押すと Editor のタブが開くこと、**同じ行を2回押してもタブは1枚のまま**であること（Files と同じ `openFile` を通っている証拠）
- 更新: アプリの外でファイルを作ると**押さずに**一覧へ加わること、`git add` だけでは変わらないこと（`.git` は監視していない）、**Refresh を押すとその変化も反映される**こと
- パネルの開閉: View メニューで閉じて開き直す操作を2往復しても、調べ直して一覧が戻ること
- clean なリポジトリ: ブランチ名が出て「変更はありません。」が出ること、グループが1つも出ないこと
- 併合の衝突: 「競合」のグループが**先頭**に出ること、`!` で並ぶこと、**staged / unstaged に重ねて出さない**こと、解決のために開けること
- upstream: `↑1 ↓1` が出ること、hover で追跡先（`origin/main`）が分かること
- detached HEAD: `detached HEAD（8c09bd5）` として出ること、upstream の欄が出ないこと、**detached でも一覧は出る**こと
- 回帰: Git 未初期化のフォルダで 3-8-1 の案内（`git init` の案内を含む）がそのまま出ること
- console エラー / pageerror なし（6回の起動すべて）

確認の要領（この回で分かったもの）:

- **一覧の正しさは、アプリと別の経路で数えて突き合わせる。** 確認スクリプト側では `git status --short -z`（porcelain **v1**）を読み、そこから staged / unstaged / untracked の一覧を自前で作って画面と比べている。アプリが読んでいるのは v2 なので、同じ実装を2回通して一致させたことにはならない。
- **画面から「どのファイルの行か」を取れるようにしておく。** 行に出るのは名前と場所に分かれた文字列なので、そのままでは相対位置に戻せない。行の `title`（`<相対path>（<種類>）`）から取り出す形にすると、突き合わせが1行で書ける。
- **自動更新と手動更新は、別の変化で分けて確かめる。** アプリの外でファイルを作る（作業ツリー → `files:changed` が届く）と、`git add` する（index だけ → 届かない）を分けて置けば、「押さずに変わること」と「押して初めて変わること」の両方が1本の流れで見られる。
- **rename の確認には「中身が変わらないファイル」が要る。** `git mv` した直後に中身も書き換えると、git は rename ではなく削除＋追加として返すことがある。素材のファイルには変えない中身を入れておく。
- **確認用のリポジトリは scratchpad に作って、終わったら消す。** プロジェクト自身を使うと、確認のたびに本物の作業ツリーを汚すことになる。`git init` から作れば、衝突・upstream（隣に bare リポジトリを置く）・detached まで**ネットワーク無し**で作れる。

Session 3-8-3（Stage / Unstage）では、**production ビルド版 32項目、全項目 PASS。** 1つのリポジトリに、編集 / 新規 / 削除 / rename / 日本語名 / まとめて Stage 用のファイルを詰めて1本で通した。

- 起動直後の一覧: 削除・rename の前後・新規・日本語名が、それぞれ正しいグループに出ること
- 往復（1件）: 編集 → **押さずに**「変更」へ出る → `＋` で「ステージ済み」へ移る → `−` で「変更」へ戻ること（移った側から消えることまで見る）
- 往復（未追跡）: 新規ファイルを `＋` → ステージ済み → `−` → **未追跡へ戻る**こと
- 削除: 削除されたファイルを `＋` で Stage できること、行の種類が `deleted` のままであること
- rename: 前後の2行を Stage すると**1行の rename にまとまり**「move.txt から」が出ること
- 日本語名: `設計メモ.txt` を Stage できること、名前が壊れないこと
- グループ: 「すべて Stage」で未追跡が空になり、**その全部がステージ済みに載る**こと
- Refresh との整合: 押しても一覧が変わらないこと、**端末で行った `git add` が Refresh で反映される**こと
- 連打: 同じ行の `−` を続けて押しても1回だけ効き、一覧が壊れないこと
- Files / Editor: Files パネルが出たままであること、Git の行から Editor でファイルを開けること
- パネルの開閉: タブの `×` で閉じ、View メニューから開き直しても一覧が出ること
- console エラー / pageerror なし

確認の要領（この回で分かったもの）:

- **移った先だけでなく、移った元から消えたことも見る。** Stage の確認を「ステージ済みに出た」で止めると、両方のグループに出ている状態を見逃す。`waitFor({ state: 'detached' })` で消えるところまで待つと、1回の操作で2つのことが確かめられる。
- **行はグループとファイル名の2段で引く。** `.fx-git__group[data-group="staged"]` の中を `.fx-git__change-name` の文字で絞る形にすると、同じ名前が2つのグループに並ぶ状態（`git add` の後に書き換えた）でも取り違えない。
- **最後に本物の `git status` を1回読んで残す。** 画面の確認が全部通っても、それは画面どうしの整合でしかない。ログに `--porcelain=v2` の生の出力を残しておけば、UI と index が食い違っていないことを後から目で確かめられる。
- **View メニューのボタンは文字で絞る。** `.fx-topbar__button` は4つある（Workspace / View / Layout / レイアウトを初期化）ため、クラスだけで押すと strict mode で止まる。
- 確認用のリポジトリは `os.tmpdir()` に作り、`workspace-folder.json` を書き換えて**起動時の復元**で開かせる形は 3-8-1 / 3-8-2 と同じ。終わったら `{"schemaVersion":1,"lastWorkspace":null}` に戻す。

Session 3-8-4（Commit）では、**production ビルド版 36項目、全項目 PASS。** 1つのリポジトリで①〜⑨を1本の流れとして通し、最後に別の Workspace へ切り替えて続けた。

- 起動直後: 変更が無い状態でも **Commit 欄が出ている**こと、ステージ済みが無ければ Commit が押せないこと
- ①〜③の流れ: ファイルを変更 → **押さずに**「変更」へ出る → `＋` で「ステージ済み」へ → メッセージを入れると Commit が押せる → Commit → **ステージ済みから消え、変更なしになる**こと
- 日本語 / 引用符: `日本語のコミット "引用符" つき` が **実 git の `git log` にそのまま**記録されていること、commit が1つだけ積まれたこと
- 混在: staged=`app.txt` / unstaged=`README.md` / untracked=`new.txt` の状態で Commit すると、**commit に入るのは `app.txt` だけ**で、他の2つはそのまま残ること
- 失敗時: hook で止めたとき、一覧の上に**日本語1行**の理由が出ること、**hook の生の英文が出ていない**こと、**入力したメッセージが残る**こと、ステージ済みも残ること、commit が増えないこと
- 成功時: メッセージが消えること（2回とも）
- 多重操作の防止: 遅い hook（`sleep 3`）を通す Commit の最中にボタンが押せないこと、「Commit 中…」と出ること、**強引に2度押ししても commit は1つしか増えない**こと
- パネルの開閉: タブの `×` で閉じ、View メニューから開き直せること、**開き直すとメッセージは空から始まる**こと、一覧はそのままであること
- Files / Editor: Files の行が出たままであること、ファイルを開いて Monaco が出ること
- Workspace の切り替え: 切り替え先のリポジトリを見ていること（Commit が押せない状態から始まる）、**切り替え先でも Commit できる**こと、**切り替え元のリポジトリは触られていない**こと
- console エラー / pageerror なし

確認の要領（この回で分かったもの）:

- **`.fx-git` が出た＝中身が出た、ではない。** 取得中（`status === 'loading'`）は空の器だけが描かれるため、`.fx-git` を待って測ると「変更なし」も「Commit 欄」も見つからない（実際に1回そう転んだ）。ブランチ欄（`.fx-git__bar`）が出てから測る。
- **成功と失敗を、同じ入力欄で続けて確かめる。** hook を置いて1回失敗させ、hook を差し替えて次を成功させると、「失敗では残り、成功では消える」が1本の流れで見られる ── 別々に確かめると、消えたのが Commit のせいなのか画面を作り直したせいなのかが分からない。
- **多重操作の防止は、`disabled` を確かめるだけでは足りない。** `page.evaluate` から DOM の `click()` を2回続けて呼び、**実 git の commit 数が1つしか増えない**ところまで見る。遅い hook（`sleep`）を置くと、その窓を確実に作れる。
- **Workspace の切り替えは `app.evaluate` で `dialog.showOpenDialog` を差し替えて通す。** `_electron.launch` で直接起動していれば Main 側を触れるため、ネイティブダイアログを開かずに切り替えられる（CDP 経由の dev 版ではできない）。
- **確認用のリポジトリは2つ作る。** 切り替え先を用意しておくと、「切り替え後に Commit できる」と「切り替え元が触られていない」を同じスクリプトで見られる。どちらも `os.tmpdir()` に `git init` から作り、`user.name` / `user.email` / `commit.gpgsign` はリポジトリ側に設定して、その PC の設定に結果を左右されないようにする。

Session 3-8-5（Push / Pull / Commit & Push）では、**production ビルド版 26項目、全項目 PASS。** 1つのリポジトリと、その隣に置いた bare リポジトリ（remote 役）で、追跡先が無い状態から diverged までを1本で通した（ネットワークは使わない）。

- 追跡先が無い状態: Pull / Push のボタンが出ていること、**upstream の欄そのものが出ない**こと、初回でも Push は押せること、Pull は押せないこと、Push の hover に「追跡先を作る」と出ること
- 初回の Push: remote に commit が届くこと、**追跡先ができて ↑0 ↓0 が出る**こと、送るものが無くなって Push が押せなくなること、Pull が押せるようになること、失敗の行が出ていないこと
- Pull: remote の commit が取り込まれること、**実ファイルが手元に現れる**こと、↑0 ↓0 に戻ること
- Commit & Push: 押せること、手元に commit が積まれること、remote まで届くこと、通ったので入力欄が空になること
- Push だけが失敗したとき: **commit は積まれたまま**であること（もう一度 Commit させない）、remote は変わっていないこと、「Commit は完了しましたが、Push できませんでした」と出ること、先に Pull するよう案内していること、**Commit は済んでいるので入力欄は空になる**こと
- 断られた Push: 単独の Push でも「先に Pull してください」の案内になること
- 枝分かれ（diverged）: `--ff-only` の Pull が取り込まないこと、**手元の commit が残る**こと、fetch は通っているので ↑1 ↓1 が出ること

確認の要領（この回で分かったもの）:

- **remote はネットワークの向こうに要らない。** 同じ PC に `git init --bare` を置いて `remote add` すれば、初回の Push（追跡先を作る）・Pull・push-rejected・diverged の4つを認証無しで通せる。「他の人が push した」は、もう1つ clone を作ってそちらから push すれば作れる。
- **「Commit は通ったが Push が失敗した」を、実際に作って確かめる。** remote 側を1つ進めてから Commit & Push を押すと、その窓がそのまま作れる ── ここで入力欄が空になり、commit が積まれたままであることまで見ないと、「同じ内容をもう一度 Commit する」経路が残っているかどうかが分からない。

Session 3-8-6（ブランチの一覧 / 切り替え / 作成）では、**production ビルド版 29項目、全項目 PASS**（一覧と切り替えの本体で 24項目、Files / Editor の追従で 5項目）。

- 一覧: 起動時にブランチ名が出ること、ローカルブランチが3件出ること、現在のブランチに印が付くこと、その印が `main` に付くこと、「現在」と出ること
- 名前の検証: 空白を含む名前では作成が押せないこと、**理由がその場に出る**こと、先頭が `-` の名前でも押せないこと、通る名前なら押せること
- 作成: ブランチ名が変わること、**実 Git の HEAD も動く**こと、面が閉じること
- 同じ名前で作ったとき: 断られること、HEAD は動かないこと、**入力欄が消えない**こと
- 切り替え: ブランチ名が変わること、実 Git の HEAD も動くこと、**作業ツリーが入れ替わる**こと
- 今のブランチを選んだとき: 何も起きないこと、HEAD は動かないこと
- 書きかけがあるとき: **git が断る**こと、HEAD は動かないこと、書きかけが失われないこと
- 開き直し: 端末で作ったブランチが出ること（覚えた一覧を出さず、開くたびに実 Git から取り直している）
- 追従（別の1本）: 切り替え前の Files に切り替え先のファイルが無いこと、Editor に切り替え元の中身が出ていること、切り替わること、**Files が新しいブランチのファイルに追いつく**こと、**Editor の中身も切り替え先のものになる**こと

確認の要領（この回で分かったもの）:

- **切り替えの確認には「切り替え先が触るファイル」が要る。** 切り替え先が触らないファイルの書きかけは、git がそのまま持って行く（それが正しい振る舞い）。「書きかけがあると断られる」を確かめたいなら、**同じファイルが両方のブランチで食い違っている**状態を先に作ること。
- **切り替えは Files と Editor まで動く。** ブランチ名が変わったことだけを見て終わると、画面の他の場所が古いままでも PASS してしまう。作業ツリーがまるごと入れ替わる操作なので、確認も画面の外（Files の行・Editor の中身）まで見る。

Session 3-8-7（Git 基本機能の統合確認と仕上げ）では、**production ビルド版 67項目、全項目 PASS。** 新しい機能は足さず、3-8-1 〜 3-8-6 で置いたものを**利用者が実際に通す1本の流れ**として、1回の起動の中で通している（Status → Stage / Unstage → Commit → Push / Pull → ブランチの作成・切り替え）。相手は `git init` から作った実リポジトリと、その隣に置いた bare リポジトリ（remote 役）、そこからもう1つ clone した「他の人」の3つになる。

- ① Status: ブランチ名が `main` で出ること、「変更はありません。」が出ること、**↑0 ↓0** と追跡先（`origin/main`）が出ること、ステージ済みが無ければ Commit が押せないこと、送るものが無ければ Push が押せず理由が hover に出ること、追跡先があれば Pull は押せること、アプリの外での変更が**押さずに**「変更」「未追跡」へ出ること（日本語名も壊れないこと）
- ② Stage / Unstage: `＋` で「ステージ済み」へ移り**元から消える**こと、実 Git の index にも入ること、`−` で戻ること、index も空に戻ること、「すべて Stage」で未追跡が空になりその全部が載ること、**端末で行った `git add` は ⟳ を押して初めて反映される**こと
- ③ Commit: メッセージが空なら押せないこと、書くと押せること、Commit すると一覧が「変更はありません。」に戻ること、入力欄が空になること、実 Git の commit が1つ増えること、**書いたメッセージがそのまま記録される**こと、ステージ済みの4件すべてが入ること
- ④ Push: Commit の後に **↑1** になること、押せること、Push すると ↑0 ↓0 に戻ること、**remote 側にも同じ commit が届く**こと、その後は押せなくなること、失敗の行が出ていないこと
- ⑤ Pull: 取りに行く前も押せること（behind の写しでは止めない）、**「他の人」が push した commit が手元に入る**こと、実ファイルが現れること、HEAD が remote に追いつくこと、一覧が「変更はありません。」のままであること
- ⑥ Commit & Push: 押せること、commit が積まれること、**remote まで届く**こと、入力欄が空になること
- ⑦ ブランチ: 一覧がローカルの1件だけであること、現在に印が付くこと、空白を含む名前では作成が押せないこと、作成でそのまま切り替わること、実 Git の HEAD も動くこと、面が閉じること、**作ったばかりのブランチには追跡先が無く** Pull は押せず Push は押せること、そのブランチの上で Commit できること、Push で **remote に新しいブランチができ**追跡先が出ること、一覧に増えていること、`main` へ戻れること、**作業ツリーとファイルの中身が入れ替わる**こと、書きかけがあると切り替えを断られること、断られても HEAD も書きかけも動かないこと、**生の英文が出ていない**こと
- ⑧ 回帰: Files パネルが出たままであること、Git の行から Editor でファイルを開けること
- console エラー / pageerror なし

確認の要領（この回で分かったもの）:

- **Pull の結末は、画面の数字で待ってはいけない。** `behind` は前回 fetch した時点の写しなので、取りに行く前から ↑0 ↓0 と出ている ── その数字を `waitForFunction` で待つと**押した直後にすり抜け**、まだ何も起きていない状態で「取り込めた」を測ることになる（実際に1回そう転んだ）。待つのは結果そのもの（実ファイルが手元に現れたか）にする。
- **「切り替えを断られる」は、断られる状況を先に作らないと確かめられない。** 切り替え先が触らないファイルの書きかけは、git がそのまま持って行く。同じファイル（`README.md`）を両方のブランチで食い違わせておいて初めて、断りの経路を通せる。
- **Windows の git は checkout で改行を CRLF に直す。** 切り替えの前後でファイルの中身を突き合わせるときは、改行を均してから比べること（均さないと「中身が戻った」が落ちる）。
- 確認用のリポジトリは scratchpad に `git init` から作り、`workspace-folder.json` を書き換えて**起動時の復元**で開かせる形は 3-8-1 〜 3-8-6 と同じ。終わったら `{"schemaVersion":1,"lastWorkspace":null}` に戻し、3つのリポジトリを消す。

Session 3-8-8（`.git` の監視と自動追従）では、**production ビルド版 22項目、全項目 PASS**（追従の本体で 15項目、配る回数の確認で 7項目）。相手は 3-8-7 と同じ4つ（実リポジトリ・bare な remote・「他の人」の clone）に、**リポジトリではないフォルダ**と**別のリポジトリ**を足したものになる。**git を叩くのはすべて内蔵 Terminal から**で、Git パネルには一度も触れない（手動更新の確認だけが例外）。

- 追従（内蔵 Terminal から実行し、⟳ を押さずに追いつくか）: `git add` が「ステージ済み」へ移ること、`git commit` でステージ済みが消え **↑1** になること、`git push` で ↑0 に戻ること、**`git fetch`（作業ツリーは1ファイルも動かない）で ↓1 が出る**こと、`git pull` で ↓0 に戻り実ファイルが手元に現れること
- 揃って変わること: `git switch feature` でブランチ名・追跡先・変更一覧が**同時に**入れ替わること、切り替えの最中を 60ms ごとに 40 回覗いて**「ブランチ名だけ新しい」「一覧だけ新しい」が1度も観測されない**こと、`main` へ戻すと3つとも揃って戻ること
- Workspace の切り替え: 別のリポジトリを開くとそのブランチが出ること、**その後に旧 Workspace の `.git` を外から6回動かしても `git:changed` が1本も届かない**こと（旧 workspaceId のものも、そうでないものも0本）
- `git init`: リポジトリではないフォルダで案内が出ること、**そのフォルダを cwd にした端末で `git init` すると、押さずに Git パネルが使える状態へ変わる**こと
- 手動更新: ⟳ が従来どおり効くこと
- 配る回数: 何も操作しなければ 8 秒間で **0本**（読み取りが自分を呼び戻さない）、アプリ自身の Stage 1回に対して **1本**で止まること、800 ファイルの `add` → `commit` → 切り替え2回（約 4 秒）でも **3本**（上限の計算値 13 本以内）、配る間隔が **836ms / 507ms**（最小間隔 500ms を下回らない）、押し寄せが終われば止まること、その後に見えている状態が正しいこと

確認の要領（この回で分かったもの）:

- **端末に打ったコマンドの「終わった」は、画面ではなくファイルで待つ。** `git add …` の後ろに `; "ok" | Out-File <marker>` を足し、その marker が現れるのを Node 側から待つ。xterm の表示を読んで待つと、プロンプトの再描画とコマンドの完了が区別できない。marker は**Workspace の外**へ置くこと（中に置くと、それ自体が `files:changed` を起こして測りたいものが濁る）。
- **「.git だけが動く」変化を1つ通しておく。** `git fetch` は作業ツリーのファイルを1つも触らないため、これが追いつけば `files:changed` に相乗りしていないことが確かめられる。`git add` でも同じことは言えるが、直前のファイル作成と時間が近く、どちらの経路で届いたのか切り分けにくい。
- **「半分だけ古い」は、両方が同時に変わる状況を作らないと測れない。** `main` に追跡先があり `feature` には無い・`.gitignore` が食い違っていて同じ未追跡ファイルが片方でだけ出る、という2つを仕込んでおくと、ブランチ名と一覧が**必ず一緒に変わる**。あとは切り替えの最中を細かく覗いて、片方だけ新しい組み合わせが出ないことを見る。
- **`git:changed` は Renderer 側から数えられる。** `window.fluvix.git.onChanged` をもう1本購読して配列へ積むだけで、「届いたか」「何本届いたか」「間隔はいくつか」がそのまま測れる ── 画面の変化を数えるより、配りすぎ / 回り続けの確認には向く。
- **回り続けていないことは、待って0本を見るまで言えない。** `.git/index` を見張る以上、読み取りが index を書き戻せば無限に回る。何も操作しない 8 秒で0本、Stage の 6 秒後に0本、という「止まっていること」の側を測って初めて、`--no-optional-locks` が効いていると言える。

Session 3-8-9（Diff 表示と破棄）では、**production ビルド版 67項目、全項目 PASS。** 相手は `git init` から作った実リポジトリ1つで、起動する前に「見たい状態」を全部仕込んである ── 変更・削除・**同じファイルが2つのグループに並ぶ状態（`MM`）**・未追跡のファイル・未追跡のフォルダ1件・バイナリ・未保存タブ用のファイル。1回の起動の中を、一覧 → 出す / 出さないの線 → 差分 → 破棄 → 未保存の保護 → 回帰、の順で通している。

- ① 一覧: ブランチ名が `main` で出ること、「変更」に README.md と削除された doomed.txt が出ること、「ステージ済み」に src/app.ts が出ること、**同じ src/app.ts が「変更」にも出ている**こと、未追跡にファイルとフォルダ1件が出ること
- ② 出す / 出さないの線: ステージ済み・変更・未追跡のファイルに差分ボタンがあること、**削除された行にも差分ボタンがある**こと（Editor では開けない `span` のままなのに）、未追跡のフォルダに差分ボタンが無いこと、**ステージ済みの行に破棄ボタンが無い**こと、変更と未追跡のファイルに破棄ボタンがあること、**未追跡のフォルダに破棄ボタンが無い**こと
- ③ 差分（変更）: 面が出ること、見出しがファイル名になること、左が「ステージ済み（index）」・右が「作業ツリー」と**言葉で**出ること、Diff Editor が2面で出ること、左右にそれぞれの中身が出ること、**改行のせいで全行が変更にならない**こと（この PC は `core.autocrlf=true`）、書き換えていない行が左右で同じままであること、Esc で閉じて一覧がそのまま在ること
- ④ 差分（同じファイル・2つのグループ）: ステージ済みでは左が「HEAD（最後の Commit）」で、中身が HEAD の `value = 1` と index の `value = 2`（**作業ツリーの 3 ではない**）こと、変更では左が index で `2 → 3` になること
- ⑤ 差分（未追跡・削除・バイナリ）: 未追跡では左が「まだ Git にありません」で右に中身が出ること、削除では右が「削除されています」で**左に消えた中身が出る**こと、バイナリでは理由が出て **Diff Editor を出さない**こと
- ⑥ 破棄（変更）: 確認が出ること、**元に戻せないことを押す前に言う**こと、ステージ済みが変わらないことも言うこと、キャンセルでは実ファイルが1バイトも変わらず行も残ること、確定で実ファイルが HEAD の中身へ戻ること、行が消えること、**押した1件の外側は触られていない**こと、失敗の行が出ていないこと
- ⑦ 破棄（ステージ済みも在るファイル）: 作業ツリーが index の中身（`value = 2`）へ戻ること、**実 git の index が1バイトも動かない**こと、「ステージ済み」の行がそのまま残ること
- ⑧ 破棄（未追跡）: 確認が「ごみ箱」「元に戻せます」と言うこと（変更と同じ文にしない）、実ファイルが消えて一覧からも消えること、**隣の未追跡（フォルダ・バイナリ）が残る**こと（`git clean` を使っていない）
- ⑨ 未保存の保護: Git の行から開いて打ち込むとタブが未保存になること、**その行の破棄が止まる**こと、次の一手（保存する / タブを閉じる）が出ること、**押せるボタンそのものが無い**こと、閉じても実ファイルが変わらず行も残ること
- ⑩ 回帰: Files パネルが出たまま、Git の行から Editor で開けること、ブランチ欄がそのまま在ること、生の英文が出ていないこと、console エラー / pageerror なし

確認の要領（この回で分かったもの）:

- **「差分が出た」を、面が出たことで測らない。** `[data-testid="git-diff"]` は取得中でも出る（先に面を出して「読み込んでいます…」から始める作りにしてある）。中身まで見るなら `.monaco-diff-editor` と `.view-line` が現れるまで待つこと。
- **改行を均していることは、変更行の数で測れる。** 均していなければ `core.autocrlf` の環境で**全行**に `.line-insert` / `.line-delete` が付く。5行 / 6行のファイルで数行しか付いていなければ、それが効いている証拠になる ── 左右の文字列を突き合わせるより、この数の方が「全行が真っ赤になっていない」を直接言える。
- **`MM`（同じファイルが2つのグループ）は、押した行ごとに中身が変わるかで確かめる。** そのために作業ツリー・index・HEAD を**3つとも違う値**（`value = 1 / 2 / 3`）にしておくと、どの2つを比べているかが数字だけで分かる。同じ値を混ぜると、正しい組み合わせと間違った組み合わせが同じ見た目になる。
- **「index が動いていない」は、画面ではなく実 git に訊く。** 破棄の後に `git show :<path>` を叩いて、ステージした中身がそのまま返ることを見る ── 一覧に「ステージ済み」の行が残っていることだけでは、中身が書き換わっていないところまでは言えない。
- **`git clean` を使っていないことは、隣が残っていることで測る。** 未追跡を1つ破棄したときに、他の未追跡（フォルダ・バイナリ）が手つかずで残っているかを見る。ごみ箱を通ったこと自体は、単体テスト側で `shell.trashItem` の呼び出しを記録して確かめている。
- **Monaco の中へ打ち込むには、`textarea` ではなく `.view-lines` を押す。** 隠し `textarea` は行の `span` に遮られてクリックが通らない（実際に1回そう転んだ）。テキスト面を押してから `keyboard.type` すれば、そのまま未保存のタブが作れる。
- 確認用のリポジトリは 3-8-7 / 3-8-8 と同じく `os.tmpdir()` に `git init` から作り、`workspace-folder.json` を書き換えて**起動時の復元**で開かせる。終わったら `{"schemaVersion":1,"lastWorkspace":null}` に戻し、リポジトリを消す。

Session 3-8-10（`git init` と GitHub への公開）では、**production ビルド版 18項目、全項目 PASS。** 相手は**リポジトリではない**フォルダ1つ（中にファイルを1つ置いただけ）で、1回の起動の中を「案内 → 確認 → 初期化 → 公開の面 → remote を足して消える」の順に通している。**この PC には GitHub CLI が入っていない**ため、gh が無い側の経路がそのまま実物で確かめられた。

- ① 案内: 「まだ Git リポジトリではありません」と出ること、「Git リポジトリにする」が1つだけ出ること、**その文字が案内の側（`gitRepositoryMessage.ts`）から来ている**こと
- ② 確認: 押すと確認が出ること、**Workspace 名が出る**こと、「.git が作られます」と何が起きるかを言うこと
- ③ 初期化: `.git` ができること、**`.gitignore` が作られない**こと、**remote が設定されない**こと、**commit が1つも作られない**こと（`rev-parse --verify HEAD` が断る）、置いてあったファイルが未追跡として一覧に出ること
- ④ 公開の入口: 初期化の直後に「GitHub に公開」が出ること
- ⑤ 公開の面: gh が無いことが出ること、**`winget install --id GitHub.cli` の1行が出る**こと、その間「公開する」が押せないこと、repository 名の初期値に Workspace 名が入ること、**公開範囲の既定が private** であること
- ⑥ remote があると消える: 端末を使わず外から `git remote add` してパネルを更新すると、**公開の入口ごと消える**こと、Push / Pull はそのまま並んでいること

確認の要領（この回で分かったもの）:

- **gh が入っていない PC は、確かめる相手として都合がよい。** 「入っていないときに何が出るか」はいちばん多くの人が最初に通る道で、しかも単体テストでは文言までしか確かめられない ── 実機なら「押せないこと」と「winget の1行が選べる形で出ていること」まで見られる。gh が入っている側（ログイン済み / 未ログイン / 実際に公開する）は**手で確かめるしかない**（下記）。
- **`git init` の結果は、画面ではなく実 git とファイルに訊く。** 「一覧が出た」だけでは、`.gitignore` を置いていないことも commit を作っていないことも言えない ── このセッションで守っているものの多くは**やっていないこと**なので、`existsSync` と `git rev-parse` の側で測る。
- **公開の入口が消えることは、Renderer の外から作った状態で測れる。** `git remote add` を Node 側から叩いてパネルの更新ボタンを押せば、`hasRemote` が状態に載っていることと、画面がそれで切り替わることが1回で確かめられる。

Session 3-8-11（コミット履歴）では、**production ビルド版 27項目、全項目 PASS。** 相手は 104 件の commit を積んだリポジトリ1つ（マージ commit・空メッセージの commit・author date が 2020 年の commit・未 commit の変更を仕込んである）と、`git init` しただけのリポジトリ1つになる。1回目の起動で「開く → 読む → 追いつく → 閉じる」を、2回目の起動で「commit が1つも無いとき」を通している。

- ① 入口: 上のバーに「履歴」が出ること、その文字が「履歴」であること、他の Git 操作に関わらず押せること
- ② 一覧: 面が開くこと、**100 件だけ**並ぶこと、見出しの件数が 100 であること、**切れていることを言う**こと、先頭が最新（マージ commit）であること
- ③ 1行の中身: マージに「マージ」と出ること、**マージでない行には出ない**こと、100 行すべてに author 名が出ること、短縮 hash が**実 git の `rev-parse --short` と一致する**こと
- ④ 日時: 本文が相対（「たった今」）であること、`title` が `2026/08/25 20:30` の形であること、**author date が 2020 年の commit が「6 年前」**と出てその `title` が `2020/01/02 03:04` であること
- ⑤ 空メッセージ: 空欄の行にせず「（メッセージなし）」と出ること
- ⑥ 追従: 開いている間に**端末を介さず外から積んだ commit が、押さずに先頭へ出る**こと、そのとき一覧が空にならず 100 件のままであること、閉じている間に積んだ commit も**開き直せば出る**こと
- ⑦ 閉じ方: Esc で閉じること、閉じると**元の変更一覧がそのまま在る**こと、`×` でも閉じること
- ⑧ commit が無いリポジトリ: 「まだ commit がありません」と出ること（失敗にしない）、行が1つも出ないこと
- ⑨ 回帰: 未 commit の変更が一覧に出たままであること、console エラー / pageerror なし

確認の要領（この回で分かったもの）:

- **`.fx-git__commit` は Commit メッセージの欄が既に使っている。** 履歴の行に同じ class を付けたところ、パネル下部の入力欄にまで枠線が付いた（`fx-git__commit-entry` に改めた）。**確認スクリプトのセレクタが「1件」を返したこと**でそれに気づけた ── 面の中だけを数えるより、`document.querySelectorAll` で全体を数えて食い違いを見る方が、この種の取り違えは早く出る。
- **行が並ぶのを `waitForSelector` で待たない。** 履歴は先に面だけを出して「取得しています…」から始まるため、行が1つも無い瞬間がある ── `waitForFunction` で**件数**（`length >= 100`）を待つこと。1度これで「1件しか無い」を測った。
- **上限を超えた先の commit は、確かめる材料に使えない。** 日時の確認用に「2020 年の commit」を履歴のいちばん古い側へ置いたところ、100 件で切られて画面に出なかった ── 古い日時を確かめたいなら、**新しい側の commit の author date を過去にする**（`GIT_AUTHOR_DATE` だけを渡せば、並び順は commit date のままになる）。
- **「開いている間だけ追いつく」は、閉じている間に積んで測る。** 閉じたまま commit を積み、開き直したときにそれが出れば「覚えた一覧を出していない」ことが言える。開いている間の追従（押さずに出る）と対にして初めて、どちらの側も確かめたことになる。
- 確認用のリポジトリは 3-8-7 以降と同じく `os.tmpdir()` に `git init` から作り、`workspace-folder.json` を書き換えて**起動時の復元**で開かせる。終わったら `{"schemaVersion":1,"lastWorkspace":null}` に戻し、リポジトリを消す。

Session 3-8-12（コミットの詳細と差分）では、**production ビルド版 21項目、全項目 PASS。** 相手は 8 件の commit を積んだリポジトリ1つ（履歴のいちばん最初・追加/変更/削除がそろった1件・rename・空メッセージ・バイナリ・520 件を足した1件・マージ commit・未 commit の変更を仕込んである）になる。1回の起動で「開く → 1件を開く → 差分を見る → Esc で1段ずつ戻る → 閉じる」を通している。

- ① 履歴の行: マージ以外が `button` になっていること、**マージだけ `button` にならない**こと（`data-openable="false"`）
- ② マージの断り: 押せない理由が UI に出ること、その文が「決まらない」と言っていること、**一覧につき1つだけ**であること（行ごとに並ばない）
- ③ 変更ファイル: 追加 / 変更 / 削除が**変更ファイルの一覧と同じ記号**（A / M / D）で出ること、見出しに要約・名乗り・hash が出ること
- ④ rename: 1件として出ること、`src/a.ts から` が並ぶこと
- ⑤ 差分: 左右のラベルが「親のコミット / このコミット」であること、面にその commit の短い hash が出ること、**親の中身とこの commit の中身が両方並ぶ**こと
- ⑥ **Esc（この回の重点）**: 1回目で**差分だけが閉じ、詳細がそのまま残る**こと、2回目で履歴の一覧へ戻ること、3回目で面が閉じること
- ⑦ 戻る道: `←` で履歴の一覧へ戻れること
- ⑧ 端の commit: 要約が空の commit も開けること、上限で **500 件**に切られること、切れていることを言うこと
- ⑨ 出せないもの: バイナリが「バイナリのため差分を表示できません。」として出ること（失敗に丸めない）
- ⑩ 回帰: **作業ツリーの差分（3-8-9）が今も開く**こと、その帯が「ステージ済み（index）/ 作業ツリー」のままであること、そこに commit の hash が出ないこと

確認の要領（この回で分かったもの）:

- **Esc の二重発火は、面を1枚ずつ数えて測る。** 「閉じたか」ではなく `[data-testid="git-diff"]` と `[data-testid="git-history"]` の**個数と `data-view`** を1回の Esc ごとに読む ── 「差分が閉じた」だけを見ると、その下の面まで一緒に閉じたことに気づけない。実装側は下の面が**購読そのものを張らない**形にしてあり（`suspended`）、`stopPropagation` では止まらない（同じ `window` に付いた2つの購読はどちらも呼ばれる）。
- **Monaco は空白を `&nbsp;` で描く。** 差分の中身を `textContent` で突き合わせると、`alpha v1` が `alpha v1` になっていて一致しない ── 比べる前に `replace(/ /g, ' ')` で均すこと。1度これで「中身が出ていない」を測った（アプリ側は正しく出ていた）。
- **押せない行は、`button` の有無で測る。** `disabled` を見に行くと、そもそも `button` を置いていない設計との食い違いが出ない ── `querySelector('.fx-git__commit-button') !== null` と `data-openable` の両方を読むと、どちらの側が崩れても分かる。
- **上限は「切ったこと」と「切った件数」の両方を見る。** 520 件を積んだ commit で、画面の行が 500 であることと、断りに `500` と書かれていることを別々に確かめる ── 片方だけだと、切り方と言い方のどちらがずれたのか分からない。

Session 3-8-13（履歴の commit からブランチを作る）では、**production ビルド版 29項目、全項目 PASS。** 相手は 5 件の commit を積んだリポジトリ1つ（履歴のいちばん最初・マージ commit・普通の commit が並ぶ形）になる。1回の起動で「一覧の形 → Esc の順番 → 作る → マージから作る → 断られる2通り → 押せない名前」を通している。

- ① 一覧の形: 全 5 行に ⑂ が出ること、**マージの行にも ⑂ が出る**こと、それでいてマージの行は今も開けない（`data-openable="false"`）こと
- ② 欄を開く: 押した行だけが `data-branching="true"` になること、その行の ⑂ が押せなくなること、**入力欄に focus が来る**こと
- ③ **Esc（欄 → 面）**: 1回目で**欄だけが畳まれ、履歴が開いたまま**であること、2回目で面が閉じること
- ④ **Esc（詳細 → 面）**: 3-8-12 の順番が崩れていないこと（詳細から一覧へ、一覧から閉じる）
- ⑤ 作る: 面が閉じること、バーのブランチ名が変わること、**新しいブランチが押した commit を指している**こと（実 git の `rev-parse --short` と突き合わせ）、HEAD もそこに居ること
- ⑥ マージから作る: マージ commit の hash を始点にしたブランチが、その hash を指すこと
- ⑦ 同じ名前: 断られること、理由が**面の中に**出ること、**面が開いたまま**であること、**打った名前が残る**こと
- ⑧ 書きかけ: 始点が消すファイルに書きかけがあると断られること、そのとき**ブランチが作られない**こと、作業ツリーと HEAD が1文字も動かないこと
- ⑨ 押せない名前: 空欄では理由ではなく**始点**を言うこと、空欄と使えない名前で作成が押せないこと、「×」でも欄が畳めること

確認の要領（この回で分かったもの）:

- **`Esc` の段が増えたら、増えた段だけでなく元の段も測り直す。** 3-8-13 で足したのは「欄」の1段だけだが、同じ `useEffect` の中に条件が1つ増える ── 詳細から戻る側（3-8-12 で確かめた順番）を毎回もう一度通しておかないと、増やした条件がその上を通り越したことに気づけない。
- **「作られなかった」は実 git の ref で測る。** 断りの文が出たことは、ブランチが作られていないことを何も言わない ── `for-each-ref refs/heads/` を Node 側から読んで、名前が**無い**ことを確かめる。3-8-13 でいちばん壊れやすいのがここ（`switch --create` が1回で両方を行うことに寄り掛かっている）。
- **書きかけで断らせるには、始点が消すファイルを選ぶ。** 3-8-6 の切り替えと同じ理屈で、始点が触らないファイルの書きかけは git がそのまま持って行く（それが正しい）── 履歴のいちばん最初の commit を始点にして、その後で足したファイルに書きかけを作ると確実に通る。
- **面が閉じることを `state: 'detached'` で待つ。** 「作れたら閉じる」は成功の主要な現れなので、`waitForTimeout` で当てにいくと、閉じ損ねているのに PASS する ── 面のセレクタが消えるのを待ってから、ブランチ名とファイルの側を確かめる。

Session 3-8-14（ブランチの削除 / rename）では、**production ビルド版 64項目、全項目 PASS。** 相手は使い捨ての一時リポジトリ1つで、`main`（今そこに居る）・`merged`（マージ済み）・`unmerged`（そこにしか無い commit がある）・`rename-me`・`feature` の5つを用意し、**未コミットの変更を残したまま**通している。Workspace は Renderer から指せない（§8.4）ので、保存されている Workspace（`workspace-folder.json`）を差し替えて起動し、復元の経路で開かせた（終わったら元に戻す）。

- ① 一覧の形: 5行が並ぶこと、行が `button` ではなく器（`.fx-git__branch-item`）になっていること、全行に ✎ と ✕ が付くこと
- ② **今のブランチ**: ✕ だけが押せず理由が付くこと、**✎ は押せる**こと、**行そのものも押せる**こと（3-8-6 の判断が崩れていない）
- ③ 確認 UI: ✕ で押した行の下に開くこと（`data-branch` で対象を確認）、文が対象を名指しすること、**「コミットが失われ」と書かれていない**こと、既定の focus が「やめる」であること
- ④ 一度に1つ: 別の行の ✎ を押すと、前に開いていた確認が閉じること
- ⑤ **Esc の段**: 1回目で**行の下だけが畳まれ、面は開いたまま**であること、2回目で面が閉じること
- ⑥ 削除（通る）: **面が開いたまま**であること、一覧から消えて4件になること、**実 git でも ref が消えている**こと、上のバーが動かないこと
- ⑦ 削除（未マージ）: 理由が確認の中に出ること、文言が「このブランチにしか無いコミット」＋ Terminal の案内であること、**生の stderr（`fatal:` / `error:`）が混ざっていない**こと、行が残ること、**実 git の ref も残っている**こと
- ⑧ rename（欄）: 初期値が今の名前であること、**開いた直後は押せない**こと、打つと押せるようになること、何が起きるかを両方の名前で言うこと
- ⑨ rename（通る）: 面が開いたままで一覧の名前が変わること、実 git でも変わっていること、**HEAD が動かない**こと、通ると行の下の欄が畳まれること
- ⑩ rename（行き先が既にある）: 理由が欄の下に出ること、**打った名前が残る**こと、**相手も自分も ref が動いていない**こと
- ⑪ rename（大文字小文字だけ）: 押せること、通ること、実 git でも綴りが変わっていること
- ⑫ rename（今のブランチ）: **上のバーの表示が変わる**こと、実 git でも HEAD が追随すること、**未コミットの変更（追跡済み・未追跡の両方）が残っている**こと
- ⑬ 名前の形: 通らない名前で押せないこと、理由が欄の下に出ること
- ⑭ 外部変更: 端末で作った / 消した枝が、面を開き直すと出る / 消えていること
- ⑮ 回帰: 作成が通ってそこへ切り替わり面が閉じること、切り替えが通って面が閉じること、切り替えた後でも削除できること
- ⑯ セキュリティ前提: Node / Electron が露出していないこと、`window.fluvix.git` に `deleteBranch` / `renameBranch` が増えていること、**強制削除にあたる口が1つも無い**こと、CSP 違反なし、console エラーなし

確認の要領（この回で分かったもの）:

- **「消えていない」「動いていない」は、必ず実 git の ref で測る。** 断りの文が出たことは、ref が残っていることも相手が無事なことも何も言わない ── 3-8-13 で「作られなかったことを ref で測る」と書いたのと同じ話が、3-8-14 では**2箇所**に増える（未マージの削除と、行き先が既にある rename）。ここが 3-8-14 でいちばん壊れやすい。
- **通った操作の後は、面の中の欄が自分で畳まれることまで測る。** 削除 / rename が通ると、その行は一覧から消える（あるいは名前が変わる）── 行の下に開いていたものを畳まないと、どの行にも属さない確認が宙に浮いて残る。**畳まれた後は `Esc` の段も1つ減る**ので、そこで Esc を押すと面ごと閉じる（driver を書いていて1度これで取り違えた。アプリ側は正しかった）。
- **未コミットの変更は、追跡済みと未追跡の両方を置いてから通す。** 削除も rename も作業ツリーに触らないことが売りなので、片方だけだと「触っていない」の証明が半分になる。
- **Workspace は保存ファイル経由で開かせる。** `workspaceFolder.open` にパスを渡せないのは設計そのもの（§8.4）なので、driver から IPC で開かせようとすると必ず行き詰まる ── 借りた保存ファイルは終わったら戻すこと。

Session 3-8-19（remote の枝から手元にブランチを作る）では、**production ビルド版 22項目、全項目 PASS。** 相手は使い捨ての一時リポジトリ2つ（bare の remote と作業リポジトリ）で、`main` / `feature/x` / `taken` を remote へ送ってから、**手元の `feature/x` だけを消して**「remote には在るが手元には無い枝」を作ってある。`taken` はローカルに残したうえで**別の commit を指させ**、同名衝突の側も同じ1回で通せるようにした。`git remote set-head origin main` で `origin/HEAD` も作ってある（除かれることを確かめるため）。

- ① 一覧: 畳んだ段に件数が出ること（**`origin/HEAD` を除いた3件**）、既定では畳んであること
- ② 中身: 開くと `origin/feature/x` / `origin/main` / `origin/taken` が並び、**`origin/HEAD` が並ばない**こと、**ローカルの一覧（上半分）は 3-8-6 のまま**で remote-tracking が混ざらないこと、いつの写しかの断りが出ていること
- ③ 既定値: 行を押すと欄が開き、**`origin/` を外した形**が入っていること（`taken` / `feature/x` の2つで確認）、開くのは一度に1つだけであること
- ④ 作成: 通ると**面が閉じ**、バーの表示が新しいブランチになり、HEAD が動き、**追跡先が付き**（`branch.feature/x.remote` = `origin`）、始点の中身（`feature.txt`）が作業ツリーに現れ、**`↑↓` の表示が出る**こと
- ⑤ 同名衝突: 「同じ名前のブランチが既にあります。別の名前をお試しください。」が**欄のすぐ下**に出ること、**面が閉じないこと**、打った名前が消えないこと、そして実 git で**元のブランチの ref が動かず・追跡先も付かず・HEAD も切り替わっていない**こと

確認の要領（この回で分かったもの）:

- **「断られた」は、実 git の3つで測る。** 文言が出たことは何も言わない ── 3-8-14 で「ref で測る」と書いたものが、ここでは**3つ**に増える（元のブランチの ref・追跡先の設定・HEAD）。上書き / 削除 / 自動切替のどれも起きていないことを、それぞれ別々に読む必要がある。
- **同名衝突と成功を、1回の起動で両方通せる。** 衝突の側は面が閉じず、そのまま別の行へ開き替えられる（一度に開くのは1つ）── 順番を「衝突 → 成功」にすれば、成功で面が閉じたところが終点になる。逆にすると、切り替わった後の一覧はもう別のブランチのものになる。
- **`origin/HEAD` は fixture 側で作らないと確かめられない。** `git fetch` だけでは作られず、`git remote set-head` が要る ── 作らずに走らせると「除かれた」ではなく「そもそも無かった」を測ることになるので、**ref が実在することを先に確かめてから**一覧を見る。
- **追跡先は `git config --get` で読む（画面の `↑↓` で代用しない）。** 表示は追跡先が付いていることの必要条件でしかなく、`branch.<名前>.remote` と `.merge` の2つを読んで初めて「どこを追っているか」まで測れる。

Session 3-8-20（ブランチのマージの開始 / 中止）では、**production ビルド版 42項目、全項目 PASS。** 相手は使い捨ての一時リポジトリ5つで、確かめたい結末ごとに別の repo を作ってある ── `ff`（早送りできる）・`diverged`（別々のファイルを足した枝分かれ）・`conflict` / `abort` / `dirty`（同じ行を両方で変えた競合。3つとも同じ形で、進める先が違う）。**リポジトリ一式は走らせるたびに作り直す**（`setup-fixtures.sh`）── 1回目のマージが履歴を進めるので、2回目は「既にマージ済み」でアプリのせいに見える FAIL が出る（3-8-8 で踏んだのと同じ形）。

- ① 一覧: **現在以外の行にだけマージの口（`⤵`）が出る**こと（行2件に対して口は1つ）、現在のブランチの行には出ないこと
- ② 確認: 押すと行の下に確認が開き、**相手と行き先の両方を名指しする**こと（「ブランチ「feat」を main に取り込みますか？」）
- ③ **Esc の段**: 1回目で**確認だけが畳まれ、面は開いたまま**であること、2回目で面が閉じること（3-8-14 / 3-8-19 から段が増えていない）
- ④ 早送り: 通ること、**commit が1つだけ増え、HEAD の親が1つのまま**であること（merge commit を作らない）、取り込んだファイルが現れること、通ると面が閉じること、**帯が出ない**こと
- ⑤ 通常マージ: **HEAD の親が2つ**になること（`Merge branch 'feat'`）、両方の枝のファイルが揃うこと、帯が出ないこと
- ⑥ 競合（画面）: 3-8-2 の**「競合」グループに出る**こと、**自動でマージできた側がステージ済みへ入る**こと、1行目が**「マージを開始し…」から始まる**こと（失敗と読ませない）
- ⑦ 帯: マージ中に出ること、次の一手（解決して Commit）が書いてあること、**マージ中でなければ出ない**こと
- ⑧ ブロック: **マージ中は行の `⤵` が押せず**、理由が「解決して Commit するか、マージを中止してから」であること
- ⑨ 完走: 「解決済みにする」で競合グループが消えること、**解決しても Commit するまで帯は出たまま**であること、Commit で**親が2つの merge commit** になり帯が消えること、**解決した内容がそのまま記録される**こと
- ⑩ 中止（確認）: 押すと確認が出ること、**「開始前の変更は残る」と「解決中に書いた内容は失われる」の両方**が書いてあること
- ⑪ 中止（通る）: MERGE_HEAD が消えること、帯が消えること、**マージ前のファイルの内容へ戻る**こと、自動でマージできていた側も戻ること、**マージを始める前から在った変更は残る**こと、競合グループが消えること
- ⑫ local changes: 日本語の理由が出ること（「作業ツリーの変更が上書きされるため…Commit するか退避してから」）、**生の英語（`fatal:` / `error:`）が混ざっていない**こと、**通らなかったときは面が閉じない**こと、**マージが始まっていない**こと、書きかけがそのまま残ること

確認の要領（この回で分かったもの）:

- **面を開いた直後に行を数えない。** ブランチの面は開いた瞬間に一覧を取り直す（「ブランチを取得しています…」を通る）ため、`.fx-git__branch-panel` が出た時点では**行が 0 件**になる ── `.fx-git__branch-entry` が出るまで待たないと、アプリは正しいのに「マージの口が出ない」という FAIL になる（実際に1度踏んだ）。
- **「解決済みにする」は座標で押さない。** 行の右端のボタンは、グループの見出し（`.fx-git__group-title`、sticky）に重なられることがあり、Playwright の click が `intercepts pointer events` で retry し続ける ── `data-action="resolve"` で絞ったうえで `element.click()`（DOM 側）を呼ぶと安定する。
- **早送りかどうかは `rev-list --parents` の語数で測る。** 「マージできたか」だけでは `--ff` が効いているか分からない ── 親が1つなら早送り、2つなら merge commit で、**設計判断 1 が守られているかはここでしか読めない**。
- **中止の確認は「残る」と「失われる」の両方を読む。** 片方だけを確かめると、文言がどちらかの嘘になっていても通ってしまう ── 実際に**マージ前から在るファイル**と**解決中に書いたファイル**の2つを置いてから中止し、それぞれの中身で測る。
- **競合の repo は、進める先ごとに別に作る。** 同じ repo で「解決して Commit」と「中止」を続けて確かめようとすると、1つめが履歴を進めた状態から2つめが始まる ── 形は同じでも別の repo にしておく方が、どちらが失敗したのかを読み違えずに済む。

Session 3-8-21（競合の ours / theirs の差分）では、**production ビルド版 28項目、全項目 PASS。** 相手は使い捨ての一時リポジトリ2つで、**「マージ中か」で分けてある**のがこの回の要点になる ── `main`（アプリからマージを開始して競合させる。`merging === true`）と `stash`（退避を戻したときの競合。`merging !== true`）。左右のラベルの意味づけがそこで変わるため、片方だけでは確かめられない。リポジトリ一式は走らせるたびに作り直す（`setup-fixtures.sh`）。

`main` の側には**一度に3種類の競合**を仕込んである ── `shared.txt`（両方で同じ行を変えた）・`removed.txt`（ours が変え、theirs が消した）・`added.bin`（両方でバイナリを変えた）。1回のマージで3行が並ぶので、「行によって出るものが違う」ところまで1回の起動で読める。

- ① ボタン: **競合の行すべてに差分ボタンが出る**こと（3行に対して3つ）── 片側が無い競合もバイナリも含めて、行によって出たり出なかったりしない
- ② 中身: 左に ours（`MAIN`）・右に theirs（`FEAT`）が出ること、**どちらにも `<<<<<<<` が入っていない**こと（＝作業ツリーの混ざった中身ではなく index の段を出している）
- ③ ラベル（マージ中）: 左が「現在のブランチ（ours / stage 2）」・右が「取り込み側（theirs / stage 3）」であること、競合の形が1行で出ること
- ④ 片側欠落: 「ファイルが存在しません」と出ること、**無いのが右（theirs）だと名指しで分かる**こと、形の説明にも「削除されています」が出ること
- ⑤ バイナリ: 「バイナリのため差分を表示できません」と出ること（**何も起きないのではない**）
- ⑥ 既存の導線: 3-8-18 の「解決済みにする」が通ること、**実 git の段が1段に畳まれる**こと、行が競合グループから消えてステージ済みへ移ること
- ⑦ 中止: 3-8-20 の「マージを中止」が通ること、MERGE_HEAD が消えること、帯と競合の行が消えること
- ⑧ ラベル（マージ中でない）: 帯が出ないこと、それでも競合の行はあること、左右が「ours（stage 2）」「theirs（stage 3）」であること、**「現在のブランチ」「取り込み側」と断定していない**こと、中身が退避の側と手元の側になっていること
- ⑨ 閉じる: `×` でも Esc でも閉じること、**閉じた後も競合の一覧の件数が変わらない**こと、閉じてもマージ中の帯が残ること

確認の要領（この回で分かったもの）:

- **Monaco の中身は「読み込んでいます…」が消えただけでは読めない。** その後に Suspense の「差分を準備しています…」があり、Diff Editor が実際に行を描くのはさらに後になる ── `.editor.original .view-lines` と `.editor.modified .view-lines` の**両方が現れるまで**待たないと、アプリは正しく出しているのに `null` が返って FAIL に見える（実際に1度踏んだ）。左右の取り出しも `.monaco-editor` の 0 番 / 1 番では駄目で（`gutter monaco-editor` が混ざる）、`.editor.original` / `.editor.modified` で名指しする。
- **競合の行の差分ボタンも、座標では押せない。** 3-8-20 の「解決済みにする」と同じで、グループの見出し（sticky）に重なられて `intercepts pointer events` を繰り返す ── `dispatchEvent('click')` で通す。競合のグループは一覧のいちばん上に出るので、この回はほぼ必ず当たる。
- **「マージ中でない競合」は退避でしか作れない。** アプリの中から `merging !== true` の競合へ至る経路は `stash pop` だけになる（3-8-15）── ラベルの中立性はそこでしか確かめられないので、fixture を分けておく必要がある。
- **ラベルの否定形も測る。** 「ours と出ている」だけでは、余分に「現在のブランチ」まで出ていても通ってしまう ── `not.toContain('現在のブランチ')` を同じ1回で読む。3-8-21 で守っているものの半分は**言っていないこと**にあたる。
- **「一覧が崩れない」は件数で測る。** 差分を開いて閉じた後に競合の行が同じ数だけ残っていること・帯が残っていることの2つを読む ── 面が上に重なるだけで下は差し替わらない（3-8-9 からの構え）ことが、入口が3つになっても変わっていないかはここでしか分からない。

Session 3-8-22A（Git の仕上げ）では、**production app での確認をまだ行っていない。** この回で行ったのは実装・自動テスト・実 git テスト・production build までで、**実アプリでの統合確認は Session 3-8-22B へ回してある**（意図的な分割で、3-8-19 〜 3-8-21 の実績から1セッションに収まらないことが分かっているため）。**3-8-22B で実施済み ── 結果は下記。**

自動での確認結果（3-8-22A 時点）:

| 確認                                        | 結果                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                      | PASS                                                                                                                                                              |
| `npm run typecheck`（node / web）           | PASS                                                                                                                                                              |
| `npm test`（vitest）                        | **115 files / 2487 passed / 1 skipped、全項目 PASS**（3-8-21 時点は 111 files / 2389 passed）                                                                     |
| 実 git テスト（`*Repository.test.ts` 18本） | 全項目 PASS（新規2本 = `gitInProgressRepository` 25項目 / `gitFetchRepository` 9項目を含む。**本数は 3-8-22B で数え直したもの ── 当時「23本」と書いたのは誤り**） |
| `npm run build`（production）               | PASS（41.34s）                                                                                                                                                    |

Session 3-8-22B（STEP 3 Git 全体の production app 統合確認）では、**production ビルド版 232項目、全項目 PASS。** 新しい機能は足さず、3-8-1 〜 3-8-22A で置いたものを**利用者が実際に通す流れ**として押している（3-8-7 が Git の基本機能に対して行ったことを、STEP 3 の Git 全体に対してもう一度行った回にあたる）。相手は使い捨ての一時リポジトリ一式で、走らせるたびに `setup-fixtures.sh` から作り直す（3-8-8 / 3-8-20 と同じ理由 ── 1回目が commit / push / merge を進めるので、2回目は「もう競合していない」でアプリのせいに見える FAIL が出る）。**開発リポジトリには一切触れていない。**

4本に分けてあるのは、1回の起動で1本しか走らせられないため（スクリプトが終わるとアプリも終わる）と、fixture の初期状態が本ごとに違うためになる。

| 本                 | 相手のリポジトリ                                   | 項目 | 結果        |
| ------------------ | -------------------------------------------------- | ---- | ----------- |
| ① `verify-flow`    | `flow`（**リポジトリではないフォルダ**から始める） | 82   | 全項目 PASS |
| ② `verify-sync`    | `sync` + bare + peer（他の人が push した枝がある） | 57   | 全項目 PASS |
| ③ `verify-guard`   | `guard`（**競合したまま**置いてある）              | 54   | 全項目 PASS |
| ④ `verify-coexist` | `coexist`（Files / Editor / Terminal との共存用）  | 39   | 全項目 PASS |

**① 基本フロー + branch + remote 管理 + stash（82項目）** ── 1回の起動の中を、`git init` → 公開の面 → remote 追加 → 変更検出 → Stage → Commit → Push → branch 作成 / 切替 → remote 管理 → 退避、の順に通す。

- init: 案内が出る → 確認が開く → **Esc で閉じる** → 初期化が通る → Git パネルになる
- 公開: gh が無いことの断りと `winget` の1行が出る、公開のボタンが押せない、**remote を足すと公開の口ごと消える**
- remote 追加: **ローカルのパスは通らない**（§14.24 の「知らない形は通さない」）・**認証情報を載せた URL も通らない**・`https://` なら通る
- 変更検出: 未追跡が2件（**フォルダは畳んで1件**）、**外で足したファイルが押さなくても一覧に出る**（3-8-8 の回帰）
- Stage → Commit: まとめて Stage が通る、空メッセージでは Commit が押せない、Commit 後に一覧が空になる
- Push: bare の remote へ届く、追跡先が設定される、上のバーが `↑0 ↓0` になる
- branch: 作成すると**そこへ切り替わって面が閉じる**、一覧の行から `main` へ戻れる、面が Esc で閉じる（**他の面を巻き込まない**）
- remote 管理（**3-8-16 / 3-8-17 の未確認分の回収**）: 一覧・追加・URL 変更・rename・削除の5つが通る。URL 変更は欄 → 確認 → 適用の2段で、確認に**変更後の送り先**が出る。**削除も URL 変更も、確認を Esc で閉じたときは git 側が1文字も変わっていない**
- 退避（**3-8-15 の未確認分の回収**）: 退避 → 一覧に1件 → **戻す**（作業ツリーへ返る）→ もう1度退避 → **捨てる**（確認あり）。捨てる確認も Esc で閉じ、**Esc では捨てられていない**

**② Fetch / remote-tracking / merge / conflict（57項目）** ── `peer` が push した枝は `sync` からはまだ見えない状態にしてあり、**Fetch の効き目が測れる**ようにしてある。

- Fetch 前: 一覧は `origin/main` だけ、**「最後に取得した時点の写しです」と黙らずに出ている**
- Fetch: 押す前に何が起きるかが読める、押すと `origin/feature/from-remote` が現れる、`origin/HEAD` は一覧に出ない
  - 待つのは**結果そのもの**（ref が手元に現れたか）にする ── 画面の数字は前回 fetch した時点の写しで、待つ先にならない（3-8-7）
- tracking branch: ローカル名の既定が `feature/from-remote`（remote 名から remote を外したもの）、作ると**切り替わって面が閉じる**、追跡先が設定される、作業ツリーが入れ替わる
- merge: 確認を挟む、**Esc ではマージが始まっていない**、適用すると競合で止まる、帯が出て次の一手と中止の口が出る、競合3件 + 自動マージ分がステージ済みへ入る
- 競合の Diff（**3-8-21 の回帰**）: マージ中は左右が「現在のブランチ / 取り込み側」と補われる、**左に ours・右に theirs**（入れ替わっていない）、片側欠落は「右（取り込み側）にはファイルが存在しません」と名指しで出る、バイナリは「バイナリのため差分を表示できません」で**Monaco の欄が壊れて残らない**
- 解決 → Commit → Push: 競合の行の操作が「解決済みにする」（Stage ではない）、3件とも競合から抜ける、**競合のグループごと消えて差分の口も消える**、`MERGE_HEAD` は Commit まで残る、**Commit 欄に `Merge branch 'conflict-src'` が入っている**（3-8-22A）、Commit で親が2つの merge commit が積まれて帯が消える、Push で remote へ届く

**③ マージ中の禁止操作（54項目）** ── 開いた時点で `merging === true` の repo を相手に、**押せないこと・理由が読めること・IPC を直に叩いても Main が断ること**の3段で測る。

- 通す側: 解決済みにする / すべて Stage / 差分 / 履歴・退避・リモートを開く（読み取り）/ **Push** / **Fetch** / branch 削除・改名 / **stash drop**
- 通さない側（**押せない + `title` に理由と次の一手が出る**）: Pull・branch switch・branch create・tracking branch 作成・もう1度マージ・**stash push**・**stash pop**
  - branch create と stash push は、hover だけでなく**欄の下の1行**にも同じ理由が出る
- **「解決し終えた、まだ Commit していない」状態**（`shared/git/inProgress.ts` が名指ししていた、いちばん危うい一瞬）でも stash push / pop が押せないこと・退避が1件のまま増えていないこと
- IPC を直に叩く: `switchBranch` / `createBranch` / `createTrackingBranch` / `stashPush` / `pull` / `mergeBranch` の6つが `operation-in-progress` で断られ、**HEAD も `MERGE_HEAD` も退避も1つも動かない**
- 中止: 確認を挟む、何が失われるかが書いてある、**Esc で閉じても中止されていない**、適用すると `MERGE_HEAD` が消えて帯も消える、**中止すると Pull / 切り替え / 作成 / 戻す がまた押せる**
- remote の追加 / 削除 / rename はマージ中でも通す（設計どおり ── `.git/config` の行だけを書き換え、index も作業ツリーも HEAD も動かさない）

**④ Files / Editor / Terminal との共存とセキュリティ（39項目）**

- Git → Editor: 行からエディタで開ける、**もう1つ開いても先のタブが閉じない**、未保存の印が保たれる、同じファイルを開き直してもタブが増えず**未保存の中身が捨てられない**
- Git 操作との共存: Stage してもタブが消えず未保存の印が残る、**未保存のタブがあるファイルの破棄は止まる**（3-8-9 の回帰）、破棄の確認が Esc で閉じる
- Terminal: 端末から `git checkout` を打つと Git パネルが追いつく（3-8-8 の回帰）、**Terminal を使っても Git パネル・ブランチ名・Push / Pull / Fetch の並びが壊れない**、端末で git を動かしてもタブが消えない
- Files: Files 側で変えたファイルが Git パネルに出る
- セキュリティ: `require` / `process` / `module` / `global` / `Buffer` / `electron` / `ipcRenderer` が Renderer に無い、`window.fluvix` の名前空間が10個のまま、**`window.fluvix.git` の36個が増えても減ってもいない**、**rebase / cherry-pick / revert を動かす口が1つも無い**、生の git コマンドを渡せる口（`exec` / `run` / `raw` / `spawn`）が無い、CSP が `default-src 'self'` / `script-src 'self'` / `object-src 'none'` / `frame-src 'none'` で **`unsafe-eval` 無し**、`webPreferences` が `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` / `webviewTag: false`、**CSP 違反 0件・console エラー 0件**

#### この回で見つけて直したもの

**`GitStashOverlay` にだけ、途中の Git 操作の禁止が渡っていなかった**（3-8-22A の被せ忘れ。詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §14.31.1）。マージ中でも「戻す」が押せ、競合を解決し終えた後は「作業ツリーを退避」も押せていた。**Main は両方とも断っていたので退避が消えることも `MERGE_HEAD` が落ちることも無い**（押して確かめた）が、押しても必ず失敗するボタンが残っていた。他の箇所とまったく同じ形（`withGitInProgressBlock`）で被せ、③で再確認している。

**自動テストでは捕まえられない種類の抜けにあたる。** 表（`shared/git/inProgress.ts`）も Main の `guardGitInProgress` も網羅的にテストされていて全部通っていた ── 抜けていたのは props を渡す1行で、props が増えていないのだから型も通る。**実アプリで押す以外に測る手段が無い。**

#### 確認の要領（この回で分かったもの）

- **Monaco の Diff Editor は、片側に `.view-lines` を2つ持つ。** 消えた行を描く view-zone がもう1枚入るため、`.editor.modified .view-lines` を `querySelector`（＝最初の1つ）で読むと**消えた行の側（ours の断片）**が返る ── 「右に ours が出ている」と読めてしまい、**アプリが左右を取り違えている**という結論を1度書きかけた。その側の `.view-lines` を全部集めて**いちばん長いもの**を本体として読む。3-8-21 が同じセレクタで正しく読めていたのは DOM の並びがたまたま逆だったためで、アプリ側は 3-8-21 から一度も変わっていない。
- **一覧の面は開いた直後に読まない。** remote / 退避の一覧は非同期に取りに行くので、開いた直後は「取得しています…」で 0 件になる ── その文言を抜けるまで待つ。**アプリは正しく出しているのに FAIL に見える**形が、3-8-21 の Monaco と同じ理由でここでも出る。
- **ローカルのパスは remote の URL として登録できない**（§14.24 の設計どおり）。Push の相手にする bare リポジトリを**画面からは足せない**ので、UI の「追加」が動くことは `https://` の URL で測り、Push の相手は git 側から `set-url` で差し替えて用意する。
- **未追跡のフォルダは畳んで1件**として出る（git の `status` がそう返す）。`src/a.ts` を仕込んでも一覧に出るのは `src` の1行で、ファイル名で数えると合わない。
- **「解決した = ステージ済みに載る」ではない。** 競合を**元と同じ中身に戻して**解決すると、index が HEAD と一致するので差分が無く、ステージ済みの一覧に載らない ── 解決できたかは `git ls-files -u` が空になったかで測る。
- **競合の差分のボタンは、この回は座標のクリックで通った**（3-8-20 / 3-8-21 は `dispatchEvent` が要った）。ウィンドウを 1680×1000 に揃えてから開いているためで、狭いままだと見出しの sticky に重なられる。
- **ウィンドウの大きさは毎回揃える。** 前回の確認が残した `window-state.json` から始まると Git パネルが細いまま起動し、**Monaco が幅の都合で inline 表示へ落ちて**左右のペインが別々に読めなくなる（アプリの不具合ではない）。`app.evaluate` の `setBounds` で揃える（`_electron.launch` なら Main 側を触れる）。
- **Terminal を開いたまま終わらせると `app.close()` が返らない。** 走っているシェルがあるためで、確認そのものは終わっている ── ログを先に書き出しておき、残ったプロセスは `Stop-Process` で片付ける。

#### 未確認（環境に起因する1点）

「GitHub に公開」の**成功する経路**は、この PC に GitHub CLI（`gh`）が入っていないため実アプリで通せていない（3-8-10 と同じ状況で、当時も gh の無い側だけを確かめている）。確かめてあるのは gh が無いときの断りと案内・公開のボタンが押せないこと・remote を足すと公開の口ごと消えることの3つで、**アプリの中の経路としては閉じている**。

#### 品質ゲート（3-8-22B 時点）

| 確認                                        | 結果                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| production app 統合確認（`_electron`）      | **232項目、全項目 PASS**（4本の内訳は上記）                                  |
| `npm run format:check`                      | PASS                                                                         |
| `npm run typecheck`（node / web）           | PASS                                                                         |
| `npm test`（vitest）                        | **115 files / 2487 passed / 1 skipped、全項目 PASS**（3-8-22A から変化なし） |
| 実 git テスト（`*Repository.test.ts` 18本） | **396項目、全項目 PASS**（`src/main/git` 全体では 35 files / 827項目 PASS）  |
| `npm run build`（production）               | PASS（32.93s）                                                               |

### Session 4-2（別名で保存）

ネイティブの保存ダイアログは Playwright から操作できない。**Main 側の `dialog.showSaveDialog` / `showOpenDialog` を `app.evaluate` で差し替える**ことで、production build のまま経路全体を通せる。

```js
await app.evaluate(({ dialog }, target) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
}, destinationPath)
```

差し替えるのは**利用者の指の代わり**だけで、アプリ側（要求の検証・書き込み・場所の判定・タブの付け替え）は素のまま動く。取り消しは `{ canceled: true, filePath: undefined }` を返せば作れる。

注意点:

- **`--user-data-dir` を渡して userData を使い捨てにする。** 渡さないと実際の `%APPDATA%/Fluvix Nexus` を書き換えるうえ、単一インスタンスのロックが普段使いのアプリと衝突する
- Workspace は毎回 `mkdtemp` で作る。**開発リポジトリを対象にしない**
- Git パネルは `files:changed` を受けてから `CHANGE_SETTLE_MS`（400ms）待って読み直す。書いた直後に読むと古い一覧が返る

確認済み（build 版・2本で 49項目、全項目 PASS）:

- 救済の一連（開く → 編集 → 外部削除 → deleted 検出 → 別名で保存 → 内容一致 → タブ追従 → 続けて編集 → 通常 Save → 内容一致）
- 通常タブの別名で保存、Workspace 外への保存、保存先が別のタブの場合、取り消し、既存ファイルの上書き
- BOM / CRLF / LF が別名で保存でも変わらないこと、保存先の拡張子に言語が追従すること
- Renderer から直に `window.fluvix.files.saveAs` を叩き、絶対パス・`..`・root 自身の助言と、文字列でない中身が断られること（断った要求で何も作られないこと）
- Files / Terminal / Git への回帰が無いこと、console エラー / CSP 違反が無いこと

### Session 4-3A（設定の保存基盤）

**production build 版 38項目、全項目 PASS。** 確かめたいのが「アプリを閉じて開き直しても残るか」「壊れたファイルから立ち上がれるか」なので、**5つの状態を作っては起動する**流れを1本のスクリプトで通している（`_electron.launch` は `app.close()` の後にもう一度呼べる）。

| 起動前に作る状態                         | 確かめたこと                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 設定ファイルが1つも無い                  | 既定（OFF / パネルの形に任せる / 13px・5000行）で始まること、`.tmp` を残さないこと             |
| 旧3ファイルだけがある                    | 3つとも取り込まれること、`settings.json` が section 形式でできること、旧ファイルを消さないこと |
| 何も無いところから UI で変える           | 3つの section が1つのファイルに揃うこと、**開き直して復元される**こと                          |
| `settings.json` の一部が壊れている       | 壊れた section だけが既定へ落ち、読める section と key は生き残ること                          |
| `settings.json` が JSON として壊れている | 落ちずに既定で始まり、次の保存で正しい形に書き直されること                                     |

- Auto Save: `afterDelay` を選んで Monaco に打ち込むと、待ち時間の後に**実ファイルの中身が変わる**こと（設定が保存されるだけでなく、その設定どおりに動くこと）
- Terminal: シェルが起動して打てること（打ったコマンドの完了は Workspace の外に置いた marker ファイルで待つ）、**`.xterm-rows` の文字の大きさが設定どおり**であること
- IPC の検証: 知らない section（`appearance`）・読めない値（`fontSize: 'big'`）・object でない要求が `INVALID_REQUEST` で断られること、**知らない key（`languageServerPath`）は要求ごと通っても保存されず、ディスクにも残らない**こと、`settings:load` が既知の3つの section だけを返すこと
- 知らない section（`appearance`）を手で書いておくと、**この版が保存した後も消えずに残る**こと（書き戻し）
- セキュリティ: `window.require` / `window.process` / `window.electron` / `window.Buffer` がすべて `undefined`、`window.fluvix.settings` の口が `load` / `saveSection` の2つだけであること
- 回帰: Files（ツリー / カラム）・Editor（開く・保存）・Terminal・Git パネル、console エラー / pageerror なし、CSP 違反なし

注意点:

- **Terminal の文字の大きさは `.xterm-rows` で測る。** `.xterm` と `.xterm-screen` はアプリ素の 13px のままで、設定を変えても動かない ── そちらで測ると常に 13px が返り、アプリが正しくても FAIL に見える
- **Terminal を開く確認は最後に回す。** 走っているシェルがあると `app.close()` が返らないので、その回だけは `taskkill /F /T` で終える（確認そのものは終わっている）
- **ファイル行のクリックは押し直せるようにする。** 描画の途中で押すと当たらず、Editor の工具列（`[data-testid="editor-autosave"]`）がいつまでも出ない。開くまで数回押し直すと安定する
- **確認の前後で `settings.json` と旧3ファイルを消す。** 前回の値から始まると「既定で始まる」を確かめられず、残したままだと利用者の環境に確認の副産物が残る

**初回起動でも `settings.json` はできる。** Main は移すものが無ければ何も書かないが（`store/settingsStore.ts`）、Renderer は読み込みが終わった時点で既定値を1度保存する ── 中身は既定と同じで、Session 3-5 〜 3-7-5 の3つの hook も同じ形だった（4-3A で変わった挙動ではない）。

### Session 4-3B（Settings 画面）

**production build 版 74項目、全項目 PASS。** 確かめたいのが「同じ設定が2箇所から動くこと」「閉じても再起動しても残ること」なので、**3回起動する**流れを1本のスクリプトで通している。

| 回    | 通したこと                                                                      |
| ----- | ------------------------------------------------------------------------------- |
| 1回目 | 既定で始まる → Settings で5項目を変える → 既存 UI からも変える → 閉じて開き直す |
| 2回目 | 再起動で5項目が復元される → Terminal の実物に効いている → 最後にディスクを汚す  |
| 3回目 | 汚した値が**表示方式として解釈されない**こと、選び直せば正しい値に戻ること      |

- 面: トップバーの `Settings` で開く、`aria-modal="false"`、`×` と Esc で閉じる、カテゴリが **Editor / Files / Terminal の3つだけ**で切り替わること、開き直すと Editor から始まること
- Editor: Auto Save の方式を `afterDelay` へ、待ち時間を 2500ms へ変えられること。**範囲の外が丸まること**（999999 → 60000 / 0 → 200）。**Editor の工具列から Auto Save の選択が消えていること**（`[data-testid="editor-autosave"]` が 0 個）
- Files: Settings でカラムを選ぶと**開いている Files パネルがカラム表示になる**こと、ツールバーでツリーへ戻した後に Settings に現在値が出ること
- Terminal: Settings で文字の大きさ・さかのぼれる行数を変えられること、**⚙ に文字の大きさが残り、さかのぼれる行数が消えている**こと（欄が1つ）、⚙ で 11px にすると Settings 側にも 11 が出ること、再起動後に `.xterm-rows` が実際に 11px であること
- 保存: `settings.json` が section 形式で、5項目が入り、**Settings に載せていない `files.columnWidth` も消えていない**こと
- セキュリティ: `window.require` / `window.process` / `window.electron` / `window.Buffer` / `window.module` がすべて `undefined`、`window.fluvix.settings` の口が `load` / `saveSection` の2つだけ、知らない section（`appearance`）・読めない値（`fontSize: 'big'`）・object でない要求・配列・`section: null` がすべて `INVALID_REQUEST`、`settings:load` が既知の3 section だけを返すこと
- 回帰: Files / Editor / Terminal / Git の4パネル、console エラー / pageerror なし、CSP 違反なし

注意点（この Session で踏んだもの）:

- **`[data-testid="editor-autosave"]` はもう無い。** Session 4-3A の確認スクリプトはこれを「ファイルが開けた印」に使っていたが、4-3B で Auto Save の選択ごと Settings へ移した。代わりに `[data-testid="editor-save-as"]` を待つ
- **確認スクリプトが自分でディスクを汚す順序に注意する。** 知らない key を送る検証（`{ section: 'files', value: { languageServerPath: … } }`）は仕様どおり**要求は通り、その key は落ちる**ので、`files` セクションが空で上書きされる。保存内容の確認より**後**に置かないと、アプリが正しくても FAIL に見える
- **Renderer は設定を読み直さない。** `settings:changed` が無い設計（[docs/ARCHITECTURE.md](ARCHITECTURE.md) §12.4）なので、IPC で直接書いた値は開いている画面には出ない ── 解釈のされ方を見るには**次の起動**まで待つ
- **`setPreference` は同じ値なら保存しない。** 「同じなら据え置く」が効くため、既に選ばれている選択肢を押してもディスクは変わらない（書き戻しを当てにした確認は成立しない）
- 前回と同じく、**確認の前後で `settings.json` と旧3ファイルを退避 / 復元する**。Workspace は確認用の一時フォルダを `workspace-folder.json` に仕込んでから起動する（ネイティブのフォルダ選択を通さずに Files / Editor を触るため）

### Session 4-4（Theme）

**production build 版 76項目、全項目 PASS。** 確かめたいのが「切り替えが CSS / Monaco / xterm の3つすべてへ同時に届くこと」「再起動で復元されること」「**起動時に Dark が一瞬も出ないこと**」なので、Session 4-3B と同じく**3回起動する**流れを1本のスクリプトで通している。

| 回    | 通したこと                                                                |
| ----- | ------------------------------------------------------------------------- |
| 1回目 | 既定 Dark で始まる → Light へ切り替える → 全所へ即時反映 → 閉じて開き直す |
| 2回目 | 再起動で Light が復元される → **ちらつきが無いこと** → Dark へ戻す        |
| 3回目 | 不正な Theme 値を仕込んだ状態から起動し、安全に Dark へ落ちること         |

- 面: Settings のカテゴリが **Editor / Files / Terminal / Appearance の4つで、Appearance が末尾**であること、選択肢が **Dark / Light の2つだけ**（System が無い）であること、閉じて開き直しても選択値が一致すること
- 即時反映: `<html>` の `data-fx-theme`、`color-scheme`、`body` の地と文字。**押した瞬間**に変わる（「適用」も「OK」も無い）
- 色: 面 / 枠 / 文字 / 幕 / 影 / Git 変更種別 / ファイル種別 / パネル識別色が**すべて Dark と違う値**へ入れ替わること。幕が Light 専用（25%）であること
- 判別できること: **Light の面に対して27色すべてがコントラスト比 3:1 以上**、本文の文字は 7:1 以上（スクリプトの中で相対輝度から計算している）
- Monaco: 地が Light の `--fx-color-surface`（`rgb(245,245,245)`）になること、Dark へ戻せること、**再起動後の Monaco も Light** であること
- xterm: **開いている全部の端末**の地が Light の `--fx-color-surface-sunken`（`rgb(235,235,235)`）になること、文字色と選択色も切り替わること、**ANSI 16色は変わらない**こと
- 保存: `settings.json` に `appearance.theme` が入り、**他の section を巻き込んでいない**こと
- fallback: `theme` を `solarized-storm` に書き換えて起動すると、`<html>`・窓の初期色・Settings の現在値の**3つとも Dark** になること
- セキュリティ: `window.require` / `window.process` / `window.electron` / `window.Buffer` / `window.module` がすべて `undefined`、`window.fluvix.settings` の口が `load` / `saveSection` の**2つのまま**、知らない section（`theme`）・文字列でない `theme`・object でない要求・`section: null` がすべて `INVALID_REQUEST`、`settings:load` が既知の**4 section**（`appearance` を含む）を返すこと
- 回帰: Files / Editor / Terminal / Git の4パネル、console エラー / pageerror なし、CSP 違反なし

#### 起動時のちらつきを、どう確かめたか

「一瞬 Dark が出ない」は目視では確かめにくい。**`dom-ready` の時点の `<html>` を読む**形にしてある。

```js
window.webContents.once('dom-ready', () => {
  window.webContents.executeJavaScript('document.documentElement.getAttribute("data-fx-theme")')
})
window.webContents.reload()
```

`dom-ready` は HTML の解析が終わった時点で、**`settings:load` の応答が返るより前**にあたる。ここで既に `light` なら、Theme を届けたのは IPC ではなく Main → Preload の経路にほかならない。窓そのものの初期色は `BrowserWindow.getBackgroundColor()` で別に見ている。

注意点（この Session で踏んだもの）:

- **`electron.launch({ args: [...] })` に渡すのは `out/main/index.js` ではなくプロジェクトのフォルダ。** `index.js` を直接指すと Electron が `package.json` を見つけられず、`productName` が効かない ── **userData が `%APPDATA%/Electron` になり、設定も Workspace も別の場所を読む**（Files / Editor パネルが「Workspace が開かれていません」のまま出る、という形で表に出た）
- **`electron.launch` には `executablePath` を渡す。** scratchpad から実行すると `playwright-core` はそこに electron を探しに行く。`<project>/node_modules/electron/dist/electron.exe` を明示する
- **xterm の地は `.xterm-viewport` ではなく `.xterm-scrollable-element` に付く。** `.xterm-viewport` は xterm 自身の CSS で `#000` のまま残るが、v6 ではその手前をスクロール容器が覆うので画面には出ない。ここを間違えると「Light にしたのに端末だけ黒い」という**実際には起きていない不具合**を追うことになる
- **`webContents.getLastWebPreferences().additionalArguments` は空で返る。** 渡っているかを確かめるのにこれは使えない（上の `dom-ready` の形にした）
- **Vitest は CSS の import を空文字へ差し替える。** `theme.css` を `?raw` で読むテスト（`styles/themeCss.test.ts`）のために、`vitest.config.ts` で `theme.css` だけを例外にしてある
- 前回までと同じく、**確認の前後で `settings.json` と `workspace-folder.json` を退避 / 復元する**。Workspace はこのプロジェクト自身を仕込んでから起動する（ネイティブのフォルダ選択を通さずに Files / Editor / Monaco を触るため）

### Session 4-5（Localization）/ 4-7（Command・Keyboard Shortcuts）

この2つは**実装した Session では production app を通していない**。まとめて Session 4-8A で確かめている（下記）。

自動テストの側は先に揃えてあり、Session 4-7C 完了時点で 140 files / 2856 passed / 1 skipped。内訳のうちこの2つに関わるのは次のもの。

| テスト                                   | 見張っているもの                                              |
| ---------------------------------------- | ------------------------------------------------------------- |
| `i18n/messages.test.ts`                  | 日本語辞書と英語辞書の**キーの集合が完全に一致する**こと      |
| `i18n/languageSettings.test.ts`          | Language ↔ 保存形式の変換と、読めない値の落とし先             |
| `commands/registry.test.ts`              | id の集合・カテゴリとの対応・並びが `COMMAND_IDS` に従うこと  |
| `commands/commandLocalization.test.ts`   | 21件**すべて**が `command.<CommandId>` の翻訳を持つこと       |
| `commands/contribution.dom.test.ts`      | Git / Files が mount 中だけ handler を載せること              |
| `keybindings/chord.test.ts`              | `event.code` 基準の正規化（日本語配列の記号を含む）           |
| `keybindings/when.test.ts`               | 条件の解析と AND、**読めない条件は通さない**こと              |
| `keybindings/dispatch.test.ts`           | 打鍵 → command と、確認ダイアログの裏で走らせない全体規則     |
| `keybindings/resolve.test.ts`            | rule の畳み方（後勝ち・条件違いは両立・読めない rule の扱い） |
| `keybindings/keybindings.dom.test.ts`    | window の listener と focus 条件（jsdom の範囲で）            |
| `keybindings/shortcutRows.test.ts`       | 一覧の行の組み立てと絞り込み                                  |
| `settings/KeyboardShortcuts.dom.test.ts` | 一覧の描画・見出し・未割り当て・検索                          |

**jsdom では確かめられないことが残る。** Monaco も xterm も載っていないので、「xterm が `Ctrl+S` を止めるか」「Monaco の既定を奪っていないか」はこの層では書けない ── そこが Session 4-8A の主目的にあたる。

### Session 4-8A（Localization / Keyboard Shortcuts の production app 統合確認）

**production build 版 205項目、全項目 PASS**（Localization 94 / Keyboard Shortcuts 111）。2本のスクリプトに分けてある ── 1本にすると、落ちたときにどちらの話か切り分けられない。

検証用の依存はプロジェクトに追加せず、作業用ディレクトリ側に `playwright-core` を入れて実行する（§4 の冒頭の方針どおり）。

#### スクリプト1 — Localization（94項目・3回起動）

確かめたいのが「切り替えが全所へ同時に届くこと」「再起動で復元されること」「**起動時に日本語が一瞬も出ないこと**」なので、Session 4-4（Theme）と同じく**3回起動する**流れを1本で通している。

| 回    | 通したこと                                                                     |
| ----- | ------------------------------------------------------------------------------ |
| 1回目 | 既定 ja で始まる → en へ切り替え → 全所へ即時反映 → 保存 → IPC の検証          |
| 2回目 | 再起動で en が復元される → **ちらつきが無いこと** → ja へ戻す                  |
| 3回目 | 読めない `language` 値（`klingon`）から起動 → ja へ落ちる → 日本語側の tooltip |

- 面: Settings のカテゴリが **General / Appearance / Editor / Files / Terminal / Keyboard Shortcuts の6つ**で、General が先頭・Keyboard Shortcuts が末尾であること。Language の選択肢が **ja / en の2つだけ**であること
- 即時反映: `<html>` の `lang` と `data-fx-language`、上部バー、Files / Editor / Terminal / Git の4パネル、Settings 自身。**押した瞬間**に変わる（「適用」も「OK」も無い）
- 網羅: Settings の6カテゴリすべてと、**Git の5面（History / Stash / Remote / Branch / Diff）を実際に開いて**日本語が残っていないこと
- 走査: 画面全体の text ノードと `title` / `aria-label` / `placeholder` を舐めて、ひらがな・カタカナ・漢字・全角約物を探す
- Monaco / xterm: 載っていること、そして**言語で変わらない**こと（利用者の文書と端末の出力なので対象外）
- 保存: `settings.json` に `general.language` が入り、**他の4 section を巻き込んでいない**こと、`.tmp` を残さないこと
- 再起動: en が復元されること、**`dom-ready` の時点で既に `en`** であること
- fallback: `language` を `klingon` にして起動すると、`<html>` も Settings の現在値も**ja** になること
- IPC の検証: 知らない section（`language`）・文字列でない `language`・object でない要求・`section: null` がすべて `INVALID_REQUEST`、`settings:load` が既知の**5 section** を返すこと、**知らない key（`languageServerPath`）は要求ごと通っても保存されず、ディスクにも残らない**こと

#### スクリプト2 — Keyboard Shortcuts（111項目・1回起動）

**永続化するものが1つも無いので、起動し直す必要が無い。** ネイティブのダイアログは Session 4-2 と同じく `app.evaluate` で差し替える（差し替えるのは**利用者の指の代わり**だけ）。

- 既定7件: すべて実際に効くこと。`Ctrl+S` は**ディスク上のファイルが実際に書き変わる**ところまで確認（設定が効くのではなく、操作が起きること）
- `when`: 端末に focus があるとき `Ctrl+,` / `Ctrl+J` / `Ctrl+O` / `Ctrl+Shift+E` / `Ctrl+Shift+G` が**1つも走らない**こと
- **xterm が `Ctrl+S` を通さないこと**（下記）
- Monaco との共存: `Ctrl+F` で検索、`Ctrl+H` で置換が開くこと、`Ctrl+/` が行コメントとして働くこと。そのあいだ Settings が開かず、パネルも動かないこと
- `Ctrl+P` / `Ctrl+Shift+P`: Settings も開かず、パネルも動かず、**どの面も出ない**こと（席が空いたまま）
- `settingsOpen`: Settings を開いている裏でパネル開閉の3つが走らないこと
- `modalOpen`: 閉じる前の確認が出ている裏で `Ctrl+,` / `Ctrl+Shift+E` / `Ctrl+Shift+S` が**1つも走らない**こと
- `editorHasActiveTab`: タブが1枚も無いとき `Ctrl+Shift+S` が何もしないこと
- 一覧: **21件**、カテゴリ内訳（workspace 2 / editor 2 / view 5 / git 7 / files 3 / settings 2）、**未割り当て14件**、`terminal` カテゴリの行が無いこと、Source 列が無いこと、21件すべてに名前が入っていること
- 一覧の性質: 行を押しても command が実行されないこと、**Git パネルを閉じても Git の7件が並ぶ**こと、検索が効くこと、**閉じて開き直すと検索が消える**こと、言語に連動すること
- 寄与: Git / Files パネルを**3往復開閉しても登録の衝突（例外）が起きない**こと
- 保存先: userData に `keybindings.json` が**作られていない**こと、Workspace フォルダに何も書かれていないこと

#### xterm が `Ctrl+S` を止めることを、どう測ったか

Session 4-7A が `editor.save` に `'!terminalFocused'` を付けなかった根拠にあたるので、実測しておく必要がある。Renderer 側に probe を1つ足して、**届いたかどうか**を直接見る。

```js
await win.evaluate(() => {
  globalThis.__fxSeen = []
  globalThis.__fxProbe = (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') globalThis.__fxSeen.push('ctrl+s')
  }
  window.addEventListener('keydown', globalThis.__fxProbe)
})
```

端末に focus を当てて `Ctrl+S` を押すと `__fxSeen` は**空のまま**、Editor に focus を当てて押すと `'ctrl+s'` が入る。**対照を取るのが要点**で、片方だけを見ると「そもそも打鍵が届いていない」と区別が付かない。

#### 見つかった不具合（1件）

**Editor のタブの `title` で、状態の一言を囲む括弧が全角で直書きされていた**（`EditorTabs.tsx`）。`note` の側は訳されていたので、English の画面に `alpha.txt（Unsaved）` と出ていた。翻訳キー `editor.tabs.titleWithNote` を1つ足して、Terminal のタブ（`terminal.tabs.titleWithNotes`）と同じ作法に揃えた。**直したのはこの1件だけ。**

この形の漏れは**辞書のキー突き合わせでは絶対に見つからない** ── 辞書は両言語とも正しく、間違っていたのは辞書を使う側にあたる。画面を英語にして走査する以外に見つける道が無い。

#### 走査から意図的に外したもの

| 外したもの                           | 理由                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `.monaco-editor` / `.xterm` の中     | 利用者の文書と端末の出力であって、アプリの文言ではない                                               |
| 言語の選択肢（`日本語` / `English`） | **言語名はその言語自身で書く**（ARCHITECTURE.md §17.7）── 英語の画面に「日本語」と出るのが正しい     |
| パスらしき文字列                     | Windows のユーザー名が日本語だと必ず引っかかる（`C:\Users\…`）。アプリの文言ではない                 |
| Terminal の新規ボタンの `＋`         | 文言ではなく**字面の記号**（閉じる `×` と同じ扱い）。`aria-label` / `title` は両言語とも訳されている |

最後の1つは、外したこと自体を項目として残してある（`aria-label` / `title` が英語であることを確かめたうえで、字面が `＋` のままであることを記録する）── **黙って除外すると、次に走査する人が同じ判断をやり直すことになる。**

#### 注意点（この Session で踏んだもの）

- **未保存のタブを抱えたまま `app.close()` を呼ぶと返らない。** 閉じる前の確認がモーダルで出て、Playwright 側は待ち続ける（10分待っても返らなかった）。編集を片付けてから閉じること。ダイアログが出た後は背面のクリックも全部そこで詰まるので、**それ以降のあらゆる操作がタイムアウトする**
- **IPC の検証は「知らない key を含む要求は通る」ことを踏まえて値を選ぶ。** `{ language: 'ja', languageServerPath: … }` を送ると `languageServerPath` だけが落ちて **`language` は保存される**（Session 4-3A の設計どおり）── これを検証の途中でやると、後続の「再起動で en が復元される」を自分で壊す
- **`Ctrl+/` を試すならコメント構文のある言語のファイルで。** `.txt` は plaintext なので、正しく**何も起きない**（アプリの不具合ではない）
- **本文を元へ戻しても未保存の印は消えない。** この app の `dirty` は**版番号が保存済みと違うか**で決まり（`editor/editorTabState.ts`）、中身の一致では判定していない。コメントを2回トグルすると本文は戻るが印は残る（VS Code の `alternativeVersionId` と同じ振る舞い）
- **日本語の走査は Windows のユーザー名を拾う。** 除外しないと、Workspace のパスが出ている場所すべてが偽の検出になる
- **`node` の stdout はパイプすると溜まる。** 長いスクリプトの途中経過を見たいときはファイルへリダイレクトして別で読む
- Git の各面のセレクタは `.fx-git__{history,stash,remote,diff}-overlay` と `.fx-git__branch-panel`
- Workspace は毎回 `mkdtemp` で作り、**ASCII だけのファイルを置く**（開発リポジトリを対象にすると、日本語のコメントが走査に全部引っかかる）

#### 品質ゲート（4-8A 時点）

| 確認                              | 結果                                                   |
| --------------------------------- | ------------------------------------------------------ |
| production app 統合確認           | **205項目、全項目 PASS**（Localization 94 / 打鍵 111） |
| `npm run format:check`            | PASS                                                   |
| `npm run typecheck`（node / web） | PASS                                                   |
| `npm test`（vitest）              | **140 files / 2856 passed / 1 skipped、全項目 PASS**   |
| `npm run build`（production）     | PASS（26.46s）                                         |

#### セキュリティ境界（4-8A で実測）

Session 4-5 / 4-7 は**境界を1つも動かしていない**ことを、両スクリプトで確かめている。

| 確認                                                                       | 結果                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `window.require` / `process` / `electron` / `Buffer` / `module` / `global` | 6つとも `undefined`                                                              |
| `window.fluvix` の名前空間                                                 | **10個のまま**（`language` も `theme` も `keybindings` も増えていない）          |
| `window.fluvix.settings` の口                                              | `load` / `saveSection` の**2つのまま**                                           |
| `contextIsolation` / `nodeIntegration` / `webSecurity`                     | `true` / `false` / 有効                                                          |
| CSP                                                                        | `script-src 'self'` のまま。script への `unsafe-inline` / `unsafe-eval` 許可なし |
| CSP 違反 / console.error / pageerror                                       | 4回の起動すべてで 0件                                                            |
| `keybindings.json`                                                         | userData に**作られていない**（作る経路が無い）                                  |
| Workspace フォルダへの書き込み                                             | **なし**（検証前後でファイル一覧が一致）                                         |

**言語の起動時適用が `additionalArguments` 経由であること**も測ってある ── `dom-ready`（`settings:load` の応答より前）の時点で既に `en` が当たっており、IPC を使わず CSP も緩めない経路が効いている（ARCHITECTURE.md §17.6）。

### Session 5-13（STEP 5 LSP の production app 統合確認）

**production build 版 66項目、全項目 PASS。** 5本のスクリプトに分けてある ── 落ちたときに「どの言語の、どの層の話か」を切り分けられるようにするため。

| スクリプト | 範囲                                           | 項目 |
| ---------- | ---------------------------------------------- | ---: |
| 1          | TypeScript / JavaScript / Python の全機能      |   24 |
| 2          | C#（csharp-ls）                                |   11 |
| 3          | Settings / Status / lifecycle / orphan process |   14 |
| 4          | Security boundary                              |   11 |
| 5          | 既知の制約（pyright-no-file-watching）の確認   |    6 |

#### 検証用の Workspace

**このリポジトリ自身は使えない**（§1 の TypeScript 7.x の話）。`%TEMP%\fnxls\ws` に、

- `typescript@5` を入れた `package.json` / `node_modules`（これが無いと TS サーバが「起動失敗」になる）
- `.ts` / `.js` / `.py` / `.cs` の題材と、わざと書式を崩した `messy.*`
- cross-file を測るための `src/Helper.cs`、`mod_a.py` / `mod_b.py`、`dep_a.ts` / `dep_b.ts`
- C# の project（`Probe.csproj`）

を置いてある。Workspace 切り替えの確認用に `%TEMP%\fnxls\ws2` も要る。

#### C# を測るための一時環境

この PC には .NET SDK も csharp-ls も入っていない。`%TEMP%\fnxls` 配下へ SDK と `csharp-ls`（`--tool-path`）を置き、**起動する Electron の `env` にだけ** `PATH` と `DOTNET_ROOT` を足して測っている。システムの PATH・レジストリ・ユーザープロファイル・プロジェクトの依存はいずれも変更しない。

#### 測ったこと

- **7機能 × 3言語**: Document Sync（didOpen / didChange / didSave / didClose）・Diagnostics・Completion・Hover・Definition・References・Formatting・Rename / prepareRename
- **Command / Keybinding**: F12 / Shift+F12 / F2 / Shift+Alt+F / Ctrl+Space が3言語で効くこと
- **capability**: Python の Shift+Alt+F が**何も起こさない**こと、かつ `.py` が TypeScript として整形されていないこと（`def   add( a,b ):` が崩れないことで見る）
- **cross-file**: C# の Rename が、開いていない `src/Helper.cs` をディスク上でも書き換えること
- **fallback**: LSP を OFF にしても TS は Monaco 内蔵の整形が効き、`.py` は依然として整形されないこと
- **Status**: 停止中 → 利用可能 → 使わない → 未インストール が実際のプロセスの有無と一致すること
- **lifecycle**: 言語ごとの ON / OFF、全体の ON / OFF、外からサーバを落としたときの立て直し（PID が変わること）、Workspace 切り替え、アプリ終了後に**プロセスが1つも残らない**こと
- **security**: `window.fluvix.lsp` が16個のまま、`require` / `process` / `Buffer` / `module` / `electron` がすべて `undefined`、CSP が STEP 1 のまま、応答に絶対パス / file URI / 実行ファイル名が1つも載らないこと、Workspace の外を指す5通りの `relativePath` がすべて `INVALID_REQUEST` で断られること

#### 確認スクリプトを書くときに踏んだこと

どれもアプリの不具合ではなく**測り方の側の問題**だったが、同じ形で何度も引っかかるので残しておく。

- **`Home` を押してから右へ数えない。** Monaco の `Home` は字下げのある行では「最初の非空白文字」へ行く。そこから `ArrowRight` で桁を数えると、indent の幅ぶんずれる ── C# の F12 が `;` の上、F2 が `(` の上を指していて、**アプリが壊れているように見えた**。`Control+Home` の後は桁1が保たれるので、そこから右へ数えるだけでよい
- **Rename の入力欄は、出てから focus を受けるまでに間がある。** `renameVisible()` になった直後に `Ctrl+A` を送ると、エディタ側の「すべて選択」になって本文が置き換わる。`document.activeElement` が `rename-input` になるまで待つ
- **プロセスを数える PowerShell が自分自身を数える。** `CommandLine -like '*pyright-langserver*'` は、そのフィルタを書いた powershell 自身のコマンドラインにも当たる。プロセス名（`node.exe` / `cmd.exe` / `csharp-ls.exe`）で先に絞る。なお1本のサーバは `cmd.exe`（`.cmd` を包む窓口）と `node.exe`（本体）の**2プロセス**として見える
- **`onSyncRequested` は「要求を出す口」ではない。** 公開面を正規表現で検査すると `request` に当たって誤検出する。`on*` を除いてから見るか、期待する16個と厳密に突き合わせる
- **Go to References が peek を出すとは限らない。** 結果が1件だと Monaco はその場所へ移動する（`multipleReferences` の既定が `peek` でも、複数無ければ移動になる）。件数が読める題材を用意する

### Session 6-3（Breakpoint）

**production build 版 37項目、全項目 PASS。** 使い捨ての Workspace 2つ（`ws` / `ws2`）と使い捨ての `--user-data-dir` を作り、`workspace-folder.json` を先に置いてから起動する ── ネイティブのフォルダ選択ダイアログを通さずに Workspace を決められる。

- glyph margin: 帯が出ること、click で追加、再 click で削除、**同じ行を続けて押しても増えない**こと、複数行に置けること、**本文を押しても印が増えない**こと
- 複数ファイル: 別のファイルには前の印が出ないこと、切り替えて戻ると復元されること、2ファイル分が Main に保持されていること
- 永続化: `userData/debug-breakpoints.json` が作られること、**Workspace の絶対パスが key**・中身は相対位置だけであること、**プロジェクトフォルダに何も書かれない**こと、アプリを閉じて開き直すと印が戻ること
- Workspace 切り替え: 別 Workspace には前の印が出ないこと、そこでも置けること、戻すと元の印が戻ること、2つが別々に保存されていること
- 壊れた保存ファイル: JSON として壊れていても落ちずに起動し、そのまま印を置けること
- Security boundary: preload の `debug` が3つだけであること、**Workspace 外 / 絶対パス / `file:` URI / 代替データストリームがすべて `PERMISSION_DENIED`**、不正な行が `INVALID_REQUEST`、応答に絶対パスも adapter の文言も載らないこと、任意 DAP method / adapter を指す口が無いこと、Node / process / electron の非露出、公開ドメインが既存 + `debug` のみ、**CSP が1文字も変わっていない**こと
- 回帰: 編集が普通にできること、編集後も印が残ること、Monaco の marker 面（LSP の指摘）が壊れていないこと、console エラー / CSP 違反が無いこと

**mock adapter での smoke（別途）。** 実 adapter がまだ無いので、DAP を話す小さな Node スクリプトを一時的に adapter として立て、**本物の子プロセス・本物の `Content-Length` フレーミング**で `initialize → launch → initialized → setBreakpoints → configurationDone → running` を通した。verified / unverified が控えへ当たること、adapter の文言が Main の控えにだけ残ること、running 中の再送、最後の1件を外したときに空の配列を送れること、`stop` で口が返らなくなることを確認済み（このスクリプトはリポジトリに置いていない）。

#### 確認で見つけた実際の不具合

**印がファイル切替で消えた。** `useBreakpointGlyphs` を `MonacoEditor.tsx` の**上の方**で呼んでいたため、React が「印を当てる → Model を差し替える」の順に effect を走らせ、当てた decoration が差し替えの時点で捨てられていた（decoration は Model に紐づく）。フックを呼ぶ位置を**一番下**（位置を見せる effect のさらに後）へ移して解決。unit test では偽のエディタが Model を差し替えないので出ず、**production build で初めて見えた**種類の不具合になる。

#### 確認スクリプトを書くときに踏んだこと（Session 6-3）

- **`.view-line` の並びから行番号を数えない。** 折り返しやスクロールで1行ずれる。Monaco 自身が描いている行番号（`.margin-view-overlays .line-numbers`）の矩形を正本にして、印の縦位置と突き合わせる。最初これで「6行目に付いた」と読み、**アプリが壊れているように見えた**（Main の控えは正しく5だった）
- **Files ツリーは lazy load。** `src` を先に展開しないと、その中のファイルの行が DOM に存在しない
- **編集の回帰確認をしたら、必ず元へ戻す。** 未保存のまま `app.close()` すると終了前の確認が出て、スクリプトが止まる

### Session 6-4（Execution Control）

**production build 版 52項目、全項目 PASS。** 使い捨ての Workspace と `--user-data-dir` で起動し、**制御はすべて Renderer の `window.fluvix.debug.*` から**通した（Renderer → preload → IPC → Main → DAP → 本物の子プロセス）。

起動の口がまだ無いため、セッションだけは Main から立てた。`npm run build` の後の `out/main/index.js` の末尾へ、環境変数で開く数行（`defaultManager.start(...)` を `globalThis` に置くだけ）を**確認のあいだだけ**足し、`app.evaluate` から mock adapter（DAP を話す小さな Node スクリプト。variant で振る舞いを変える）を立てる。確認の後は `npm run build` で out/ ごと作り直す ── ソースには何も残らない。

- 面: `debug` の関数が11個、start / attach / 生の request / evaluate が無い、`require` / `process` / `ipcRenderer` の非露出、公開ドメインは Call Stack の safe domain model だけ、**CSP が1文字も変わっていない**
- idle: 6つすべてが `no-session`、**`void` の口に何を載せても無視される**（adapter は立たない）
- running ↔ stopped: Pause → `threads` + `pause {threadId:1}` で stopped、Step Over / Into / Out → `next` / `stepIn` / `stepOut` で running → stopped、Continue → `continue` で running。running 中の Continue / Step と stopped 中の Pause は `invalid-state`、**答え待ちの2通目は `busy` で1通しか送られない**
- Breakpoint の回帰: 起動前に置いた印が `initialized` と `configurationDone` の間に送られ、verified が Renderer へ届き、running 中の追加で送り直され、終わると null に戻る
- Stop: terminate → disconnect（`terminateDebuggee` は名乗る adapter にだけ）→ idle、**2回目の Stop で待たずに disconnect**、debuggee が terminate を拒んだら猶予（約3秒）で disconnect、terminate を名乗らない adapter には disconnect だけ、starting 中の Stop は `configurationDone` を送らずに disconnect、どの場合も adapter のプロセスが消えること
- 異常: Step Out の最中に adapter が落ちると `session-ended` で idle、その後の制御は `no-session`
- 終了: セッションが running のままアプリを閉じても adapter のプロセスが残らない
- console エラー / CSP 違反が無い

#### 確認スクリプトを書くときに踏んだこと（Session 6-4）

- **本番ビルドでは `startDebugSession` が tree-shaking で消えている**（呼ぶ場所がまだ無い）。残っているのは `defaultManager` の方なので、足す数行はそちらを直接叩く
- **mock adapter の `next` は応答を 150ms 遅らせる。** すぐ答えると2通目の IPC が届く前に1通目が終わり、`busy` を通せない
- **ユニットテストで使い捨てフォルダを adapter の cwd にしない。** 全テストを並べて走らせると、Windows がフォルダの掴みを離すのが遅れ、`rmSync` が `EPERM` で落ちる（アプリのせいに見える FAIL）

### Session 6-6（Variables / Scopes）

**production build 版 76項目、全項目 PASS。** 6-4 と同じく、使い捨ての Workspace と `--user-data-dir` で起動し、`npm run build` 後の `out/main/index.js` の末尾へ環境変数で開く数行（`defaultManager.start(...)` を `globalThis` に置くだけ）を**確認のあいだだけ**足して mock adapter を立てた。確認の後は `npm run build` で out/ を作り直している（ソースにも out/ にも何も残らない）。Variables の操作は**画面（Debug パネルの Call Stack / Variables）**から、境界の確認は Renderer の `window.fluvix.debug.*` から通した。

- 面 / 境界: `debug` の関数が13個、evaluate / setVariable / readMemory / 生の request / start が無い、`require` / `process` / `ipcRenderer` の非露出、**CSP が source の index.html と一致**、生の数値 `variablesReference` は INVALID_REQUEST、未知の handle 文字列と今の Call Stack に無い frame は `stale`、応答に `variablesReference` / `evaluateName` / `memoryReference` / `Scope.source` / 絶対パス / adapter の文言が載らない
- 流れ: breakpoint を置いてから起動 → `setBreakpoints` が `configurationDone` の前 → stopped → Call Stack 3 frame（最上段が選択）→ Scope 3つ → **重くない最初の Scope だけ自動で開く**（adapter が受けた `variables` は `1000` の1通だけ）→ 入れ子を2段開く → 折り畳み → 開き直しで再要求しない → 1200件の配列は 500件 + 「先頭の一部」表示、paging を名乗らない adapter には `start` / `count` を送らない → 空の Scope は「Variable がありません」
- frame 選択: Workspace 外の frame を選ぶと Variables がその Scope を出し、**Editor のタブは増えない**／scopes を断る frame では「取得できませんでした」だけが出て adapter の文言は出ない／Workspace 内の frame を選ぶと `src/app.js` が開き Variables も戻る／キーボード（↓）で tree の中を移動できる
- stale: Step Over / Into / Out → 次の停止で読み直し、前の停止の handle は `stale` で adapter へは届かない、展開は持ち越さない／Continue → Variables と Call Stack が空になり、handle は `not-stopped`／Pause（同じ番号の再利用）→ 前の handle は `stale`
- 片付け: Workspace を閉じると session が idle・adapter のプロセスが消え、Variables / Call Stack が空／再起動して scopes を遅らせる adapter で「読み込んでいます」が出てから中身が出る、paging を名乗る adapter には `start: 0, count: 501`／stopped のままアプリを閉じても adapter のプロセスが残らない
- console エラー / CSP 違反が無い

#### 確認スクリプトを書くときに踏んだこと（Session 6-6）

- **Debug パネルを View メニューから出すと、Files と同じ dock のタブになる。** 次の起動では Debug が前面のまま復元されるので、`.fx-file-row__name` を待つと永久に出てこない ── 待つ前に Files のタブを押す。タブは `mousedown` を合成しても切り替わらず、`page.mouse.click` で本物の click を送る必要がある
- **Workspace を閉じるボタンは Files パネルの root 行にある。** Debug タブが前面だとボタンが DOM に無い（アプリのせいに見える FAIL）

### Session 6-7（Evaluate）

**production build 版 54項目、全項目 PASS。** 6-4 / 6-6 と同じ形で、使い捨ての Workspace 2つと使い捨ての `--user-data-dir` で起動し、`npm run build` 後の `out/main/index.js` 末尾へ `FLUVIX_VERIFY_DEBUG=1` で開く数行を確認のあいだだけ足して mock adapter（DAP を話す小さな Node スクリプト。variant で振る舞いを変える）を立てた。確認の後は `npm run build` で out/ を作り直している（ソースにも out/ にも何も残らない）。

通した流れは **Breakpoint → start → stopped → Call Stack → frame 選択 → Variables → Evaluate**。境界の確認は Renderer の `window.fluvix.debug.*` から、画面の確認は Debug パネルから通した。

- 面 / 境界: `debug` の関数が14個（13 + `evaluate`）、start / attach / 生の request / `setVariable` / memory が無い、`require` / `process` / `electron` / `Buffer` / `module` / `global` の非露出、**CSP が source の index.html と1文字も違わない**
- 流れ: 起動前に置いた breakpoint → stopped → Call Stack 2 frame（Workspace 内は相対位置、外は開けない表示）→ Scope 2つ → Variables 展開 → Evaluate
- Evaluate: adapter へ届くのが `{ expression, frameId, context }` の3欄だけであること、`repl` / `watch` がそのまま文脈として届くこと、Workspace 外の frame でも評価できること
- handle: 展開できる結果に **6-6 と同じ表の handle**（`dv-N`）が付き、Scope の handle と重ならないこと、`listVariables` で2段展開できること、adapter が `variables { variablesReference: 4001 }` を受けていること
- 漏らさない: 応答に生の `variablesReference` / `memoryReference` / `valueLocationReference` / `presentationHint.attributes` / 絶対パス / adapter の文言が1つも載らないこと
- 断る: 形の壊れた要求 10 通り（式が無い・空白・2,001字・NUL・数値、`frameId` が 0 / 負 / 文字列、`context` が `hover` / `setVariable` / 無し）がすべて INVALID_REQUEST、今の Call Stack に無い frame は `stale` で **adapter へは1通も届かない**
- 押し込み: 要求に `command` / `variablesReference` / `threadId` / `adapter` を載せても Main へは渡らず、adapter が受けた `evaluate` の引数は常に3欄のまま
- 画面: Debug パネルの入力から評価でき、結果が文字列として出て、押すと Variables の行として展開されること
- stale / lifecycle: Continue 直後は `not-stopped`、新しい停止で前の handle は `stale`、その停止で評価し直せること、Step Over 後も Call Stack が読み直されること、**Workspace 切り替えでセッションが idle になり adapter のプロセスが消え**評価が断られること
- 異常: adapter の失敗は `failed`（文言は Renderer に出ない）、`result` の無い応答は `failed`、答えない adapter は **10.0 秒で `timeout`**（届いてはいる）
- 回帰: Session 6-3 Breakpoint（起動前に置いて verified が返る）/ 6-4 Execution Control（Continue / Step Over）/ 6-5 Call Stack / 6-6 Variables
- 片付け: Workspace に1バイトも書かれない、console エラー / CSP 違反 0件、アプリ終了後に adapter のプロセスが残らない

#### 確認スクリプトを書くときに踏んだこと（Session 6-7）

- **メニューの項目を英語の文言で探さない。** このマシンのアプリは日本語で起動するため、`Open Folder…` を探すと当たらず「項目が無い」に見える（アプリは正しい）。上部バーの Workspace メニューは並びが固定（開く → 閉じる）なので**番号で選ぶ**。`View` / `Debug` のように両言語で同じ文言のものだけが、文字列で探して安全になる
- **`app.evaluate` の中に `require` は無い。** Main 側で子プロセスを数えようとすると `ReferenceError: require is not defined` になる ── プロセスを数えるのはドライバの node 側でやる
- **Workspace を切り替える入口は、上部バーの Workspace メニューを使う。** Files パネルの「フォルダを開く」は Debug タブが前面だと DOM に無い（6-6 で記録した罠と同じ根）。上部バーはどの dock タブが前面でも必ず在る
- **timeout の確認には 10 秒かかる。** mock adapter に「答えない」variant を持たせ、経過時間まで測ると「すぐ返った（＝上限を見ていない）」と「永久に返らない」の両方を1つの項目で切り分けられる

### Session 6-9（Debug Status）

**production build 版 57項目、全項目 PASS。** 6-7 と同じく、使い捨ての Workspace 2つと使い捨ての `--user-data-dir` で起動し、`npm run build` 後の `out/main/index.js` 末尾へ `FLUVIX_VERIFY_DEBUG=1` で開く数行を確認のあいだだけ足して mock adapter を立てた。確認の後は `npm run build` で out/ を作り直している（hook の残りが 0 件であることを grep で確認）。**1回の node プロセスで2回起動**し、1回目を日本語、2回目を `settings.json` の `general.language: "en"` で英語にした。

- 面 / 境界: `debug` の関数が17個（15 + `getStatus` / `onStatusChanged`）、start / launch / attach / adapter / request / command / profile / setting を名乗る関数が無い、`require` / `process` / `electron` / `Buffer` / `module` / `global` の非露出、**CSP が source の index.html と同じ**
- 応答の形: `getStatus` が `{ status }` だけを返すこと、**`command` / `adapter`（`cmd.exe` の絶対パス）/ `args` / `cwd` / `sessionId` / `program` を載せて呼んでも1語が返るだけで、セッションは立たない**こと、通知の payload がどれも `{ status }` の既知の1語であること
- ステータスバー: 既定が「デバッグ: 利用不可」（title「Debug adapter を利用できません。」）、`<span>` で role / tabindex を持たない、LSP の直後に並ぶ、**押しても何も起きない**（セッションも adapter の要求も発生しない）
- 流れ: 起動 → 通知が **starting → running → stopped の3本**、「デバッグ: 一時停止中」、idle と色が違う、`getStatus` と画面が一致／Continue → running → stopped／Step Over ×3 で running / stopped が交互に並び**同じ語が続かない**／同時の Step Over 2通で2通目が `busy` でも一時停止へ収束／Stop → terminating → unavailable
- 片付け: Stop 後・**stopped のまま Workspace を切り替えた後**・**一時停止のままアプリを終了した後**のいずれも adapter のプロセスが 0、状態は unavailable へ戻る
- 英語: 「Debug: Unavailable」「Debug: Paused」（Stopped と出ない）、title「No debug adapter is available.」
- Settings: `settings:load` にも保存された `settings.json` にも `debug` section が無い
- 回帰: 6-3 Breakpoint（起動前に置いて verified）/ 6-4 Continue・Step Over・Stop / 6-5 Call Stack 2 frame / 6-6 Scopes / 6-7 Evaluate / 6-8 Debug Console の「セッション終了」entry
- Workspace に1バイトも書かれない、console エラー / CSP 違反 0件（2回とも）

#### 確認スクリプトを書くときに踏んだこと（Session 6-9）

- **状態の通知は Renderer 側でもう1本購読して payload ごと積む。** ステータスバーの `data-debug-status` を待つだけでは、途中の語（starting / terminating）が一瞬で過ぎて見えない ── 通知の列を読めば、まとめ方と重複の有無まで1項目で測れる
- **mock adapter の `configurationDone` は 120ms 後に止まる**ので、起動直後の running は画面ではほぼ見えない。running を見たいときは画面ではなく通知の列で見る
- **VS Code / Claude Code 自体も electron.exe で動いている。** 前回の残りを片付けるときに名前だけで kill しない ── `ExecutablePath` が `Fluvix Nexus\node_modules` のものだけに絞る

### Session 6-10（Debug Profile + `debug:start`）

**production build 版 105項目、全項目 PASS。** 使い捨ての Workspace 2つ（ws1 / ws2）・Workspace の外のフォルダ・使い捨ての `--user-data-dir` で起動し、`npm run build` 後の `out/main/index.js` 末尾へ `FLUVIX_VERIFY_DEBUG=1` で開く数行（**catalog の `node` 行を mock adapter の行へ差し替える関数**を globalThis に置くだけ）を確認のあいだだけ足した。6-9 までと違い**セッションは Main から立てていない** ── 起動は Renderer の `window.fluvix.debug.start({ profileId })` から通した。確認の後は `npm run build` で out/ を作り直している（hook の残りが 0 件であることを grep で確認）。1回の node プロセスで2回起動し、2回目は hook を開かずに（出荷状態の catalog で）起動した。

- 面 / 境界: `debug` の関数が22個（17 + 5）、adapter / spawn / exec / process / attach / command / request / launch / runtime / cwd を名乗る関数が無い、`require` / `process` / `electron` / `Buffer` の非露出
- 出荷状態（6-10 時点。→ 6-12 以降は「待機中」、node 行は 6-15B で統合）: ステータスが「利用不可」、node 行が `not-integrated`、`start` は `{ status: 'failed', reason: 'adapter-unavailable' }` の2欄だけで adapter のプロセスは立たない（要求に `adapter` / `cwd` / `program` を載せても同じ）、未知の id は `profile-not-found`
- 作成 / 検証: id が `dp-<uuid>` で発番され、相対位置は `src/app.js` に正規化され、応答は7欄だけで Workspace のパスも adapter の名残も無い／要求と draft に `profileId` / `cwd` / `runtimeExecutable`（cmd.exe）/ `adapter` / `adapterArgs` / `console` / `preLaunchTask` / `request: attach` / `processId` を載せても7欄だけが保存され、id は Main のもの／値で断る17通り（`PATH` / `Path` / `NODE_OPTIONS` / `ELECTRON_RUN_AS_NODE` / `pythonpath` / `DOTNET_STARTUP_HOOKS` / `LD_PRELOAD` / 名前の形 / 大文字小文字違いの重複 / `..` / 絶対パス（cmd.exe・Workspace 内を指す絶対パス）/ file URI / UNC / **Workspace 外を指すジャンクション経由** / `pwa-node` / 文字列の programArgs）で何も保存されない／形の壊れた要求6通りが INVALID_REQUEST／更新で id が変わらない・削除・消した id の再削除は `profile-not-found`
- 起動（catalog を mock に差し替え）: ステータスが「待機中」へ移る／まだ無い program の profile は保存でき、起動は `program-not-found`／**保存時には無かったフォルダを後から外向きのジャンクションにすると、起動は `program-outside-workspace`**／どちらも adapter は立たない／起動は `{ status: 'started' }` の1欄、通知は starting → running → stopped、stopped 中の2回目は `already-running`
- adapter 側で見えたもの: argv が `[node.exe の絶対パス, mock, ログ]` の3つだけで programArgs は1語も無い、cwd は Workspace root の realpath、環境に `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` が無く **profile の env（`APP_MODE`）も無い**、`initialize` は `adapterID: pwa-node` / `supportsRunInTerminalRequest: false`、順序は initialize → launch → configurationDone、launch の欄は9つ（program は realpath・args は `&&` / `|` / `%PATH%` / 前後の空白を含めてそのまま・cwd は root・env は profile の2つ・`console: internalConsole`）
- debuggee: mock が launch の欄どおりに走らせたプログラムが argv / cwd / `APP_MODE` をそのまま受け取った、Debug Console に出力が届いた、終了で idle へ戻り adapter のプロセスが消えた
- Workspace 切り替え: stopped のまま ws2 へ切り替えると idle・adapter のプロセスが 0、ws2 の一覧は空、ws1 の id は ws2 から起動 / 更新できず `profile-not-found`、ws2 で作ったものは ws1 に戻ると見えない
- 保存: `userData/debug-profiles.json` が Workspace root の realpath 2つで引かれている、再起動で ws1 の3件が戻る、**手で書き足した4件のうち `Path` を持つもの・絶対パスのもの・発番の形でない id のものが落ち**、余計な欄（`cwd` / `runtimeExecutable`）を持つものは7欄に畳まれて残る、再起動後は hook も無く `adapter-unavailable`
- Workspace に1バイトも書かれない（`.vscode` / `.fluvix` / profile のファイルが無い）、mock adapter のプロセスが残らない、console エラー / CSP 違反 0件（2回とも）

#### 確認スクリプトを書くときに踏んだこと（Session 6-10）

- **scratchpad の `package.json` が `"type": "module"` だと、Workspace に置いた `.js` の題材まで ES module として読まれる**（`require is not defined` で exit 1）。アプリは正しい program / args / cwd / env を渡しているのに、「debuggee が引数を受け取っていない」ように見える FAIL が4つ出た。Workspace の**外**（使い捨てディレクトリの直下）に `{"type":"commonjs"}` を置けば、Workspace の中身を増やさずに済む
- **起動時の再検証（保存の後にリンクへ差し替え）を画面側から作るには、保存時にまだ無いフォルダを profile に書いておき、保存の後でそのフォルダ名のジャンクションを作る。** 既に在るリンクは保存時に断られるので、この順でしか起動時の段を通せない
- catalog の差し替えは bundle の `DEBUG_ADAPTER_CATALOG` を名前で書き換えるだけで効く（`getDebugAdapterCatalogEntry` / `hasIntegratedDebugAdapter` は呼ばれるたびに表を読む）。ステータスの `unavailable` → `idle` も同じ差し替えで動く

### Session 6-11（Debug Toolbar + Profile editor）

**production build 版の簡易スモーク PASS。** `npm run build` 後の `out/main/index.js` をそのまま Electron で起動し、CDP から View → Debug を開いて確認した。hook / mock adapter / catalog 差し替えは使っていない。既存 userData の Workspace 復元が働いた状態で、Profile の保存と Debug Session の起動は行っていない。

- Debug Panel: View メニューから `debug` パネルを開ける、Call Stack / Variables / Debug Console と同じ面に Toolbar が出る
- Toolbar: `role="toolbar"` と localized label を持つ、Profile selector が「Profile なし」を出す、Profile 未選択では Start / Pause / Stop が disabled
- Profile editor: Add Profile で Debug Panel 内に editor が開く、6欄（name / language / programRelativePath / programArgs / env / stopOnEntry）が揃う、`input[type=file]` は無く native file dialog に依存しない
- セキュリティ: `window.fluvix.debug` は公開されるが、`window.process` / `window.electron` は出ない。debug API は Session 6-10 の22関数のまま
- 片付け: 検証用 profile は保存しない。adapter は起動しない

### Session 6-12（Python / debugpy）

**production build 版 85項目、全項目 PASS。実 debugpy（1.8.21 / CPython 3.14.7）で、hook も mock adapter も catalog の差し替えも使っていない**（`npm run build` の `out/` をそのまま起動）。この PC には Python が無いので、uv が置いた CPython から scratchpad に venv を作って `pip install debugpy` し、**起動する Electron の `PATH` の先頭にだけ** `Scripts` を足した。使い捨ての Workspace 2つ（ws1 / ws2）と使い捨ての `--user-data-dir` で、同じ node プロセスから3回起動した（A: debugpy 入りの python / B: debugpy の無い python / C: PATH に python が無い）。ws1 には **`debugpy/__init__.py`（読み込まれたら印のファイルを書いて exit 3）を置いた**。

- 面 / 境界: `debug` の関数が22個のまま、adapter / spawn / exec / process / command / launch / runtime / cwd / python / interpreter / terminal を名乗る関数が無い、`require` / `process` / `electron` / `Buffer` の非露出、CSP meta があり違反 0件（A / B）、Renderer の console エラー 0件
- 出荷状態: ステータスバーと `getStatus` が「待機中」（python 行が統合された）、Toolbar は idle で Start だけが押せる
- Profile: Debug Panel の editor から python の profile を2つ作成（`main.py` に args 2行 + `FX_MODE=verify`、`loop.py` に stopOnEntry）。args は1行1語のまま、一覧に絶対パス / adapter の名残が無い
- 起動と停止: breakpoint（main.py:11）→ Start で starting → running → stopped、**debugpy が `verified: true` を返し**、Toolbar は Continue / Step ×3 / Stop だけが押せる
- Call Stack: 最上段が `main`（main.py:11・Workspace 内の相対）、その下に `<module>`、応答に Workspace の絶対パス / venv / site-packages / file URI が無い、画面にも両方が出る、frame を押すと main.py がエディタに開く
- Variables: Locals に `items = [1, 2, 3]` と `info`（dict）、`info` を開くと `'name': 'fluvix'`、生の `variablesReference`（`'4'`）は handle として通らない、画面に items / info
- Debug Console / Evaluate: 入力欄で `len(items) * 10` → `30`、typed API で `info["name"].upper()` → `FLUVIX`、未定義の名前も答えが返り stopped のまま
- Step: Step Into で helper.py:2 の `add`、Step Over で helper.py:3（`doubled` が `2`）、Step Out で main.py の `main` へ戻る
- 完走: Continue で idle へ戻り、stdout に `child said 42`（**`subprocess.run` が返った ＝ `subProcess: false`**）・`args ['alpha beta', '--flag'] mode verify cwd ws1`（プログラムの cwd は Workspace root）・`result 4`、Call Stack が空になり python のプロセスが 0
- stopOnEntry / Pause / Stop: loop.py の入口で止まる → Continue で running（Pause / Stop だけ押せる）→ Pause で loop.py の中に止まり `count > 0` が `True` → Stop で idle、python のプロセスが 0
- 起動の要求に余計な欄: `start({ profileId, executable: calc.exe, cwd, args, adapter })` の応答は `{ status: 'started' }` だけ、動いたのは `python -m debugpy.adapter`（コマンドラインに calc が無い）
- Workspace 切り替え: running のまま ws2 へ → idle・python のプロセス 0、ws2 の一覧は空、ws1 の id は ws2 から `profile-not-found`、ws1 へ戻ると2件が残っている
- アプリ終了: running のまま `app.close()` が返り、python のプロセスが 0
- **Workspace の `debugpy/` は一度も読み込まれなかった**（印のファイルが無い）。Workspace に増えたのは CPython が `import helper` で書いた `__pycache__/helper.cpython-314.pyc` だけ
- B（debugpy の無い python）: 起動の応答は `started`、状態は starting → idle、python のプロセス 0、アプリは応答し続ける。続けて **userData に `debugpy/__init__.py` を置くとそちらが読み込まれた ── adapter のプロセスの cwd が userData であることの裏付け**（確認後に削除）
- C（PATH に python が無い）: 状態は idle のまま、Start の応答は `{ status: 'failed', reason: 'adapter-unavailable' }` だけで python のプロセスは立たない、Toolbar の文言に絶対パス / 実行ファイル名が無い

気づいたこと（直していない）: debugpy の `telemetry` output（`ptvsd` / `debugpy`）が Debug Console に `system` の2行として出る（Session 6-8 の畳み方のまま）。

#### 確認スクリプトを書くときに踏んだこと（Session 6-12）

- **応答の形を取り違えると、アプリが正しいのに FAIL が出る。** `listCallStack` は `data.callStack`、`listScopes` / `listVariables` / `evaluate` は `data.result`、`onConsoleEntry` の payload は `{ workspaceId, entry }`
- **debugpy は `print("a", b)` を複数の output event に分けて送る**（`child said` と ` 42\n…`）。entry ごとに探すと見つからない ── stdout の text をつないでから探す
- **venv の `python.exe` はリダイレクタで base の python を子に起こす。** adapter / launcher / debuggee で python が6プロセスに見える。数えるときは CommandLine の venv / uv のパスで絞る
- `process.env` を展開して `PATH` を足すと、Windows では `Path` と `PATH` の2つのキーになる ── 大小どちらも消してから `PATH` を1本だけ入れる

### Session 6-13（Exception Stop + Current Execution Location）

**production build 版 68項目、全項目 PASS。実 debugpy（1.8.21 / CPython 3.14.7）で、hook も mock adapter も使っていない**（`npm run build` の `out/` をそのまま起動）。6-12 と同じく uv の CPython から scratchpad に venv を作って `pip install debugpy` し、起動する Electron の `PATH` の先頭にだけ `Scripts` を足した。使い捨ての Workspace 2つ（ws1 / ws2）と使い捨ての `--user-data-dir` で起動し、Workspace は `dialog.showOpenDialog` を差し替えて上部バーの Workspace メニューから開いた。

実装の前に、実 debugpy へ Content-Length フレーミングの DAP を直接送る probe で、`exceptionBreakpointFilters`（`raised` / `uncaught` / `userUnhandled`）・`supportsExceptionInfoRequest: true`・stopped の reason（`breakpoint` / `step` / `pause` / `entry` / `exception`）・`exceptionInfo` の形（`details.stackTrace` / `source` が絶対パス）・filter ごとの止まり方・**`setExceptionBreakpoints` を送らないと uncaught でも止まらないこと**を確かめた。

- 面 / 境界: `debug` の関数が22個のまま（exception / request / dap / command を名乗る関数が無い）、build の CSP が source と同じ、CSP 違反 0件、Renderer の console エラー 0件
- Profile: Debug Panel の editor から python の profile を3つ作成（main.py / loop.py / exc.py）
- breakpoint（main.py:6）→ Start: reason `breakpoint`、**Editor が main.py を自分で開き**、6行目に実行位置の帯、glyph は breakpoint と同じ要素に並び丸が輪（2px）になって矢印と両方描かれる、「Breakpoint で一時停止中」（`role="status"`）、Call Stack の「実行位置」は1つだけ
- Theme: 実行位置の帯と矢印の色が Dark / Light で変わり、どちらも透明でない
- 回帰: Variables に `items`、Evaluate `len(items)` → `3`、Debug Console に `total` の出力
- Step Into → helper.py:2（Editor が追う・「Step の後で一時停止中」）→ Call Stack で下の段（main）を選ぶ → main.py:6 に**選択中の印**が出て main.py には実行位置の印が出ない、1秒待っても Editor は引き戻されない、Call Stack は実行位置 = add・選択 = main → Step Over → helper.py:3 へ移り選択が最上段へ戻る → Step Out → main.py へ戻り印が最上段の行に一致 → Continue で完走し、印と停止理由が消え python のプロセスが 0
- loop.py: Pause → reason `pause`・「手動で一時停止中」・ループの中の行に印 → Continue（running のまま）で印と停止理由が消える → Pause で新しい通し番号とともに戻る → Stop で消え python のプロセスが 0
- exc.py（`try` で捕まえる KeyError の後に、捕まえない FileNotFoundError）: **止まったのは FileNotFoundError の1回だけ**（exc.py:13 `boom`）、「例外で一時停止中」「FileNotFoundError」「捕捉されていない例外」（`breakMode: unhandled`）、メッセージの中のパスは `no_such_dir/data.txt`（Workspace 相対）、call-stack の通知と停止理由 / Call Stack の画面に絶対パス / file URI が無い → Continue で exit、印が消え python のプロセスが 0 → もう一度起動して例外で止まったまま Stop → 消える
- Workspace 切り替え: breakpoint で止まったまま ws2 へ → idle、印と停止理由が消え、空の snapshot（`stop: null`）が届き、python のプロセスが 0
- アプリ終了: ws1 に戻って breakpoint で止まったまま `app.close()` → python のプロセスが 0
- Workspace に増えたのは CPython が書いた `__pycache__` だけ

#### 確認で見つけて直したもの（Session 6-13）

- **例外メッセージのパスが相対位置に直らなかった。** Python の FileNotFoundError はパスを repr で入れるため区切りが `\\` と二重になり、UNC の規則が先に当たって `'C:<path>'` になった（ドライブ文字だけが残る）。unit test では区切りを1つで書いていたので出ず、**実 debugpy のメッセージで初めて見えた**。ドライブ文字の規則を先に当てるよう直し、二重区切りの unit test を足した
- **breakpoint と同じ行で止まると、塗りの丸と矢印が1つの塊に見えた**（スクリーンショットで確認）。その行だけ丸を輪にして矢印を内側に描くよう CSS を直した

#### 確認スクリプトを書くときに踏んだこと（Session 6-13）

- **Variables の値にはプログラム自身のパスが出る**（`missing = os.path.join(os.getcwd(), …)`）。画面全体を絶対パスで走査すると、§20.9 / §20.15 の設計どおりの表示を「漏れ」と数えて FAIL になる ── 走査は面ごとに分け、今回の境界（停止理由 / Call Stack / call-stack の通知）だけを判定にする
- 停止ごとの位置は Renderer 側で `onCallStackChanged` をもう1本購読し、`stop.sequence` が進むのを待つ。画面の文言だけを待つと、Step の前後で同じ「Step の後で一時停止中」が続き、前の停止のまま次の確認へ進む
- decoration の行は、`.view-overlays` の要素の縦位置を Monaco 自身の `.line-numbers` の縦位置と突き合わせて読む（6-3 と同じ）
- `webContents.setZoomFactor(3)` で glyph を拡大しようとすると、要素が見つからないまま locator が 30 秒待って確認全体が止まった。見た目の補助は `page.$()`（待たない）と `try / finally` で包み、判定には使わない

### Session 6-15A（Socket DAP / Child Session Foundation）

**production build 版 97項目、全項目 PASS。** Node の実 adapter（vscode-js-debug）は統合していないので、**`npm run build` の `out/main/index.js` の catalog の node 行だけ**を scratchpad の **fake socket DAP server**（Node の小さなスクリプト。vscode-js-debug ではない）へ一時的に書き換え、Renderer の経路（Profile editor / Toolbar / `window.fluvix.debug`）だけで駆動した。確認の後に `npm run build` で bundle を戻した。使い捨ての Workspace 3つと `--user-data-dir`。

fake server は 127.0.0.1 の空いた port で待ち受けて stdout に1行で port を出し、1本目の接続を root、2本目を child として振る舞う。root は `configurationDone` の後に `runInTerminal`・`startDebugging`（attach）・`startDebugging`（`runtimeExecutable` 付き）・正しい `startDebugging` の順で逆方向 request を送る。受けた request と逆方向 request への応答は JSON 行でファイルへ書き、それを数えて判定した。終わり方の再現は、evaluate の式（`__child_terminated__` など）を server が読んで起こす。

- 面 / 境界: `debug` の関数が22個のまま（port / socket / transport / child / reverse / process / adapter / connection / request / dap を名乗る関数が無い）、build の CSP が source と同じ、CSP 違反 0件、Renderer の console エラー 0件、`process` / `require` / `electron` / `Buffer` の非露出
- socket transport と `startDebugging`: node の profile の Start で root → 子 → breakpoint で停止。root が受けたのは `initialize` / `launch` / `setBreakpoints` / `configurationDone` だけ。逆方向 request の応答は `runInTerminal:false` / attach `false` / runtimeExecutable `false` / 正しいもの `true`、開いた子の接続は1本、子の `launch` は `{ type, name, request, __pendingTargetId }` の4欄だけ、子の `initialize` は root と同じ引数（`supportsRunInTerminalRequest: false`）
- primary child: Call Stack の thread は子のもの（`Main Thread`）、最上段は `compute`（main.js:3・Workspace 相対）、Workspace 外の frame は `unavailable`、breakpoint は子が答えた verified、Variables（`who = "child"`・入れ子の展開）と Evaluate（`child:1+2`）が子へ行く、Toolbar の Step Over / Into / Out が子へ `threadId: 1` 付きで届き、root へは実行制御も読み取りも1通も届かない
- handle: 存在しない frame id は `stale`、生の数の `variablesReference` は `INVALID_REQUEST`、前の停止の Variables の handle は `stale`、handle は `dv-N` の不透明な文字列
- 片付け（それぞれで fake server のプロセス 0・その port が接続を拒否・その port に確立 / 待ち受けの socket 0）: 正常終了（Continue → 子と root の `terminated`）・Stop（子へ `terminate` → `disconnect`）・子の `terminated`・root の `terminated`・子の接続の切断・adapter のプロセスの異常終了・Workspace switch・アプリ終了
- ready の失敗: 起動直後に exit（75ms で starting → idle）・接続拒否（82ms）・合図を出さない（**10 秒の timeout で idle**）、どれもプロセス 0 でアプリは応答し続ける
- 境界の走査: Renderer が受けた IPC event・invoke の結果・Debug パネルの DOM のどれにも、port・fixture のパス・`127.0.0.1`・`__pendingTargetId` / target id・`startDebugging` / `runInTerminal`・`connectionId` / `child-1` / `/root`・`calc.exe`・絶対パスが無い
- Python（実 debugpy 1.8.21）の回帰（2回目の起動）: breakpoint（main.py:6）・Variables（items）・Evaluate（`len(items)` = 3）・Step Into（helper.py:2）・Continue で完走し Debug Console に出力・loop.py の Pause → Stop・CSP 違反 0・各段で python のプロセス 0
- C#（netcoredbg）の production 回帰は**この Session では行えなかった**（.NET SDK が無く build 済み DLL を作れない・netcoredbg が無い）。unit test の回帰（resolver / profiles / manager）だけ（→ Session 6-17 で netcoredbg と題材を ASCII-only の一時パスに置いて実施した）

#### 確認スクリプトを書くときに踏んだこと（Session 6-15A）

- **境界の走査に、確認スクリプト自身が送った文字列が混ざる。** 終わり方を起こす evaluate の式（`__child_socket_close__`）を fake server が結果に写して返すため、invoke の結果に `socket` が出て FAIL になった（アプリの漏れではない）。走査の前に、自分が送った式だけを取り除く
- **片付けの後に「server 側で socket が閉じた」を server に記録させることはできない**（kill が先に届く）。orphan socket は server の port へ繋いで拒否されること・`Get-NetTCPConnection` で確立 / 待ち受けが無いことで見る。unit test では Main 側の `process.getActiveResourcesInfo()` の `TCPSocketWrap` の数が元に戻ることで見る
- `onStateChange` の idle は片付けで2回届く（`cleanup` の遷移と `current = null` の通知。6-2 からの振る舞い）。「その後に状態が変わらない」を見るときは、回数ではなく片付け直後の配列と比べる

### Session 6-15B（Node.js / vscode-js-debug）

**production build 版 118項目、全項目 PASS。実 vscode-js-debug 1.117.0（公式 release asset）と実 Node.js v24.14.0 で、bundle の差し替えも hook も fake adapter も使っていない**（`npm run build` の `out/` をそのまま起動し、`out/main/index.js` に pin した tree hash が入っていて fixture の名残が無いことも確かめた）。scratchpad で asset を展開した木を、使い捨ての `--user-data-dir` の `debug-adapters/js-debug-dap-v1.117.0/js-debug` へ写しただけ。使い捨ての Workspace 3つ（ws1 / ws2 / ws-python）で、同じ node プロセスから2回起動した（A: node あり / B: PATH から `C:\Program Files\nodejs` を抜き debugpy の venv を足す）。

実装の前に、実 js-debug へ Content-Length フレーミングの DAP を直接送る probe（root → `startDebugging` → 子の接続、breakpoint / step / pause / 例外 / `.mjs` / 子プロセス / stopOnEntry / Stop（running・stopped）/ disconnect + kill / kill だけ）で、ready の行・`startDebugging` の欄・`supportsTerminateRequest: false`・output の category と接続・終わり方の event の順・プロセスの木（server → debuggee → watchdog）が kill だけで 300ms 以内に消えること・js-debug が自分の木へ書かないことを確かめた（§20.24）。

- 面 / 境界: `debug` の関数が22個のまま（adapter / runtime / artifact / port / socket / child / hash を名乗る関数が無い）、build の CSP が source と同じ、CSP 違反 0件、Renderer の console エラー 0件、`process` / `require` / `electron` / `Buffer` の非露出、Workspace に adapter が何も書かない
- Profile: Debug Panel の editor から node の profile を6つ作成（`main.js` に args 2行 + `FX_MODE=verify`・`loop.js`・`throw.js`・`esm.mjs`・`util.cjs`・`app.ts`）。7欄だけが保存される。`app.ts` の Start は `failed` / `invalid-profile` でプロセスが立たない
- 起動: starting → running → stopped、プロセスは `node.exe <userData>\…\dapDebugServer.js 0 127.0.0.1` → `main.js` → `watchdog.js`（adapter の script は Workspace の外）
- Breakpoint / Call Stack / 実行位置: main.js:13 で reason `breakpoint`、js-debug が `verified: true`、thread は子の1本（`main.js [pid]`）、最上段 `global.main`（main.js:13）→ `<anonymous>`（main.js:18）→ node internals は `unavailable`、Editor が main.js を開いて 13 行目に実行位置の印、「Breakpoint で一時停止中」
- Variables / Evaluate / Debug Console: Local の `local` を開いて `inner.value = 42`、handle は `dv-N`、Evaluate `config.nested.list.length + local.inner.value` → `45`、存在しない frame id は `stale`・生の数の `variablesReference` は `INVALID_REQUEST`、Debug Console の入力欄で `config.name.toUpperCase()` → `FLUVIX`、`console.log` / `process.stdout.write` が stdout・`process.stderr.write` が stderr として届き、起動コマンドライン・node の絶対パス・telemetry は届かない
- Step（Toolbar）: Step Into → `add`（main.js:4、`a = 1` / `b = 2`、前の停止の handle は `stale`）→ Step Out → main.js:14 → Step Over → main.js:15、印が毎回追う
- 完走: Continue で idle、印と停止理由と Call Stack が消え、`result 3 2` / `main done alpha beta|--flag verify` と「Debug session ended.」、js-debug server / debuggee / watchdog の node 0・その port が接続を拒否し socket 0・inspector の pipe が残らない
- Pause / Stop: loop.js で Pause → loop.js の中に止まる（js-debug の reason は `step`）→ `ticks > 0` = `true` → Continue で running → Stop で idle・プロセス / port / pipe 0。breakpoint で止まったままの Stop も同じ
- 例外: throw.js の `try` で捕まえた例外では止まらず（`caught one` が先に出る）、捕まえない例外で throw.js:2（`boom`）に reason `exception`、Editor が throw.js を開いて 2 行目に印、「例外で一時停止中」「Error: boom uncaught」、停止理由の画面と snapshot に絶対パス / file URI が無い → Continue で exit、**node が stderr に書く未処理例外（子の `terminated` の後に root から届く）が Debug Console に出る**、プロセス / port / pipe 0
- `.mjs` / `.cjs`: esm.mjs:4 の breakpoint で止まり `n * 7` = `21` → 完走、util.cjs は完走して出力、どちらもプロセス 0
- 外からの終わり方: debuggee を `Stop-Process` → idle・プロセス 0 / js-debug server を `Stop-Process`（停止中）→ idle・印が消える・プロセス 0・アプリは応答し続ける
- 配布物: 置き場所を退避 → Start は `adapter-unavailable` でプロセス 0 / README.md に1バイト足す → `adapter-unavailable` / `bootloader.js` を同じ大きさのまま1バイト変える → `adapter-unavailable` / 戻す → 起動できる
- Workspace 切り替え: breakpoint で止まったまま ws2 へ → idle・印が消える・プロセス / port / pipe 0
- 境界の走査: Renderer が受けた IPC event（status / call stack / breakpoints）・invoke の戻り値・Debug パネルの DOM（console の行を除く）に、`dapDebugServer` / `js-debug` / `debug-adapters` / `bootloader` / `watchdog` / `127.0.0.1` / `__pendingTargetId` / `startDebugging` / `runInTerminal` / `child-1` / `connectionId` / `node.exe` / `Program Files` / `nodejs` / `runtimeExecutable` / hash / userData / port・絶対パス・file URI が無い。Debug Console の行に adapter のコマンドライン / runtime のパス / telemetry / port が無く、絶対パスが出るのは node 自身の未処理例外の stderr 1行だけ（プログラムの出力。§20.9 の例外）
- アプリ終了: loop.js を running のまま `app.close()` → プロセス / port / pipe 0
- B（node が PATH に無い）: node の profile の Start は `adapter-unavailable`・idle・プロセス 0
- Python（実 debugpy 1.8.21）の回帰（B）: breakpoint（main.py:6）・Variables（items）・Evaluate（`len(items)` = 3）・Step Into（helper.py:2）・Continue で Debug Console に `total 7`（root だけのセッションは output を絞らない）・CSP 違反 0・完走 / 終了で python のプロセス 0
- C#（netcoredbg）の production 回帰はこの Session では行えなかった（.NET SDK / netcoredbg が無い。6-15A と同じ）。unit test の回帰（resolver / profiles / manager）だけ（→ Session 6-17 で実施）

#### 確認で見つけて直したもの（Session 6-15B）

- **止まっても Call Stack が空になった → 直すと Variables / Evaluate が `stale` になった。** js-debug はスレッドも最上段の frame も id `0` を振る。Main は thread id（`dapThreads.ts`・thread event）と frame id（`callStack.ts` の handle 表・IPC の形の検査）を「正の整数」で読んでいた。fake adapter / debugpy / netcoredbg はどれも 1 から振るので、unit test と 6-15A までの確認では見えなかった。0 以上の整数に直し、回帰の unit test を足した
- **子の接続の `telemetry`（`js-debug/dap/operation`）が Debug Console に system の行として出た。** `console.ts` の host が `telemetry` を出さないようにした（6-12 の「気づいたこと」の debugpy の2行も消える）

#### 確認スクリプトを書くときに踏んだこと（Session 6-15B）

- **DAP probe で `initialized` を取りこぼす。** 子の `initialize` の応答と `initialized` event が同じ chunk で届くので、応答を await してから listener を付けると子が永久に設定されない（アプリの Deferred は影響を受けない）。listener は request の前に付ける
- **Pause を reason `pause` で待つと FAIL に見える。** js-debug は node internals を抜けてから reason `step` で止まる
- **`fs.cpSync` がこの PC のユーザー名（Unicode）の下で `EIO: Access is denied` になる。** 配布物は readdir + copyFileSync で写す
- **境界の走査に invoke の label を混ぜると FAIL に見える。** label は確認スクリプト自身の説明文（例 `tampered bootloader`）で、走査するのは戻り値だけにする（6-15A の「自分が送った式」と同じ型）
- Main のログは `app.process().stdout` を `main-*.log` へ書き出すと、落ちた確認の原因（どこまで進んだか）がすぐ読める。失敗時に `window.__statuses` / Debug Console / 最後の Call Stack を JSON で吐いておくと、id 0 の不具合はその1回で特定できた

### Session 6-17（STEP 6 Debugger Closing の production app 統合確認）

**production build 版 179項目、全項目 PASS。実 vscode-js-debug・実 debugpy・実 netcoredbg で、bundle の差し替えも hook も mock / fake adapter も使っていない**（`npm run build` の `out/` をそのまま起動し、スクリプト1が bundle に pin した js-debug の tree hash が入っていて hook / fixture の名残が無いことを確かめる）。3本に分けてある ── 落ちたときに「どの言語の話か」を切り分けるため。どれも使い捨ての `--user-data-dir` で `_electron.launch` から起動し、Workspace は `dialog.showOpenDialog` を差し替えて上部バーの Workspace メニューから開いた。操作は Debug パネル（Profile editor / Toolbar / Debug Console）・既定の打鍵・`window.fluvix.debug` からだけ通した。

| スクリプト | 範囲                                                                             | 項目 |
| ---------- | -------------------------------------------------------------------------------- | ---: |
| 1          | Node.js（実 vscode-js-debug 1.117.0）+ Debug keybinding の実測と既知の制約の確認 |   83 |
| 2          | Python（実 debugpy 1.8.21）                                                      |   48 |
| 3          | C#（実 netcoredbg 3.2.0-1）                                                      |   48 |

Session 6-5 / 6-8 / 6-14 / 6-16 はこの節に確認の記録が無かった（6-5 / 6-8 は後の Session の回帰に含まれ、6-14 / 6-16 は production build での確認をしていなかった）。C# と keybinding の production build での確認は、この Session が最初の記録になる。

#### 検証環境（リポジトリにも、システムの PATH / レジストリにも何も入れていない）

| 対象            | 取得元                                                                                                    | 版                            | 確かめ方                                                                                                                                 | 置き場所                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| vscode-js-debug | 公式 GitHub Release `microsoft/vscode-js-debug` の `js-debug-dap-v1.117.0.tar.gz`（6-15B で取得したもの） | 1.117.0                       | asset の SHA-256 `ad8d04ed…0772`・展開した木の tree hash `fdda8ebf…4933`（60 ファイル）がアプリの表と一致                                | 作業用ディレクトリで展開 → 使い捨ての userData の `debug-adapters/js-debug-dap-v1.117.0/js-debug` へ写す |
| Node.js         | システム                                                                                                  | v24.14.0                      | —                                                                                                                                        | `C:\Program Files\nodejs`                                                                                |
| debugpy         | PyPI（`pip install debugpy`。6-12 で作った venv）                                                         | 1.8.21 / CPython 3.14.7（uv） | venv の python で `import debugpy` の版                                                                                                  | 作業用ディレクトリの venv。起動する Electron の PATH の先頭にだけ `Scripts` を足す                       |
| netcoredbg      | 公式 GitHub Release `Samsung/netcoredbg` の `3.2.0-1092` / `netcoredbg-win64.zip`                         | 3.2.0-1（`9744e1f`）          | SHA-256 `3c410a45fa502415203a94fcb88654af65bf8e3dac158a5527a722e7a6b9274a` が GitHub の asset の `digest` と一致・`netcoredbg --version` | **ASCII-only の一時パス** `D:\fx617\tools\netcoredbg`。起動する Electron の PATH の先頭にだけ足す        |
| .NET            | runtime はシステム（`C:\Program Files\dotnet`・8.0.13）、SDK は STEP 5 で一時ディレクトリに置いた 8.0.424 | —                             | —                                                                                                                                        | 題材 `D:\fx617\ws-cs`（net8.0 の Console。`dotnet build` の DLL / PDB を source の隣に）                 |

作業用ディレクトリ（`%TEMP%` の下）はユーザー名が Unicode なので、netcoredbg と C# の題材だけは ASCII-only の `D:\fx617` に置いた。確認の後も一時パスとして残してあり、リポジトリとは無関係。

#### 測ったこと

スクリプト1（Node.js + keybinding）:

- 面 / 境界: `window.fluvix.debug` が22関数（adapter / spawn / process / request / dap / runtime / port を名乗る関数が無い）、`process` / `require` / `electron` / `Buffer` / `module` / `ipcRenderer` の非露出、build の CSP が source と同じ、ステータスが「待機中」
- Profile: editor から3つ作成（7欄だけが保存される）
- **F9**（Editor に focus・カーソルが 13 行目）で breakpoint が入り glyph が描かれる → もう一度で外れる → もう一度で1件だけ戻る
- **F5**（idle・Profile 選択済み）で starting → running → stopped、プロセスの木は userData の配布物の js-debug server + debuggee + watchdog、main.js:13 に reason `breakpoint`・verified、Editor の実行位置の印、停止理由の画面、Call Stack の画面（相対位置・実行位置は1つ・node internals は unavailable）
- Variables（画面 + `local.inner.value = 42` を `dv-N` の handle で）・Evaluate（`45`・未知の frame は `stale`・生の数の `variablesReference` と `hover` の文脈は INVALID_REQUEST）・Debug Console の入力欄（`FLUVIX`）と stdout / stderr の出力
- **F11**（add:4・`a = 1` / `b = 2`・前の停止の handle は `stale`）→ **Shift+F11**（main へ戻る）→ **F10**（次の行・印が追う）→ **F5**（Continue で完走・印 / 停止理由 / Call Stack が消え、出力と「Debug session ended.」）
- Toolbar の Pause → `ticks > 0` → **F5**（running へ）→ **Shift+F5**（running の Stop）/ breakpoint で止まったまま **Shift+F5**
- **既知の制約の実測**（下記）
- 例外: throw.js の捕まえない例外だけで止まる（捕まえた方の出力が先）・Editor が追う・停止理由に `boom uncaught`・絶対パスが無い → F5 で完走し node の stderr が Debug Console に届く
- 配布物の `bootloader.js` を同じ大きさのまま1バイト変えると `adapter-unavailable` でプロセスが立たない
- Workspace 切り替え（止まったまま）・アプリ終了（running のまま）

スクリプト2（Python）:

- 面 / 境界・ステータス・Profile の作成（`PYTHONPATH` の環境変数と Workspace の外の program は値で `invalid`）
- Toolbar の Start → main.py:6 に reason `breakpoint`・verified・Editor の印・Call Stack の画面（`main` → `<module>`）・Variables（`items = [1, 2, 3]` を展開）・Evaluate（`len(items) * 10` = 30）・Debug Console の入力欄（`sum(items)` = 6）
- Step Into（helper.py:2）→ Step Over（helper.py:3・`doubled = 6`）→ Step Out（main へ）→ Continue で完走し `total 7 verify`
- Pause（reason `pause`・「手動で一時停止中」・`count > 0` = `True`）→ Continue → Stop
- 例外: 捕まえた KeyError では止まらず、FileNotFoundError（exc.py:9）で止まる・停止理由のメッセージに `no_such_dir` が残り絶対パス / file URI が無い（伏せられている）・breakMode が出る → 止まったまま Stop
- Workspace 切り替え（止まったまま。ws2 に ws1 の Profile が見えない）・アプリ終了（running のまま）・**Workspace に置いた `debugpy/__init__.py` が一度も読み込まれない**・Workspace に増えたのは CPython の `__pycache__` だけ

スクリプト3（C#）:

- 面 / 境界・ステータス・Profile の作成（`Program.cs` を指す Profile の Start は `invalid-profile`）
- **F5** → プロセスは `netcoredbg --interpreter=vscode`（ASCII の install dir）+ `dotnet Probe.dll`（引数は Profile のまま）→ Program.cs:25 に reason `breakpoint`・止まった時点で breakpoint が verified・Editor の印・Call Stack の画面
- Variables（`label = "fluvix"`・`items` を展開）・Evaluate（`items.Count + 1` = 4）・Debug Console の入力欄（`label.ToUpper()` の結果に `FLUVIX`）・breakpoint の前の stdout
- **F11**（Add）→ **Shift+F11**（Main へ）→ **F10**（後の行・印が追う）→ **F5** で完走し `result 7` / `args alpha beta|--flag mode verify`
- 例外（`user-unhandled`）: 捕まえた例外では止まらず、Boom の Program.cs:17 で止まる・型名 `InvalidOperationException`・メッセージ `boom uncaught`・breakMode `unhandled`・絶対パスが無い → Continue で idle
- Pause（reason `pause`。最上段は `Thread.Sleep` で unavailable、その下に Program.cs:35 の Main）→ Stop
- **Unicode path の Workspace（`ws-ユニコード`）では Start が `adapter-unavailable` でプロセスが立たない**
- Workspace 切り替え（止まったまま）・アプリ終了（running のまま）・Workspace のファイル一覧と大きさが前後で同じ
- 2回目の起動: PATH に netcoredbg が無いと Start は `adapter-unavailable`・idle・プロセス 0

3本に共通:

- **片付け**: 完走・Stop・Workspace 切り替え・アプリ終了のそれぞれの後に、adapter と debuggee のプロセスが 0（node は js-debug server / debuggee / watchdog と、その port が接続を拒否すること。python は venv / uv の python。C# は netcoredbg と `dotnet Probe.dll`）。最後に Fluvix Nexus の electron も残らない
- **Security boundary**: Renderer が受けた IPC event（status / call stack / breakpoints）・invoke の戻り値・Debug パネルの DOM とステータスバーに、絶対パス・file URI・UNC・adapter / runtime の実行ファイル名・adapter の引数・port・`__pendingTargetId` / `startDebugging` / `runInTerminal` / `connectionId`・userData・`variablesReference` が無い。Debug Console に絶対パスが出るのはプログラム自身の出力（node / dotnet の未処理例外の stderr）だけ（§20.9 の例外）
- CSP 違反 0件・Renderer の console エラー / page error 0件

#### 既知の制約の実測（Debug keybinding は Debug パネルが前面のときだけ）

スクリプト1で、main.js:13 に止まったまま Files のタブを前面にし（Debug Toolbar が DOM から消えることを確認）、F10 / F11 / Shift+F11 / F5 / Shift+F5 を1つずつ押して 1.2 秒待った。**どれも状態（stopped）も停止の通し番号も変えなかった。** 同じ状態で F9 は 15 行目に breakpoint を入れて外せた（Editor の器の command）。Debug のタブを前面に戻すと F10 で 14 行目へ進み、Shift+F5 で終わった。idle で Files を前面にしたまま F5 を押しても起動しなかった（プロセス 0）。docs/ARCHITECTURE.md §20.26 の記述どおりで、STEP 6 v1 の既知の制約として記録してある。

#### 確認スクリプトを書くときに踏んだこと（Session 6-17）

どれもアプリの不具合ではなく**測り方の側の問題**だった。1回目の実行で2つの FAIL が出て、どちらも直した後に全体を走らせ直している。

- **このマシンのアプリは日本語で起動する。** 停止理由の画面を `/manually/` で待つと「手動で一時停止中」に当たらず FAIL になった（snapshot の `stop.reason` は `pause` で正しかった）。文言で判定するなら両言語を書くか、reason を snapshot で見る
- **breakpoint の glyph の class は `fx-breakpoint`**（`fx-breakpoint--verified` など）。`fx-debug-*` で探すと「glyph が描かれない」に見える。`fx-debug-*` なのは実行位置の印（`fx-debug-execution-line` / `-glyph`）のほう
- **F9 は Editor に focus があるときだけ効く。** `.view-lines` の中を本物の click で押し、`document.activeElement` が `[data-panel-body="editor"]` の中に入るまで待ってから押す（`editorFocused` は DOM の focus で決まる）
- **Files のタブを前面にすると Debug Toolbar ごと外れる。** 戻した後に F5 を押す確認では、Profile の選択を持ち越す前提にせず選び直してから押す
- **netcoredbg の Pause は最上段が `System.Threading.Thread.Sleep()`（unavailable）になる。** 最上段の位置で待たず、stack の中に Main の frame があるかで見る
- **netcoredbg の breakpoint は `setBreakpoints` の応答の時点では verified が false のことがある**（Session 6-14 の調査。module の読み込みの後の `breakpoint` event で true になり、Main がそれを当てる）。verified は止まった後に読む
- **C# の題材は Workspace の中で build する。** PDB に書かれた source path と Workspace の Program.cs が一致しないと breakpoint が pending のまま止まらない。題材も netcoredbg も ASCII-only のパスに置く

### Session 7-1A（Debug command 所有の修正）

Session 6-17 で実測した「F5 / Shift+F5 / F10 / F11 / Shift+F11 は Debug パネルが前面のときだけ効く」は、Session 7-1A で解消した。Profile の一覧・選択・実行 command の正本を `DebugToolbar` から `DebugProvider` へ移し、`DebugProvider` を `App.tsx` の `WorkspaceFolderProvider` 内側 / `KeybindingProvider` 外側に置いた。これで Debug パネルが mount / unmount されても Profile 選択と実行 command が残る。

この Session では Debug の IPC / preload / Main / adapter catalog / CSP は変えていない。Toolbar は現在も Debug パネル内の表示と Profile editor を持つが、F5 系 command の所有者ではない。

### Session 7-1B（Panel state persistence / Git layout）

Session 7-1B では、Panel の mount / unmount で失うべきでない Renderer 状態を Shell 側の Provider へ出した。

- Files ツリーの展開状態は `FileTreeStateProvider` が Workspace ごとに持つ。Files パネルを閉じる / 別パネルを前面にする / 再表示するだけでは展開状態を失わない
- Git commit message draft は `GitDraftProvider` が Workspace ごとに持つ。Git パネルを閉じる / 再表示するだけでは下書きを失わない
- Git パネルの狭い幅では、操作ボタンや行の文言がはみ出さないよう折り返し / 省略の CSS を調整した

この Session では Main / preload / shared / Security boundary は変えていない。

### Session 7-1C（Debug adapter の案内 / ログファイルの production 確認）

`npm run build` した out/ をそのまま（bundle の差し替え無し）、`_electron.launch` に `--user-data-dir=<一時フォルダ>` を渡して起動した。利用者の本物の userData には触れていない（確認後に `logs` が作られていないことも見た）。**98 項目すべて PASS**。

- **案内（ja）**: Debug Toolbar で Profile を作り、Start を押して `.fx-debug-toolbar__message` を読んだ。Main の `process.env.PATH` を `app.evaluate` で差し替え、中身の無い `node.exe` / `netcoredbg.exe` と改変した配布物を置いて、node（PATH に無い / 配布物が無い / 配布物が違う / Workspace の中の node.exe）・python（PATH に無い）・csharp（netcoredbg が無い / ASCII 以外のパス）の7通りで、それぞれの文言が出ること・IPC の戻り値が `status / reason / language / cause` の4欄だけでパスを含まないこと・Debug Session が始まらないこと。`program-not-found` の文言と戻り値は変わっていない
- **案内（en）**: `settings.json` を English にして起動し直し、node（配布物が無い）と csharp（ASCII 以外）の英語の文言
- **ログ**: 前回ぶんの 1.1 MiB の `main.log` を置いて起動 → それが `main.old.log` になり新しい `main.log` から始まる・先頭が版 / Electron / platform / pid だけの見出し・全行が日時付きの INFO / WARN / ERROR（DEBUG 無し）・`workspace opened: <path>` と7通りの `adapter-unavailable (<language>: <cause>)`・配布物の `is not usable (missing / hash-mismatch): <path>`・**一時フォルダ / Workspace / ユーザー名（Unicode）/ `USERPROFILE` / コンピューター名 / `System32` / ドライブ付きのパス / adapter のコマンドラインが1つも無い**。console には従来どおり生のパスが出る。2回目の起動で見出しが2つになり、前の行はそのまま残る
- **書けないとき**: userData の `logs` をファイルにして起動 → 起動時に1度だけ警告が出てアプリは動き続ける（起動直後の出力は `_electron.launch` では拾えないので、`spawn` で直接起こして数えた）。起動中に `logs` をファイルへ差し替え → 警告は1度だけで、その後もログの行が出る操作と IPC が普通に通り、差し替えたファイルは書き換えられない
- **境界**: `window.fluvix.debug` は22関数のまま・`window.fluvix` にログ / ファイルシステムの口は無い・`process` / `require` / `electron` / `ipcRenderer` は undefined・build 後の CSP は source と同一で違反 0件。**Renderer の `fetch('file:///…')` はログも `C:\Windows\win.ini` も読めた**（既存の性質。docs/ARCHITECTURE.md §4 の既知の制約）

### Session 7-1D（Documentation Synchronization）

Dogfooding B6（ドキュメントと実装の食い違い）への対応。対象は DESIGN.md / docs/ARCHITECTURE.md / docs/DEVELOPMENT.md の現在状態だけで、Renderer / Main / preload / shared のコードは変更しない。

同期する主な現在仕様:

- STEP 6 Debugger は完了済み。Node.js / Python / C# adapter、Debug Console、Debug command / keybinding は実装済み
- F5 / Shift+F5 / F10 / F11 / Shift+F11 の所有者は `DebugProvider`。STEP 6 Closing 時点の「Debug パネル前面だけ」は現在仕様では解消済み
- Node.js の vscode-js-debug は `userData/debug-adapters/js-debug-dap-v1.117.0/js-debug` に利用者が置く。アプリは asset / tree hash を検証し、失敗時は `adapter-unavailable` を固定 cause で返す
- Main のログは `userData/logs/main.log`（1 MiB + `main.old.log` 1世代）。Renderer にログ API は無く、ファイル出力では絶対パスと認証情報を伏せる
- 現在残っている v1.0.0 Release 前の問題は DESIGN.md §14 / docs/ARCHITECTURE.md §20.28 を正とする

### Session 7-2A（v1.0.0 Release metadata）

v1.0.0 の配布仕様とメタデータを確定した。electron-builder の導入と installer の生成は 7-2B。Renderer / Main / preload / shared のコードと security boundary は変えていない。

- `package.json`: version `1.0.0`・author `Piroshi`・license `MIT`・`notices` / `notices:check` を追加し、`verify` に `notices:check` を入れた（`package-lock.json` の root の version / license も合わせた）
- ルートに `LICENSE`（MIT）・`README.md`（利用者向け）・`THIRD_PARTY_NOTICES.txt`（`tools/third-party-notices.mjs` が生成）を追加
- `docs/RELEASE.md` を新設: 確定事項・Session 7-2 の分割・変えてはいけない識別子・第三者ライセンスの決め方・electron-builder の設計（7-2B で実装）・アイコンの方針・公開前の確認（7-2A 時点の結果と再確認の手順）・Release notes の項目・installer の確認項目
- 決めたこと: appId `studio.fluvix.fluvixnexus`・NSIS / per-user / x64・repository は v1.0.0 公開時に Public・自動更新 / コード署名 / adapter の自動取得は含めない・Renderer の `file://` 読み込みは v1.0.0 の既知の制約

### Session 7-2B（electron-builder / ローカル installer）

docs/RELEASE.md §5 の設計どおりに electron-builder を入れ、ローカルで installer を作った。GitHub Release への公開と tag はしていない。Renderer / Main / preload / shared のコードと security boundary は変えていない。

- `package.json`: devDependencies に `electron-builder` 26.15.3（完全一致）・`dist` script（`npm run build && electron-builder --win nsis --x64 --publish never`）
- ルートに `electron-builder.yml`: appId / productName / copyright・出力 `release/`・`files` は `out/**` と `package.json`（`@lydell/node-pty-win32-x64/*.pdb` を除く）・`asar: true`・`asarUnpack: node_modules/@lydell/**`・`npmRebuild: false`・`extraResources` に `LICENSE` / `THIRD_PARTY_NOTICES.txt`・NSIS oneClick / per-user / x64・`deleteAppDataOnUninstall: false`・`artifactName: Fluvix-Nexus-Setup-${version}.${ext}`・`publish: null`
- アイコンは書いていない（素材が無い。Electron の既定アイコン）。正式アイコンは 7-2E の公開前
- 確認: `out/` と `release/` を消して `npm ci` → `npm run dist` → 生成物を調べた（結果の表は docs/RELEASE.md §5.5）。installer の payload は 7-Zip（electron-builder の Cache のもの）で一覧し、`app.asar` は `@electron/asar` で一覧した
- smoke: scratchpad の playwright-core の `_electron.launch` に `release/win-unpacked/Fluvix Nexus.exe` と使い捨ての `--user-data-dir` を渡し、`workspace-folder.json` を先に置いて Workspace を復元させた。Main（isPackaged / appPath）・webPreferences・Renderer の境界と CSP・`window.fluvix.terminal` の listShells → create → write → dispose・`main.log` を読んだ。IPC の戻り値は `{ ok, data }` なので `data` を読む（読み違えると `session` が undefined でアプリの不具合に見える）
- `npm audit`: `--omit=dev` は 0 件。全体では 4 件（low 1 / moderate 3）で、Renderer にバンドルされる monaco-editor 経由の `dompurify` を含む（7-2C 以降へ引き継ぎ。7-2B では依存を上げていない）

### Session 7-2C（installer で入れたアプリの検証）

7-2B の installer をこの PC に per-user で入れ、インストール先の exe で全機能を確かめた（結果の表は docs/RELEASE.md §8.1）。Release blocker は無く、コード・`electron-builder.yml`・installer は変えていない。tag と GitHub Release は作っていない。

- 起動は scratchpad の playwright-core の `_electron.launch` に `%LOCALAPPDATA%\Programs\fluvix-nexus\Fluvix Nexus.exe` と使い捨ての `--user-data-dir` を渡す（PROJECT の引数は付けない）。STEP 6 Closing の Debug 確認スクリプトは、起動先と「CSP / bundle を `app.asar` から読む」部分だけ差し替えて流用した。`app.asar` は `@electron/asar` の `extractFile` に `path.join('out', …)` で渡す（`/` 区切りだと not found）
- 6-17 の Node.js スクリプトにあった「Debug パネルが背面だと F5 系が効かない」確認は、Session 7-1A で解消した制約なので現在仕様（背面でも効く）の確認へ置き換えた
- `app.process().pid` は Main と一致しないことがある。Main の子プロセスを数えるときは、`Fluvix Nexus.exe` のうち `--type=` を含まず CommandLine に userData のパスを含むものを CIM で探す
- node-pty の `fork` 経路は一瞬で終わるためプロセスとしては捕まえにくい。シェルで `ping -n 600` を起こしてタブを閉じ、孫まで消えるかで確かめた
- 既定の `%APPDATA%\Fluvix Nexus` は消さない（開発版と共有していて、利用者の Workspace を復元する）。インストール直後の起動で増えたのは `logs` だけで、既存の JSON は変わっていない
- 使い捨ての Workspace は `D:\fx72c`（C# の題材を ASCII のパスで build するため）

### Session 7-2D（clean Windows 相当の最終確認 / Release notes）

7-2B の installer（7-2C と同じ hash）で、この PC で確かめられる clean Windows 相当の項目を確認し、Release notes を `docs/release-notes/v1.0.0.md` に確定した（結果の表は docs/RELEASE.md §8.2）。コード・`electron-builder.yml`・依存は変えていない。正式アイコン・tag・GitHub Release・repository の公開は 7-2E。

- **ダウンロード済みの印（MOTW）の付け方:** installer の写しを `Downloads` に置き、`Zone.Identifier` ストリームに `ZoneId=3` を書く。Explorer（`explorer.exe <file>`）/ Shell の `InvokeVerb('open')` から起こす。**一度実行すると Windows がストリームを消す**ので、2回目以降の確認では書き直すこと（書き直さずに「警告が出ない」と読むと確認になっていない）
- **ツールが無い PC の再現:** Main へ渡す PATH を System32 / Windows / Wbem / PowerShell / OpenSSH / WindowsApps だけにするのに加え、**`ProgramFiles` / `ProgramW6432` / `ProgramFiles(x86)` を存在しないフォルダへ向ける**。Git と GitHub CLI は PATH に無くても `%ProgramFiles%\Git\cmd` などを探す（`src/main/git/gitExecutable.ts`）ため、PATH だけ削ると Git が見つかってしまう。.NET は `C:\Program Files\dotnet` を固定で見るので、この PC では「.NET が無い」は再現できない
- WindowsApps の `python.exe` は Store へ誘導するスタブ（終了コード 49）。clean な Windows 11 にもあり、Debug は正しく `python: runtime-not-found` を返す
- C# の LSP の状態は `.cs` を Editor で開くまで `stopped` のまま（`unavailable` にならない）。3言語を読むときは各言語のファイルを開いてから `lsp.getStatus` を読む
- `git.getRepository()` の `data` は `{ workspaceId, repository: { status } }`。`data.status` を読むと undefined で FAIL に見える
- 同じ userData を使い回すと `main.log` に前の起動の ERROR / WARN が残る。「ERROR 0件」を測るなら起動ごとに userData を分ける
- タスクバーのボタンは「結合しない」設定（`TaskbarGlomLevel=2`）だと AutomationId が `Window: 0x…` になり AppID が読めない。ピン留めを UI Automation で押す確認は、利用者のデスクトップで作業中の窓を奪うため途中でやめた（§8.2）
- 使い捨ての Workspace / userData は `D:\fx72d`、TypeScript の LSP の確認用 prefix は scratchpad の `npmg`（TypeScript 7.0.2）/ `npmg6`（6.0.3）

### 正式アイコンの組み込み（7-2D の後）

`resources/icon.png`（利用者が確定した原本）から `tools/generate-app-icon.ps1` で `resources/icon.ico` を作り、`electron-builder.yml` の `win.icon` に設定した。その後、原本を修正版（背景透過の RGBA）に差し替え、同じ手順で `icon.ico` と installer を作り直した。結果の表は docs/RELEASE.md §5.3。

- **`tools/generate-app-icon.ps1` は UTF-8 の BOM 付きで保存する。** Windows PowerShell 5.1 は BOM の無いスクリプトを CP932 で読み、日本語のコメントが後ろの改行や引用符を巻き込んで壊れうる
- `System.Drawing.Icon(path, 256, 256).ToBitmap()` は PNG 圧縮の 256 エントリを読めず 64 px を返す。256 の確認は該当エントリを PNG として直接デコードする
- exe に入ったアイコンの確認は、`ExtractAssociatedIcon` の見た目ではなく PE の RT_GROUP_ICON / RT_ICON を読んで `icon.ico` の各エントリとバイト比較した。素の `electron.exe`（`%LOCALAPPDATA%\electron\Cache` の zip から取り出す）で「不一致」になることも確かめておく
- **`/S`（silent）で入れても installer は完了後にアプリを起動する**（既定 userData）。確認後は窓を閉じてから `Uninstall Fluvix Nexus.exe /currentuser /S` で片付ける

### Session 7-2E（v1.0.0 公開の準備と公開後の確認）

公開する直前まで（公開前の再確認・`SHA256SUMS.txt`・Release notes の不具合の報告先・`v1.0.0` tag）を済ませ、利用者が Public 化と Release の公開を行った後に、未認証の API とダウンロードで公開物を確かめた。結果・決定・公開の手順は docs/RELEASE.md §9。コード・`electron-builder.yml`・依存・installer は変えていない。

- **installer を作り直さずに中身を確かめる:** electron-builder の cache にある `7za.exe`（`%LOCALAPPDATA%\electron-builder\Cache\7zip@1.0.0\…\bin\7za.exe`）で NSIS installer をそのまま展開でき、`win-unpacked` と同じ木が出る。`app.asar` は `node_modules/@electron/asar/bin/asar.js extract` で展開して `out/` と `diff -rq` する。`app.asar.unpacked` の `@lydell/node-pty/package.json` が `node_modules` のものと違うのは electron-builder がフィールドを落とすためで、差ではない
- **commit の e-mail:** このリポジトリの `.git/config` に `user.email = 272251618+thpiroc@users.noreply.github.com` を設定した（`--global` は変えていない）。別の clone で作業するときは同じ設定を入れる
- **Release notes の HTML コメントの中に `<!--` / `-->` を書かない。** コメントがそこで閉じ、Prettier が後ろの行を本文として整形する
- **公開後の確認は認証を付けずに行う。** `api.github.com/repos/<owner>/<repo>`（`visibility`・`has_issues`）と `/releases/latest`（`draft`・添付の `size` / `digest`）を curl で読み、`releases/download/v1.0.0/<file>` から落として照合した。Private のうちは API が 404 を返すので、公開前の状態の確認にもなる。`Invoke-WebRequest` で落としたファイルには MOTW が付かないので、SmartScreen の確認にはならない

---

## 5. 進め方

実装は「Session 1-1」「Session 1-2」のような番号付きセッション単位で進める。各セッションではその範囲だけを実装し、完了したら次へ進まずに停止する。次のセッションで実装する箇所には、コード中に継ぎ目（コメント）だけ残しておく。

### Notion MCP（feature/notion-mcp）

MCP 共通の土台と Notion MCP（同梱・許可リストの環境・tools/call・書き込みの確認）を入れ、実 Notion で接続・検索・取得・書き込み（テスト用ページの末尾に段落1つ）・再取得までを確かめた。設計は docs/ARCHITECTURE.md §21。UI と Settings はまだ無いので、確かめるのは `window.fluvix.mcp.*` を Renderer から直接呼ぶ形になる。

- **token を画面にもログにも出さない。** 有無は PowerShell で `[bool]($env:FLUVIX_NOTION_MCP_TOKEN)` のように真偽値だけを見る。確認スクリプトの出力・アプリの `main.log` は、表示する前に `.Contains($env:FLUVIX_NOTION_MCP_TOKEN.Trim())` で照合し、含まれていたら表示しない
- **vitest の中から実物を起動すると `BASE_URL=/` が付いてくる。** Vite がテストのプロセスに入れる。Notion MCP サーバーはこれを API の接続先として読むので、環境変数を許可リストにする前は `Invalid URL` で落ちた。今は子へ渡らないので、そのまま確かめてよい
- **配布物で確かめるときは Node を PATH から外す。** `release/win-unpacked/Fluvix Nexus.exe` を `_electron.launch({ executablePath, args: ['--user-data-dir=…'] })` で起こし、PATH を `C:\Windows\System32;C:\Windows` にしても同梱のサーバーが立つこと（アプリ自身の exe を `ELECTRON_RUN_AS_NODE=1` で起動する）を見る
- **子プロセスに渡った環境は、Main の `child_process.spawn` を包んで名前だけ控える。** `app.evaluate(() => { const cp = process.mainModule.require('child_process'); … })`。親の環境に架空の `GITHUB_TOKEN` / `OPENAI_API_KEY` / `BASE_URL` を入れておき、名前の一覧に出ないことを見る（値は控えない）
- **書き込みの確認ダイアログは `dialog.showMessageBox` を差し替えて答える。** 先に「キャンセル」（response 1）で何も書かれないことを確かめてから、「実行する」（response 0）で1回だけ書く。出た文言は差し替えた関数の中で控える
- **Notion のエラーは `isError` の無い普通の結果で返る。** 存在しない UUID で `get-page` を呼ぶと `tool-error` / `{ status: 404, code: 'object_not_found' }` になる（読み取りだけで、エラーの分け方を確かめられる）
- **`npm run dist` は `release/` を上書きする。** 公開済み v1.0.0 の手元の写し（`SHA256SUMS.txt` と照合する installer）が置き換わる。配布物で確かめる前に `release/` を確かめ、写しを残したいなら出力先を分ける
- 一時 userData のパスに利用者名（日本語）が入るので、PowerShell 5.1 で読むときは `Get-Content -Encoding utf8` を付ける（付けないとパスが化けて「無い」と読む）

### 複数の Agent で進めるときの作法（Session 6-0 で確定）

STEP 5 以降、実装を Claude Code と Codex の両方で進めている。**同じ working tree で並行実装はしない。**

STEP 5 の実測では、LSP の機能追加5 Session（5-5 〜 5-9）が次の9ファイルを**全員触っていた** ── `shared/ipc/channels.ts`・`shared/ipc/contracts/lsp.ts`・`shared/ipc/index.ts`・`shared/api.ts`・`shared/lsp/index.ts`・`preload/api/lsp.ts`・`main/ipc/handlers/lsp.ts`・`renderer/src/editor/monaco/monacoSetup.ts`・`renderer/src/editor/useEditorSession.ts`。機能を1つ足すたびに、同じ表の末尾へ1行ずつ増える構造になっているため、並行させると必ず衝突する。

したがって運用は次で固定する。

| 項目             | 決めたこと                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| 担当の単位       | **1 Session = 1 Agent**                                                                |
| 引き継ぎの手順   | `npm run verify` を通す → Commit → Push → 次の Agent へ渡す                            |
| 引き継ぎの単位   | Session（= 1 commit）。**push していない commit を残さない**                           |
| ドキュメント     | Closing まで溜めない。**各 Session の commit に、決めたことを最小限で残す**            |
| 途中で止まるとき | `wip/session-x-y` へ退避し、①確定した設計判断 ②触りかけの横断ファイル ③次の一手 を残す |

次の Agent が読めるのは **push 済みの main と、そこに入っているドキュメントだけ**になる。会話の連続性が引き継ぎを埋めてくれないため、docs の追従を Closing まで遅らせないことがこの運用の要になる。

---

## 6. exe 化に向けて残っている作業

**v1.0.0 の配布仕様・electron-builder の設計・Release の手順は [docs/RELEASE.md](RELEASE.md) を正とする**（Session 7-2A）。この節は STEP 1 から積み上げてきた前提の記録として残す。

STEP 1 では **`electron-builder` の導入は行わず、準備だけ**を済ませている。

済んでいること:

- `package.json` に `productName`（`Fluvix Nexus`）を設定。アプリ名と `%APPDATA%` 配下の保存先がこの名前になる
- `electron` を `devDependencies` へ移動（`electron-builder` は electron 自体をアプリの依存として同梱しない）
- ビルド成果物を `out/main` `out/preload` `out/renderer` に分離済み
- ユーザーデータの保存先を `app.getPath('userData')` に統一（インストール先に書き込まない）
- Main のログを `%APPDATA%\Fluvix Nexus\logs\main.log`（上限 1 MiB + `main.old.log` の1世代）に残す（Session 7-1C。docs/ARCHITECTURE.md §4）。配布版で問題が起きたら、このフォルダの2ファイルを受け取る。絶対パスと認証情報は書き出す前に伏せてある

- `package.json` の version `1.0.0`・`author`・`license`、`LICENSE`・`README.md`・`THIRD_PARTY_NOTICES.txt`（Session 7-2A）
- `appId`（`studio.fluvix.fluvixnexus`）と installer の形（NSIS / per-user / x64）の決定（Session 7-2A。docs/RELEASE.md §1）

- `electron-builder`（26.15.3）・`electron-builder.yml`・`npm run dist` でローカルに NSIS installer を作れる（Session 7-2B。docs/RELEASE.md §5.5）

残っているもの（設計は docs/RELEASE.md §5〜§8）:

- installer で入れたアプリの確認: この PC（7-2C）と、この PC でできる clean Windows 相当の確認（7-2D）は完了。別 PC / VM でしか確かめられない項目は docs/RELEASE.md §8.2 の未確認事項に残した
- Release notes の原稿: `docs/release-notes/v1.0.0.md`（7-2D）。不具合の報告先（GitHub Issues）と `SHA256SUMS.txt` は 7-2E で済ませた
- `electron-builder.yml` を触るときに外してはいけないこと（Session 7-2B で入れた）
  - **`dependencies` を同梱する必要がある。** Session 3-7-1 で `@lydell/node-pty`（native モジュール）が入り、これが最初の `dependencies` になった。`externalizeDepsPlugin` により Main のバンドルには含まれないため、`node_modules` 側の実体が要る。electron-builder は既定で `dependencies` を拾うが、`files` を絞り込む場合はここを外さないこと
  - prebuilt はプラットフォームごとに別パッケージ（`@lydell/node-pty-win32-x64` など）として入る。`optionalDependencies` 経由なので、**ビルドする OS / アーキテクチャのものしか入っていない**
  - installer では `node_modules/@lydell/**` を asar の外へ出し、`.pdb` は同梱しない（docs/RELEASE.md §5.4）
- GitHub Releases: v1.0.0 は 7-2E で公開済み（https://github.com/thpiroc/FluvixNexus/releases/tag/v1.0.0。docs/RELEASE.md §9.5）
- 自動更新（`electron-updater`）と、コード署名 / SmartScreen 対策は v1.0.0 に含めない（Session 7-2A。DESIGN.md §7.5）
