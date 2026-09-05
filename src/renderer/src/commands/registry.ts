import { COMMAND_IDS, type CommandId } from './commandIds'
import type { CommandDescriptor } from './types'

/**
 * Command Registry（Session 4-7A）。
 *
 * `workspace/panels/registry.ts`（Panel Registry）と同じ形にしてある。
 *
 *   - `Record<CommandId, CommandDescriptor>` なので**登録漏れは型エラー**になる
 *   - **同じ id を2度書けない**（object の key として重複できない）
 *   - 引くのは常にこの表を通す
 *
 * ## duplicate command id をどう潰しているか
 *
 * 2段構えになっている。
 *
 * | 段            | 潰すもの                                             |
 * | ------------- | ---------------------------------------------------- |
 * | この表        | 定義の重複（同じ key を2度書けない・書き漏らすと型エラー） |
 * | CommandProvider | **登録の重複**（同じ id に2つの handler が付く）── 例外を投げる |
 *
 * 前者は静的に、後者は実行時にしか分からない ── descriptor は表だが handler は
 * 所有者が動的に付けるものなので、「Git パネルが2枚開いていて両方が
 * `git.commit` を登録した」は型では防げない。
 *
 * ただし Session 4-7B で分かったのは、**その形は今の Shell では作れない**という
 * ことになる ── パネルは1つの id につき1枚しか存在せず、しかもタブ群では
 * 前面のものしか mount されない（`workspace/shell/PanelGroup.tsx`）。
 * それでも CommandProvider の例外を外さないのは、これが「所有者は1つ」という
 * 約束そのものだからで、守られていることと確かめないことは別にあたる。
 *
 * ## 並び
 *
 * `COMMAND_IDS` の並びが正本で、`listCommands()` はその順に返す。
 * この表の見た目の順序には依存しない ── 将来 Settings の一覧に出すとき、
 * 並びが「表をどう書いたか」で決まっていると、行を足す場所で見え方が変わる。
 */
const COMMAND_REGISTRY: Readonly<Record<CommandId, CommandDescriptor>> = {
  'workspace.openFolder': {
    id: 'workspace.openFolder',
    category: 'workspace',
    title: 'Open Folder'
  },
  'workspace.closeFolder': {
    id: 'workspace.closeFolder',
    category: 'workspace',
    title: 'Close Workspace'
  },
  'editor.save': {
    id: 'editor.save',
    category: 'editor',
    title: 'Save'
  },
  'editor.saveAs': {
    id: 'editor.saveAs',
    category: 'editor',
    title: 'Save As'
  },
  'view.togglePanel.files': {
    id: 'view.togglePanel.files',
    category: 'view',
    title: 'Toggle Files Panel'
  },
  'view.togglePanel.editor': {
    id: 'view.togglePanel.editor',
    category: 'view',
    title: 'Toggle Editor Panel'
  },
  'view.togglePanel.terminal': {
    id: 'view.togglePanel.terminal',
    category: 'view',
    title: 'Toggle Terminal Panel'
  },
  'view.togglePanel.git': {
    id: 'view.togglePanel.git',
    category: 'view',
    title: 'Toggle Git Panel'
  },
  'view.resetLayout': {
    id: 'view.resetLayout',
    category: 'view',
    title: 'Reset Layout'
  },
  'settings.open': {
    id: 'settings.open',
    category: 'settings',
    title: 'Open Settings'
  },
  'settings.close': {
    id: 'settings.close',
    category: 'settings',
    title: 'Close Settings'
  },
  'git.refresh': {
    id: 'git.refresh',
    category: 'git',
    title: 'Refresh Git Status'
  },
  'git.commit': {
    id: 'git.commit',
    category: 'git',
    title: 'Commit'
  },
  'git.push': {
    id: 'git.push',
    category: 'git',
    title: 'Push'
  },
  'git.pull': {
    id: 'git.pull',
    category: 'git',
    title: 'Pull'
  },
  'git.fetch': {
    id: 'git.fetch',
    category: 'git',
    title: 'Fetch'
  },
  'git.openHistory': {
    id: 'git.openHistory',
    category: 'git',
    title: 'Open Commit History'
  },
  'git.stashPush': {
    /*
      **名前は `stashPush` だが、繋いであるのは「退避の面を開く」になる**
      （git/GitCommands.tsx）。title もそう書いてある。

      退避そのものを打鍵1つに繋がないのは、`stashPush` が確認を1つも挟まずに
      作業ツリー全体を退避するため ── しかも結末（`GitOperationOutcome`）は
      面の中で読ませる設計になっており（useGitRepository.ts の `stashPush`）、
      面を閉じたまま実行すると、何が起きたかがパネル下部の1行にしか出ない。
      戻せない操作は確認の形と一緒に設計する、という 3-8-9 からの線に従う。

      id を `git.openStash` にしなかったのは、**id を後から変えられない**ため
      （commandIds.ts の「一度決めた id は変えない」）。将来「確認を出してから
      退避する」形に育てるとき、id はこのままで handler だけが変わる ──
      逆に `openStash` と名乗っておくと、そのとき名前を変えることになり、
      利用者が設定した打鍵が静かに効かなくなる。
    */
    id: 'git.stashPush',
    category: 'git',
    title: 'Stash Working Tree…'
  },
  'files.refresh': {
    id: 'files.refresh',
    category: 'files',
    title: 'Reload File Tree'
  },
  'files.search.byName': {
    id: 'files.search.byName',
    category: 'files',
    title: 'Search by File Name'
  },
  'files.search.byContent': {
    id: 'files.search.byContent',
    category: 'files',
    title: 'Search File Contents'
  }
}

/** CommandId から定義を引く。未登録の id は型の時点で存在しないため、失敗しない。 */
export function getCommandDescriptor(id: CommandId): CommandDescriptor {
  return COMMAND_REGISTRY[id]
}

/**
 * 登録されている command をすべて返す（`COMMAND_IDS` の順）。
 *
 * 「今 handler が付いているか」は見ない ── 一覧に出すのは
 * **アプリが持つ操作の全体**であって、その瞬間に実行できるものではない
 * （実行できるかは CommandProvider が知っている）。
 */
export function listCommands(): readonly CommandDescriptor[] {
  return COMMAND_IDS.map((id) => COMMAND_REGISTRY[id])
}
