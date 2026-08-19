import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isIpcEventChannel,
  type IpcEventChannel,
  type IpcEventListener,
  type IpcEventPayload,
  type IpcEventUnsubscribe
} from '@shared/ipc'

/**
 * Preload が Main からのイベントを受け取る唯一の経路。
 *
 * invoke.ts が要求と応答に対して果たしている役どころの、イベント側の相手。
 * ipcRenderer をそのまま Renderer へ渡すと任意チャンネルを購読できてしまうため、
 * contextBridge で公開するのはこの subscribe を包んだドメイン API だけにする。
 *
 * ## Renderer へ event オブジェクトを渡さない
 *
 * `ipcRenderer.on` の第1引数は IpcRendererEvent で、`sender`（＝ipcRenderer 相当）と
 * `ports` を持つ。これをそのまま listener へ流すと、**contextBridge で切り離したはずの
 * 経路がイベントの引数として復活する。** contextIsolation により関数越しの受け渡しでは
 * プロキシに包まれるが、そもそも渡さないのが筋なのでここで剥がす。
 * Renderer が受け取るのは契約に定義した payload だけになる。
 *
 * ## チャンネルは契約にあるものだけ
 *
 * Renderer から届いた文字列をそのまま `ipcRenderer.on` へ渡さない。
 * 契約外のチャンネルを購読できると、Main が内部で使う任意のチャンネルを
 * Renderer から盗み聞きできてしまう。invoke 側で契約外のチャンネルを
 * 呼べないのと同じ線をこちらにも引く。
 *
 * ## 解除できること
 *
 * 戻り値が解除の関数そのものになっている。React の useEffect が返せる形であることに
 * 加えて、**購読した側が必ず解除の手段を持つ**のが要点。チャンネル名と関数を
 * 渡し直して解除する形にすると、無名関数で購読した箇所が解除できず、
 * 画面の一部を作り直すたびに listener が積み上がる。
 */
export function subscribeIpcEvent<C extends IpcEventChannel>(
  channel: C,
  listener: IpcEventListener<C>
): IpcEventUnsubscribe {
  if (!isIpcEventChannel(channel)) {
    // 契約に無いチャンネル。購読しないが、呼び出し側が解除できる形は保つ。
    return () => {}
  }

  const forward = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as IpcEventPayload<C>)
  }

  ipcRenderer.on(channel, forward)

  return () => {
    ipcRenderer.removeListener(channel, forward)
  }
}
