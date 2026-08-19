import type { JSX } from 'react'
import type { FileIconId } from './fileIcon'

/**
 * ファイルツリーのアイコン。
 *
 * 外部のアイコンフォント・画像を使わず、その場で描く SVG にしてある。
 *   - CSP（`default-src 'self'`）を保つ。外部 CDN もフォントも読まない
 *   - `currentColor` で描くため、選択・ホバーの色がそのまま乗る
 *
 * ## 種類別のアイコン（Session 3-6-6）
 *
 * 「この名前は何か」を決めるのは fileIcon.ts（純粋・テスト対象）で、ここが持つのは
 * **その答えをどう描くか**だけ。分けてあるのは、判定を React にも DOM にも
 * 依存しない形で残すため（fileTreeModel.ts と FileTree.tsx の分担と同じ）。
 *
 * 色は CSS 側（files.css の `.fx-file-icon[data-file-icon]`）が決める。ここで
 * 色を書かないのは、テーマの語彙を1箇所（styles/theme.css）に保つため ──
 * `currentColor` で描いてあるので、SVG は色を知らないままでよい。
 */

/* 描き方は3種類しかない。線の太さと端の形をここで固定して、絵ごとにばらつかせない。 */

/** 輪郭（閉じた形）。 */
const OUTLINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinejoin: 'round'
} as const

/** 中に描く印（開いた線）。輪郭より少しだけ太くして、小さくても潰れないようにする。 */
const GLYPH = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

/** 細かい形（枠の中の文字など）。線が交差する絵で、太さが勝たないようにする。 */
const FINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

/** 一般のファイル（＝種類が分からないもの）の輪郭。新規ファイルのアイコンとも形を揃える。 */
const FILE_SHEET = (
  <>
    <path d="M3.75 1.75h5.5l3 3v9.5h-8.5z" {...OUTLINE} />
    <path d="M9.25 1.75v3h3" {...OUTLINE} />
  </>
)

/** React（`.tsx` / `.jsx`）。区別は色が持つ（files.css）ので、形は同じものを使う。 */
const REACT_ATOM = (
  <>
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    <ellipse cx="8" cy="8" rx="6.1" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
    <ellipse
      cx="8"
      cy="8"
      rx="6.1"
      ry="2.5"
      transform="rotate(60 8 8)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    />
    <ellipse
      cx="8"
      cy="8"
      rx="6.1"
      ry="2.5"
      transform="rotate(120 8 8)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    />
  </>
)

/**
 * 種類ごとの中身（`viewBox="0 0 16 16"` の中に描く）。
 *
 * `Record<FileIconId, …>` にしてあるので、fileIcon.ts に種類を足して
 * ここへ足し忘れると型エラーになる（対応表と絵がずれない）。
 */
