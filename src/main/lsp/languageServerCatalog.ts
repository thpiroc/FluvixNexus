import type { PlatformId } from '@shared/api'
import {
  findExecutableOnPath,
  findInDirectory,
  trimTrailingSeparator,
  type FileExistsCheck
} from '../platform/executablePath'

/**
 * どの Language Server を、どこから起動するかを決める表
 * （Electron / fs / child_process 非依存・テスト対象）。
 *
 * ## Renderer から起動するものを指定できない、その実体がここにある
 *
 * Terminal の表（main/terminal/shellCommand.ts）と同じ形にしてある。
 *
 * ```
 * Renderer から渡せるもの   … 何も無い（Session 5-1 の時点で IPC の口が無い）
 * いずれ渡せるようになるもの … この表の行を指す閉じた集合の値（LanguageServerId）
 * 渡せないままにするもの     … 実行ファイル・引数・作業ディレクトリ・絶対パス
 * ```
 *
 * 行の中身 ── 何という実行ファイルを、どこから解決して、どんな引数で起動するか
 * ── は Main のこのファイルだけが持つ。したがって Document Synchronization を
 * 載せた後も、「Renderer からの要求で任意の実行ファイルが動く」という形は作られない。
 *
 * ## PATH は「辿る」が「任せない」
 *
 * ここが Terminal / Git と同じ規則を使う理由でもある
 * （main/platform/executablePath.ts）。実行ファイル名だけを `spawn` へ渡すと、
 * Windows の CreateProcess は**作業ディレクトリを先に見る**。
 * Language Server の作業ディレクトリは利用者が開いた Workspace そのもので、
 * その中に `csharp-ls.exe` が置かれていることは十分ありうる
 * ── clone してきたリポジトリの中身は、この時点ではただのファイルでしかない。
 *
 * **「フォルダを開いてコードを表示した」が「そのフォルダの中の実行ファイルが動く」に
 * なっては困る。** Terminal と違い、Language Server は利用者が明示的に起動する
 * ものですらない（ファイルを開いただけで立ち上がる）ため、この線は Terminal より
 * 強く効く必要がある。
 *
 * ## v1 に載せる3つ
 *
 * | id           | サーバ                        | 入手経路                     |
 * | ------------ | ----------------------------- | ---------------------------- |
 * | `typescript` | typescript-language-server    | npm（グローバル）            |
 * | `python`     | pyright-langserver            | npm（グローバル）            |
 * | `csharp`     | csharp-ls                     | dotnet tool（グローバル）    |
 *
 * C# を Roslyn Language Server ではなく **csharp-ls** にしてあるのは、
 * 前者が Visual Studio / C# Dev Kit の配布物に紐づき、単体で入手して
 * stdio で話す形が安定しないため。csharp-ls は `dotnet tool install` だけで入り、
 * 標準入出力で LSP を話す。
 *
 * どれもアプリには同梱しない（DESIGN.md §5）。入っていない PC はふつうにあり、
 * 見つからなければ `null` を返して**その言語だけが使えない**に留める
 * ── アプリが起動しない理由にはしない。
 *
 * ## `.cmd` は直接起動できない
 *
 * npm が Windows に置くのは `typescript-language-server.cmd`（バッチ）で、
 * CreateProcess はバッチを直接実行できない。`cmd.exe /c <絶対パス>` で包むが、
 * **その `cmd.exe` も `%SystemRoot%` から組み立てる**（PATH に任せない）。
 * 包む対象は PATH から実体を確かめた絶対パスなので、ここでも
 * 「開いたフォルダの中身」は起動されるものに影響しない。
 *
 * `%SystemRoot%` の組み立てを main/terminal/shellCommand.ts と共有していないのは、
 * 共有すべきものが**規則ではなく定数**だから ── 規則（PATH の辿り方）は
 * platform 層に1つだけ置いてあり、両方がそれを使っている。
 */

/**
 * 表の行。
 *
 * 増やすときは、ここと `LANGUAGE_SERVER_IDS` と `resolveLanguageServerCommand`
 * の3つを足す（型がどの漏れも拾う）。
 */
export type LanguageServerId = 'typescript' | 'python' | 'csharp'

/** 並べる順。ログと診断の見た目を安定させるためだけの順序で、優先度ではない。 */
export const LANGUAGE_SERVER_IDS = ['typescript', 'python', 'csharp'] as const

/**
 * 境界の外から届いた値が、表の行を指しているか。
 *
 * Session 5-1 の時点で外から値が届く経路は無いが、行を指す値を受け取る形は
 * Document Synchronization（Session 5-2）で必要になる。**確かめる側を
 * 表と同じファイルに置く**ことで、行を足したときに検証の漏れが起きないようにする。
 */
export function isLanguageServerId(value: unknown): value is LanguageServerId {
  return typeof value === 'string' && (LANGUAGE_SERVER_IDS as readonly string[]).includes(value)
}

/** 起動するもの1つ分。Main の中だけで使う（Renderer へは渡さない）。 */
export interface LanguageServerCommand {
  /** ログに出す名前。実行ファイルのパスではない。 */
  readonly name: string
  /** 実行ファイルの絶対パス。 */
  readonly file: string
  readonly args: readonly string[]
}

