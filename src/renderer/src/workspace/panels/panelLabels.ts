import type { TFunction, TranslationKey } from '../../i18n/messages'
import type { PanelId } from './types'

const PANEL_TITLE_KEYS: Readonly<Record<PanelId, TranslationKey>> = {
  files: 'workspace.panels.files',
  editor: 'workspace.panels.editor',
  terminal: 'workspace.panels.terminal',
  git: 'workspace.panels.git',
  debug: 'workspace.panels.debug',
  agent: 'workspace.panels.agent'
}

export function getPanelTitle(panelId: PanelId, t: TFunction): string {
  return t(PANEL_TITLE_KEYS[panelId])
}
