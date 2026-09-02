import { describe, expect, it } from 'vitest'
import { describeLossNote, describeLossPrompt } from './lossMessage'
import type { LossItem } from './types'

/**
 * 確認の文面（lossMessage.ts）。
 *
 * Session 3-7-4 で、この確認が扱うものが2種類になった。固定しておきたいのは
 * **種別が混ざっても、言っていることが正しいまま**であることになる
 * ── 実行中のターミナルしか無いのに「保存されていない変更があります」と出れば、
 * 利用者は身に覚えのない警告として読み飛ばす。
 */

function unsavedFile(id: string): LossItem {
  return { id, kind: 'unsaved-file', name: id, detail: id, unsavable: false }
}

function deletedFile(id: string): LossItem {
  return { id, kind: 'unsaved-file', name: id, detail: id, unsavable: true }
}

function runningTerminal(id: string): LossItem {
  return { id, kind: 'running-terminal', name: 'PowerShell', detail: id, unsavable: true }
}

describe('describeLossPrompt', () => {
  it('未保存のファイルだけなら、保存の話をする', () => {
    const prompt = describeLossPrompt('close-workspace', [unsavedFile('a.ts')])

    expect(prompt.title).toBe('保存されていない変更があります')
    expect(prompt.body).toBe('Workspace を閉じると、次のファイルの未保存の変更が失われます。')
    expect(prompt.discardLabel).toBe('保存しない')
    expect(prompt.canSave).toBe(true)
  })

  /** 保存にあたるものが無いので、保存の話をしない（「終了する」か「キャンセル」）。 */
  it('実行中のターミナルだけなら、終了の話をする', () => {
    const prompt = describeLossPrompt('close-window', [runningTerminal('terminal-1')])

    expect(prompt.title).toBe('実行中のターミナルがあります')
    expect(prompt.body).toBe(
      'Fluvix Nexus を終了すると、次のターミナルで実行中のコマンドが終了します。'
    )
    expect(prompt.discardLabel).toBe('終了する')
    expect(prompt.canSave).toBe(false)
  })

  /** 両方あるときに片方だけを言わない ── 言わなかった方が黙って消える。 */
  it('両方あるなら両方を言う', () => {
    const prompt = describeLossPrompt('close-window', [
      unsavedFile('a.ts'),
      runningTerminal('terminal-1')
    ])

    expect(prompt.title).toBe('保存されていない変更と、実行中のターミナルがあります')
    expect(prompt.body).toBe(
      'Fluvix Nexus を終了すると、次のファイルの未保存の変更が失われ、実行中のターミナルが終了します。'
    )
    expect(prompt.canSave).toBe(true)
  })

  /** 保存しても終了は起きる。ボタンにそれを書く。 */
  it('両方あるときの続ける側は「保存せずに終了」', () => {
    const prompt = describeLossPrompt('close-window', [
      unsavedFile('a.ts'),
      runningTerminal('terminal-1')
    ])

    expect(prompt.discardLabel).toBe('保存せずに終了')
  })

  /*
    押せるのに必ず失敗する選択肢を出さない（types.ts の unsavable）。
    ディスクから消えたファイルは、保存を選んでも救えない。
  */
  it('救えるものが1つも無ければ保存を出さない', () => {
    const prompt = describeLossPrompt('close-window', [deletedFile('gone.ts')])

    expect(prompt.canSave).toBe(false)
  })

  it('1件でも救えるなら保存を出す', () => {
    const prompt = describeLossPrompt('close-window', [deletedFile('gone.ts'), unsavedFile('a.ts')])

    expect(prompt.canSave).toBe(true)
  })
})

describe('describeLossNote', () => {
  it('ふつうの未保存には何も添えない', () => {
    expect(describeLossNote(unsavedFile('a.ts'))).toBeNull()
  })

  it('消えたファイルには理由と、救い出せる場所を添える', () => {
    /*
      理由だけでは行き止まりに読める（この確認からは救えない）。
      救える経路は Editor の帯にしか無いので、押せない理由と一緒にそこを書く
      （Session 4-2）。
    */
    expect(describeLossNote(deletedFile('gone.ts'))).toBe(
      'ディスク上から削除されています（Editor の「別名で保存」で救い出せます）'
    )
  })

  it('実行中のターミナルには、なぜ並んでいるかを添える', () => {
    expect(describeLossNote(runningTerminal('terminal-1'))).toBe('実行中のコマンドがあります')
  })
})
