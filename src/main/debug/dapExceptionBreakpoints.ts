/**
 * DAP `setExceptionBreakpoints`（Session 6-13。純粋・テスト対象）。
 *
 * ## 何を送るかは Main の表が決め、adapter が名乗ったものとの積だけを送る
 *
 * filter の id は DAP の仕様で決まっておらず、adapter ごとに違う（debugpy は
 * `raised` / `uncaught` / `userUnhandled`）。そこで
 *
 * ```
 * 言語ごとの閉じた表（main/debug/profileResolver.ts の DEBUG_EXCEPTION_BREAKPOINT_FILTERS）
 *   ∩ initialize の応答の exceptionBreakpointFilters[].filter
 *   → 空でなければ setExceptionBreakpoints { filters }
 * ```
 *
 * とする。**Renderer から filter を渡す口は無い**（Profile にも IPC にも欄が無い）。
 *
 * DAP の仕様は「`exceptionBreakpointFilters` を1つ以上名乗る adapter にだけ送る」としているので、
 * 名乗らない adapter・表が空の言語・積が空のときは送らない。
 *
 * ## `default: true` を当てにしない
 *
 * debugpy は `uncaught` に `default: true` を付けて名乗るが、**これは client への提案で、
 * `setExceptionBreakpoints` を送らなければ uncaught でも止まらない**（実 debugpy 1.8.21 で確認。
 * Session 6-12 までのアプリはこの状態で、例外はそのまま exit 1 で終わっていた）。
 */

export interface DapSetExceptionBreakpointsArguments {
  readonly filters: readonly string[]
}

/** `initialize` の応答から、adapter が名乗った filter の id を読む（壊れた項目は落とす）。 */
export function readDapExceptionBreakpointFilterIds(capabilities: unknown): readonly string[] {
  if (typeof capabilities !== 'object' || capabilities === null) {
    return []
  }

  const filters = (capabilities as { readonly exceptionBreakpointFilters?: unknown })
    .exceptionBreakpointFilters

  if (!Array.isArray(filters)) {
    return []
  }

  const ids: string[] = []

  for (const filter of filters) {
    if (typeof filter !== 'object' || filter === null) {
      continue
    }

    const id = (filter as { readonly filter?: unknown }).filter

    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) {
      ids.push(id)
    }
  }

  return ids
}

/**
 * 送る引数。送らないなら null。
 *
 * 並びは表（`requested`）の順。adapter が名乗っていない id は、表にあっても送らない。
 */
export function selectDapExceptionBreakpointFilters(
  capabilities: unknown,
  requested: readonly string[]
): DapSetExceptionBreakpointsArguments | null {
  if (requested.length === 0) {
    return null
  }

  const advertised = readDapExceptionBreakpointFilterIds(capabilities)
  const filters = requested.filter(
    (id, index) => advertised.includes(id) && requested.indexOf(id) === index
  )

  return filters.length === 0 ? null : { filters }
}
