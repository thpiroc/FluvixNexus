import {
  COPY_LINK_SOURCE_DETAIL,
  COPY_PARTIAL_DETAIL,
  FILE_SEARCH_ID_MAX_LENGTH,
  MOVE_INTO_SELF_DETAIL,
  type FileNameProblem,
  type WorkspaceFileChange
} from '@shared/files'
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type CancelWorkspaceFileSearchResponse,
  type CopyWorkspaceEntryResponse,
  type CreateWorkspaceEntryResponse,
  type DeleteWorkspaceEntryResponse,
  type MoveWorkspaceEntryResponse,
  type ReadWorkspaceDirectoryResponse,
  type ReadWorkspaceFileResponse,
  type RenameWorkspaceEntryResponse,
  type SearchWorkspaceFileContentsResponse,
  type SearchWorkspaceFilesResponse,
  type WriteWorkspaceFileResponse
} from '@shared/ipc'
import type { WorkspaceFolder } from '@shared/workspace'
import {
  copyWorkspaceEntry,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  type WorkspaceMutationFailure
} from '../../files/mutateWorkspaceEntry'
import { readWorkspaceDirectory } from '../../files/readWorkspaceDirectory'
import { readWorkspaceFile } from '../../files/readWorkspaceFile'
import { searchWorkspaceFileContents } from '../../files/searchWorkspaceFileContents'
import { searchWorkspaceFiles } from '../../files/searchWorkspaceFiles'
import {
  beginWorkspaceSearch,
  cancelWorkspaceSearch,
  cancelWorkspaceSearches
} from '../../files/workspaceSearchSession'
import { noteAppFileChange } from '../../files/workspaceWatcher'
import { writeWorkspaceFile } from '../../files/writeWorkspaceFile'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../../workspaceFolder/currentWorkspaceFolder'
import { IpcError, invalidRequest } from '../errors'
import { emitIpcEvent } from '../events'
import { handleIpc } from '../registry'

/**
 * files ドメインのハンドラ（Workspace の中のファイル / フォルダ）。
 *
 * このファイルが持つのは次の3つだけ。
 *   - **基点を Main 側で決める**（現在の Workspace。Renderer からは渡させない）
 *   - ドメインの結末を IPC の失敗分類へ翻訳する
 *   - 変化を Renderer へ通知する（Main → Renderer のイベント）
 *
 * 実際の処理は files/ にある。
 *   読む（列挙）    … files/readWorkspaceDirectory.ts
 *   読む（1ファイル）… files/readWorkspaceFile.ts
 *   保存（1ファイル）… files/writeWorkspaceFile.ts
 *   書き換える      … files/mutateWorkspaceEntry.ts
 *   パスの判断      … files/workspacePath.ts
 *
 * **root は要求に含まれない。** Renderer が言えるのは「Workspace の中のこの相対位置」までで、
 * それが実際にどこを指すかは現在の Workspace が決める。Workspace の切り替え自体も
 * Renderer からパスを渡せない（ARCHITECTURE.md §8.4）ため、
 * この2つが揃って「Renderer からは Workspace の外に手が届かない」が成立する。
 * これは読む側だけの話ではなく、作成 / 改名 / 削除にも同じだけ効かせている。
 *
 * ## 変化は応答ではなくイベントで配る
 *
 * 応答が持つのは「その操作の結果そのもの」だけで、ツリーを返し直さない。
 * 何が変わったかは `files:changed` として送り、
 * Files（変わったフォルダを読み直す）と Editor（タブを追従させる）が
 * それぞれ受け取る。詳しくは shared/files/change.ts。
 */

/** 現在の Workspace。無ければ IPC の失敗にする。 */
function requireWorkspace(): WorkspaceFolder {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    /*
      Renderer 側は Workspace が無ければツリー自体を出さないため、通常は起きない。
      起きるのは要求と Workspace を閉じる操作が前後した場合で、次の状態が
      すぐ届く（＝再試行で解決する）ため、失敗として素直に返す。
    */
    throw new IpcError('NOT_FOUND', 'no workspace folder is open.')
  }

  return workspace
}

/** 契約上は必ず入っているが、境界の外から来た値として素直に信じない。 */
function field(request: unknown, key: string): unknown {
  return typeof request === 'object' && request !== null
    ? (request as Record<string, unknown>)[key]
    : undefined
}

