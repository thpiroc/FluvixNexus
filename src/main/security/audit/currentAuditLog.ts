import { app } from 'electron'
import { join } from 'path'
import { createLogger } from '../../logger'
import { LOG_DIRECTORY_NAME } from '../../logger/logFile'
import type { AuditEvent } from './auditEvent'
import { createAuditLogWriter, nodeAuditFileSystem, type AuditLogWriter } from './auditLogWriter'

/**
 * 今の Security Audit Log（Security Core v1 の STEP4）。
 *
 * 置き場所は **`app.getPath('userData')/logs/agent-audit.log`** で、ここでだけ決める。
 * **書き先を指定できる引数は無い。** Renderer・Agent・FN Engine から Path を渡せる口を
 * 作らないための形で、テストは1つ下の層（`createAuditLogWriter`）へ一時フォルダを
 * 渡して確かめる。
 *
 * ## Main 側の Security Core だけが記録する
 *
 * `recordAuditEvent` を呼べるのは Main の Security Core だけ。IPC も Preload の API も
 * 作らないため、Renderer / Agent から「この Audit Event を書いて」と頼む経路は無い
 * （auditSurface.test.ts が、そうした IPC / API が増えていないことを見ている）。
 *
 * ## 返り値を持たない
 *
 * 書けたかどうかを返さない。後の STEP が
 * 「Audit に書けなかった → Security を緩める」と書ける形を残さないため
 * （DESIGN.md §6.4）。失敗は通常のログへ1度だけ出る ── その1行も
 * Secret と絶対パスを伏せた後の文字列にあたる（auditLogWriter.ts）。
 */

const log = createLogger('security')

let writer: AuditLogWriter | null = null

/** app.getPath('userData') は app の準備後に確定するため、最初に使う時点で作る。 */
function auditLogWriter(): AuditLogWriter {
  writer ??= createAuditLogWriter({
    resolveDirectory: () => join(app.getPath('userData'), LOG_DIRECTORY_NAME),
    fileSystem: nodeAuditFileSystem,
    onFailure: (failure) => {
      // 続けて失敗している間は黙る（1件ごとに同じ行を出しても、ログの上限を使うだけ）。
      if (failure.consecutiveFailures === 1) {
        log.warn(`failed to write the security audit log. ${failure.summary}`)
      }
    }
  })

  return writer
}

/**
 * Security Event を1件記録する。
 *
 * 呼び出し側は待たない（判定の経路をファイル I/O で止めない）。順番は Writer が
 * 列に並べて守る。
 */
export function recordAuditEvent(event: AuditEvent): void {
  void auditLogWriter().write(event)
}

/** 並んでいる記録が片付くまで待つ（終了処理・実機確認のため）。 */
export function whenAuditLogIdle(): Promise<void> {
  return auditLogWriter().whenIdle()
}
