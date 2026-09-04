import type { JSX } from 'react'
import { describeIpcError } from '../api/result'
import { useI18n } from '../i18n/context'
import { useWorkspaceFolder } from './context'

/**
 * Workspace が未選択のときの表示。
 *
 * 置き場所は Editor パネルの中（EditorPanel.tsx）だが、内容は Workspace の話でしかないため
 * パネル側ではなくこちらに置く。他のパネルが同じ状態を出したくなっても使い回せる。
 *
 * Session 3-1 の時点では最低限の内容に留める。DESIGN.md が挙げる本来の Welcome
 * （最近開いた一覧、Git からのクローン、ガイド）は、それぞれの機能ができてから足す。
 *
 * ここで前回の Workspace が見つからなかったことを伝えているのは、
 * 黙って未選択で起動すると「前回の状態が消えた」ようにしか見えないため。
 */
export function WorkspaceWelcome(): JSX.Element {
  const { unavailableRootPath, error, busy, openFolder } = useWorkspaceFolder()
  const { t } = useI18n()

  return (
    <div className="fx-welcome">
      <p className="fx-welcome__title">Fluvix Nexus</p>
      <p className="fx-welcome__lead">{t('workspace.welcomeLead')}</p>

      <button type="button" className="fx-welcome__action" onClick={openFolder} disabled={busy}>
        {t('workspace.openFolder')}
      </button>

      {unavailableRootPath !== null && (
        <p className="fx-welcome__note" data-kind="unavailable">
          {t('workspace.unavailablePrevious', { path: unavailableRootPath })}
        </p>
      )}

      {error !== null && (
        <p className="fx-welcome__note" data-kind="error">
          {describeIpcError(error, t)}
        </p>
      )}
    </div>
  )
}
