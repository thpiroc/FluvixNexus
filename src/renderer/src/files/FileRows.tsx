import type { CSSProperties, JSX } from 'react'
import type { FileEntryType } from '@shared/files'
import { FileNameInput } from './FileNameInput'
import { describeFileTreeError } from './filesError'
import { FileTypeIcon } from './FileTreeIcons'
import type { FileTreeRow } from './fileTreeModel'
import { useI18n } from '../i18n/context'
import type { TFunction } from '../i18n/messages'

/**
 * ツリーとカラムが**そのまま同じものを使う行**（Session 3-6-7）。
 *
 * 状況を伝える行（読み込み中・空・打ち切り・失敗）と、名前を打つための行は、
 * 表示方式が変わっても意味も見た目も変わらない ── どちらも「そのフォルダが
 * 今どういう状態か」を伝えるものであって、縦に並んでいるか横に並んでいるかとは
 * 関係が無い。2箇所に書くと、片方だけ再試行ボタンが無い・片方だけ空の知らせが
 * 出ない、といった差が表示方式ごとに生まれる。
 *
 * エントリの行（ファイル / フォルダ）はここに置いていない。あちらは表示方式で
 * 中身が変わる ── ツリーは展開の三角と階層のインデントを持ち、カラムは
 * 「右へ入る」印を持つ。**同じにならないものを1つの部品にまとめない。**
 */

/** 1階層あたりのインデント幅は CSS 側が持つ。ここが渡すのは深さだけ。 */
export interface FileRowStyle extends CSSProperties {
  readonly '--fx-file-depth': number
}

/**
 * 行そのものではなく、そのフォルダの状況を伝える行。
 *
 * treeitem にしていないのは、選んだり開いたりできるものではないため。
 * 失敗した場合だけ、その場で読み直せるボタンを出す（全体を作り直さずに済む）。
 */
export function FileNoteRow({
  row,
  onRetry
}: {
  readonly row: Extract<FileTreeRow, { kind: 'note' }>
  readonly onRetry: (relativePath: string) => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <div
      role="none"
      className="fx-file-note"
      data-variant={row.variant}
      data-relative-path={row.relativePath}
      style={{ '--fx-file-depth': row.depth } as FileRowStyle}
    >
      <span className="fx-file-note__text">{describeNote(row, t)}</span>

      {row.variant === 'error' && (
        <button
          type="button"
          className="fx-file-note__retry"
          onClick={() => onRetry(row.relativePath)}
        >
          {t('files.note.retry')}
        </button>
      )}
    </div>
  )
}

/**
 * 新しいものの名前を打つための行。
 *
 * **種類別のアイコンにしない** ── 1文字打つごとに絵が変わると、打っている名前ではなく
 * アイコンの方に目が行く（何が作られるかは形＝ファイル / フォルダで足りる）。
 *
 * `twisty` はツリーだけが渡す。カラムには展開の三角が無いため、その分の場所を
 * 空けると入力欄の左端が他の行とずれる。
 */
export function FileDraftRow({
  row,
  twisty = false,
  onCommit,
  onCancel
}: {
  readonly row: Extract<FileTreeRow, { kind: 'draft' }>
  readonly twisty?: boolean
  readonly onCommit: (
    parentRelativePath: string,
    entryType: FileEntryType,
    name: string
  ) => Promise<boolean>
  readonly onCancel: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <div
      className="fx-file-row fx-file-row--draft"
      data-type={row.entryType}
      data-draft="create"
      style={{ '--fx-file-depth': row.depth } as FileRowStyle}
    >
      {twisty && <span className="fx-file-row__twisty" aria-hidden="true" />}

      <span className="fx-file-row__icon" aria-hidden="true">
        <FileTypeIcon icon={row.entryType === 'directory' ? 'folder' : 'file'} />
      </span>

      <FileNameInput
        initialName=""
        ariaLabel={
          row.entryType === 'directory'
            ? t('files.input.newFolderName')
            : t('files.input.newFileName')
        }
        onCommit={(name) => onCommit(row.parentRelativePath, row.entryType, name)}
        onCancel={onCancel}
      />
    </div>
  )
}

function describeNote(row: Extract<FileTreeRow, { kind: 'note' }>, t: TFunction): string {
  switch (row.variant) {
    case 'loading':
      return t('files.note.loading')

    case 'empty':
      return t('files.note.empty')

    case 'truncated':
      return t('files.note.truncated')

    case 'error':
      return row.reason === null
        ? t('files.note.unavailable')
        : describeFileTreeError(row.reason, t)
  }
}
