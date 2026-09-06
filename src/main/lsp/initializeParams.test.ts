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

  /**
   * 診断は「名乗らないと来ない」。
   *
   * typescript-language-server は、この申告が無いと診断を1通も送ってこない
   * （実際に繋いで確かめた。initializeParams.ts）。仕様の上では省略できるが、
   * **送るかどうかを申告で決めるサーバがある**ため、受け取る側は名乗る必要がある。
   */
  it('診断を受け取れると名乗る（Session 5-3）', () => {
    const publishDiagnostics = (
      capabilities.textDocument as Record<string, Record<string, unknown>>
    ).publishDiagnostics

    expect(publishDiagnostics).toBeDefined()
    // 版を見て古い指摘を捨てる（main/lsp/diagnostics.ts）。
    expect(publishDiagnostics.versionSupport).toBe(true)
    // unnecessary / deprecated を Monaco の印へ写す。
    expect(publishDiagnostics.tagSupport).toEqual({ valueSet: [1, 2] })
    // 関連する別の位置は、まだ描いていない。
    expect(publishDiagnostics.relatedInformation).toBe(false)
  })

  it('補完は名乗り、定義も Rename も整形も名乗らない（Session 5-5）', () => {
    const textDocument = capabilities.textDocument

    expect(textDocument.completion).toMatchObject({
      dynamicRegistration: false,
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        preselectSupport: true
      }
    })
    expect('definition' in textDocument).toBe(false)
    expect('references' in textDocument).toBe(false)
    expect('hover' in textDocument).toBe(false)
    expect('rename' in textDocument).toBe(false)
    expect('formatting' in textDocument).toBe(false)
  })
})
