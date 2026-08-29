import type { PlatformId } from '@shared/api'
import type {
  GitCommitChangeKind,
  GitCommitSummary,
  GitLocalBranch,
  GitRemote,
  GitStashEntry
} from '@shared/git'
import { describeGitRemoteUrl } from './gitRemoteLabel'

/**
 * git の出力を読む（Electron / fs / child_process 非依存・テスト対象）。
 *
 * 実際に git を動かす層（main/git/runGit.ts）から**読み取りの判断だけ**を
 * 切り離してある。childProcesses.ts で `parseParentPids` を分けているのと同じ形で、
 * ここに集めた判断はテストで固定できる。
 *
 * ## ここが答える問い
 *
 *   - `rev-parse --show-toplevel` が返したパスは、今の Workspace root と同じ場所か
 *   - HEAD はブランチの上に居るか、それとも特定の commit を指しているか
 *   - `for-each-ref` が返した行は、どのローカルブランチか（Session 3-8-6）
 *   - `log` / `show --no-patch` が返した行は、どの commit か（Session 3-8-11 / 3-8-12）
 *   - `diff-tree --raw` が返した塊は、どのファイルがどう変わったか（Session 3-8-12）
 *   - `stash list` が返した行は、どの退避か（Session 3-8-15）
 *   - `stash pop` が言っているのは「競合した」か（Session 3-8-15）
 *   - `remote --verbose` が返した行は、どの remote か（Session 3-8-16）
 *
 * 1つめが Session 3-8-1 の核心にあたる。**Workspace root がリポジトリ root で
 * ないときは Git 操作を行わない**（設計判断 10）ため、「同じ場所か」の判断を
 * 誤ると、リポジトリの一部しか見えていない状態で Commit / Push を許すことになる。
 */

/**
 * `rev-parse --show-toplevel` の出力からリポジトリ root を読む。
 *
 * 読めなければ null。空の出力は「読めなかった」として扱う ── git が
 * 何も言わずに 0 で終わる形（bare リポジトリの一部の呼ばれ方）を
 * 「root が空文字のリポジトリ」として通してしまわないため。
 */
export function readRepositoryRoot(stdout: string): string | null {
  const line = firstNonEmptyLine(stdout)

  return line === null ? null : line
}

/**
 * `symbolic-ref --quiet --short HEAD` の出力からブランチ名を読む。
 *
 * 読めなければ null。このコマンドは **1つも commit が無いリポジトリでも成功する**
 * （HEAD は `refs/heads/main` を指しており、その先がまだ無いだけ）ので、
 * `git init` 直後のリポジトリでもブランチ名が出る。
 * `rev-parse --abbrev-ref HEAD` にはこの性質が無い（HEAD を解決しようとして失敗する）。
 */
export function readBranchName(stdout: string): string | null {
  return firstNonEmptyLine(stdout)
}

/**
 * `rev-parse --short HEAD` の出力から commit を読む。
 *
 * 16進の並びであることまで確かめる。**形を確かめずに通すと、想定と違う出力
 * （警告・ヒント）がそのまま「commit 名」として画面に出る**ため。
 * detached HEAD の表示にしか使わない値なので、読めなければ null に倒して
 * `unknown` として扱う方がよい。
 */
export function readShortCommit(stdout: string): string | null {
  const line = firstNonEmptyLine(stdout)

  if (line === null || !/^[0-9a-f]{4,40}$/i.test(line)) {
    return null
  }

  return line
}

/**
 * `for-each-ref --format=%(HEAD)%00%(refname:short)` の出力を読む（Session 3-8-6）。
 *
 * 1行が1つのブランチで、形は `*<NUL>main`（今居るブランチ）または
 * ` <NUL>feature/x` になる。**区切りが NUL なのは `%(HEAD)` 自身が空白を
 * 出すため**で、空白区切りにすると区切りと値の区別が消える
 * （main/git/gitCommands.ts の `listLocalBranches`）。
 *
 * ## 上限を「読んだ側」で切る
 *
 * git には上限より1つ多く求めてある（`--count=limit + 1`）。ここで
 * `limit` 件に切り、**切ったかどうか**を一緒に返す ── 呼び出し側が
 * 件数を数え直して判断する形にすると、上限の意味を持つ場所が2つになる。
 *
 * ## 読めない行は落とす（失敗にしない）
 *
 * 区切りが無い行・名前が空の行は、そのまま捨てて先へ進む。1行が読めないことを
 * 一覧全体の失敗にすると、**他のブランチへ切り替える手立てまで消える** ──
 * 変更ファイルの一覧で `unreadable-output` に倒したのとは事情が違い、
 * こちらは「出ていない行がある」だけで嘘にはならない。
 *
 * `current` を名前の一致ではなく `%(HEAD)` の印から決めているのは、
 * **同じ1回の読み取りから出す**ため（shared/git/branch.ts）。
 */
