# 開発ガイド

> 対象: Session 3-8-14（ブランチの削除 / rename）完了時点
> 最終更新: 2026-08-27

---

## 1. 必要な環境

- Node.js（`npm` 同梱）
- Windows 11（v1 の開発対象）

依存はすべて `npm install` で入る。Node.js / Python / .NET SDK 本体はアプリに同梱しない方針のため、LSP / Terminal を実装する STEP 以降は PC 側にインストールされたものを検出して使う。

---

## 2. コマンド

| コマンド               | 内容                                                      |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | 開発起動（Vite dev server + Electron、HMR あり）          |
| `npm run build`        | `out/` へビルド                                           |
| `npm run typecheck`    | 型検査（Main/Preload/shared と Renderer/shared を別々に） |
| `npm test`             | ユニットテスト（1回実行）                                 |
| `npm run test:watch`   | ユニットテスト（監視）                                    |
| `npm run format`       | Prettier で整形                                           |
| `npm run format:check` | 整形漏れの検査                                            |
| `npm run verify`       | `format:check` → `typecheck` → `test` をまとめて実行      |

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
- `src/main/store/editorSettingsDocument.test.ts` — **Editor 設定文書の検証**（Main が見る範囲。意味は見ない）
- `src/main/store/filesSettingsDocument.test.ts` — **Files の見え方の文書の検証**（同上。知らない mode も桁外れの幅も形として通し、意味は Renderer が決める）
- `src/main/store/terminalSettingsDocument.test.ts` — **Terminal の見え方の文書の検証**（同上。範囲の外の px も行数も形として通し、丸めるのは Renderer）
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
- `src/main/git/gitOutput.test.ts` — **git の出力の読み取り**（区切り文字 / 大小 / 末尾の違いを吸収すること・**サブフォルダを root と混同しないこと**・16進でない commit を読まないこと・ブランチの一覧を印から読むこと・**上限で切ったことを伝える**こと・読めない行だけを落とすこと）
- `src/main/git/gitStatusOutput.test.ts` — **`status --porcelain=v2 -z` の読み取り**（staged / unstaged / untracked / rename / copy / 削除 / 衝突・**日本語 / 空白 / 引用符 / 改行を含む名前**・upstream と ahead / behind・**知らない形を途中まで読んだ結果として返さないこと**・Workspace の外を指す path を受け付けないこと）
- `src/main/git/gitStatusRepository.test.ts` — **本物の git に対する読み取り**（一時リポジトリを作って実際に `git status` を動かす。下記のとおりここも実ディスクを使う）
- `src/main/git/gitFailure.test.ts` — **stderr の分類**（所有者・作業ツリー・権限を見分けること・**知らない文章を近い分類へ寄せないこと**・「リポジトリではない」を失敗の表に入れないこと・書き込み操作の分類では `index.lock` を pathspec より先に採ること・**Commit では終わり方の形で hook を見分けること**（`fatal:` 無しの 1 は hook）・hook の出力に混ざった `permission denied` を git の権限エラーにしないこと・**ブランチでは作業ツリーの理由を「見つからない」より先に採ること**（断り方に名前が入る）・worktree の断りを「同じ名前がある」と読み違えないこと・**始点を渡した作成だけが `invalid reference` を「commit が無い」として読むこと**（切り替えでは「ブランチが無い」── git は同じ文しか言わないので、分けられるのはどちらのコマンドを組み立てたかを知っている側だけ）・40 桁のときの `unable to read tree` も同じ側へ倒すこと）
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
- `src/renderer/src/git/gitChanges.test.ts` — **変更ファイルの一覧の見せ方と、行に置く操作**（グループの順と空のグループを出さないこと・件数・**開けないもの（削除 / フォルダ）を押せる形にしないこと**・rename で元の位置を出すこと・upstream が無いことと同期していることを同じ表示にしないこと・**操作をグループから決めること**（競合には置かない / ステージ済みに「すべて Unstage」を置かない）・同じファイルの Stage と Unstage が同じ目印になること・失敗の理由すべてに文言があること・**Commit が押せる条件3つ**（ステージ済み / メッセージ / 他の Git 操作）と、押せない理由の一言・空欄には理由を出さないこと・残り文字数を上限に近づくまで出さないこと）
- `src/renderer/src/git/gitBranches.test.ts` — **ブランチを選ぶ面の中身**（**今のブランチも押せる**こと（印だけが違う）・他の Git 操作が動いている間は押せないこと・取得中に「ありません」と出さないこと・**切れていることを黙って隠さない**こと・空欄には理由ではなく何が起きるかを出すこと・**既にある名前かどうかを Renderer では見ない**こと・名前の問題すべてに違う文言があること・**履歴の行から作る欄はバーの「＋」と違う文言になる**こと（空欄でも始点だけは言う・始点として受け取るのは hash だけで、マージかどうかを見る手立てを持たないこと））
- `src/shared/git/branchName.test.ts` — **ブランチ名の規則**（空 / 上限の境界と超過 / 空白 / 制御文字 / `~^:?*[]` / `"<>|` を**弾く**こと・`..` / `@{` / `/` の位置 / `.lock` 終わり / **先頭の `-`** / `HEAD` を弾くこと・日本語や `feature/x` を**通す**こと・前後の空白だけを落とし**中の空白は落とさない**こと・文字列でない値を弾くこと）
- `src/shared/git/commitMessage.test.ts` — **Commit メッセージの規則**（空 / 空白だけ / 上限の境界と超過 / NUL と制御文字を**弾く**こと・改行 / タブ / 日本語 / 引用符 / `#` を**通す**こと・CRLF を LF へ揃えること・前後の空白を落としても途中の空行は残すこと・文字列でない値を弾くこと）
- `src/renderer/src/git/gitRepositoryMessage.test.ts` — **Git パネルの文言**（どの状態にも次の一手が書かれていること・**git の生の英文が UI に漏れていないこと**・detached をブランチ名として出さないこと）
- `src/renderer/src/workspace/workspace.integration.test.ts` — **STEP 2 全体の統合テスト**（下記）

