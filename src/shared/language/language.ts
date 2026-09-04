/** 選べる表示言語。ここに無い名前は Language ではない。 */
export const LANGUAGE_IDS = ['ja', 'en'] as const

export type LanguageId = (typeof LANGUAGE_IDS)[number]

/** 保存が無い / 読めない / 知らない名前だったときの表示言語。 */
export const DEFAULT_LANGUAGE_ID: LanguageId = 'ja'

/** 素の値が既知の Language 名か。 */
export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && (LANGUAGE_IDS as readonly string[]).includes(value)
}

/** 素の値を Language として読む。読めなければ既定（日本語）へ落とす。 */
export function normalizeLanguageId(value: unknown): LanguageId {
  return isLanguageId(value) ? value : DEFAULT_LANGUAGE_ID
}

/** `<html>` に付く属性の名前（`data-fx-language`）。 */
export const LANGUAGE_ATTRIBUTE = 'data-fx-language'

/** Main が Preload へ Language を渡すときの引数。 */
export const LANGUAGE_ARGUMENT_PREFIX = '--fx-initial-language='

/** Main 側で組み立てる（`--fx-initial-language=ja` の形）。 */
export function toLanguageArgument(language: LanguageId): string {
  return `${LANGUAGE_ARGUMENT_PREFIX}${language}`
}

/** Preload 側で読み取る。見つからない / 読めない場合は既定（日本語）。 */
export function fromLanguageArguments(argv: readonly string[]): LanguageId {
  for (const argument of argv) {
    if (argument.startsWith(LANGUAGE_ARGUMENT_PREFIX)) {
      return normalizeLanguageId(argument.slice(LANGUAGE_ARGUMENT_PREFIX.length))
    }
  }

  return DEFAULT_LANGUAGE_ID
}
