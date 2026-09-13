import {
  DEBUG_PROFILE_ENV_MAX_COUNT,
  DEBUG_PROFILE_ENV_NAME_MAX_LENGTH,
  DEBUG_PROFILE_ENV_VALUE_MAX_LENGTH,
  type DebugProfileInvalidReason
} from '@shared/debug'

/**
 * 環境変数の方針（Session 6-10。Electron / fs 非依存・テスト対象）。
 *
 * docs/ARCHITECTURE.md §20.9「環境変数」。**STEP 6 で唯一「欄を作らない」ではなく
 * 「形を検査する」を選んだ場所**になる ── `env` を丸ごと落とすとデバッグが道具として
 * 成立しないため、欄を残す代わりに通してよい形を決める関数を対にして置く
 * （main/git/gitPathspec.ts が pathspec に対して採ったのと同じ形）。
 *
 * ## 断る場所は2つ
 *
 * ```
 * 保存時 … main/debug/profileValidation.ts（作成 / 更新の要求）
 * 解決時 … main/debug/profileResolver.ts（起動の直前にもう一度）
 * ```
 *
 * 保存ファイルは利用者が手で編集できる場所にあり、この表が後の版で増えることもある
 * ── 保存時に通ったことを、起動してよい理由にしない。
 *
 * ## 2つの環境を混ぜない
 *
 * ```
 * profile の env      … launch request の `env` にだけ入る（デバッグ対象のプログラムの環境）
 * adapter プロセスの env … 親（Main）の環境から Electron 由来の2つを落としたもの
 * ```
 *
 * **profile の env を adapter のプロセスへは渡さない。** 渡すと、利用者が書いた値で
 * adapter 自身（何のプログラムが動くか）が変わる経路になる（§20.1 の線の向こう側）。
 */

/** 名前の形（§20.9）。 */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 「何が読み込まれるか」を変える名前（§20.9 で確定した表）。
 *
 * どれも「プログラムの振る舞いを変える」ものではなく「**プログラムより先に何かを
 * 読み込ませる**」もの。増やすときは設計（§20.9）へ戻る。
 *
 * 比べるときは大文字に揃える ── Windows の環境変数は大文字小文字を区別しないため、
 * `Path` や `node_options` も同じ変数を指す。
 */
export const DENIED_DEBUG_PROFILE_ENV_NAMES: readonly string[] = [
  'PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'PYTHONPATH',
  'DOTNET_STARTUP_HOOKS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES'
]

const DENIED_NAMES = new Set(DENIED_DEBUG_PROFILE_ENV_NAMES)

export type DebugProfileEnvironmentCheck =
  | { readonly status: 'ok'; readonly env: Readonly<Record<string, string>> }
  | {
      readonly status: 'rejected'
      readonly reason: Extract<
        DebugProfileInvalidReason,
        | 'invalid-type'
        | 'too-many'
        | 'too-long'
        | 'contains-nul'
        | 'invalid-name'
        | 'denied-name'
        | 'duplicate-name'
      >
    }

/** その名前が、読み込まれるものを差し替える名前か（大文字小文字を区別しない）。 */
export function isDeniedDebugProfileEnvironmentName(name: string): boolean {
  return DENIED_NAMES.has(name.toUpperCase())
}

/**
 * profile の `env` を検査し、通してよい形の新しいオブジェクトを返す。
 *
 * 断る順番は「入れ物 → 件数 → 名前の形 → 禁じた名前 → 重複 → 値」。
 * 値は**加工しない**（trim しない・展開しない）── 利用者が書いた文字列がそのまま届く。
 *
 * 戻り値は `Object.fromEntries` で作り直す。受け取ったオブジェクトをそのまま返すと、
 * 契約に無い prototype や getter まで保存 / 起動の経路へ持ち込むことになる。
 */
export function checkDebugProfileEnvironment(raw: unknown): DebugProfileEnvironmentCheck {
  if (!isPlainRecord(raw)) {
    return { status: 'rejected', reason: 'invalid-type' }
  }

  const entries = Object.entries(raw)

  if (entries.length > DEBUG_PROFILE_ENV_MAX_COUNT) {
    return { status: 'rejected', reason: 'too-many' }
  }

  const seen = new Set<string>()

  for (const [name, value] of entries) {
    if (name.length > DEBUG_PROFILE_ENV_NAME_MAX_LENGTH || !ENV_NAME_PATTERN.test(name)) {
      return { status: 'rejected', reason: 'invalid-name' }
    }

    if (isDeniedDebugProfileEnvironmentName(name)) {
      return { status: 'rejected', reason: 'denied-name' }
    }

    const key = name.toUpperCase()

    if (seen.has(key)) {
      return { status: 'rejected', reason: 'duplicate-name' }
    }

    seen.add(key)

    if (typeof value !== 'string') {
      return { status: 'rejected', reason: 'invalid-type' }
    }

    if (value.length > DEBUG_PROFILE_ENV_VALUE_MAX_LENGTH) {
      return { status: 'rejected', reason: 'too-long' }
    }

    if (value.includes('\0')) {
      return { status: 'rejected', reason: 'contains-nul' }
    }
  }

  return { status: 'ok', env: Object.fromEntries(entries) as Record<string, string> }
}

/**
 * adapter のプロセスへ渡す環境。
 *
 * 親（Main）の環境から、**このアプリが Electron であることに由来する2つ**を落とす
 * （main/lsp/languageServerEnvironment.ts と同じ判断）。`ELECTRON_RUN_AS_NODE` が
 * 残ると Node で書かれた adapter の起動経路が変わり、`NODE_OPTIONS` はこのアプリの
 * ための起動オプションが無関係な node へ効く。
 *
 * profile の `env` はここに混ぜない（このファイルの冒頭）。
 */
export function createDebugAdapterProcessEnvironment(
  parentEnv: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}

  for (const [name, value] of Object.entries(parentEnv)) {
    const upper = name.toUpperCase()

    if (upper === 'ELECTRON_RUN_AS_NODE' || upper === 'NODE_OPTIONS') {
      continue
    }

    env[name] = value
  }

  return env
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype: unknown = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
