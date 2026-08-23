import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentPlatform } from '../platform'
import { showWorkingTreeStatus } from './gitCommands'
import { createGitEnvironment } from './gitEnvironment'
import { resolveGitExecutable } from './gitExecutable'
import { parseGitStatus, type GitStatusReading } from './gitStatusOutput'

/**
 * 本物の git に対する読み取りの検証（Session 3-8-2）。
 *
 * ## なぜ実物を使うか
 *
 * gitStatusOutput.test.ts は「この文字列をこう読む」を固定するが、それだけでは
 * **git が本当にその文字列を出すのか**は誰も確かめていない。渡している引数
 * （`--porcelain=v2 --branch -z --untracked-files=normal`）の組み合わせが
 * どんな出力になるかは実装ではなく git が決めるため、写しを相手にすると
 * その答えを自分で書くことになる ── searchWorkspaceFiles.test.ts が
 * 実ディスクを使うのと同じ理由にあたる（DEVELOPMENT.md）。
 *
 * とくに実物でしか確かめられないのが次の3つになる。
 *
 *   - `-z` を渡しても rename が1件として返ること（`R100 new\0old`）
 *   - 未追跡のフォルダが**中身ではなくフォルダ1件**として返ること
 *   - 日本語のファイル名が引用符で包まれずに返ること
 *
 * ## 実行するのは gitCommands.ts の引数そのもの
 *
 * ここで自分用のコマンドを組み立てると、確かめているものが本番と別になる。
 * `showWorkingTreeStatus()` をそのまま渡し、git 本体も `resolveGitExecutable`
 * （本番と同じ解決）で辿る。
 *
 * git が入っていない環境ではこの塊ごと飛ばす（mutateWorkspaceEntry.test.ts が
 * ジャンクションを作れない環境で飛ばすのと同じ扱い）。
 */

const gitExecutable = resolveGitExecutable(currentPlatform, process.env, existsSync)
const describeWithGit = gitExecutable === null ? describe.skip : describe

let root: string

/** リポジトリの中で git を1回動かす（テスト自身の準備用）。 */
function git(...args: readonly string[]): string {
  return execFileSync(gitExecutable as string, [...args], {
    cwd: root,
    env: createGitEnvironment(process.env),
    encoding: 'utf8',
    windowsHide: true
  })
}

/** 本番と同じ引数で status を読む。 */
function readStatus(): GitStatusReading {
  const stdout = execFileSync(gitExecutable as string, [...showWorkingTreeStatus().args], {
    cwd: root,
    env: createGitEnvironment(process.env),
    encoding: 'utf8',
    windowsHide: true
  })

  const reading = parseGitStatus(stdout)

  // 読めないこと自体が不合格。null のまま先へ進めると、確かめたい中身が消える。
  expect(reading, `読めなかった出力: ${JSON.stringify(stdout)}`).not.toBeNull()

  return reading as GitStatusReading
}

/** 変更を「位置と種類」の組にして、並びごと確かめられる形にする。 */
function pairs(changes: GitStatusReading['changes'][keyof GitStatusReading['changes']]): string[] {
  return changes.map((change) =>
    change.originalPath === null
      ? `${change.kind} ${change.relativePath}`
      : `${change.kind} ${change.originalPath} -> ${change.relativePath}`
  )
}

function writeFile(relativePath: string, content: string): void {
  writeFileSync(join(root, relativePath), content, 'utf8')
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-status-')))

  git('init', '--quiet', '--initial-branch=main', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Fluvix Test')
  // 改行の変換で「変更していないのに modified」が出ないようにする。
  git('config', 'core.autocrlf', 'false')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
})

