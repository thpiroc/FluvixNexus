import { createContext, useCallback, useContext, useMemo, type JSX, type ReactNode } from 'react'
import { useSettingsSection } from '../settings/useSettingsSection'
import { type FilesLayoutPreference } from './filesLayoutMode'
import {
  clampColumnWidth,
  DEFAULT_FILES_VIEW_SETTINGS,
  isSameFilesViewSettings,
  toFilesSettingsSection,
  toFilesViewSettings
} from './filesSettings'

/**
 * Files の**見え方**（選んだ表示方式・カラムの幅）を持つ器
 * （Session 3-6-7 / 永続化は Session 3-6-8）。
 *
 * ## なぜパネルの中に置かないか
 *
 * Files パネルは Dock / Split で動かせる。動かすとレイアウトの木の中で位置が変わり、
 * パネルは作り直される（App.tsx にある「Shell より外側に置く」理由と同じ）。
 * 表示方式の選択をパネルの中に持つと、**パネルを別の場所へ運んだだけで
 * 選んだことが消える** ── 縦長の場所ではツリーへ戻り、選び直すことになる。
 *
 * 選択は「その置き場所での見え方」ではなく「利用者がどちらで見たいか」なので、
 * 置き場所より長く生きるべきものにあたる。だから Shell の外側に置く。
 *
 * ## 持つのは選択と幅だけ（パネルの形は持たない）
 *
 * パネルの大きさの観測（ResizeObserver）は Files パネルの器の中に残す
 * （useFilesLayout.ts）── あれは**今その場所がどんな形か**であって、
 * 場所が変われば測り直すのが正しい。ここに置くと、パネルが無い間の
 * 古い大きさを持ち回ることになる。
 *
 *   ここ                … 選んだ表示方式とカラムの幅。置き場所より長く生き、ディスクにも残る
 *   useFilesLayout.ts   … 今の形の観測と、そこから決まる提案。パネルと同じ寿命
 *
 * Workspace を切り替えても消さない。見え方は**パネルの見え方**であって
 * Workspace の持ち物ではない（ファイルの位置や展開状態とは別のもの。
 * ARCHITECTURE.md §9.6）。
 *
 * ## 保存はここ1箇所（Session 3-6-8）
 *
 * Session 3-6-7 の時点では、アプリを閉じると選択も幅も忘れていた。読み書きを
 * ここへ置いたのは、**この器が「見え方」の正本だから**にほかならない ── 使う側
 * （useFilesLayout / FileColumns）に置くと、パネルの数だけ保存の口ができる。
 *
 * 読むのは起動時に1度だけで、Workspace には依存しない（アプリの設定であって
 * プロジェクトの設定ではない。shared/settings/sections.ts）。
 *
 * Session 4-3A で、読み書きの段取りそのものは settings/useSettingsSection.ts へ移した
 * ── **正本がここであることは変わらない**（移したのは「いつ読み、いつ書くか」だけで、
 * Editor / Terminal と一字一句同じだった部分にあたる）。
 */

interface FilesViewContextValue {
  readonly preference: FilesLayoutPreference
  readonly setPreference: (preference: FilesLayoutPreference) => void
  /** カラム1枚の幅（px）。全部の列で同じ値を使う。 */
  readonly columnWidth: number
  /** カラムの幅を変える（上下限は clampColumnWidth が掛ける）。 */
  readonly setColumnWidth: (width: number) => void
}

const FilesViewContext = createContext<FilesViewContextValue | null>(null)

export function FilesViewProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  /*
    起動時に1度だけ読み、変わったら書く。読めなければ既定（パネルの形に任せる・208px）
    のまま。その段取りは settings/useSettingsSection.ts が持ち、ここが渡すのは
    「どの section を、どう行き来させるか」だけ（Session 4-3A）。

    Renderer は保存先を知らない（settings ドメインの API はパスを取らない。
    ARCHITECTURE.md §5）。
  */
  const { value: settings, update: updateSettings } = useSettingsSection({
    section: 'files',
    initial: DEFAULT_FILES_VIEW_SETTINGS,
    fromStored: toFilesViewSettings,
    toStored: toFilesSettingsSection,
    label: 'Files の見え方'
  })

  const setPreference = useCallback(
    (preference: FilesLayoutPreference): void => {
      updateSettings((previous) => {
        const next = { ...previous, preference }

        return isSameFilesViewSettings(previous, next) ? previous : next
      })
    },
    [updateSettings]
  )

  /*
    幅は**掴んで動かしている間ずっと**届く。同じ値になったら据え置くことで、
    1px 未満の動き（ポインタの座標は小数）で再描画と保存が走り続けないようにする
    ── 丸めと上下限は clampColumnWidth が持つ（filesSettings.ts）。
  */
  const setColumnWidth = useCallback(
    (width: number): void => {
      updateSettings((previous) => {
        const next = { ...previous, columnWidth: clampColumnWidth(width) }

        return isSameFilesViewSettings(previous, next) ? previous : next
      })
    },
    [updateSettings]
  )

  const value = useMemo(
    () => ({
      preference: settings.preference,
      setPreference,
      columnWidth: settings.columnWidth,
      setColumnWidth
    }),
    [settings, setPreference, setColumnWidth]
  )

  return <FilesViewContext.Provider value={value}>{children}</FilesViewContext.Provider>
}

/**
 * 選んだ表示方式とカラムの幅を読み書きする。
 *
 * 器が無い場所（Provider の外）で呼ばれたら落とす。黙って既定値を返すと、
 * 「選んだのに次の描画で戻る」という形で表に出ることになり、原因が追いにくい。
 */
export function useFilesViewPreference(): FilesViewContextValue {
  const value = useContext(FilesViewContext)

  if (value === null) {
    throw new Error('useFilesViewPreference は FilesViewProvider の中でのみ使える')
  }

  return value
}
