import {
  COPY_LINK_SOURCE_DETAIL,
  COPY_PARTIAL_DETAIL,
  MOVE_INTO_SELF_DETAIL,
  type FileNameProblem
} from '@shared/files'
import type { IpcErrorCode, IpcErrorPayload } from '@shared/ipc'
import type { TFunction, TranslationKey } from '../i18n/messages'
import type { FileTreeErrorReason } from './fileTreeModel'

/**
 * Files での失敗の扱い（分類と文言）。
 *
 * api/result.ts の対応表がアプリ共通の文言を持つのに対し、こちらは Files の文脈での言い換え。
 * 「対象が見つかりませんでした」より「フォルダが見つかりません（削除された可能性があります）」の方が、
 * 何が起きたかと次にどうすればよいかが分かるため。
 * 文言を決めるのが Renderer の責務であることは共通（ARCHITECTURE.md §3.1）。
 */

/* ---------------------------------------------------- 読み込みの失敗 */

/**
 * IPC の失敗分類から、ツリーが区別したい3つへ落とす。
 *
 * 表示側が知りたいのは「消えたのか / 権限が無いのか / それ以外か」だけで、
 * それ以外（INVALID_REQUEST・INTERNAL・通信の失敗）は利用者にとって
 * 「今は読めない」という同じ結論になる。
 *
 * Editor が開いたファイルの失敗（editorTabsModel.ts の EditorDocumentErrorReason）も
 * 同じ3分類にしてあり、この関数を共有する。
 */
export function toFileTreeErrorReason(code: IpcErrorCode): FileTreeErrorReason {
  switch (code) {
    case 'NOT_FOUND':
      return 'not-found'

    case 'PERMISSION_DENIED':
      return 'permission-denied'

    default:
      return 'unavailable'
  }
}

const MESSAGE_KEY_BY_REASON: Readonly<Record<FileTreeErrorReason, TranslationKey>> = {
  'not-found': 'files.error.treeNotFound',
  'permission-denied': 'files.error.treePermissionDenied',
  unavailable: 'files.error.treeUnavailable'
}

export function describeFileTreeError(reason: FileTreeErrorReason, t: TFunction): string {
  return t(MESSAGE_KEY_BY_REASON[reason])
}

/* ---------------------------------------------------------- 検索の失敗 */

/**
 * 検索が失敗したときの文言（Session 3-6-4）。
 *
 * 読み込み（3分類）や書き換え（操作ごと）と分けてあるのは、**同じコードでも
 * 指しているものが違う**ため。検索での NOT_FOUND は「探そうとしたファイル」ではなく
 * **Workspace そのもの**が無いことを意味する（走査の起点が消えている）。
 *
 * 取り消しはここへ来ない。それは失敗ではなく結末の1つで、
 * 文言も fileSearchModel.ts が持つ。
 *
 * **全文検索（Session 3-6-5）も同じ文言を使う。** 失敗の意味がどれも同じだから
 * ── 起点が消えた・読めない・語が使えない、は探す対象が名前でも中身でも変わらない
 * （INVALID_REQUEST には「改行を含む語」が加わるが、利用者にとっては
 * どちらも「その語では検索できない」という同じ結論になる）。
 */
export function describeFileSearchError(error: IpcErrorPayload, t: TFunction): string {
  switch (error.code) {
    case 'NOT_FOUND':
      return t('files.error.searchNotFound')

    case 'PERMISSION_DENIED':
      return t('files.error.searchPermissionDenied')

    case 'INVALID_REQUEST':
      return t('files.error.searchInvalid')

    default:
      return t('files.error.searchUnavailable')
  }
}

/* ------------------------------------------------------ 名前の問題 */

/**
 * 名前が受け付けられない理由の文言。
 *
 * 入力欄の下にその場で出す。**何を直せばよいかが分かる形にする**のが要点で、
 * 「使えない名前です」だけだと、記号なのか長さなのか予約名なのかが分からない。
 */
const MESSAGE_KEY_BY_NAME_PROBLEM: Readonly<Record<FileNameProblem, TranslationKey>> = {
  empty: 'files.error.nameEmpty',
  'too-long': 'files.error.nameTooLong',
  'invalid-characters': 'files.error.nameInvalidCharacters',
  'dot-name': 'files.error.nameDotName',
  'trailing-character': 'files.error.nameTrailingCharacter',
  reserved: 'files.error.nameReserved'
}

export function describeFileNameProblem(problem: FileNameProblem, t: TFunction): string {
  return t(MESSAGE_KEY_BY_NAME_PROBLEM[problem])
}

/* -------------------------------------------------- 書き換えの失敗 */

/** どの操作で失敗したか。同じコードでも操作によって言い方が変わるため区別する。 */
export type FileActionKind = 'create' | 'rename' | 'move' | 'copy' | 'delete'

const ACTION_LABEL_KEY: Readonly<Record<FileActionKind, TranslationKey>> = {
  create: 'files.error.actionCreate',
  rename: 'files.error.actionRename',
  move: 'files.error.actionMove',
  copy: 'files.error.actionCopy',
  delete: 'files.error.actionDelete'
}