/**
 * 検索の識別子（Renderer が作る）。
 *
 * 使うのは「今走っている検索と同じものか」の比較だけで、パスにもファイル名にもならない。
 * それでも長さを見るのは、境界の外から来た文字列を無条件に控えないため。
 */
function searchIdField(request: unknown): string {
  const value = field(request, 'searchId')

  if (typeof value !== 'string' || value === '' || value.length > FILE_SEARCH_ID_MAX_LENGTH) {
    throw invalidRequest('the search id is missing or not usable.')
  }

  return value
}

/** 名前が受け付けられない理由を、開発者向けの文言へ。UI 文言は Renderer 側が決める。 */
function describeNameProblem(problem: FileNameProblem): string {
  return `the requested name is not usable (${problem}).`
}

/**
 * 書き換え操作の失敗を IPC の失敗分類へ翻訳する。
 *
 * 作成・改名・移動・コピー・削除で同じ結末の集合を使っているため、翻訳も1箇所で済む
 * （操作ごとに書き分けると、同じ失敗が操作によって別のコードで返る）。
 * 1つの操作にしか起きない結末（invalid-destination・link-source）もここに置く
 * ── 出どころが1つでも、**翻訳の表が2つに割れない**ことの方が大事。
 */
function toIpcError(failure: WorkspaceMutationFailure): IpcError {
  switch (failure.status) {
    case 'invalid-path':
      return invalidRequest('the requested path is not a valid workspace-relative path.')

    case 'invalid-name':
      return invalidRequest(describeNameProblem(failure.problem), failure.problem)

    /*
      パスの形は正しいので INVALID_REQUEST に留めつつ、理由を detail で伝える
      （名前の問題を FileNameProblem として載せているのと同じ形）。
      detail の文字列は契約の一部で、shared に置いてある（shared/files/move.ts）。
    */
    case 'invalid-destination':
      return invalidRequest(
        'the destination is the entry itself, or inside it.',
        MOVE_INTO_SELF_DETAIL
      )

    /*
      コピーだけに起きる。リンクを辿ると Workspace の外の実体の中身を
      中へ持ち込めるため、指し先を複製しない（shared/files/copy.ts）。
    */
    case 'link-source':
      return invalidRequest(
        'the copied entry is a symbolic link or junction.',
        COPY_LINK_SOURCE_DETAIL
      )

    case 'outside-workspace':
      // 「見つからない」ではなく拒否として返す。Workspace の外は、
      // 存在するかどうかを含めて Renderer に答えない。
      return new IpcError('PERMISSION_DENIED', 'the requested path escapes the workspace.')

    case 'not-found':
      return new IpcError('NOT_FOUND', 'the target no longer exists.')

    case 'already-exists':
      return new IpcError('CONFLICT', 'something with that name already exists.')

    case 'permission-denied':
      return new IpcError('PERMISSION_DENIED', 'the operation was refused by the file system.')

    case 'busy':
      // 同じ要求をやり直せば通りうる失敗。detail には何が邪魔をしていたかが入る。
      return new IpcError('BUSY', 'the target is in use by another process.', failure.detail)

    case 'failed':
      return new IpcError('INTERNAL', 'the file operation failed.', failure.detail)
  }
}

/** 変化1件が起きた位置（改名は元と先の両方）。 */
function changedPaths(change: WorkspaceFileChange): readonly string[] {
  return change.kind === 'renamed'
    ? [change.fromRelativePath, change.toRelativePath]
    : [change.relativePath]
}

/**
 * 変化を全ウィンドウへ通知する。
 *
 * 同じ変化はファイル監視（files/workspaceWatcher.ts）にも届く。そのまま両方が流れると
 * **1回の操作で `files:changed` が2回配られ、Files パネルが同じフォルダを2度読み直す**
 * （Session 3-3 の「読み直すのは親フォルダ1つだけ」が崩れる）。
 * 自分が触った位置を監視側へ申告し、短い間だけ黙らせる。
 */
function notifyChanged(workspaceId: string, changes: readonly WorkspaceFileChange[]): void {
  noteAppFileChange(changes.flatMap(changedPaths))

  emitIpcEvent(IPC_EVENT_CHANNELS.FILES_CHANGED, { workspaceId, source: 'app', changes })
}

