import type { FilesIpcEventContract } from './events/files'
import type { GitIpcEventContract } from './events/git'
import type { LspIpcEventContract } from './events/lsp'
import type { TerminalIpcEventContract } from './events/terminal'
import type { WindowIpcEventContract } from './events/window'

/**
 * Main → Renderer へ一方的に流れるイベントの全契約。
 *
 * ## 要求 / 応答とは別の契約にする
 *
 * IpcContract（contract.ts）が扱うのは Renderer → Main の「要求と応答」だけで、
 * 対になる相手が必ず居る。イベントは片道で、
 *
 *   - 誰も要求していないのに届く
 *   - 誰も受け取っていないかもしれない
 *   - 1回の出来事が複数の受け手へ同時に届く
 *
 * という性質を持つ。同じ契約に混ぜると `request` が意味を失い、
 * 「応答が来ない invoke」と「送りっぱなしの通知」が型の上で区別できなくなる。
 * 分けておけば、Preload 側も別の橋（invoke / subscribe）として公開でき、
 * Renderer から見て「呼ぶもの」と「聞くもの」が混ざらない。
 *
 * ## これを共通経路にする対象
 *
 * | 用途                   | 使い方                                           |
 * | ---------------------- | ------------------------------------------------ |
 * | Files の変更通知       | `files:changed`（アプリの操作とファイル監視）    |
 * | 閉じてよいかの確認     | `window:close-requested`（contracts/window.ts）  |
 * | Terminal の出力 / 終了 | `terminal:data` / `terminal:exit`（events/terminal.ts） |
 * | Git の状態変化         | `git:changed`（`.git` の監視。events/git.ts）    |
 * | LSP / DAP              | 診断・停止位置などサーバ発の通知                 |
 *
 * `terminal:data` は、この経路で**取りこぼしが許されない**最初のイベントになる
 * （ファイルの変更通知は読み直せば埋まるが、出力は1回きりで順番に意味がある）。
 * 束ねはするが間引かない、という扱いの違いは events/terminal.ts の冒頭。
 *
 * `window:close-requested` だけは**応答を期待する**イベントで、他とは性質が違う。
 * 片道の経路にそれを載せているのは、対になる応答が
 * 「同じウィンドウから、同じ requestId で戻ってくる別の要求」でしかないため
 * （Renderer が利用者に尋ねている間、Main の invoke を待たせ続ける形にしない）。
 *
 * イベントを追加する手順は要求 / 応答と揃える。
 *  1. shared/ipc/events/<domain>.ts に payload と契約を定義する
 *  2. この IpcEventContract の extends に追加する
 *  3. shared/ipc/eventChannels.ts に定数を追加する（漏れると型エラーになる）
 *  4. main/ipc/events.ts の emitIpcEvent で送り、preload/api/<domain>.ts で購読を公開する
 *
 * ## Renderer へ渡してよいもの
 *
 * payload は構造化クローンで安全に渡せる素の値だけで構成すること。
 * Electron の IpcRendererEvent（`sender` を持つ）は **Renderer へ渡さない**。
 * 渡すと contextBridge で切り離したはずの経路が、イベントの引数として復活する。
 * 剥がすのは Preload の責務（preload/ipc/subscribe.ts）。
 */
export interface IpcEventContract
  extends
    FilesIpcEventContract,
    WindowIpcEventContract,
    TerminalIpcEventContract,
    GitIpcEventContract,
    LspIpcEventContract {}

/** 有効な IPC イベントチャンネル名。契約に定義されたものだけが存在しうる。 */
export type IpcEventChannel = keyof IpcEventContract & string

/** 指定チャンネルで流れる値。 */
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C]

/** イベントの受け手。 */
export type IpcEventListener<C extends IpcEventChannel> = (payload: IpcEventPayload<C>) => void

/**
 * 購読の解除。
 *
 * 購読した側が必ず解除できるよう、購読の戻り値そのものにしている
 * （React の useEffect がそのまま返せる形）。チャンネル名と関数を渡し直して
 * 解除する形にすると、無名関数を渡した箇所が解除できなくなる。
 */
export type IpcEventUnsubscribe = () => void