export function readLocalBranches(
  stdout: string,
  limit: number
): { readonly branches: readonly GitLocalBranch[]; readonly truncated: boolean } {
  const branches: GitLocalBranch[] = []
  let truncated = false

  for (const line of stdout.split('\n')) {
    const separator = line.indexOf('\0')

    if (separator < 0) {
      continue
    }

    const name = line.slice(separator + 1).trim()

    if (name.length === 0) {
      continue
    }

    if (branches.length >= limit) {
      // 上限より1つ多く求めてあるので、ここへ来た時点で「まだ先がある」。
      truncated = true
      break
    }

    branches.push({ name, current: line.slice(0, separator).includes('*') })
  }

  return { branches, truncated }
}

/**
 * `log --format=%h%x00%an%x00%at%x00%P%x00%s` の出力を読む（Session 3-8-11）。
 *
 * 1行が1件の commit で、形は
 * `abc1234<NUL>Name<NUL>1756100000<NUL>parent1 parent2<NUL>要約` になる。
 * **区切りが NUL なのは、要約に空白も記号も入りうる**ため
 * （main/git/gitCommands.ts の `listCommitHistory`）。
 *
 * ## 上限を「読んだ側」で切る（`readLocalBranches` と同じ）
 *
 * git には上限より1つ多く求めてある（`--max-count=limit + 1`）。ここで
 * `limit` 件に切り、**切ったかどうか**を一緒に返す ── 呼び出し側が
 * 件数を数え直して判断する形にすると、上限の意味を持つ場所が2つになる。
 *
 * ## 読めない行は落とす（失敗にしない）
 *
 * 欄が足りない行・hash の形をしていない行・日時が数として読めない行は、
 * そのまま捨てて先へ進む。1行が読めないことを履歴全体の失敗にすると、
 * **他の 99 件を見る手立てまで消える** ── `readLocalBranches` と同じ判断になる。
 *
 * ## 要約が空の行は落とさない
 *
 * `--allow-empty-message` で作られた commit は `%s` が空になる。空を
 * 「読めなかった」として捨てると、**その1件だけ順番が飛ぶ**ことになる ──
 * 空をどう見せるかは画面の側が決める（renderer/src/git/gitHistory.ts）。
 *
 * 名乗り（`%an`）も同じ理由で空を許す。commit には必ず author が記録されるが、
 * 空文字の名前を持つ commit は作れてしまう。
 */
export function readCommitHistory(
  stdout: string,
  limit: number
): { readonly commits: readonly GitCommitSummary[]; readonly truncated: boolean } {
  const commits: GitCommitSummary[] = []
  let truncated = false

  for (const line of stdout.split('\n')) {
    const commit = readCommitRecord(line)

    if (commit === null) {
      continue
    }

    if (commits.length >= limit) {
      // 上限より1つ多く求めてあるので、ここへ来た時点で「まだ先がある」。
      truncated = true
      break
    }

    commits.push(commit)
  }

  return { commits, truncated }
}

/**
 * `%h%x00%an%x00%at%x00%P%x00%s` の1行を読む（Session 3-8-11 / 3-8-12）。
 *
 * 履歴（`log`）と commit 1件の名乗り（`show --no-patch`）が**同じ関数を通る**。
 * 書式が同じなら読み方も1つでよく、2つ置くと同じ commit が
 * 「一覧では読めるのに詳細では読めない」形が生まれる。
 *
 * 読めなければ null。確かめるのは3つだけになる。
 *
 *   欄の数     … 区切りが4つ揃っているか
 *   hash の形  … 16進の並びか（`readShortCommit` と同じ理由）
 *   日時       … 数として読めるか
 *
 * **要約と名乗りは空を許す**（`--allow-empty-message` の commit が実在する）。
 * 3-8-12 では、この検査が「相手が commit でなかった」ことの受け皿も兼ねる ──
 * blob を指す hash に `git show` を動かすと**中身がそのまま出て 0 で終わる**ため、
 * 欄も hash の形も揃わず、ここで null になる（main/git/gitCommands.ts）。
 */
