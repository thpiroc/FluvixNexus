import { createHash } from 'crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEBUG_ADAPTER_ARTIFACTS,
  DEBUG_ADAPTER_ARTIFACTS_DIRECTORY_NAME,
  resolveDebugAdapterArtifactRoot,
  verifyDebugAdapterArtifact,
  type DebugAdapterArtifact,
  type DebugAdapterArtifactFileSystem
} from './adapterArtifact'

/**
 * pin した adapter の配布物の検証（Session 6-15B）。
 *
 * 実ディスクを使う（§ DEVELOPMENT.md「純粋なロジックだけ」の例外と同じ理由）── 確かめたいのは
 * 「そこに在るものが pin した中身と同じか」と「symlink / ジャンクションを辿らないか」で、
 * 写しのファイルシステムでは OS がどう答えるかを自分で書くことになる。
 */

const FILES: Readonly<Record<string, string>> = {
  'src/dapDebugServer.js': 'console.log("Debug server listening at 127.0.0.1:1")\n',
  'src/bootloader.js': 'module.exports = "boot"\n',
  LICENSE: 'MIT License\n',
  'B.txt': 'upper\n',
  'a.txt': 'lower\n'
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * 表の tree hash を**手で**組む（実装を呼ばずに、docs に書いた形そのものを書き下す）。
 * 並びは UTF-16 の code unit 順 ── 大文字が小文字より先、`src/` は最後。
 */
const MANIFEST = ['B.txt', 'LICENSE', 'a.txt', 'src/bootloader.js', 'src/dapDebugServer.js']
  .map((path) => `${sha256(FILES[path] ?? '')}  ${path}\n`)
  .join('')

const TOTAL_BYTES = Object.values(FILES).reduce((sum, text) => sum + Buffer.byteLength(text), 0)

const ARTIFACT: DebugAdapterArtifact = {
  ...DEBUG_ADAPTER_ARTIFACTS['vscode-js-debug'],
  tree: { sha256: sha256(MANIFEST), fileCount: 5, totalBytes: TOTAL_BYTES }
}

const realFileSystem: DebugAdapterArtifactFileSystem = {
  lstat: (path) => lstatSync(path),
  readdir: (path) => readdirSync(path),
  readFile: (path) => readFileSync(path)
}

let base: string
let root: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fluvix-artifact-'))
  root = resolveDebugAdapterArtifactRoot(
    join(base, DEBUG_ADAPTER_ARTIFACTS_DIRECTORY_NAME),
    ARTIFACT
  )

  for (const [path, text] of Object.entries(FILES)) {
    const absolute = join(root, ...path.split('/'))
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, text)
  }
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('the pinned vscode-js-debug artifact', () => {
  it('pins one official release asset with its hash, license and tree', () => {
    const artifact = DEBUG_ADAPTER_ARTIFACTS['vscode-js-debug']

    expect(artifact.version).toBe('1.117.0')
    expect(artifact.source).toEqual({
      repository: 'https://github.com/microsoft/vscode-js-debug',
      releaseTag: 'v1.117.0',
      assetName: 'js-debug-dap-v1.117.0.tar.gz',
      url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.117.0/js-debug-dap-v1.117.0.tar.gz',
      sha256: 'ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772'
    })
    expect(artifact.license).toBe('MIT')
    expect(artifact.entryRelativePath).toBe('src/dapDebugServer.js')
    expect(artifact.installDirectoryName).toContain(artifact.version)
    expect(artifact.tree.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifact.tree.fileCount).toBe(60)
    expect(artifact.tree.totalBytes).toBe(2_467_634)
  })

  it('places the artifact under the Main-owned base directory, split by version', () => {
    expect(
      resolveDebugAdapterArtifactRoot(
        'C:\\Users\\me\\AppData\\Roaming\\Fluvix Nexus\\debug-adapters',
        DEBUG_ADAPTER_ARTIFACTS['vscode-js-debug']
      )
    ).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\Fluvix Nexus\\debug-adapters\\js-debug-dap-v1.117.0\\js-debug'
    )
  })
})

describe('verifyDebugAdapterArtifact', () => {
  it('verifies the exact tree and returns the absolute entry script', () => {
    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'verified',
      rootPath: root,
      entryPath: join(root, 'src', 'dapDebugServer.js')
    })
  })

  it('is missing when nothing is installed', () => {
    rmSync(root, { recursive: true, force: true })

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'missing'
    })
  })

  it('is a hash mismatch when one byte of a non-entry file changes', () => {
    writeFileSync(join(root, 'src', 'bootloader.js'), 'module.exports = "boOt"\n')

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'hash-mismatch'
    })
  })

  it('is a hash mismatch when a file is added or removed', () => {
    writeFileSync(join(root, 'src', 'extra.js'), '')

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'hash-mismatch'
    })

    rmSync(join(root, 'src', 'extra.js'))
    rmSync(join(root, 'a.txt'))

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'hash-mismatch'
    })
  })

  it('is a hash mismatch when a file moves (same bytes, count and size)', () => {
    renameSync(join(root, 'a.txt'), join(root, 'c.txt'))

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'hash-mismatch'
    })
  })

  it('is a hash mismatch when the tree matches but the entry script is not in it', () => {
    expect(
      verifyDebugAdapterArtifact(
        root,
        { ...ARTIFACT, entryRelativePath: 'src/missing.js' },
        realFileSystem
      )
    ).toEqual({ status: 'hash-mismatch' })
  })

  it('does not follow a junction at the root', () => {
    const real = join(base, 'real-js-debug')
    renameSync(root, real)
    symlinkSync(real, root, 'junction')

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'invalid'
    })
  })

  it('does not follow a junction inside the tree', () => {
    const outside = join(base, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(root, 'linked'), 'junction')

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'invalid'
    })
  })

  it('stops before reading file contents when the tree is larger than pinned', () => {
    const read: string[] = []
    const counting: DebugAdapterArtifactFileSystem = {
      ...realFileSystem,
      readFile: (path) => {
        read.push(path)
        return readFileSync(path)
      }
    }

    writeFileSync(join(root, 'huge.bin'), Buffer.alloc(TOTAL_BYTES + 1))

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, counting)).toEqual({
      status: 'hash-mismatch'
    })
    expect(read).toEqual([])
  })

  it('is invalid when a directory cannot be read', () => {
    const failing: DebugAdapterArtifactFileSystem = {
      ...realFileSystem,
      readdir: () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
    }

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, failing)).toEqual({ status: 'invalid' })
  })

  it('is invalid when the root is a file', () => {
    rmSync(root, { recursive: true, force: true })
    writeFileSync(root, 'not a directory')

    expect(verifyDebugAdapterArtifact(root, ARTIFACT, realFileSystem)).toEqual({
      status: 'invalid'
    })
  })
})
