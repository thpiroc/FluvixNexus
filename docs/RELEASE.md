# リリース

> 対象: v1.0.0（Session 7-2A でメタデータと仕様を確定。installer はまだ作っていない）
> 最終更新: 2026-09-16

v1.0.0 を配布するための仕様と手順を扱う。製品としての配布方針は [DESIGN.md](../DESIGN.md) §7、利用者向けの説明は [README.md](../README.md)、開発時のコマンドは [DEVELOPMENT.md](DEVELOPMENT.md) にある。

---

## 1. v1.0.0 で確定したこと（Session 7-2A）

| 項目                       | 決めたこと                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| version                    | `1.0.0`（`package.json`）                                                                       |
| appId                      | `studio.fluvix.fluvixnexus`（7-2B の electron-builder 設定に書く）                              |
| productName                | `Fluvix Nexus`（従来どおり）                                                                    |
| author / copyright         | `Piroshi` / `Copyright (c) 2026 Piroshi`                                                        |
| LICENSE                    | MIT（`LICENSE`）。第三者ライセンスは `THIRD_PARTY_NOTICES.txt`（§4）                            |
| Windows installer          | NSIS / per-user / x64                                                                           |
| 配布先                     | GitHub Releases。repository は v1.0.0 公開時に Public へ変える。変える直前に §6 を確認し直す    |
| 含めないもの               | 自動更新（electron-updater）・コード署名・Debug Adapter の同梱 / 自動取得                       |
| Renderer の `file://` 読込 | v1.0.0 では**既知の制約**として残す（docs/ARCHITECTURE.md §4 / §5）。Release blocker にはしない |

security boundary（contextIsolation / sandbox / CSP / IPC / preload）は 7-2A で変えていない。

## 2. Session 7-2 の分割

| Session | 内容                                                                                 | 状態   |
| ------- | ------------------------------------------------------------------------------------ | ------ |
| 7-2A    | Release 仕様とメタデータ（version・author・LICENSE・README・第三者ライセンス・本書） | 完了   |
| 7-2B    | electron-builder の導入と設定（§5）、ローカルで installer を作る（公開しない）       | 未着手 |
| 7-2C    | installer で入れたアプリの検証（この PC・Unicode のユーザーパス。§8）                | 未着手 |
| 7-2D    | clean Windows での検証（§8）と Release notes の確定（§7）                            | 未着手 |
| 7-2E    | §6 の再確認 → repository を Public → `v1.0.0` tag → draft Release → 確認して公開     | 未着手 |

## 3. 後から変えてはいけない識別子

どれも v1.0.0 を出した後に変えると、**上書きインストールが別アプリ扱いになる / 保存データが見えなくなる**。

| 識別子                             | 決まるもの                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `productName`（Fluvix Nexus）      | userData のフォルダ名（`%APPDATA%\Fluvix Nexus`）・多重起動の抑止の単位・ウィンドウ名     |
| appId（studio.fluvix.fluvixnexus） | NSIS のアンインストール情報・ショートカットの AppUserModelID                              |
| `name`（fluvix-nexus）             | per-user のインストール先（`%LOCALAPPDATA%\Programs\fluvix-nexus` の見込み。7-2C で確認） |

開発版（`npm run dev` / `out/` の起動）も同じ `productName` を使うため、**この PC ではインストール版と userData・多重起動の抑止を共有する**。同時に起動すると後から起動した方が黙って終わる。7-2C で開発版と並べて確かめるときは、どちらかに `--user-data-dir` を渡す。

## 4. 第三者ライセンス表記

`THIRD_PARTY_NOTICES.txt` は `npm run notices`（`tools/third-party-notices.mjs`）が作る。**手で書き換えない。** `npm run verify` に `notices:check` が入っていて、依存の版や import が変わったのに作り直していなければ失敗する。