export function readCommitRecord(line: string): GitCommitSummary | null {
  const fields = splitFields(line, 4)

  if (fields === null) {
    return null
  }

  const [shortHash, authorName, authoredAt, parents, subject] = fields

  /*
    hash の形を確かめる。**確かめずに通すと、想定と違う出力（警告・ヒント）が
    そのまま「commit」として画面に並ぶ**（`readShortCommit` と同じ理由）。
  */
  if (!/^[0-9a-f]{4,40}$/i.test(shortHash)) {
    return null
  }

  const seconds = Number.parseInt(authoredAt, 10)

  if (!Number.isSafeInteger(seconds)) {
    return null
  }

  return {
    shortHash,
    authorName,
    // epoch 秒 → ミリ秒（shared/git/history.ts が持つのはミリ秒）。
    authoredAt: seconds * 1000,
    // 親が無い（履歴のいちばん最初）と空文字になるため、空の要素を数えない。
    parentCount: parents.split(' ').filter((parent) => parent.length > 0).length,
    subject
  }
}

/**
 * `diff-tree --raw --no-abbrev -r -z` の出力を読む（Session 3-8-12）。
 *
 * 1件が2つ（rename / copy では3つ）の NUL 区切りの塊で出てくる。
 *
 * ```
 * :<前の mode> <後の mode> <前の object> <後の object> <状態><NUL><位置><NUL>
 * :100644 100644 <前の object> <後の object> R100<NUL><元の位置><NUL><先の位置><NUL>
 * ```
 *
 * ## 状態の文字を、既にある語へ写す
 *
 * `A` / `M` / `D` / `R` / `C` / `T` を `GitCommitChangeKind` へ写す
 * （shared/git/commitDetail.ts）。新しい語を作らないので、画面は変更ファイルの
 * 一覧とまったく同じ記号・同じ読み上げ名を使える。
 *
 * `U`（未解決）と `X`（不明）は落とす ── どちらも記録された commit の
 * tree の差分には現れない。
 *
 * ## object 名を一緒に返す
 *
 * 差分（`readGitCommitFileDiff`）が使うのはここで返した object 名だけで、
 * `<hash>:<path>` のような引数を組み立てる経路をどこにも作らない
 * （main/git/gitCommands.ts）。**追加の前側・削除の後側は 40 桁の 0** で
 * 返るため、それを「比べる相手が居ない」として null にしておく ──
 * 0 の並びも16進として通ってしまうので、ここで落とさないと
 * `cat-file` に渡る（渡れば失敗するが、渡せる形を残す意味が無い）。
 *
 * ## mode 160000（submodule）も、そのまま返す
 *
 * ここでは落とさない。**一覧には出す**（その commit で submodule が
 * 動いたことは事実）が、中身は blob ではないので差分は出せない ──
 * その判断は差分の側で行う（main/git/gitCommitDetail.ts）。一覧から
 * 消すと、`git show --stat` に出る件数と画面の件数が食い違う。
 *
 * ## 読めない塊は落とす（失敗にしない）
 *
 * 形の合わない塊は捨てて先へ進む。1件が読めないことを一覧全体の失敗にすると、
 * **他のファイルを見る手立てまで消える**（`readCommitHistory` と同じ判断）。
 * 位置が1つ足りない rename では、その1件だけが落ちる。
 *
 * ## 上限を「読んだ側」で切る
 *
 * git 側には上限を渡していない ── `diff-tree` に「何件まで」を言う指定が
 * 無いためになる（`log` の `--max-count` にあたるものが無い）。したがって
 * ここで `limit` 件に切り、**切ったかどうか**を一緒に返す。
 */
