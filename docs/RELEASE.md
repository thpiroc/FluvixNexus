# リリース

> 対象: v1.0.0（Session 7-2A でメタデータと仕様を確定。Session 7-2B で electron-builder を入れ、ローカルで installer を作った。Session 7-2C でその installer をこの PC に入れて検証した。Session 7-2D でこの PC でできる clean Windows 相当の確認をし、Release notes を確定した。その後、正式アイコンを組み込んで installer を作り直した。Session 7-2E で公開前の再確認・`SHA256SUMS.txt`・`v1.0.0` tag までを済ませ、利用者が repository を Public にして Release を公開した（2026-09-16。§9.5））
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

| Session | 内容                                                                                 | 状態                                                                      |
| ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 7-2A    | Release 仕様とメタデータ（version・author・LICENSE・README・第三者ライセンス・本書） | 完了                                                                      |
| 7-2B    | electron-builder の導入と設定（§5）、ローカルで installer を作る（公開しない）       | 完了                                                                      |
| 7-2C    | installer で入れたアプリの検証（この PC・Unicode のユーザーパス。§8 / §8.1）         | 完了                                                                      |
| 7-2D    | clean Windows での検証（§8）と Release notes の確定（§7）                            | 完了（この PC でできる範囲。別 PC / VM の項目は §8.2 の未確認事項）       |
| 7-2E    | §6 の再確認 → `SHA256SUMS.txt` → `v1.0.0` tag → draft Release → Public → 公開（§9）  | 完了（draft 以降の GitHub 上の操作は利用者が行った。公開後の確認は §9.5） |

## 3. 後から変えてはいけない識別子

どれも v1.0.0 を出した後に変えると、**上書きインストールが別アプリ扱いになる / 保存データが見えなくなる**。

| 識別子                             | 決まるもの                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `productName`（Fluvix Nexus）      | userData のフォルダ名（`%APPDATA%\Fluvix Nexus`）・多重起動の抑止の単位・ウィンドウ名 |
| appId（studio.fluvix.fluvixnexus） | NSIS のアンインストール情報・ショートカットの AppUserModelID                          |
| `name`（fluvix-nexus）             | per-user のインストール先（`%LOCALAPPDATA%\Programs\fluvix-nexus`。7-2C で確認）      |

開発版（`npm run dev` / `out/` の起動）も同じ `productName` を使うため、**この PC ではインストール版と userData・多重起動の抑止を共有する**。同時に起動すると後から起動した方が黙って終わる。7-2C で開発版と並べて確かめるときは、どちらかに `--user-data-dir` を渡す。

## 4. 第三者ライセンス表記

`THIRD_PARTY_NOTICES.txt` は `npm run notices`（`tools/third-party-notices.mjs`）が作る。**手で書き換えない。** `npm run verify` に `notices:check` が入っていて、依存の版や import が変わったのに作り直していなければ失敗する。

| 対象                          | 決め方                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 数えるもの                    | `src/` の実行時の import（`import type` とテストは除く）に現れるパッケージと、その `dependencies` / この環境に入っている `optionalDependencies` |
| 数えないもの                  | `electron`（下記）・`@types/*`（型定義だけ）・Node の組み込みモジュール                                                                         |
| 本文                          | 各パッケージに入っている `LICENSE*` / `COPYING*` / `NOTICE*` / `ThirdPartyNotices*` をそのまま載せる（行末の空白だけ落とす）                    |
| Electron / Chromium / Node.js | electron-builder がインストール先へ置く `LICENSE.electron.txt` / `LICENSES.chromium.html`（7-2C でインストール先に在ることを確認）              |

v1.0.0 時点で載っているもの（10件）: `@lydell/node-pty` 1.1.0・`@lydell/node-pty-win32-x64` 1.1.0・`@xterm/addon-fit` 0.11.0・`@xterm/xterm` 6.0.0・`dompurify` 3.4.8（MPL-2.0 OR Apache-2.0）・`marked` 14.0.0・`monaco-editor` 0.56.0（同梱の `ThirdPartyNotices.txt` を含む）・`react` / `react-dom` 19.2.8・`scheduler` 0.27.0。`dompurify` / `marked` は monaco-editor の依存としてバンドルに入っている。

`LICENSE` と `THIRD_PARTY_NOTICES.txt` は installer にも入れる（§5 の `extraResources`）。

## 5. electron-builder の設定（Session 7-2B で実装）

7-2A で決めた設計を 7-2B でそのまま入れた（設計と食い違った点は無い）。**設定の正はルートの `electron-builder.yml`**。変えるときは本書も一緒に直す。ローカルでの作り方と 7-2B の結果は §5.5。

### 5.1 package.json

| 項目            | 内容                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| devDependencies | `electron-builder` **26.15.3**（完全一致で pin）。7-2B 着手時の npm の `latest`。`v26` タグには 26.16.1 があるが `latest` に付いていないので採らない |
| scripts         | `"dist": "npm run build && electron-builder --win nsis --x64 --publish never"`                                                                       |
| 設定の置き場所  | ルートの `electron-builder.yml`（package.json の `build` には書かない）                                                                              |

### 5.2 electron-builder.yml

7-2A で決めた形（7-2B の `electron-builder.yml` はこれにコメントを足しただけ）。

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
  icon: resources/icon.ico # 正式アイコン（7-2D の後に追加。§5.3）

