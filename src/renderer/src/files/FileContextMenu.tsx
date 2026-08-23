import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { WORKSPACE_ROOT_RELATIVE_PATH, type FileEntry } from '@shared/files'
import { canPasteInto, type FilesClipboard } from './clipboard'
import { canMoveInto } from './moveTarget'

/**
 * ツリーの右クリックメニュー。
 *
 * ボタンの真下に開くドロップダウン（ui/DropdownMenu.tsx）とは別のコンポーネントに
 * してある。開く位置の決まり方が違う（ボタンの真下 / カーソルの位置）ためで、
 * 閉じ方（項目の選択・外側のクリック・Escape）と役割の付け方は揃えてある。
 *
 * Terminal / Git でも**右クリック**メニューが要るようになった時点で、
 * この器も renderer/src/ui/ へ引き上げる（ドロップダウンの方は Session 3-7-2 で
 * Terminal が2つめの使い手になったため、既に引き上げてある）。
 * 今は使う側が Files だけなので、使う場所の隣に置いておく。
 *
 * ## 何を並べるか
 *
 * 対象によって変える。**できない操作を並べて無効にするのではなく、出さない。**
 * root に「削除」が灰色で並んでいると、条件次第で消せるように見える。
 *
 * | 対象         | 項目                                                            |
 * | ------------ | --------------------------------------------------------------- |
 * | ファイル     | 開く / 名前を変更 / コピー / 移動… / 削除                        |
 * | フォルダ     | 新規ファイル / 新規フォルダ / 名前を変更 / コピー / 移動… / 削除 |
 * | Workspace root | 新規ファイル / 新規フォルダ / 再読み込み                      |
 *
 * root に「名前を変更」「削除」が無いのは、それが Workspace そのものであり、
 * Files パネルの操作範囲（Workspace の中）の外側にあたるため。
 * 同じ理由で root は「移動…」「コピー」の対象にもならないが、
 * **移動先・貼り付け先にはなる**（Workspace 直下へ置くのは、この操作範囲の中の話）。
 *
 * ## コピーと貼り付け
 *
 * 「コピー」で指したものを控え（Renderer の中だけ。clipboard.ts）、フォルダを
 * 右クリックして「ここに貼り付け」で複製する。移動と同じ2手の形にしてあるのは、
 * **行き先を選ぶのに一番向いた道具が目の前のツリーそのもの**だからで、
 * 理由も移動とまったく同じ。
 *
 * 貼り付け先になれないフォルダには**項目自体を出さない**（clipboard.ts の
 * canPasteInto）。copy では**同じフォルダへの貼り付けも成立する** ── その場で
 * 複製が1つ増える、という素直な操作になる（移動ではここが「何も起きない」ため出さない）。
 *
 * OS のクリップボードは使わない（Renderer は絶対パスを持たない）。**「切り取り」は
 * 出さない** ── 器は cut を持っているが、それは結局のところ移動であり、移動には
 * すでに2つの入口がある（下の2手と、Session 3-6-3 のドラッグ&ドロップ）。
 * 3つめを並べても手数も結果も同じものが増えるだけになる（clipboard.ts）。
 *
 * ## 移動は2手に分ける
 *
 * 「移動…」で動かすものを決め、次にフォルダを右クリックして「ここへ移動」を選ぶ。
 * 移動先を選ぶダイアログを別に作っていないのは、**行き先を選ぶのに一番向いた道具が
 * 目の前のツリーそのもの**であるため（畳んだフォルダは開いてから選べる）。
 *
 * ドラッグ&ドロップ（Session 3-6-3）が入った後もこの2手を残しているのは、
 * **ドラッグでは行き先が画面に出ていないと選べない**ため。遠い場所へ動かす場合や
 * 畳んだフォルダの中を選びたい場合は、こちらの方が確実に届く。
 *
 * 動かすものが決まっている間は、そのフォルダが移動先になれるときだけ
 * 「ここへ移動」を出す（`moveTarget.ts`）。既にそのフォルダに居る場合・
 * 自分自身の中へ動かそうとしている場合は**項目自体が出ない** ── ここでも
 * 「できない操作を並べて無効にするのではなく、出さない」を通す。
 */

export interface FileContextMenuTarget {
  /** 対象。root 行なら relativePath が空文字。 */
  readonly entry: FileEntry
  /** 開いた位置（クライアント座標）。 */
  readonly x: number
  readonly y: number
}

export interface FileContextMenuActions {
  readonly onOpen: (entry: FileEntry) => void
  readonly onCreate: (parentRelativePath: string, entryType: 'file' | 'directory') => void
  readonly onRename: (entry: FileEntry) => void
  /** コピーするものを控える（この時点では何も起きない）。 */
  readonly onCopy: (entry: FileEntry) => void
  /** 控えておいたものを、このフォルダへ貼り付ける。 */
  readonly onPasteInto: (destinationRelativePath: string) => void
  /** 控えを捨てる。 */
  readonly onClearClipboard: () => void
  /** 動かすものを決める（この時点では何も起きない）。 */
  readonly onStartMove: (entry: FileEntry) => void
  /** 決めておいたものを、このフォルダへ動かす。 */
  readonly onMoveInto: (destinationRelativePath: string) => void
  /** 動かすものを決めた状態をやめる。 */
  readonly onCancelMove: () => void
  readonly onDelete: (entry: FileEntry) => void
  readonly onReload: () => void
}

interface MenuItem {
  readonly key: string
  readonly label: string
  readonly run: () => void
}

/** カーソルの位置に出す。画面からはみ出す場合は内側へ寄せる。 */
interface MenuStyle extends CSSProperties {
  readonly left: number
  readonly top: number
}

