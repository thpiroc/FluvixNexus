import type { DebugProfileId, DebugProfileLanguage } from '@shared/debug'
import type { DebugAdapterCommand } from './adapterCatalog'

/**
 * 解決済みの launch 構成（Session 6-10）── **Main の中だけにある形。**
 *
 * docs/ARCHITECTURE.md §20.6。Debug Profile（shared/debug/profile.ts）と型を分け、
 * **置き場所で分離を担保する**。
 *
 * | 型                            | 置き場所                  | IPC に載るか |
 * | ----------------------------- | ------------------------- | ------------ |
 * | `DebugProfile`                | shared/debug/profile.ts   | 載る         |
 * | `ResolvedLaunchConfiguration` | main/debug/resolvedLaunch.ts（ここ） | **載らない** |
 *
 * ここには adapter の絶対パス・adapter の引数・cwd・環境・program の絶対パスが入る。
 * どれも「何のプログラムが、どこで動くか」を決める値で、**shared から import できない
 * 場所に置くことで、契約（shared/ipc）の型に紛れ込む経路そのものを無くしてある。**
 *
 * 作るのは main/debug/profileResolver.ts だけ、使うのは main/debug/debugProfiles.ts
 * （Debug Session の起動）だけになる。
 */

/**
 * DAP の `launch` request の引数。
 *
 * **プログラムが何をするか**に関わる値だけがここに入る（profile の欄を Main が解いたもの）。
 * adapter の実行ファイル・引数はここに無い ── それは `spawn()` の引数（`adapterCommand`）で、
 * `programArgs` は adapter のコマンドラインに一語も現れない（§20.4）。
 */
export interface DebugLaunchRequestArguments extends DebugLaunchLanguageOptions {
  /** 表示用の名前（profile の `name`）。 */
  readonly name: string
  /** adapter が launch 構成を見分ける種類（言語ごとの表。profileResolver.ts）。 */
  readonly type: string
  readonly request: 'launch'
  /** 対象のプログラムの絶対パス（realpath まで検証したもの）。 */
  readonly program: string
  /** プログラムへの引数。shell を通さない。 */
  readonly args: readonly string[]
  /** プログラムの作業ディレクトリ。**常に Workspace root**（§20.3）。 */
  readonly cwd: string
  /** プログラムの環境変数（environmentPolicy.ts を通したもの）。 */
  readonly env: Readonly<Record<string, string>>
  readonly stopOnEntry: boolean
  /**
   * 出力先。**Debug Console 固定**（§20.3）。`integratedTerminal` / `externalTerminal` にすると
   * adapter が `runInTerminal` を頼んでくる経路になる（§20.9 で拒否している）。
   */
  readonly console: 'internalConsole'
}

/**
 * 言語ごとに launch request へ足す固定の欄（Session 6-12）。
 *
 * **profile の欄からは作らない。** 利用者が変える値ではなく、この版が adapter をどう使うかの
 * 決めで、値は profileResolver.ts の閉じた表だけが持つ。
 */
export interface DebugLaunchLanguageOptions {
  /**
   * debugpy の子プロセスへの注入。**常に false**（§20.20）。既定の true では、debuggee が
   * 起こした子プロセスが `debugpyAttach` に応えて2本目のセッションが張られるまで待たされる
   * ── v1 は同時セッション1本なので応える手段が無く、`subprocess.run(...)` が返らなくなる。
   */
  readonly subProcess?: false
}

export interface ResolvedLaunchConfiguration {
  readonly profileId: DebugProfileId
  readonly language: DebugProfileLanguage
  /** `initialize` の `adapterID`。 */
  readonly adapterId: string
  /** adapter のプロセスをどう立てるか（絶対パス・adapter の引数・cwd・環境）。 */
  readonly adapterCommand: DebugAdapterCommand
  readonly launchArguments: DebugLaunchRequestArguments
}
