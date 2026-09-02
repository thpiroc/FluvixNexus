import { describe, expect, it } from 'vitest'
import { describeSaveAsNotice } from './saveAsMessage'
import type { EditorSaveAsNotice } from './useEditorSession'

/**
 * 別名で保存の知らせ（Session 4-2）。
 *
 * 確かめたいのは1つだけ ── **どの結末でも「保存しました」から始まること。**
 *
 * この経路では、書けたのにタブが移らない場合がある。そこで文言を
 * 「移らなかった」側から書き始めると（例:「切り替えられませんでした」）、
 * 利用者からは保存そのものが失敗したように読める ── 実際には内容は
 * ディスクに出ており、それが分からないことこそがこの機能で一番避けたいこと。
 */
function notice(overrides: Partial<EditorSaveAsNotice> = {}): EditorSaveAsNotice {
  return { tabId: 'tab-1', name: 'rescued.txt', followed: true, reason: null, ...overrides }
}

describe('describeSaveAsNotice', () => {
  it('どの結末でも、まず「保存しました」と言う', () => {
    const all: EditorSaveAsNotice[] = [
      notice(),
      notice({ followed: false, reason: 'outside-workspace' }),
      notice({ followed: false, reason: 'already-open' }),
      notice({ followed: false, reason: null })
    ]

    for (const item of all) {
      expect(describeSaveAsNotice(item)).toContain('rescued.txt へ保存しました')
    }
  })

  it('移った場合は、このタブが保存先を編集していることを言う', () => {
    expect(describeSaveAsNotice(notice())).toBe(
      'rescued.txt へ保存しました。このタブはこのファイルを編集しています。'
    )
  })

  it('Workspace の外なら、タブが移らない理由を続けて書く', () => {
    const text = describeSaveAsNotice(notice({ followed: false, reason: 'outside-workspace' }))

    expect(text).toContain('Workspace の外')
    expect(text).toContain('元のファイルを指したまま')
  })

  it('別のタブが開いている場合も、理由を続けて書く', () => {
    const text = describeSaveAsNotice(notice({ followed: false, reason: 'already-open' }))

    expect(text).toContain('別のタブで開いている')
    expect(text).toContain('切り替えていません')
  })

  it('移らなかった知らせでは、失敗に読める言い方をしない', () => {
    const texts = [
      describeSaveAsNotice(notice({ followed: false, reason: 'outside-workspace' })),
      describeSaveAsNotice(notice({ followed: false, reason: 'already-open' }))
    ]

    for (const text of texts) {
      expect(text).not.toContain('できませんでした')
      expect(text).not.toContain('失敗')
    }
  })
})
