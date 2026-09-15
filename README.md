# Fluvix Nexus

Files・Editor・Terminal・Git・Debug を自由に組み替えて使える、Windows 向けの軽量コードエディタです。

> English summary is at the [end of this file](#english).

---

## 動作環境

| 項目 | 内容                                             |
| ---- | ------------------------------------------------ |
| OS   | Windows 11（x64）                                |
| 配布 | GitHub Releases のインストーラー（ユーザー単位） |

Node.js・Python・.NET SDK・Git はアプリに同梱していません。使いたい機能に応じて、PC にインストールされているものを検出して使います（[別途インストールするもの](#別途インストールするもの)）。

## インストール

1. GitHub Releases から Fluvix Nexus の Setup（`.exe`）をダウンロードします。
2. 実行するとユーザー単位でインストールされます（管理者権限は不要です）。
3. スタートメニューまたはデスクトップのショートカットから起動します。

- **コード署名をしていません。** 初回は Windows SmartScreen の警告が出ることがあります。「詳細情報」→「実行」で続行できます。
- **自動更新はありません。** 新しい版は Releases からダウンロードして、同じ手順で上書きインストールしてください。

## 主な機能

| 機能      | 内容                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Workspace | フォルダを開いて作業します。前回開いていたフォルダと、パネルの配置（分割・タブ・大きさ）は次回起動時に戻ります              |
| Files     | ファイルツリー / カラム表示、作成・改名・移動・コピー・削除（ごみ箱へ）、ファイル名検索・全文検索                           |
| Editor    | Monaco Editor、複数タブ、保存 / 別名で保存 / Auto Save、アプリの外での変更の検出                                            |
| Terminal  | 複数タブ。PowerShell / Node / Claude Code を起動できます                                                                    |
| Git       | 変更の一覧と差分、Stage / Commit / Push / Pull / Fetch、ブランチ、履歴、stash、remote、マージと競合の解決                   |
| GitHub    | フォルダを GitHub のリポジトリとして公開します（GitHub CLI が必要）                                                         |
| LSP       | JavaScript / TypeScript・Python・C# の補完、エラー表示、定義へ移動、参照、名前の変更、整形                                  |
| Debug     | Node.js・Python・C# の Breakpoint、Continue / Pause / Step / Stop、Call Stack、Variables、Debug Console                     |
| Settings  | 表示言語（日本語 / English）、Theme（Dark / Light）、Editor / Files / Terminal / LSP の設定、キーボードショートカットの一覧 |

## 別途インストールするもの

どれも**任意**です。入っていない機能だけが使えなくなり、画面に案内が出ます。インストールした後は **Fluvix Nexus を再起動**してください（起動時の PATH を使うため。反映されない場合はサインアウトして入り直してください）。

Fluvix Nexus は開いたフォルダの中にある実行ファイルを起動しません。どれも PATH など、フォルダの外から見つかる場所に置いてください。

### Git / GitHub

| 機能          | 必要なもの                                          |
| ------------- | --------------------------------------------------- |
| Git パネル    | [Git for Windows](https://git-scm.com/download/win) |
| GitHub へ公開 | [GitHub CLI](https://cli.github.com/)（`gh`）       |

### Language Server（LSP）

| 言語                    | インストール                                          |
| ----------------------- | ----------------------------------------------------- |
| JavaScript / TypeScript | `npm i -g typescript-language-server typescript`      |
| Python                  | `npm i -g pyright`                                    |
| C#                      | `dotnet tool install -g csharp-ls`（.NET SDK が必要） |

言語ごとの有効 / 無効は Settings の LSP から切り替えられます。

### Debug Adapter

Debug 対象のプログラムは、あらかじめ Debug パネルの Profile で指定します（Workspace 内の相対パス）。

| 言語    | 必要なもの                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js | PATH に `node.exe` と、下記の vscode-js-debug 1.117.0 を所定の場所に置くこと（`.js` / `.mjs` / `.cjs`）                               |
| Python  | PATH の `python` で `import debugpy` できること（`pip install debugpy`）                                                              |
| C#      | PATH に `netcoredbg`（[Samsung/netcoredbg](https://github.com/Samsung/netcoredbg/releases)）と .NET。build 済みの `.dll` を指定します |

**Node.js（vscode-js-debug）の置き方**（PowerShell）:

```powershell
$version = '1.117.0'
curl.exe -L -o js-debug-dap.tar.gz "https://github.com/microsoft/vscode-js-debug/releases/download/v$version/js-debug-dap-v$version.tar.gz"
(Get-FileHash js-debug-dap.tar.gz -Algorithm SHA256).Hash   # AD8D04EDE9D4B75CC290FD5438A65047A06F786D04F604B6112485B36F090772
$dest = Join-Path $env:APPDATA "Fluvix Nexus\debug-adapters\js-debug-dap-v$version"
New-Item -ItemType Directory -Force $dest | Out-Null
tar.exe -xzf js-debug-dap.tar.gz -C $dest
```

SHA-256 が一致しないファイルは展開しないでください。Fluvix Nexus は起動のたびに中身を確かめ、公式の配布物と1バイトでも違えば使いません。

**C#（netcoredbg）の注意:** Windows 版 netcoredbg の制約により、netcoredbg・dotnet・対象の `.dll`・開いているフォルダのパスが **ASCII 文字だけ**のときにしか Debug を開始できません（例: `C:\tools\netcoredbg`）。

## データの保存場所

| 内容                                                                             | 場所                                    |
| -------------------------------------------------------------------------------- | --------------------------------------- |
| 設定・ウィンドウ / パネルの配置・最後に開いたフォルダ・Debug Profile・Breakpoint | `%APPDATA%\Fluvix Nexus`                |
| Node.js の Debug Adapter（利用者が置くもの）                                     | `%APPDATA%\Fluvix Nexus\debug-adapters` |
| ログ                                                                             | `%APPDATA%\Fluvix Nexus\logs\main.log`  |

開いたフォルダの中には何も書き込みません。

不具合を報告するときは `logs` フォルダの `main.log` と `main.old.log` を添えてください。ログファイルでは絶対パスと認証情報を伏せています。

## アンインストール

Windows の「設定」→「アプリ」→「インストールされているアプリ」から Fluvix Nexus をアンインストールします。設定などのデータ（`%APPDATA%\Fluvix Nexus`）は残ります。完全に削除する場合は、このフォルダも削除してください。

## 既知の制約（v1.0.0）

- 自動更新・コード署名はありません。Debug Adapter の同梱・自動ダウンロードもありません
- Debug 対象のプログラムは本物の端末を持ちません。標準入力・端末サイズ・色を使うプログラムは Debug Console では同じように動きません
- Breakpoint は行の挿入・削除に追従しません
- Debug を開始した後に Adapter が終了した場合、理由は画面ではなくログに残ります
- Variables は1回に 500 件までで、続きを読み込む操作はありません。Debug Console の行数に上限はありません
- C# の Debug は ASCII 文字だけのパスでのみ使えます
- Node.js の Debug では、Pause の理由が step と表示される、ESM の top-level で起きた例外では止まらない、などの違いがあります
- 実行が止まった位置を Editor で開くと、フォーカスも Editor へ移ります
- 画面（Renderer）はアプリに同梱したファイルだけを読み込みますが、仕組み上、PC 上のローカルファイルを読める状態にあります。外部のページやスクリプトを読み込まない構成で運用しており、将来の版で見直します

## ライセンス

Fluvix Nexus は [MIT License](LICENSE) で配布しています。

同梱している第三者ソフトウェアのライセンスは [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) にあります。Electron / Chromium のライセンスはインストール先の `LICENSE.electron.txt` / `LICENSES.chromium.html` にあります。

## 開発者向け

- [DESIGN.md](DESIGN.md) — 製品としての設計方針
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 実装の構造とセキュリティ
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 開発環境・コマンド・動作確認
- [docs/RELEASE.md](docs/RELEASE.md) — リリースの仕様と手順

---

## English

Fluvix Nexus is a lightweight code editor for Windows with dockable Files, Editor, Terminal, Git and Debug panels.

- **Requirements:** Windows 11 (x64). Node.js, Python, .NET SDK and Git are not bundled; install them only for the features you use and restart the app afterwards.
- **Install:** download the Setup `.exe` from GitHub Releases. It installs per user (no administrator rights). The installer is not code-signed, so Windows SmartScreen may warn on first run. There is no auto-update.
- **Language servers:** `typescript-language-server`, `pyright` and `csharp-ls` are detected from `PATH`.
- **Debug adapters:** vscode-js-debug 1.117.0 (placed under `%APPDATA%\Fluvix Nexus\debug-adapters`, see the PowerShell steps above), `debugpy`, and `netcoredbg` (ASCII-only paths).
- **Data:** settings and logs are stored in `%APPDATA%\Fluvix Nexus`; nothing is written into the opened folder.
- **UI language:** Japanese and English (Settings → General).
- **License:** [MIT](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