describeWithGit('本物の git の status を読む', () => {
  it('まだ commit が1つも無いリポジトリで、未追跡と staged を見分ける', () => {
    writeFile('untracked.txt', 'x\n')
    writeFile('staged.txt', 'y\n')
    git('add', 'staged.txt')

    const reading = readStatus()

    expect(pairs(reading.changes.staged)).toEqual(['added staged.txt'])
    expect(pairs(reading.changes.untracked)).toEqual(['untracked untracked.txt'])
    expect(reading.upstream).toBeNull()
  })

  it('clean なリポジトリではどのグループも空になる', () => {
    writeFile('a.txt', 'a\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')

    const reading = readStatus()

    expect(reading.changes).toEqual({ staged: [], unstaged: [], untracked: [], conflicted: [] })
  })

  it('通常の変更・staged・その両方・削除・未追跡を同時に読み分ける', () => {
    writeFile('both.txt', 'base\n')
    writeFile('worktree.txt', 'base\n')
    writeFile('index.txt', 'base\n')
    writeFile('removed.txt', 'base\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')

    writeFile('worktree.txt', 'changed\n')
    writeFile('index.txt', 'changed\n')
    git('add', 'index.txt')
    writeFile('both.txt', 'staged\n')
    git('add', 'both.txt')
    writeFile('both.txt', 'and then changed again\n')
    rmSync(join(root, 'removed.txt'))
    writeFile('new.txt', 'new\n')

    const reading = readStatus()

    expect(pairs(reading.changes.staged)).toEqual(['modified both.txt', 'modified index.txt'])
    expect(pairs(reading.changes.unstaged)).toEqual([
      'modified both.txt',
      'deleted removed.txt',
      'modified worktree.txt'
    ])
    expect(pairs(reading.changes.untracked)).toEqual(['untracked new.txt'])
  })

  /*
    `-z` を渡しても rename が1件として返ること。ここは実物でしか確かめようがない
    （出力の形を決めるのは git であって、こちらの実装ではない）。
  */
  it('rename を1件として読み、元の位置を持つ', () => {
    writeFile('old.txt', 'contents that stay the same\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')
    git('mv', 'old.txt', 'new.txt')

    const reading = readStatus()

    expect(pairs(reading.changes.staged)).toEqual(['renamed old.txt -> new.txt'])
    expect(reading.changes.unstaged).toEqual([])
    expect(reading.changes.untracked).toEqual([])
  })

  it('staged の削除を、作業ツリー側の削除と別に読む', () => {
    writeFile('gone.txt', 'x\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')
    git('rm', '--quiet', 'gone.txt')

    const reading = readStatus()

    expect(pairs(reading.changes.staged)).toEqual(['deleted gone.txt'])
    expect(reading.changes.unstaged).toEqual([])
  })

  it('日本語のファイル名が化けずに返る', () => {
    writeFile('日本語のファイル.txt', 'こんにちは\n')
    mkdirSync(join(root, 'フォルダ'))
    writeFile('フォルダ/中身.txt', 'なかみ\n')
    git('add', '日本語のファイル.txt')

    const reading = readStatus()

    expect(pairs(reading.changes.staged)).toEqual(['added 日本語のファイル.txt'])
    expect(pairs(reading.changes.untracked)).toEqual(['untracked フォルダ'])
  })

  it('空白を含む名前を、そこで切らずに返す', () => {
    mkdirSync(join(root, 'my folder'))
    writeFile('my folder/read me.txt', 'x\n')
    git('add', '-A')

    const reading = readStatus()

    expect(pairs(reading.changes.staged)).toEqual(['added my folder/read me.txt'])
  })

  /*
    `--untracked-files=normal` の効き目。中身を1件ずつ並べる（`all`）と、
    node_modules のようなフォルダで一覧が数万行になる。
  */
  it('中身がすべて未追跡のフォルダは、フォルダ1件として返る', () => {
    mkdirSync(join(root, 'brand-new', 'nested'), { recursive: true })
    writeFile('brand-new/one.txt', '1\n')
    writeFile('brand-new/nested/two.txt', '2\n')

    const reading = readStatus()

    expect(reading.changes.untracked).toEqual([
      { relativePath: 'brand-new', kind: 'untracked', originalPath: null, directory: true }
    ])
  })

  it('.git の中は変更ファイルとして返らない', () => {
    writeFile('a.txt', 'a\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')

    const reading = readStatus()
    const everything = [
      ...reading.changes.staged,
      ...reading.changes.unstaged,
      ...reading.changes.untracked,
      ...reading.changes.conflicted
    ]

    expect(everything).toEqual([])
  })

  it('併合の衝突を conflicted として読む', () => {
    writeFile('c.txt', 'base\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'base')
    git('checkout', '--quiet', '-b', 'other')
    writeFile('c.txt', 'other\n')
    git('commit', '--quiet', '--all', '--message', 'other')
    git('checkout', '--quiet', 'main')
    writeFile('c.txt', 'main\n')
    git('commit', '--quiet', '--all', '--message', 'main')

    // 衝突するので 1 で終わる（それがこのテストの前提そのもの）。
    expect(() => git('merge', 'other')).toThrow()

    const reading = readStatus()

    expect(pairs(reading.changes.conflicted)).toEqual(['conflicted c.txt'])
    expect(reading.changes.staged).toEqual([])
    expect(reading.changes.unstaged).toEqual([])
  })

  it('detached HEAD でも読め、upstream は持たない', () => {
    writeFile('a.txt', 'a\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')
    git('checkout', '--quiet', '--detach', 'HEAD')
    writeFile('b.txt', 'b\n')

    const reading = readStatus()

    expect(reading.upstream).toBeNull()
    expect(pairs(reading.changes.untracked)).toEqual(['untracked b.txt'])
  })

  it('upstream が無いブランチでは upstream を持たない', () => {
    writeFile('a.txt', 'a\n')
    git('add', '-A')
    git('commit', '--quiet', '--message', 'init')

    expect(readStatus().upstream).toBeNull()
  })

  /*
    ahead / behind は「もう1つのリポジトリ」が要る。ネットワークは使わず、
    同じ一時フォルダの隣に bare リポジトリを置いて push する。
  */
  it('upstream との進み具合（ahead / behind）を読む', async () => {
    const remote = await realpath(await mkdtemp(join(tmpdir(), 'fx-git-remote-')))

    try {
      execFileSync(gitExecutable as string, ['init', '--quiet', '--bare', '.'], {
        cwd: remote,
        env: createGitEnvironment(process.env),
        windowsHide: true
      })

      writeFile('a.txt', '1\n')
      git('add', '-A')
      git('commit', '--quiet', '--message', 'c1')
      git('remote', 'add', 'origin', remote)
      git('push', '--quiet', '--set-upstream', 'origin', 'main')

      expect(readStatus().upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 0 })

      // remote だけを1つ進め、手元をその1つ手前に戻す（＝ ahead 1 / behind 1）。
      writeFile('a.txt', '2\n')
      git('commit', '--quiet', '--all', '--message', 'c2')
      git('push', '--quiet', 'origin', 'main')
      git('reset', '--quiet', '--hard', 'HEAD~1')
      writeFile('b.txt', 'local only\n')
      git('add', '-A')
      git('commit', '--quiet', '--message', 'c3')

      expect(readStatus().upstream).toEqual({ name: 'origin/main', ahead: 1, behind: 1 })
    } finally {
      await rm(remote, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
