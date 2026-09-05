import { createContext, useContext } from 'react'
import type { CommandId } from './commandIds'
import type { CommandHandler } from './types'

/**
 * 実行時の command 表（Session 4-7A）。
 *
 * descriptor（registry.ts）が「そういう操作がある」を述べるのに対し、こちらは
 * **「今それを実行できるか」**だけを持つ。中身は `Map<CommandId, CommandHandler>` で、
 * 所有者が mount している間だけ自分の handler を載せる。
 */
export interface CommandRegistryController {
  /**
   * handler を登録する。返り値を呼ぶと外れる。
   *
   * **同じ id に2つ登録すると例外を投げる。** 後勝ちにしないのは、そうすると
   * 「どちらが効いているか分からないまま片方が黙って死ぬ」ためで、これは
   * 所有者が2つある（＝設計の間違い）ことを意味する。Panel Registry で
   * 登録漏れが型エラーになるのと同じ厳しさを、実行時にも掛ける。
   *
   * React の StrictMode は effect を mount → unmount → mount と二重に走らせるが、
   * 間に cleanup（＝解除）が挟まるため、これには当たらない。
   */
  readonly register: (id: CommandId, handler: CommandHandler) => () => void

  /**
   * command を実行する。**実行できたときだけ true。**
   *
   * 打鍵の側がこの返り値で `preventDefault()` するかを決める（keybindings/
   * KeybindingProvider.tsx）── 所有者が居ない command のために
   * ブラウザの既定を止めてしまうと、割り当てが効かないうえに何も起きない、
   * という一番分かりにくい状態になる。
   */
  readonly execute: (id: CommandId) => boolean

  /** 今 handler が付いているか（将来の Settings / Command Palette の活性判定）。 */
  readonly isRegistered: (id: CommandId) => boolean
}

export const CommandContext = createContext<CommandRegistryController | null>(null)

export function useCommands(): CommandRegistryController {
  const controller = useContext(CommandContext)

  if (controller === null) {
    throw new Error('useCommands must be used inside <CommandProvider>.')
  }

  return controller
}
