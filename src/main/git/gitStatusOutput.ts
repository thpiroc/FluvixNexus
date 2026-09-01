import type {
  GitChangeKind,
  GitConflictShape,
  GitFileChange,
  GitUpstreamStatus,
  GitWorkingTreeChanges
} from '@shared/git'

/**
 * `git status --porcelain=v2 --branch -z` の読み取り
 * （Electron / fs / child_process 非依存・テスト対象・Session 3-8-2）。
 *
 * gitOutput.ts が `rev-parse` / `symbolic-ref` の1行を読むのに対し、こちらは
 * **変更ファイルの一覧そのもの**を読む。分けてあるのは量と性質が違うため ──
 * ここが間違えると「変更したのに一覧に出ない」「別のファイルが出る」という、
 * 利用者が Commit の対象を取り違える形で表に出る。
 *
 * ## 出力の形
 *
 * 区切りは NUL（`-z`）で、レコードは先頭の1文字で見分ける。
 *
 * ```
 * # branch.oid <commit> | (initial)
 * # branch.head <branch> | (detached)
 * # branch.upstream <name>          upstream が設定されているときだけ
 * # branch.ab +<ahead> -<behind>    その ref が手元にあるときだけ
 * 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 * 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path> NUL <元の path>
 * u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 * ? <path>
 * ! <path>                          --ignored を渡していないので実際には来ない
 * ```
 *
 * **`2`（rename / copy）だけがレコードの中に NUL を1つ含む。** 元の path が
 * 次のフィールドとして続くため、区切りで割っただけでは1件が2件に見える。
 * ここを取り違えると、rename が「新しいファイル」と「知らない path の行」に化ける。
 *
 * ## XY は2文字で2つの答えを持つ
 *
 * `X` が index 側（＝ Commit すれば入るもの）、`Y` が作業ツリー側になる。
 * `MM` のように両方が立つファイルは、staged にも unstaged にも1件ずつ並ぶ ──
 * 利用者にとってそれは別々に扱えるもので、1行に畳むと片方だけを戻す操作
 * （Session 3-8-3 の Unstage）が行の上で表せなくなる。
 *
 * ## 知らない形は「読めなかった」に倒す
 *
 * 想定と違うレコードに出会ったら、そこまでに読めた分を返さずに null を返す
 * （呼び出し側が `unreadable-output` として扱う）。**部分的な一覧を返さない**のは、
 * 一覧が「変更のすべて」であることに意味があるため ── 黙って1件欠けた一覧は、
 * 案内が出るより危険にあたる。
 */

/** 読み取りの結果。読めなければ null。 */
export interface GitStatusReading {
  readonly changes: GitWorkingTreeChanges
  readonly upstream: GitUpstreamStatus | null
}

/** 組み立て中の一覧（読み終わってから readonly の形へ移す）。 */
interface StatusAccumulator {
  readonly staged: GitFileChange[]
  readonly unstaged: GitFileChange[]
  readonly untracked: GitFileChange[]
  readonly conflicted: GitFileChange[]
}

export function parseGitStatus(stdout: string): GitStatusReading | null {
  const records = stdout.split('\0')
  const found: StatusAccumulator = { staged: [], unstaged: [], untracked: [], conflicted: [] }

  let upstreamName: string | null = null
  let ahead: number | null = null
  let behind: number | null = null

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]

    /*
      末尾は必ず空になる（最後のレコードの後にも NUL が付く）。
      途中に空が現れることは無いが、現れても意味を持たないので飛ばす。
    */
    if (record === '') {
      continue
    }

    if (record.startsWith('# ')) {
      const header = readHeader(record)

      if (header === null) {
        // 知らない見出しは無視する（git が見出しを増やしても壊れないように）。
        continue
      }

      if (header.key === 'branch.upstream') {
        upstreamName = header.value
      } else if (header.key === 'branch.ab') {
        const divergence = readAheadBehind(header.value)

        if (divergence === null) {
          return null
        }

        ahead = divergence.ahead
        behind = divergence.behind
      }

      continue
    }

    const type = record.slice(0, 2)

    if (type === '1 ') {
      if (!readOrdinary(record, found)) {
        return null
      }

      continue
    }

    if (type === '2 ') {
      /*
        元の path は「次のレコード」として続く。読んだぶんだけ index を進める
        （進め忘れると、元の path が独立した行として一覧に紛れ込む）。
      */
      const originalPath = records[index + 1]

      if (originalPath === undefined || !readRenamed(record, originalPath, found)) {
        return null
      }

      index += 1
      continue
    }

    if (type === 'u ') {
      if (!readUnmerged(record, found)) {
        return null
      }

      continue
    }

    if (type === '? ') {
      if (!readUntracked(record, found)) {
        return null
      }

      continue
    }

    // 無視されているファイル。--ignored を渡していないので来ないが、来ても捨てるだけ。
    if (type === '! ') {
      continue
    }

    return null
  }

  return {
    changes: {
      staged: found.staged,
      unstaged: found.unstaged,
      untracked: found.untracked,
      conflicted: found.conflicted
    },
    upstream: upstreamName === null ? null : { name: upstreamName, ahead, behind }
  }
}

