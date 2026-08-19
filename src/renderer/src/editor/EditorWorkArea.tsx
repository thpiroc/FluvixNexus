import type { JSX } from 'react'
import { AUTO_SAVE_MODES, describeAutoSaveMode, type AutoSaveMode } from './autoSave'
import { useEditorContext } from './context'
import { EditorDocumentView } from './EditorDocumentView'
import { EditorTabs } from './EditorTabs'
import { TabCloseConfirm } from './TabCloseConfirm'
import { useTabCloseGuard } from './useTabCloseGuard'
import './editor.css'

/**
 * Editor パネルの中身（Workspace が開かれているとき）。
 *
 * Files パネルの FileTree.tsx にあたる位置づけで、panels/EditorPanel.tsx は
 * 「何を出す状態か」だけを決め、中身はこちらが持つ。
 *
 * タブの状態は Context から読む。開く操作をするのは Files パネルであり、
 * 出すのはこのパネル、という**別々の場所**にある2つを Context がつないでいる
 * （editor/context.ts）。
 *
 * ## 閉じる操作はここを通る
 *
 * `controller.close` は確認をしない（保存を済ませた後にも使うため）。
 * 利用者の操作としての「閉じる」はすべて `useTabCloseGuard` の `requestClose` を
 * 通し、未保存があれば確認を挟む。入口を1つにしておくと、
 * タブの × 以外の閉じ方（今後のキーボード操作など）が増えても保護が抜けない。
 *
 * ## Auto Save の切り替えをここに置く理由
 *
 * 設定画面（DESIGN.md §9）はまだ無い。上部バー（Workspace Shell）に置くこともできるが、
 * あそこは**レイアウトそのものを操作するもの**の場所で、パネル固有の設定を置くと
 * 「Shell はパネルの事情を持たない」という分担（ARCHITECTURE.md §7.2）が崩れる。
 * Settings が入った時点でそちらへ移す（設定の**値**は既にアプリの設定として
 * 保存されている ── editor/autoSave.ts）。
 */
export function EditorWorkArea(): JSX.Element {
  const controller = useEditorContext()
  const closeGuard = useTabCloseGuard(controller)

  const {
    tabs,
    activeTabId,
    activeTab,
    activate,
    reload,
    reloadFromDisk,
    readDiskContent,
    documents,
    saveStates,
    saveFile,
    autoSave,
    setAutoSaveMode,
    pendingReveal,
    consumeReveal
  } = controller

  if (tabs.length === 0) {
    return (
      <div className="fx-editor fx-editor--empty">
        <p className="fx-editor__empty-title">ファイルが開かれていません</p>
        <p className="fx-editor__empty-body">Files パネルでファイルを選ぶとここに開きます。</p>
      </div>
    )
  }

  return (
    <div className="fx-editor">
      <div className="fx-editor__toolbar">
        <EditorTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activate}
          onClose={closeGuard.requestClose}
        />

        {/*
          4つの mode すべてが動く（Session 3-5）。設定はアプリの設定として
          保存されるため、選び直した状態が次回起動でもそのまま出る。
        */}
        <select
          className="fx-editor__autosave"
          aria-label="自動保存"
          data-testid="editor-autosave"
          value={autoSave.mode}
          onChange={(event) => setAutoSaveMode(event.target.value as AutoSaveMode)}
        >
          {AUTO_SAVE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {describeAutoSaveMode(mode)}
            </option>
          ))}
        </select>
      </div>

      {activeTab !== null && (
        <EditorDocumentView
          tab={activeTab}
          documents={documents}
          saveState={saveStates[activeTab.relativePath]}
          onReload={reload}
          onReloadFromDisk={(relativePath) => void reloadFromDisk(relativePath)}
          onOverwrite={(relativePath) => void saveFile(relativePath, { overwrite: true })}
          readDiskContent={readDiskContent}
          /*
            位置の依頼は、**手前に出ているタブのものだけ**を下へ渡す
            （editor/editorReveal.ts）。開いた直後はまだ中身が届いておらず、
            そのときは何も起きない ── 届いて Monaco が載った時点で改めて渡る。
          */
          reveal={
            pendingReveal !== null && pendingReveal.relativePath === activeTab.relativePath
              ? pendingReveal
              : null
          }
          onRevealed={consumeReveal}
        />
      )}

      {closeGuard.request !== null && (
        <TabCloseConfirm
          request={closeGuard.request}
          busy={closeGuard.busy}
          error={closeGuard.error}
          onSave={closeGuard.save}
          onDiscard={closeGuard.discard}
          onCancel={closeGuard.cancel}
        />
      )}
    </div>
  )
}