const FILE_ICON_SHAPES: Readonly<Record<FileIconId, JSX.Element>> = {
  folder: <path d="M1.75 12.75v-9.5h4l1.4 1.8h7.1v7.7z" {...OUTLINE} />,

  /*
    展開中のフォルダ。**中身が見えている**ことを、手前の面を倒した形で示す。
    別の絵（点や色）にしないのは、閉じた側と同じ「フォルダ」であることが
    形として残っている方が、開閉の対比として読み取りやすいため。
  */
  'folder-open': (
    <>
      <path d="M1.75 12.75v-9.5h4l1.4 1.8h7.1v1.75" {...OUTLINE} />
      <path d="M1.75 12.75 3.5 7.5h10.75l-1.75 5.25z" {...OUTLINE} />
    </>
  ),

  typescript: (
    <>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.2" {...OUTLINE} />
      <path d="M5.6 6.6h4.8M8 6.6v4.3" {...GLYPH} />
    </>
  ),

  'typescript-react': REACT_ATOM,

  javascript: (
    <>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.2" {...OUTLINE} />
      <path d="M9.7 6.2v3.4a1.7 1.7 0 0 1-3.4 0" {...GLYPH} />
    </>
  ),

  'javascript-react': REACT_ATOM,

  json: (
    <>
      <path
        d="M6.7 3.1c-1.4 0-1.5 1.1-1.5 2.3s-.6 2.3-1.7 2.6c1.1.3 1.7 1.4 1.7 2.6s.1 2.3 1.5 2.3"
        {...FINE}
      />
      <path
        d="M9.3 3.1c1.4 0 1.5 1.1 1.5 2.3s.6 2.3 1.7 2.6c-1.1.3-1.7 1.4-1.7 2.6s-.1 2.3-1.5 2.3"
        {...FINE}
      />
    </>
  ),

  html: <path d="M5.6 5.2 2.4 8l3.2 2.8M10.4 5.2 13.6 8l-3.2 2.8M9.2 3.9 6.8 12.1" {...FINE} />,

  css: (
    <path
      d="M8 2.6c2.7 3.1 4.1 5 4.1 6.5a4.1 4.1 0 0 1-8.2 0C3.9 7.6 5.3 5.7 8 2.6z"
      {...OUTLINE}
    />
  ),

  markdown: (
    <>
      <rect x="1.8" y="4" width="12.4" height="8" rx="1.6" {...FINE} />
      <path d="M4.2 9.9V6.1l1.9 2.2 1.9-2.2v3.8" {...FINE} />
      <path d="M10.6 6.1v3.8M9.3 8.6l1.3 1.3 1.3-1.3" {...FINE} />
    </>
  ),

  python: (
    <>
      <rect x="3.1" y="2.5" width="6.6" height="6.6" rx="1.9" {...OUTLINE} />
      <rect x="6.3" y="6.9" width="6.6" height="6.6" rx="1.9" {...OUTLINE} />
      <circle cx="5.2" cy="4.5" r="0.75" fill="currentColor" />
      <circle cx="10.8" cy="11.5" r="0.75" fill="currentColor" />
    </>
  ),

  csharp: <path d="M6.5 4.2 5.4 11.8M10.1 4.2 9 11.8M4.3 6.9h7.3M3.9 9.5h7.3" {...FINE} />,

  image: (
    <>
      <rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.6" {...OUTLINE} />
      <circle cx="5.8" cy="6.7" r="1.15" {...FINE} />
      <path d="M2.8 11.9 6.4 8.5l2.3 2.1 2.1-1.8 2.4 2.3" {...FINE} />
    </>
  ),

  text: (
    <>
      {FILE_SHEET}
      <path d="M5.6 7.6h4.8M5.6 9.8h4.8M5.6 12h3.2" {...FINE} />
    </>
  ),

  package: (
    <>
      <path d="M8 1.9 13.7 5v6L8 14.1 2.3 11V5z" {...OUTLINE} />
      <path d="M2.3 5 8 8.1l5.7-3.1M8 8.1v6" {...OUTLINE} />
    </>
  ),

  git: (
    <>
      <circle cx="4.6" cy="3.6" r="1.7" {...OUTLINE} />
      <circle cx="4.6" cy="12.4" r="1.7" {...OUTLINE} />
      <circle cx="11.4" cy="3.6" r="1.7" {...OUTLINE} />
      <path d="M4.6 5.3v5.4" {...GLYPH} />
      <path d="M11.4 5.3v1c0 2-1.6 3.1-3.4 3.4-1.4.2-2.4.7-3.4 1.7" {...FINE} />
    </>
  ),

  docker: (
    <>
      <rect x="2.9" y="7.4" width="2.7" height="2.7" rx="0.4" {...FINE} />
      <rect x="6.2" y="7.4" width="2.7" height="2.7" rx="0.4" {...FINE} />
      <rect x="9.5" y="7.4" width="2.7" height="2.7" rx="0.4" {...FINE} />
      <rect x="6.2" y="4.2" width="2.7" height="2.7" rx="0.4" {...FINE} />
      <path d="M1.9 11.7h10.5c1.4 0 2.3-.8 2.7-2" {...FINE} />
    </>
  ),

  readme: (
    <>
      <path d="M8 4.6C6.5 3.5 4.6 3.1 2.6 3.3v8.3c2-.2 3.9.2 5.4 1.3z" {...OUTLINE} />
      <path d="M8 4.6c1.5-1.1 3.4-1.5 5.4-1.3v8.3c-2-.2-3.9.2-5.4 1.3z" {...OUTLINE} />
    </>
  ),

  file: FILE_SHEET
}