/* ------------------------------------------------------------------------ 見出しの行 */

/** `# branch.upstream origin/main` を key と値に分ける。値が無い見出しは null。 */
function readHeader(record: string): { readonly key: string; readonly value: string } | null {
  const body = record.slice(2)
  const separator = body.indexOf(' ')

  if (separator < 0) {
    return null
  }

  return { key: body.slice(0, separator), value: body.slice(separator + 1) }
}

/**
 * `+1 -2` を読む。
 *
 * **符号ごと決め打ちで確かめる。** `+` `-` を落として数だけ読むと、
 * 並びが変わったときに ahead と behind が入れ替わったまま気づけない。
 */
function readAheadBehind(
  value: string
): { readonly ahead: number; readonly behind: number } | null {
  const matched = /^\+(\d+) -(\d+)$/.exec(value)

  if (matched === null) {
    return null
  }

  return { ahead: Number(matched[1]), behind: Number(matched[2]) }
}

/* ------------------------------------------------------------------ ファイルのレコード */

/** `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` */
function readOrdinary(record: string, found: StatusAccumulator): boolean {
  const fields = splitFields(record, 8)

  if (fields === null) {
    return false
  }

  const path = toChangePath(fields.rest)

  if (path === null) {
    return false
  }

  return applyIndexAndWorktree(fields.tokens[1], path, null, found)
}

/** `2 <XY> <sub> ... <X><score> <path>` ＋ 次のフィールドに元の path */
function readRenamed(record: string, originalRecord: string, found: StatusAccumulator): boolean {
  const fields = splitFields(record, 9)

  if (fields === null) {
    return false
  }

  const path = toChangePath(fields.rest)
  const originalPath = toChangePath(originalRecord)

  if (path === null || originalPath === null) {
    return false
  }

  return applyIndexAndWorktree(fields.tokens[1], path, originalPath, found)
}

/**
 * `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
 *
 * ## 3-8-2 は XY を捨てていた
 *
 * 「どれであっても利用者が次に取る行動は同じ（衝突を解いてから Stage する）」
 * というのが 3-8-2 の判断だった。3-8-22A でその前提が1つだけ崩れる ──
 * **`DD`（both-deleted）は作業ツリーにファイルが無い**ので、行に出していた
 * 「エディタで開く」がそこだけ空振りする（shared/git/status.ts）。
 *
 * 読み替えるのはここ1箇所で、Renderer へ渡るのは分類（`GitConflictShape`）
 * だけになる ── `XY` の2文字は境界を越えない（このファイルの冒頭の線のまま）。
 *
 * ## 作業ツリー側のモード（`mW`）は使わない
 *
 * 「ファイルが在るか」を直接言っていそうに見えるが、**無くても 100644 が
 * 入る**（rename / delete の競合で確かめてある）。形の側で決める。
 */
function readUnmerged(record: string, found: StatusAccumulator): boolean {
  const fields = splitFields(record, 10)

  if (fields === null) {
    return false
  }

  const path = toChangePath(fields.rest)

  if (path === null) {
    return false
  }

  const conflictShape = toConflictShape(fields.tokens[1])

  if (conflictShape === undefined) {
    return false
  }

  found.conflicted.push({
    relativePath: path,
    kind: 'conflicted',
    originalPath: null,
    directory: false,
    conflictShape
  })

  return true
}

/**
 * 競合の `XY` を形に読み替える。知らない組み合わせは undefined。
 *
 * 7通りは git が閉じた集合として定義していて（`git status` の説明にある
 * unmerged の一覧）、実物でも7通りすべてを作って確かめてある
 * （rename / rename の1回で `DD` / `AU` / `UA` が同時に出る）。
 *
 * **知らない文字を「読めた」側へ倒さない。** 倒すと、いつか増えた形が
 * `both-modified` を名乗って一覧に並ぶ ── `toChangeKind` が `.` と
 * 知らない文字を分けているのと同じ判断になる。
 */
function toConflictShape(xy: string): GitConflictShape | undefined {
  switch (xy) {
    case 'UU':
      return 'both-modified'

    case 'AA':
      return 'both-added'

    case 'UD':
      return 'deleted-by-them'

    case 'DU':
      return 'deleted-by-us'

    case 'DD':
      return 'both-deleted'

    case 'AU':
      return 'added-by-us'

    case 'UA':
      return 'added-by-them'

    default:
      return undefined
  }
}

