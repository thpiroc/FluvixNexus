import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEncoding, FileLineEnding, FileRevision } from '@shared/files'
import { fluvix } from '../api/fluvix'
import { useSettingsSection } from '../settings/useSettingsSection'
import {
  DEFAULT_AUTO_SAVE_SETTINGS,
  isSameAutoSaveSettings,
  normalizeAutoSaveSettings,
  toAutoSaveSettings,
  toEditorSettingsSection,
  type AutoSaveMode,
  type AutoSaveSettings
} from './autoSave'
import type { EditorFailure } from './editorError'
import { useCompletion } from './lsp/useCompletion'
import { useDiagnostics } from './lsp/useDiagnostics'
import { useDocumentSync } from './lsp/useDocumentSync'
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
  | { readonly status: 'error'; readonly failure: EditorFailure }

/**
 * 保存の結末。
 *
 * 閉じる前の確認（Save を選んだ場合）が「閉じてよいか」を判断するのに要る。
 * 真偽値にしないのは、**Conflict と失敗で次の一手が違う**ため
 * （前者は Reload / Overwrite を選ぶ、後者は原因を直して再試行する）。
 */
export type EditorSaveOutcome = 'saved' | 'conflict' | 'failed'

/**
 * 別名で保存の結末（Session 4-2）。
 *
 * `EditorSaveOutcome` と分けてあるのは、**知らせる相手が違う**ため。
 * 通常の保存は失敗したときだけ画面に出るが、こちらは成功しても
 * 「どこへ書けたか」「このタブはそこへ移ったか」を伝える必要がある
 * ── 書けたのにタブが動かない場合があり、黙っていると失敗に見える。
 */
export type EditorSaveAsOutcome =
  /** ダイアログを閉じた。**何一つ変えていない。** */
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'saved'
      /** 書けたファイルの名前（絶対パスは Renderer に無い）。 */
      readonly name: string
      /** このタブが保存先へ移ったか。 */
      readonly followed: boolean
      /**
       * 移らなかった理由。移った場合は null。
       *
       * どちらも「書けたが、このタブでは続けられない」であって、
       * **書けなかったわけではない。**
       *
       * | 理由                 | 中身                                                     |
       * | -------------------- | -------------------------------------------------------- |
       * | `outside-workspace`  | Workspace の外。Editor が開けるのは中だけ                |
       * | `already-open`       | その位置は別のタブが開いている（2枚にも、閉じさせもしない） |
       */
      readonly reason: 'outside-workspace' | 'already-open' | null
    }
  | { readonly status: 'failed'; readonly failure: EditorFailure }

/**
 * 別名で保存の結果の知らせ（画面に1行出すためだけのもの）。
 *
 * 鍵がタブ id なのは、**保存の後にタブの位置が変わる**ため
 * （位置を鍵にすると、移った瞬間に自分の知らせを見失う）。
 */
