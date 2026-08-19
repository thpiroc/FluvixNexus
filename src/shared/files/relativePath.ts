/**
 * relativePath（Workspace root からの相対位置）そのものの扱い。
 *
 * ## なぜ shared に置くか
 *
 * relativePath の形は契約の一部（entry.ts）で、**区切りは常に `/`・root は空文字**と決めてある。
 * その形に対する判断（親はどこか、配下か）は OS のパスの話ではなく、
 * 決めた表記に対する文字列の話でしかない。だから Main / Renderer の双方が同じ答えを見る。
 *
 *   Main     … 操作対象の親フォルダを求め、そこに対して境界を確かめる
 *   Renderer … 消えたフォルダの配下にある状態（読み込み済みの中身・開いているタブ）を畳む
 *
 * OS のパス（区切り文字・ドライブ・realpath）に関わる判断はここには置かない。
 * それは Main の話であり、main/files/workspacePath.ts が持つ
 * （その線を引いておかないと、Renderer に OS 依存が入る）。
 *
 * 渡すのは正規化済みの relativePath（Main では normalizeWorkspaceRelativePath の戻り値、
 * Renderer では Main から届いた FileEntry.relativePath）。
 */

/**
 * 相対位置を「親フォルダ」と「名前」に分ける。
 *
 * 作成 / リネーム / 削除はどれも**あるフォルダの中で起きる**操作であり、
 * 境界を確かめる相手は親フォルダになる。この分解がその入口
 * （main/files/mutateWorkspaceEntry.ts）。
 *
 * root（空文字）は親を持たないため null。root 自身を消す・改名する要求を、
 * 「たまたま親が無かった」ではなくこの時点で成立しないものとして落とす。
 */
export function splitRelativePath(
  relativePath: string
): { readonly parent: string; readonly name: string } | null {
  if (relativePath === '') {
    return null
  }

  const separator = relativePath.lastIndexOf('/')

  if (separator < 0) {
    return { parent: '', name: relativePath }
  }

  const name = relativePath.slice(separator + 1)

  // `a/` のように名前が空になる形は、正規化を通っていれば起きない。
  return name === '' ? null : { parent: relativePath.slice(0, separator), name }
}

/** その相対位置を含むフォルダ。root 直下のものは root（空文字）を返す。 */
export function parentRelativePath(relativePath: string): string | null {
  return splitRelativePath(relativePath)?.parent ?? null
}

/**
 * 親の相対位置と名前をつなぐ。
 *
 * root（空文字）直下でも `/name` にしないため、素の連結ではなくこれを使う。
 */
export function joinRelativePath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

/**
 * `relativePath` が `ancestor` そのものか、その配下にあるか。
 *
 * 前方一致は**区切り文字まで含めて**比べる。`src` と `src2` を混同しないため
 * （絶対パスに対して isInsideWorkspace がやっているのと同じ判断）。
 * root（空文字）はすべての祖先にあたる。
 */
export function isAtOrUnder(ancestor: string, relativePath: string): boolean {
  if (ancestor === '') {
    return true
  }

  return relativePath === ancestor || relativePath.startsWith(`${ancestor}/`)
}

/**
 * `ancestor` 配下の位置を、`ancestor` が `renamedTo` へ変わった後の位置へ読み替える。
 *
 * フォルダを改名したとき、その中で開いていたタブの位置を追従させるのに使う。
 * 配下でなければ null（呼び出し側が「関係なかった」と判断できるように）。
 */
export function rebaseRelativePath(
  relativePath: string,
  ancestor: string,
  renamedTo: string
): string | null {
  if (!isAtOrUnder(ancestor, relativePath)) {
    return null
  }

  if (relativePath === ancestor) {
    return renamedTo
  }

  return `${renamedTo}${relativePath.slice(ancestor.length)}`
}
