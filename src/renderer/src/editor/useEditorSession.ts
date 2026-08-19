import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEncoding, FileLineEnding, FileRevision } from '@shared/files'
import { fluvix } from '../api/fluvix'
import { describeIpcError } from '../api/result'
import {
  DEFAULT_AUTO_SAVE_SETTINGS,
  isSameAutoSaveSettings,
  normalizeAutoSaveSettings,
  toAutoSaveSettings,
  toEditorSettingsDocument,
  type AutoSaveMode,
  type AutoSaveSettings
} from './autoSave'
import type { EditorRevealRequest } from './editorReveal'
import { hasUnsavedChanges } from './editorTabState'
import type { EditorTab } from './editorTabsModel'
import { EditorDocumentStore } from './monaco/documentStore'
import { useEditorTabs } from './useEditorTabs'

/**
 * Editor の1セッション分（開いているタブ・その中身・保存・自動保存・競合）をまとめる層。
 *
 * 判断そのものは下の4つが持ち、ここが決めるのは**それらをどう噛み合わせるか**だけ。
 *
 * ```
 * useEditorTabs.ts           どのファイルを開いていて、どれが手前か（React の state）
 * monaco/documentStore.ts    その中身・編集履歴・カーソル位置・保存済みの版・食い違い
 * editorTabState.ts          事実 → タブの状態（clean / dirty / conflict / deleted）
 * autoSave.ts                自動保存の設定モデル（純粋）
 * ```
 *
 * ## 2つの層は互いを知らない
 *
 * タブは id、Model は relativePath で同一性を持つ（それぞれの冒頭）。
 * つなぐ場所を1つに決めておかないと、変換がタブ側と Model 側の両方に散る。
 * ここがその1箇所。
 *
 * ## 保存経路
 *
 * ```
 * Ctrl+S / Auto Save / Overwrite
 *    ↓  relativePath
 * documentStore.readForSave      中身 + 版番号 + 前回ディスクで見た版 + 文字コード
 *    ↓
 * window.fluvix.files.writeFile  Preload の薄いラッパ
 *    ↓  IPC（files:write-file）
 * main/ipc/handlers/files.ts     基点を現在の Workspace から取る
 *    ↓
 * main/files/writeWorkspaceFile.ts  境界を確かめて書く
 * ```
 *
 * Renderer が渡すのは relativePath と中身だけで、絶対パスも root も出てこない
 * （読む側・作る側と同じ線。ARCHITECTURE.md §9.3 / §10.2）。
 *
 * ## 保存できなければ dirty を解かない
 *
 * `markSaved` を呼ぶのは書き込めたときだけ。失敗しても外部変更で止められても、
 * 未保存の印はそのまま残り、編集内容も Model の中に残る。
 * 「保存したつもりで消えていた」を作らないことが、この経路で一番守るべきこと。
 *
 * ## 外部変更をどう受けるか
 *
 * `files:changed` の `modified`（main/files/workspaceWatcher.ts）を受けたとき、
 * **未保存かどうかで分ける**。
 *
 * | 状態     | 扱い                                                        |
 * | -------- | ------------------------------------------------------------ |
 * | 未保存なし | ディスクを読み直して中身だけ差し替える（失うものが無い）    |
 * | 未保存あり | 食い違いとして控える。Reload / Compare / Overwrite は利用者が選ぶ |
 *
 * **自動で上書きしない**のはもちろん、**自動で捨てもしない。**
 * 未保存の内容はこのタブの中にしか無く、どちらを採るかは利用者の判断になる。
 */

/** 保存のいま。うまくいっている間は何も持たない（＝ここに現れない）。 */
export type EditorSaveState =
  | { readonly status: 'saving' }
  /** アプリの外で書き換えられていたため書かなかった。 */
  | { readonly status: 'conflict' }
  | { readonly status: 'error'; readonly message: string }

/**
 * 保存の結末。
 *
 * 閉じる前の確認（Save を選んだ場合）が「閉じてよいか」を判断するのに要る。
 * 真偽値にしないのは、**Conflict と失敗で次の一手が違う**ため
 * （前者は Reload / Overwrite を選ぶ、後者は原因を直して再試行する）。
 */
export type EditorSaveOutcome = 'saved' | 'conflict' | 'failed'

