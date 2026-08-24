import { normalizeGitHubRepositoryName, type GitHubRepositoryVisibility } from '@shared/github'
import {
  IPC_CHANNELS,
  type GetGitHubStatusResponse,
  type PublishGitHubRepositoryResponse
} from '@shared/ipc'
import {
  describeGitHubAvailability,
  publishRepositoryToGitHub
} from '../../github/publishRepository'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * github ドメインのハンドラ（Session 3-8-10）。
 *
 * ## 確かめるのは2つだけ
 *
 *   名前     … `normalizeGitHubRepositoryName`（Renderer が入力中に使うのと同じ関数）
 *   公開範囲 … `private` / `public` という閉じた集合の値
 *
 * gh のコマンド名・引数・作業ディレクトリ・実行ファイルは、git ドメインと
 * 同じく**要求に欄そのものが無い**（shared/ipc/contracts/github.ts）。
 * ここが確かめられるのは、届いた2つの値だけになる。
 *
 * ## 同じ規則を2箇所に書かない
 *
 * 名前の形を決めるのは shared の1つの関数で、Renderer は入力中に、Main は
 * 受け取った後に、**同じ関数**を通す（`normalizeGitBranchName` と同じ分担）。
 * 2箇所に書くと、片方だけ直された日に「ボタンは押せるのに Main が弾く」が生まれる。
 *
 * ## 値が通せないことだけを IpcError にする
 *
 * 通せない値は **INVALID_REQUEST**、つまり「Renderer 側の不具合」として返す ──
 * 空・長すぎ・使えない文字の名前では、Renderer 側がそもそもボタンを押せなく
 * してある（renderer/src/git/GitHubPublishForm.tsx）。
 *
 * 逆に、**利用者に起こること**（gh が入っていない・ログインしていない・
 * 同じ名前が既にある・Push が通らなかった）は失敗にせず、応答の `outcome` に
 * 分類として載る（3-8-1 からの線）。
 */

/** 契約上は必ず入っているが、境界の外から来た値として素直に信じない。 */
function field(request: unknown, key: string): unknown {
  return typeof request === 'object' && request !== null
    ? (request as Record<string, unknown>)[key]
    : undefined
}

/**
 * repository 名（shared/github/repositoryName.ts）。
 *
 * ここを通らない文字列が gh の引数になることは無い。**正規化した値を使う**
 * （受け取った生の文字列ではなく）── 前後に空白の付いた形で届いても、
 * gh へ渡るのは揃った1つの形だけになる。
 */
function repositoryNameField(request: unknown): string {
  const name = normalizeGitHubRepositoryName(field(request, 'name'))

  if (name === null) {
    throw invalidRequest('the repository name is empty, too long, or not usable on GitHub.')
  }

  return name
}

/**
 * 公開範囲。
 *
 * **知らない値は既定へ倒さない。** 倒すと、壊れた要求が「private で作られた」
 * という**取り返しのつく方**に落ちて見えるが、その分だけ
 * 「Renderer 側の不具合に気づく手立て」が消える ── 閉じた集合の値は
 * 届いたものをそのまま確かめて、外れていれば断る（`GitDiffGroup` と同じ扱い）。
 */
function visibilityField(request: unknown): GitHubRepositoryVisibility {
  const visibility = field(request, 'visibility')

  if (visibility !== 'private' && visibility !== 'public') {
    throw invalidRequest('the repository visibility is missing or not a known value.')
  }

  return visibility
}

export function registerGitHubHandlers(): void {
  /*
    GitHub CLI の状態（Session 3-8-10）。

    要求は `void` ── ホストもアカウントも指定できない。呼ばれるのは
    公開の面を開いたときだけで、リポジトリの状態の読み直しには
    相乗りさせていない（shared/ipc/contracts/github.ts）。
  */
  handleIpc(IPC_CHANNELS.GITHUB_GET_STATUS, async (): Promise<GetGitHubStatusResponse> => {
    return { availability: await describeGitHubAvailability() }
  })

  handleIpc(
    IPC_CHANNELS.GITHUB_PUBLISH,
    async (request): Promise<PublishGitHubRepositoryResponse> => {
      return await publishRepositoryToGitHub({
        name: repositoryNameField(request),
        visibility: visibilityField(request)
      })
    }
  )
}
