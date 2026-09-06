import { describe, expect, it } from 'vitest'
import { createInitializeParams } from './initializeParams'

/**
 * `initialize` で何を名乗るか（Session 5-2）。
 *
 * 申告は約束にあたる ── 名乗った機能はサーバがそれを前提に動く。
 * だから確かめたいのは「載っているもの」より**「載っていないもの」**になる。
 *
 * | 観点                                | 名乗ってしまうと何が起きるか                       |
 * | ----------------------------------- | -------------------------------------------------- |
 * | willSave を名乗らない               | 保存がサーバの応答待ちで遅れる経路ができる         |
 * | dynamicRegistration を名乗らない    | 応じる口の無い `client/registerCapability` が来る   |
 * | configuration を名乗らない          | 応じる口の無い `workspace/configuration` が来る     |
 * | positionEncodings を utf-16 に固定  | 差分の桁が1文字ずつずれる（Monaco の数え方と食い違う） |
 */

const params = createInitializeParams({
  processId: 1234,
  clientName: 'Fluvix Nexus',
  clientVersion: '0.0.1',
  rootUri: 'file:///D%3A/proj',
  rootName: 'D:\\proj'
})

const capabilities = params.capabilities as Record<string, Record<string, unknown>>

describe('createInitializeParams', () => {
  it('自分のプロセス id を渡す（孤児のサーバを残さないための保険）', () => {
    expect(params.processId).toBe(1234)
  })

  it('root を rootUri と workspaceFolders の両方に載せる', () => {
    expect(params.rootUri).toBe('file:///D%3A/proj')
    expect(params.workspaceFolders).toEqual([{ uri: 'file:///D%3A/proj', name: 'D:\\proj' }])
  })

  it('文字の位置は UTF-16 で数えると明示する', () => {
    expect(
      (capabilities.general as { positionEncodings: readonly string[] }).positionEncodings
    ).toEqual(['utf-16'])
  })

  it('文書同期は didSave まで名乗る', () => {
    const synchronization = (capabilities.textDocument as Record<string, Record<string, unknown>>)
      .synchronization

    expect(synchronization.didSave).toBe(true)
    expect(synchronization.dynamicRegistration).toBe(false)
  })

  it('保存の前に割り込む経路は名乗らない', () => {
    const synchronization = (capabilities.textDocument as Record<string, Record<string, unknown>>)
      .synchronization

    expect(synchronization.willSave).toBe(false)
    expect(synchronization.willSaveWaitUntil).toBe(false)
  })

  it('設定を尋ねてよいとは言わない（応じる口が無いため）', () => {
    expect(capabilities.workspace.configuration).toBe(false)
  })

  it('診断も補完も名乗らない（受け取る器がまだ無い ── Session 5-3 以降）', () => {
    const textDocument = capabilities.textDocument

    expect('publishDiagnostics' in textDocument).toBe(false)
    expect('completion' in textDocument).toBe(false)
    expect('definition' in textDocument).toBe(false)
    expect('rename' in textDocument).toBe(false)
    expect('formatting' in textDocument).toBe(false)
  })
})
