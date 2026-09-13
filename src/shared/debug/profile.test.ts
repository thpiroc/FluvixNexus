import { describe, expect, it } from 'vitest'
import { DEBUG_PROFILE_LANGUAGES, isDebugProfileIdShape, isDebugProfileLanguage } from './profile'

describe('Debug Profile shapes (Session 6-10)', () => {
  it('languages are a closed set', () => {
    expect([...DEBUG_PROFILE_LANGUAGES]).toEqual(['node', 'python', 'csharp'])
    expect(isDebugProfileLanguage('python')).toBe(true)
    expect(isDebugProfileLanguage('pwa-node')).toBe(false)
    expect(isDebugProfileLanguage(undefined)).toBe(false)
  })

  it('accepts only ids in the shape Main issues', () => {
    expect(isDebugProfileIdShape('dp-0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true)

    for (const value of [
      'dp-0F8FAD5B-D9CB-469F-A165-70867728950E',
      '0f8fad5b-d9cb-469f-a165-70867728950e',
      'dp-0f8fad5b-d9cb-469f-a165-70867728950e ',
      'dp-../../debug-profiles.json',
      'my-profile',
      '',
      42,
      null
    ]) {
      expect(isDebugProfileIdShape(value)).toBe(false)
    }
  })
})
