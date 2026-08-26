import { FILES_BINARY_SNIFF_BYTES, FILES_FILE_MAX_BYTES } from '@shared/files'
import type { GitDiffUnavailableReason } from '@shared/git'
import { createLogger } from '../logger'
import { isGitObjectName, readBlobByteLength } from './gitBlob'
import { showBlobContent, showBlobSize } from './gitCommands'
import { runGit } from './runGit'

/**
 * 差分の「片側」を、git の object から読む（Session 3-8-9 / 3-8-12 で切り出し）。
 *
 * ## なぜ独立した1枚にしたか
 *
 * 3-8-9 の時点では、object から中身を読むのは gitDiff.ts の中の関数1つだった
 * （相手が作業ツリーと index と HEAD の3つしか無かった）。3-8-12 で
 * **commit の中の tree** が4つめの相手として増える ── そこで同じ読み方を
 * もう1つ書くと、上限もバイナリの判定も改行の均し方も2箇所に生まれる。
 *
 * ここを1つにしてあることで、次の4つが**どの差分でも必ず同じ**になる。
 *
 *   1. 大きさを**先に**訊く（読み切ってから捨てない）
 *   2. 上限は Editor で開ける上限と同じ値（`FILES_FILE_MAX_BYTES`）
 *   3. バイナリの判定は files ドメインと同じ基準（先頭の NUL）
 *   4. 改行は LF に均す（`core.autocrlf` の環境で全行が変更として出るのを避ける）
 *
 * ## 引数に載るのは、git 自身が答えた object 名だけ
 *
 * `readGitBlobSide` が受け取る文字列は、その手前の1回で git が返したもの
 * （`ls-files --stage` / `ls-tree` / `diff-tree --raw`）になる。それでも
 * 引数に載る直前でもう一度形を確かめる ── 3-8-3 の pathspec で
 * `--` と `--literal-pathspecs` を両方掛けたのと同じ二重の備えで、
 * 「**外から来た値が引数に入る経路が形の上で存在しない**」と言い切るための1枚になる。
 */

const log = createLogger('git')

/** 片側を読んだ結果（中身が取れたか、取れなかった理由か）。 */
export type GitDiffSideOutcome =
  | { readonly status: 'ok'; readonly content: string }
  | { readonly status: 'unavailable'; readonly reason: GitDiffUnavailableReason }

/** 比べる相手が居ない側（追加 / 未追跡 / 初回 commit 前 / 削除の右）。 */
export const EMPTY_GIT_DIFF_SIDE: GitDiffSideOutcome = { status: 'ok', content: '' }

/**
 * object の中身を読む。
 *
 * **大きさを先に訊く。** 上限を超えるものを `cat-file blob` で読むと、
 * 読み切ってから捨てることになる（main/files/readWorkspaceFile.ts と同じ順序）。
 */
export async function readGitBlobSide(object: string): Promise<GitDiffSideOutcome> {
  /*
    git 自身が答えた object 名しか来ないが、引数に載る直前でもう一度確かめる
    （3-8-3 で pathspec に二重の備えを置いたのと同じ形。gitBlob.ts）。
  */
  if (!isGitObjectName(object)) {
    log.warn('git returned an object name that could not be used as an argument.')
    return { status: 'unavailable', reason: 'unreadable' }
  }

  const sized = await runGit(showBlobSize(object))

  if (sized.status !== 'completed') {
    return { status: 'unavailable', reason: toGitRunFailureReason(sized.status) }
  }

  if (sized.exitCode !== 0) {
    return { status: 'unavailable', reason: 'failed' }
  }

  const byteLength = readBlobByteLength(sized.stdout)

  if (byteLength === null) {
    return { status: 'unavailable', reason: 'unreadable' }
  }

  if (byteLength > FILES_FILE_MAX_BYTES) {
    return { status: 'unavailable', reason: 'too-large' }
  }

  const read = await runGit(showBlobContent(object))

  if (read.status !== 'completed') {
    return { status: 'unavailable', reason: toGitRunFailureReason(read.status) }
  }

  if (read.exitCode !== 0) {
    return { status: 'unavailable', reason: 'failed' }
  }

  if (looksBinaryText(read.stdout)) {
    return { status: 'unavailable', reason: 'binary' }
  }

  return { status: 'ok', content: normalizeGitLineEndings(read.stdout) }
}

export function toGitRunFailureReason(
  status: 'no-workspace' | 'git-unavailable' | 'failed'
): GitDiffUnavailableReason {
  return status === 'failed' ? 'failed' : 'not-ready'
}

/**
 * blob をバイナリとみなすか。
 *
 * 判断の基準は files ドメインとまったく同じ（先頭 `FILES_BINARY_SNIFF_BYTES` に
 * NUL があるか。main/files/fileContent.ts）。違うのは見る対象だけで、
 * こちらは git の標準出力を UTF-8 として読んだ後の文字列にあたる ──
 * **NUL は復号を通っても NUL のまま残る**ため、同じ判断がそのまま当たる。
 *
 * バイト数ではなく文字数で見ているぶん、マルチバイト文字が続くと実際より
 * 手前までしか見ないことになるが、**先頭に NUL を持たないバイナリを
 * テキストとして出す**のは git 自身も同じ（git も先頭の一部だけを見る）。
 */
export function looksBinaryText(content: string): boolean {
  return content.slice(0, FILES_BINARY_SNIFF_BYTES).includes('\0')
}

/**
 * 改行を LF に均す。
 *
 * Windows の git は checkout のときに改行を CRLF へ直す（`core.autocrlf`）。
 * index の中身（LF）と作業ツリーの中身（CRLF）をそのまま並べると、
 * **1行も書き換えていないファイルが全行変更として出る。**
 *
 * git 自身は正規化した後の中身で「変わったかどうか」を決めているので、
 * 一覧に出ている判断と揃えるにはこちらも均した中身で見せる必要がある
 * （理由の全文は shared/git/diff.ts）。
 *
 * commit どうしの差分（3-8-12）では両側とも object から読むため、そもそも
 * CRLF は入らない ── それでも同じ関数を通しているのは、**中身を作る道が
 * 1本しか無い**ことを保つためになる。
 */
export function normalizeGitLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n')
}
