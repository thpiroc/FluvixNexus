import { useCallback, useMemo, useRef, type JSX, type ReactNode } from 'react'
import type { CommandId } from './commandIds'
import { CommandContext, type CommandRegistryController } from './context'
import type { CommandHandler } from './types'

/**
 * 実行時の command 表を保持し、Renderer 全体へ配る（Session 4-7A）。
 *
 * ## state を持たない
 *
 * handler の表は `useRef` の `Map` で、React の state ではない。
 * state にすると **command を1つ登録するたびに Renderer 全体が描き直される** ──
 * 登録は所有者が mount / unmount するたびに起こり、パネルを1枚動かしただけでも走る。
 *
 * 表を読むのは打鍵が届いた瞬間だけで、描画には1つも使わない
 * （`editor/useEditorSession.ts` が Monaco の Model を state にしないのと同じ判断）。
 *
 * そのため `CommandRegistryController` は**一度作ったら変わらない**。
 * 配る値が変わらないので、この Provider が再描画を誘うことは無い。
 *
 * ## 置き場所
 *
 * App.tsx の上の方（LanguageProvider の内側・UnsavedChangesProvider の外側）。
 * この器自身は何にも依存しない（ただの Map）ので外側に置ける一方、
 * **command を登録する側（EditorProvider・WorkspaceShell）より外**である必要がある。
 *
 * 打鍵を受ける側（KeybindingProvider）は逆に一番内側に置く ── あちらは
 * Workspace と Editor の状態を読むため。
 */
export function CommandProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const handlersRef = useRef<Map<CommandId, CommandHandler>>(new Map())

  const register = useCallback((id: CommandId, handler: CommandHandler): (() => void) => {
    const handlers = handlersRef.current

    if (handlers.has(id)) {
      /*
        後勝ちにしない理由は context.ts の `register` を参照。
        投げるのは「所有者が2つある」ことの通知で、握り潰す種類の失敗ではない。
      */
      throw new Error(`Command "${id}" is already registered. A command has exactly one owner.`)
    }

    handlers.set(id, handler)

    return () => {
      /*
        自分が載せたものだけを外す。解除が遅れて別の所有者が既に載せている
        場合（mount の順序が入れ替わったとき）に、他人の handler を消さないため。
      */
      if (handlers.get(id) === handler) {
        handlers.delete(id)
      }
    }
  }, [])

  const execute = useCallback((id: CommandId): boolean => {
    const handler = handlersRef.current.get(id)

    if (handler === undefined) {
      // 所有者が居ない（そのパネルが閉じている等）。**失敗ではない。**
      return false
    }

    handler()

    return true
  }, [])

  const isRegistered = useCallback((id: CommandId): boolean => handlersRef.current.has(id), [])

  const controller = useMemo<CommandRegistryController>(
    () => ({ register, execute, isRegistered }),
    [register, execute, isRegistered]
  )

  return <CommandContext.Provider value={controller}>{children}</CommandContext.Provider>
}