export function readCommitFileChanges(
  stdout: string,
  limit: number
): {
  readonly files: readonly GitCommitFileEntry[]
  readonly truncated: boolean
} {
  const files: GitCommitFileEntry[] = []
  const records = stdout.split('\0')
  let truncated = false
  let index = 0

  while (index < records.length) {
    const header = RAW_HEADER.exec(records[index])

    if (header === null) {
      index += 1
      continue
    }

    const kind = COMMIT_CHANGE_KINDS[header[5]]
    // rename / copy は「元の位置」と「先の位置」の2つを続けて出す。
    const moved = kind === 'renamed' || kind === 'copied'
    const originalPath = moved ? nonEmptyRecord(records[index + 1]) : null
    const relativePath = nonEmptyRecord(records[index + (moved ? 2 : 1)])

    index += moved ? 3 : 2

    if (kind === undefined || relativePath === null) {
      continue
    }

    // rename / copy なのに元の位置が読めない（塊が足りない）。その1件だけ落とす。
    if (moved && originalPath === null) {
      continue
    }

    if (files.length >= limit) {
      truncated = true
      // 数え続けても件数は返さない（切れたことだけを伝える）。読み終える必要が無い。
      break
    }

    files.push({
      relativePath,
      kind,
      originalPath,
      originalMode: header[1],
      modifiedMode: header[2],
      originalObject: toObjectName(header[3]),
      modifiedObject: toObjectName(header[4])
    })
  }

  return { files, truncated }
}

/**
 * `--raw` の1件のうち、位置より前の部分。
 *
 * 状態の文字には数字が続くことがある（`R100` / `C085` ＝ 類似度）。
 * **数字は読まない** ── 画面に出るのは「移動」「複製」という語だけで、
 * 何 % 似ているかは出さない（出すと、その数字の意味を説明する場所が要る）。
 */
const RAW_HEADER = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])\d*$/

/** `--raw` の状態の文字 → 既にある語（shared/git/commitDetail.ts）。 */
const COMMIT_CHANGE_KINDS: Readonly<Record<string, GitCommitChangeKind | undefined>> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'type-changed'
}

/** 位置の塊。出力の末尾で欠けている／空なら null（読めない1件として落とす）。 */
function nonEmptyRecord(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value
}

/** 40 桁の 0 は「その側に相手が居ない」（追加の前側・削除の後側）。 */
function toObjectName(value: string): string | null {
  return /^0+$/.test(value) ? null : value
}

/**
 * commit の中の1ファイル。
 *
 * `GitCommitFileChange`（shared/git/commitDetail.ts）に **Main の中でだけ使う
 * 4つ**を足した形になる ── mode 2つと object 名2つで、どれも画面に出ない。
 * IPC の向こうへ渡さないのは 3-8-11 の「画面に出ないものは載せない」と
 * 同じ判断で、500 件ぶんの 40 桁を誰も読まないまま運ぶ意味が無い。
 */
export interface GitCommitFileEntry {
  readonly relativePath: string
  readonly kind: GitCommitChangeKind
  readonly originalPath: string | null
  /** 前側の mode（`160000` は submodule）。 */
  readonly originalMode: string
  /** 後側の mode（同上）。 */
  readonly modifiedMode: string
  /** 前側の object 名。追加では null。 */
  readonly originalObject: string | null
  /** 後側の object 名。削除では null。 */
  readonly modifiedObject: string | null
}

/* ------------------------------------------- 退避（Session 3-8-15） */

