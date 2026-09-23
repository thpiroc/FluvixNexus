import { describe, expect, it } from 'vitest'
import {
  executableKindOf,
  executableNameCandidates,
  isAcceptableCommandName,
  isSafeBatchArgument,
  isSafeBatchPath
} from './terminalCommand'
import { resolveTerminalExecutable, isInsideWorkspaceRoot } from './terminalExecutable'
import { buildTerminalLaunch } from './terminalLaunch'

/**
 * コマンドの形・実行ファイルの解決・起動する形（Security Core v1 の STEP8）。
 *
 * 固定したいのは次のこと。
 *
 *   - command は PATH 上の名前だけ（絶対パス・相対パス・区切りは拒む）
 *   - PATH は Main が辿り、**Workspace の中を指す項目・相対の項目は使わない**
 *   - .cmd / .bat へ渡す引数は安全な文字だけ（cmd.exe が解釈する文字は1つも通さない）
 *   - program は argv のまま、batch は `%SystemRoot%` の cmd.exe で包む
 */

describe('command の名前', () => {
  it('PATH 上の名前は受け付ける', () => {
    for (const name of [
      'npm',
      'node',
      'git',
      'npm.cmd',
      'node.exe',
      'python3',
      'tsc',
      'c++',
      'x_y-z'
    ]) {
      expect(isAcceptableCommandName(name)).toBe(true)
    }
  })

  it('パス・区切り・ドライブ・空白・予約名・オプションに見える名前は拒む', () => {
    for (const name of [
      'C:\\Windows\\System32\\cmd.exe',
      'C:cmd.exe',
      '/usr/bin/env',
      './gradlew',
      '.\\gradlew.bat',
      'bin/tool',
      '..',
      'tool.',
      'np..m',
      'npm test',
      '"npm"',
      '-rf',
      '*',
      'nul',
      'con.exe',
      'COM1',
      '',
      42,
      null
    ]) {
      expect(isAcceptableCommandName(name)).toBe(false)
    }
  })

  it('Windows では拡張子を書かなければ .com / .exe / .bat / .cmd の順に探す', () => {
    expect(executableNameCandidates('npm', 'win32')).toEqual([
      'npm.com',
      'npm.exe',
      'npm.bat',
      'npm.cmd'
    ])
    expect(executableNameCandidates('npm.cmd', 'win32')).toEqual(['npm.cmd'])
    expect(executableNameCandidates('NODE.EXE', 'win32')).toEqual(['NODE.EXE'])
  })

  it('実行ファイルでない拡張子を書いても、それ自体は起動しない', () => {
    // `.ps1` / `.js` そのものは探さない（拡張子を足した名前だけを探す）。
    expect(executableNameCandidates('build.ps1', 'win32')).not.toContain('build.ps1')
    expect(executableNameCandidates('build.js', 'win32')).not.toContain('build.js')
  })

  it('.bat / .cmd だけが cmd.exe を通る', () => {
    expect(executableKindOf('C:\\nodejs\\npm.cmd', 'win32')).toBe('batch')
    expect(executableKindOf('C:\\tools\\run.BAT', 'win32')).toBe('batch')
    expect(executableKindOf('C:\\nodejs\\node.exe', 'win32')).toBe('program')
    expect(executableKindOf('/usr/bin/npm.cmd', 'linux')).toBe('program')
  })
})

describe('.cmd / .bat へ渡す引数', () => {
  it('普段の npm / npx の引数は通る', () => {
    for (const arg of [
      'run',
      'test',
      '--version',
      '--save-dev=typescript@5.4.0',
      '@scope/pkg',
      'src/index.ts',
      'src\\index.ts',
      'a,b',
      'x+y',
      'http://localhost:3000'
    ]) {
      expect(isSafeBatchArgument(arg)).toBe(true)
    }
  })

  it('cmd.exe が区切り・展開・引用として読む文字は1つでも拒む', () => {
    for (const arg of [
      'x&whoami',
      'a|b',
      'a>out.txt',
      'a<in.txt',
      'a^b',
      '%PATH%',
      '!x!',
      '"quoted"',
      '(a)',
      'a b',
      'a;b',
      'a\tb',
      '',
      '日本語'
    ]) {
      expect(isSafeBatchArgument(arg)).toBe(false)
    }
  })

  it('`%` を含むパスの .cmd は包めない', () => {
    expect(isSafeBatchPath('C:\\Users\\a\\AppData\\Roaming\\npm\\npm.cmd')).toBe(true)
    expect(isSafeBatchPath('C:\\Program Files (x86)\\tool\\run.cmd')).toBe(true)
    expect(isSafeBatchPath('C:\\100%\\npm.cmd')).toBe(false)
  })
})