| 対象                          | 決め方                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 数えるもの                    | `src/` の実行時の import（`import type` とテストは除く）に現れるパッケージと、その `dependencies` / この環境に入っている `optionalDependencies` |
| 数えないもの                  | `electron`（下記）・`@types/*`（型定義だけ）・Node の組み込みモジュール                                                                         |
| 本文                          | 各パッケージに入っている `LICENSE*` / `COPYING*` / `NOTICE*` / `ThirdPartyNotices*` をそのまま載せる（行末の空白だけ落とす）                    |
| Electron / Chromium / Node.js | electron-builder がインストール先へ置く `LICENSE.electron.txt` / `LICENSES.chromium.html`（7-2C で在ることを確かめる）                          |

v1.0.0 時点で載っているもの（10件）: `@lydell/node-pty` 1.1.0・`@lydell/node-pty-win32-x64` 1.1.0・`@xterm/addon-fit` 0.11.0・`@xterm/xterm` 6.0.0・`dompurify` 3.4.8（MPL-2.0 OR Apache-2.0）・`marked` 14.0.0・`monaco-editor` 0.56.0（同梱の `ThirdPartyNotices.txt` を含む）・`react` / `react-dom` 19.2.8・`scheduler` 0.27.0。`dompurify` / `marked` は monaco-editor の依存としてバンドルに入っている。

`LICENSE` と `THIRD_PARTY_NOTICES.txt` は installer にも入れる（§5 の `extraResources`）。

## 5. electron-builder の設計（7-2B で実装する）

7-2A では**入れていない**。7-2B はこの設計どおりに入れ、違う判断が要るときは本書を先に直す。

### 5.1 package.json

| 項目            | 内容                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| devDependencies | `electron-builder`（7-2B 着手時点の最新を**完全一致の版で** pin。調査時点は 26.15.3） |
| scripts         | `"dist": "npm run build && electron-builder --win nsis --x64 --publish never"`        |
| 設定の置き場所  | ルートの `electron-builder.yml`（package.json の `build` には書かない）               |

### 5.2 electron-builder.yml

```yaml
appId: studio.fluvix.fluvixnexus
productName: Fluvix Nexus
copyright: Copyright (c) 2026 Piroshi

directories:
  output: release # .gitignore 済み
  buildResources: resources # build/ は .gitignore の対象なので使わない（§5.3）

files:
  - out/**/*
  - package.json
  - '!**/node_modules/@lydell/node-pty-win32-x64/*.pdb' # デバッグシンボル（約 10 MB）は同梱しない

asar: true
asarUnpack:
  - node_modules/@lydell/** # §5.4
npmRebuild: false # prebuilt を使う。ビルドする PC に C++ ツールチェーンを要求しない

extraResources:
  - from: LICENSE
    to: LICENSE
  - from: THIRD_PARTY_NOTICES.txt
    to: THIRD_PARTY_NOTICES.txt

win:
  target:
    - target: nsis
      arch:
        - x64
  icon: resources/icon.ico # 素材が入るまでは書かない（§5.3）

nsis:
  oneClick: true # electron-builder の既定。per-user で入る
  perMachine: false
  deleteAppDataOnUninstall: false # userData（設定・Debug Profile・ログ）は消さない
  artifactName: Fluvix-Nexus-Setup-${version}.${ext} # 空白を含む既定名は GitHub が `.` に置き換えるため

publish: null # 自動更新は入れない。GitHub へのアップロードは手で行う
```

`nsis` は electron-builder の既定（oneClick・per-user）をそのまま使う。インストール先を選ばせる形（assisted）に変えるなら、先に決定を取ること。

### 5.3 アイコン

| 項目       | 決めたこと                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 置き場所   | `resources/`（リポジトリに commit する。`build/` は `.gitignore` の対象なので置いても commit されない）                                         |
| 原本       | `resources/icon.png`（1024×1024、背景透過）。SVG で描いた場合は `resources/icon.svg` も置く                                                     |
| Windows 用 | `resources/icon.ico`（16 / 20 / 24 / 32 / 40 / 48 / 64 / 256 px を含む。256 は PNG 圧縮）                                                       |
| 使われ方   | exe・installer / uninstaller・ショートカット・タスクバー。Windows のウィンドウは exe のアイコンを使うため、`BrowserWindow` の `icon` は足さない |
| 状態       | **素材は未作成**。7-2B は素材が無くても installer を作れる（Electron の既定アイコンになる）が、**7-2E の公開までに必須**                        |

