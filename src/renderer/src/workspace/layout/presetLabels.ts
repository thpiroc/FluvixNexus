import type { TFunction, TranslationKey } from '../../i18n/messages'
import type { LayoutPresetId } from './presets'

const LAYOUT_PRESET_TITLE_KEYS: Readonly<Record<LayoutPresetId, TranslationKey>> = {
  default: 'workspace.layout.default.title'
}

const LAYOUT_PRESET_DESCRIPTION_KEYS: Readonly<Record<LayoutPresetId, TranslationKey>> = {
  default: 'workspace.layout.default.description'
}

export function getLayoutPresetTitle(presetId: LayoutPresetId, t: TFunction): string {
  return t(LAYOUT_PRESET_TITLE_KEYS[presetId])
}

export function getLayoutPresetDescription(presetId: LayoutPresetId, t: TFunction): string {
  return t(LAYOUT_PRESET_DESCRIPTION_KEYS[presetId])
}
