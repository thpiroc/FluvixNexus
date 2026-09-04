import { describe, expect, it } from 'vitest'
import { THEME_ATTRIBUTE, THEME_IDS, THEME_WINDOW_BACKGROUND, type ThemeId } from '@shared/theme'
import { THEME_TOKEN_NAMES } from '../theme/themeTokens'
import THEME_CSS from './theme.css?raw'
import MONACO_SETUP_SOURCE from '../editor/monaco/monacoSetup.ts?raw'
import XTERM_SETUP_SOURCE from '../terminal/xtermSetup.ts?raw'
import THEME_TOKENS_SOURCE from '../theme/themeTokens.ts?raw'

/**
 * `theme.css` そのものを読む唯一のテスト（Session 4-4）。
 *
 * ## なぜ CSS をテストするのか
 *
 * Session 4-4 で「**このアプリの色は `theme.css` の1箇所にしかない**」という形に
 * した。Monaco も xterm も、そこから読んで組み立てる（theme/themeTokens.ts）。
 * この形は写しを無くす代わりに、**変数の名前1つで繋がっている**ことになる ──
 * 名前を変えたのに片方だけ直した、Light に片方だけ足し忘れた、という間違いは
 * 型検査にもリンタにも掛からず、画面を開くまで分からない。
 *
 * ここが見張るのはその繋ぎ目だけで、
 *
 *   - Dark（`:root`）が定義している変数と、Light が定義している変数が**同じ集合**か
 *   - Monaco / xterm が要る変数（`THEME_TOKEN_NAMES`）が**両方に**あるか
 *   - 窓の初期色（`THEME_WINDOW_BACKGROUND`）が `--fx-color-app-bg` と一致するか
 *   - Light が Dark の値をそのまま流用していないか（幕と影を含む）
 *
 * 「その色が見やすいか」は見張らない ── それは実機で見るしかない
 * （docs/DEVELOPMENT.md §4）。
 *
 * ## 読み方
 *
 * CSS の parser は入れず、`:root { … }` のブロックを取り出して
 * `--name: value;` を拾うだけにする。**この程度で足りるのは、`theme.css` が
 * 変数の定義しか持たないファイルだから**にほかならない（規則を書くのは
 * それぞれの機能の CSS で、あちらは値を持たない）。
 *
 * 中身は `?raw`（Vite）で読む。`fs` を使わないのは、**Renderer 側の型検査に
 * Node の型を持ち込まないため**にほかならない ── `tsconfig.web.json` に
 * `types: ["node"]` を足すと、Renderer のコードが `fs` や `process` を
 * 書いても型検査を通るようになり、「Renderer から OS へ触らせない」という
 * 前提が型の上では守られなくなる。
 */

/** Theme ごとの選択子。Dark は素の `:root`、Light は属性での上書き。 */
const SELECTORS: Readonly<Record<ThemeId, string>> = {
  dark: ':root',
  light: `:root[${THEME_ATTRIBUTE}='light']`
}

/**
 * 1つの選択子のブロックから `--name: value` を拾う。
 *
 * コメントを先に落としているのは、注釈の中に書いた変数名（説明のための引用）を
 * 定義として数えないため。
 */
function declarationsOf(selector: string): Map<string, string> {
  const withoutComments = THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = withoutComments.indexOf(`${selector} {`)

  expect(start, `選択子 ${selector} が theme.css に無い`).toBeGreaterThanOrEqual(0)

  const end = withoutComments.indexOf('}', start)
  const body = withoutComments.slice(start, end)
  const found = new Map<string, string>()

  for (const line of body.split('\n')) {
    const match = /^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/.exec(line)

    if (match !== null) {
      found.set(match[1], match[2].trim())
    }
  }

  return found
}

const dark = declarationsOf(SELECTORS.dark)
const light = declarationsOf(SELECTORS.light)

/** 色にあたる変数だけ（間隔・文字サイズ・高さは Theme に依らない）。 */
function colorNames(declarations: Map<string, string>): string[] {
  return [...declarations.keys()]
    .filter((name) => /^--fx-(color|accent|file-icon|git|shadow)-/.test(name))
    .sort()
}

