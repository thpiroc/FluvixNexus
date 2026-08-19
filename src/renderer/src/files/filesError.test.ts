import { describe, expect, it } from 'vitest'
import { COPY_LINK_SOURCE_DETAIL, COPY_PARTIAL_DETAIL, MOVE_INTO_SELF_DETAIL } from '@shared/files'
import type { IpcErrorCode, IpcErrorPayload } from '@shared/ipc'
import { describeFileActionError, type FileActionKind } from './filesError'

/**
 * 失敗を利用者向けの文言へ変えるところ。
 *
 * 確かめたいことは2つ。
 *  1. **次の一手が違う失敗が、同じ文言に潰れていないこと。**
 *     使用中・権限・不在は、利用者がすることがそれぞれ違う。
 *  2. **開発者向けの文字列が UI に漏れていないこと。**
 *     Main から来る message / detail には `shell.trashItem` の生の文言が入るが、
 *     あれは原因とすら対応していない（main/files/deleteObstacle.ts の観測表）。
 */

const ALL_ERROR_CODES: readonly IpcErrorCode[] = [
  'INVALID_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'BUSY',
  'PERMISSION_DENIED',
  'UNSUPPORTED',
  'CANCELLED',
  'CHANNEL_UNAVAILABLE',
  'INTERNAL'
]

const ALL_ACTIONS: readonly FileActionKind[] = ['create', 'rename', 'move', 'copy', 'delete']

/** Main から実際に届く形（message と detail は開発者向け）。 */
function payload(code: IpcErrorCode, detail?: string): IpcErrorPayload {
  return detail === undefined
    ? { code, message: 'the operation was refused by the file system.' }
    : { code, message: 'the operation was refused by the file system.', detail }
}

describe('describeFileActionError', () => {
  it('すべてのコードと操作の組み合わせに文言がある', () => {
    for (const action of ALL_ACTIONS) {
      for (const code of ALL_ERROR_CODES) {
        expect(describeFileActionError(action, payload(code)).length).toBeGreaterThan(0)
      }
    }
  })

  /*
    Session 3-5.2。ごみ箱 API の Error には code が無く、message も原因と対応しない。
    "Failed to parse path" が出てくるのは「対象が無い」「名前の末尾が空白」
    「パスの区切りが `/`」…と無関係な場面ばかりで、利用者に見せる意味が無い。
  */
  it('Main の message / detail をそのまま出さない', () => {
    for (const action of ALL_ACTIONS) {
      for (const code of ALL_ERROR_CODES) {
        const message = describeFileActionError(
          action,
          payload(code, 'Error: Failed to parse path (probe: unknown at the target)')
        )

        expect(message).not.toContain('Failed to parse path')
        expect(message).not.toContain('probe:')
        expect(message).not.toContain('file system')
      }
    }
  })

  /* ------------------------------------------------ 次の一手で言い分ける */

  it('削除の4分類が、それぞれ別の文言になる', () => {
    const messages = (['BUSY', 'PERMISSION_DENIED', 'NOT_FOUND', 'INTERNAL'] as const).map((code) =>
      describeFileActionError('delete', payload(code))
    )

    expect(new Set(messages).size).toBe(messages.length)
  })

  it('使用中は「閉じてやり直す」と分かる', () => {
    const message = describeFileActionError('delete', payload('BUSY'))

    expect(message).toContain('使用')
    expect(message).toContain('閉じて')
  })

  it('権限が無いときは、権限の話だと分かる', () => {
    expect(describeFileActionError('delete', payload('PERMISSION_DENIED'))).toContain('権限')
    expect(describeFileActionError('create', payload('PERMISSION_DENIED'))).toContain('権限')
  })

  it('対象が無いときは、既に消えている可能性まで伝える', () => {
    const message = describeFileActionError('delete', payload('NOT_FOUND'))

    expect(message).toContain('見つかりません')
    expect(message).toContain('削除された')
  })

  /*
    理由が分からなかった削除。Main 側でファイルシステムに訊き直しても
    分からなかったものなので、残る心当たりを添える
    （「失敗しました」で終わると、利用者にできることが無くなる）。
  */
  it('理由の分からない削除には、試せる心当たりを添える', () => {
    const message = describeFileActionError('delete', payload('INTERNAL'))

    expect(message).toContain('ごみ箱')
    expect(message).not.toBe(describeFileActionError('create', payload('INTERNAL')))
  })

  /* ------------------------------------------------------------ 名前の問題 */

  it('名前の問題は detail から拾って、何を直せばよいかを出す', () => {
    expect(describeFileActionError('create', payload('INVALID_REQUEST', 'reserved'))).toContain(
      'Windows'
    )

    expect(
      describeFileActionError('rename', payload('INVALID_REQUEST', 'trailing-character'))
    ).toContain('末尾')
  })

  it('detail が名前の問題でなければ、そちらには寄せない', () => {
    expect(describeFileActionError('create', payload('INVALID_REQUEST', 'EPERM'))).toBe(
      describeFileActionError('create', payload('INVALID_REQUEST'))
    )
  })

  /* ------------------------------------------------------ 移動 / コピー */

  /*
    理由（detail）は移動と同じ値を共有している（shared/files/move.ts）。
    共有しているのは**成立しない理由と次の一手が同じ**だからで、
    利用者に見せる文言までは揃えない。
  */
  it('自分自身の中への指定は、移動とコピーで言い方が変わる', () => {
    const move = describeFileActionError('move', payload('INVALID_REQUEST', MOVE_INTO_SELF_DETAIL))
    const copy = describeFileActionError('copy', payload('INVALID_REQUEST', MOVE_INTO_SELF_DETAIL))

    expect(move).toContain('移動')
    expect(copy).toContain('コピー')
    expect(move).not.toBe(copy)
  })

  it('リンクのコピーは、リンクだから断られたと分かる', () => {
    expect(
      describeFileActionError('copy', payload('INVALID_REQUEST', COPY_LINK_SOURCE_DETAIL))
    ).toContain('リンク')
  })

  /*
    コピーは同名でも断らない（名前を変えて作る）。CONFLICT が返るのは
    候補を使い切った場合だけなので、「同じ名前がある」で止めると次の一手が伝わらない。
  */
  it('コピーの CONFLICT は、移動の同名衝突とは別の文言になる', () => {
    const copy = describeFileActionError('copy', payload('CONFLICT'))

    expect(copy).not.toBe(describeFileActionError('move', payload('CONFLICT')))
    expect(copy).toContain('多すぎ')
  })

  /*
    作りかけが残ることは、分類（権限 / 使用中 / それ以外）より先に伝える
    ── 原因が何であれ、次の一手は「残ったものを消してやり直す」で同じ。
  */
  it.each(['PERMISSION_DENIED', 'BUSY', 'INTERNAL'] as const)(
    'コピーが途中で止まったことは、原因（%s）によらず同じ文言で伝わる',
    (code) => {
      const message = describeFileActionError('copy', payload(code, COPY_PARTIAL_DETAIL))

      expect(message).toContain('残っています')
      expect(message).toBe(
        describeFileActionError('copy', payload('PERMISSION_DENIED', COPY_PARTIAL_DETAIL))
      )
    }
  )
})
