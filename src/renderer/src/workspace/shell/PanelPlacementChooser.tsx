import { useEffect, useRef, type JSX } from 'react'
import { useI18n } from '../../i18n/context'
import type { TranslationKey } from '../../i18n/messages'
import type { PanelPlacementChoice } from '../layout/panelSeats'

/**
 * 初めて出すパネルの置き場所を選ぶ画面（Agent パネルのドックパネル化）。
 *
 * 選べるのはドロップと同じ5方向 ── 左 / 右 / 上 / 下 は画面の端に新しい領域として、
 * 中央は Editor の領域へタブとして入る（layout/panelSeats.ts の placePanelAt）。
 * ボタンもドロップの案内（DockGuideOverlay）と同じ十字に並べ、どこに出るかを形で伝える。
 *
 * ここは「選ばれた」ことを伝えるだけで、レイアウトには触れない（Shell が placePanel を呼ぶ）。
 * 取り消した場合は何も起きない（パネルは閉じたまま）。
 */

interface PanelPlacementChooserProps {
  /** 出そうとしているパネルの表示名。 */
  readonly panelTitle: string
  readonly onChoose: (choice: PanelPlacementChoice) => void
  readonly onCancel: () => void
}

const CHOICE_LABEL_KEYS: Readonly<Record<PanelPlacementChoice, TranslationKey>> = {
  top: 'workspace.placement.top',
  left: 'workspace.placement.left',
  center: 'workspace.placement.center',
  right: 'workspace.placement.right',
  bottom: 'workspace.placement.bottom'
}

/** 十字の並び（画面の位置そのまま）。 */
const CHOICE_ORDER: readonly PanelPlacementChoice[] = ['top', 'left', 'center', 'right', 'bottom']

export function PanelPlacementChooser({
  panelTitle,
  onChoose,
  onCancel
}: PanelPlacementChooserProps): JSX.Element {
  const { t } = useI18n()
  const initialRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    initialRef.current?.focus()
  }, [])

  return (
    <div
      className="fx-placement__backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <div
        className="fx-placement"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fx-placement-title"
        data-testid="panel-placement-chooser"
      >
        <h2 className="fx-placement__title" id="fx-placement-title">
          {t('workspace.placement.title', { title: panelTitle })}
        </h2>
        <p className="fx-placement__body">{t('workspace.placement.body')}</p>

        <div className="fx-placement__grid">
          {CHOICE_ORDER.map((choice) => (
            <button
              key={choice}
              type="button"
              ref={choice === 'right' ? initialRef : undefined}
              className="fx-placement__choice"
              data-choice={choice}
              data-testid={`panel-placement-${choice}`}
              onClick={() => onChoose(choice)}
            >
              {t(CHOICE_LABEL_KEYS[choice])}
            </button>
          ))}
        </div>

        <div className="fx-placement__actions">
          <button
            type="button"
            className="fx-placement__cancel"
            data-testid="panel-placement-cancel"
            onClick={onCancel}
          >
            {t('common.actions.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
