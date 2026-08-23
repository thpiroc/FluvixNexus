import type { IpcErrorPayload } from '@shared/ipc'
import { describeIpcError } from '../api/result'

/**
 * Terminal の失敗を利用者向けの文言にする（React / DOM 非依存）。
 *
 * `api/result.ts` の対応表はコードだけを見るため、どのドメインでも同じ文言になる。
 * ここで上書きするのは、**利用者の次の一手がドメインによって違う**場合だけ。
 * files/filesError.ts が同じ役どころを担っている。
 *
 * | コード     | 一般の文言                       | ここで言い換える理由                       |
 * | ---------- | -------------------------------- | ------------------------------------------ |
 * | `NOT_FOUND`| 「対象が見つかりませんでした」   | 探すものが無いのではなく、Workspace が要る |
 * | `CONFLICT` | 「現在の状態と競合しています」   | 競合ではなく、開きすぎ                     |
 *
 * それ以外は言い換えない。言い換えるほど良いのではなく、
 * **次にすることが変わらない失敗まで別の文にすると、違いに意味が無くなる。**
 */
export function describeTerminalError(error: IpcErrorPayload): string {
  switch (error.code) {
    case 'NOT_FOUND':
      /*
        起動しようとしたときの NOT_FOUND は「Workspace が無い」、
        入力しようとしたときの NOT_FOUND は「もう終わっている」。
        どちらも画面には終了として現れるため、起動の側の文言に寄せてある。
      */
      return 'ターミナルを開くには、先にフォルダを開いてください。'

    case 'CONFLICT':
      return 'ターミナルを開きすぎています。使っていないものを閉じてください。'

    case 'INTERNAL':
      // シェルを起動できなかった場合がここに来る（ConPTY が無い・実行ファイルが無い）。
      return 'シェルを起動できませんでした。'

    default:
      return describeIpcError(error)
  }
}
