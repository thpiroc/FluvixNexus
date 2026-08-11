# 開発ガイド

> 対象: STEP 1 完了時点
> 最終更新: 2026-08-12

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
- `src/main/ipc/errors.test.ts` — 例外から IPC の失敗形への正規化
- `src/renderer/src/api/result.test.ts` — IpcResult の取り出しと UI 文言の網羅

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