/** 画面にもログにも出す名前（解決できなかった行にも名前は要る）。 */
const SERVER_NAMES: Record<LanguageServerId, string> = {
  typescript: 'TypeScript Language Server',
  python: 'Pyright',
  csharp: 'csharp-ls'
}

/** Windows の cmd.exe（`%SystemRoot%` からの相対位置）。`.cmd` を包むためだけに使う。 */
const WINDOWS_CMD_RELATIVE = 'System32\\cmd.exe'

/**
 * dotnet のグローバルツールの既定の置き場所（ホームからの相対位置）。
 *
 * `dotnet tool install --global` は PATH への追加を促すが、追加していない PC は
 * ふつうにある（インストール直後の再起動前もそれにあたる）。
 * Git for Windows が PATH に入らないことがあるのと同じ扱いで、
 * PATH で見つからなかったときだけ当たる（main/git/gitExecutable.ts）。
 */
const DOTNET_TOOLS_RELATIVE = '.dotnet'

/**
 * 表の1行を実際の起動コマンドへ解決する。
 *
 * この PC に入っていなければ null。呼び出し側は「その言語だけが使えない」として扱う
 * （main/lsp/languageServers.ts の `server-unavailable`）。
 *
 * `env` と `exists` を引数で受け取るのは、`process.env` / `fs` を直接読むと
 * この判断がテストできなくなるため（shellCommand.ts / gitExecutable.ts と同じ分け方）。
 */
export function resolveLanguageServerCommand(
  id: LanguageServerId,
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): LanguageServerCommand | null {
  switch (id) {
    case 'typescript':
      return resolveNpmServer(id, 'typescript-language-server', platform, env, exists)

    case 'python':
      return resolveNpmServer(id, 'pyright-langserver', platform, env, exists)

    case 'csharp':
      return resolveCsharpServer(platform, env, exists)
  }
}

/**
 * npm でグローバルに入るサーバ（typescript-language-server / pyright-langserver）。
 *
 * どちらも `--stdio` を付けて初めて標準入出力で話す。付けないと、サーバに
 * よっては TCP を待ち受けたまま黙り込む ── **引数は表の側が持つ**ので、
 * 呼び出し側がこれを忘れる余地は無い。
 */
function resolveNpmServer(
  id: LanguageServerId,
  executable: string,
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): LanguageServerCommand | null {
  const name = SERVER_NAMES[id]
  const stdio = ['--stdio']

  if (platform !== 'win32') {
    const found = findExecutableOnPath([executable], platform, env, exists)

    return found === null ? null : { name, file: found, args: stdio }
  }

  /*
    順番に意味がある。ネイティブの実行ファイルがあればそれを直接起動し、
    包むのは包まないと動かないものだけにする（間に cmd.exe が挟まると、
    終了コードの返り方も、こちらから終わらせたときの伝わり方も cmd.exe の都合になる）。
  */
  const found = findExecutableOnPath(
    [`${executable}.exe`, `${executable}.cmd`],
    platform,
    env,
    exists
  )

  if (found === null) {
    return null
  }

  if (found.toLowerCase().endsWith('.exe')) {
    return { name, file: found, args: stdio }
  }

  const cmd = resolveSystemFile(WINDOWS_CMD_RELATIVE, env)

  if (cmd === null) {
    /*
      `%SystemRoot%` が読めない環境。名前だけに落として起動を試みることはしない
      ── 落とすと「PATH と cwd から解決される cmd.exe」になり、
      この表が守っている性質そのものが崩れる。その言語が使えなくなるだけで済ませる。
    */
    return null
  }

  return { name, file: cmd, args: ['/c', found, ...stdio] }
}

/**
 * csharp-ls（dotnet のグローバルツール）。
 *
 * バッチではなくネイティブの実行ファイルが置かれるため、包む必要が無い。
 * 引数も要らない（既定で標準入出力を使う）。
 */
function resolveCsharpServer(
  platform: PlatformId,
  env: Readonly<Record<string, string | undefined>>,
  exists: FileExistsCheck
): LanguageServerCommand | null {
  const name = SERVER_NAMES.csharp
  const names = platform === 'win32' ? ['csharp-ls.exe'] : ['csharp-ls']
  const onPath = findExecutableOnPath(names, platform, env, exists)

  if (onPath !== null) {
    return { name, file: onPath, args: [] }
  }

  const home = platform === 'win32' ? env.USERPROFILE : env.HOME

  if (typeof home !== 'string' || home.length === 0) {
    return null
  }

  /*
    findInDirectory は相対のフォルダを受け付けない。環境変数の中身は利用者が
    書き換えられるため、`%USERPROFILE%` に相対パスが入っていても
    cwd を起点に解決されることはない（gitExecutable.ts と同じ）。
  */
  const separator = platform === 'win32' ? '\\' : '/'
  const found = findInDirectory(
    `${trimTrailingSeparator(home)}${separator}${DOTNET_TOOLS_RELATIVE}${separator}tools`,
    names,
    platform,
    exists
  )

  return found === null ? null : { name, file: found, args: [] }
}

/** `%SystemRoot%` からの絶対パス。読めなければ null。 */
function resolveSystemFile(
  relative: string,
  env: Readonly<Record<string, string | undefined>>
): string | null {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT

  if (typeof systemRoot !== 'string' || systemRoot.length === 0) {
    return null
  }

  return `${trimTrailingSeparator(systemRoot)}\\${relative}`
}