function buildItems(
  entry: FileEntry,
  actions: FileContextMenuActions,
  pendingMove: FileEntry | null,
  clipboard: FilesClipboard | null
): readonly MenuItem[] {
  const isRoot = entry.relativePath === WORKSPACE_ROOT_RELATIVE_PATH
  const items: MenuItem[] = []

  /*
    移動の途中なら、その続きを先頭に置く。今の関心はそれであり、
    下に並ぶ作成 / 削除より先に目に入る位置にある方が探さずに済む。
  */
  if (pendingMove !== null) {
    if (entry.type === 'directory' && canMoveInto(pendingMove, entry.relativePath)) {
      items.push({
        key: 'move-into',
        label: `「${pendingMove.name}」をここへ移動`,
        run: () => actions.onMoveInto(entry.relativePath)
      })
    }

    // 移動先になれない場所を右クリックしたときでも、やめる手段は必ず出す。
    items.push({ key: 'move-cancel', label: '移動をやめる', run: actions.onCancelMove })
  }

  /*
    コピーの控えがあるなら、その続きも先頭に置く（移動と同じ理由）。
    移動の途中とは同時に起きない ── どちらかを始めた時点でもう片方は解ける
    （FileTree.tsx）。「次に何かする」状態が2つあると、
    メニューの中で2つの続きが並び、どちらの話なのかが文言だけでは決まらない。
  */
  if (clipboard !== null) {
    if (entry.type === 'directory' && canPasteInto(clipboard, entry.relativePath)) {
      items.push({
        key: 'paste-into',
        label: `「${clipboard.entry.name}」をここに貼り付け`,
        run: () => actions.onPasteInto(entry.relativePath)
      })
    }

    // 貼り付け先になれない場所を右クリックしたときでも、やめる手段は必ず出す。
    items.push({ key: 'paste-clear', label: 'コピーをやめる', run: actions.onClearClipboard })
  }

  if (isRoot) {
    items.push(
      {
        key: 'new-file',
        label: '新規ファイル',
        run: () => actions.onCreate(entry.relativePath, 'file')
      },
      {
        key: 'new-folder',
        label: '新規フォルダ',
        run: () => actions.onCreate(entry.relativePath, 'directory')
      },
      { key: 'reload', label: '再読み込み', run: actions.onReload }
    )

    return items
  }

  if (entry.type === 'directory') {
    items.push(
      {
        key: 'new-file',
        label: '新規ファイル',
        run: () => actions.onCreate(entry.relativePath, 'file')
      },
      {
        key: 'new-folder',
        label: '新規フォルダ',
        run: () => actions.onCreate(entry.relativePath, 'directory')
      }
    )
  } else {
    items.push({ key: 'open', label: '開く', run: () => actions.onOpen(entry) })
  }

  items.push({ key: 'rename', label: '名前を変更', run: () => actions.onRename(entry) })

  /*
    移動の途中・コピーの控えがある間は「コピー」「移動…」を出さない。出すと、
    同じメニューの中に「これを動かす / 複製する」と「ここへ動かす / 貼り付ける」が
    並び、どちらの話をしているのかが項目の文言だけでは決まらなくなる。
    やめてから選び直せる。
  */
  if (pendingMove === null && clipboard === null) {
    items.push(
      { key: 'copy', label: 'コピー', run: () => actions.onCopy(entry) },
      { key: 'move', label: '移動…', run: () => actions.onStartMove(entry) }
    )
  }

  items.push({ key: 'delete', label: '削除', run: () => actions.onDelete(entry) })

  return items
}

export function FileContextMenu({
  target,
  actions,
  pendingMove = null,
  clipboard = null,
  onClose
}: {
  readonly target: FileContextMenuTarget
  readonly actions: FileContextMenuActions
  /** 今どれを動かそうとしているか。決まっていなければ null。 */
  readonly pendingMove?: FileEntry | null
  /** 今どれをコピーしようとしているか。控えが無ければ null。 */
  readonly clipboard?: FilesClipboard | null
  readonly onClose: () => void
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuStyle>({ left: target.x, top: target.y })

  /*
    描いた後に大きさを測り、画面の外へ出ていたら内側へ寄せる。

    描く前には決められない（項目数がメニューによって違う）。useLayoutEffect で
    描画が画面に出る前に直すため、ずれた位置が一瞬見えることはない。
  */
  useLayoutEffect(() => {
    const element = rootRef.current

    if (element === null) {
      return
    }

    const { width, height } = element.getBoundingClientRect()
    const left = Math.max(0, Math.min(target.x, window.innerWidth - width))
    const top = Math.max(0, Math.min(target.y, window.innerHeight - height))

    setPosition({ left, top })
  }, [target.x, target.y])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const element = rootRef.current

      if (element !== null && event.target instanceof Node && element.contains(event.target)) {
        return
      }

      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    // パネルのドラッグやウィンドウの切り替えが始まったら、開いたままにしない。
    window.addEventListener('blur', onClose)
    // パネルをリサイズ / 移動すると、掴んだ位置とメニューの位置がずれる。
    window.addEventListener('resize', onClose)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={rootRef}
      className="fx-file-menu"
      role="menu"
      aria-label={`${target.entry.name} の操作`}
      data-relative-path={target.entry.relativePath}
      style={position}
    >
      {buildItems(target.entry, actions, pendingMove, clipboard).map((item) => (
        <button
          key={item.key}
          type="button"
          className="fx-file-menu__item"
          role="menuitem"
          data-action={item.key}
          onClick={() => {
            item.run()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
