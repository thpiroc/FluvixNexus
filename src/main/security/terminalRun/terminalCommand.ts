import type { PlatformId } from '@shared/api'

/**
 * Agent が実行を求めたコマンドの「形」の規則（Security Core v1 の STEP8。Electron にも fs にも依存しない）。
 *
 * 長さ・制御文字・見えない文字・コマンド全体 2,000 文字は、承認の側（STEP6 の
 * approvalAction.ts）がすでに見る。ここが足すのは **Command Runner だけが持つ規則**。
 *
 * ```
 * command     PATH 上の名前だけ（npm / node / git / npm.cmd）。絶対パス・相対パス・区切りは拒む
 * 拡張子      Windows は .com / .exe / .bat / .cmd だけ。書かなければこの順に探す
 * .cmd / .bat 引数は安全な文字だけ（cmd.exe を通るため）。1文字でも外れたら拒む
 * ```
 *
 * ## なぜ PATH 上の名前だけか（2026-09-23 確定）
 *
 * 絶対パスを受け付けると、利用者の名前を含む実体の場所が画面・Audit・binding に
 * 出る（STEP6 の「cwd は Workspace 相対」と同じ理由）。`./gradlew` のような
 * **Workspace の中の実行ファイルも v1 では拒む** ── Workspace の中身は clone して
 * きただけのファイルでもありうる。Workspace の中のスクリプトを動かしたい場合は
 * `node scripts/build.js` のように、PATH 上の実行ファイルへ引数として渡す形になり、
 * 承認の画面にもその形のまま出る。
 *
 * ## なぜ .cmd / .bat の引数を絞るか（2026-09-23 確定）
 *
 * Windows の CreateProcess は .cmd / .bat を直接起動できず、`cmd.exe /c` で包む
 * 必要がある。包むと**引数が cmd.exe に解釈し直される** ── `&` `|` `<` `>` `^` `%`
 * `!` `"` `(` `)` は命令の区切り・展開・引用になり、シェルを通さないはずの argv が
 * シェルの文字列に戻る（いわゆる BatBadBut）。そこで .cmd / .bat へ渡す引数は
 * **英数字と `_ - . / : = @ , + \` だけ**でできているものに限り、空の引数・空白も
 * 拒む（どちらも引用が要る）。npm / npx の普段の使い方（`run test` / `--version` /
 * `--save-dev=typescript@5.4.0`）はこの範囲に入る。
 */

/** Windows で実行ファイルとして扱う拡張子（探す順。Windows 既定の PATHEXT の先頭と同じ）。 */
export const WINDOWS_EXECUTABLE_EXTENSIONS: readonly string[] = Object.freeze([
  '.com',
  '.exe',
  '.bat',
  '.cmd'
])

/** cmd.exe を通して起動する拡張子。 */
const BATCH_EXTENSIONS: readonly string[] = Object.freeze(['.bat', '.cmd'])

/**
 * PATH 上の名前として受け付ける形。
 *
 * 先頭は英数字（`-` で始まる名前は、起動する側でオプションと読まれうる）。
 * 区切り（`/` `\`）・ドライブ（`:`）・空白・引用符・ワイルドカードは入らない。
 */
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

/** Windows の予約デバイス名（`nul` / `con.exe` など）。 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** .cmd / .bat へ渡してよい引数（1文字以上。空白も引用符も無い）。 */
const SAFE_BATCH_ARGUMENT = /^[A-Za-z0-9_\-./:=@,+\\]+$/

/** cmd.exe の `"…"` の中でも展開・終端されてしまう文字（実行ファイルのパスに入っていたら包めない）。 */
const UNSAFE_BATCH_PATH_CHARACTER = /[%"\r\n]/

/** 実行ファイルの種類。 */
export type TerminalExecutableKind = 'program' | 'batch'

/** PATH 上の名前として受け付けるか。 */
export function isAcceptableCommandName(command: unknown): command is string {
  if (typeof command !== 'string' || !COMMAND_NAME.test(command)) {
    return false
  }

  // `..` や末尾のドット（Windows は黙って落とす）は、書いたものと開くものがずれる。
  if (command.endsWith('.') || command.includes('..')) {
    return false
  }

  return !RESERVED_DEVICE_NAME.test(command)
}

/**
 * PATH の各フォルダで探す名前の候補。
 *
 * Windows で拡張子まで書かれていればその名前だけ、書かれていなければ
 * `.com` / `.exe` / `.bat` / `.cmd` を順に足したもの。実行ファイルでない拡張子
 * （`.ps1` / `.js` / `.vbs`）を書いた名前は候補を返さない（関連付けで何が動くか
 * 決まるものは起動しない）。
 */
export function executableNameCandidates(command: string, platform: PlatformId): readonly string[] {
  if (platform !== 'win32') {
    return [command]
  }

  const lowered = command.toLowerCase()

  if (WINDOWS_EXECUTABLE_EXTENSIONS.some((extension) => lowered.endsWith(extension))) {
    return [command]
  }

  return WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${command}${extension}`)
}

/** 見つかった実行ファイルの種類（Windows の .bat / .cmd は cmd.exe を通す）。 */
export function executableKindOf(file: string, platform: PlatformId): TerminalExecutableKind {
  if (platform !== 'win32') {
    return 'program'
  }

  const lowered = file.toLowerCase()

  return BATCH_EXTENSIONS.some((extension) => lowered.endsWith(extension)) ? 'batch' : 'program'
}

/** .cmd / .bat へ渡してよい引数か。 */
export function isSafeBatchArgument(arg: unknown): boolean {
  return typeof arg === 'string' && SAFE_BATCH_ARGUMENT.test(arg)
}

/** cmd.exe で `"…"` に包んで起動してよい実行ファイルのパスか。 */
export function isSafeBatchPath(file: unknown): boolean {
  return typeof file === 'string' && file.length > 0 && !UNSAFE_BATCH_PATH_CHARACTER.test(file)
}
