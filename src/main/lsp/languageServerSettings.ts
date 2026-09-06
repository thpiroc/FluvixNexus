import {
  DEFAULT_LANGUAGE_SERVER_PREFERENCES,
  isLanguageServerEnabled,
  isSameLanguageServerPreferences,
  LANGUAGE_SERVER_IDS,
  normalizeLanguageServerPreferences,
  type LanguageServerId,
  type LanguageServerPreferences
} from '@shared/lsp'
import { createLogger } from '../logger'
import { onSettingsSectionSaved, readSettingsSections } from '../store/settings'

/**
 * Language Server を使うかどうかを、Main が持つ（Session 5-4）。
 *
 * ```
 * Renderer（Settings 画面）
 *    ↓  settings:save-section（section: 'lsp'）
 * main/ipc/handlers/settings.ts   既知の section か・key が読める形か
 *    ↓
 * main/store/settings.ts          保存を予約し、保存されたことを知らせる
 *    ↓
 * ここ                            今の設定として読み直し、変わったことを配る
 *    ↓
 * main/lsp/documentSync.ts        止まった言語のサーバを終わらせ、戻った言語は開き直しを頼む
 * main/lsp/serverStatus.ts        画面に出す状態へ `disabled` を乗せる
 * ```
 *
 * ## Renderer から「起動して / 止めて」とは言えない
 *
 * この Session で増えたのは**設定の保存**だけで、プロセスを操作する口は
 * 1つも増えていない。Renderer が言えるのは
 * 「TypeScript の言語機能は要らない」までで、その結果として何が終わるかを
 * 決めるのは Main になる ── Session 5-1 から引いてきた線
 * （起動のきっかけは開いた文書の言語だけ）はここでも動いていない。
 *
 * したがってこのファイルは `child_process` を知らないし、
 * サーバを終わらせる関数も呼ばない。**持つのは値と、変わったという知らせだけ。**
 * 何をするかは受け手（documentSync.ts）の判断で、
 * `currentWorkspaceFolder.ts` が個別の機能を呼ばないのと同じ形にしてある。
 *
 * ## ディスクを読み返さない
 *
 * 保存は間引かれる（main/store/jsonFile.ts）ので、保存要求のたびに
 * ファイルを読み直すと**押した設定がまだ載っていない**ものを読むことになる。
 * 読むのは起動時の1度だけで、以降は届いた要求の値をそのまま反映する。
 *
 * ## 読めなければ、使う
 *
 * 既定は「全部有効」（shared/lsp/serverSettings.ts）。設定が読めないことは
 * 言語機能を止める理由にならず、Session 5-3 までと同じ振る舞いになる。
 */

const log = createLogger('lsp-settings')

let preferences: LanguageServerPreferences = DEFAULT_LANGUAGE_SERVER_PREFERENCES

/** 設定が変わったことの知らせ。前の値も渡す（何が止まり、何が戻ったかを受け手が数える）。 */
export type LanguageServerPreferencesListener = (
  next: LanguageServerPreferences,
  previous: LanguageServerPreferences
) => void

const listeners = new Set<LanguageServerPreferencesListener>()

/** 設定が変わったときに呼ばれる。戻り値は購読の解除。 */
export function onLanguageServerPreferencesChange(
  listener: LanguageServerPreferencesListener
): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** 今の設定。 */
export function getLanguageServerPreferences(): LanguageServerPreferences {
  return preferences
}

/**
 * その言語のサーバを立ててよいか。
 *
 * 判断そのものは shared の `isLanguageServerEnabled` が持つ（全体と言語の両方）。
 * ここはそこへ今の値を渡すだけで、**同じ判断を書き直さない。**
 */
export function isLanguageServerAllowed(id: LanguageServerId): boolean {
  return isLanguageServerEnabled(preferences, id)
}

/**
 * 保存済みの設定を読み、以降の変更に追従し始める（アプリの起動時に1度だけ）。
 *
 * 形は startLanguageServerHosting / startLanguageServerDocumentSync と揃えてある。
 * **`registerIpcHandlers` の後・ウィンドウを作る前**に呼ぶ ── Renderer が
 * 最初の文書を開くより先に、立ててよい言語が決まっている必要がある。
 */
export function startLanguageServerSettings(): void {
  preferences = normalizeLanguageServerPreferences(readSettingsSections().lsp)

  log.info(`language servers: ${describe(preferences)}`)

  onSettingsSectionSaved((update) => {
    // 他の section の保存。LSP には関係が無い。
    if (update.section !== 'lsp') {
      return
    }

    const next = normalizeLanguageServerPreferences(update.value)

    /*
      同じ値の保存要求は珍しくない（Renderer は値が変わったときに書くが、
      読み込み直後の1回など、同じ値が届く道はある）。そこでサーバを
      止めて立て直すと、**設定画面を開いただけで診断が消える**ことになる。
    */
    if (isSameLanguageServerPreferences(next, preferences)) {
      return
    }

    const previous = preferences

    preferences = next

    log.info(`language servers changed: ${describe(next)}`)

    for (const listener of listeners) {
      try {
        listener(next, previous)
      } catch (cause) {
        // 受け手の失敗で、設定そのものを反映しないという形にはしない。
        log.error('a language server preferences listener failed.', cause)
      }
    }
  })
}

/** ログ1行ぶんの言い回し（`off` / `on: typescript, python`）。 */
function describe(value: LanguageServerPreferences): string {
  if (!value.enabled) {
    return 'off'
  }

  const enabled = LANGUAGE_SERVER_IDS.filter((id) => value.servers[id])

  return enabled.length === 0 ? 'on (no language enabled)' : `on: ${enabled.join(', ')}`
}
