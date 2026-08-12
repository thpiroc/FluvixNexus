# アーキテクチャ

> 対象: Session 2-7（STEP 2 統合テスト・品質整理）完了時点の実装
> 最終更新: 2026-08-13

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
│   │   ├── errors.ts         IpcError と、Renderer へ返す形への変換
│   │   └── handlers/
│   │       ├── system.ts     system ドメインの実装
│   │       └── workspace.ts  レイアウトの読み書き（workspace ドメイン）
│   ├── store/
│   │   ├── jsonStore.ts      userData 配下への JSON 永続化（共通部分）
│   │   ├── windowBounds.ts   ウィンドウ状態の検証（Electron 非依存・テスト対象）
│   │   ├── windowState.ts    ウィンドウ状態の保存と復元
│   │   ├── workspaceLayoutDocument.ts  レイアウト文書の検証（Electron 非依存・テスト対象）
│   │   └── workspaceLayout.ts          レイアウトの保存先（userData 配下）
│   ├── logger/index.ts       Main 側のログ出力
│   └── platform/index.ts     OS 依存判定の抽象化
├── preload/
│   ├── index.ts              contextBridge での公開
│   ├── ipc/invoke.ts         Main を呼ぶ唯一の経路
│   └── api/                  ドメインごとの薄いラッパ（env / system / workspace）
├── renderer/
│   ├── index.html            CSP を含む唯一の HTML
│   └── src/
│       ├── main.tsx / App.tsx    エントリ。App は Workspace Shell を描画するだけ
│       ├── api/fluvix.ts        window.fluvix を参照する唯一の場所
│       ├── api/result.ts        IpcResult の扱いと UI 文言の対応表
│       ├── styles/
│       │   ├── theme.css        色・間隔の変数（値を直接書いてよい唯一の場所）
│       │   └── global.css       最小リセット
│       └── workspace/           Workspace Shell（§7）
└── shared/
    ├── api.ts                window.fluvix の型
    ├── ipc/                  IPC の契約（チャンネル名・要求・応答・結果型）
    └── workspace/            レイアウトの保存形式と schemaVersion（§7.8）
```

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

### 3.3 Main → Renderer のイベント（未実装）

現在の契約は「要求と応答」のみを扱う。Terminal の出力、ファイル変更の検知、LSP / DAP の通知のように Main から一方的に流れるイベントは、`IpcContract` と対になる `IpcEventContract` として **STEP 3 で Terminal に着手する時点**で追加する。要求と応答の型付けが `shared/ipc/` で完結しているため、同じ作り方をイベント側にも適用できる。

---

## 4. 状態の永続化

保存されるものは2つあり、どちらも `app.getPath('userData')`（Windows では `%APPDATA%/Fluvix Nexus`）配下の小さな JSON になる。インストール先にもプロジェクトフォルダにも書かない。

| ファイル                | 内容                             | 検証（Electron 非依存）            | 保存を決める場所           |
| ----------------------- | -------------------------------- | ---------------------------------- | -------------------------- |
| `window-state.json`     | ウィンドウのサイズ・位置・最大化 | `store/windowBounds.ts`            | `store/windowState.ts`     |
| `workspace-layout.json` | Workspace レイアウト（§7.8）     | `store/workspaceLayoutDocument.ts` | `store/workspaceLayout.ts` |

共通の作法は `jsonStore.ts` が持つ。

- 保存は変化のたびに予約し、400ms 間引いてから一時ファイル経由で書き換える（書き込み中に落ちても既存ファイルが壊れない）。
- **読み込み時は必ず検証する。** 保存ファイルは利用者が手で編集できる場所にあり、アプリのバージョン差で形も変わる。壊れていれば既定値へ戻す（ウィンドウなら標準サイズ、レイアウトなら Default プリセット）。
- 保存に失敗してもアプリは止めない。次回起動が前回保存できた状態に戻るだけで済むため。

ウィンドウ状態は画面外判定（モニタ構成の変化）も見る。レイアウト側の検証は Main と Renderer で分担しており、その線引きは §7.8。

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

ガードは webContents 単位（`app.on('web-contents-created')`）で掛けている。ウィンドウが増えても掛け忘れが起きない形にするため。

### 永続化の API を用途ごとに切る

`workspace:save-layout` / `workspace:load-layout` が扱うのは Workspace レイアウトだけで、保存先のパスもファイル名も Renderer からは指定できない（`store/workspaceLayout.ts` が決める）。汎用のファイル読み書きを1つ公開すると、Renderer を OS から切り離している前提がそこで崩れる。

そのため、**別のものを保存したくなったらその用途専用の API を足す**という方針を取る。受け取った内容は Main 側でも検証してから書く（`store/workspaceLayoutDocument.ts`）。Renderer から届く値も境界の外から来たものとして扱い、想定外の内容や桁違いの大きさをそのままディスクに残さないため。

### CSP の運用

- 実効的なポリシーは配布ビルド（`file://`）で全体に適用される。開発時は Vite が HMR 用の script タグを meta より前に差し込むため、その2つだけ適用外になる。**CSP の確認は必ずビルド後のアプリで行う。**
- 外部 CDN・外部フォント・外部 API は使わない。通信が必要になっても Renderer から直接叩かず Main 経由にする。
- Monaco Editor / xterm.js を入れる際は blob: Worker ではなくバンドル済みの Worker を使い、`worker-src 'self'` を維持する。
- `style-src` の `'unsafe-inline'` は、React / Monaco / xterm が実行時に style を注入するため必要。

---

## 6. 今後の機能を受け入れる余地

| 予定している機能                   | 現状の受け口                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockable UI / レイアウトプリセット | Workspace Shell（§7）。**STEP 2 として完成**（Dock / Split・ドラッグ&ドロップ・境界のリサイズ・表示管理・プリセットの器・レイアウトの保存 / 復元）。残りは §7.9 |
| Monaco Editor / LSP                | LSP サーバのプロセス起動は Main（`platform/` に OS 依存部分）。Renderer とのやり取りは IPC のイベント側が必要                                                   |
| Files                              | `main/ipc/handlers/files.ts` + `preload/api/files.ts`。ファイル変更の通知はイベント側が必要                                                                     |
| Terminal                           | node-pty は Main に置き、`externalizeDepsPlugin` により external 扱い。Preload の `sandbox: true` は維持できる。出力のストリームはイベント側が必要              |
| GitHub パネルの独立ウィンドウ化    | セキュリティガードは webContents 単位、IPC は送信元ウィンドウを `IpcContext` で受け取れる                                                                       |
| DAP                                | Terminal / LSP と同じ経路（Main でプロセス、IPC でやり取り）                                                                                                    |
| Mac 対応                           | OS 依存判定は `platform/`。Renderer / shared に OS 依存は入っていない                                                                                           |

不足しているのは **Main → Renderer のイベント経路**のみで、それ以外は現在の構造のまま追加できる。

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
│   ├── WorkspaceMenu.tsx     上部バーのドロップダウン（View / Layout の共通の器）
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
| Main → Renderer のイベント経路 | §3.3。Terminal の出力・ファイル変更の検知・LSP / DAP の通知に要る。STEP 3 で Terminal に着手する時点で追加する  |

タブの並べ替えは、レイアウト操作（`movePanel` の `{ kind: 'tab', index }`）と単体テスト・統合テストは揃っているが、**タブを掴んで並べ替える UI の入口だけが無い**状態にしてある。今できるのは「別の領域へ出して戻す」経路での並べ替えで、これは実機確認でも通している。
