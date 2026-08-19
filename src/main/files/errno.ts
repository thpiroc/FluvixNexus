/**
 * Node の例外から errno の記号名（`ENOENT` など）を取り出す。
 *
 * fs が投げる例外は `code` を持つが、**それ以外の経路から来た例外は持たない**
 * （`shell.trashItem` の Error など）。型で保証されないものを扱うため、
 * 取り出しはここに一本化し、無ければ null を返す。
 *
 * `instanceof Error` で絞らないのは、境界を越えてきた値やライブラリが投げた
 * 素のオブジェクトでも `code` さえあれば判断に使えるため。
 */
export function errnoCodeOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const { code } = cause as { code: unknown }

    return typeof code === 'string' ? code : null
  }

  return null
}