/**
 * ファイル・フォルダの種類別アイコン（Session 3-6-6）。
 *
 * 大きさは種類によらず 14px で固定する ── 行の高さもインデントも展開の三角の位置も
 * 変えないため。**種類が分からないファイルでも必ず何かを描く**ので、
 * 名前の左が空いて行ごとに文字の位置がずれることが起きない。
 *
 * `data-file-icon` を持たせてあるのは、色を CSS 側で決めるためと、
 * 実機・テストから「何と判定されたか」を読めるようにするため。
 */
export function FileTypeIcon({ icon }: { readonly icon: FileIconId }): JSX.Element {
  return (
    <svg
      className="fx-file-icon"
      data-file-icon={icon}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      {FILE_ICON_SHAPES[icon]}
    </svg>
  )
}

/** 展開・折りたたみの三角。向きは CSS の回転で変える（FileTree の data-expanded）。 */
export function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 右下に添える「＋」。2つのアイコンで同じ位置に出すため、定義を1つにする。 */
const PLUS_PATH = 'M11.5 10v4.2M9.4 12.1h4.2'

/**
 * 新規ファイル / 新規フォルダ。
 *
 * それぞれ一般のファイル / フォルダのアイコン（FILE_ICON_SHAPES の `file` / `folder`）に
 * 「＋」を添えた形にしてある。ツリーの中のアイコンと同じ輪郭を使うことで、
 * 何が作られるかが形で分かる。
 */
export function NewFileIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.75 1.75h5.5l3 3v4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M3.75 1.75v12.5h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d={PLUS_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function NewFolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M1.75 12.75v-9.5h4l1.4 1.8h7.1v3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M1.75 12.75h6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d={PLUS_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 閉じる（root 行の Workspace を閉じるボタン）。
 *
 * 素の `×` ではなく SVG にしているのは、フォントによって大きさと縦位置が変わり、
 * 22px の行の中で他のアイコンと揃わないため。
 */
export function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <path
        d="M3 3l6 6M9 3l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 検索（Files パネルを検索モードへ切り替える入口）。 */
export function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <circle cx="6.8" cy="6.8" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M10 10l3.6 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * ツリーへ戻る。
 *
 * 展開の三角（ChevronIcon）と同じ形を左向きに使う ── 別の絵にすると、
 * 同じ「戻る / 閉じる」の語彙が2つになる。
 */
export function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M7.5 2.5 4 6l3.5 3.5"
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
 * ツリー表示 / カラム表示の切り替え（Session 3-6-7）。
 *
 * **中身ではなく形を描く。** ツリーは「左に軸があり、右へ枝が出る」、カラムは
 * 「縦の帯が横に並ぶ」── どちらもファイルの絵を使わないのは、押した先で
 * 変わるのが並べ方だけであるため。
 */
export function TreeViewIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M3.2 2.2v9.4M3.2 4.6h4M3.2 8h4M3.2 11.6h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M8.4 3.4h4.4M8.4 6.8h4.4M8.4 10.2h4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.65"
      />
    </svg>
  )
}

export function ColumnsViewIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <rect
        x="1.9"
        y="2.6"
        width="12.2"
        height="10.8"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M6 2.6v10.8M10 2.6v10.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 再読み込み。 */
export function RefreshIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M13 8a5 5 0 1 1-1.6-3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M13 1.8v3.4h-3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
