# 開発ガイド

> 対象: Session 2-7（STEP 2 完了）時点
> 最終更新: 2026-08-13

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
- `src/main/ipc/errors.test.ts` — 例外から IPC の失敗形への正規化
- `src/renderer/src/api/result.test.ts` — IpcResult の取り出しと UI 文言の網羅
- `src/renderer/src/workspace/layout/tree.test.ts` — レイアウトの木の探索・正規化・検証
- `src/renderer/src/workspace/layout/operations.test.ts` — Dock / Split 操作（React 非依存の部分）
- `src/renderer/src/workspace/layout/resize.test.ts` — サイズ操作と最小サイズの計算
- `src/renderer/src/workspace/layout/panelVisibility.test.ts` — パネルの表示 / 非表示と、再表示時の戻り先
- `src/renderer/src/workspace/layout/presets.test.ts` — プリセットの定義（正規形・id の重複）
- `src/renderer/src/workspace/dnd/dockGuide.test.ts` — カーソル位置から DockZone を決める判定
- `src/renderer/src/workspace/dnd/dropTarget.test.ts` — DockZone → DockTarget の翻訳、ドロップ可否、ドロップからレイアウトまでの一連
- `src/renderer/src/workspace/persistence/layoutDocument.test.ts` — 保存形式との往復、壊れた保存データの扱い、schemaVersion
- `src/renderer/src/workspace/persistence/restoreLayout.test.ts` — 復元したノード id と、その後の発番の衝突
- `src/renderer/src/workspace/workspace.integration.test.ts` — **STEP 2 全体の統合テスト**（下記）

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
- dev 側を driver から動かす場合、`electron-vite dev` は自前で Electron を起動してしまう。Renderer だけを Vite で配信し、`ELECTRON_RENDERER_URL` を渡した Electron を別途起動する。
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

確認の要領:

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
- バージョン付けの運用と GitHub Releases の準備
- 自動更新（`electron-updater`）と、コード署名 / SmartScreen 対策の方針決定（DESIGN.md §7）