/**
 * `stash list --format=%gd%x00%h%x00%at%x00%gs` の出力を読む（Session 3-8-15）。
 *
 * 1行が1件の退避で、形は
 * `stash@{0}<NUL>abc1234<NUL>1756100000<NUL>WIP on main: 1a2b3c4 要約` になる。
 * **区切りが NUL なのは、名乗り（`%gs`）に空白も記号も入りうる**ため
 * （main/git/gitCommands.ts の `listStashEntries`）。
 *
 * ## 番号は `%gd` から読む（並び順から数えない）
 *
 * `git stash list` は 0 から順に並ぶので、読んだ順に数えることもできる ──
 * だがそうすると、**読めない行を1つ落とした瞬間に、それより後ろの番号が
 * 全部ずれる。** ずれた番号で pop / drop すると、画面に出ていないものが
 * 消えることになる（`readLocalBranches` / `readCommitHistory` が
 * 「読めない行は落とす」で済むのは、番号を持たないためになる）。
 *
 * したがって `%gd` が `stash@{N}` の形をしていない行は、番号が分からない
 * 行として**丸ごと落とす** ── 落ちるのはその1件だけで、他の行の番号は
 * git が言ったままになる。
 *
 * ## 上限を「読んだ側」で切る（`readLocalBranches` と同じ）
 *
 * git には上限より1つ多く求めてある（`--max-count=limit + 1`）。ここで
 * `limit` 件に切り、**切ったかどうか**を一緒に返す。
 *
 * ## 名乗りが空の行は落とさない
 *
 * `%gs` が空になることは通常無いが、空を「読めなかった」として捨てると
 * **その1件だけ順番が飛ぶ**（要約が空の commit を落とさないのと同じ判断）──
 * 空をどう見せるかは画面の側が決める（renderer/src/git/gitStash.ts）。
 */
export function readStashEntries(
  stdout: string,
  limit: number
): { readonly entries: readonly GitStashEntry[]; readonly truncated: boolean } {
  const entries: GitStashEntry[] = []
  let truncated = false

  for (const line of stdout.split('\n')) {
    const entry = readStashRecord(line)

    if (entry === null) {
      continue
    }

    if (entries.length >= limit) {
      // 上限より1つ多く求めてあるので、ここへ来た時点で「まだ先がある」。
      truncated = true
      break
    }

    entries.push(entry)
  }

  return { entries, truncated }
}

/* ------------------------------------------- remote（Session 3-8-16） */

/**
 * `git remote --verbose` の出力を、一覧として読む（Session 3-8-16）。
 *
 * ## 1件につき2行来る
 *
 * ```
 * origin<TAB>https://github.com/o/r.git (fetch)
 * origin<TAB>https://github.com/o/r.git (push)
 * ```
 *
 * 同じ名前が2回出るので、**先に出た方だけを採る**（`git remote --verbose` は
 * fetch を先に出す。実物で確かめてある）。fetch と push で URL が違う場合
 * （`git remote set-url --push` を打った人が居る場合）も、載せるのは
 * fetch 側1つになる ── push 側だけを変える口をアプリが持っていない以上、
 * 2つ並べても読む人にできることが無い（shared/git/remote.ts）。
 *
 * ## 区切りは TAB で、末尾の `(fetch)` は落とす
 *
 * remote 名に TAB は入らない（git が禁じ、こちらも弾いている。
 * shared/git/remoteName.ts）ので、名前の側に何が入っていても読み分けられる。
 * URL の側には空白が入りうるため（`ext::sh -c whoami` のような値が端末から
 * 追加されていることがある）、**末尾から** ` (fetch)` / ` (push)` を落とす ──
 * 空白で切ると、そういう値の途中で切れる。
 *
 * ## 上限は読む側で掛ける
 *
 * `for-each-ref`（`--count`）や `log`（`--max-count`）と違い、`git remote` に
 * 件数を切る指定は無い（main/git/gitCommands.ts）。したがって
 * 「上限より1つ多く求めて、切れたかを知る」形が取れない ── 代わりに、
 * **上限を超える名前が現れた時点で `truncated` を立てて読むのをやめる。**
 * 数え方が違うだけで、返すものは他の一覧と同じになる。
 *
 * ## URL は返さない
 *
 * 読んだ URL はここで**ラベルへ変える**（gitRemoteLabel.ts）── この関数の
 * 戻り値に URL の欄が無いことが、「Renderer へ URL が渡らない」を
 * 型の上で担保している（shared/git/remote.ts）。
 */
export function readRemoteEntries(
  stdout: string,
  limit: number
): { readonly remotes: readonly GitRemote[]; readonly truncated: boolean } {
  const remotes: GitRemote[] = []
  const seen = new Set<string>()
  let truncated = false

  for (const line of stdout.split('\n')) {
    const record = readRemoteRecord(line)

    if (record === null || seen.has(record.name)) {
      continue
    }

    if (remotes.length >= limit) {
      truncated = true
      break
    }

    seen.add(record.name)
    remotes.push(record)
  }

  return { remotes, truncated }
}

