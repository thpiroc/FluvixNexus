import {
  DEBUG_PROFILE_NAME_MAX_LENGTH,
  DEBUG_PROFILE_PROGRAM_ARG_MAX_LENGTH,
  DEBUG_PROFILE_PROGRAM_ARGS_MAX_COUNT,
  isDebugProfileLanguage,
  type DebugProfileDraft,
  type DebugProfileField,
  type DebugProfileInvalidReason
} from '@shared/debug'
import { normalizeWorkspaceRelativePath } from '../files/workspacePath'
import { checkDebugProfileEnvironment } from './environmentPolicy'

/**
 * Renderer から届いた Debug Profile の欄を検証する（Session 6-10。Electron / fs 非依存・テスト対象）。
 *
 * 見るのは**欄ごとの形**で、Workspace を知らない。
 *
 * ```
 * ここ                   … 型・長さ・件数・NUL・言語の集合・相対位置の文字列（1段目）・env の方針
 * main/debug/programPath.ts … root と繋いだ結果と、実体（realpath）が Workspace の中か（2段目）
 * ```
 *
 * ## 7欄以外を持ち込まない
 *
 * 戻り値は**6欄から作り直した新しいオブジェクト**になる（`profileId` は Main が付ける）。
 * 要求に `cwd` / `runtimeExecutable` / `adapter` / `console` / `preLaunchTask` が
 * 載っていても、読む箇所が無いので保存にも起動にも届かない
 * ── 「弾く」ではなく「欄を作らない」で閉じている部分にあたる（§20.3）。
 *
 * ## 値の意味を変えない
 *
 * 名前・引数・環境変数の値は trim しない。空白の有無が意味を持つ引数はふつうにある。
 * 相対位置だけは Files と同じ正規化（区切りを `/` に揃える）を通した形で持つ。
 */

export type DebugProfileDraftCheck =
  | { readonly status: 'ok'; readonly draft: DebugProfileDraft }
  | {
      readonly status: 'invalid'
      readonly field: DebugProfileField
      readonly reason: DebugProfileInvalidReason
    }

export function validateDebugProfileDraft(raw: unknown): DebugProfileDraftCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid('name', 'invalid-type')
  }

  const { name, language, programRelativePath, programArgs, env, stopOnEntry } = raw as Record<
    string,
    unknown
  >

  // 名前 ── 表示だけに使う。空白だけは「名前を付けていない」と読む。
  if (typeof name !== 'string') {
    return invalid('name', 'invalid-type')
  }

  if (name.trim().length === 0) {
    return invalid('name', 'empty')
  }

  if (name.length > DEBUG_PROFILE_NAME_MAX_LENGTH) {
    return invalid('name', 'too-long')
  }

  if (name.includes('\0')) {
    return invalid('name', 'contains-nul')
  }

  // 言語 ── 閉じた集合。ここから adapter が決まる。
  if (typeof language !== 'string') {
    return invalid('language', 'invalid-type')
  }

  if (!isDebugProfileLanguage(language)) {
    return invalid('language', 'unsupported')
  }

  // 対象のプログラム ── 1段目（パス文字列）。Files / Breakpoint と同じ関数を通す。
  if (typeof programRelativePath !== 'string') {
    return invalid('programRelativePath', 'invalid-type')
  }

  const relativePath = normalizeWorkspaceRelativePath(programRelativePath)

  if (relativePath === null) {
    return invalid('programRelativePath', 'invalid-path')
  }

  if (relativePath === '') {
    return invalid('programRelativePath', 'empty')
  }

  // プログラムへの引数 ── 語の分割も展開もしないので、1語ずつ形だけを見る。
  if (!Array.isArray(programArgs)) {
    return invalid('programArgs', 'invalid-type')
  }

  if (programArgs.length > DEBUG_PROFILE_PROGRAM_ARGS_MAX_COUNT) {
    return invalid('programArgs', 'too-many')
  }

  for (const arg of programArgs) {
    if (typeof arg !== 'string') {
      return invalid('programArgs', 'invalid-type')
    }

    if (arg.length > DEBUG_PROFILE_PROGRAM_ARG_MAX_LENGTH) {
      return invalid('programArgs', 'too-long')
    }

    if (arg.includes('\0')) {
      return invalid('programArgs', 'contains-nul')
    }
  }

  // 環境変数 ── 方針は environmentPolicy.ts に1つだけ置く。
  const environment = checkDebugProfileEnvironment(env)

  if (environment.status === 'rejected') {
    return invalid('env', environment.reason)
  }

  if (typeof stopOnEntry !== 'boolean') {
    return invalid('stopOnEntry', 'invalid-type')
  }

  return {
    status: 'ok',
    draft: {
      name,
      language,
      programRelativePath: relativePath,
      programArgs: [...(programArgs as string[])],
      env: environment.env,
      stopOnEntry
    }
  }
}

function invalid(
  field: DebugProfileField,
  reason: DebugProfileInvalidReason
): DebugProfileDraftCheck {
  return { status: 'invalid', field, reason }
}
