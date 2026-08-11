# アーキテクチャ

> 対象: STEP 1 完了時点の実装
> 最終更新: 2026-08-12

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
│   │       └── system.ts     system ドメインの実装
│   ├── store/
│   │   ├── jsonStore.ts      userData 配下への JSON 永続化（共通部分）
│   │   ├── windowBounds.ts   ウィンドウ状態の検証（Electron 非依存・テスト対象）
│   │   └── windowState.ts    ウィンドウ状態の保存と復元
│   ├── logger/index.ts       Main 側のログ出力
│   └── platform/index.ts     OS 依存判定の抽象化
├── preload/
│   ├── index.ts              contextBridge での公開
│   ├── ipc/invoke.ts         Main を呼ぶ唯一の経路
│   └── api/                  ドメインごとの薄いラッパ（env / system）
├── renderer/
│   ├── index.html            CSP を含む唯一の HTML
│   └── src/
│       ├── main.tsx / App.tsx    暫定 UI（STEP 2 でパネル UI に置き換える）
│       ├── api/fluvix.ts        window.fluvix を参照する唯一の場所
│       └── api/result.ts        IpcResult の扱いと UI 文言の対応表
└── shared/
    ├── api.ts                window.fluvix の型
    └── ipc/                  IPC の契約（チャンネル名・要求・応答・結果型）
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

現在の契約は「要求と応答」のみを扱う。Terminal の出力、ファイル変更の検知、LSP / DAP の通知のように Main から一方的に流れるイベントは、`IpcContract` と対になる `IpcEventContract` として STEP 2 の Terminal 着手時に追加する。要求と応答の型付けが `shared/ipc/` で完結しているため、同じ作り方をイベント側にも適用できる。

---

## 4. ウィンドウと状態の永続化

- ウィンドウのサイズ・位置・最大化状態は `%APPDATA%/Fluvix Nexus/window-state.json` に保存し、次回起動時に復元する。
- 保存は変化のたびに予約し、400ms 間引いてから一時ファイル経由で書き換える（書き込み中に落ちても既存ファイルが壊れない）。
- 読み込み時は必ず検証する。壊れている・画面外の位置・最小サイズ未満の場合は既定値へ戻す。
- レイアウトプリセット（DESIGN.md §3）も `store/` に同じ形で追加する想定。`jsonStore.ts` が保存先・間引き・破損時の扱いを引き受ける。

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

ガードは webContents 単位（`app.on('web-contents-created')`）で掛けている。ウィンドウが増えても掛け忘れが起きない形にするため。

### CSP の運用

- 実効的なポリシーは配布ビルド（`file://`）で全体に適用される。開発時は Vite が HMR 用の script タグを meta より前に差し込むため、その2つだけ適用外になる。**CSP の確認は必ずビルド後のアプリで行う。**
- 外部 CDN・外部フォント・外部 API は使わない。通信が必要になっても Renderer から直接叩かず Main 経由にする。
- Monaco Editor / xterm.js を入れる際は blob: Worker ではなくバンドル済みの Worker を使い、`worker-src 'self'` を維持する。
- `style-src` の `'unsafe-inline'` は、React / Monaco / xterm が実行時に style を注入するため必要。

---

## 6. 今後の機能を受け入れる余地

| 予定している機能                   | 現状の受け口                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockable UI / レイアウトプリセット | Renderer は暫定 UI のみで制約なし。レイアウトの保存は `store/` に追加する                                                                          |
| Monaco Editor / LSP                | LSP サーバのプロセス起動は Main（`platform/` に OS 依存部分）。Renderer とのやり取りは IPC のイベント側が必要                                      |
| Files                              | `main/ipc/handlers/files.ts` + `preload/api/files.ts`。ファイル変更の通知はイベント側が必要                                                        |
| Terminal                           | node-pty は Main に置き、`externalizeDepsPlugin` により external 扱い。Preload の `sandbox: true` は維持できる。出力のストリームはイベント側が必要 |
| GitHub パネルの独立ウィンドウ化    | セキュリティガードは webContents 単位、IPC は送信元ウィンドウを `IpcContext` で受け取れる                                                          |
| DAP                                | Terminal / LSP と同じ経路（Main でプロセス、IPC でやり取り）                                                                                       |
| Mac 対応                           | OS 依存判定は `platform/`。Renderer / shared に OS 依存は入っていない                                                                              |

不足しているのは **Main → Renderer のイベント経路**のみで、それ以外は現在の構造のまま追加できる。
