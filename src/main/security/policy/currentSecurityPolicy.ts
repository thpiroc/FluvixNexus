import { createLogger } from '../../logger'
import { readUserSettingsSections, readWorkspaceSettingsSnapshot } from '../../store/settings'
import {
  FAIL_CLOSED_SECURITY_POLICY,
  resolveSecurityPolicy,
  type SecurityPolicy
} from './securityPolicy'

/**
 * 今効いている Security Policy（Security Core v1 の STEP1）。
 *
 * ## Main が保存から読んだ値だけを材料にする
 *
 * 引数を取らない。Renderer が持っている設定の写しも、Agent / FN Engine が
 * 持っている値も受け取らず、**Main の store が持つユーザー設定とワークスペース設定**
 * だけから組み立てる。store に入る値は、ディスクから読んだもの（読めない値は
 * `read` に置き換え済み。store/settingsSections.ts）か、Main が検証を通した
 * 保存要求（`read` / `ask` 以外は拒否済み）のどちらかに限られる。
 *
 * ワークスペース設定は、今開いている Workspace の欄（Workspace root の realpath で
 * 引く userData 側の記録）で、**プロジェクトフォルダの中のファイルからは来ない。**
 *
 * ## 毎回読み直す
 *
 * 結果を持ち回さない。Gate は判定のたびにこれを呼ぶ ── 設定を `read` へ変えた直後や
 * Workspace を切り替えた直後に、前の Policy のまま操作が通ることが無いように。
 * store はメモリの写しを返すので、読み直しにディスクは関わらない。
 *
 * ## 読めなければ最も厳しい Policy
 *
 * store が例外を投げた場合（あってはならないが）は `read` の Policy を返す。
 * 失敗を既定（`ask`）に読み替えない。
 *
 * ワークスペース設定のファイルが丸ごと読めない場合は、ワークスペース側の上書きが
 * 無いものとして扱われ、**ユーザー設定がそのまま効く**（ユーザー設定より緩くはならない）。
 */

const log = createLogger('security')

export function getCurrentSecurityPolicy(): SecurityPolicy {
  try {
    const user = readUserSettingsSections().security
    const workspace = readWorkspaceSettingsSnapshot()?.sections.security ?? null

    return resolveSecurityPolicy(user, workspace)
  } catch (cause) {
    log.error('failed to read the security settings; using the read-only policy.', cause)
    return FAIL_CLOSED_SECURITY_POLICY
  }
}
