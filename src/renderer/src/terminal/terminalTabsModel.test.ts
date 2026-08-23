import { describe, expect, it } from 'vitest'
import { TERMINAL_MAX_SESSIONS } from '@shared/terminal'
import {
  activateTab,
  canOpenTab,
  closeTab,
  createTerminalTabsState,
  fillShellNames,
  findActiveTab,
  findTab,
  openTab,
  updateTab,
  type TerminalTabsState
} from './terminalTabsModel'

/**
 * タブの並びの規則（terminalTabsModel.ts）。
 *
 * 画面もセッションもここには出てこない。確かめるのは
 * **「どれが手前か」が常に1つに決まること**と、閉じた後の行き先。
 */

function withTabs(count: number): TerminalTabsState {
  let state = createTerminalTabsState()

  for (let index = 0; index < count; index += 1) {
    state = openTab(state, 'default', 'PowerShell')
  }

  return state
}

describe('openTab', () => {
  it('開いたタブが手前に出る', () => {
    const state = openTab(createTerminalTabsState(), 'node', 'Node')

    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).toBe(state.tabs[0].id)
    expect(findActiveTab(state)?.shellId).toBe('node')
  })

  it('開いた時点では立てない（idle のまま）', () => {
    const state = openTab(createTerminalTabsState(), 'default', 'PowerShell')

    expect(state.tabs[0].status).toBe('idle')
  })

  it('id は重ならない', () => {
    const state = withTabs(3)

    expect(new Set(state.tabs.map((tab) => tab.id)).size).toBe(3)
  })

  it('上限に達したら何も起きない', () => {
    const full = withTabs(TERMINAL_MAX_SESSIONS)

    expect(canOpenTab(full)).toBe(false)
    expect(openTab(full, 'default', 'PowerShell')).toBe(full)
  })
})

describe('activateTab', () => {
  it('手前のタブを切り替える', () => {
    const state = withTabs(2)
    const next = activateTab(state, state.tabs[0].id)

    expect(next.activeTabId).toBe(state.tabs[0].id)
  })

  it('知らない id では何も起きない', () => {
    const state = withTabs(2)

    expect(activateTab(state, 'terminal-999')).toBe(state)
  })
})

describe('closeTab', () => {
  it('手前のタブを閉じたら右隣が出る', () => {
    const state = activateTab(withTabs(3), 'terminal-2')
    const next = closeTab(state, 'terminal-2')

    expect(next.tabs.map((tab) => tab.id)).toEqual(['terminal-1', 'terminal-3'])
    expect(next.activeTabId).toBe('terminal-3')
  })

  it('右隣が無ければ左隣が出る', () => {
    const state = withTabs(3) // 3枚目が手前
    const next = closeTab(state, 'terminal-3')

    expect(next.activeTabId).toBe('terminal-2')
  })

  it('手前でないタブを閉じても、手前は変わらない', () => {
    const state = withTabs(3)
    const next = closeTab(state, 'terminal-1')

    expect(next.activeTabId).toBe('terminal-3')
  })

  it('最後の1枚を閉じたら手前が無くなる', () => {
    const next = closeTab(withTabs(1), 'terminal-1')

    expect(next.tabs).toHaveLength(0)
    expect(next.activeTabId).toBeNull()
    expect(findActiveTab(next)).toBeNull()
  })

  /* 閉じた後に上限が空くこと（閉じても開けないままにならない）。 */
  it('閉じれば、また開けるようになる', () => {
    const full = withTabs(TERMINAL_MAX_SESSIONS)

    expect(canOpenTab(closeTab(full, 'terminal-1'))).toBe(true)
  })
})

describe('updateTab', () => {
  it('状態を差し替える', () => {
    const state = updateTab(withTabs(1), 'terminal-1', { status: 'running', shellName: 'Node' })

    expect(findTab(state, 'terminal-1')).toMatchObject({ status: 'running', shellName: 'Node' })
  })

  /*
    応答が返る前に閉じられたタブ。非同期の結末が、もう無いものを指して届く。
  */
  it('知らない id では何も起きない', () => {
    const state = withTabs(1)

    expect(updateTab(state, 'terminal-999', { status: 'running' })).toBe(state)
  })
})

describe('fillShellNames', () => {
  it('名前が分かっていないタブにだけ入れる', () => {
    let state = openTab(createTerminalTabsState(), 'default', null)
    state = openTab(state, 'node', 'Node（起動時の名前）')

    const filled = fillShellNames(state, (shellId) =>
      shellId === 'default' ? 'PowerShell' : 'Node'
    )

    expect(filled.tabs[0].shellName).toBe('PowerShell')
    // 既に名前を持つタブには触らない（Main が返した実際の名前の方が確か）。
    expect(filled.tabs[1].shellName).toBe('Node（起動時の名前）')
  })

  it('一覧に無い行はそのまま（分からないまま）', () => {
    const state = openTab(createTerminalTabsState(), 'claude-code', null)

    expect(fillShellNames(state, () => null).tabs[0].shellName).toBeNull()
  })

  it('入れるものが無ければ同じ state を返す', () => {
    const state = withTabs(2)

    expect(fillShellNames(state, () => 'PowerShell')).toBe(state)
  })
})