describe('theme.css の構造', () => {
  it('Theme の数だけ選択子がある', () => {
    for (const theme of THEME_IDS) {
      expect(declarationsOf(SELECTORS[theme]).size).toBeGreaterThan(0)
    }
  })

  /*
    Dark を素の `:root` に置いてあること。**知らない Theme 名が付いていても
    Dark に見える**のはこの置き方の効き目で、落とし先が JavaScript 側だけに
    頼らずに済む（theme.css の冒頭）。
  */
  it('Dark は素の :root に置く（知らない Theme 名でもここへ落ちる）', () => {
    expect(THEME_CSS).toMatch(/(^|\n):root \{/)
    expect(dark.get('--fx-color-app-bg')).toBeDefined()
  })
})

describe('Dark と Light が同じ集合を持つ', () => {
  /*
    Session 4-4 の E ── **36色すべてを Light 用として設計する。**
    片方にしか無い色があると、その色だけ Dark 用の値が残ることになる。
  */
  it('色の変数が、両方の Theme に揃っている', () => {
    expect(colorNames(light)).toEqual(colorNames(dark))
  })

  /*
    内訳。Session 4-3B までの35色（面5・枠2・文字5・識別色4・ファイル種別13・
    Git 6）に、Session 4-4 で変数へ出した幕と影の5つが加わって40になる。
    数を書いてあるのは、**Light 側へ足し忘れた色があると集合の比較より先に
    ここが落ちる**ようにするため。
  */
  it('色は40ある（面 / 枠 / 文字 / 識別色 / ファイル種別 / Git / 幕と影）', () => {
    expect(colorNames(dark)).toHaveLength(40)
  })

  /*
    Session 4-4 の F ── **Light で Dark 用の重い幕 / 影をそのまま流用しない。**
    白い面の上では 45% の黒が「奥が見えない板」になる。
  */
  it('幕と影は Theme ごとに別の値', () => {
    for (const name of [
      '--fx-color-scrim',
      ...colorNames(dark).filter((n) => n.includes('shadow'))
    ]) {
      expect(light.get(name), name).toBeDefined()
      expect(light.get(name), name).not.toBe(dark.get(name))
    }
  })

  it('Light が Dark の値をそのまま写している色が無い', () => {
    for (const name of colorNames(dark)) {
      expect(light.get(name), name).not.toBe(dark.get(name))
    }
  })

  /*
    間隔・文字サイズ・高さは Theme の話ではない（道具の寸法）。
    Light 側で上書きしていたら、Theme を変えると行の高さが動くことになる。
  */
  it('Light は色以外を上書きしない', () => {
    for (const name of light.keys()) {
      if (name.startsWith('--fx-space') || name.startsWith('--fx-font-size')) {
        expect.unreachable(`${name} は Theme に依らない値`)
      }
    }
  })
})

describe('他の層との繋ぎ目', () => {
  /*
    Monaco / xterm が読む変数（theme/themeTokens.ts）。**名前を変えたのに
    片方だけ直した**を通さないためのもので、これが落ちるということは
    Monaco か端末の色が黙って代替値へ落ちるということにほかならない。
  */
  it('Monaco / xterm が要る変数が、両方の Theme にある', () => {
    for (const theme of THEME_IDS) {
      const declarations = declarationsOf(SELECTORS[theme])

      for (const name of THEME_TOKEN_NAMES) {
        expect(declarations.get(name), `${theme} に ${name} が無い`).toBeDefined()
      }
    }
  })

  /*
    窓の初期色（shared/theme/theme.ts）。CSS が1行も評価されていない時点で要る
    ため、この2色だけは JavaScript 側にも写しがある ── **ずれるとその Theme の
    起動時だけ地の色が一瞬違って見える。**
  */
  it('窓の初期色が --fx-color-app-bg と一致する', () => {
    expect(dark.get('--fx-color-app-bg')).toBe(THEME_WINDOW_BACKGROUND.dark)
    expect(light.get('--fx-color-app-bg')).toBe(THEME_WINDOW_BACKGROUND.light)
  })

  /* OS 側の描画（スクロールバー・フォーム部品）も Theme に合わせる。 */
  it('color-scheme が Theme ごとに切り替わる', () => {
    expect(THEME_CSS).toContain('color-scheme: dark')
    expect(THEME_CSS).toContain('color-scheme: light')
  })
})

describe('色を持つのはこのファイルだけ', () => {
  /*
    Session 4-4 の C ── 同じ Theme の値を複数箇所へ書き写す構造を避ける。
    Monaco と xterm の設定ファイルに 16進数が戻ってきたら落とす
    （戻した時点で「片方を変えるときは両方を直すこと」が復活する）。
  */
  it('monacoSetup.ts と xtermSetup.ts に色が書かれていない', () => {
    const sources = {
      'monacoSetup.ts': MONACO_SETUP_SOURCE,
      'xtermSetup.ts': XTERM_SETUP_SOURCE,
      'themeTokens.ts': THEME_TOKENS_SOURCE
    }

    for (const [name, raw] of Object.entries(sources)) {
      // 注釈の中の色（説明のための引用）は数えない。
      const source = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      const hexes = source.match(/#[0-9a-fA-F]{6}\b/g) ?? []

      /*
        themeTokens.ts の代替値（読めなかった変数の落とし先）だけは残る。
        あれは Theme の設計ではなく「色として不正でない」ためだけの値にあたる。
      */
      expect(hexes.length, `${name} に色がある: ${hexes.join(', ')}`).toBeLessThanOrEqual(1)
    }
  })
})
