/**
 * Files 契約レイヤーの公開窓口。
 *
 * Main / Preload / Renderer はこのモジュール経由でファイルツリーの型と定数を参照する。
 * shared 層のルールどおり、ここに実装は置かない
 * （例外は fileName.ts の名前の規則・copyName.ts のコピー名の規則・
 * search.ts の名前の照合。どれも Main / Renderer が同じ答えを見る必要がある
 * 純粋な文字列の判断で、理由はそれぞれのファイルの冒頭にある）。
 */
export {
  FILES_DIRECTORY_MAX_ENTRIES,
  FILES_RELATIVE_PATH_MAX_LENGTH,
  WORKSPACE_ROOT_RELATIVE_PATH
} from './entry'

export type { FileEntry, FileEntryType } from './entry'

export {
  FILE_ENCODINGS,
  FILES_BINARY_SNIFF_BYTES,
  FILES_FILE_MAX_BYTES,
  isFileEncoding
} from './content'
export type { FileEncoding, FileLineEnding, FileRevision, WorkspaceFileStatus } from './content'

export {
  FILE_NAME_MAX_LENGTH,
  findExistingNameProblem,
  findFileNameProblem,
  normalizeFileName
} from './fileName'
export type { FileNameProblem } from './fileName'

export { COPY_NAME_MAX_ATTEMPTS, copyCandidateName } from './copyName'

export {
  FILE_SEARCH_ID_MAX_LENGTH,
  FILE_SEARCH_MAX_DEPTH,
  FILE_SEARCH_MAX_RESULTS,
  FILE_SEARCH_MAX_SCANNED_ENTRIES,
  FILE_SEARCH_QUERY_MAX_LENGTH,
  FILE_SEARCH_TIME_BUDGET_MS,
  findFileNameMatch,
  matchesFileNameQuery
} from './search'
export type { FileNameMatch, FileSearchLimit, FileSearchStatus } from './search'

export {
  FILE_CONTENT_SEARCH_ELLIPSIS,
  FILE_CONTENT_SEARCH_FILE_MAX_BYTES,
  FILE_CONTENT_SEARCH_MAX_FILES,
  FILE_CONTENT_SEARCH_MAX_MATCHES,
  FILE_CONTENT_SEARCH_MAX_MATCHES_PER_FILE,
  FILE_CONTENT_SEARCH_PREVIEW_LEAD,
  FILE_CONTENT_SEARCH_PREVIEW_MAX_LENGTH,
  FILE_CONTENT_SEARCH_TIME_BUDGET_MS
} from './contentSearch'
export type {
  FileContentMatch,
  FileContentMatchFile,
  FileContentSearchLimit
} from './contentSearch'

export { COPY_LINK_SOURCE_DETAIL, COPY_PARTIAL_DETAIL } from './copy'

export { MOVE_INTO_SELF_DETAIL } from './move'

export {
  isAtOrUnder,
  joinRelativePath,
  parentRelativePath,
  rebaseRelativePath,
  splitRelativePath
} from './relativePath'

export type { WorkspaceFileChange, WorkspaceFileChangeKind } from './change'
