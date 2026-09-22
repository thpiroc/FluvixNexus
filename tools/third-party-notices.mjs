import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { builtinModules } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/**
 * 配布物に含まれる第三者ソフトウェアのライセンス表記（THIRD_PARTY_NOTICES.txt）を作る
 * （Session 7-2A。docs/RELEASE.md §4）。
 *
 *   npm run notices        … 書き出す
 *   npm run notices:check  … 書き出した内容と今の依存が食い違っていれば失敗する（verify に含む）
 *
 * ## 何を「含まれる」とみなすか
 *
 * 手で一覧を持たない。依存の版が上がったり import が増えたりしたときに、一覧だけが
 * 取り残されるため。次の2段で決める。
 *
 * 1. `src/` の実行時の import（`import type` とテストファイルは除く）に現れるパッケージ
 *    ── Renderer は Vite がバンドルし、Main は `dependencies` を node_modules のまま同梱する。
 *    どちらも「src が import したもの」が配布物に入る
 * 2. 1 のパッケージが実行時に要るもの（`dependencies` と、**この環境に入っている**
 *    `optionalDependencies`）を辿ったもの。`peerDependencies` は辿らない（持ち主は別に数える）
 *
 * 3. src が import しないが、**配布物へそのまま写すパッケージ**（`BUNDLED_PACKAGES`）と、
 *    それが実行時に要るもの（electron-builder.yml の `extraResources` で写すもの）。
 *    写すのが依存をまとめた1ファイルでも、中身は依存のコードそのものなので、
 *    依存を辿って全部載せる（載せ過ぎる側に倒す）。今は該当するものが無い
 *    （アプリは MCP サーバーを同梱しない。MCP サーバーは利用者が登録して、その PC の上で動く）
 *
 * Electron は数えない。Electron / Chromium / Node.js のライセンスは electron-builder が
 * `LICENSE.electron.txt` / `LICENSES.chromium.html` としてインストール先へ置く。
 *
 * 本文はパッケージに入っているライセンスファイルをそのまま載せる。行末の空白だけは落とす
 * （改行コードと末尾の空白の違いで check が揺れないようにするため。文言は変えない）。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = join(ROOT, 'THIRD_PARTY_NOTICES.txt')
const SOURCE_ROOT = join(ROOT, 'src')

/**
 * src が import せず、electron-builder.yml の `extraResources` で配布物へ写すパッケージ（冒頭の 3）。
 * 写す設定を足したら、ここにも足す。
 */
const BUNDLED_PACKAGES = []

/** 数えないパッケージ（理由は冒頭）。 */
const EXCLUDED_PACKAGES = new Set(['electron'])

/** tsconfig / vite の別名。パッケージではない。 */
const ALIAS_PREFIXES = ['@shared/', '@renderer/']

const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice|thirdpartynotices)([-._].*)?$/i

function listSourceFiles(directory) {
  const files = []

  for (const name of readdirSync(directory)) {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) {
      files.push(...listSourceFiles(path))
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      files.push(path)
    }
  }

  return files
}

/** ソースに現れる、実行時に読み込まれる specifier。 */
function collectRuntimeSpecifiers(source) {
  const specifiers = []
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const patterns = [
    /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?[^'"`;]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /(?:^|[\n;])\s*import\s+()['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*()['"]([^'"]+)['"]\s*\)/g
  ]

  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) {
      if (match[1] === undefined || match[1] === '') {
        specifiers.push(match[2])
      }
    }
  }

  return specifiers
}

function toPackageName(specifier) {
  const bare = specifier.split('?')[0]

  if (bare.startsWith('.') || bare.startsWith('/') || bare.startsWith('node:')) {
    return null
  }

  if (ALIAS_PREFIXES.some((prefix) => bare.startsWith(prefix))) {
    return null
  }

  const segments = bare.split('/')
  const name = bare.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]

  if (builtinModules.includes(name) || EXCLUDED_PACKAGES.has(name)) {
    return null
  }

  return name
}

/**
 * パッケージを探す。Node と同じく、依存元のフォルダの `node_modules` から ROOT まで親へ辿る
 * ── 版が食い違う依存は、依存元の下に入れ子で置かれる（ROOT の node_modules には無い）。
 */
function readPackage(name, from = ROOT) {
  for (let base = from; ; base = dirname(base)) {
    const directory = join(base, 'node_modules', ...name.split('/'))
    const manifestPath = join(directory, 'package.json')

    if (existsSync(manifestPath)) {
      return { directory, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }
    }

    if (base === ROOT || dirname(base) === base) {
      return null
    }
  }
}