`.gitattributes` は `*.png` / `*.ico` を既に binary 扱いにしている。

### 5.4 インストール版だけで壊れうるもの

開発中の確認（`out/` を素の Electron で起動）では `app.isPackaged` が false で、asar も通らない。次は installer で入れたアプリでしか確かめられない。

| 対象                        | 理由と対処                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal（node-pty）        | `windowsConoutConnection.js` は Worker の script を `__dirname` の `node_modules.asar` だけを `.asar.unpacked` へ置き換えて探す。electron-builder の `app.asar` は置き換わらず、Worker が asar の中を読みに行く。`.node` と、`fork` で起こす `conpty_console_list_agent.js` もあるため `@lydell/**` をまとめて unpack する |
| node-pty の prebuilt        | `optionalDependencies` なので、ビルドする PC に `@lydell/node-pty-win32-x64` が無いと実行時に MODULE_NOT_FOUND。**clean checkout で `npm ci` してからビルドする**                                                                                                                                                          |
| Electron Fuses              | v1.0.0 では設定しない。RunAsNode を無効にすると node-pty の `child_process.fork` が動かなくなる                                                                                                                                                                                                                            |
| `app.isPackaged` の分岐     | ネイティブメニューが無くなる（DevTools も開けない）・ログが info 以上になる                                                                                                                                                                                                                                                |
| Renderer / preload / Worker | asar の中から `file://` で読む。相対 URL なので動く見込みだが未確認                                                                                                                                                                                                                                                        |
| PATH                        | スタートメニューから起動したアプリは Explorer の環境変数を受け継ぐ。Node / Git / LSP などを後から入れたらアプリの再起動（場合によってはサインアウト）が要る。LSP / DAP / git は PATH を自分で辿って絶対パスで起動するので、インストール先には依存しない                                                                    |
| AppUserModelID              | NSIS はショートカットに appId を付けるが、アプリは `app.setAppUserModelId` を呼んでいない。タスクバーのピン留め・グループ化を 7-2C で見て、問題があるときだけ直す                                                                                                                                                          |

## 6. repository を Public にする前の確認

### 6.1 Session 7-2A 時点の調査結果

対象は全 commit の履歴と、7-2A の変更を含む作業ツリー。

| 観点                                                   | 結果                                                                                                                                                            | 判断                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token / 秘密鍵のパターン（全履歴）                     | 当たるのは `src/main/logger/logRedaction.test.ts` の**伏せ字のテスト用に作った偽の値**（`ghp_ABCDEF…` / `github_pat_11ABCDEFG…`）と、それを探す正規表現だけ     | 問題なし                                                                                                                                                  |
| `.env` / 鍵 / 証明書 / `settings.local.json`（全履歴） | 一度も commit されていない。`.gitignore` が除外している                                                                                                         | 問題なし                                                                                                                                                  |
| 削除済みファイル（全履歴）                             | 設定の旧 store（Session 4-3A で統合）と `WorkspaceMenu.tsx` だけ                                                                                                | 問題なし                                                                                                                                                  |
| **commit の author e-mail**                            | **全 commit の author が個人の e-mail アドレス**。Public にすると誰でも読める                                                                                   | **要判断**（そのまま公開する / 以後の commit を GitHub の noreply にする。履歴の書き換えは commit hash が変わり、記録済みの hash と食い違うので勧めない） |
| `.claude/settings.json` / `.claude/launch.json`        | commit 済み。中身は `npm run verify` の許可と `npm run dev` の起動設定だけ                                                                                      | 公開して害は無い。残すかは任意                                                                                                                            |
| 開発 PC 固有の記述                                     | docs/DEVELOPMENT.md に検証用の一時パス（`D:\fx617`）と「Windows のユーザー名が Unicode」という記述。`logRedaction.test.ts` にユーザー名に似た文字列（テスト用） | 秘密情報ではない。気になる場合だけ直す                                                                                                                    |
| 大きなファイル / バイナリ                              | 無い（最大は docs/ARCHITECTURE.md の約 1 MB）                                                                                                                   | 問題なし                                                                                                                                                  |

### 6.2 Public にする直前（7-2E）にやり直すこと