Files の検証（`main/files/workspacePath.ts`）は Electron にも fs にも依存しない形に切り出してある。symlink による脱出だけはパス文字列では判断できないため、realpath を取ってから同じ関数へ通す側（`readWorkspaceDirectory.ts` / `readWorkspaceFile.ts` / `mutateWorkspaceEntry.ts`）が担う。

#### 例外: 実ディスクを触るテスト（Session 3-5.1 / 3-6-2 / 3-6-4 / 3-6-5 / 3-8-2 / 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-9 / 3-8-10 / 3-8-11 / 3-8-12 / 3-8-13 / 3-8-14）

「純粋なロジックだけを対象にする」方針に対する例外が15ある ── `mutateWorkspaceEntry.test.ts`（作成 / 改名 / 移動 / 削除）、`copyTree.test.ts`（再帰コピー）、`searchWorkspaceFiles.test.ts`（Workspace 全体の走査）、`searchWorkspaceFileContents.test.ts`（全文検索の走査）、`gitStatusRepository.test.ts`（本物の git の出力）、`gitStageRepository.test.ts`（本物の git への Stage / Unstage）、`gitCommitRepository.test.ts`（本物の git への Commit）、`gitSyncRepository.test.ts`（本物の git への Push / Pull）、`gitBranchRepository.test.ts`（本物の git へのブランチ操作）、`gitDiffRepository.test.ts`（本物の git から読む差分）、`gitDiscardRepository.test.ts`（本物の git に対する破棄）、`gitInitRepository.test.ts`（本物の git での初期化）、`publishRepository.test.ts`（本物の git での公開の一連）、`gitHistoryRepository.test.ts`（本物の git から読む履歴）、`gitCommitDetailRepository.test.ts`（本物の git から読む commit 1件の中身）。確かめたいのがパスの文字列処理ではなく **「実際にそこに在るものを操作できるか」** だからで、モックしたファイルシステムでは何も確かめられない ── 判定と実体がずれることこそが Session 3-5.1 で直した不具合の中身だった。`aux.ts` や末尾に空白を持つ名前を Windows がどう扱うかは実装ではなく OS が決めるため、写しを相手にするとその答えを自分で書くことになる。