describe('実行ファイルの解決', () => {
  const env = {
    PATH: [
      '.',
      'bin',
      'D:\\work\\project\\node_modules\\.bin',
      'C:\\Program Files\\nodejs',
      'C:\\Windows\\System32'
    ].join(';')
  }

  function resolveWith(
    command: string,
    files: readonly string[],
    options: { readonly env?: Record<string, string | undefined> } = {}
  ): ReturnType<typeof resolveTerminalExecutable> {
    const present = new Set(files.map((file) => file.toLowerCase()))

    return resolveTerminalExecutable(command, {
      platform: 'win32',
      env: options.env ?? env,
      exists: (path) => present.has(path.toLowerCase()),
      workspaceRoots: ['D:\\work\\project', 'D:\\work\\project']
    })
  }

  it('PATH を辿って絶対パスにする', () => {
    expect(resolveWith('node', ['C:\\Program Files\\nodejs\\node.exe'])).toEqual({
      ok: true,
      file: 'C:\\Program Files\\nodejs\\node.exe',
      kind: 'program'
    })
    expect(resolveWith('npm', ['C:\\Program Files\\nodejs\\npm.cmd'])).toEqual({
      ok: true,
      file: 'C:\\Program Files\\nodejs\\npm.cmd',
      kind: 'batch'
    })
  })

  it('Workspace の中を指す PATH の項目は使わない（node_modules/.bin を PATH に足していても）', () => {
    expect(
      resolveWith('tsc', [
        'D:\\work\\project\\node_modules\\.bin\\tsc.cmd',
        'C:\\Program Files\\nodejs\\tsc.cmd'
      ])
    ).toEqual({ ok: true, file: 'C:\\Program Files\\nodejs\\tsc.cmd', kind: 'batch' })

    expect(resolveWith('tsc', ['D:\\work\\project\\node_modules\\.bin\\tsc.cmd'])).toEqual({
      ok: false,
      denial: 'command-not-found'
    })
  })

  it('大文字小文字や区切りの書き方が違っても、Workspace の中の項目は除く', () => {
    const custom = { PATH: 'd:/WORK/Project/tools/;C:\\Windows\\System32' }

    expect(resolveWith('tool', ['d:/WORK/Project/tools\\tool.exe'], { env: custom })).toEqual({
      ok: false,
      denial: 'command-not-found'
    })
  })

  it('似た名前の別のフォルダ（project-tools）は Workspace の中ではない', () => {
    const custom = { PATH: 'D:\\work\\project-tools' }

    expect(resolveWith('tool', ['D:\\work\\project-tools\\tool.exe'], { env: custom }).ok).toBe(
      true
    )
  })

  it('相対の PATH の項目（. / bin）は使わない（cwd の中身が起動されない）', () => {
    expect(resolveWith('evil', ['.\\evil.exe', 'bin\\evil.exe'])).toEqual({
      ok: false,
      denial: 'command-not-found'
    })
  })

  it('見つからない・PATH が無い・名前の形が違う、は拒む（名前のまま起動しない）', () => {
    expect(resolveWith('missing', [])).toEqual({ ok: false, denial: 'command-not-found' })
    expect(resolveWith('node', ['C:\\x\\node.exe'], { env: {} })).toEqual({
      ok: false,
      denial: 'command-not-found'
    })
    expect(resolveWith('C:\\Windows\\System32\\cmd.exe', [])).toEqual({
      ok: false,
      denial: 'unsupported-command'
    })
  })

  it('`%` を含む場所の .cmd は起動しない', () => {
    const custom = { PATH: 'C:\\100%\\bin' }

    expect(resolveWith('npm', ['C:\\100%\\bin\\npm.cmd'], { env: custom })).toEqual({
      ok: false,
      denial: 'unsupported-command'
    })
  })

  it('実体が Workspace の中かは、区切りまで含めて比べる', () => {
    expect(isInsideWorkspaceRoot('D:\\work\\project', 'D:\\work\\project\\a.exe', 'win32')).toBe(
      true
    )
    expect(isInsideWorkspaceRoot('D:\\work\\project', 'd:\\WORK\\PROJECT', 'win32')).toBe(true)
    expect(
      isInsideWorkspaceRoot('D:\\work\\project', 'D:\\work\\project-evil\\a.exe', 'win32')
    ).toBe(false)
    // 読めない値は「中」と答える（拒否側）。
    expect(isInsideWorkspaceRoot(undefined, 'C:\\a.exe', 'win32')).toBe(true)
  })
})

describe('起動する形', () => {
  const env = { SystemRoot: 'C:\\Windows' }

  it('program は argv のまま（引用し直さない）', () => {
    expect(
      buildTerminalLaunch(
        { file: 'C:\\nodejs\\node.exe', kind: 'program' },
        ['-e', 'console.log("a & b")'],
        env
      )
    ).toEqual({
      file: 'C:\\nodejs\\node.exe',
      args: ['-e', 'console.log("a & b")'],
      windowsVerbatimArguments: false
    })
  })

  it('batch は %SystemRoot% の cmd.exe で包む（AutoRun と遅延展開を切る）', () => {
    expect(
      buildTerminalLaunch(
        { file: 'C:\\Program Files\\nodejs\\npm.cmd', kind: 'batch' },
        ['run', 'test'],
        env
      )
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', '""C:\\Program Files\\nodejs\\npm.cmd" run test"'],
      windowsVerbatimArguments: true
    })
  })

  it('batch へ安全でない引数が来たら、ここでも組み立てない', () => {
    expect(
      buildTerminalLaunch({ file: 'C:\\nodejs\\npm.cmd', kind: 'batch' }, ['x&whoami'], env)
    ).toBeNull()
  })

  it('%SystemRoot% が読めなければ batch は起動しない（PATH の cmd.exe に任せない）', () => {
    expect(buildTerminalLaunch({ file: 'C:\\nodejs\\npm.cmd', kind: 'batch' }, [], {})).toBeNull()
    expect(
      buildTerminalLaunch({ file: 'C:\\nodejs\\npm.cmd', kind: 'batch' }, [], {
        SystemRoot: 'Windows'
      })
    ).toBeNull()
  })
})