nsis:
  oneClick: true # electron-builder の既定。per-user で入る
  perMachine: false
  deleteAppDataOnUninstall: false # userData（設定・Debug Profile・ログ）は消さない
  artifactName: Fluvix-Nexus-Setup-${version}.${ext} # 空白を含む既定名は GitHub が `.` に置き換えるため

publish: null # 自動更新は入れない。GitHub へのアップロードは手で行う
```

`nsis` は electron-builder の既定（oneClick・per-user）をそのまま使う。インストール先を選ばせる形（assisted）に変えるなら、先に決定を取ること。

### 5.3 アイコン

| 項目       | 決めたこと                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 置き場所   | `resources/`（リポジトリに commit する。`build/` は `.gitignore` の対象なので置いても commit されない）                                                                                                                                                                                       |
| 原本       | `resources/icon.png`（**1254×1254・RGBA・背景透過**。利用者が確定した正式アイコンの修正版で、最初の版（RGB・背景が黒で不透過）から差し替えた。角丸タイルの外は alpha 0、中は alpha 240〜254（ほぼ不透明）。タイルの外の余白は左 115 / 右 114 / 上 116 / 下 129 px。絵は変えずにそのまま使う） |
| Windows 用 | `resources/icon.ico`（16 / 20 / 24 / 32 / 40 / 48 / 64 / 256 px。256 は PNG 圧縮、それ以外は 32bit BGRA の DIB）                                                                                                                                                                              |
| 作り方     | `powershell -NoProfile -ExecutionPolicy Bypass -File tools/generate-app-icon.ps1`。Windows 標準の .NET（System.Drawing）で縮小するだけで、依存は足していない。出力は毎回同じバイト列になる。原本を替えたら流し直し、2つを一緒に commit する                                                   |
| 設定       | `electron-builder.yml` の `win.icon`。NSIS の installer / uninstaller のアイコンは electron-builder がここから取る（`nsis.installerIcon` などは書かない）                                                                                                                                     |
| 使われ方   | exe・installer / uninstaller・ショートカット・タスクバー。Windows のウィンドウは exe のアイコンを使うため、`BrowserWindow` の `icon` は足さない                                                                                                                                               |
| 開発時     | `npm run dev` は素の `electron.exe` で動くので、窓とタスクバーは Electron の既定アイコンのまま（意図どおり）                                                                                                                                                                                  |

**確認の結果（7-2D の後。コード・依存・security boundary・設定 / userData の仕様は変えていない）:**

| 観点                                  | 結果                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `icon.ico` の中身                     | 8 エントリを独立に読み戻して全サイズがデコードできる。白・暗色・市松・青の背景に重ね、16 px でも絵が崩れず、角の外が透過して黒い縁やにじみが出ないことを目視                                                                                                                                                                            |
| ビルド                                | `npm run verify` 通過・`npm run dist` のログに `default Electron icon is used` が出ない                                                                                                                                                                                                                                                 |
| 埋め込まれたアイコン                  | PE の RT_GROUP_ICON / RT_ICON を読み、`win-unpacked\Fluvix Nexus.exe`・`Fluvix-Nexus-Setup-1.0.0.exe`・インストール先の exe・`Uninstall Fluvix Nexus.exe` の4つとも **8 サイズが `icon.ico` とバイト一致**。同じ比較で素の `electron.exe` は不一致になる（比較が空振りしていない）                                                      |
| ショートカット / アンインストール情報 | Start Menu・Desktop の `.lnk` の IconLocation と HKCU の `DisplayIcon` はどれもインストール先の `Fluvix Nexus.exe,0`                                                                                                                                                                                                                    |
| 実行中の窓                            | インストール版の窓のクラスアイコン（タスクバーと Alt+Tab が使う）が正式アイコン。`main.log` に ERROR 0 件。修正版では、シェルが返す Start Menu / Desktop の `.lnk`・uninstaller のアイコンと窓のアイコンの角が alpha 0 であることも確かめた（最初の版の `icon.ico` は角が不透明の黒なので、アイコンキャッシュの古い絵なら見分けられる） |
| 後片付け                              | 確認後に `/S` でアンインストール（インストール先・ショートカットは消え、userData は残る）                                                                                                                                                                                                                                               |

installer は作り直したので、§5.5 の 7-2B の数値と §8.1 / §8.2 の SHA-256（`B4D80D13…`）は**アイコン無しの旧 installer のもの**。正式アイコンの修正版で作り直した installer は 103,066,939 bytes。**7-2E でこれを作り直さずに Release に載せると決めた**（§9.2）。

`.gitattributes` は `*.png` / `*.ico` を既に binary 扱いにしている。

### 5.4 インストール版だけで壊れうるもの

開発中の確認（`out/` を素の Electron で起動）では `app.isPackaged` が false で、asar も通らない。次は installer で入れたアプリでしか確かめられない。

| 対象                        | 理由と対処                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal（node-pty）        | `windowsConoutConnection.js` は Worker の script を `__dirname` の `node_modules.asar` だけを `.asar.unpacked` へ置き換えて探す。electron-builder の `app.asar` は置き換わらず、Worker が asar の中を読みに行く。`.node` と、`fork` で起こす `conpty_console_list_agent.js` もあるため `@lydell/**` をまとめて unpack する。**7-2B の smoke で、win-unpacked から Terminal を立てて出力が返ることを確かめた**（§5.5）。7-2C で、インストール版の Main が `app.asar.unpacked` の `conpty.node` を読み、タブを閉じるとシェルの孫プロセスまで消え（`fork` 側）、アプリ終了でシェルが残らないことを確かめた（§8.1） |
| node-pty の prebuilt        | `optionalDependencies` なので、ビルドする PC に `@lydell/node-pty-win32-x64` が無いと実行時に MODULE_NOT_FOUND。**clean checkout で `npm ci` してからビルドする**                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Electron Fuses              | v1.0.0 では設定しない。RunAsNode を無効にすると node-pty の `child_process.fork` が動かなくなる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `app.isPackaged` の分岐     | ネイティブメニューが無くなる（DevTools も開けない）・ログが info 以上になる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Renderer / preload / Worker | asar の中から `file://` で読む。Renderer と preload が asar の中から読めることは 7-2B の smoke で確認。Monaco の Worker（editor / JSON / CSS / HTML / TS）が asar の中から起動することは 7-2C で確認（§8.1）                                                                                                                                                                                                                                                                                                                                                                                                    |
| PATH                        | スタートメニューから起動したアプリは Explorer の環境変数を受け継ぐ。Node / Git / LSP などを後から入れたらアプリの再起動（場合によってはサインアウト）が要る。LSP / DAP / git は PATH を自分で辿って絶対パスで起動するので、インストール先には依存しない                                                                                                                                                                                                                                                                                                                                                         |
| AppUserModelID              | NSIS はショートカットに appId を付けるが、アプリは `app.setAppUserModelId` を呼んでいない。7-2C で Start Menu / Desktop のショートカットの AppUserModelID が `studio.fluvix.fluvixnexus` であることを確認。7-2D で、ウィンドウには明示の AppUserModelID が付いていないこと（Electron の既定の書式 `electron.app.$1` は exe に入っている）を確認。タスクバーのピン留め・グループ化の目視は未了（§8.2）。問題があるときだけ直す                                                                                                                                                                                   |

### 5.5 ローカルで installer を作る（Session 7-2B の結果）

```bash
npm ci          # optionalDependencies の prebuilt を入れ直す（§5.4）
npm run dist    # electron-vite build → electron-builder（NSIS / x64 / --publish never）
```

初回は electron の zip・NSIS・7-Zip を `%LOCALAPPDATA%\electron-builder\Cache` へ取りに行く（ネットワークが要る）。GitHub へは何も上げない。

`release/`（`.gitignore` 済み）にできるもの:

| ファイル                                | 扱い                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| `Fluvix-Nexus-Setup-1.0.0.exe`          | installer。Release に上げるのはこれだけ（§7）           |
| `Fluvix-Nexus-Setup-1.0.0.exe.blockmap` | 自動更新用。上げない                                    |
| `builder-debug.yml`                     | electron-builder の診断用。上げない                     |
| `win-unpacked/`                         | installer の中身と同じ木。7-2B の確認に使った。上げない |

7-2B で作ったもの（`npm ci` の直後にビルド。この PC の結果で、Release に載せる hash ではない）:

| 観点                  | 結果                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| installer             | `Fluvix-Nexus-Setup-1.0.0.exe` 102,755,820 bytes（約 98 MiB）。payload 96 ファイル / 展開後 約 363 MiB                                                                                                                                                                                                                                                         |
| 署名                  | ログに `signing with signtool.exe` と出るが証明書が無いので**署名されない**（`Get-AuthenticodeSignature` が installer / exe とも `NotSigned`）。方針どおり                                                                                                                                                                                                     |
| exe のバージョン情報  | ProductName / FileDescription `Fluvix Nexus`・FileVersion `1.0.0`・CompanyName `Piroshi`・LegalCopyright `Copyright (c) 2026 Piroshi`                                                                                                                                                                                                                          |
| `app.asar`            | 約 15 MiB。`out/main`・`out/preload`・`out/renderer`・`package.json`（`devDependencies` / `scripts` は落ちる）・`node_modules/@lydell/*`（unpack 済みの印だけ）                                                                                                                                                                                                |
| `app.asar.unpacked`   | `@lydell/node-pty` の JS 15 本（`worker/conoutSocketWorker.js`・`conpty_console_list_agent.js` を含む）と LICENSE・`@lydell/node-pty-win32-x64` の `conpty.node`・`conpty_console_list.node`                                                                                                                                                                   |
| `.pdb`                | `win-unpacked` にも installer の payload にも 0 件                                                                                                                                                                                                                                                                                                             |
| ライセンス            | `resources\LICENSE`・`resources\THIRD_PARTY_NOTICES.txt`（リポジトリのものとバイト一致）・`LICENSE.electron.txt`・`LICENSES.chromium.html`。installer の payload にも入っている                                                                                                                                                                                |
| Debug Adapter         | asar / unpacked に js-debug・debugpy・netcoredbg・`debug-adapters` は無い（userData に利用者が置く設計のまま）                                                                                                                                                                                                                                                 |
| smoke（win-unpacked） | 使い捨ての `--user-data-dir` で起動: `app.isPackaged` true・contextIsolation / sandbox true・nodeIntegration / webviewTag false・Renderer の `process` / `require` undefined・CSP は source と同じ・`window.fluvix` は従来の12ドメイン・Terminal（PowerShell）が約 0.2 秒で出力を返し `echo` の結果が届く・`main.log` の見出しが `packaged`、WARN / ERROR 0 件 |

全機能の確認（インストールしての起動・Monaco の Worker・Git / LSP / Debug など）は 7-2C（§8）。

## 6. repository を Public にする前の確認

### 6.1 Session 7-2A 時点の調査結果

対象は全 commit の履歴と、7-2A の変更を含む作業ツリー。

| 観点                                                   | 結果                                                                                                                                                            | 判断                                                                                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token / 秘密鍵のパターン（全履歴）                     | 当たるのは `src/main/logger/logRedaction.test.ts` の**伏せ字のテスト用に作った偽の値**（`ghp_ABCDEF…` / `github_pat_11ABCDEFG…`）と、それを探す正規表現だけ     | 問題なし                                                                                                                                                                           |
| `.env` / 鍵 / 証明書 / `settings.local.json`（全履歴） | 一度も commit されていない。`.gitignore` が除外している                                                                                                         | 問題なし                                                                                                                                                                           |
| 削除済みファイル（全履歴）                             | 設定の旧 store（Session 4-3A で統合）と `WorkspaceMenu.tsx` だけ                                                                                                | 問題なし                                                                                                                                                                           |
| **commit の author e-mail**                            | **全 commit の author が個人の e-mail アドレス**。Public にすると誰でも読める                                                                                   | **要判断**（そのまま公開する / 以後の commit を GitHub の noreply にする。履歴の書き換えは commit hash が変わり、記録済みの hash と食い違うので勧めない）→ **7-2E で決定（§9.2）** |
| `.claude/settings.json` / `.claude/launch.json`        | commit 済み。中身は `npm run verify` の許可と `npm run dev` の起動設定だけ                                                                                      | 公開して害は無い。残すかは任意                                                                                                                                                     |
| 開発 PC 固有の記述                                     | docs/DEVELOPMENT.md に検証用の一時パス（`D:\fx617`）と「Windows のユーザー名が Unicode」という記述。`logRedaction.test.ts` にユーザー名に似た文字列（テスト用） | 秘密情報ではない。気になる場合だけ直す                                                                                                                                             |
| 大きなファイル / バイナリ                              | 無い（最大は docs/ARCHITECTURE.md の約 1 MB）                                                                                                                   | 問題なし                                                                                                                                                                           |

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

**原稿は [release-notes/v1.0.0.md](release-notes/v1.0.0.md)**（7-2D）。GitHub Release の本文には、先頭の HTML コメントを除いた残りを貼る。7-2D で残っていた次の2つは 7-2E で済ませた（§9）。

- 「不具合の報告」の節を GitHub Issues にした（README にも同じ節を足した）
- 正式アイコンで作り直した installer から `SHA256SUMS.txt` を作った（下記）。**hash は本文に書かない**

`SHA256SUMS.txt` の作り方（`release\` で PowerShell。`sha256sum -c` と同じ書式・BOM なし・LF。7-2D で作成と照合、1 byte 変えた写しが不一致になることを確認）:

```powershell
$name = 'Fluvix-Nexus-Setup-1.0.0.exe'
$hash = (Get-FileHash $name -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path (Get-Location) 'SHA256SUMS.txt'), "$hash  $name`n", (New-Object Text.UTF8Encoding($false)))
```

項目の対応（原稿はこの表を満たす）:

| 項目           | 内容                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 概要           | 何のアプリか・v1.0.0 が最初の公開版であること                                                                                                                                                                      |
| 動作環境       | Windows 11 x64（7-2D で確かめた環境を書く）                                                                                                                                                                        |
| ダウンロード   | `Fluvix-Nexus-Setup-1.0.0.exe` と `SHA256SUMS.txt`。SHA-256 の確かめ方（`Get-FileHash`）                                                                                                                           |
| インストール   | per-user・管理者権限不要・**未署名のため SmartScreen の警告が出る**こと・**自動更新が無い**こと                                                                                                                    |
| 別途入れるもの | Git / GitHub CLI / Language Server / Debug Adapter と、入れた後にアプリを再起動すること（README へのリンク）                                                                                                       |
| データとログ   | `%APPDATA%\Fluvix Nexus`・`logs\main.log`。アンインストールしても残ること                                                                                                                                          |
| 既知の制約     | DESIGN.md §14 の表（Debug の制約・adapter は利用者が置く・Renderer の `file://`）                                                                                                                                  |
| ライセンス     | MIT・THIRD_PARTY_NOTICES.txt                                                                                                                                                                                       |
| 不具合の報告先 | GitHub Issues（`https://github.com/thpiroc/FluvixNexus/issues`。7-2E で決定）                                                                                                                                      |
| 7-2D で追加    | 上書きインストールで設定が残り、起動中のアプリは閉じて起動し直されること・Smart App Control でブロックされうること・アンインストール後に残る `fluvix-nexus-updater`・TypeScript は 6 系（7 では LSP が起動しない） |

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

### 8.1 Session 7-2C の結果（この PC）

7-2B で作った `release/Fluvix-Nexus-Setup-1.0.0.exe`（102,755,820 bytes・SHA-256 `B4D80D13…2CEF12`）をそのまま使った。コードは変えていない。確認は scratchpad の playwright-core で**インストール先の exe**を起動して行い（`npm run dev` / `out/` は使っていない）、Debug / LSP / Git / Files は ASCII の使い捨て Workspace（git は使い捨ての bare remote）、userData は使い捨ての `--user-data-dir` にした。既定の `%APPDATA%\Fluvix Nexus` はショートカットからの起動の観察だけに使った。

| 観点             | 結果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| インストール     | 約 5 秒で終了・UAC なし（installer / exe とも `asInvoker`）。`%LOCALAPPDATA%\Programs\fluvix-nexus` に 96 ファイル＋uninstaller（`win-unpacked` と全ファイル hash 一致・`.pdb` 0 件）。HKCU に `Fluvix Nexus 1.0.0` / 発行元 `Piroshi` / 1.0.0。Start Menu と Desktop にショートカット（AUMID `studio.fluvix.fluvixnexus`）。完了後に explorer.exe 経由でアプリが起動する。署名なし（`NotSigned`）。ローカルで作ったファイルには Mark-of-the-Web が無いため SmartScreen は出ていない（ダウンロードしたファイルでの表示は 7-2D） |
| 起動             | ショートカットから起動（親は explorer.exe）・`isPackaged` true・`app.asar` の `index.html`・ネイティブメニュー無し・タイトル `Fluvix Nexus`。二重起動: 2 本目は `another instance is already running` を書いて終わり、最小化していた 1 本目が元に戻って前面に出る                                                                                                                                                                                                                                                               |
| 境界             | contextIsolation / sandbox true・nodeIntegration / webviewTag false・webSecurity true。Renderer に `process` / `require` / `module` / `Buffer` / `electron` / `ipcRenderer` 無し。`window.fluvix` は 12 ドメインで frozen。CSP は source と同じで違反 0 件。console error 0 件                                                                                                                                                                                                                                                  |
| Monaco / Files   | Worker（editorWebWorkerMain / json / css / html / ts）が起動し、JSON と CSS に diagnostics が付く。Files の「新規ファイル」→ 0 byte で作成 → 編集 → Ctrl+S で保存（日本語を含む）→ タブ切り替えで内容が正しい                                                                                                                                                                                                                                                                                                                   |
| Terminal         | PowerShell が約 0.15 秒で出力。入力・stdout / stderr・resize（shell 側の幅 / 高さに反映）・閉じる・開き直し。実行中（`ping`）のタブは閉じる確認が出て、閉じるとシェルと孫の `PING.EXE` まで消える。`conpty.node` は `app.asar.unpacked` から読まれる。シェルに `ELECTRON_RUN_AS_NODE` は渡らない                                                                                                                                                                                                                                |
| Git              | status（変更 / 未追跡）・UI の diff（Monaco Diff Editor）・「すべて Stage」・UI から Commit・ブランチ作成 / そこで commit / main へ切り替え・push（ローカルの bare remote）・別 clone の commit を fetch（behind 1）→ pull。remote 一覧に URL / 絶対パスは出ない                                                                                                                                                                                                                                                                |
| LSP              | TypeScript / Python / C# とも `利用可能`。diagnostics（TS / Python）・hover・completion・definition（3 言語）。設定で LSP を切ると 3 つとも `使わない` になりプロセスが消え、戻すと 3 つとも `利用可能` に戻る。diagnostics / status の event に絶対パスとサーバのコマンドは載らない                                                                                                                                                                                                                                            |
| Debug            | STEP 6 Closing（6-17）の production 確認をインストール版に向け直して実行: Node.js（vscode-js-debug 1.117.0）82/82・Python（debugpy 1.8.21）48/48・C#（netcoredbg 3.2.0-1092）48/48。Profile・Start・breakpoint・Continue・Pause・Step Over / Into / Out・Stop・Call Stack・Variables・Evaluate・Debug Console・例外停止・停止位置・終了・プロセスと port の後片付け・Renderer へ adapter のパス / 引数が漏れないこと。F5 系 keybinding が Debug パネル背面でも効く（7-1A の仕様）                                               |
| Theme / Language | 設定画面でライト（`data-fx-theme="light"`）・English（`lang="en"`・UI 文言）へ即時に切り替わり、`settings.json` に保存される                                                                                                                                                                                                                                                                                                                                                                                                    |
| 終了と再起動     | Terminal と 3 つの language server が動いている状態で終了 → 16 プロセスすべて消える。同じ userData で起動し直すと Workspace・Theme・Language・Debug Profile・breakpoint・ウィンドウ位置が戻る（Files の展開と Editor のタブは設計どおり戻らない）。再度の終了でもプロセスが残らない                                                                                                                                                                                                                                             |
| 保存場所 / ログ  | userData に JSON（settings / window-state / workspace-folder / workspace-layout / debug-profiles / debug-breakpoints）・`debug-adapters`・`logs\main.log`。`main.log` は起動ごとに `packaged` の見出し・INFO 以上・WARN / ERROR 0 件・絶対パス / ユーザー名 / e-mail / token 0 件（`<path>` に伏せてある）。インストール先への書き込み 0 件・Workspace に `.vscode` / `.fluvix` 無し                                                                                                                                            |
| アンインストール | 約 16 秒・UAC なし。インストール先・アンインストール情報・ショートカットは消える。userData は残る（`deleteAppDataOnUninstall: false` の設計どおり）                                                                                                                                                                                                                                                                                                                                                                             |

v1.0.0 の Release blocker は見つからなかった。次は記録だけにした（v1.0.0 では直さない）。

| 項目                                                       | 内容                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `%LOCALAPPDATA%\fluvix-nexus-updater\installer.exe` が残る | electron-builder の NSIS がインストール時に installer の写し（98 MiB・同じ hash）を置き、アンインストールでは消さない。自動更新を入れないので使われない。Release notes で案内するか、7-2D 以降で扱いを決める |
| `main.log` の見出しの時刻                                  | 起動の見出し（`started`）が、同じ起動で先に書かれた行より数 ms 後の時刻になっている。並びは見出しが先で、読むのに困らない                                                                                    |
| 引き継ぎ                                                   | タスクバーのピン留め / グループ化の目視・ダウンロードしたファイルでの SmartScreen の表示・clean Windows での確認は 7-2D                                                                                      |

updater の installer の写しは、7-2D で v1.0.0 の既知の制約とした（§8.2 A4）。

### 8.2 Session 7-2D の結果（この PC でできる clean Windows 相当の確認）

7-2B の `release/Fluvix-Nexus-Setup-1.0.0.exe`（7-2C と同じ SHA-256 `B4D80D13…2CEF12`）をそのまま使った。コード・`electron-builder.yml`・依存は変えていない。PC は Windows 11 Home 25H2（ビルド 26200）x64・Smart App Control は Off・ユーザー名は Unicode。VM の新規構築はしていない（利用者の決定）。確認の手順と罠は docs/DEVELOPMENT.md §4 の Session 7-2D。

| #   | 観点                                  | 結果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | ツールが無い状態の案内 → 入れて再起動 | インストール版を、PATH を Windows の既定相当（System32 / Windows / Wbem / PowerShell / OpenSSH / WindowsApps）にし `%ProgramFiles%` 系を存在しないフォルダへ向け、新しい userData で起動（27/27）。Git パネル「Git が見つかりませんでした。」＋次の一手・GitHub CLI `cli-missing`・LSP 3言語とも `unavailable`（Status Bar「LSP: 未インストール」）・Terminal は PowerShell が動き Node / Claude Code は `available: false`・Debug は Node.js「Node.js が見つかりません。」/ Python「Python が見つかりません。」（WindowsApps の Store スタブを Python と誤認しない）/ C#「netcoredbg が見つかりません」。案内に絶対パス無し。同じ userData で PATH を戻して再起動すると Git `ready`・Pyright `ready`・Node の案内が「vscode-js-debug が配置されていません」へ進む |
| A2  | 初回起動と保存場所                    | 起動 0.3〜0.4 秒・言語 `ja`・Theme `dark`・「Workspace 未選択」・ネイティブメニュー無し。CSP 違反 0 件・console error 0 件。`main.log` は見出しが `packaged`・INFO 以上・ERROR 0 件・絶対パス / ユーザー名 0 件（WARN は Debug を起動しなかった理由の3行だけ）。Workspace とインストール先への書き込み 0 件                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A3  | 同じ版の上書きインストール            | 2回実施。インストール先 97 ファイルの hash 一致・アンインストール情報は1件のまま・ショートカットあり・既定 userData の JSON 4つの hash が変わらない。**アプリの起動中**に実行すると installer がアプリを終了させ（旧 Main とシェルは残らない）、完了後に起動し直す（約 36 秒）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A4  | アンインストール後に残るもの          | `UninstallString /S` で 9.5 秒・終了コード 0。インストール先・HKCU のアンインストール情報・`HKCU\Software\898845d0-…`（InstallLocation）・Start Menu / Desktop のショートカットは消える。残るのは `%APPDATA%\Fluvix Nexus`（設計どおり。JSON は作業前と hash 一致）と `%LOCALAPPDATA%\fluvix-nexus-updater\installer.exe`（98 MiB。インストールのたびに書き直される）。後者は **v1.0.0 の既知の制約**とし、NSIS / build 設定は変えない（利用者の決定）。Release notes と README に載せた                                                                                                                                                                                                                                                                           |
| A5  | SmartScreen                           | installer の写しに `Zone.Identifier`（`ZoneId=3`）を付けて Explorer から起動 → 約 9〜10 秒止まった後、**警告は出ずに** installer が起動し、Windows が `Zone.Identifier` を消した（HostUrl を変えて2回、同じ結果）。SmartScreen の設定・ポリシーで無効化された形跡は無い。この PC では警告の表示を確認できなかったため、文言は「表示された場合は『詳細情報』→『実行』」「Smart App Control ではブロックされることがある」とした。インストール先の exe には MOTW は付かない                                                                                                                                                                                                                                                                                          |
| A6  | タスクバーのピン留め / グループ化     | ショートカットの AppUserModelID は `studio.fluvix.fluvixnexus`、ウィンドウに明示の AppUserModelID は無い、Electron の既定の書式 `electron.app.$1` が exe に入っている、までを確認。この PC は「結合しない」設定でボタンから AppID を読めず、UI Automation でのピン留めは利用者が作業中のデスクトップを奪うため途中でやめた。**目視は未了**（下の未確認事項）                                                                                                                                                                                                                                                                                                                                                                                                       |
| A7  | VC++ ランタイム                       | 同梱の `conpty.node` / `conpty_console_list.node` / `Fluvix Nexus.exe` などは `vcruntime140` / `msvcp140` を import しない。`dxil.dll` が使うのは Windows 10 以降に標準の UCRT（`api-ms-win-crt-*`）だけ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A8  | Release notes と SHA-256              | 原稿を [release-notes/v1.0.0.md](release-notes/v1.0.0.md) に確定（§7）。`SHA256SUMS.txt` を §7 の手順で作り、Release notes の PowerShell 手順で `True`、Git Bash の `sha256sum -c` で `OK`、1 byte 変えた写しで `False`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

7-2D で見つかり、docs で直したもの（コードは変えていない）:

| 項目                                      | 内容                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| README の TypeScript LSP の手順が動かない | npm の `typescript` の `latest` が 7.0.2 になり `tsserver.js` を含まない。README どおり `npm i -g typescript-language-server typescript` で入れると、インストール版で `Could not find a valid TypeScript installation` → 立て直しを繰り返す。`typescript@6`（6.0.3）なら `ready`。README / DEVELOPMENT.md / Release notes を `typescript@6` にし、既知の制約に足した |

`npm audit`（7-2B からの持ち越し）: `--omit=dev` は 0 件。全体の 4 件は次のとおりで、**v1.0.0 の Release blocker ではない**（依存は上げない。利用者の決定）。

| パッケージ                                                        | 重大度         | 判断                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest` / `@vitest/mocker`                                       | moderate       | テストだけで使う。installer に入らない                                                                                                                                                                                                                                                                                                                                                                                 |
| `dompurify` 3.4.8（monaco-editor 0.56.0 に同梱）/ `monaco-editor` | moderate / low | Renderer のバンドルに入る。4件の advisory は `IN_PLACE`・`setConfig()` / `clearConfig()`・`CUSTOM_ELEMENT_HANDLING` を使ったときの問題で、monaco の `domSanitize.js` は呼ぶたびに設定を渡し、これらを使わない（hook は毎回 `removeAllHooks()` で外す）。CSP は `script-src 'self'`。npm の提案する修正は monaco-editor 0.53.0 への major の後退なので採らない。monaco-editor が dompurify を上げた版を出したら追従する |

**別 PC / VM でしか確かめられない未確認事項**（v1.0.0 ではここを確かめずに出す。Release notes はどれも「起こりうる」前提で書いてある）:

| 項目                                                            | この PC で確かめられない理由                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SmartScreen の警告画面の表示と「詳細情報」→「実行」             | この PC では MOTW 付きでも警告が出なかった                                                                                                                                                                                                                                             |
| Smart App Control が有効（評価モード / オン）の PC での実行可否 | この PC は Off（オンに戻すには Windows の再インストールが要る）                                                                                                                                                                                                                        |
| ブラウザで GitHub から実際にダウンロードしたファイル            | 公開後、未認証のダウンロードでの hash の照合は済んだ（§9.5）。ブラウザ経由の MOTW と SmartScreen の表示は未確認                                                                                                                                                                        |
| .NET が入っていない PC での C# の案内（`runtime-not-found`）    | .NET は `C:\Program Files\dotnet` を固定で探し、この PC には入っている                                                                                                                                                                                                                 |
| Git / Node.js を実際にインストールしてからの検出                | この PC には入っている（A1 は PATH と環境変数を削った擬似確認）                                                                                                                                                                                                                        |
| ASCII のユーザー名・新しいユーザープロファイル・英語版 Windows  | この PC は Unicode のユーザー名・日本語の表示。新しいユーザーの作成には管理者の承認が要る                                                                                                                                                                                              |
| タスクバーのピン留め / グループ化の目視                         | 自動操作を途中でやめた（A6）。インストールし、実行中のボタンからピン留め → 閉じる → ピンから起動して、ボタンが1つにまとまるかを見る。2つに分かれたら `app.setAppUserModelId('studio.fluvix.fluvixnexus')` を足す（コード変更）。**7-2E で、v1.0.0 では変えずに未確認のまま出すと決定** |

## 9. Session 7-2E（公開の準備と公開後の確認）

7-2E では、GitHub 上で公開する直前までを済ませ、利用者の公開後に §9.5 を確かめた。**repository の Public 化と Release の公開は利用者が GitHub の画面で行う**（Claude Code は行わない。この PC に GitHub CLI は入れていない）。コード・`electron-builder.yml`・依存・installer は変えていない。

### 9.1 §6.2 の再確認（7-2E の直前・全履歴 73 commit）

| 観点                             | 結果                                                                                                                 | 判断        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| token / 秘密鍵のパターン         | 当たるのは `logRedaction.test.ts` の偽の値・`logRedaction.ts` の正規表現・本書に載せた検索コマンドと 7-2A の記録だけ | 問題なし    |
| 秘密情報になりうる名前のファイル | `themeTokens.ts` / `themeTokens.test.ts`（名前に `token` を含むだけ）                                                | 問題なし    |
| 削除済みファイル                 | 7-2A と同じ（設定の旧 store と `WorkspaceMenu.tsx`）                                                                 | 問題なし    |
| commit の author / committer     | 73 commit すべて `Piroshi` と個人の e-mail アドレス                                                                  | §9.2 で決定 |
| installer / asar / `release/`    | commit されていない                                                                                                  | 問題なし    |
| 大きなファイル                   | 最大は `resources/icon.png`（約 1.3 MB）                                                                             | 問題なし    |
| `npm run verify`                 | 通過（テスト 4613 passed / 1 skipped）                                                                               | 問題なし    |

### 9.2 7-2E で決めたこと

| 項目                              | 決めたこと                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| commit の author e-mail           | **過去の履歴は書き換えずに公開する。** 7-2E の commit 以降は GitHub の noreply アドレス（`272251618+thpiroc@users.noreply.github.com`）を使う。このリポジトリの `.git/config`（`--local`）に設定した |
| 不具合の報告先                    | GitHub Issues。Release notes と README に書いた                                                                                                                                                      |
| GitHub 上の操作                   | draft Release の作成・Public 化・公開は利用者が画面で行う（§9.4）                                                                                                                                    |
| タスクバーのピン留め / グループ化 | v1.0.0 では `setAppUserModelId` を足さない。§8.2 の未確認事項のまま出す                                                                                                                              |
| 公開する installer                | 正式アイコンの修正版で作った installer（§5.3）を**作り直さずに**使う                                                                                                                                 |

### 9.3 公開する installer の確認

作り直さずに、installer の中身が tag を打つ commit のソースから作られたものであることを確かめた。

| 観点             | 結果                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ファイル         | `Fluvix-Nexus-Setup-1.0.0.exe` 103,066,939 bytes                                                                                                                                                             |
| payload          | 7-Zip（electron-builder の cache の `7za.exe`）で installer を展開し、`release/win-unpacked` と全ファイル一致                                                                                                |
| `app.asar`       | 展開した `out/` がリポジトリの `out/` と全ファイル一致。`package.json` は version `1.0.0`・`dependencies` が同じ。`out/` より新しい `src` のファイルは無く、`src` / 依存は 7-2B の commit 以降変わっていない |
| ライセンス       | `resources\LICENSE`・`resources\THIRD_PARTY_NOTICES.txt` がリポジトリのものとバイト一致                                                                                                                      |
| `SHA256SUMS.txt` | §7 の手順で `release/` に作成（95 bytes・BOM なし・LF）。`sha256sum -c` が `OK`、Release notes の PowerShell の照合が `True`                                                                                 |

SHA-256 は `8caf663785834a016ca78fc6b74dee94ae7468cefcdf1ffd5c10abd81d25ec7c`（Release notes の本文には書かない）。

### 9.4 利用者が行う公開の手順

tag `v1.0.0` は 7-2E の commit に付けて push 済み。GitHub の画面で次を行う。

| 順  | 操作                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Releases → Draft a new release。tag は既存の `v1.0.0`、タイトルは `Fluvix Nexus v1.0.0`                                                   |
| 2   | 本文に `docs/release-notes/v1.0.0.md` の先頭の HTML コメントを除いた残りを貼る（`release/release-body-v1.0.0.md` に用意した）             |
| 3   | `release/` の `Fluvix-Nexus-Setup-1.0.0.exe` と `SHA256SUMS.txt` の2つだけを添付する                                                      |
| 4   | 「Set as the latest release」を選び、「Save draft」。Preview で本文と添付を確かめる                                                       |
| 5   | Settings → General → Danger Zone → Change visibility → Public。Features の Issues が有効であることも確かめる                              |
| 6   | draft を開き「Publish release」                                                                                                           |
| 7   | ログインしていないブラウザで Release から2つをダウンロードし、Release notes の PowerShell で `True` を確かめる（§8.2 の未確認事項の一つ） |

利用者が 1〜6 を行い、2026-09-16 22:01（JST。`published_at` `2026-09-16T13:01:04Z`）に公開した。7 は §9.5 で確かめた。

### 9.5 公開後の確認

**v1.0.0 は https://github.com/thpiroc/FluvixNexus/releases/tag/v1.0.0 で公開済み。** 確認はどれも認証を付けずに行った（GitHub API と `releases/download/` の URL）。

| 観点                 | 結果                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| repository           | `visibility: public`・Issues 有効・license `MIT`。トップ・Release・Issues のページが未ログインで 200                                                         |
| Release              | tag `v1.0.0`・タイトル `Fluvix Nexus v1.0.0`・draft / prerelease でない・`releases/latest` が v1.0.0 を指す。Release は v1.0.0 の1件だけ                     |
| tag                  | リモートの `v1.0.0` は 7-2E で push した annotated tag のまま（commit `db8d80c` を指す）。GitHub 上で作り直されていない                                      |
| 本文                 | `release/release-body-v1.0.0.md` と一致（改行の差を除く）。HTML コメントは入っておらず、Issues へのリンクがある                                              |
| 添付                 | `Fluvix-Nexus-Setup-1.0.0.exe`（103,066,939 bytes・GitHub の `digest` が §9.3 の SHA-256 と同じ）と `SHA256SUMS.txt`（95 bytes）の2つだけ                    |
| ダウンロードでの照合 | 未認証で2つをダウンロードし、Release notes の PowerShell の照合が `True`。どちらも `release/` のファイルとバイト一致。installer は `NotSigned`（方針どおり） |

未確認のまま残るもの: ブラウザでダウンロードしたときの MOTW と SmartScreen の表示（`Invoke-WebRequest` は MOTW を付けない。§8.2 のとおり、この PC では MOTW 付きでも警告が出なかった）。
