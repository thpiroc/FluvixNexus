import { FILE_SEARCH_QUERY_MAX_LENGTH } from '@shared/files'

/**
 * 境界の外から来た検索語を、走査に使ってよい形か確かめる（Session 3-6-5 で切り出し）。
 *
 * もとは searchWorkspaceFiles.ts の中に閉じていた。全文検索
 * （searchWorkspaceFileContents.ts）が同じ判断を要るようになったため、
 * **規則そのものをここへ移した**（ignoredDirectories.ts を監視と検索で
 * 共有したのと同じ扱い）。
 *
 * 2箇所に書くと、片方だけが空文字を通す・片方だけが長さを見る、といった
 * 食い違いが生まれる。利用者から見れば「検索語として使えるか」は1つの問いで、
 * 探す対象が名前か中身かでその答えが変わる理由が無い。
 *
 * fs にも Electron にも触れない（純粋な文字列の判断）。
 */

/**
 * 検索語として扱えるなら、その文字列をそのまま返す（扱えなければ null）。
 *
 * **trim しない。** 前後の空白も探す対象の一部として扱う（相対位置を trim しないのと
 * 同じ考え方。workspacePath.ts）── ` notes` で `my notes.txt` を探せるし、
 * 全文検索ではインデントを含めて探せる。
 *
 * 空文字だけは受け付けない。すべてに一致してしまい、
 * 「Workspace を上限まで列挙する」のと同じ要求になるため。
 */
export function normalizeSearchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  if (raw === '' || raw.length > FILE_SEARCH_QUERY_MAX_LENGTH || raw.includes('\0')) {
    return null
  }

  return raw
}