/** `git remote --verbose` が URL の後ろに付ける用途の印。 */
const REMOTE_USAGE_SUFFIXES: readonly string[] = [' (fetch)', ' (push)']

/**
 * `<名前><TAB><URL> (fetch)` の1行を読む。読めなければ null。
 *
 * 用途の印が付いていない行も通す ── 付ける / 付けないは `--verbose` の
 * 振る舞いで、版によって変わりうる。**印の有無で行ごと捨てると、
 * remote が1つも出ない**という壊れ方になる（名前と URL さえ読めれば足りる）。
 */
function readRemoteRecord(line: string): GitRemote | null {
  const tab = line.indexOf('\t')

  if (tab < 0) {
    return null
  }

  const name = line.slice(0, tab).trim()

  if (name.length === 0) {
    return null
  }

  let url = line.slice(tab + 1).replace(/\r$/, '')

  for (const suffix of REMOTE_USAGE_SUFFIXES) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, -suffix.length)
      break
    }
  }

  /*
    URL が空でも行は落とさない ── `remote.<名前>.url` が設定されていない
    remote は実在しうる（`git config remote.x.fetch` だけを書いた場合）。
    落とすと、一覧に出ていない remote が残ることになる。
    どう見せるかはラベルの側が決める（gitRemoteLabel.ts）。
  */
  return { name, label: describeGitRemoteUrl(url) }
}

/** `stash@{12}` から 12 を取り出すための形。 */
const STASH_SELECTOR = /^stash@\{(\d+)\}$/

/**
 * `%gd%x00%h%x00%at%x00%gs` の1行を読む。読めなければ null。
 *
 * 確かめるのは4つ ── 欄の数・`stash@{N}` の形・hash の形・日時が数か。
 * `readCommitRecord` が3つだけなのに対して1つ多いのは、こちらだけが
 * **番号を運ぶ**ためになる（番号を取り違えると、別の退避が消える）。
 */
function readStashRecord(line: string): GitStashEntry | null {
  const fields = splitFields(line, 3)

  if (fields === null) {
    return null
  }

  const [selector, shortHash, stashedAt, subject] = fields
  const matched = STASH_SELECTOR.exec(selector)

  if (matched === null) {
    return null
  }

  const index = Number.parseInt(matched[1], 10)

  if (!Number.isSafeInteger(index)) {
    return null
  }

  /*
    hash の形を確かめる。**確かめずに通すと、想定と違う出力（警告・ヒント）が
    そのまま「退避」として画面に並ぶ**（`readCommitRecord` と同じ理由）。
    ここでは押した瞬間の突き合わせにも使う値なので、なおのこと形を見る。
  */
  if (!/^[0-9a-f]{4,40}$/i.test(shortHash)) {
    return null
  }

  const seconds = Number.parseInt(stashedAt, 10)

  if (!Number.isSafeInteger(seconds)) {
    return null
  }

  // epoch 秒 → ミリ秒（shared/git/stash.ts が持つのはミリ秒）。
  return { index, shortHash, subject, stashedAt: seconds * 1000 }
}

/**
 * `stash pop` の出力が「競合した」と言っているか（Session 3-8-15）。
 *
 * ## 見るのは stdout になる
 *
 * pop が競合したとき、git は **stderr に何も書かない** ── 知らせは
 * stdout に出て、終了コードだけが 1 になる（実物で確かめてある）。
 * merge の結果は失敗ではないので、そちらへ流れる。
 *
 * 作業ツリーが上書きされるために**何も起きなかった**場合とは、そこが
 * はっきり分かれる ── あちらは stderr に
 * `Your local changes to the following files would be overwritten by merge:` が
 * 出て、stdout に `CONFLICT` は現れない。したがって呼ぶ側は
 * **stderr の分類を先に見て、当たらなかったときだけここを見る**
 * （main/git/gitStash.ts）。
 *
 * ## 英文を当てにできる理由は、失敗の分類と同じ
 *
 * アプリが呼ぶ git には `LC_ALL=C` を渡してある（main/git/gitEnvironment.ts）。
 * 2つの言い方を見るのは、片方だけの版に備えるためになる ── `CONFLICT (` は
 * 種類（content / add/add …）を伴う見出し行、`Merge conflict in` は
 * その中身の行にあたる。
 */
