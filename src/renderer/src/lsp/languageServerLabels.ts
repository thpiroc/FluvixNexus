import type { LanguageServerId, LanguageServerStatusId } from '@shared/lsp'
import type { TranslationKey } from '../i18n/messages'

/**
 * サーバの名前と状態を、翻訳キーにする（React にも DOM にも依存しない。Session 5-4）。
 *
 * ## 言葉そのものは持たない
 *
 * 返すのは翻訳キーだけで、英語も日本語もここには書かない
 * （renderer/src/i18n/locales/）。settingsCatalog.ts が
 * `titleKey` / `descriptionKey` しか持たないのと同じ形にしてあり、
 * **画面を起動せずに「言葉が付いているか」を試せる**ようにするためにほかならない。
 *
 * ## 状態の名前は shared のものをそのまま使う
 *
 * `disabled` / `unavailable` / `starting` / `ready` / `failed` / `stopped` は
 * shared/lsp/serverStatus.ts が決めた6つで、ここで別名を付け直さない
 * ── 付け直すと「Main が言った状態」と「画面に出た状態」の対応が
 * この1ファイルの中にしか無くなる。
 */

/** 表の行の名前（`TypeScript / JavaScript` など）。 */
export function languageServerNameKey(id: LanguageServerId): TranslationKey {
  return `lsp.servers.${id}`
}

/** 状態1つの言い回し（`Ready` / `Not installed` など）。 */
export function languageServerStatusKey(status: LanguageServerStatusId): TranslationKey {
  return `lsp.status.${status}`
}

/** ステータスバーに出す、まとめた状態の言い回し。 */
export function languageServerSummaryKey(status: LanguageServerStatusId): TranslationKey {
  return `lsp.summary.${status}`
}
