import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectExecutable, isSameExecutable, runTerminalProcess } from './terminalRunIo'

/**
 * 実際にプロセスを起動する部分（Security Core v1 の STEP8）。
 *
 * テストを走らせている node そのもの（`process.execPath`）を起動して確かめる。
 *
 *   - シェルを通さない（`&` `|` `"` は1つの引数のまま届く）
 *   - stdin は閉じている（入力を待つコマンドは待たずに終わる）
 *   - 指定した作業ディレクトリで動く
 *   - 時間の上限で、子プロセスごと終了させる
 */

let dir: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'fx-terminal-io-')))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function node(script: string, extra: readonly string[] = []) {
  return { file: process.execPath, args: ['-e', script, ...extra], windowsVerbatimArguments: false }
}

describe('起動', () => {
  it('stdout / stderr と終了コードを集める', async () => {
    const result = await runTerminalProcess(
      node("process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exit(3)"),
      dir
    )

    expect(result.kind).toBe('exited')

    if (result.kind === 'exited') {
      expect(result.exitCode).toBe(3)
      expect(result.output.text).toContain('out')
      expect(result.output.text).toContain('err')
    }
  })

  it('シェルを通さない（& | " を含む引数も1つのまま届く）', async () => {
    const tricky = 'a & echo INJECTED | more "q"'
    const result = await runTerminalProcess(
      node('console.log(JSON.stringify(process.argv.slice(1)))', [tricky]),
      dir
    )

    expect(result.kind).toBe('exited')

    if (result.kind === 'exited') {
      expect(JSON.parse(result.output.text.trim())).toEqual([tricky])
      expect(result.output.text).not.toMatch(/^INJECTED/m)
    }
  })

  it('stdin は閉じている（入力を待たずに終わる）', async () => {
    const result = await runTerminalProcess(
      node("process.stdin.resume(); process.stdin.on('end', () => console.log('eof'))"),
      dir,
      10_000
    )

    expect(result).toMatchObject({ kind: 'exited', exitCode: 0 })

    if (result.kind === 'exited') {
      expect(result.output.text.trim()).toBe('eof')
    }
  })

  it('指定した作業ディレクトリで動く', async () => {
    const result = await runTerminalProcess(node('console.log(process.cwd())'), dir)

    if (result.kind !== 'exited') {
      throw new Error(result.kind)
    }

    expect((await realpath(result.output.text.trim())).toLowerCase()).toBe(dir.toLowerCase())
  })

  it('Electron 由来の環境変数を子へ持ち出さない', async () => {
    const previous = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'

    try {
      const result = await runTerminalProcess(
        node("console.log(String(process.env.ELECTRON_RUN_AS_NODE ?? 'unset'))"),
        dir
      )

      if (result.kind !== 'exited') {
        throw new Error(result.kind)
      }

      expect(result.output.text.trim()).toBe('unset')
    } finally {
      if (previous === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE
      } else {
        process.env.ELECTRON_RUN_AS_NODE = previous
      }
    }
  })

  it('起動できなければ spawn-failed（例外を投げない）', async () => {
    const result = await runTerminalProcess(
      { file: join(dir, 'missing.exe'), args: [], windowsVerbatimArguments: false },
      dir
    )

    expect(result.kind).toBe('spawn-failed')
  })
})

describe('時間の上限', () => {
  it('上限を過ぎたら、子プロセスごと終了させる', async () => {
    const script = [
      "const { spawn } = require('child_process');",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      'console.log(child.pid);',
      'setTimeout(() => {}, 60000);'
    ].join(' ')

    const result = await runTerminalProcess(node(script), dir, 1_500)

    expect(result.kind).toBe('timed-out')

    if (result.kind !== 'timed-out') {
      return
    }

    const grandchild = Number(result.output.text.trim())

    expect(Number.isInteger(grandchild)).toBe(true)

    // taskkill /T が木ごと終わらせる。少し待ってから、孫が居ないことを確かめる。
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    expect(() => process.kill(grandchild, 0)).toThrow()
  }, 20_000)
})

describe('実行ファイルの identity', () => {
  it('ファイルなら実体と identity を返し、同じものは同じと読む', async () => {
    const a = await inspectExecutable(process.execPath)
    const b = await inspectExecutable(process.execPath)

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(isSameExecutable(a!, b!)).toBe(true)
    expect(isSameExecutable(a!, { ...a!, mtimeNs: a!.mtimeNs + 1n })).toBe(false)
  })

  it('ディレクトリや無いものは null', async () => {
    expect(await inspectExecutable(dir)).toBeNull()
    expect(await inspectExecutable(join(dir, 'missing.exe'))).toBeNull()
  })
})
