import {
  FILE_CONTENT_SEARCH_ELLIPSIS,
  FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  FILE_CONTENT_SEARCH_PREVIEW_LEAD,
  FILE_CONTENT_SEARCH_PREVIEW_MAX_LENGTH,
  type FileContentMatch
} from '@shared/files'

/**
 * ファイル1件のテキストの中から、検索語に一致する場所を探す（Session 3-6-5）。
 *
 * fs にも Electron にも触れない（＝そのままテストできる）。実際に読むのは
 * searchWorkspaceFileContents.ts で、fileContent.ts が「バイト列 → 文字列」を
 * 持っているのと同じ立ち位置 ── こちらは「文字列 → 一致の位置」だけを持つ。
 *
 * ## 行で切ってから探す
 *
 * 文字列全体に対して探して後から行番号を数える形にしていない。行に切ってから
 * 探せば、行番号・桁・その行のテキスト（preview）が**同じ1つの走査から**出る。
 * 後から数える形にすると、行の数え方（`\r\n` の扱い）が2箇所に現れる。
 *
 * 改行は `\n` で切り、行末の `\r` を落とす。`\r` だけの改行（古い Mac）は
 * 1行として扱われる ── 今どき生成されることはなく、対応するために
 * 行の切り方を分岐させる価値が無い。
 *
 * ## 大文字 / 小文字を区別しない
 *
 * 名前の検索（shared/files/search.ts）と同じ規則にしてある。利用者から見て
 * 「探し方」が対象によって変わる理由が無いため。
 *
 * ただし**位置まで返す**ぶん、畳み方には注意が要る。`toLowerCase()` は
 * 文字数が変わることがある（`İ` は2文字になる）ため、畳んだ文字列で求めた位置が
 * 元の行の位置と対応しない。そこで、
 *
 *   長さが変わらない行 … 畳んだ行の上で indexOf（速い。ほぼすべての行がこちら）
 *   長さが変わる行     … 生の行の上で1文字ずつ切り出して畳んで比べる（位置は正確）
 *
 * と分けている。後者でも「畳むと長さが変わる語」自体は見つけられないが、
 * **ずれた位置を返すよりは見つけない方がよい**（findFileNameMatch が
 * 印を付けないのと同じ判断）。
 *
 * ## 一致は重ならない
 *
 * `aaa` から `aa` を探すと1件（2件目は1件目に重なる）。重なりも数えると、
 * 1文字の語で1行から数百件が出て上限を食い潰す。
 */

/** そのファイルの中で見つかったもの。 */
export interface ContentMatchesOutcome {
  /** 一致（行の順、同じ行では桁の順）。 */
  readonly matches: readonly FileContentMatch[]
  /** 上限（maxMatches）で打ち切ったか。 */
  readonly truncated: boolean
}

/** 制御文字か（タブ・改行を含む。preview では空白に置き換える）。 */
function isControlCharCode(code: number): boolean {
  return code < 0x20 || code === 0x7f
}

/**
 * 制御文字を空白へ。
 *
 * タブをそのまま返すと、1文字が幅いくつぶんに見えるかが描画側の都合で決まり、
 * `42:15` として返した桁と画面上の見え方が食い違う。**1文字を1文字へ**
 * 置き換えているので、preview の中での位置（previewColumn）はずれない。
 */
function sanitizePreview(text: string): string {
  let result = ''

  for (let index = 0; index < text.length; index += 1) {
    result += isControlCharCode(text.charCodeAt(index)) ? ' ' : text[index]
  }

  return result
}

/**
 * 一致箇所の周辺を切り出す。
 *
 * 圧縮された JavaScript のように1行が数十万文字のファイルは普通にあり、
 * 行をそのまま返すと IPC で運ぶ量も描く量もその1行で決まってしまう
 * （shared/files/contentSearch.ts）。
 *
 * 切り詰めた側には `…` を付ける ── 付けないと「行の先頭から始まっている」ように
 * 読めてしまい、preview が行そのものだと誤解される。
 */
