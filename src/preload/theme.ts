import { fromThemeArguments, THEME_ATTRIBUTE, type ThemeId } from '@shared/theme'

/**
 * 保存済みの Theme を、**最初の描画より前に** `<html>` へ当てる（Session 4-4）。
 *
 * ## 何を消しているか
 *
 * Light を選んでいる状態でアプリを起動すると、Session 4-3B までの構造では
 * 必ず一瞬 Dark が見える。Renderer が `settings.json` を読み終えるのは
 * React が動き出してからで、そこへ至るまでに **CSS は既に評価されている**ためで、
 * 「読み込んでから当てる」形にする限り消えない。
 *
 * ```
 * 窓が出る（backgroundColor）        Main が保存済み Theme から決める
 * HTML の解析が始まる                ← ここで属性を当てる（このファイル）
 * CSS が評価される                   最初から Light。Dark が出る隙が無い
 * React が動き出す
 * settings:load が返る               ThemeProvider が同じ値を当て直す（変化なし）
 * ```
 *
 * ## なぜ Preload なのか
 *
 * `<html>` に属性が付いた状態で CSS を評価させるには、**HTML の解析より前**に
 * 動く必要がある。Renderer 側の入口（main.tsx）は解析の後に走るので間に合わず、
 * `index.html` へ直接書く手も使えない ── インラインの `<script>` は
 * CSP（`script-src 'self'`）が止める。**CSP は1文字も緩めない**という前提
 * （ARCHITECTURE.md §5）を保ったまま解ける場所は Preload しか無い。
 *
 * ## API は1つも増えていない
 *
 * ここは `contextBridge` に何も足さない。**Renderer へ公開される口は
 * Session 4-3B とまったく同じ**で、この関数がするのは属性を1つ当てることだけ。
 * Renderer から Node にも fs にも process にも触れないことも変わらない。
 *
 * ## Theme はどこから来るか
 *
 * Main が `webPreferences.additionalArguments` で渡す（`--fx-initial-theme=light`）。
 * IPC ではないのは、**IPC は Renderer が動き出してからしか使えず、それでは
 * 間に合わない**ため ── 避けたいのがまさに「動き出すまで」の一瞬にほかならない。
 * Session 4-3A の2本（`settings:load` / `settings:save-section`）はそのままで、
 * チャンネルは1本も増えていない。
 *
 * 読めない / 渡って来なかった場合は Dark（`fromThemeArguments`）。
 * `theme.css` の側も知らない値は Dark に見えるので、**落とし先が二重に守られる。**
 */

/**
 * `<html>` が生まれた瞬間に当てる。
 *
 * Preload が走る時点では**まだ `<html>` が無い**（HTML の解析はこの後）。
 * `DOMContentLoaded` を待つ手もあるが、あれは解析が**終わった**ときで、
 * 途中で最初の描画が起きうる。`MutationObserver` で `document` の直下を見張れば、
 * `<html>` が作られたその場で当てられる ── 中身が1つも解析されていない時点なので、
 * 属性の無い状態で描画されることが無い。
 */
export function applyInitialTheme(theme: ThemeId = fromThemeArguments(process.argv)): void {
  if (applyToRoot(theme)) {
    return
  }

  const observer = new MutationObserver(() => {
    if (applyToRoot(theme)) {
      observer.disconnect()
    }
  })

  observer.observe(document, { childList: true })
}

function applyToRoot(theme: ThemeId): boolean {
  /*
    型の上では非 null だが、Preload が走る時点では実際に null になる
    （解析が始まる前）。当てられるようになるまでは false を返して見張り続ける。
  */
  const root = document.documentElement as Element | null

  if (root === null) {
    return false
  }

  root.setAttribute(THEME_ATTRIBUTE, theme)

  return true
}
