import type { JSX } from 'react'

/**
 * Git パネルの操作アイコン（Session 3-8-3）。
 *
 * 描き方は Files のアイコン（files/FileTreeIcons.tsx）とまったく同じにしてある。
 *
 *   - 外部のアイコンフォント・画像を使わず、その場で描く SVG。CSP（`default-src 'self'`）を
 *     1文字も緩めずに済む
 *   - `currentColor` で描くので、ホバーや disabled の色がそのまま乗る。色を決めるのは
 *     CSS 側（git.css）で、SVG は色を知らないままでよい
 *   - `viewBox="0 0 16 16"`・`aria-hidden`。名前は包む button 側が持つ
 *
 * **ファイル自体は Git ドメインの中に置く。** FileTreeIcons.tsx は Files の中でだけ
 * 使われていて、パネルをまたいで参照される作りにはなっていない ── そちらへ足すと、
 * Files のアイコンの表に Git の操作が混ざり、どちらの都合で増えた行なのかが
 * 追えなくなる。共有するのは**描き方**であって、置き場所ではない。
 *
 * 種類別のファイルアイコン（fileIcon.ts）を行頭に出していないのは、Git の一覧が
 * 答えているのが「何のファイルか」ではなく**何が起きたか**だから。行頭は
 * `M` / `A` / `D` の記号が持つ（gitChanges.ts）── 端末で見ている字と揃えてある。
 */

/**
 * Stage（＋）。
 *
 * 線の太さは FileTreeIcons.tsx の `GLYPH`（1.3）に揃える。小さい記号なので、
 * 輪郭の太さ（1.2）だと隣の記号より細く見える。
 */
export function StageIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M8 3.5v9M3.5 8h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 競合を「解決済みにする」（Session 3-8-18）。
 *
 * **`＋`（Stage）と違う形にしてある**のが、このアイコンの決めごとになる ──
 * 動く git は同じ `git add` だが意味が違い（index の3段を1段に畳む）、
 * 同じ形で出すと押した後に何が起きたのかを説明できない
 * （main/git/gitConflict.ts）。
 *
 * チェックにしてあるのは「済んだことを記録する」という意味が最も近いため。
 * 破棄（`DiscardIcon`）のような危険色は付けない ── 利用者が書いた中身は
 * 1文字も動かない操作にあたる。
 */
export function ResolveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Unstage（−）。
 *
 * ＋から縦棒を取っただけの形にしてある。**別の絵（矢印・取り消し線）にしない**のは、
 * この2つが対の操作だから ── 見た目が対でなければ、押した結果が対であることも伝わらない。
 */
export function UnstageIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 差分を見る（Session 3-8-9）。
 *
 * **2枚の紙が並んでいる形**にしてある。「見る」を目のかたちで表さないのは、
 * 隣の破棄と大きさが揃わないため ── どちらも 12px の枠に収める必要があり、
 * 曲線の多い絵はその大きさで潰れる。
 *
 * 左を細い枠だけ、右を塗りにして「左と右を比べる」ことを形で出している。
 */
export function DiffIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <rect
        x="2.5"
        y="3"
        width="5"
        height="10"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect x="8.5" y="3" width="5" height="10" rx="1" fill="currentColor" />
    </svg>
  )
}

/**
 * この commit からブランチを作る（Session 3-8-13）。
 *
 * **1本の線から、もう1本が分かれる形**にしてある。git のグラフでいちばん
 * よく見る絵で、「今ここから枝が生える」以外に読みようが無い ── ＋（Stage）と
 * 見た目が近くならないのも選んだ理由になる（同じ面に並びはしないが、
 * どちらも「足す」操作なので、絵まで似ていると意味が混ざる）。
 *
 * 3つの丸は上から「分かれる前」「分かれた先」「そのまま続く先」。丸を塗りに
 * してあるのは、12px の枠で輪郭だけにすると点にしか見えないため
 * （DiffIcon が右の紙を塗りにしてあるのと同じ理由）。
 *
 * 押した先で何が起きるかは、開く欄の下の1行が言う
 * （GitCommitBranchForm.tsx）── アイコンは**そこへ行く入口**の印に留める。
 */
export function BranchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M5 4.5v7M5 8h3.5a2 2 0 0 0 2-2V4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="3.2" r="1.5" fill="currentColor" />
      <circle cx="5" cy="12.8" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="3.2" r="1.5" fill="currentColor" />
    </svg>
  )
}

/**
 * 変更を破棄する（Session 3-8-9）。
 *
 * **戻る矢印**にしてある。ごみ箱の絵にしないのは、この操作の意味が
 * グループで2通りに割れるため ── 「変更」は元へ戻す（消えるのは書きかけだけ）、
 * 「未追跡」はごみ箱へ送る。どちらか一方の絵にすると、もう片方の行で嘘になる。
 * 共通しているのは「押す前の状態へ戻す」ことなので、そちらを形にしている。
 *
 * 何が起きるかを本当に伝えるのは、押した後に出る確認の文になる
 * （GitDiscardConfirm.tsx）── アイコンは**そこへ行く入口**の印に留める。
 */
export function DiscardIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M3.5 7.5A4.5 4.5 0 1 1 5 11.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M1.6 5.1 3.5 7.7 6.1 5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