export function readStashPopConflict(stdout: string): boolean {
  const text = stdout.toLowerCase()

  return text.includes('conflict (') || text.includes('merge conflict in')
}

/**
 * NUL 区切りの行を、先頭から `separators` 個の区切りで切り分ける。
 *
 * 最後の欄には**区切りより後ろのすべて**が入る ── 欄の数を数え直す形
 * （`split('\0')` して長さを見る）にすると、値の中に NUL が現れた行で
 * 静かに1つずれる。区切りが足りない行は null（読めない行として捨てる）。
 */
function splitFields(line: string, separators: number): readonly string[] | null {
  const fields: string[] = []
  let start = 0

  for (let index = 0; index < separators; index += 1) {
    const separator = line.indexOf('\0', start)

    if (separator < 0) {
      return null
    }

    fields.push(line.slice(start, separator))
    start = separator + 1
  }

  fields.push(line.slice(start))

  return fields
}

/**
 * 2つのパスが同じフォルダを指しているか。
 *
 * ## なぜ単純な文字列比較では足りないか
 *
 * 比べる相手は、次のように**同じ場所を違う文字列で**指してくる。
 *
 * ```
 * git が返す        D:/DEV/PROJECTS/Fluvix Nexus   （区切りは常に `/`）
 * Workspace root    D:\DEV\PROJECTS\Fluvix Nexus   （OS の表記）
 * ```
 *
 * さらに Windows のパスは大文字小文字を区別しないため、`D:\dev\...` と
 * `D:\DEV\...` も同じ場所になる。ここを厳密一致にすると、**リポジトリ root を
 * 開いているのに `nested`（サブフォルダ）として扱われ**、Git パネルが
 * 何もできない状態になる。
 *
 * ## それでも文字列の比較に留める
 *
 * symlink / ジャンクション越しに同じ場所を指す場合は、この関数では見抜けない。
 * 実体まで辿るのは呼び出し側の責務にしてある（main/git/gitRepository.ts が
 * `realpath` を通してから渡す）── ファイルシステムに触れた時点で、
 * この判断をテストで固定できなくなるため。
 *
 * `platform` を引数で受け取るのは同じ理由。node の `path` は動いている OS で
 * 振る舞いが変わるため、それに任せると「Windows でだけ通るテスト」になる。
 */
export function isSameRepositoryPath(a: string, b: string, platform: PlatformId): boolean {
  return normalizeRepositoryPath(a, platform) === normalizeRepositoryPath(b, platform)
}

/**
 * 比較のためにパスの表記を揃える。
 *
 * 「同じ場所か」を決めるためだけの正規化で、**ここで作った文字列を
 * ファイルシステムへ渡さない**（大文字小文字を潰しているため、
 * 表示にも使わない）。
 */
export function normalizeRepositoryPath(value: string, platform: PlatformId): string {
  const trimmed = value.trim()

  if (platform !== 'win32') {
    // 大文字小文字は区別される。落とせるのは末尾の区切りだけ。
    const withoutTrailing = trimmed.replace(/\/+$/, '')

    return withoutTrailing.length === 0 ? '/' : withoutTrailing
  }

  const backslashed = trimmed.replace(/\//g, '\\')
  // UNC（`\\server\share`）の先頭2つは意味のある区切りなので、畳む対象から外す。
  const isUnc = backslashed.startsWith('\\\\')
  const body = isUnc ? backslashed.slice(2) : backslashed
  const collapsed = `${isUnc ? '\\\\' : ''}${body.replace(/\\{2,}/g, '\\')}`
  const withoutTrailing = collapsed.replace(/\\+$/, '')
  // ドライブ直下（`C:\`）は末尾を落とすと `C:`（ドライブ相対）に化けるため戻す。
  const restored = /^[A-Za-z]:$/.test(withoutTrailing) ? `${withoutTrailing}\\` : withoutTrailing

  return restored.toLowerCase()
}

/** 最初の空でない行。無ければ null。 */
function firstNonEmptyLine(value: string): string | null {
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}
