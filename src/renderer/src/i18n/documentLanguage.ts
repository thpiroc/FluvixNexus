import { LANGUAGE_ATTRIBUTE, normalizeLanguageId, type LanguageId } from '@shared/language'

/** `<html>` に今の Language を当てる。 */
export function applyDocumentLanguage(
  language: LanguageId,
  root: Element = document.documentElement
): void {
  const next = normalizeLanguageId(language)

  if (root.getAttribute(LANGUAGE_ATTRIBUTE) !== next) {
    root.setAttribute(LANGUAGE_ATTRIBUTE, next)
  }

  if (root.getAttribute('lang') !== next) {
    root.setAttribute('lang', next)
  }
}

/** 今 `<html>` に当たっている Language（読めなければ既定）。 */
export function readDocumentLanguage(root: Element = document.documentElement): LanguageId {
  return normalizeLanguageId(root.getAttribute(LANGUAGE_ATTRIBUTE))
}