/**
 * `? <path>`
 *
 * `--untracked-files=normal` は、中身がすべて未追跡のフォルダを
 * **末尾に `/` を付けた1件**として返す。ここでその `/` を落としてフォルダだと
 * 記録しておくと、行の側は「開けるかどうか」を path の末尾ではなく
 * 意味（`directory`）で判断できる。
 */
function readUntracked(record: string, found: StatusAccumulator): boolean {
  const raw = record.slice(2)
  const directory = raw.endsWith('/')
  const path = toChangePath(directory ? raw.slice(0, -1) : raw)

  if (path === null) {
    return false
  }

  found.untracked.push({
    relativePath: path,
    kind: 'untracked',
    originalPath: null,
    directory,
    conflictShape: null
  })

  return true
}

/**
 * `XY` の2文字から、staged / unstaged それぞれの1件を作る。
 *
 * どちらも `.`（変化なし）なら1件も作らない ── そういうレコードは git が
 * 出さないが、出たときに「種類の分からない行」を一覧へ足すよりは何も足さない方がよい。
 */
function applyIndexAndWorktree(
  xy: string,
  relativePath: string,
  originalPath: string | null,
  found: StatusAccumulator
): boolean {
  if (xy.length !== 2) {
    return false
  }

  const staged = toChangeKind(xy[0])
  const worktree = toChangeKind(xy[1])

  if (staged === undefined || worktree === undefined) {
    return false
  }

  if (staged !== null) {
    found.staged.push({
      relativePath,
      kind: staged,
      originalPath,
      directory: false,
      conflictShape: null
    })
  }

  if (worktree !== null) {
    /*
      作業ツリー側に元の path を持たせない。rename を index へ載せた後で
      さらに中身を書き換えた場合、作業ツリーの変更は**新しい path に対するもの**で、
      そこに「どこから来たか」を並べても、行が指しているものと食い違う。
    */
    found.unstaged.push({
      relativePath,
      kind: worktree,
      originalPath: null,
      directory: false,
      conflictShape: null
    })
  }

  return true
}

/**
 * porcelain の1文字を種類に読み替える。
 *
 * `.`（変化なし）は null、知らない文字は undefined。**2つを分けてある**のは、
 * 前者が正常な答えで後者が「読めなかった」だからにほかならない ── 同じ値にすると、
 * 知らない文字が黙って「変化なし」として捨てられる。
 */
function toChangeKind(code: string): GitChangeKind | null | undefined {
  switch (code) {
    case '.':
      return null

    case 'A':
      return 'added'

    case 'M':
      return 'modified'

    case 'D':
      return 'deleted'

    case 'R':
      return 'renamed'

    case 'C':
      return 'copied'

    case 'T':
      return 'type-changed'

    default:
      return undefined
  }
}

/**
 * 先頭から `count` 個の空白区切りのフィールドを取り、残りを返す。
 *
 * path には空白が入りうるため、**残りは分割しない**。数えるのは前半の
 * 固定長のフィールドだけになる。
 */
function splitFields(
  record: string,
  count: number
): { readonly tokens: readonly string[]; readonly rest: string } | null {
  const tokens: string[] = []
  let cursor = 0

  for (let index = 0; index < count; index += 1) {
    const separator = record.indexOf(' ', cursor)

    if (separator < 0) {
      return null
    }

    tokens.push(record.slice(cursor, separator))
    cursor = separator + 1
  }

  return { tokens, rest: record.slice(cursor) }
}

/**
 * path として受け付けてよい形か確かめる。
 *
 * git が返すのは常に**リポジトリ root からの相対位置・区切りは `/`** で、
 * それは Files / Editor が使う relativePath（shared/files/entry.ts）とそのまま同じ形に
 * なる（Workspace root ＝ リポジトリ root でなければ `ready` にならないため）。
 *
 * それでも確かめてから通すのは、この値が**そのまま Renderer へ渡り、
 * 利用者がそれを押すとファイルを開く要求になる**ため。clone してきたものの中身は
 * この時点ではただのデータでしかなく、境界の判断を「git は変な path を返さない」
 * という前提に預けない（main/files/workspacePath.ts と同じ線。実際に開くときの
 * 検証はそちらが独立に行うので、ここは二重の1枚目にあたる）。
 *
 *   受け付けない … 空・`/` で始まる・`..` を含む・`.git` の中
 */
function toChangePath(raw: string): string | null {
  if (raw === '' || raw.startsWith('/')) {
    return null
  }

  const segments = raw.split('/')

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  // `.git` の中は変更ファイルではない（git も返さない）。
  if (segments[0] === '.git') {
    return null
  }

  return raw
}
