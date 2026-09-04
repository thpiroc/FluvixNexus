import { fromLanguageArguments, LANGUAGE_ATTRIBUTE, type LanguageId } from '@shared/language'

/** 保存済みの Language を、Renderer が動き出す前に `<html>` へ当てる。 */
export function applyInitialLanguage(
  language: LanguageId = fromLanguageArguments(process.argv)
): void {
  if (applyToRoot(language)) {
    return
  }

  const observer = new MutationObserver(() => {
    if (applyToRoot(language)) {
      observer.disconnect()
    }
  })

  observer.observe(document, { childList: true })
}

function applyToRoot(language: LanguageId): boolean {
  const root = document.documentElement as Element | null

  if (root === null) {
    return false
  }

  root.setAttribute(LANGUAGE_ATTRIBUTE, language)
  root.setAttribute('lang', language)

  return true
}