7-2B〜7-2D の commit が増えるため、7-2A の結果を使い回さない。

```bash
# 全履歴から token / 秘密鍵らしきもの
git grep -nIE "ghp_[A-Za-z0-9]{20}|github_pat_|sk-ant-|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|xox[bp]-" $(git rev-list --all)
# 秘密情報になりうる名前のファイルが履歴に無いか
git log --all --name-only --format='' | grep -iE '\.env|secret|token|credential|\.pem|\.key|\.pfx|settings\.local' | sort -u
# 削除済みファイルの一覧
git log --all --diff-filter=D --name-only --format='' | sort -u
# commit の author
git log --format='%an <%ae>' | sort | uniq -c
# release/ や installer が commit されていないこと
git ls-files | grep -iE '\.exe$|\.blockmap$|^release/|\.asar$'
```

## 7. Release notes に書くこと（7-2D で確定）

| 項目           | 内容                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| 概要           | 何のアプリか・v1.0.0 が最初の公開版であること                                                                |
| 動作環境       | Windows 11 x64（7-2D で確かめた環境を書く）                                                                  |
| ダウンロード   | `Fluvix-Nexus-Setup-1.0.0.exe` と `SHA256SUMS.txt`。SHA-256 の確かめ方（`Get-FileHash`）                     |
| インストール   | per-user・管理者権限不要・**未署名のため SmartScreen の警告が出る**こと・**自動更新が無い**こと              |
| 別途入れるもの | Git / GitHub CLI / Language Server / Debug Adapter と、入れた後にアプリを再起動すること（README へのリンク） |
| データとログ   | `%APPDATA%\Fluvix Nexus`・`logs\main.log`。アンインストールしても残ること                                    |
| 既知の制約     | DESIGN.md §14 の表（Debug の制約・adapter は利用者が置く・Renderer の `file://`）                            |
| ライセンス     | MIT・THIRD_PARTY_NOTICES.txt                                                                                 |
| 不具合の報告先 | 7-2E で決める（Public にした repository の Issues を使うか）                                                 |

GitHub Release に上げるのは `Fluvix-Nexus-Setup-1.0.0.exe` と `SHA256SUMS.txt` だけ。自動更新を入れないので `.blockmap` / `latest.yml` は上げない。`win-unpacked/` も上げない。

## 8. installer で入れたアプリの確認項目

7-2C（この PC）と 7-2D（clean Windows）の両方で使う。この PC は Windows 11 Home のため Windows Sandbox / Hyper-V が使えない。clean Windows は VM・別の PC・新しい Windows ユーザーのどれかで用意する。

| 観点         | 確かめること                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| インストール | SmartScreen の表示・per-user で入る場所・ショートカット・アンインストール情報の発行元 / 版                                       |
| 起動         | ショートカットから起動（Explorer の環境）・ネイティブメニューが無い・二重起動で前の窓が前に出る                                  |
| Renderer     | CSP 違反 0 件・Monaco の Worker（TS / JSON / CSS / HTML）が動く・Theme / Language の切り替え                                     |
| Terminal     | タブを開く・入力 / 出力・リサイズ・閉じる確認・アプリ終了でシェルが残らない（node-pty の unpack）                                |
| Git / GitHub | Git が無いときの案内 → 入れて再起動すると検出される                                                                              |
| LSP          | サーバが無いときの「未インストール」→ 入れて再起動すると動く                                                                     |
| Debug        | 3言語の `adapter-unavailable` の案内 → js-debug を userData に置く / debugpy / netcoredbg で Start から停止まで                  |
| 保存場所     | `%APPDATA%\Fluvix Nexus` に JSON と `logs\main.log`（見出しが `packaged`・info 以上）・インストール先と Workspace に何も書かない |
| ライセンス   | インストール先の `resources\LICENSE`・`resources\THIRD_PARTY_NOTICES.txt`・`LICENSE.electron.txt`・`LICENSES.chromium.html`      |
| 更新 / 削除  | 同じ版の上書きインストールで設定が残る・アンインストールで userData が残る                                                       |
| パス         | Unicode を含むユーザー名の下へのインストール（この PC）                                                                          |
