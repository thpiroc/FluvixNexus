import { app } from 'electron'
import { arch, release, type } from 'os'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  resolveFeedbackDestinationsConfig,
  FEEDBACK_DESTINATIONS_FILE_NAME
} from '../../feedback/feedbackConfig'
import { submitFeedback } from '../../feedback/submitFeedback'
import { createLogger } from '../../logger'
import { readJsonFile } from '../../store/jsonFile'
import { userDataFilePath } from '../../store/jsonStore'
import { handleIpc } from '../registry'

const log = createLogger('feedback')

/**
 * feedback ドメインのハンドラ。
 *
 * ここは Electron / OS から値を集めて渡すだけで、確かめる・組み立てる・送るは
 * main/feedback/ が持つ（Electron 無しでテストできるように）。
 *
 * 設定は**送信のたびに**読む ── 利用者が feedback-destinations.json を書いた後に
 * 起動し直さなくてよい（feedback/feedbackConfig.ts）。
 */
export function registerFeedbackHandlers(): void {
  handleIpc(IPC_CHANNELS.FEEDBACK_SUBMIT, (request) =>
    submitFeedback(request, {
      now: () => new Date(),
      appVersion: app.getVersion(),
      environment: {
        os: type(),
        osRelease: release(),
        arch: arch(),
        electron: process.versions.electron ?? 'unknown'
      },
      readConfig: () =>
        resolveFeedbackDestinationsConfig(
          process.env,
          readJsonFile(userDataFilePath(FEEDBACK_DESTINATIONS_FILE_NAME))
        ),
      onDeliveryFailure: (error) => {
        log.warn(`not saved to ${error.destination} (${error.failure}): ${error.message}`)
      }
    })
  )
}
