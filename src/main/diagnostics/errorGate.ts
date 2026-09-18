/**
 * 1回の起動で記録するエラーの数を抑える（Electron 非依存・テスト対象）。
 *
 * 同じ例外が描画のたびに投げられる・GPU プロセスが落ちては立ち直るを繰り返す、といった
 * ときに、毎回ファイルを書き直さないため。
 *
 * ```
 * 同じもの（種類・名前・message が同じ）… 1回だけ記録する
 * 違うもの                             … 1回の起動あたり maxPerSession 件まで
 * ```
 *
 * 保存ファイルの上限（errorRecords.ts）とは別の役目 ── あちらは「残る量」、
 * こちらは「書く回数」を抑える。
 */

export const ERROR_GATE_MAX_PER_SESSION = 30

export interface ErrorGate {
  /** 記録してよければ true（呼んだ時点で数に入る）。 */
  readonly admit: (fingerprint: string) => boolean
}

export function createErrorGate(maxPerSession: number = ERROR_GATE_MAX_PER_SESSION): ErrorGate {
  const seen = new Set<string>()

  return {
    admit: (fingerprint) => {
      if (seen.has(fingerprint) || seen.size >= maxPerSession) {
        return false
      }

      seen.add(fingerprint)
      return true
    }
  }
}
