import { describe, expect, it } from 'vitest'
import {
  DEBUG_ADAPTER_LANGUAGE_IDS,
  getDebugAdapterCatalogEntry,
  isDebugAdapterLanguageId,
  listDebugAdapterCatalogEntries
} from './adapterCatalog'

describe('Debug Adapter catalog foundation', () => {
  it('言語は閉じた集合だけを受け付ける', () => {
    expect([...DEBUG_ADAPTER_LANGUAGE_IDS]).toEqual(['node', 'python', 'csharp'])
    expect(isDebugAdapterLanguageId('node')).toBe(true)
    expect(isDebugAdapterLanguageId('ruby')).toBe(false)
  })

  it('Session 6-1 では実 adapter 統合をまだ持たない', () => {
    expect(listDebugAdapterCatalogEntries()).toEqual([
      { language: 'node', name: 'Node.js Debug Adapter', integrationStatus: 'not-integrated' },
      { language: 'python', name: 'debugpy', integrationStatus: 'not-integrated' },
      { language: 'csharp', name: 'netcoredbg', integrationStatus: 'not-integrated' }
    ])
  })

  it('Renderer が任意 adapter を指定する入口ではなく、Main 内の language だけで引く', () => {
    expect(getDebugAdapterCatalogEntry('python')).toEqual({
      language: 'python',
      name: 'debugpy',
      integrationStatus: 'not-integrated'
    })
  })
})