/** ディスク上の今の中身（Compare のもとになる）。 */
export type EditorDiskContent =
  | {
      readonly status: 'ok'
      readonly content: string
      readonly lineEnding: FileLineEnding
      readonly encoding: FileEncoding
      readonly revision: FileRevision | null
    }
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable'; readonly message: string }

export interface EditorController {
  /* ------ タブ（useEditorTabs.ts） */
  readonly tabs: readonly EditorTab[]
  readonly activeTabId: string | null
  readonly activeTab: EditorTab | null
  /** 閉じると内容が失われるタブ。Workspace / アプリを閉じる前の確認で使う。 */
  readonly unsavedTabs: readonly EditorTab[]
  readonly openFile: (input: { relativePath: string; name: string }) => void
  /**
   * ファイルを開き、その行・桁を見せる（全文検索の結果。Session 3-6-5）。
   *
   * 既にそのファイルを開いているタブがあれば、**2枚目を作らずにそれを手前へ出して**
   * 位置だけを動かす（openTab の重複を作らない振る舞いがそのまま効く）。
   */
  readonly openFileAt: (input: {
    relativePath: string
    name: string
    line: number
    column: number
    length?: number
  }) => void
  /** まだ見せていない位置の依頼（editor/editorReveal.ts）。 */
  readonly pendingReveal: EditorRevealRequest | null
  /** 位置を見せ終えたことを伝える（依頼は1回きり）。 */
  readonly consumeReveal: () => void
  readonly activate: (tabId: string) => void
  /** 未保存の確認をせずに閉じる（確認を出す側が「破棄」を選んだ後に呼ぶ）。 */
  readonly close: (tabId: string) => void
  readonly reload: (tabId: string) => void

  /* ------ 中身（monaco/documentStore.ts） */
  /** Monaco の Model を持つストア。MonacoEditor.tsx が使う。 */
  readonly documents: EditorDocumentStore

  /* ------ 保存 */
  readonly saveStates: Readonly<Record<string, EditorSaveState>>
  /** 1件を保存する。`overwrite` は外部変更の確認を飛ばす（Conflict の Overwrite）。 */
  readonly saveFile: (
    relativePath: string,
    options?: { overwrite?: boolean }
  ) => Promise<EditorSaveOutcome>
  /** 手前のタブを保存する（Ctrl+S の実体）。 */
  readonly saveActiveTab: () => void
  /** 未保存のタブをすべて保存する。1つでも成立しなければ false。 */
  readonly saveAllUnsaved: () => Promise<boolean>

  /* ------ 競合の解決 */
  /** ディスクの内容を取り込み、未保存の変更を捨てる。 */
  readonly reloadFromDisk: (relativePath: string) => Promise<void>
  /** Compare のために、今ディスクにある中身を読む。 */
  readonly readDiskContent: (relativePath: string) => Promise<EditorDiskContent>

  /* ------ 自動保存 */
  readonly autoSave: AutoSaveSettings
  readonly setAutoSaveMode: (mode: AutoSaveMode) => void
}

