import { useEffect, useRef } from 'react'
import type { CommandId } from './commandIds'
import { useCommands } from './context'
import type { CommandHandler } from './types'

/**
 * この component が生きている間だけ、その command を実行できるようにする
 * （Session 4-7A）。
 *
 * ```tsx
 * useCommand('editor.save', saveActiveTab)
 * ```
 *
 * ## 所有者が自分で名乗る（contribution）
 *
 * 静的な表に handler を書けない理由は commands/types.ts の冒頭にある。
 * ここが受け持つのは**登録と解除の段取りだけ**で、「誰が持つべきか」は
 * 呼ぶ側が決める ── Editor の保存は EditorProvider、パネルの開閉は
 * WorkspaceShell、というように**その状態を持っている場所**が名乗る。
 *
 * 所有者が mount していない command は単に実行できない（`execute` が false を返す）。
 * これは失敗ではなく、「今はその操作ができない」という正しい状態にあたる。
 *
 * ## handler が毎回作り直されても登録し直さない
 *
 * `handler` は呼ぶ側で `useCallback` を通っていないことが多く、素直に依存へ入れると
 * **描画のたびに解除と登録が走る**。ここでは ref に最新を置き、登録するのは
 * 「ref を呼ぶだけの、変わらない関数」1つにしてある ── 登録が走るのは
 * mount と unmount のときだけになる。
 */
export function useCommand(id: CommandId, handler: CommandHandler): void {
  const { register } = useCommands()
  const handlerRef = useRef<CommandHandler>(handler)

  // 依存を書かない（毎回の描画で最新へ差し替える）。登録そのものは下で1回だけ。
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => register(id, () => handlerRef.current()), [register, id])
}