export function buildMatchPreview(
  line: string,
  start: number,
  previewMaxLength: number = FILE_CONTENT_SEARCH_PREVIEW_MAX_LENGTH
): { readonly preview: string; readonly previewColumn: number } {
  /*
    一致を先頭に置かない。直前の数文字（`const example` の `const`）が無いと、
    何の中で一致したのかが読み取れない。
  */
  const from = Math.max(0, start - FILE_CONTENT_SEARCH_PREVIEW_LEAD)
  const to = Math.min(line.length, from + previewMaxLength)

  const head = from > 0 ? FILE_CONTENT_SEARCH_ELLIPSIS : ''
  const tail = to < line.length ? FILE_CONTENT_SEARCH_ELLIPSIS : ''

  return {
    preview: `${head}${sanitizePreview(line.slice(from, to))}${tail}`,
    // 1 始まり（shared/files/contentSearch.ts）。先頭の `…` のぶんだけ後ろへずれる。
    previewColumn: start - from + head.length + 1
  }
}

/**
 * 1行の中の一致位置（0 始まり）。
 *
 * `limit` は「この行から拾ってよい上限」。上限に達したら**その行の途中でも**
 * 止める ── 1行から数千件を拾ってから捨てるのでは、上限が費用の歯止めにならない。
 */
function findLineMatchColumns(line: string, query: string, limit: number): number[] {
  if (limit <= 0 || query.length === 0 || line.length < query.length) {
    return []
  }

  const foldedQuery = query.toLowerCase()
  const foldedLine = line.toLowerCase()
  const columns: number[] = []

  // 畳んでも長さが変わらない場合だけ、畳んだ側の位置をそのまま使える。
  if (foldedLine.length === line.length && foldedQuery.length === query.length) {
    let from = 0

    while (columns.length < limit) {
      const index = foldedLine.indexOf(foldedQuery, from)

      if (index < 0) {
        break
      }

      columns.push(index)
      // 重ならない位置から次を探す。
      from = index + query.length
    }

    return columns
  }

  /*
    畳むと長さが変わる文字を含む行（`İ` など）。位置が対応しないため、
    生の行の上を1文字ずつ見て、切り出した写しを畳んで比べる。
    こちらは遅いが、通るのはそういう文字を含む行だけになる。
  */
  for (let index = 0; index + query.length <= line.length && columns.length < limit;) {
    if (line.slice(index, index + query.length).toLowerCase() === foldedQuery) {
      columns.push(index)
      index += query.length
      continue
    }

    index += 1
  }

  return columns
}

export function findContentMatches(
  text: string,
  query: string,
  maxMatches: number = FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  previewMaxLength: number = FILE_CONTENT_SEARCH_PREVIEW_MAX_LENGTH
): ContentMatchesOutcome {
  if (query === '') {
    // 空の語はすべてに一致する。名前の検索と同じく、要求として成立させない。
    return { matches: [], truncated: false }
  }

  const matches: FileContentMatch[] = []
  const lines = text.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const remaining = maxMatches - matches.length

    // まだ行が残っているのに枠が無い ＝ このファイルは最後まで見ていない。
    if (remaining <= 0) {
      return { matches, truncated: true }
    }

    const raw = lines[index] as string
    // `\r\n` の `\r` は行の一部ではない（桁の数え方にも preview にも入れない）。
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    /*
      枠より1つ多く探す。ちょうど枠を使い切ったのか、まだ続きがあるのかは
      **1つ余分に見つかるかどうか**でしか分からない
      （見つからなければ、その行は最後まで見たことになる）。
    */
    const columns = findLineMatchColumns(line, query, remaining + 1)

    for (const column of columns.slice(0, remaining)) {
      const { preview, previewColumn } = buildMatchPreview(line, column, previewMaxLength)

      matches.push({
        // 行も桁も1始まり（Monaco と同じ数え方。shared/files/contentSearch.ts）。
        line: index + 1,
        column: column + 1,
        length: query.length,
        preview,
        previewColumn
      })
    }

    if (columns.length > remaining) {
      return { matches, truncated: true }
    }
  }

  return { matches, truncated: false }
}