どれも一時フォルダを Workspace root に見立てる。走査（検索）のテストでは、深い階層・大量ファイル・除外フォルダ・**外を指すジャンクション**を実際に作って、リンクの中へ潜っていないことを「指し先の中身が結果に出ていないこと」で確かめる ── 「潜らないつもり」を実物で確かめるため。上限（件数 / 深さ / 走査数）は引数で差し替えて小さくし、時間の上限だけは `now` を差し替えて固定する（実時間に依存させると、速いマシンでは通り遅いマシンでは落ちるテストになる）。

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

**`git branch --list --format=... --end-of-options <name>` が大文字小文字を区別すること**は、loose ref と packed-refs の両方で確かめてある（`git pack-refs --all` の前後で同じ問いを投げる）── `show-ref --verify` はどちらでも成功を返してしまい、この確認には使えない。

7 の ref は `git update-ref --stdin` で**一度に**作る ── `git branch` を 500 回呼ぶと、確かめたいこと（上限の扱い）に対して待ち時間が釣り合わない。この塊も `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` を実在しないパスへ向けてから走らせる（`checkout.defaultRemote` / `branch.autoSetupMerge` はどれも開発者の PC に入っていておかしくなく、確かめている振る舞いそのものを変えうる）。

**hook は `#!/bin/sh` のスクリプトで置ける**（Git for Windows は付属の sh で走らせる）。`exit 1` で止める hook、何も言わずに落ちる hook、`sleep` で遅い hook の3つを作れば、分類・迂回しないこと・待ち時間の上限のすべてが確かめられる。

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

---

## 5. 進め方

実装は「Session 1-1」「Session 1-2」のような番号付きセッション単位で進める。各セッションではその範囲だけを実装し、完了したら次へ進まずに停止する。次のセッションで実装する箇所には、コード中に継ぎ目（コメント）だけ残しておく。

---

## 6. exe 化に向けて残っている作業

STEP 1 では **`electron-builder` の導入は行わず、準備だけ**を済ませている。

済んでいること:

- `package.json` に `productName`（`Fluvix Nexus`）を設定。アプリ名と `%APPDATA%` 配下の保存先がこの名前になる
- `electron` を `devDependencies` へ移動（`electron-builder` は electron 自体をアプリの依存として同梱しない）
- ビルド成果物を `out/main` `out/preload` `out/renderer` に分離済み
- ユーザーデータの保存先を `app.getPath('userData')` に統一（インストール先に書き込まない）

着手時に必要になるもの:

- `package.json` の `author`（NSIS の発行元表示に使われる）とライセンス表記
- `appId`（例: `com.<組織名>.fluvix-nexus`）の決定
- アプリアイコン（`.ico`、256x256 を含むもの）
- `electron-builder.yml`（`files` に `out/**` と `package.json`、target は NSIS）
  - **`dependencies` を同梱する必要がある。** Session 3-7-1 で `@lydell/node-pty`（native モジュール）が入り、これが最初の `dependencies` になった。`externalizeDepsPlugin` により Main のバンドルには含まれないため、`node_modules` 側の実体が要る。electron-builder は既定で `dependencies` を拾うが、`files` を絞り込む場合はここを外さないこと
  - prebuilt はプラットフォームごとに別パッケージ（`@lydell/node-pty-win32-x64` など）として入る。`optionalDependencies` 経由なので、**ビルドする OS / アーキテクチャのものしか入っていない**
- バージョン付けの運用と GitHub Releases の準備
- 自動更新（`electron-updater`）と、コード署名 / SmartScreen 対策の方針決定（DESIGN.md §7）