/**
 * 権限が無いときの文言。操作ごとに、何に対する権限なのかまで言う。
 *
 * 「削除が許可されていません」で止めると、対象が悪いのか場所が悪いのかが分からない。
 */
const PERMISSION_MESSAGE_KEY: Readonly<Record<FileActionKind, TranslationKey>> = {
  create: 'files.error.permissionCreate',
  rename: 'files.error.permissionRename',
  // 移動は元と先の2箇所を触るため、どちらが断られたかは Main 側でも区別できない。
  // 言い切らずに「この移動は許可されていない」ところで止める。
  move: 'files.error.permissionMove',
  copy: 'files.error.permissionCopy',
  delete: 'files.error.permissionDelete'
}

/**
 * 理由の分からない失敗の文言。
 *
 * 削除だけ言い方を変えているのは、**ここに落ちてくる中身が違う**ため。
 * 削除は Main 側でファイルシステムに訊き直したうえで分からなかったもの
 * （main/files/deleteObstacle.ts）で、残る心当たりは
 * 「ごみ箱を持たない場所」「ネットワークドライブ」「名前の末尾が空白 / ドット」
 * あたりになる。何も心当たりを出さずに突き放すより、
 * **試せることを1つ添える**方が次の一手につながる。
 */
const UNKNOWN_MESSAGE_KEY: Readonly<Record<FileActionKind, TranslationKey>> = {
  create: 'files.error.unknownCreate',
  rename: 'files.error.unknownRename',
  move: 'files.error.unknownMove',
  copy: 'files.error.unknownCopy',
  delete: 'files.error.unknownDelete'
}

/**
 * 作成 / 改名 / 削除の失敗の文言。
 *
 * **利用者の次の一手が違うものは、必ず言い分ける。** ここが分かれていないと、
 * 直せる失敗も「失敗しました」で行き止まりになる。
 *   CONFLICT          … 別の名前にすれば通る
 *   BUSY              … 使っているアプリを閉じれば、同じ操作が通る
 *   PERMISSION_DENIED … 待っても直らない。その対象には手が出せない
 *   NOT_FOUND         … もう無い。やることは残っていない
 *
 * `detail` に名前の問題（FileNameProblem）が入っていれば、そちらを優先する。
 * Main が同じ規則で検査し直した結果であり、UI 側の事前チェックを
 * すり抜けた入力に対しても理由を出せるようにするため。
 * 移動先が自分自身 / その中だった場合の detail（MOVE_INTO_SELF_DETAIL）も同じ扱い。
 *
 * **Main の message / detail はそのまま出さない。** あれは開発者向けで、
 * ごみ箱 API の生の文言（"Failed to parse path" など）は原因とすら対応していない。
 */
export function describeFileActionError(
  action: FileActionKind,
  error: IpcErrorPayload,
  t: TFunction
): string {
  /*
    コピーが途中で止まった場合だけ、分類（権限 / 使用中 / それ以外）より先に見る。
    **原因が何であれ次の一手は同じ**（残ったものを消して、もう一度試す）で、
    そのとき利用者が知っておくべきなのは「作りかけが残っている」ことの方
    （shared/files/copy.ts）。
  */
  if (error.detail === COPY_PARTIAL_DETAIL) {
    return t('files.error.copyPartial')
  }

  if (error.code === 'INVALID_REQUEST') {
    if (isFileNameProblem(error.detail)) {
      return describeFileNameProblem(error.detail, t)
    }

    if (error.detail === MOVE_INTO_SELF_DETAIL) {
      // 理由は移動と同じ（shared/files/move.ts）。言い方だけを操作に合わせる。
      return action === 'copy' ? t('files.error.copyIntoSelf') : t('files.error.moveIntoSelf')
    }

    if (error.detail === COPY_LINK_SOURCE_DETAIL) {
      return t('files.error.copyLinkSource')
    }
  }

  switch (error.code) {
    case 'CONFLICT':
      /*
        コピーは同名でも断らない（名前を変えて作る）ため、ここへ来るのは
        候補を使い切った場合だけ。「同じ名前がある」で止めると、
        名前を変えれば通ることが伝わらない。
      */
      if (action === 'copy') {
        return t('files.error.conflictCopy')
      }

      // 移動は行き先が別のフォルダにあり、そこに何があるかは見えていないことが多い。
      return action === 'move' ? t('files.error.conflictMove') : t('files.error.conflictDefault')

    case 'BUSY':
      return t('files.error.busy', { action: t(ACTION_LABEL_KEY[action]) })

    case 'PERMISSION_DENIED':
      return t(PERMISSION_MESSAGE_KEY[action])

    case 'NOT_FOUND':
      return t('files.error.notFound')

    case 'INVALID_REQUEST':
      return t('files.error.invalidLocation')

    default:
      return t(UNKNOWN_MESSAGE_KEY[action])
  }
}

const NAME_PROBLEMS: ReadonlySet<string> = new Set<FileNameProblem>([
  'empty',
  'too-long',
  'invalid-characters',
  'dot-name',
  'trailing-character',
  'reserved'
])

function isFileNameProblem(value: string | undefined): value is FileNameProblem {
  return value !== undefined && NAME_PROBLEMS.has(value)
}