export function useEditorSession(workspaceId: string | null): EditorController {
  const tabs = useEditorTabs(workspaceId)

  /*
    Model のストアは React の state ではない。

    中身は Monaco の Model が正本で、React に持たせても描画には使わない
    （描くのは Monaco 自身）。state にすると、1文字打つたびに Renderer 全体の
    再描画を誘うことになる。
  */
  const documentsRef = useRef<EditorDocumentStore | null>(null)

  if (documentsRef.current === null) {
    documentsRef.current = new EditorDocumentStore()
  }

  const documents = documentsRef.current

  const [saveStates, setSaveStates] = useState<Readonly<Record<string, EditorSaveState>>>({})
  const [autoSave, setAutoSave] = useState<AutoSaveSettings>(DEFAULT_AUTO_SAVE_SETTINGS)

  /*
    描画のたびに最新を控える。イベント（キー入力・タイマー・IPC の応答）は
    React の描画とは別の時間軸で走るため、そこから読むのは state ではなく ref。
    控えないと、購読やタイマーをタブが変わるたびに張り直すことになる。
  */
  const tabsRef = useRef<readonly EditorTab[]>(tabs.tabs)
  const activeTabRef = useRef<EditorTab | null>(tabs.activeTab)
  const workspaceIdRef = useRef<string | null>(workspaceId)

  tabsRef.current = tabs.tabs
  activeTabRef.current = tabs.activeTab
  workspaceIdRef.current = workspaceId

  const setSaveState = useCallback((relativePath: string, state: EditorSaveState | null): void => {
    setSaveStates((previous) => {
      if (state === null) {
        if (!(relativePath in previous)) {
          return previous
        }

        const { [relativePath]: _removed, ...rest } = previous

        return rest
      }

      return { ...previous, [relativePath]: state }
    })
  }, [])

  /* ------------------------------------------------------ Workspace の破棄 */

  /*
    Workspace が変わったら（閉じた場合も含めて）Model を全部捨てる。

    残すと、その相対位置が**新しい Workspace の中の別のファイル**を指す。
    自動保存が動いていれば、開いてもいないファイルを前のプロジェクトの内容で
    上書きすることになる。タブ側の破棄は useEditorTabs.ts が描画中に行う。

    effect の後始末として書いてあるのは、workspaceId が変わったときと
    Provider ごと消えるときの両方で同じ処理が要るため。
  */
  useEffect(() => {
    return () => {
      documents.disposeAll()
      setSaveStates({})
    }
  }, [documents, workspaceId])

  /* -------------------------------------------------------- 状態の伝達 */

  useEffect(() => documents.onStateChange(tabs.setTabState), [documents, tabs.setTabState])

  /* ------------------------------------------------------------------ 保存 */

  /**
   * ファイルごとの書き込みの順番待ち（自動保存と Ctrl+S が並ぶ）。
   *
   * ## 走っている書き込みの結果を、そのまま返さない
   *
   * 同じファイルへの書き込みは重ねられないが、**待っている側へ
   * 走っている書き込みの結果を返してはいけない。** その結果が指しているのは
   * 「書き始めた時点」の中身で、待っている側が知りたいのは
   * 「**今**の中身が保存されたか」だから。
   *
   * 返してしまうと、書き込みの最中に打った文字が保存されていないのに
   * 閉じる前の確認（useTabCloseGuard / unsaved/）が「保存済み」と判断して
   * タブやウィンドウを閉じる ── まさに守ろうとしているものを失う。
   *
   * そこで**順番に並べる**。呼ばれた時点で走っているものがあれば、
   * それが終わってから改めて中身を取り直して書く。変更が無ければ
   * 何も書かずに返るので（下の early return）、待っただけで済む。
   */
  const savingRef = useRef(new Map<string, Promise<EditorSaveOutcome>>())

  const saveFile = useCallback(
    (relativePath: string, options?: { overwrite?: boolean }): Promise<EditorSaveOutcome> => {
      const previous = savingRef.current.get(relativePath)

      const run = async (): Promise<EditorSaveOutcome> => {
        // 中身を取り出すのは、前の書き込みが終わってから（上のコメント）。
        const snapshot = documents.readForSave(relativePath)

        // 開いていない / 変更が無いなら書かない（Ctrl+S の連打でディスクを触らない）。
        if (snapshot === null || !documents.isDirty(relativePath)) {
          return 'saved'
        }

        const workspaceIdAtRequest = workspaceIdRef.current

        setSaveState(relativePath, { status: 'saving' })

        const result = await fluvix.files.writeFile({
          relativePath,
          content: snapshot.content,
          /*
            上書きを選んだときだけ版の確認を飛ばす。
            既定では読んだときの版を添えるため、アプリの外で書き換えられていれば
            Main 側が書かずに 'stale' を返す。
          */
          baseRevision: options?.overwrite === true ? null : snapshot.baseRevision,
          // 開いたときの文字コード（BOM の有無）をそのまま書き戻す。
          encoding: snapshot.encoding
        })

        /*
          要求と応答の間に Workspace が切り替わっていたら、今のタブへ混ぜない
          （Files / Editor の読み込みと同じ扱い。§9.6）。
        */
        if (workspaceIdRef.current !== workspaceIdAtRequest) {
          return 'failed'
        }

        if (!result.ok) {
          // dirty は解かない。編集内容は Model の中に残る。
          setSaveState(relativePath, { status: 'error', message: describeIpcError(result.error) })

          // 消えていたなら、タブにそう出す（別名保存の余地を残す。§12.5）。
          if (result.error.code === 'NOT_FOUND') {
            documents.markMissing(relativePath)
          }

          return 'failed'
        }

        if (result.data.status === 'stale') {
          /*
            書かずに戻ってきた。ディスク側の版を控えて Conflict にする。
            気づいた経路は違っても（監視 / 保存の直前）、同じ1つの欄で表す
            （documentStore.ts の externalRevision）。
          */
          documents.markExternalChange(relativePath, result.data.revision)
          setSaveState(relativePath, { status: 'conflict' })
          return 'conflict'
        }

        /*
          「取り出した時点」の版番号を渡す。書き込んでいる間に打たれた文字は
          保存済みに含めない（documentStore.markSaved）。
        */
        documents.markSaved(relativePath, snapshot.versionId, result.data.revision)
        setSaveState(relativePath, null)

        return 'saved'
      }

      /*
        前の書き込みが終わってから走らせる。前が失敗していても続ける
        （こちらの中身はまだ保存されていないので、試す価値がある）。
      */
      const promise = previous === undefined ? run() : previous.then(run, run)

      savingRef.current.set(relativePath, promise)

      return promise.finally(() => {
        // 自分より後に並んだものがあれば、そちらが持ち主。消さない。
        if (savingRef.current.get(relativePath) === promise) {
          savingRef.current.delete(relativePath)
        }
      })
    },
    [documents, setSaveState]
  )

  const saveActiveTab = useCallback((): void => {
    const activeTab = activeTabRef.current

    if (activeTab !== null) {
      void saveFile(activeTab.relativePath)
    }
  }, [saveFile])

  const saveAllUnsaved = useCallback(async (): Promise<boolean> => {
    /*
      1件ずつ順に書く。並べて走らせると、同じフォルダへの書き込みが重なるうえ、
      失敗したときにどこまで進んだかが分かりにくくなる。
    */
    const targets = tabsRef.current.filter((tab) => hasUnsavedChanges(tab.state))

    let allSaved = true

    for (const tab of targets) {
      const outcome = await saveFile(tab.relativePath)

      if (outcome !== 'saved') {
        allSaved = false
      }
    }

    return allSaved
  }, [saveFile])

  /* ------------------------------------------------- ディスクを読み直す */

  const readDiskContent = useCallback(async (relativePath: string): Promise<EditorDiskContent> => {
    const result = await fluvix.files.readFile({ relativePath })

    if (!result.ok) {
      return result.error.code === 'NOT_FOUND'
        ? { status: 'missing' }
        : { status: 'unavailable', message: describeIpcError(result.error) }
    }

    if (result.data.workspaceId !== workspaceIdRef.current) {
      // 切り替えを跨いだ応答。今の Workspace の話ではない。
      return { status: 'unavailable', message: 'Workspace が切り替わりました。' }
    }

    if (result.data.status !== 'ok' || result.data.content === null) {
      // binary / too-large。開けていたものが急にそうなるのは、外で置き換えられた場合。
      return { status: 'unavailable', message: 'テキストとして読み込めませんでした。' }
    }

    return {
      status: 'ok',
      content: result.data.content,
      lineEnding: result.data.lineEnding ?? 'lf',
      encoding: result.data.encoding ?? 'utf8',
      revision: result.data.revision
    }
  }, [])

  /**
   * ディスクの内容を取り込む（Reload と、未保存でない場合の自動追従）。
   *
   * Model もタブも作り直さず中身だけを差し替える（documentStore.replaceContent）。
   */
  const reloadFromDisk = useCallback(
    async (relativePath: string): Promise<void> => {
      const disk = await readDiskContent(relativePath)

      if (disk.status === 'missing') {
        documents.markMissing(relativePath)
        return
      }

      if (disk.status === 'unavailable') {
        setSaveState(relativePath, { status: 'error', message: disk.message })
        return
      }

      documents.replaceContent(relativePath, {
        content: disk.content,
        lineEnding: disk.lineEnding,
        encoding: disk.encoding,
        revision: disk.revision
      })

      setSaveState(relativePath, null)
    },
    [documents, readDiskContent, setSaveState]
  )

  /* ------------------------------------------- ディスク側の変化への追従 */

  /*
    `files:changed`（§3.3）を Model の側でも受け取る。タブ側（useEditorTabs.ts）とは
    別々に購読していて、互いを知らない。送る側は受け手が増えても変わらない。
  */
  useEffect(() => {
    if (workspaceId === null) {
      return
    }

    return fluvix.files.onChanged((event) => {
      if (event.workspaceId !== workspaceId) {
        return
      }

      // 改名・削除の追従（Model の鍵の付け替えと、未保存でないものの破棄）。
      documents.applyFileChanges(event.changes)

      for (const change of event.changes) {
        if (change.kind !== 'modified') {
          continue
        }

        // 開いていないファイルは関係ない。
        if (documents.getModel(change.relativePath) === null) {
          continue
        }

        if (documents.isDirty(change.relativePath)) {
          /*
            未保存の変更がある。**中身には触らない。**
            食い違いとして控え、Reload / Compare / Overwrite を利用者に出す。
            自分の保存で発火した場合は、版が一致するので何も起きない
            （documentStore.markExternalChange）。
          */
          documents.markExternalChange(change.relativePath, change.revision)
          continue
        }

        /*
          未保存の変更が無い。失うものが無いので、そのまま取り込む。
          タブも Model も作り直さないため、見ていた位置は保たれる。
        */
        void reloadFromDisk(change.relativePath)
      }
    })
  }, [documents, reloadFromDisk, workspaceId])

  /* ------------------------------------------------------------ Ctrl + S */

  /*
    Monaco の側ではなくウィンドウに掛けている。

    Monaco は Ctrl+S に何も割り当てていないため、エディタに focus があっても
    keydown はここまで上がってくる。1本にしておくと、
      - Files パネルに focus があるときも保存できる
      - エディタ側と二重に発火する経路を作らない
    となる。ネイティブメニュー（main/app/menu.ts）とも競合しない
    （開発時のメニューは Reload / DevTools / Zoom / Quit だけで、配布ビルドには無い）。
  */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      if (event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') {
        return
      }

      event.preventDefault()
      saveActiveTab()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [saveActiveTab])

  /* --------------------------------------------------------- Auto Save */

  /*
    afterDelay。

    状態の通知は**文字を打つたびに**届く（documentStore の onDidChangeContent）。
    そのたびにタイマーを張り直すことで、入力が止まってから1回だけ書く形になる。
    ここで間引かないと、1文字ごとに IPC とディスクへの書き込みが走る。
  */
  useEffect(() => {
    if (autoSave.mode !== 'afterDelay') {
      return
    }

    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    function cancel(relativePath: string): void {
      const timer = timers.get(relativePath)

      if (timer !== undefined) {
        clearTimeout(timer)
        timers.delete(relativePath)
      }
    }

    const unsubscribe = documents.onStateChange((relativePath, state) => {
      cancel(relativePath)

      /*
        自動で保存してよいのは「未保存なだけ」のとき。
        Conflict と削除済みは**利用者が選ぶまで書かない** ── 自動保存が
        外部の変更を黙って上書きしてしまうのが、この機能で一番避けたいこと。
      */
      if (state !== 'dirty') {
        return
      }

      timers.set(
        relativePath,
        setTimeout(() => {
          timers.delete(relativePath)
          void saveFile(relativePath)
        }, autoSave.delayMs)
      )
    })

    return () => {
      unsubscribe()

      // 設定を変えた / Workspace が変わった後に、待っていた書き込みを走らせない。
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
    }
  }, [documents, autoSave.mode, autoSave.delayMs, saveFile, workspaceId])

  /*
    onFocusChange。

    「別のタブへ移った」ときに、**離れたタブ**を保存する。手前のタブを保存するのでは
    「離れる」の意味にならず、切り替えた先が保存されることになる。

    描画の後（effect）に前回の値と比べるのは、切り替えを表す state が
    activeTabId しかないため。ここで ref を使うと、切り替えの前後どちらの値を
    見ているのかが読みにくくなる。
  */
  const previousActivePathRef = useRef<string | null>(tabs.activeTab?.relativePath ?? null)

  useEffect(() => {
    const previousPath = previousActivePathRef.current
    const currentPath = tabs.activeTab?.relativePath ?? null

    previousActivePathRef.current = currentPath

    if (
      autoSave.mode !== 'onFocusChange' ||
      previousPath === null ||
      previousPath === currentPath
    ) {
      return
    }

    // afterDelay と同じ理由で、Conflict / 削除済みは自動で書かない。
    if (documents.getState(previousPath) === 'dirty') {
      void saveFile(previousPath)
    }
  }, [documents, autoSave.mode, saveFile, tabs.activeTab])

  /*
    onWindowChange。

    ウィンドウがフォーカスを失ったときに、未保存のものをすべて保存する。
    別のアプリ（ビルド・ブラウザ・Git クライアント）へ移る瞬間が
    「編集を区切った」ところにあたるため、手前のタブだけに限らない。
  */
  useEffect(() => {
    if (autoSave.mode !== 'onWindowChange') {
      return
    }

    function onBlur(): void {
      for (const tab of tabsRef.current) {
        if (documents.getState(tab.relativePath) === 'dirty') {
          void saveFile(tab.relativePath)
        }
      }
    }

    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('blur', onBlur)
    }
  }, [documents, autoSave.mode, saveFile])

  /* ------------------------------------------------- Auto Save の永続化 */

  /*
    起動時に1度だけ読む。読めなければ既定（OFF）のまま。

    Renderer は保存先を知らない（settings ドメインの API はパスを取らない。
    ARCHITECTURE.md §5）。**Workspace ごとではなくアプリの設定**なので、
    workspaceId には依存しない。
  */
  const settingsLoadedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    void fluvix.settings.loadEditor().then((result) => {
      if (cancelled) {
        return
      }

      if (result.ok) {
        setAutoSave(toAutoSaveSettings(result.data.document))
      } else {
        console.warn('[settings] Editor の設定を読み込めませんでした。', result.error)
      }

      /*
        読み込みが終わってから保存を許す。先に許すと、**既定値で上書きした後に
        読み込みが届く**（起動のたびに設定が OFF へ戻る）。
      */
      settingsLoadedRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!settingsLoadedRef.current) {
      return
    }

    void fluvix.settings.saveEditor({ document: toEditorSettingsDocument(autoSave) })
  }, [autoSave])

  const setAutoSaveMode = useCallback((mode: AutoSaveMode): void => {
    setAutoSave((previous) => {
      const next = normalizeAutoSaveSettings({ ...previous, mode })

      return isSameAutoSaveSettings(previous, next) ? previous : next
    })
  }, [])

  /* --------------------------------------- タブを閉じる / 読み直す */

  /*
    閉じる ＝ 編集を捨てる。Model を残すと、開き直したときに
    「保存していないはずの内容」が戻ってくる。

    **未保存の確認はここでは出さない。** 出す側（EditorWorkArea / unsaved/）が
    利用者の選択を済ませてからこれを呼ぶ。確認とタブの操作を混ぜると、
    「確認を出さずに閉じたい」（保存した直後など）経路が作れなくなる。
  */
  const close = useCallback(
    (tabId: string): void => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)

      if (tab !== undefined) {
        documents.release(tab.relativePath)
        setSaveState(tab.relativePath, null)
      }

      tabs.close(tabId)
    },
    [documents, setSaveState, tabs.close]
  )

  const reload = useCallback(
    (tabId: string): void => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)

      if (tab !== undefined) {
        // 先に捨てないと、読み直した中身が既存の Model に無視される（acquire の約束）。
        documents.release(tab.relativePath)
        setSaveState(tab.relativePath, null)
      }

      tabs.reload(tabId)
    },
    [documents, setSaveState, tabs.reload]
  )

  return useMemo(
    () => ({
      tabs: tabs.tabs,
      activeTabId: tabs.activeTabId,
      activeTab: tabs.activeTab,
      unsavedTabs: tabs.unsavedTabs,
      openFile: tabs.openFile,
      openFileAt: tabs.openFileAt,
      pendingReveal: tabs.pendingReveal,
      consumeReveal: tabs.consumeReveal,
      activate: tabs.activate,
      close,
      reload,
      documents,
      saveStates,
      saveFile,
      saveActiveTab,
      saveAllUnsaved,
      reloadFromDisk,
      readDiskContent,
      autoSave,
      setAutoSaveMode
    }),
    [
      tabs.tabs,
      tabs.activeTabId,
      tabs.activeTab,
      tabs.unsavedTabs,
      tabs.openFile,
      tabs.openFileAt,
      tabs.pendingReveal,
      tabs.consumeReveal,
      tabs.activate,
      close,
      reload,
      documents,
      saveStates,
      saveFile,
      saveActiveTab,
      saveAllUnsaved,
      reloadFromDisk,
      readDiskContent,
      autoSave,
      setAutoSaveMode
    ]
  )
}
