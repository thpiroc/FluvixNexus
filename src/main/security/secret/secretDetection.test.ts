import { describe, expect, it } from 'vitest'
import { maskSecretText, SECRET_MASK } from './secretMasking'
import type { SecretCategory } from './secretPatterns'

/**
 * 中身からの Secret の検出（Security Core v1 の STEP3）。
 *
 * 検出そのものは位置しか返さないため、確かめ方は **maskSecretText の結果**を見る形にする
 * ── 「値が結果に残っていないこと」まで一緒に確かめられるため。
 */

/** 値が伏せられ、結果のどこにも残っていないことまで確かめる。 */
function expectMasked(text: string, secret: string, category: SecretCategory): void {
  const result = maskSecretText(text)

  expect(result.secretsFound).toBe(true)
  expect(result.text).not.toContain(secret)
  expect(result.text).toContain(SECRET_MASK)
  expect(result.categories).toContain(category)
  expect(JSON.stringify(result)).not.toContain(secret)
}

function expectNotDetected(text: string): void {
  const result = maskSecretText(text)

  expect(result.secretsFound).toBe(false)
  expect(result.maskedCount).toBe(0)
  expect(result.text).toBe(text)
}

describe('形で決まるもの', () => {
  it('GitHub の token', () => {
    const secret = 'ghp_1234567890abcdefGHIJKLMNOPqrstuvwx'

    expectMasked(
      `git remote add origin https://${secret}@github.com/x/y.git`,
      secret,
      'github-token'
    )
    expectMasked(`GITHUB_TOKEN=${secret}`, secret, 'github-token')
  })

  it('GitHub の fine-grained token', () => {
    const secret = `github_pat_11ABCDEFG0${'abcdefghij'.repeat(6)}`

    expectMasked(`token: ${secret}`, secret, 'github-token')
  })

  it('Provider の API Key', () => {
    const keys: readonly string[] = [
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'sk-proj1234567890ABCDEFGHIJKLMNOP',
      'AKIAIOSFODNN7EXAMPLE',
      `AIza${'aB3'.repeat(11)}xy`,
      'xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx',
      'glpat-AbCdEfGhIjKlMnOpQrSt'
    ]

    for (const secret of keys) {
      expectMasked(`value is ${secret} here`, secret, 'provider-api-key')
    }
  })

  it('JWT', () => {
    const secret =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

    expectMasked(`id_token=${secret}`, secret, 'jwt')
  })

  it('Authorization の値（印は残す）', () => {
    const secret = 'AbCdEf0123456789GhIjKl'
    const result = maskSecretText(`Authorization: Bearer ${secret}`)

    expect(result.text).toBe(`Authorization: Bearer ${SECRET_MASK}`)
    expect(result.categories).toContain('authorization-value')
  })

  it('URL に埋め込まれた認証情報（利用者名ごと伏せる）', () => {
    const result = maskSecretText('https://carol:s3cr3t-p4ssw0rd@example.com/repo.git')

    expect(result.text).toBe(`https://${SECRET_MASK}@example.com/repo.git`)
    expect(result.text).not.toContain('carol')
    expect(result.categories).toContain('url-credential')
  })

  it('認証情報の無い URL は伏せない', () => {
    expectNotDetected('https://example.com/repo.git を開く')
  })
})

describe('Private Key block', () => {
  const block = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAwJz0Zq3kq3fV1oQq9Yx5cJ2nQ8yFh4rGm0pLd7sT2vXa9bNc',
    'Rk4uWpE6HtYbZg1lS3oM5xKjD0fAqIeUcVn7BhPwTyLrGsXdNmCzQjRkFtYvUaOb',
    '-----END RSA PRIVATE KEY-----'
  ].join('\n')

  it('block 全体を伏せる（印も本体も残さない）', () => {
    const result = maskSecretText(`before\n${block}\nafter`)

    expect(result.text).toBe(`before\n${SECRET_MASK}\nafter`)
    expect(result.text).not.toContain('BEGIN')
    expect(result.text).not.toContain('MIIEow')
    expect(result.categories).toEqual(['private-key'])
  })

  it('OPENSSH / EC / ENCRYPTED / PGP のどれも同じ', () => {
    for (const label of [
      'OPENSSH PRIVATE KEY',
      'EC PRIVATE KEY',
      'ENCRYPTED PRIVATE KEY',
      'PRIVATE KEY',
      'PGP PRIVATE KEY BLOCK'
    ]) {
      const text = `-----BEGIN ${label}-----\nc2VjcmV0LWJvZHk=\n-----END ${label}-----`

      expect(maskSecretText(text).text).toBe(SECRET_MASK)
    }
  })

  it('END が無ければ、そこから末尾まで伏せる', () => {
    const truncated = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAwJz0Zq3kq3fV1oQq9'
    const result = maskSecretText(`log line\n${truncated}`)

    expect(result.text).toBe(`log line\n${SECRET_MASK}`)
    expect(result.text).not.toContain('MIIEow')
  })

  it('公開鍵の block は伏せない', () => {
    const text = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0=\n-----END PUBLIC KEY-----'

    expectNotDetected(text)
  })
})