function collectPackages() {
  const direct = new Set()

  for (const file of listSourceFiles(SOURCE_ROOT)) {
    for (const specifier of collectRuntimeSpecifiers(readFileSync(file, 'utf8'))) {
      const name = toPackageName(specifier)

      if (name !== null) {
        direct.add(name)
      }
    }
  }

  for (const name of BUNDLED_PACKAGES) {
    direct.add(name)
  }

  const packages = new Map()
  const queue = [...direct].map((name) => ({ name, optional: false, from: ROOT }))

  while (queue.length > 0) {
    const { name, optional, from } = queue.shift()

    /*
      `@types/*` は型定義だけで、バンドルにも node_modules の実行時にも読み込まれない
      （dompurify が `@types/trusted-types` を dependencies に持っている）。
    */
    if (packages.has(name) || EXCLUDED_PACKAGES.has(name) || name.startsWith('@types/')) {
      continue
    }

    const found = readPackage(name, from)

    if (found === null) {
      if (optional) {
        // 別の OS / アーキテクチャ向けの optionalDependencies。この環境の配布物には入らない。
        continue
      }

      throw new Error(`"${name}" is used at runtime but is not installed in node_modules.`)
    }

    packages.set(name, found)

    for (const dependency of Object.keys(found.manifest.dependencies ?? {})) {
      queue.push({ name: dependency, optional: false, from: found.directory })
    }

    for (const dependency of Object.keys(found.manifest.optionalDependencies ?? {})) {
      queue.push({ name: dependency, optional: true, from: found.directory })
    }
  }

  return [...packages.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

function describeLicense(manifest) {
  const license = manifest.license ?? manifest.licenses

  if (typeof license === 'string') {
    // SPDX の式（`(MPL-2.0 OR Apache-2.0)`）は外側の括弧を落として並べる。
    return license.replace(/^\((.*)\)$/, '$1')
  }

  if (Array.isArray(license)) {
    return license.map((entry) => entry.type ?? String(entry)).join(' OR ')
  }

  return license?.type ?? 'UNKNOWN'
}

function describeRepository(manifest) {
  const repository = manifest.repository
  const url = typeof repository === 'string' ? repository : repository?.url

  return typeof url === 'string' ? url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://') : ''
}

function normalizeText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim()
}

function render(packages) {
  const rule = '='.repeat(80)
  const lines = [
    'Fluvix Nexus - Third-Party Notices',
    rule,
    '',
    'Fluvix Nexus is licensed under the MIT License (see LICENSE).',
    '',
    'The Fluvix Nexus application includes the third-party software listed below.',
    'Each component is distributed under its own license, reproduced in this file',
    'as shipped in the component package.',
    '',
    'Electron, Chromium and Node.js are distributed with the application under their',
    'own licenses (LICENSE.electron.txt and LICENSES.chromium.html in the installation',
    'folder) and are not repeated here.',
    '',
    'This file is generated by `npm run notices`. Do not edit it by hand.',
    '',
    'Components:',
    ''
  ]

  for (const [name, { manifest }] of packages) {
    lines.push(`- ${name} ${manifest.version} (${describeLicense(manifest)})`)
  }

  for (const [name, { directory, manifest }] of packages) {
    const licenseFiles = readdirSync(directory)
      .filter((file) => LICENSE_FILE_PATTERN.test(file))
      .filter((file) => statSync(join(directory, file)).isFile())
      .sort()

    lines.push('', rule, `${name} ${manifest.version}`, rule)
    lines.push(`License: ${describeLicense(manifest)}`)

    const repository = describeRepository(manifest)

    if (repository !== '') {
      lines.push(`Repository: ${repository}`)
    }

    if (licenseFiles.length === 0) {
      lines.push(
        '',
        'This package does not include a license file. Its package.json declares the',
        'license above.'
      )
      continue
    }

    for (const file of licenseFiles) {
      lines.push(
        '',
        `--- ${file} ---`,
        '',
        normalizeText(readFileSync(join(directory, file), 'utf8'))
      )
    }
  }

  return `${lines.join('\n')}\n`
}

const expected = render(collectPackages())

if (process.argv.includes('--check')) {
  const actual = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8').replace(/\r\n?/g, '\n') : ''

  if (actual !== expected) {
    console.error('THIRD_PARTY_NOTICES.txt is out of date. Run `npm run notices` and commit it.')
    process.exit(1)
  }

  console.log('THIRD_PARTY_NOTICES.txt is up to date.')
} else {
  writeFileSync(OUTPUT, expected)
  console.log(`wrote THIRD_PARTY_NOTICES.txt`)
}
