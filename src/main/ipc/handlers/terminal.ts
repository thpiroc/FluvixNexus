import {
  IPC_CHANNELS,
  type CreateTerminalSessionResponse,
  type DisposeTerminalSessionRequest,
  type ListBusyTerminalSessionsResponse,
  type ListTerminalShellsResponse,
  type ResizeTerminalRequest,
  type WriteTerminalInputRequest
} from '@shared/ipc'
import {
  isTerminalShellId,
  normalizeTerminalSize,
  TERMINAL_INPUT_MAX_LENGTH,
  type TerminalShellId
} from '@shared/terminal'
import {
  createTerminalSession,
  disposeTerminalSession,
  listAvailableShells,
  listBusyTerminalSessions,
  resizeTerminalSession,
  writeTerminalInput
} from '../../terminal/terminalSessions'
import { IpcError, invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * terminal ドメインのハンドラ（Session 3-7-1 / 3-7-2）。
 *
 * このファイルが持つのは2つだけで、プロセスの話は
 * terminal/terminalSessions.ts に閉じている（workspace-folder ドメインと同じ分担）。
 *   - 境界の外から来た値（大きさ・id・入力・シェルの行）を確かめる
 *   - ドメインの結末を IPC の失敗分類へ翻訳する
 *
 * **実行ファイルのパスも作業ディレクトリも、要求の中に無い。** Session 3-7-2 で
 * 足した `shellId` は表の行を指す閉じた集合の値で、行の中身は Main だけが持つ。
 * それがこのドメインの API 設計の要点にあたる（shared/ipc/contracts/terminal.ts）。
 */
export function registerTerminalHandlers(): void {
  /*
    どのシェルが選べるかは環境で変わる（Node / Claude Code は入っていないことがある）。
    定数として持たせず毎回調べるのは、**アプリを開いたまま環境が変わりうる**ため。
  */
  handleIpc(IPC_CHANNELS.TERMINAL_LIST_SHELLS, (): ListTerminalShellsResponse => {
    return { shells: listAvailableShells() }
  })

  /*
    終わらせる前に「今なにか動いているか」を尋ねられる口（Session 3-7-4）。

    要求に欄が無いのは、**どのセッションについて聞くかを Renderer に言わせない**ため
    （contracts/terminal.ts）。Main は自分が持っている表を見て答える。
    失敗として返る道は無い ── 分からなかった場合は「動いているかもしれないもの」
    として全部が返り、確認を出す側へ倒れる（terminal/terminalSessions.ts）。
  */
  handleIpc(
    IPC_CHANNELS.TERMINAL_LIST_BUSY,
    async (): Promise<ListBusyTerminalSessionsResponse> => {
      return { busySessionIds: await listBusyTerminalSessions() }
    }
  )

  handleIpc(IPC_CHANNELS.TERMINAL_CREATE, (request): CreateTerminalSessionResponse => {
    const shellId = normalizeShellId(request?.shellId)
    const size = normalizeTerminalSize(request?.size)

    /*
      null になるのは「数として読めない」場合だけ。小さすぎる / 大きすぎるは
      丸められて通る（shared/terminal/size.ts）── 大きさは利用者が指した値ではなく
      画面から測った値なので、断ると畳んだだけでターミナルが壊れる。
    */
    if (size === null) {
      throw invalidRequest('the terminal size must be given as numbers.')
    }

    const outcome = createTerminalSession(shellId, size)

    switch (outcome.status) {
      case 'created':
        return { session: outcome.session }

      case 'no-workspace':
        /*
          UI はこの状態で呼ばない（Workspace が無ければパネルは案内だけを出す）。
          それでも断るのは、**UI が迂回されうる**ため。作業ディレクトリの正本が
          無いまま起動する経路を、要求の側から作れないようにしておく。
        */
        throw new IpcError('NOT_FOUND', 'no workspace folder is open.')

      case 'too-many':
        throw new IpcError('CONFLICT', 'too many terminal sessions are already running.')

      case 'shell-unavailable':
        /*
          表にはあるが、この PC には入っていない（Node / Claude Code）。
          UI は起動できるものだけを出しているので、ここへ来るのは
          「一覧を取った後に消えた」か、UI を通っていない要求になる。
        */
        throw new IpcError('UNSUPPORTED', 'the selected shell is not available on this machine.')

      case 'spawn-failed':
        throw new IpcError('INTERNAL', 'failed to start the shell.', outcome.detail)
    }
  })

  handleIpc(IPC_CHANNELS.TERMINAL_WRITE, (request: WriteTerminalInputRequest): void => {
    const sessionId = normalizeSessionId(request?.sessionId)
    const data = request?.data

    if (typeof data !== 'string') {
      throw invalidRequest('the terminal input must be a string.')
    }

    /*
      中身は見ない。制御文字も含めてそのまま流すのが端末の約束で、
      ここで解釈すると端末が端末でなくなる（contracts/terminal.ts）。
      確かめるのは長さだけ ── Renderer から来た文字列を OS のプロセスへ
      そのまま渡す唯一の経路であるため。
    */
    if (data.length > TERMINAL_INPUT_MAX_LENGTH) {
      throw invalidRequest(
        `the terminal input is too long (max ${TERMINAL_INPUT_MAX_LENGTH} characters).`
      )
    }

    if (!writeTerminalInput(sessionId, data)) {
      throw new IpcError('NOT_FOUND', 'the terminal session is no longer running.')
    }
  })

  handleIpc(IPC_CHANNELS.TERMINAL_RESIZE, (request: ResizeTerminalRequest): void => {
    const sessionId = normalizeSessionId(request?.sessionId)
    const size = normalizeTerminalSize(request?.size)

    if (size === null) {
      throw invalidRequest('the terminal size must be given as numbers.')
    }

    if (!resizeTerminalSession(sessionId, size)) {
      throw new IpcError('NOT_FOUND', 'the terminal session is no longer running.')
    }
  })

  handleIpc(IPC_CHANNELS.TERMINAL_DISPOSE, (request: DisposeTerminalSessionRequest): void => {
    /*
      知らない id でも失敗にしない。片付けは何度呼ばれても同じ結果になるべきで、
      「もう無い」は片付けの目的から見れば成功にほかならない
      （削除がごみ箱へ送れなかった場合と違い、ここには利用者へ伝えることが無い）。
    */
    disposeTerminalSession(normalizeSessionId(request?.sessionId))
  })
}

/**
 * シェルの指定として受け取れる形か。
 *
 * 確かめるのは**表にある行かどうか**だけで、実体が在るかはこの後
 * ドメイン側が確かめる（shell-unavailable）。分けてあるのは次の一手が違うため
 * ── 前者は要求そのものが壊れており、後者は環境の話になる。
 */
function normalizeShellId(value: unknown): TerminalShellId {
  if (!isTerminalShellId(value)) {
    throw invalidRequest('the terminal shell id is missing or unknown.')
  }

  return value
}

/**
 * セッション id として受け取れる形か。
 *
 * 発番するのは Main（randomUUID）なので、Renderer から来るのは
 * 「さっき渡したもの」のはず。それでも確かめるのは、素の文字列以外
 * （オブジェクト・undefined）が Map の鍵として通ってしまわないようにするため。
 * 実在するかどうかは表が答える。
 */
function normalizeSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest('the terminal session id is missing.')
  }

  return value
}
