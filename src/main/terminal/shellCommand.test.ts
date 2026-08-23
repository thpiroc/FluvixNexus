import { describe, expect, it } from 'vitest'
import { listShellChoices, resolveDefaultShell, resolveShellCommand } from './shellCommand'

/**
 * 起動するものを決める表（shellCommand.ts）。
 *
 * ここで確かめたいのは配色や好みではなく、**開いたフォルダの中身が
 * 起動されるものに影響しないこと**にある。Session 3-7-2 で PATH を辿る行
 * （Node / Claude Code）が増えたため、その性質を PATH の側でも確かめる。
 */
describe('resolveDefaultShell', () => {
  describe('Windows', () => {
    it('%SystemRoot% からの絶対パスで解決する', () => {
      const shell = resolveDefaultShell('win32', { SystemRoot: 'C:\\WINDOWS' })

      expect(shell.file).toBe('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
      expect(shell.name).toBe('PowerShell')
    })

    /*
      PATH と作業ディレクトリで解決させないための確認。作業ディレクトリは
      利用者が開いた Workspace であり、その中に powershell.exe が置かれていることは
      十分ありうる（clone してきたリポジトリの中身は、この時点ではただのファイル）。
    */
    it('相対的に解決されうる名前だけを返さない', () => {
      const shell = resolveDefaultShell('win32', { SystemRoot: 'C:\\WINDOWS' })

      expect(shell.file).not.toBe('powershell.exe')
      expect(shell.file.includes('\\')).toBe(true)
    })

    it('末尾の区切り文字が重ならない', () => {
      const shell = resolveDefaultShell('win32', { SystemRoot: 'C:\\WINDOWS\\' })

      expect(shell.file).toBe('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    })

    it('綴りが SYSTEMROOT でも解決できる', () => {
      const shell = resolveDefaultShell('win32', { SYSTEMROOT: 'C:\\WINDOWS' })

      expect(shell.file).toBe('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    })

    /*
      異常な環境での最後の手段。起動できないより良いが、既定の経路ではない
      （shellCommand.ts の冒頭）。
    */
    it('%SystemRoot% が無ければ名前だけに落とす', () => {
      expect(resolveDefaultShell('win32', {}).file).toBe('powershell.exe')
      expect(resolveDefaultShell('win32', { SystemRoot: '' }).file).toBe('powershell.exe')
    })

    it('起動を待たせるオプションを付けない', () => {
      const shell = resolveDefaultShell('win32', { SystemRoot: 'C:\\WINDOWS' })

      // `exit` で終われないシェルを作らない。
      expect(shell.args).not.toContain('-NoExit')
    })
  })

  /*
    v1 の対象ではない（DESIGN.md §8）。Mac 対応を始めるときに書き換える場所が
    1つであることだけを確かめる。
  */
  describe('Unix 系', () => {
    it('$SHELL があればそれを使う', () => {
      expect(resolveDefaultShell('darwin', { SHELL: '/bin/zsh' }).file).toBe('/bin/zsh')
    })

    it('$SHELL が無ければ /bin/sh に落とす', () => {
      expect(resolveDefaultShell('linux', {}).file).toBe('/bin/sh')
    })
  })
})

/* ------------------------------------------------------------------------ */

const WINDOWS_ENV = {
  SystemRoot: 'C:\\WINDOWS',
  PATH: 'C:\\Program Files\\nodejs;C:\\Users\\me\\AppData\\Roaming\\npm'
} as const

/** 在るファイルを並べて渡す（大文字小文字は Windows に合わせて無視する）。 */
function existsIn(...files: readonly string[]) {
  const known = new Set(files.map((file) => file.toLowerCase()))

  return (candidate: string): boolean => known.has(candidate.toLowerCase())
}

describe('resolveShellCommand', () => {
  it('既定の行は Session 3-7-1 と同じものを返す', () => {
    const shell = resolveShellCommand('default', 'win32', WINDOWS_ENV, existsIn())

    expect(shell).toEqual(resolveDefaultShell('win32', WINDOWS_ENV))
  })

  describe('Node', () => {
    it('PATH の項目を辿って絶対パスで返す', () => {
      const shell = resolveShellCommand(
        'node',
        'win32',
        WINDOWS_ENV,
        existsIn('C:\\Program Files\\nodejs\\node.exe')
      )

      expect(shell).toEqual({
        name: 'Node',
        file: 'C:\\Program Files\\nodejs\\node.exe',
        args: []
      })
    })

    it('実体が無ければ「この環境には無い」として null を返す', () => {
      expect(resolveShellCommand('node', 'win32', WINDOWS_ENV, existsIn())).toBeNull()
    })

    /*
      この表の存在理由そのもの。PATH に `.` が入っている環境は珍しくなく、
      拾ってしまうと「フォルダを開いただけ」が「そのフォルダの node.exe が動く」になる。
    */
    it('PATH の相対的な項目は使わない', () => {
      const env = { ...WINDOWS_ENV, PATH: '.;..\\tools;C:node.exe;bin' }

      expect(
        resolveShellCommand(
          'node',
          'win32',
          env,
          // どこを見ても在ることにしても、相対の項目からは拾わない。
          () => true
        )
      ).toBeNull()
    })

    it('PATH の先に置かれたものが勝つ', () => {
      const shell = resolveShellCommand(
        'node',
        'win32',
        { ...WINDOWS_ENV, PATH: 'C:\\first;C:\\second' },
        existsIn('C:\\first\\node.exe', 'C:\\second\\node.exe')
      )

      expect(shell?.file).toBe('C:\\first\\node.exe')
    })

    it('引用符付きの項目・末尾の区切りを読み解く', () => {
      const shell = resolveShellCommand(
        'node',
        'win32',
        { ...WINDOWS_ENV, PATH: '"C:\\Program Files\\nodejs\\"' },
        existsIn('C:\\Program Files\\nodejs\\node.exe')
      )

      expect(shell?.file).toBe('C:\\Program Files\\nodejs\\node.exe')
    })

    it('Unix 系では : 区切りで拡張子の無い名前を探す', () => {
      const shell = resolveShellCommand(
        'node',
        'darwin',
        { PATH: '/usr/local/bin:/usr/bin' },
        existsIn('/usr/bin/node')
      )

      expect(shell?.file).toBe('/usr/bin/node')
    })
  })

  describe('Claude Code', () => {
    /*
      npm が置くのは `claude.cmd`（バッチ）で、CreateProcess は直接起動できない。
      包む相手が**絶対パス**であることがここでの要点になる。
    */
    it('.cmd は %SystemRoot% の cmd.exe で包む', () => {
      const shell = resolveShellCommand(
        'claude-code',
        'win32',
        WINDOWS_ENV,
        existsIn('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd')
      )

      expect(shell).toEqual({
        name: 'Claude Code',
        file: 'C:\\WINDOWS\\System32\\cmd.exe',
        args: ['/c', 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd']
      })
    })

    it('ネイティブの実行ファイルがあれば包まずに起動する', () => {
      const shell = resolveShellCommand(
        'claude-code',
        'win32',
        WINDOWS_ENV,
        existsIn(
          'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.exe',
          'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd'
        )
      )

      expect(shell).toEqual({
        name: 'Claude Code',
        file: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.exe',
        args: []
      })
    })

    /*
      名前だけに落とすと「PATH と cwd から解決される cmd.exe」になり、
      この表が守っている性質そのものが崩れる（shellCommand.ts）。
    */
    it('%SystemRoot% が読めなければ、包めないので選択肢から外す', () => {
      const shell = resolveShellCommand(
        'claude-code',
        'win32',
        { PATH: 'C:\\npm' },
        existsIn('C:\\npm\\claude.cmd')
      )

      expect(shell).toBeNull()
    })

    it('入っていなければ null を返す', () => {
      expect(resolveShellCommand('claude-code', 'win32', WINDOWS_ENV, existsIn())).toBeNull()
    })
  })
})

describe('listShellChoices', () => {
  it('表の並びのまま、起動できるかどうかを添えて返す', () => {
    const choices = listShellChoices(
      'win32',
      WINDOWS_ENV,
      existsIn('C:\\Program Files\\nodejs\\node.exe')
    )

    expect(choices).toEqual([
      { id: 'default', name: 'PowerShell', available: true },
      { id: 'node', name: 'Node', available: true },
      { id: 'claude-code', name: 'Claude Code', available: false }
    ])
  })

  /*
    起動できない行も名前付きで返る。落として返すと、Renderer 側で
    「出さなかった」と「そもそも表に無い」の区別が付かなくなる。
  */
  it('起動できない行も名前を持ったまま返る', () => {
    const choices = listShellChoices('win32', WINDOWS_ENV, existsIn())

    expect(choices.map((choice) => choice.name)).toEqual(['PowerShell', 'Node', 'Claude Code'])
    expect(choices.filter((choice) => choice.available).map((choice) => choice.id)).toEqual([
      'default'
    ])
  })

  it('PATH がまったく無くても既定のシェルは選べる', () => {
    const choices = listShellChoices('win32', { SystemRoot: 'C:\\WINDOWS' }, existsIn())

    expect(choices[0]).toEqual({ id: 'default', name: 'PowerShell', available: true })
  })
})
