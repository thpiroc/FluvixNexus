import { lazy, Suspense, type JSX } from 'react'
import { FILES_FILE_MAX_BYTES } from '@shared/files'
import { describeFileTreeError } from '../files/filesError'
import { EditorConflictBar } from './EditorConflictBar'
import type { EditorRevealRequest } from './editorReveal'
import type { EditorTab } from './editorTabsModel'
import type { EditorDocumentStore } from './monaco/documentStore'
import type { EditorDiskContent, EditorSaveState } from './useEditorSession'

/**
 * Monaco はここから**遅延して読み込む**（このファイルの唯一の値としての依存）。
 *
 * 理由は2つあり、どちらもこの1行で満たされる。
 *
 *   - **起動を Monaco の大きさに引きずられない。** Monaco は React アプリ本体より
 *     一桁大きい。Workspace を開いてテキストファイルを選ぶまで要らないものを、
 *     起動時のバンドルに含めない。
 *   - **Panel Registry を辿るだけで Monaco が読み込まれない。** レイアウトの
 *     純粋なロジックを試すテスト（node 環境）は Registry 経由でこのファイルまで
 *     辿り着く。Monaco は読み込まれた時点で `window` を触るため、静的に
 *     import すると IPC も DOM も使っていないテストが環境の都合で落ちる
 *     （`api/fluvix.ts` が読み込み時に `window` を見ない理由と同じ。
 *     docs/DEVELOPMENT.md §3）。
 *
 * Compare の Diff Editor（EditorConflictBar.tsx）も同じ形で遅延させてある。
 */
const MonacoEditor = lazy(async () => {
  const module = await import('./monaco/MonacoEditor')

  return { default: module.MonacoEditor }
})

/**
 * 開いているファイルの中身。
 *
 * ここが決めるのは**何を出す状態か**だけで、テキストを描くのは Monaco
 * （monaco/MonacoEditor.tsx）。EditorPanel が Workspace の3状態を分けているのと同じ形。
 *
 * | 状態        | 出すもの                                       |
 * | ----------- | ---------------------------------------------- |
 * | `loading`   | 読み込み中                                     |
 * | `ready`     | **Monaco**（＋食い違っていれば選択肢）         |
 * | `binary`    | 理由（テキストとして出せない）                 |
 * | `too-large` | 大きさと上限                                   |
 * | `error`     | 理由と再試行                                   |
 *
 * ## テキストとして出せないものを Monaco へ渡さない
 *
 * バイナリを無理に文字列化すると、化けた内容を**編集して保存できる**状態になる。
 * 大きすぎるファイルも同じで、渡した時点で固まるだけでなく、
 * 「中身の一部しか読めていないもの」を保存できてしまう。
 * どちらも読み込みの時点で中身を持たない（main/files/readWorkspaceFile.ts）ため、
 * ここで分岐すれば Monaco 側に特別扱いを入れずに済む。
 *
 * 中身が出せない場合も空白ではなく理由を出す。ファイルツリーが失敗を1行として
 * 扱っている（ARCHITECTURE.md §9.7）のと同じで、「開いたのに何も無い」を作らない。
 *
 * ## Conflict は Monaco の代わりではなく、上に足す
 *
 * 食い違っていてもエディタは出したまま、選択肢だけを上に並べる。
 * 差し替えてしまうと、**利用者が自分の変更を見られないまま**
 * Reload / 上書きを選ぶことになる。
 */

