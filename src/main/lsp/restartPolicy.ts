/**
 * 落ちたサーバを立て直すかどうかを決める（Electron / child_process 非依存・テスト対象）。
 *
 * ## 立て直しが要る理由
 *
 * Language Server は落ちる。大きなファイルを開いた・メモリを使い切った・
 * サーバ自身の不具合、どれも実際に起きる。落ちたままにすると、利用者に見えるのは
 * 「昨日まで出ていた補完が今日は出ない」だけになり、原因も直し方も分からない。
 *
 * ## 際限なく立て直さない理由
 *
 * 起動した直後に必ず落ちる状態（サーバの版が壊れている・依存が足りない）では、
 * 立て直しは**無限に続く**。1秒ごとにプロセスを起動し続けるアプリは、
 * その PC の他の作業まで巻き込む。
 *
 * そこで「窓の中で数える」形にする。
 *
 * ```
 * 窓の中の異常終了が上限以下 … 間を置いて立て直す（間は回数とともに伸びる）
 * 上限を超えた               … 諦める。その言語だけが使えない状態で止まる
 * ```
 *
 * 窓を持つのは、**時間が経ってからの1回**を数え直さないため。朝と夕方に
 * 1回ずつ落ちたサーバは「繰り返し落ちている」ではない。
 *
 * ## 間を置く理由
 *
 * 落ちた直後に立て直すと、落ちる原因（開いていたファイル・使い切ったメモリ）が
 * まだそのままであることが多い。回数とともに間を伸ばすのは、
 * 一時的な原因なら早く戻り、続く原因なら早く諦めるため。
 *
 * ## 時計を引数で受け取る
 *
 * `Date.now()` を中で読まない。呼び出し側が渡すことで、この判断をテストで
 * 固定できる（main/git/gitChangeSchedule.ts と同じ分け方）。
 */

/**
 * 数える窓（ミリ秒）。
 *
 * 3分は「同じ原因で落ち続けている」と「たまたま別の日に落ちた」を分ける境目にあたる。
 */
export const LANGUAGE_SERVER_RESTART_WINDOW_MS = 3 * 60_000

/**
 * 窓の中で立て直す上限の回数。
 *
 * これを超えたら諦める。3回まで試して駄目なものは、間を置いても駄目になる
 * （直すのはこちらではなく、サーバを入れ直す利用者の側）。
 */
export const LANGUAGE_SERVER_MAX_RESTARTS = 3

/**
 * 立て直しまでの間（ミリ秒）。何回目かで引く。
 *
 * 1回目を 1 秒にしてあるのは、**利用者が待てる長さ**だから ── ファイルを
 * 開いた直後に落ちた場合、ここが長いと「補完が出ないエディタ」に見える。
 * 表より多く落ちることは無い（上限で諦めるため）が、末尾で頭打ちにしてある。
 */
export const LANGUAGE_SERVER_RESTART_DELAYS_MS: readonly number[] = [1_000, 4_000, 10_000]

/** 立て直すかどうかの結論。 */
export type LanguageServerRestartDecision =
  | {
      readonly status: 'restart'
      /** これだけ待ってから立て直す。 */
      readonly delayMs: number
      /** 窓の中で何回目の立て直しか（1 始まり。ログに出す）。 */
      readonly attempt: number
      /** 窓の中に残った異常終了。呼び出し側が控え、次の判断へそのまま渡す。 */
      readonly history: readonly number[]
    }
  | {
      readonly status: 'give-up'
      /** 窓の中で何回落ちたか。 */
      readonly attempts: number
      readonly history: readonly number[]
    }

/**
 * 異常終了を1件受け取って、立て直すかどうかを決める。
 *
 * `history` には**それまでの異常終了の時刻**を渡す（今回のぶんは含めない。
 * この関数が足す）。返ってきた `history` をそのまま次回へ渡せば、
 * 窓から出たものは落とされている ── 呼び出し側が古いものを掃除する必要は無い。
 *
 * **利用者やアプリの都合で終わらせた場合はここへ来ない。** 立て直しの対象は
 * 「頼んでいないのに終わったもの」だけで、その判断は呼び出し側が持つ
 * （main/lsp/languageServers.ts）。
 */
export function decideLanguageServerRestart(
  history: readonly number[],
  now: number
): LanguageServerRestartDecision {
  const since = now - LANGUAGE_SERVER_RESTART_WINDOW_MS
  const recent = [...history.filter((at) => at > since), now]

  if (recent.length > LANGUAGE_SERVER_MAX_RESTARTS) {
    return { status: 'give-up', attempts: recent.length, history: recent }
  }

  const attempt = recent.length
  const delays = LANGUAGE_SERVER_RESTART_DELAYS_MS
  /*
    表より多く落ちることは無いが、上限と表の長さが食い違ったときに
    `undefined` を待ち時間として使わないよう、末尾で頭打ちにする。
  */
  const delayMs = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0

  return { status: 'restart', delayMs, attempt, history: recent }
}