describe('鍵の名前 ＋ 代入', () => {
  it('.env の形', () => {
    expectMasked('API_KEY=A1b2C3d4E5f6G7h8', 'A1b2C3d4E5f6G7h8', 'key-value')
    expectMasked('DB_PASSWORD=hunter2correct', 'hunter2correct', 'key-value')
    expectMasked('CLIENT_SECRET=9f8e7d6c5b4a3210', '9f8e7d6c5b4a3210', 'key-value')
  })

  it('JSON の形（引用符は残す）', () => {
    const result = maskSecretText('{ "apiKey": "A1b2C3d4E5f6G7h8" }')

    expect(result.text).toBe(`{ "apiKey": "${SECRET_MASK}" }`)
  })

  it('コードの形', () => {
    expectMasked("const password = 'Tr0ub4dor&3xyz'", 'Tr0ub4dor&3xyz', 'key-value')
  })

  it('.npmrc の _authToken', () => {
    const secret = 'npm0AbCdEfGhIjKlMnOpQrStUvWx'

    expectMasked(`//registry.npmjs.org/:_authToken=${secret}`, secret, 'key-value')
  })

  /**
   * `.npmrc` は Secret ファイルにしない（secretPaths.test.ts）。本物の token は
   * ここで確実に伏せる ── 名前で許した分、中身の判定が最後の砦になる。
   */
  it('.npmrc の本文（registry の行は残し、token だけを伏せる）', () => {
    const npmToken = 'npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
    const githubToken = 'ghp_1234567890abcdefGHIJKLMNOPqrstuvwx'
    const result = maskSecretText(
      [
        'registry=https://registry.npmjs.org/',
        `//registry.npmjs.org/:_authToken=${npmToken}`,
        '@fluvix:registry=https://npm.pkg.github.com/',
        `//npm.pkg.github.com/:_authToken=${githubToken}`,
        'always-auth=true',
        ''
      ].join('\n')
    )

    expect(result.text).toBe(
      [
        'registry=https://registry.npmjs.org/',
        `//registry.npmjs.org/:_authToken=${SECRET_MASK}`,
        '@fluvix:registry=https://npm.pkg.github.com/',
        `//npm.pkg.github.com/:_authToken=${SECRET_MASK}`,
        'always-auth=true',
        ''
      ].join('\n')
    )
    expect(result.maskedCount).toBe(2)
    expect(result.text).not.toContain(npmToken)
    expect(result.text).not.toContain(githubToken)
    expect(JSON.stringify(result)).not.toContain('AbCdEfGhIj')
    expect(JSON.stringify(result)).not.toContain('1234567890abcdef')
  })

  /**
   * ソースコードは名前だけで拒まない（secretPaths.test.ts）。その代わり、
   * 中身に本物の値があれば値だけを伏せてファイルは読めるままにする。
   */
  it('ソースコードの中の本物の値（false negative の回帰）', () => {
    const result = maskSecretText(
      [
        '// src/auth/credentials.ts',
        'export const config = {',
        "  apiKey: 'A1b2C3d4E5f6G7h8',",
        "  endpoint: 'https://api.example.com'",
        '}',
        ''
      ].join('\n')
    )

    expect(result.text).toBe(
      [
        '// src/auth/credentials.ts',
        'export const config = {',
        `  apiKey: '${SECRET_MASK}',`,
        "  endpoint: 'https://api.example.com'",
        '}',
        ''
      ].join('\n')
    )
    expect(result.userNoticeRequired).toBe(true)
  })

  it('同じ本文に複数あれば、すべて伏せる', () => {
    const result = maskSecretText(
      ['API_KEY=A1b2C3d4E5f6G7h8', 'DB_PASSWORD=hunter2correct', 'PORT=3000'].join('\n')
    )

    expect(result.maskedCount).toBe(2)
    expect(result.text).toBe(
      [`API_KEY=${SECRET_MASK}`, `DB_PASSWORD=${SECRET_MASK}`, 'PORT=3000'].join('\n')
    )
  })
})

describe('過検出を避ける', () => {
  it('Secret の無い本文は何も変えない', () => {
    expectNotDetected('export function readToken(): string {\n  return load()\n}\n')
  })

  it('token という語があるだけでは伏せない', () => {
    expectNotDetected('// この関数は token を更新する')
    expectNotDetected('Refresh the access token before it expires.')
    expectNotDetected('トークン（token）の有効期限は 1 時間。')
  })

  it('型注釈は伏せない', () => {
    expectNotDetected('interface Auth {\n  token: string\n  password: string\n}')
  })

  it('参照・式は伏せない', () => {
    for (const text of [
      'apiKey: process.env.API_KEY',
      'password = config.database.password',
      'const token = getAccessToken()',
      'API_KEY=${OPENAI_API_KEY}',
      'API_KEY=$OPENAI_API_KEY',
      'api_key: {{ api_key }}',
      'PASSWORD=%DB_PASSWORD%',
      'client_secret: CLIENT_SECRET_VALUE'
    ]) {
      expectNotDetected(text)
    }
  })

  it('雛形の値は伏せない', () => {
    for (const text of [
      'API_KEY=your-api-key-here',
      'API_KEY=YOUR_API_KEY_HERE',
      'PASSWORD=changeme',
      'TOKEN=xxxxxxxxxxxxxxxx',
      'SECRET=<your-secret>',
      'API_KEY=placeholder',
      'password=********'
    ]) {
      expectNotDetected(text)
    }
  })

  it('短すぎる値は伏せない', () => {
    expectNotDetected('PASSWORD=hunter2')
    expectNotDetected('token: abc')
  })

  it('1種類の文字しか無い短い値は伏せない', () => {
    expectNotDetected('password=abcdefghij')
  })

  it('空白を含む値は伏せない（散文を壊さない）', () => {
    expectNotDetected('The password is stored in the vault, not here.')
  })
})