export function registerFilesHandlers(): void {
  /*
    Workspace が切り替わったら、進行中の検索を捨てる（Session 3-6-4）。

    **購読をここに置いている**のは、`files/` の側に Workspace の正本を知る層を
    増やさないため。監視（workspaceWatcher.ts）が自分で購読しているのと分けてあるのは、
    あちらが「開いている限り張り続けるもの」で、こちらが「要求のたびに始まって
    すぐ終わるもの」だから ── 検索側が知る必要があるのは
    「もう要らなくなった」という一点だけになる。
  */
  onWorkspaceFolderChange(() => {
    cancelWorkspaceSearches()
  })

  /* ------------------------------------------------------------ 列挙 */

  handleIpc(
    IPC_CHANNELS.FILES_READ_DIRECTORY,
    async (request): Promise<ReadWorkspaceDirectoryResponse> => {
      const workspace = requireWorkspace()
      const outcome = await readWorkspaceDirectory(
        workspace.rootPath,
        field(request, 'relativePath')
      )

      switch (outcome.status) {
        case 'ok':
          return {
            workspaceId: workspace.id,
            relativePath: outcome.relativePath,
            entries: outcome.entries,
            truncated: outcome.truncated
          }

        case 'invalid-path':
          throw invalidRequest('the requested path is not a valid workspace-relative path.')

        case 'outside-workspace':
          throw new IpcError('PERMISSION_DENIED', 'the requested path escapes the workspace.')

        case 'not-found':
          throw new IpcError('NOT_FOUND', 'the requested folder no longer exists.')

        case 'not-a-directory':
          throw invalidRequest('the requested path is not a folder.')

        case 'permission-denied':
          throw new IpcError('PERMISSION_DENIED', 'the requested folder cannot be read.')

        case 'failed':
          throw new IpcError('INTERNAL', 'failed to read the folder.', outcome.detail)
      }
    }
  )

  /* ------------------------------------------------ ファイルを開く */

  handleIpc(IPC_CHANNELS.FILES_READ_FILE, async (request): Promise<ReadWorkspaceFileResponse> => {
    const workspace = requireWorkspace()
    const outcome = await readWorkspaceFile(workspace.rootPath, field(request, 'relativePath'))

    switch (outcome.status) {
      case 'ok':
        return {
          workspaceId: workspace.id,
          relativePath: outcome.relativePath,
          name: outcome.name,
          // バイナリ・大きすぎるは失敗ではなく status（shared/files/content.ts）。
          status: outcome.fileStatus,
          byteLength: outcome.byteLength,
          content: outcome.content,
          lineEnding: outcome.lineEnding,
          encoding: outcome.encoding,
          revision: outcome.revision
        }

      case 'invalid-path':
        throw invalidRequest('the requested path is not a valid workspace-relative path.')

      case 'outside-workspace':
        throw new IpcError('PERMISSION_DENIED', 'the requested path escapes the workspace.')

      case 'not-found':
        throw new IpcError('NOT_FOUND', 'the requested file no longer exists.')

      case 'not-a-file':
        throw invalidRequest('the requested path is not a file.')

      case 'permission-denied':
        throw new IpcError('PERMISSION_DENIED', 'the requested file cannot be read.')

      case 'failed':
        throw new IpcError('INTERNAL', 'failed to read the file.', outcome.detail)
    }
  })

  /* ------------------------------------------------------ 保存（上書き） */

  /*
    変化を `files:changed` として送っていないのは、保存がツリーの形を変えないため。
    Files パネルが持っているのは「どこに何があるか」であって中身ではない
    （ARCHITECTURE.md §9.2）。ここで通知すると、保存のたびに
    親フォルダを読み直すことになり、Lazy Load の意味が薄れる。

    アプリの外での変更（files/workspaceWatcher.ts）は 'modified' として同じ経路に
    載るが、**自分の保存はそこにも流さない。** 監視は自分の書き込みと外部の書き込みを
    区別できないため、書けた位置を申告して短い間だけ黙らせる
    （黙らせなくても Renderer は版を突き合わせて捨てるが、
    「自分の保存が外部変更として一周して戻る」経路を残さない）。
  */
  handleIpc(IPC_CHANNELS.FILES_WRITE_FILE, async (request): Promise<WriteWorkspaceFileResponse> => {
    const workspace = requireWorkspace()
    const outcome = await writeWorkspaceFile(
      workspace.rootPath,
      field(request, 'relativePath'),
      field(request, 'content'),
      field(request, 'baseRevision'),
      field(request, 'encoding')
    )

    switch (outcome.status) {
      case 'ok':
        noteAppFileChange([outcome.relativePath])

        return {
          workspaceId: workspace.id,
          relativePath: outcome.relativePath,
          status: 'written',
          revision: outcome.revision
        }

      case 'stale':
        // 失敗ではない。上書きするか読み直すかを決めるのは Renderer 側。
        return {
          workspaceId: workspace.id,
          relativePath: outcome.relativePath,
          status: 'stale',
          revision: outcome.revision
        }

      case 'invalid-path':
        throw invalidRequest('the requested path is not a valid workspace-relative path.')

      case 'invalid-content':
        throw invalidRequest('the requested content is not writable text.')

      case 'outside-workspace':
        throw new IpcError('PERMISSION_DENIED', 'the requested path escapes the workspace.')

      case 'not-found':
        throw new IpcError('NOT_FOUND', 'the requested file no longer exists.')

      case 'not-a-file':
        throw invalidRequest('the requested path is not a file.')

      case 'permission-denied':
        throw new IpcError('PERMISSION_DENIED', 'the requested file cannot be written.')

      case 'failed':
        throw new IpcError('INTERNAL', 'failed to write the file.', outcome.detail)
    }
  })

  /* ------------------------------------------------------------ 作成 */

  handleIpc(IPC_CHANNELS.FILES_CREATE, async (request): Promise<CreateWorkspaceEntryResponse> => {
    const workspace = requireWorkspace()
    const outcome = await createWorkspaceEntry(
      workspace.rootPath,
      field(request, 'parentRelativePath'),
      field(request, 'name'),
      field(request, 'type')
    )

    if (outcome.status !== 'ok') {
      throw toIpcError(outcome)
    }

    notifyChanged(workspace.id, [
      {
        kind: 'created',
        relativePath: outcome.entry.relativePath,
        entryType: outcome.entry.type
      }
    ])

    return { workspaceId: workspace.id, entry: outcome.entry }
  })

  /* -------------------------------------------------------- リネーム */

  handleIpc(IPC_CHANNELS.FILES_RENAME, async (request): Promise<RenameWorkspaceEntryResponse> => {
    const workspace = requireWorkspace()
    const outcome = await renameWorkspaceEntry(
      workspace.rootPath,
      field(request, 'relativePath'),
      field(request, 'name')
    )

    if (outcome.status !== 'ok') {
      throw toIpcError(outcome)
    }

    notifyChanged(workspace.id, [
      {
        kind: 'renamed',
        fromRelativePath: outcome.fromRelativePath,
        toRelativePath: outcome.entry.relativePath,
        entryType: outcome.entry.type
      }
    ])

    return {
      workspaceId: workspace.id,
      entry: outcome.entry,
      fromRelativePath: outcome.fromRelativePath
    }
  })

  /* ------------------------------------------------------------ 移動 */

  /*
    変化は改名と同じ `renamed` として配る（shared/files/change.ts）。
    受け手から見れば「位置が変わった」だけで、名前が変わったのか場所が変わったのかで
    することは違わない ── Files は変わったフォルダを読み直し、Editor はタブの位置を
    付け替える。移動では元と先が別のフォルダになるため、
    読み直しは2つになる（renderer/src/files/fileChanges.ts）。

    同じフォルダの中への移動（何もしていない）は通知しない。位置が変わっていないのに
    `renamed` を流すと、受け手が意味の無い読み直しを行う。
  */
  handleIpc(IPC_CHANNELS.FILES_MOVE, async (request): Promise<MoveWorkspaceEntryResponse> => {
    const workspace = requireWorkspace()
    const outcome = await moveWorkspaceEntry(
      workspace.rootPath,
      field(request, 'relativePath'),
      field(request, 'toParentRelativePath')
    )

    if (outcome.status !== 'ok') {
      throw toIpcError(outcome)
    }

    if (outcome.entry.relativePath !== outcome.fromRelativePath) {
      notifyChanged(workspace.id, [
        {
          kind: 'renamed',
          fromRelativePath: outcome.fromRelativePath,
          toRelativePath: outcome.entry.relativePath,
          entryType: outcome.entry.type
        }
      ])
    }

    return {
      workspaceId: workspace.id,
      entry: outcome.entry,
      fromRelativePath: outcome.fromRelativePath
    }
  })

  /* ------------------------------------------------------------ コピー */

  /*
    変化は作成と同じ `created` 1件（コピー先に1つ現れた、というだけ）。
    元は動いていないので `renamed` にはならず、Files はコピー先の親を読み直す。

    **フォルダの中身までは配らない。** 中は展開されていなければ読まれておらず、
    展開されていれば「読み直す ＝ 忘れる」だけで既存の読み込み経路が拾う
    （Session 3-2 の Lazy Load。renderer/src/files/fileChanges.ts）。
    再帰コピーのために別の通知経路を作らないのはこのため。

    途中で失敗した場合（partial）も、**作られたものは必ず配ってから**失敗を返す。
    作りかけを消しに行かない以上それはディスクに在るもので、
    配らないと「失敗したのに、次に開いたら何か増えている」になる。
  */
  handleIpc(IPC_CHANNELS.FILES_COPY, async (request): Promise<CopyWorkspaceEntryResponse> => {
    const workspace = requireWorkspace()
    const outcome = await copyWorkspaceEntry(
      workspace.rootPath,
      field(request, 'relativePath'),
      field(request, 'toParentRelativePath')
    )

    if (outcome.status !== 'ok' && outcome.status !== 'partial') {
      throw toIpcError(outcome)
    }

    notifyChanged(workspace.id, [
      {
        kind: 'created',
        relativePath: outcome.entry.relativePath,
        entryType: outcome.entry.type
      }
    ])

    if (outcome.status === 'partial') {
      /*
        分類（権限 / 使用中 / それ以外）はそのまま活かしつつ、detail で
        「作りかけが残っている」ことを伝える。原因が何であれ利用者の次の一手は
        同じ（残ったものを消して、もう一度試す）なので、文言は1つにまとめられる
        ── その判断をするのは Renderer 側（shared/files/copy.ts）。
      */
      const failure = toIpcError(outcome.failure)

      throw new IpcError(
        failure.code,
        `the copy stopped partway (${failure.message})`,
        COPY_PARTIAL_DETAIL
      )
    }

    return {
      workspaceId: workspace.id,
      entry: outcome.entry,
      skippedCount: outcome.skippedCount
    }
  })

  /* ------------------------------------------------------------ 削除 */

  handleIpc(IPC_CHANNELS.FILES_DELETE, async (request): Promise<DeleteWorkspaceEntryResponse> => {
    const workspace = requireWorkspace()
    const outcome = await deleteWorkspaceEntry(workspace.rootPath, field(request, 'relativePath'))

    if (outcome.status !== 'ok') {
      throw toIpcError(outcome)
    }

    notifyChanged(workspace.id, [
      {
        kind: 'deleted',
        relativePath: outcome.relativePath,
        entryType: outcome.entryType
      }
    ])

    return {
      workspaceId: workspace.id,
      relativePath: outcome.relativePath,
      entryType: outcome.entryType,
      // 完全削除の経路を持たないことを、応答の形として残しておく。
      method: 'recycle-bin'
    }
  })

  /* ------------------------------------------------ 検索（ファイル名） */

  /*
    走査は files/searchWorkspaceFiles.ts、止める判断は
    files/workspaceSearchSession.ts が持つ。ここが行うのは他のチャンネルと同じ3つだけ
    ── 基点を決める / 結末を IPC の失敗分類へ翻訳する / 変化を配る（検索には無い）。

    **変化を1件も配らない**のは、検索が何も書き換えないため。結果はその時点の
    写しでしかなく、返した後にディスクが変われば結果は古くなる ── その追従を
    始めると「検索結果を最新に保つ」という別の仕組みになるので、ここでは持たない
    （利用者はもう一度探せる）。

    取り消しは失敗にしない。`'cancelled'` は**要求が成立していないのではなく、
    途中で止めた**という結末で、そこまでに見つけたものも一緒に返る
    （保存の 'stale' と同じ扱い）。
  */
  handleIpc(IPC_CHANNELS.FILES_SEARCH, async (request): Promise<SearchWorkspaceFilesResponse> => {
    const workspace = requireWorkspace()
    const searchId = searchIdField(request)
    const rawQuery = field(request, 'query')

    /*
      始める時点で古い検索は止まる（workspaceSearchSession.ts）。
      走っているのは常に1本だけになる。
    */
    const search = beginWorkspaceSearch(workspace.id, searchId)

    let outcome
    try {
      outcome = await searchWorkspaceFiles(workspace.rootPath, rawQuery, {
        cancellation: search.cancellation
      })
    } finally {
      search.finish()
    }

    switch (outcome.status) {
      case 'ok':
        return {
          workspaceId: workspace.id,
          searchId,
          // 応答にも載せる。届いた時点で入力欄が変わっていても、結果と語がずれない。
          query: typeof rawQuery === 'string' ? rawQuery : '',
          status: outcome.completion,
          matches: outcome.matches,
          truncated: outcome.truncated,
          limit: outcome.limit,
          scannedCount: outcome.scannedCount
        }

      case 'invalid-query':
        throw invalidRequest('the search query is empty or too long.')

      case 'not-found':
        throw new IpcError('NOT_FOUND', 'the workspace folder no longer exists.')

      case 'permission-denied':
        throw new IpcError('PERMISSION_DENIED', 'the workspace folder cannot be read.')

      case 'failed':
        throw new IpcError('INTERNAL', 'the search failed.', outcome.detail)
    }
  })

  /* ------------------------------------------------ 検索（ファイル本文） */

  /*
    全文検索（Session 3-6-5）。ここが行うことは名前の検索とまったく同じ3つで、
    走査だけが files/searchWorkspaceFileContents.ts に替わる。

    **同じ検索の管理（workspaceSearchSession.ts）を通す**のが要点。
    名前の検索と全文検索は別のチャンネルだが、走ってよいのは合わせて1本だけで、
    始めた時点で古い方 ── モードが違っても ── 必ず止まる。
    ここを分けると「名前の検索と全文検索が同時にディスクを舐める」状態が作れてしまい、
    上限が実質2本ぶんに緩む。

    取り消しの経路（`files:cancel-search`）も共有する。識別子の作り方が同じで、
    走っているのが1本である以上、どちらを止めるかを区別する必要が無い。
  */
  handleIpc(
    IPC_CHANNELS.FILES_SEARCH_CONTENT,
    async (request): Promise<SearchWorkspaceFileContentsResponse> => {
      const workspace = requireWorkspace()
      const searchId = searchIdField(request)
      const rawQuery = field(request, 'query')

      const search = beginWorkspaceSearch(workspace.id, searchId)

      let outcome
      try {
        outcome = await searchWorkspaceFileContents(workspace.rootPath, rawQuery, {
          cancellation: search.cancellation
        })
      } finally {
        search.finish()
      }

      switch (outcome.status) {
        case 'ok':
          return {
            workspaceId: workspace.id,
            searchId,
            query: typeof rawQuery === 'string' ? rawQuery : '',
            status: outcome.completion,
            files: outcome.files,
            matchCount: outcome.matchCount,
            searchedFileCount: outcome.searchedFileCount,
            scannedCount: outcome.scannedCount,
            truncated: outcome.truncated,
            limit: outcome.limit
          }

        /*
          空・長すぎる・改行を含む。改行を含む語をここで断っているのは、
          照合が1行ずつである以上、受け付けても常に0件になるため
          （files/searchWorkspaceFileContents.ts）。
        */
        case 'invalid-query':
          throw invalidRequest('the search query is empty, too long, or spans lines.')

        case 'not-found':
          throw new IpcError('NOT_FOUND', 'the workspace folder no longer exists.')

        case 'permission-denied':
          throw new IpcError('PERMISSION_DENIED', 'the workspace folder cannot be read.')

        case 'failed':
          throw new IpcError('INTERNAL', 'the search failed.', outcome.detail)
      }
    }
  )

  /*
    利用者が止める経路。走っていなければ何も起きない（失敗にはしない）。
    名前の検索・全文検索のどちらも、走っている1本をこの経路で止める。

    **識別子を必ず突き合わせる。** 「今の検索を止める」にすると、
    止めるボタンと次の入力が前後したときに、始まったばかりの検索が消える。
  */
  handleIpc(
    IPC_CHANNELS.FILES_CANCEL_SEARCH,
    async (request): Promise<CancelWorkspaceFileSearchResponse> => {
      // Workspace が無ければ走っている検索も無い（切り替えの時点で捨てている）。
      requireWorkspace()

      return { cancelled: cancelWorkspaceSearch(searchIdField(request)) }
    }
  )
}
