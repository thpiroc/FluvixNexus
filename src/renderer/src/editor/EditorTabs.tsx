import type { JSX } from 'react'
import { describeEditorTabState, hasUnsavedChanges } from './editorTabState'
import type { EditorTab } from './editorTabsModel'

/**
 * Editor のタブ列。
 *
 * Workspace Shell の PanelGroup が持つタブ（どのパネルを手前に出すか）とは別物で、
 * こちらは**そのパネルの中身**が持つタブ。見た目を揃えつつクラス名を分けているのは、
 * パネルを Dock で動かしてもこのタブ列は Editor に付いて回る、という関係を
 * 混同しないため。
 *
 * タブ1枚は「切り替えのボタン」と「閉じるボタン」を並べた器にする
 * （button を入れ子にできないため）。PanelGroup と同じ作り。
 *
 * ## 未保存の印
 *
 * `data-state` を器に付け、印は CSS（editor.css）が出す。
 * 文字として名前の後ろに足さないのは、名前が長くて省略されたときに
 * **印まで一緒に消える**ため。印は「保存されていない」という状態そのもので、
 * 見えなくなってよいものではない。
 *
 * 状態は4つあり（editorTabState.ts）、印の**色**で区別する。
 *
 *   dirty    … 通常の未保存
 *   conflict … ディスク側も変わっている
 *   deleted  … ディスク上から消えた
 *
 * 色だけに頼らないよう、`title` に理由の文言を入れる（記号も色も読み上げられない）。
 * 最終的な見せ方はまだ決めていない ── ここで確かめたいのは
 * 「Conflict になったことが**タブから分かる**」という最低限。
 */

interface EditorTabsProps {
  readonly tabs: readonly EditorTab[]
  readonly activeTabId: string | null
  readonly onActivate: (tabId: string) => void
  readonly onClose: (tabId: string) => void
}

export function EditorTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose
}: EditorTabsProps): JSX.Element {
  return (
    <div className="fx-editor__tabs" role="tablist" aria-label="開いているファイル">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const note = describeEditorTabState(tab.state)

        return (
          <div
            key={tab.id}
            className="fx-editor-tab"
            role="tab"
            aria-selected={active}
            data-active={active}
            data-state={tab.state}
            data-dirty={hasUnsavedChanges(tab.state)}
            data-tab-id={tab.id}
            data-relative-path={tab.relativePath}
            // 全体はここで読めるようにする（タブの幅に合わせて名前は省略される）。
            title={note === null ? tab.relativePath : `${tab.relativePath}（${note}）`}
          >
            <button
              type="button"
              className="fx-editor-tab__label"
              onClick={() => onActivate(tab.id)}
            >
              {tab.name}
            </button>

            {/* 名前が省略されても消えない位置に出す（このファイルの冒頭）。 */}
            <span className="fx-editor-tab__dirty" aria-hidden="true" />

            <button
              type="button"
              className="fx-editor-tab__close"
              aria-label={`${tab.name} を閉じる`}
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
