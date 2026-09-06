import type {
  LspCompletionItem,
  LspCompletionItemKind,
  LspCompletionList,
  LspCompletionTextEdit,
  TextDocumentRange
} from '@shared/lsp'

export interface EditorCompletionRange {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
}

export interface EditorCompletionItem {
  readonly label: string
  readonly kind: LspCompletionItemKind | null
  readonly detail: string | null
  readonly documentation: string | null
  readonly sortText: string | null
  readonly filterText: string | null
  readonly insertText: string
  readonly textEditRange:
    | EditorCompletionRange
    | {
        readonly insert: EditorCompletionRange
        readonly replace: EditorCompletionRange
      }
    | null
  readonly insertTextFormat: 'plainText' | 'snippet'
  readonly commitCharacters: readonly string[]
  readonly preselect: boolean
}

export interface EditorCompletionList {
  readonly incomplete: boolean
  readonly items: readonly EditorCompletionItem[]
}

export function toEditorCompletionList(completion: LspCompletionList): EditorCompletionList {
  return {
    incomplete: completion.isIncomplete,
    items: completion.items.map(toEditorCompletionItem)
  }
}

function toEditorCompletionItem(item: LspCompletionItem): EditorCompletionItem {
  return {
    label: item.label,
    kind: item.kind,
    detail: item.detail,
    documentation: item.documentation,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
    textEditRange: item.textEdit === null ? null : toEditorCompletionTextEditRange(item.textEdit),
    insertTextFormat: item.insertTextFormat,
    commitCharacters: item.commitCharacters,
    preselect: item.preselect
  }
}

function toEditorCompletionTextEditRange(
  textEdit: LspCompletionTextEdit
): EditorCompletionItem['textEditRange'] {
  if ('insert' in textEdit.range) {
    return {
      insert: toEditorRange(textEdit.range.insert),
      replace: toEditorRange(textEdit.range.replace)
    }
  }

  return toEditorRange(textEdit.range)
}

function toEditorRange(range: TextDocumentRange): EditorCompletionRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}
