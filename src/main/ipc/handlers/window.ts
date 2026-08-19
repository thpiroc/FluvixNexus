import { IPC_CHANNELS, type WindowCloseDecision } from '@shared/ipc'
import { resolveWindowClose } from '../../windows/closeGuard'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * window ドメインのハンドラ（閉じてよいかの返事）。
 *
 * 判断の実体は windows/closeGuard.ts にあり、ここが持つのは
 * 「境界の外から来た返事を、扱ってよい形へ落とす」ことだけ
 * （files / workspace-folder の各ハンドラと同じ立ち位置）。
 *
 * **どのウィンドウからの返事かは Renderer に言わせない。** registry が
 * 送信元のウィンドウを検証して `context.window` として渡すので、
 * 「別のウィンドウの確認に返事をする」経路がそもそも作れない。
 */

const DECISIONS: readonly WindowCloseDecision[] = ['deciding', 'allow', 'cancel']

function toDecision(raw: unknown): WindowCloseDecision | null {
  return typeof raw === 'string' && (DECISIONS as readonly string[]).includes(raw)
    ? (raw as WindowCloseDecision)
    : null
}

export function registerWindowHandlers(): void {
  handleIpc(IPC_CHANNELS.WINDOW_RESPOND_CLOSE, (request, context): void => {
    const { requestId, decision } =
      typeof request === 'object' && request !== null
        ? (request as { requestId?: unknown; decision?: unknown })
        : { requestId: undefined, decision: undefined }

    const resolved = toDecision(decision)

    if (typeof requestId !== 'string' || resolved === null) {
      throw invalidRequest('the close response is not in a usable shape.')
    }

    resolveWindowClose(context.window, requestId, resolved)
  })
}