export interface EditorSaveAsNotice {
  readonly tabId: string
  readonly name: string
  readonly followed: boolean
  readonly reason: 'outside-workspace' | 'already-open' | null
}

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
  | { readonly status: 'unavailable'; readonly failure: EditorFailure }

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
  /** 手前のタブを保存する（`editor.save` command の実体）。 */
  readonly saveActiveTab: () => void
  /** 未保存のタブをすべて保存する。1つでも成立しなければ false。 */
  readonly saveAllUnsaved: () => Promise<boolean>

  /* ------ 別名で保存（Session 4-2） */
  /**
   * このタブの中身を、利用者が選んだ場所へ書き出す。
   *
   * ディスクから消えているタブでも呼べる（**それがこの経路の主目的**）。
   * 未保存の変更が無くても書ける（同じ中身を別の名前で置く、は成立する操作）。
   */
  readonly saveFileAs: (tabId: string) => Promise<EditorSaveAsOutcome>
  /** 直前の別名で保存の知らせ。無ければ null。 */
  readonly saveAsNotice: EditorSaveAsNotice | null
  readonly dismissSaveAsNotice: () => void

  /* ------ 競合の解決 */
  /** ディスクの内容を取り込み、未保存の変更を捨てる。 */
  readonly reloadFromDisk: (relativePath: string) => Promise<void>
  /** Compare のために、今ディスクにある中身を読む。 */
  readonly readDiskContent: (relativePath: string) => Promise<EditorDiskContent>

  /* ------ 自動保存 */
  readonly autoSave: AutoSaveSettings
  readonly setAutoSaveMode: (mode: AutoSaveMode) => void
  /**
   * `afterDelay` の待ち時間を変える（上下限は `normalizeAutoSaveSettings` が掛ける）。
   *
   * Session 4-3B で足した。値そのものは Session 3-5 から保存されていたが、
   * **変える口がどこにも無かった**（保存ファイルを手で書き換えるしかなかった）。
   */
  readonly setAutoSaveDelayMs: (delayMs: number) => void
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

  /*
    開いている文書を Language Server と同期する（Session 5-2）。

    ここで呼ぶのは、**Model の生き死にを持っているのがこのストアだから**に
    ほかならない。画面の部品からは Model が作られた / 捨てられた瞬間が見えず、
    そこから起こすと「開いていない文書を変更した」という通知が作れてしまう。

    このフックが返す値は無い。Editor の振る舞いは何も変わらず、
    変わるのは**Main へ届く出来事が増える**ことだけになる
    （Language Server が1つも入っていない PC でも、ここは同じように動く）。
  */
  useDocumentSync(documents, workspaceId)
  useCompletion(documents, workspaceId)

  /*
    サーバが出した指摘を Monaco の marker にする（Session 5-3）。

    同期と対にしてここへ置く ── 指摘は**同期した文書についてしか届かない**ので、
    どちらも Model を持つ層の隣に居るのが素直になる。
    こちらも返す値は無く、Language Server が1つも入っていない PC では
    何も起きない（内蔵の指摘がそのまま働く）。
  */
  useDiagnostics(documents, workspaceId)

  const [saveStates, setSaveStates] = useState<Readonly<Record<string, EditorSaveState>>>({})

  /*
    Auto Save の設定は**アプリの設定**（Workspace ごとではない）なので、
    workspaceId には依存しない。読み書きの段取りは settings/useSettingsSection.ts
    が持ち、ここは「何を、どう保存形式と行き来させるか」だけを渡す。
  */
  const { value: autoSave, update: updateAutoSave } = useSettingsSection({
    section: 'editor',
    initial: DEFAULT_AUTO_SAVE_SETTINGS,
    fromStored: toAutoSaveSettings,
    toStored: toEditorSettingsSection,
    label: 'Editor の設定'
  })

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
          setSaveState(relativePath, {
            status: 'error',
            failure: { kind: 'ipc', error: result.error }
          })

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

  /* ------------------------------------------------- 別名で保存（4-2） */

  const [saveAsNotice, setSaveAsNotice] = useState<EditorSaveAsNotice | null>(null)

  const dismissSaveAsNotice = useCallback((): void => {
    setSaveAsNotice(null)
  }, [])

  /**
   * このタブの中身を、利用者が選んだ場所へ書き出す。
   *
   * ## 通常の保存と経路を分ける
   *
   * `saveFile` は「今の位置へ書き戻す」で、**対象が実在することが前提**になっている。
   * その前提のせいで、外から消されたファイルの内容はどこへも書けない
   * ── 閉じる前の確認が「救えません」と出していたのはこれが理由で
   * （unsaved/lossMessage.ts の `unsavable`）、ここがその経路を閉じる。
   *
   * 順番待ち（`savingRef`）にも並べない。位置が違えば書く相手も違い、
   * 待つ理由が無いため。
   *
   * ## 書けてから、タブを移す
   *
   * ```
   * documents.readForSave     中身 + 版番号 + 文字コード（通常の保存と同じ一式）
   *    ↓
   * fluvix.files.saveAs       ダイアログ → 書き込み（どちらも Main）
   *    ↓  relativePath（Workspace の外なら null）
   * documents.rename          Model の鍵を移す（Undo 履歴は保つ）
   * tabs.moveTab              タブの位置と名前を差し替える
   * documents.markSaved       未保存と「消えていた」を解く
   * ```
   *
   * **順番が意味を持つ。** Model を先に移すのは、タブの位置が変わった時点で
   * 器（MonacoEditor.tsx）が新しい位置の Model を取りに来るため
   * ── 移す前にタブを動かすと、そこには Model が無く、**読み込んだ時点の中身から
   * 作り直された空の Model** が載る（＝編集が消える）。
   *
   * ## 移せない場合でも、書けた事実は取り消さない
   *
   * Workspace の外だった / 保存先が別のタブに開かれていた場合はタブを移さないが、
   * **書き込みは済んでいる**（利用者がダイアログで選び、上書きなら OS の確認も
   * 通っている）。ここで dirty を解かないのは、このタブが指している位置には
   * まだその中身が無いため ── 解くと「保存したのに、次に開いたら古い」が起きる。
   */
  const saveFileAs = useCallback(
    async (tabId: string): Promise<EditorSaveAsOutcome> => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)

      if (tab === undefined) {
        return { status: 'failed', failure: { kind: 'tab-gone' } }
      }

      const snapshot = documents.readForSave(tab.relativePath)

      if (snapshot === null) {
        // 中身がまだ載っていない（読み込み中・バイナリ・読めなかった）。
        return { status: 'failed', failure: { kind: 'no-writable-content' } }
      }

      const workspaceIdAtRequest = workspaceIdRef.current

      setSaveState(tab.relativePath, { status: 'saving' })

      const result = await fluvix.files.saveAs({
        content: snapshot.content,
        encoding: snapshot.encoding,
        // ダイアログをどこで開くかの助言。行き先を決めるのは利用者。
        suggestedRelativePath: tab.relativePath
      })

      // 要求と応答の間に Workspace が切り替わっていたら、今のタブへ混ぜない。
      if (workspaceIdRef.current !== workspaceIdAtRequest) {
        return { status: 'failed', failure: { kind: 'workspace-changed' } }
      }

      if (!result.ok) {
        const failure: EditorFailure = { kind: 'ipc', error: result.error }

        setSaveState(tab.relativePath, { status: 'error', failure })

        return { status: 'failed', failure }
      }

      if (result.data.status === 'cancelled') {
        /*
          取り消し。**何一つ変えない。**
          直前に立てた「保存中」も畳んで、押す前の見え方へ戻す。
        */
        setSaveState(tab.relativePath, null)

        return { status: 'cancelled' }
      }

      const { name, relativePath, revision, byteLength } = result.data

      setSaveState(tab.relativePath, null)

      const finish = (
        followed: boolean,
        reason: 'outside-workspace' | 'already-open' | null
      ): EditorSaveAsOutcome => {
        setSaveAsNotice({ tabId, name, followed, reason })

        return { status: 'saved', name, followed, reason }
      }

      // Workspace の外。書けているが、Editor は外のファイルを開けない。
      if (relativePath === null || revision === null) {
        return finish(false, 'outside-workspace')
      }

      // 保存先が別のタブに開かれている。2枚にも、相手を閉じもしない。
      if (tabs.isPathOpenElsewhere(tabId, relativePath)) {
        return finish(false, 'already-open')
      }

      /*
        Model → タブ → 保存済みの印、の順（上記）。
        同じ位置を選んだ場合（rename が何もしない）も、この流れをそのまま通る。
      */
      if (!documents.rename(tab.relativePath, relativePath)) {
        return finish(false, 'already-open')
      }

      tabs.moveTab(tabId, { relativePath, name })

      /*
        読み込んだときの中身も、今書き出したもので揃えておく。
        揃えないと、器が作り直されたとき（パネルを閉じて開く）に
        **保存前の中身**を材料に Model を作り直そうとする。
      */
      tabs.setDocument(tabId, {
        status: 'ready',
        content: snapshot.content,
        byteLength,
        lineEnding: tab.document.status === 'ready' ? tab.document.lineEnding : 'lf',
        encoding: snapshot.encoding,
        revision
      })

      /*
        「取り出した時点」の版番号を渡す（通常の保存と同じ）。
        ここで未保存と「ディスク上から削除された」の両方が解ける
        （documentStore.markSaved）。
      */
      documents.markSaved(relativePath, snapshot.versionId, revision)

      /*
        2つの層の位置が揃った後に、状態を写す。
        `markSaved` の通知はタブが移る前に飛んでいるため、ここで改めて揃える
        （documentStore.rename が状態を知らせない理由）。
      */
      tabs.setTabState(relativePath, documents.getState(relativePath))

      return finish(true, null)
    },
    [documents, setSaveState, tabs]
  )

  /* ------------------------------------------------- ディスクを読み直す */

  const readDiskContent = useCallback(async (relativePath: string): Promise<EditorDiskContent> => {
    const result = await fluvix.files.readFile({ relativePath })

    if (!result.ok) {
      return result.error.code === 'NOT_FOUND'
        ? { status: 'missing' }
        : { status: 'unavailable', failure: { kind: 'ipc', error: result.error } }
    }

    if (result.data.workspaceId !== workspaceIdRef.current) {
      // 切り替えを跨いだ応答。今の Workspace の話ではない。
      return { status: 'unavailable', failure: { kind: 'workspace-changed' } }
    }

    if (result.data.status !== 'ok' || result.data.content === null) {
      // binary / too-large。開けていたものが急にそうなるのは、外で置き換えられた場合。
      return { status: 'unavailable', failure: { kind: 'not-text' } }
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
        setSaveState(relativePath, { status: 'error', failure: disk.failure })
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
    Session 4-7A で、ここにあった window の keydown 購読を**移設した**。

    Session 3-5 から 4-5B までは、このフックが直接 `window` へ Ctrl+S を
    掛けていた（Monaco が Ctrl+S に何も割り当てていないため、エディタに
    focus があっても keydown が上がってくる、という前提は今も同じ）。
    アプリ全体のショートカット基盤ができた以上、**打鍵の割り当てを知っている
    場所は1つ**にする ── そうしないと、設定画面に出てくる割り当てと、
    実際に効く打鍵が別々に増えていくことになる。

    今の分担:

      何が起きるか … `saveActiveTab`（ここ。EditorProvider が command として登録する）
      どの打鍵か   … keybindings/defaults.ts の `editor.save`
      いつ効くか   … keybindings/dispatch.ts

    **複製ではなく移動**なので、購読は今もアプリ全体で1本のまま
    （二重に発火する経路を作らない、という元の判断は変わっていない）。
  */

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

  /* ------------------------------------------------- Auto Save の設定を変える */

  /*
    読み込みと保存そのものは useSettingsSection が持つ（上）。ここに残るのは
    「同じなら据え置く」判断だけで、それは**設定の意味を知っている側にしか
    決められない** ── 同じ値で更新し続けると保存と再描画が走り続ける。
  */
  const setAutoSaveMode = useCallback(
    (mode: AutoSaveMode): void => {
      updateAutoSave((previous) => {
        const next = normalizeAutoSaveSettings({ ...previous, mode })

        return isSameAutoSaveSettings(previous, next) ? previous : next
      })
    },
    [updateAutoSave]
  )

  /*
    待ち時間も同じ形で変える（Session 4-3B）。上下限と丸めは
    `normalizeAutoSaveSettings` が持つ ── Settings 画面の欄も、保存ファイルの
    読み込みも**同じ関数**を通る（片方だけに掛けると食い違う）。
  */
  const setAutoSaveDelayMs = useCallback(
    (delayMs: number): void => {
      updateAutoSave((previous) => {
        const next = normalizeAutoSaveSettings({ ...previous, delayMs })

        return isSameAutoSaveSettings(previous, next) ? previous : next
      })
    },
    [updateAutoSave]
  )

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
      saveFileAs,
      saveAsNotice,
      dismissSaveAsNotice,
      reloadFromDisk,
      readDiskContent,
      autoSave,
      setAutoSaveMode,
      setAutoSaveDelayMs
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
      saveFileAs,
      saveAsNotice,
      dismissSaveAsNotice,
      reloadFromDisk,
      readDiskContent,
      autoSave,
      setAutoSaveMode,
      setAutoSaveDelayMs
    ]
  )
}
