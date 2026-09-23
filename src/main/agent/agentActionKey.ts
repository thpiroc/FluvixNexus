import { createHash } from 'crypto'
import type { AgentAction } from './agentAction'

/**
 * 「同じ Action」を見分ける鍵（Security Core v1 の STEP9）。
 *
 * 利用者が拒否した・Security Core が deny した Action を、AI がもう一度そのまま提案して
 * きたら、Gate を呼ばずに `repeated-action` で拒む（2026-09-23 確定: 同一 Action の
 * 再試行禁止）。そのための比較の鍵を作る。
 *
 * - 種類と、実行に効く欄をすべて入れる（File Write は本文まで。本文を1文字でも直した提案は
 *   別の Action ── 利用者が「その内容では困る」と拒んだ後の修正版は出してよい）
 * - 材料は「長さ:値」で区切ってから連結する（STEP6 の fingerprint と同じ理由で、
 *   `["a b"]` と `["a", "b"]` が同じ鍵にならない）
 * - SHA-256 の hex にして、**本文そのものは Task の中にも持ち回さない**
 *
 * この鍵は Main のメモリの中だけで使う。Audit にも Renderer にも出さない。
 */
export function agentActionKey(action: AgentAction): string {
  const parts: string[] = [action.type]

  switch (action.type) {
    case 'workspace_status':
      break

    case 'workspace_list':
      parts.push(normalizePath(action.path))
      break

    case 'file_read':
      parts.push(
        normalizePath(action.path),
        String(action.startLine ?? ''),
        String(action.endLine ?? '')
      )
      break

    case 'file_search':
      parts.push(action.query)
      break

    case 'file_write':
      parts.push(normalizePath(action.path), action.content)
      break

    case 'terminal_run':
      parts.push(
        action.command,
        String(action.args.length),
        ...action.args,
        normalizePath(action.cwd)
      )
      break

    case 'complete':
      parts.push(action.answer)
      break
  }

  const hash = createHash('sha256')

  for (const part of parts) {
    hash.update(`${Buffer.byteLength(part, 'utf8')}:`)
    hash.update(part, 'utf8')
  }

  return hash.digest('hex')
}

/**
 * 同じ場所を別の綴りで指しただけの提案を、同じ Action として扱う（`./a.txt` と `a.txt`、
 * `src\a.ts` と `src/a.ts`）。**大文字小文字は揃えない**（Windows 以外では別のファイル）。
 * ここは比較のためだけで、Gate へ渡す綴りは変えない。
 */
function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
}
