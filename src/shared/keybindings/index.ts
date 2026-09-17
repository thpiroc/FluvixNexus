/**
 * `keybindings.json` の保存形式の公開窓口（Shortcuts S3）。
 *
 * shared 層のルールどおり、ここは型と定数だけを持つ。
 */
export {
  KEYBINDING_REMOVAL_PREFIX,
  KEYBINDING_TEXT_MAX_LENGTH,
  KEYBINDINGS_MAX_ENTRIES
} from './keybindingsDocument'

export type { KeybindingsFileStatus, StoredKeybindingEntry } from './keybindingsDocument'
