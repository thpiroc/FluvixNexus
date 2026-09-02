import { IPC_CHANNELS, type LoadSettingsResponse } from '@shared/ipc'
import { readSettingsSections, saveSettingsSection } from '../../store/settings'
import { parseSettingsSectionUpdate } from '../../store/settingsSections'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * settings ドメインのハンドラ（アプリの設定の永続化。Session 4-3A で2本へ集約）。
 *
 * workspace ドメイン（レイアウトの読み書き）と同じ形で、持つのは2つだけ。
 *   - 保存先を Main 側で決める（Renderer からはパスもファイル名も指定できない）
 *   - 届いた要求が**後で読める形か**を確かめてから書く
 *
 * ## section は Main 側でも必ず確かめる
 *
 * 要求の型（`SettingsSectionUpdate`）は判別可能なユニオンだが、**型は入口に
 * すぎない** ── IPC を渡ってくる値は型を名乗っているだけなので、既知の section か・
 * 値が object か・key が読める形かを `parseSettingsSectionUpdate` で確かめる。
 * 通らない要求は保存に進まない（INVALID_REQUEST）。
 *
 * ここで見るのは**形だけ**で、中身の意味（mode として成立するか・上下限）は見ない。
 * それを知っているのは Renderer だけで、二重に解釈すると
 * 「どちらが正しいか」が生まれる（Session 3-5 からの分担）。
 *
 * ## 読めなくても失敗にしない
 *
 * 保存が無い / 壊れている場合でも、その分だけ空の section を返す。設定が読めない
 * ことはアプリを使えない理由にならず、Renderer は既定（Auto Save は OFF、Files の
 * 表示方式はパネルの形に任せる、Terminal は 13px / 5000 行）で始まる。
 */
export function registerSettingsHandlers(): void {
  handleIpc(IPC_CHANNELS.SETTINGS_LOAD, (): LoadSettingsResponse => {
    return { sections: readSettingsSections() }
  })

  handleIpc(IPC_CHANNELS.SETTINGS_SAVE_SECTION, (request): void => {
    const update = parseSettingsSectionUpdate(request)

    if (update === null) {
      throw invalidRequest('the settings section update is not in a storable shape.')
    }

    saveSettingsSection(update)
  })
}