/** 読める大きさの表記（1024 区切り）。 */
function formatBytes(byteLength: number): string {
  if (byteLength < 1024) {
    return `${byteLength} B`
  }

  if (byteLength < 1024 * 1024) {
    return `${Math.round(byteLength / 1024)} KB`
  }

  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 保存のいまを1行で伝える。うまくいっている間は何も出さない。
 *
 * `conflict` の選択肢はここではなく EditorConflictBar が出す。
 * 保存しようとして気づいた場合も、監視で気づいた場合も**同じ場所に同じ選択肢**が
 * 出るようにするため（気づいた経路で見え方が変わると、同じ状態が2通りに見える）。
 */
function SaveStateNote({ state }: { readonly state: EditorSaveState }): JSX.Element | null {
  if (state.status === 'saving') {
    return <span className="fx-editor__hint">保存中…</span>
  }

  if (state.status === 'error') {
    return (
      <span className="fx-editor__hint" data-variant="error">
        保存できませんでした（{state.message}）
      </span>
    )
  }

  return (
    <span className="fx-editor__hint" data-variant="error">
      ディスク側が変更されているため保存していません
    </span>
  )
}

export function EditorDocumentView({
  tab,
  documents,
  saveState,
  onReload,
  onReloadFromDisk,
  onOverwrite,
  readDiskContent,
  reveal = null,
  onRevealed
}: {
  readonly tab: EditorTab
  readonly documents: EditorDocumentStore
  readonly saveState: EditorSaveState | undefined
  /** 開けなかったタブの読み直し（タブごと読み込み直す）。 */
  readonly onReload: (tabId: string) => void
  /** Conflict の Reload（Model の中身だけを差し替える）。 */
  readonly onReloadFromDisk: (relativePath: string) => void
  readonly onOverwrite: (relativePath: string) => void
  readonly readDiskContent: (relativePath: string) => Promise<EditorDiskContent>
  /**
   * 見せてほしい位置（editor/editorReveal.ts）。
   *
   * **Monaco へそのまま渡すだけ。** 中身が出せない状態（binary / too-large /
   * 失敗）のときは Monaco 自体を出さないため、依頼も届かない ── その場合は
   * 依頼を出した側が捨てる（useEditorTabs.ts）。
   */
  readonly reveal?: EditorRevealRequest | null
  readonly onRevealed?: () => void
}): JSX.Element {
  const conflicted = tab.state === 'conflict' || tab.state === 'deleted'

  return (
    <div
      className="fx-editor__document"
      data-status={tab.document.status}
      data-tab-state={tab.state}
    >
      {/*
        どのファイルを見ているかを常に出す。同じ名前のファイルが別のフォルダにあると、
        タブの名前だけでは区別が付かない。
      */}
      <div className="fx-editor__meta">
        <span className="fx-editor__path" data-testid="editor-relative-path">
          {tab.relativePath}
        </span>

        {saveState !== undefined ? (
          <SaveStateNote state={saveState} />
        ) : (
          tab.document.status === 'ready' && (
            <span className="fx-editor__hint">
              {formatBytes(tab.document.byteLength)} / {tab.document.lineEnding.toUpperCase()}
              {tab.document.encoding === 'utf8-bom' && ' / BOM'}
            </span>
          )
        )}
      </div>

      {conflicted && tab.document.status === 'ready' && (
        <EditorConflictBar
          relativePath={tab.relativePath}
          state={tab.state === 'deleted' ? 'deleted' : 'conflict'}
          /*
            比べる相手は Model の中身（＝今エディタに出ているもの）。
            読み込んだときの中身（tab.document.content）ではない。
          */
          editorContent={documents.getModel(tab.relativePath)?.getValue() ?? tab.document.content}
          busy={saveState?.status === 'saving'}
          onReload={() => onReloadFromDisk(tab.relativePath)}
          onOverwrite={() => onOverwrite(tab.relativePath)}
          readDiskContent={readDiskContent}
        />
      )}

      {tab.document.status === 'loading' && <p className="fx-editor__note">読み込み中…</p>}

      {tab.document.status === 'ready' && (
        <Suspense fallback={<p className="fx-editor__note">エディタを準備しています…</p>}>
          <MonacoEditor
            relativePath={tab.relativePath}
            content={tab.document.content}
            lineEnding={tab.document.lineEnding}
            encoding={tab.document.encoding}
            revision={tab.document.revision}
            documents={documents}
            reveal={reveal}
            onRevealed={onRevealed}
          />
        </Suspense>
      )}

      {tab.document.status === 'binary' && (
        <p className="fx-editor__note">
          バイナリファイルのため、テキストエディタでは表示できません（
          {formatBytes(tab.document.byteLength)}）。
        </p>
      )}

      {tab.document.status === 'too-large' && (
        <p className="fx-editor__note">
          ファイルが大きいため表示できません（{formatBytes(tab.document.byteLength)} / 上限{' '}
          {formatBytes(FILES_FILE_MAX_BYTES)}）。
        </p>
      )}

      {tab.document.status === 'error' && (
        <p className="fx-editor__note" data-variant="error">
          <span>{describeFileTreeError(tab.document.reason)}</span>
          <button type="button" className="fx-editor__retry" onClick={() => onReload(tab.id)}>
            再試行
          </button>
        </p>
      )}
    </div>
  )
}
