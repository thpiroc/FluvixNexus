import { resolveAgentEnabled } from '@shared/security'
import { createLogger } from '../../logger'
import { readUserSettingsSections, readWorkspaceSettingsSnapshot } from '../../store/settings'

/**
 * FN Agent 全体の ON / OFF（Security Core v1 の STEP9）。
 *
 * currentSecurityPolicy.ts と同じく、**Main の store が持つユーザー設定とワークスペース設定
 * だけ**から決める。Renderer・Agent が持つ値は受け取らない。毎回読み直す（Agent Loop は
 * 始める前と、Action を1つ実行する前に呼ぶ）。
 *
 * 読めなければ **OFF**（Agent を動かさない側）に倒す。
 */

const log = createLogger('security')

export function isFnAgentEnabled(): boolean {
  try {
    const user = readUserSettingsSections().security
    const workspace = readWorkspaceSettingsSnapshot()?.sections.security ?? null

    return resolveAgentEnabled(user, workspace)
  } catch (cause) {
    log.error('failed to read the agent setting; treating FN Agent as disabled.', cause)
    return false
  }
}
