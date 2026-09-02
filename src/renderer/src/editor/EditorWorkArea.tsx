import type { JSX } from 'react'
import { AUTO_SAVE_MODES, describeAutoSaveMode, type AutoSaveMode } from './autoSave'
import { useEditorContext } from './context'
import { EditorDocumentView } from './EditorDocumentView'
import { EditorTabs } from './EditorTabs'
import { describeSaveAsNotice } from './saveAsMessage'
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
    saveFileAs,
    saveAsNotice,
    dismissSaveAsNotice,
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
          別名で保存（Session 4-2）。

          削除されたタブの帯（EditorConflictBar.tsx）にも同じ入口があるが、
          あちらは「救い出す」1つだけの選択肢で、こちらは**どのタブでも押せる**
          通常の操作にあたる。呼ぶ先は同じ `saveFileAs` で、
          削除されているかどうかで経路を分けていない。

          専用のショートカットは置かない ── アプリ全体のショートカット基盤は
          STEP 4-7 で入れる予定で、それより先に1つだけ生やすと入口が2通りになる。
        */}
        <button
          type="button"
          className="fx-editor__save-as"
          data-testid="editor-save-as"
          disabled={activeTab === null || activeTab.document.status !== 'ready'}
          title="保存先を選んで、このタブの内容を書き出します。"
          onClick={() => {
            if (activeTab !== null) {
              void saveFileAs(activeTab.id)
            }
          }}
        >
          別名で保存
        </button>

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

      {/*
        別名で保存の結末を1行で伝える（Session 4-2）。

        **書けたのにタブが動かない場合がある**（Workspace の外・保存先が別のタブに
        開かれている）ため、成功も黙らない ── 黙ると、押した側からは
        「何も起きなかった」と区別が付かない。

        手前のタブのものだけを出す。知らせの鍵がタブ id なのは、
        保存の後にそのタブの位置が変わるため（useEditorSession.ts）。
      */}
      {saveAsNotice !== null && saveAsNotice.tabId === activeTabId && (
        <p
          className="fx-editor__save-as-notice"
          data-followed={saveAsNotice.followed}
          data-testid="editor-save-as-notice"
        >
          <span>{describeSaveAsNotice(saveAsNotice)}</span>
          <button
            type="button"
            className="fx-editor__save-as-dismiss"
            aria-label="閉じる"
            onClick={dismissSaveAsNotice}
          >
            ×
          </button>
        </p>
      )}

      {activeTab !== null && (
        <EditorDocumentView
          tab={activeTab}
          documents={documents}
          saveState={saveStates[activeTab.relativePath]}
          onReload={reload}
          onReloadFromDisk={(relativePath) => void reloadFromDisk(relativePath)}
          onOverwrite={(relativePath) => void saveFile(relativePath, { overwrite: true })}
          onSaveAs={(tabId) => void saveFileAs(tabId)}
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
